import sqlite3
from typing import Any, Dict, List
from backend.database.models import Tag

class TagCrudMixin:
    def parse_tags_from_text(self, text: str) -> List[str]:
        """从文本中解析标签（格式：#标签名）"""
        import re
        if not text:
            return []
        # 匹配 #标签名 格式，标签名可以是中文、英文、数字、下划线
        pattern = r'#([\u4e00-\u9fa5a-zA-Z0-9_]+)'
        tags = re.findall(pattern, text)
        return list(set(tags))  # 去重

    def update_task_tags(self, task_id: str, tag_names: List[str]) -> None:
        """更新任务的标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 先删除任务的所有标签关联
        cursor.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))

        # 添加或获取标签ID
        if tag_names:
            tag_ids = []
            for tag_name in tag_names:
                # 检查标签是否已存在
                cursor.execute('SELECT id FROM tags WHERE name = ?', (tag_name,))
                result = cursor.fetchone()

                if result:
                    tag_ids.append(result[0])
                else:
                    # 创建新标签
                    tag = Tag(name=tag_name)
                    cursor.execute('''
                        INSERT INTO tags (id, name, color, created_at)
                        VALUES (?, ?, ?, ?)
                    ''', (tag.id, tag.name, tag.color, tag.created_at.isoformat()))
                    tag_ids.append(tag.id)

            # 建立关联
            for tag_id in tag_ids:
                cursor.execute('''
                    INSERT OR IGNORE INTO task_tags (task_id, tag_id)
                    VALUES (?, ?)
                ''', (task_id, tag_id))

        conn.commit()
        conn.close()

    def get_task_tags(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的所有标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.id, t.name, t.color, t.created_at
            FROM tags t
            INNER JOIN task_tags tt ON t.id = tt.tag_id
            WHERE tt.task_id = ?
        ''', (task_id,))

        rows = cursor.fetchall()
        conn.close()

        tags = []
        for row in rows:
            tags.append({
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3]
            })
        return tags

    def get_all_tags(self) -> List[Dict[str, Any]]:
        """获取所有标签及其使用次数"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.id, t.name, t.color, t.created_at, COUNT(tt.task_id) as task_count
            FROM tags t
            LEFT JOIN task_tags tt ON t.id = tt.tag_id
            GROUP BY t.id
            ORDER BY t.name
        ''')

        rows = cursor.fetchall()
        conn.close()

        tags = []
        for row in rows:
            tags.append({
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3],
                'taskCount': row[4]
            })
        return tags

    def update_tag(self, tag_id: str, tag_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新标签（如重命名标签名称）"""
        new_name = (tag_data.get('name') or '').strip()
        if not new_name:
            raise ValueError('标签名称不能为空')

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 重名校验（排除自身）
        cursor.execute('SELECT id FROM tags WHERE name = ? AND id != ?', (new_name, tag_id))
        if cursor.fetchone():
            conn.close()
            raise ValueError('标签名称已存在')

        # 获取当前标签信息，未传颜色时保持不变
        cursor.execute('SELECT color FROM tags WHERE id = ?', (tag_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            raise ValueError('标签不存在')
        color = tag_data.get('color') or row[0]

        cursor.execute('UPDATE tags SET name = ?, color = ? WHERE id = ?', (new_name, color, tag_id))
        conn.commit()
        conn.close()

        return {'id': tag_id, 'name': new_name, 'color': color}

    def delete_tag(self, tag_id: str) -> bool:
        """删除标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
        # task_tags 中的关联记录会通过外键约束自动删除
        conn.commit()
        conn.close()
        return True

    def check_delete_tag(self) -> None:
        """在标签未关联任何任务时，删除标签"""
        conn = sqlite3.connect(self.db_path)
        conn.cursor()
        tags = self.get_all_tags()
        for tag in tags:
            if tag.get('taskCount') == 0:
                self.delete_tag(tag.get('id'))
        conn.commit()
        conn.close()
# backend/database/mixins/tag_crud_mixin.py
import re
from typing import Any, Dict, List, Optional, Sequence

from backend.database.models import Tag

# 匹配 #标签名 格式，标签名可以是中文、英文、数字、下划线
_TAG_PATTERN = re.compile(r'#([\u4e00-\u9fa5a-zA-Z0-9_]+)')

# SQLite 单条语句的参数上限，批量操作按此拆分
_SQLITE_MAX_VARS = 500

_TAG_COLUMNS = 'id, name, color, created_at'


def _chunks(items: Sequence[Any], size: int = _SQLITE_MAX_VARS) -> List[Sequence[Any]]:
    return [items[start:start + size] for start in range(0, len(items), size)]


def _row_to_tag(row: Any) -> Dict[str, Any]:
    return {
        'id': row['id'],
        'name': row['name'],
        'color': row['color'],
        'createdAt': row['created_at'],
    }


class TagCrudMixin:
    """标签 CRUD。

    对外方法自行管理连接；``_`` 开头且首参为 ``conn`` 的方法供其他 mixin
    在同一事务内复用（例如新增 / 查询任务时批量补齐标签）。
    """

    # ------------------------------------------------------------------ #
    # 文本解析
    # ------------------------------------------------------------------ #

    def parse_tags_from_text(self, text: str) -> List[str]:
        """从文本中解析标签（格式：#标签名）"""
        if not text:
            return []
        return list(set(_TAG_PATTERN.findall(text)))  # 去重

    # ------------------------------------------------------------------ #
    # 关联维护
    # ------------------------------------------------------------------ #

    def _replace_tags(self, conn, task_id: str, tag_names: Optional[Sequence[str]]) -> None:
        """在同一事务内把任务的标签整体替换为 tag_names。"""
        conn.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))
        if not tag_names:
            return

        tag_ids: List[str] = []
        for tag_name in tag_names:
            if not tag_name:
                continue
            row = conn.execute('SELECT id FROM tags WHERE name = ?', (tag_name,)).fetchone()
            if row:
                tag_ids.append(row['id'])
            else:
                tag = Tag(name=tag_name)
                conn.execute(
                    f'INSERT INTO tags ({_TAG_COLUMNS}) VALUES (?, ?, ?, ?)',
                    (tag.id, tag.name, tag.color, tag.created_at.isoformat())
                )
                tag_ids.append(tag.id)

        if tag_ids:
            conn.executemany(
                'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
                [(task_id, tag_id) for tag_id in tag_ids]
            )

    def update_task_tags(self, task_id: str, tag_names: List[str]) -> None:
        """更新任务的标签"""
        with self.tx() as conn:
            self._replace_tags(conn, task_id, tag_names)

    def _task_tags_map(self, conn, task_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
        """批量获取多个任务的标签，返回 {task_id: [tag]}（一次查询，避免 N+1）。"""
        result: Dict[str, List[Dict[str, Any]]] = {tid: [] for tid in task_ids}
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return result

        for batch in _chunks(ids):
            placeholders = ','.join(['?'] * len(batch))
            rows = conn.execute(
                f'SELECT tt.task_id, t.id, t.name, t.color, t.created_at '
                f'FROM task_tags tt JOIN tags t ON t.id = tt.tag_id '
                f'WHERE tt.task_id IN ({placeholders}) '
                f'ORDER BY t.name',
                tuple(batch)
            ).fetchall()
            for row in rows:
                result.setdefault(row['task_id'], []).append(_row_to_tag(row))
        return result

    def get_task_tags(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的所有标签"""
        with self.query() as conn:
            return self._task_tags_map(conn, [task_id]).get(task_id, [])

    def _delete_orphan_tags(self, conn) -> int:
        """删除未关联任何任务的标签，返回删除数量。"""
        cursor = conn.execute(
            'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM task_tags)')
        return cursor.rowcount or 0

    def check_delete_tag(self) -> None:
        """在标签未关联任何任务时，删除标签（单条 SQL，单事务）"""
        with self.tx() as conn:
            self._delete_orphan_tags(conn)

    # ------------------------------------------------------------------ #
    # 标签本体
    # ------------------------------------------------------------------ #

    def get_all_tags(self) -> List[Dict[str, Any]]:
        """获取所有标签及其使用次数"""
        with self.query() as conn:
            rows = conn.execute(
                'SELECT t.id, t.name, t.color, t.created_at, COUNT(tt.task_id) AS task_count '
                'FROM tags t LEFT JOIN task_tags tt ON t.id = tt.tag_id '
                'GROUP BY t.id ORDER BY t.name'
            ).fetchall()

        return [{
            'id': row['id'],
            'name': row['name'],
            'color': row['color'],
            'createdAt': row['created_at'],
            'taskCount': row['task_count'],
        } for row in rows]

    def update_tag(self, tag_id: str, tag_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新标签（如重命名标签名称）"""
        new_name = (tag_data.get('name') or '').strip()
        if not new_name:
            raise ValueError('标签名称不能为空')

        with self.tx() as conn:
            # 重名校验（排除自身）
            if conn.execute(
                'SELECT id FROM tags WHERE name = ? AND id != ?', (new_name, tag_id)
            ).fetchone():
                raise ValueError('标签名称已存在')

            # 未传颜色时保持不变
            row = conn.execute('SELECT color FROM tags WHERE id = ?', (tag_id,)).fetchone()
            if not row:
                raise ValueError('标签不存在')
            color = tag_data.get('color') or row['color']

            conn.execute(
                'UPDATE tags SET name = ?, color = ? WHERE id = ?', (new_name, color, tag_id))

        return {'id': tag_id, 'name': new_name, 'color': color}

    def delete_tag(self, tag_id: str) -> bool:
        """删除标签及其全部关联"""
        with self.tx() as conn:
            conn.execute('DELETE FROM task_tags WHERE tag_id = ?', (tag_id,))
            conn.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
        return True

import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

class TaskRelationCrudMixin:

    def add_task_relation(self, sub_task_id: str, main_task_id: str) -> None:
        """添加或更新一条关联（确保单父）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        # 由于 UNIQUE(task_id) 约束，直接用 INSERT OR REPLACE 即可
        cursor.execute('''
            INSERT OR REPLACE INTO task_relations (sub_task_id, main_task_id, created_at)
            VALUES (?, ?, ?)
        ''', (sub_task_id, main_task_id, datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def delete_relation_by_children(self, task_id: str) -> None:
        """删除该任务作为子任务的关联"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM task_relations WHERE sub_task_id = ?', (task_id,))
        conn.commit()
        conn.close()

    def delete_relations_by_parent(self, task_id: str) -> None:
        """删除所有以 main_task_id 为父的关联"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM task_relations WHERE main_task_id = ?', (task_id,))
        conn.commit()
        conn.close()

    def get_children(self, task_id: str) -> List[Optional[Dict[str, Any]]]:
        """获取指定任务的所有直接子任务（单层查询）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        # 查询关联表中的子任务 ID
        cursor.execute('SELECT sub_task_id FROM task_relations WHERE main_task_id = ?', (task_id,))
        children = [self.get_task(row[0]) for row in cursor.fetchall()]
        conn.close()

        if not children:
            return []
        return children

    def get_parent(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务的父任务（如果有）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT main_task_id FROM task_relations WHERE sub_task_id = ?', (task_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return self.get_task(row[0])
        return None

    def get_parents_map(self, task_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """批量获取多个任务的父任务（仅返回存在关联的任务）。

        用于列表页展示"关联父项任务"列，避免逐条调用 get_parent 产生 N 次查询。

        :param task_ids: 任务ID列表
        :return: {子任务ID: {'id': 父任务ID, 'title': 父任务标题}}
        """
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return {}

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        result: Dict[str, Dict[str, Any]] = {}
        # SQLite 参数上限约 999，按批拆分以防列表过长
        batch_size = 500
        for start in range(0, len(ids), batch_size):
            batch = ids[start:start + batch_size]
            placeholders = ','.join(['?'] * len(batch))
            cursor.execute(
                f'SELECT r.sub_task_id, t.id, t.title '
                f'FROM task_relations r JOIN tasks t ON t.id = r.main_task_id '
                f'WHERE r.sub_task_id IN ({placeholders})',
                tuple(batch)
            )
            for sub_task_id, parent_id, parent_title in cursor.fetchall():
                result[sub_task_id] = {'id': parent_id, 'title': parent_title}
        conn.close()
        return result

    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> List[Dict[str, Any]]:
        """搜索具有子任务的父任务（按标题模糊匹配，不区分大小写），返回前 limit 条。

        通过 task_relations 表 JOIN tasks，找出作为父任务（main_task_id）且标题匹配的任务，
        并统计其子任务数量。关键字中的 % 与 _ 会被转义为字面量，不会被当作 LIKE 通配符。

        返回:
            [{id, title, priority, dueDate, completed, subtaskCount}, ...]
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        base_sql = '''
            SELECT t.id, t.title, t.priority, t.due_date, t.completed, COUNT(r.sub_task_id) AS sub_count
            FROM task_relations r
            JOIN tasks t ON t.id = r.main_task_id
        '''
        if keyword:
            # 转义 LIKE 通配符，避免关键字中的 %/_ 被当通配符
            esc = '\\'
            escaped = keyword.replace(esc, esc + esc).replace('%', esc + '%').replace('_', esc + '_')
            like = f'%{escaped}%'
            cursor.execute(
                base_sql +
                ' WHERE t.title COLLATE NOCASE LIKE ? ESCAPE ?'
                ' GROUP BY r.main_task_id'
                ' ORDER BY sub_count DESC, t.updated_at DESC'
                ' LIMIT ?',
                (like, esc, limit)
            )
        else:
            cursor.execute(
                base_sql +
                ' GROUP BY r.main_task_id'
                ' ORDER BY sub_count DESC, t.updated_at DESC'
                ' LIMIT ?',
                (limit,)
            )
        rows = cursor.fetchall()
        conn.close()
        return [{
            'id': r[0],
            'title': r[1],
            'priority': r[2],
            'dueDate': r[3],
            'completed': bool(r[4]),
            'subtaskCount': r[5]
        } for r in rows]
# backend/database/mixins/task_relation_crud_mixin.py
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.database.mixins._helpers import chunks, placeholders


class TaskRelationCrudMixin:
    """任务父子关联 CRUD（普通父子任务，与周期性任务的 parent_task_id 无关）"""

    # ------------------------------------------------------------------ #
    # 写入
    # ------------------------------------------------------------------ #

    def add_task_relation(self, sub_task_id: str, main_task_id: str) -> None:
        """添加或更新一条关联（UNIQUE(sub_task_id) 保证单父）"""
        with self.tx() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO task_relations (sub_task_id, main_task_id, created_at) '
                'VALUES (?, ?, ?)',
                (sub_task_id, main_task_id, datetime.now().isoformat())
            )

    def delete_relation_by_children(self, task_id: str) -> None:
        """删除该任务作为子任务的关联"""
        with self.tx() as conn:
            conn.execute('DELETE FROM task_relations WHERE sub_task_id = ?', (task_id,))

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #

    def get_children(self, task_id: str) -> List[Dict[str, Any]]:
        """获取指定任务的所有直接子任务（单层查询，批量取回）

        关联表中残留的已删除任务记录会被自动忽略。
        """
        with self.query() as conn:
            rows = conn.execute(
                'SELECT sub_task_id FROM task_relations WHERE main_task_id = ?', (task_id,)
            ).fetchall()
        return self.get_tasks_by_ids([row['sub_task_id'] for row in rows])

    def get_parent(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务的父任务（如果有）"""
        with self.query() as conn:
            row = conn.execute(
                'SELECT main_task_id FROM task_relations WHERE sub_task_id = ?', (task_id,)
            ).fetchone()
        return self.get_task(row['main_task_id']) if row else None

    def get_parents_map(self, task_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """批量获取多个任务的父任务（仅返回存在关联的任务）。

        用于列表页展示"关联父项任务"列，避免逐条调用 get_parent 产生 N 次查询。

        :param task_ids: 任务ID列表
        :return: {子任务ID: {'id': 父任务ID, 'title': 父任务标题}}
        """
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return {}

        result: Dict[str, Dict[str, Any]] = {}
        with self.query() as conn:
            # 按批拆分以防任务列表过长导致参数超限
            for batch in chunks(ids):
                marks = placeholders(len(batch))
                rows = conn.execute(
                    f'SELECT r.sub_task_id, t.id, t.title '
                    f'FROM task_relations r JOIN tasks t ON t.id = r.main_task_id '
                    f'WHERE r.sub_task_id IN ({marks})',
                    tuple(batch)
                ).fetchall()
                for row in rows:
                    result[row['sub_task_id']] = {'id': row['id'], 'title': row['title']}
        return result

    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> List[Dict[str, Any]]:
        """搜索具有子任务的父任务（按标题模糊匹配，不区分大小写），返回前 limit 条。

        通过 task_relations 表 JOIN tasks，找出作为父任务（main_task_id）且标题匹配的任务，
        并统计其子任务数量。关键字中的 % 与 _ 会被转义为字面量，不会被当作 LIKE 通配符。

        返回:
            [{id, title, priority, dueDate, completed, subtaskCount}, ...]
        """
        base_sql = (
            'SELECT t.id, t.title, t.priority, t.due_date, t.completed, COUNT(r.sub_task_id) AS sub_count '
            'FROM task_relations r JOIN tasks t ON t.id = r.main_task_id '
        )
        tail_sql = ' GROUP BY r.main_task_id ORDER BY sub_count DESC, t.updated_at DESC LIMIT ?'

        with self.query() as conn:
            if keyword:
                # 转义 LIKE 通配符，避免关键字中的 %/_ 被当通配符
                esc = '\\'
                escaped = keyword.replace(esc, esc + esc).replace('%', esc + '%').replace('_', esc + '_')
                rows = conn.execute(
                    base_sql + ' WHERE t.title COLLATE NOCASE LIKE ? ESCAPE ?' + tail_sql,
                    (f'%{escaped}%', esc, limit)
                ).fetchall()
            else:
                rows = conn.execute(base_sql + tail_sql, (limit,)).fetchall()

        return [{
            'id': row['id'],
            'title': row['title'],
            'priority': row['priority'],
            'dueDate': row['due_date'],
            'completed': bool(row['completed']),
            'subtaskCount': row['sub_count'],
        } for row in rows]

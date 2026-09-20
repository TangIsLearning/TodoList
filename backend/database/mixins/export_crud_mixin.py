"""
导出专用取数
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional, Sequence

from backend.database.mixins._helpers import chunks, placeholders
from backend.database.mixins.task_crud_mixin import _TASK_ORDER_BY


class ExportCrudMixin:
    """导出专用取数（当前仅供 Excel 导出使用）。

    导出此前走 get_all_tasks()：拉回全量任务（含描述、周期规则等导出用不到的
    字段），在 Python 侧过滤，再逐条补齐标签 / 附件 / 父任务 —— 每条任务约 3 次
    查询；标签筛选还是「标签 × 任务」双重循环查 get_task_tags，千级任务即数千次
    查询。

    这里把筛选下推到 SQL，只取导出用到的列，并沿用列表取数已有的批量补齐方式
    （标签 / 附件各一次查询，父任务一次查询），最后直接返回成品行。
    """

    # ------------------------------------------------------------------ #
    # 对外接口
    # ------------------------------------------------------------------ #

    def get_export_rows(self, priority: Optional[str] = None, status: Optional[str] = None,
                        year: Optional[int] = None, month: Optional[int] = None,
                        category_id: Optional[str] = None,
                        tag_ids: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
        """按导出筛选条件取回成品行。

        行顺序沿用 get_all_tasks() 的排序（截止时间 → 优先级 → 创建时间），
        保证导出结果与旧实现逐行一致。

        返回:
            [{
                title, parentTitle, completed, priority, dueDate,
                categoryName, tagNames, attachmentNames
            }, ...]
        """
        clauses: List[str] = []
        params: List[Any] = []

        if priority and priority != 'all':
            clauses.append('t.priority = ?')
            params.append(priority)

        if status == 'completed':
            clauses.append('t.completed = 1')
        elif status == 'uncompleted':
            clauses.append('t.completed = 0')

        # due_date 统一以 'YYYY-MM-DD...' 存储，截取年月与 Python 侧
        # datetime.fromisoformat().year / .month 等价
        if year:
            clauses.append("t.due_date IS NOT NULL AND t.due_date <> '' AND substr(t.due_date, 1, 4) = ?")
            params.append(str(year))
        if month:
            clauses.append("t.due_date IS NOT NULL AND t.due_date <> '' AND substr(t.due_date, 6, 2) = ?")
            params.append(str(month).zfill(2))

        if category_id and category_id != 'all':
            clauses.append('t.category_id = ?')
            params.append(category_id)

        if tag_ids:
            # 与旧实现一致：命中任一标签即入选（并集，而非同时具备全部标签）
            marks = placeholders(len(tag_ids))
            clauses.append(
                f'EXISTS (SELECT 1 FROM task_tags tt '
                f'WHERE tt.task_id = t.id AND tt.tag_id IN ({marks}))'
            )
            params.extend(str(t) for t in tag_ids)

        where = f' WHERE {" AND ".join(clauses)}' if clauses else ''
        sql = (
            'SELECT t.id, t.title, t.completed, t.priority, t.due_date, t.category_id '
            f'FROM tasks t{where} {_TASK_ORDER_BY}'
        )

        with self.query() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
            return self._rows_to_export_rows(conn, rows)

    # ------------------------------------------------------------------ #
    # 内部构件（首参为 conn，供同一连接内复用）
    # ------------------------------------------------------------------ #

    def _rows_to_export_rows(self, conn: sqlite3.Connection,
                             rows: Sequence[Any]) -> List[Dict[str, Any]]:
        """把任务行转成导出行，并一次性补齐标签 / 附件 / 父任务（避免 N+1）。"""
        if not rows:
            return []

        task_ids = [row['id'] for row in rows]
        tags_map = self._task_tags_map(conn, task_ids)
        attachments_map = self._attachments_map(conn, task_ids)
        parents_map = self._parent_titles_map(conn, task_ids)
        category_map = self._category_names_map(conn)

        result: List[Dict[str, Any]] = []
        for row in rows:
            result.append({
                'title': row['title'] or '',
                'parentTitle': parents_map.get(row['id'], '无'),
                'completed': bool(row['completed']),
                'priority': row['priority'],
                'dueDate': row['due_date'],
                'categoryName': category_map.get(row['category_id'], '无分类'),
                'tagNames': ', '.join(t['name'] for t in tags_map.get(row['id'], []) if t.get('name')),
                'attachmentNames': ', '.join(
                    a.get('name', '') for a in attachments_map.get(row['id'], []) if a.get('name')
                ),
            })
        return result

    def _parent_titles_map(self, conn: sqlite3.Connection,
                           task_ids: Sequence[str]) -> Dict[str, str]:
        """批量取父任务标题，返回 {子任务 id: 父任务标题}（无关联的不出现）。"""
        result: Dict[str, str] = {}
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return result

        for batch in chunks(ids):
            marks = placeholders(len(batch))
            rows = conn.execute(
                f'SELECT r.sub_task_id, t.title '
                f'FROM task_relations r JOIN tasks t ON t.id = r.main_task_id '
                f'WHERE r.sub_task_id IN ({marks})',
                tuple(batch)
            ).fetchall()
            for row in rows:
                result[row['sub_task_id']] = row['title'] or ''
        return result

    def _category_names_map(self, conn: sqlite3.Connection) -> Dict[str, str]:
        """分类 id → 分类名。"""
        rows = conn.execute('SELECT id, name FROM categories').fetchall()
        return {row['id']: row['name'] for row in rows}

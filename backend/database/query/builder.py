# backend/database/query/builder.py
"""把 ParsedQuery 翻译成 SQL WHERE 条件。

这是唯一把查询语义翻译成表结构的地方（依赖 tasks / tags / task_tags / task_relations）。
"""
from __future__ import annotations

from typing import Any, List, Tuple

from backend.database.query.types import ParsedQuery

# 按标签名模糊匹配（每个标签一个独立条件，保证多标签是 AND 而不是 OR）
_TAG_NAME_CLAUSE = (
    'id IN (SELECT task_id FROM task_tags WHERE tag_id IN ('
    ' SELECT id FROM tags WHERE name LIKE ?))'
)
# 按标签 ID 精确匹配
_TAG_ID_CLAUSE = 'id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)'
# 普通关键词：标题 / 描述 / 标签名
_KEYWORD_CLAUSE = (
    '(title LIKE ? OR description LIKE ? OR id IN ('
    ' SELECT task_id FROM task_tags WHERE tag_id IN ('
    '  SELECT id FROM tags WHERE name LIKE ?)))'
)
# 父任务精确 ID：命中其直接子任务
_PARENT_ID_CLAUSE = 'id IN (SELECT sub_task_id FROM task_relations WHERE main_task_id = ?)'
# 父任务名称回退：取所有同名父任务的子任务并集。
# 没有子任务的同名任务不会产生子任务记录，因此天然不会被"同名空任务"干扰。
_PARENT_NAME_CLAUSE = (
    'id IN (SELECT sub_task_id FROM task_relations WHERE main_task_id IN ('
    ' SELECT id FROM tasks WHERE title = ? COLLATE NOCASE))'
)
# 含有任意标签
_ANY_TAG_CLAUSE = 'id IN (SELECT task_id FROM task_tags)'
# 截止日期：与"日历点击某天"同样的语义，按当天匹配（忽略具体时刻）
_DUE_DATE_CLAUSE = 'date(due_date) = ?'


class SearchClauseBuilder:
    """构建搜索相关的 WHERE 条件。

    语义（多条件之间一律 AND）：
      - 多个标签：任务必须同时带有所有标签
      - 多个关键词：任务必须同时命中所有关键词
      - 父任务：任务必须是该父任务的直接子任务
      - 截止日期：任务的截止时间必须落在指定当天（忽略时刻）
    """

    def build(self, query: ParsedQuery | None) -> Tuple[List[str], List[Any]]:
        """返回 (where 条件列表, 参数列表)，调用方用 AND 连接即可。"""
        clauses: List[str] = []
        params: List[Any] = []

        if query is None or query.is_empty():
            return clauses, params

        for tag_name in query.tags:
            clauses.append(_TAG_NAME_CLAUSE)
            params.append(f'%{tag_name}%')

        for tag_id in query.tag_ids:
            clauses.append(_TAG_ID_CLAUSE)
            params.append(tag_id)

        if query.has_any_tag:
            clauses.append(_ANY_TAG_CLAUSE)

        for keyword in query.keywords:
            clauses.append(_KEYWORD_CLAUSE)
            params.extend([f'%{keyword}%', f'%{keyword}%', f'%{keyword}%'])

        if query.due_date:
            clauses.append(_DUE_DATE_CLAUSE)
            params.append(query.due_date)

        parent = query.parent
        if parent is not None and not parent.is_empty():
            if parent.id:
                clauses.append(_PARENT_ID_CLAUSE)
                params.append(parent.id)
            else:
                clauses.append(_PARENT_NAME_CLAUSE)
                params.append(parent.name)

        return clauses, params

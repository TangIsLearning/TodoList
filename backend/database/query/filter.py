"""任务列表筛选条件的对象化表示。

历史问题：``get_tasks_paginated`` / ``get_task_page`` 各自平铺了 11 个筛选参数，
前端只能按位置传参（``[page, pageSize, null, 'uncompleted', null, null, ...]``），
新增一个筛选维度要同步改四处（两个 Python 签名、DB 层、前端构造）。

这里把所有筛选维度收敛成一个 ``TaskFilter``，前后端约定一份键名即可。

键名约定：
    Python 侧字段用 snake_case；前端（以及任何 JSON 来源）用 camelCase，
    ``TaskFilter.from_any`` 两种写法都接受，未知键直接忽略。
"""
from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import date
from typing import Any, Dict, Mapping, Optional, Union

# snake_case 字段 → 对外（前端）使用的 camelCase 键
_FIELD_ALIASES: Dict[str, str] = {
    'category_id': 'categoryId',
    'due_date_filter': 'dueDateFilter',
    'search_query': 'searchQuery',
    'due_date': 'dueDate',
    'due_date_from': 'dueDateFrom',
    'due_date_to': 'dueDateTo',
    'sync_from': 'syncFrom',
    'sync_to': 'syncTo',
}

DateLike = Union[str, date]


@dataclass(frozen=True)
class TaskFilter:
    """任务列表筛选条件（分页查询与定位查询共用同一份）。

    各维度之间为 AND 语义；``None`` 表示该维度不参与筛选。

    category_id:       分类 ID，'all'/None 为全部分类
    status:            完成状态（completed / uncompleted / all）
    priority:          优先级（high / medium / low）
    due_date_filter:   日期快捷筛选（today / week / overdue / no-due-date / sync 等）
    year / month:      按创建时间筛选
    search_query:      搜索条件，语义由 query 解析层统一处理（dict 或旧字符串协议）
    due_date:          单一截止日（日历点击某一天），优先级高于日期快捷筛选
    due_date_from:     截止日区间起（时间轴），与 due_date_to 成对生效
    due_date_to:       截止日区间止
    sync_from/sync_to: 内部日历同步窗口，仅在 due_date_filter='sync' 时按 created_at 过滤
    """

    category_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date_filter: Optional[str] = None
    year: Optional[int] = None
    month: Optional[int] = None
    search_query: Optional[Union[str, Dict[str, Any]]] = None
    due_date: Optional[str] = None
    due_date_from: Optional[str] = None
    due_date_to: Optional[str] = None
    sync_from: Optional[DateLike] = None
    sync_to: Optional[DateLike] = None

    @classmethod
    def from_any(cls, value: Any = None) -> 'TaskFilter':
        """把任意入参规整成 TaskFilter。

        接受：None（全不筛选）、TaskFilter 本身、以及前端传来的 dict
        （camelCase 或 snake_case 键均可，未知键忽略）。
        非 Mapping 的意外入参一律退化成空筛选，不让脏数据打断列表渲染。
        """
        if value is None:
            return cls()
        if isinstance(value, cls):
            return value
        if not isinstance(value, Mapping):
            return cls()

        known = {f.name for f in fields(cls)}
        kwargs: Dict[str, Any] = {}
        for key, raw in value.items():
            field = _WIRE_TO_FIELD.get(key)
            if field is None:
                continue
            kwargs[field] = raw
        return cls(**kwargs)


# 对外键名 → Python 字段名：camelCase 别名 + snake_case 直通
_WIRE_TO_FIELD: Dict[str, str] = {name: name for name in
                                  (f.name for f in fields(TaskFilter))}
_WIRE_TO_FIELD.update({alias: name for name, alias in _FIELD_ALIASES.items()})

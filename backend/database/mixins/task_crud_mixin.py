# backend/database/mixins/task_crud_mixin.py
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

from dateutil.relativedelta import relativedelta

from backend.database.models import Task
from backend.database.query.builder import SearchClauseBuilder
from backend.database.query.parser import parse_search_query

# recurrence_count 为空（无限循环）时，周期性任务最多生成的任务总数（含父任务）
MAX_RECURRENCE_OCCURRENCES = 200

# SQLite 单条语句的参数上限，批量操作按此拆分
_SQLITE_MAX_VARS = 500

# 任务统一查询列：顺序即 _row_to_task 依赖的顺序，INSERT 复用同一份列名
_TASK_COLUMNS = (
    'id, title, description, completed, priority, category_id, due_date, '
    'is_recurring, recurrence_type, recurrence_interval, recurrence_count, '
    'parent_task_id, created_at, updated_at'
)
_COLUMN_COUNT = len(_TASK_COLUMNS.split(','))

_TASK_SELECT = f'SELECT {_TASK_COLUMNS} FROM tasks'
_INSERT_TASK_SQL = (
    f"INSERT INTO tasks ({_TASK_COLUMNS}) "
    f"VALUES ({', '.join(['?'] * _COLUMN_COUNT)})"
)

# 排序：有截止时间的优先 → 截止时间升序 → 优先级 → 创建时间倒序
_TASK_ORDER_TAIL = '''
        CASE WHEN due_date IS NOT NULL THEN 1 ELSE 2 END,
        due_date ASC,
        CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        created_at DESC'''
_TASK_ORDER_BY = f'ORDER BY {_TASK_ORDER_TAIL}'
# 分页列表额外把未完成任务排在前面
_TASK_ORDER_BY_PAGINATED = f'ORDER BY completed ASC, {_TASK_ORDER_TAIL}'

# 周期类型 → 步进函数
_RECURRENCE_STEPS = {
    'daily': lambda n: relativedelta(days=n),
    'weekly': lambda n: relativedelta(weeks=n),
    'monthly': lambda n: relativedelta(months=n),
    'yearly': lambda n: relativedelta(years=n),
}

# 允许部分更新的字段：前端驼峰键 → 数据库列名
_TASK_FIELD_MAP: Dict[str, str] = {
    'title': 'title',
    'description': 'description',
    'completed': 'completed',
    'priority': 'priority',
    'categoryId': 'category_id',
    'dueDate': 'due_date',
    'isRecurring': 'is_recurring',
    'recurrenceType': 'recurrence_type',
    'recurrenceInterval': 'recurrence_interval',
    'recurrenceCount': 'recurrence_count',
    'parentTaskId': 'parent_task_id',
}


def _month_end(day: date) -> date:
    """返回 day 所在月份的最后一天。"""
    next_month = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return next_month - timedelta(days=1)


def _as_iso_date(value: Union[str, date]) -> str:
    """把 date 对象或日期字符串统一成 'YYYY-MM-DD'。"""
    return value.isoformat() if isinstance(value, date) else str(value)


def _normalize_task_value(column: str, value: Any) -> Any:
    """把前端传入的值归一化成可写入数据库的形式。"""
    if isinstance(value, bool):
        return int(value)
    if column == 'due_date' and isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _chunks(items: Sequence[Any], size: int = _SQLITE_MAX_VARS) -> Iterable[Sequence[Any]]:
    """按 SQLite 参数上限拆分批量参数。"""
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _placeholders(count: int) -> str:
    return ','.join(['?'] * count)


def _build_base_filter_clauses(category_id: Optional[str], status: Optional[str],
                               priority: Optional[str], due_date_filter: Optional[str],
                               year: Optional[int], month: Optional[int],
                               custom_date: Optional[str],
                               sync_start_time: Optional[Union[str, date]] = None,
                               sync_end_time: Optional[Union[str, date]] = None
                               ) -> Tuple[List[str], List[Any]]:
    """构建分类 / 优先级 / 状态 / 日期 / 年月 等基础筛选的 WHERE 条件。

    只依赖传入参数，不依赖实例状态，便于与查询解析层组合使用。
    custom_date 存在时（日历点击）日期类筛选被忽略，保持原有优先级。
    """
    clauses: List[str] = []
    params: List[Any] = []
    today = datetime.now().date()

    # 分类筛选
    if not custom_date:
        if category_id == 'uncategorized':
            clauses.append('(category_id IS NULL OR category_id = "")')
        elif category_id and category_id != 'all':
            clauses.append('category_id = ?')
            params.append(category_id)

    # 优先级筛选
    if priority and priority != 'all':
        clauses.append('priority = ?')
        params.append(priority)

    # 状态筛选
    if status == 'completed':
        clauses.append('completed = 1')
    elif status == 'uncompleted':
        clauses.append('completed = 0')
    elif status == 'pending':
        # 未完成且未逾期
        clauses.append('completed = 0')
        clauses.append('(due_date IS NULL OR date(due_date) >= ?)')
        params.append(today.isoformat())
    elif status == 'overdue':
        # 未完成且已逾期
        clauses.append('completed = 0')
        clauses.append('due_date IS NOT NULL')
        clauses.append('date(due_date) < ?')
        params.append(today.isoformat())

    # 日期筛选
    if due_date_filter and not custom_date:
        if due_date_filter == 'today':
            clauses.append('date(due_date) = ?')
            params.append(today.isoformat())
        elif due_date_filter == 'tomorrow':
            tomorrow = today + timedelta(days=1)
            clauses.append('date(due_date) = ?')
            params.append(tomorrow.isoformat())
        elif due_date_filter == 'week':
            week_start = today - timedelta(days=today.weekday())
            week_end = week_start + timedelta(days=6)
            clauses.append('due_date IS NOT NULL')
            clauses.append('date(due_date) BETWEEN ? AND ?')
            params.append(week_start.isoformat())
            params.append(week_end.isoformat())
        elif due_date_filter == 'month':
            month_start = today.replace(day=1)
            month_end = _month_end(today)
            clauses.append('due_date IS NOT NULL')
            clauses.append('date(due_date) BETWEEN ? AND ?')
            params.append(month_start.isoformat())
            params.append(month_end.isoformat())
        elif due_date_filter == 'sync':  # 仅同步
            clauses.append('due_date IS NOT NULL')
            clauses.append('date(due_date) >= ?')
            params.append(today.isoformat())
            if sync_start_time and sync_end_time:
                clauses.append('date(created_at) BETWEEN ? AND ?')
                params.append(_as_iso_date(sync_start_time))
                params.append(_as_iso_date(sync_end_time))
        elif due_date_filter == 'no-due-date':
            clauses.append('(due_date IS NULL OR due_date = "")')

    # 年月筛选
    if year and not custom_date:
        clauses.append('strftime("%Y", date(created_at)) = ?')
        params.append(str(year))

    if month and not custom_date:
        clauses.append('strftime("%m", date(created_at)) = ?')
        params.append(str(month).zfill(2))

    return clauses, params


class TaskCrudMixin:
    """任务 CRUD。

    约定：
    - 对外方法自行管理连接（``self.tx()`` 写 / ``self.query()`` 读）
    - 以 ``_`` 开头且首参为 ``conn`` 的方法为内部构件，供其他 mixin 在同一事务内复用
    """

    # ------------------------------------------------------------------ #
    # 行映射与批量补齐
    # ------------------------------------------------------------------ #

    @staticmethod
    def _row_to_task(row: Any, tags: Optional[List[Dict[str, Any]]] = None,
                     attachments: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """把一行任务记录转换为前端使用的字典（行支持 sqlite3.Row / 下标访问）。"""
        return {
            'id': row['id'],
            'title': row['title'],
            'description': row['description'],
            'completed': bool(row['completed']),
            'priority': row['priority'],
            'categoryId': row['category_id'],
            'dueDate': row['due_date'],
            'isRecurring': bool(row['is_recurring']) if row['is_recurring'] is not None else False,
            'recurrenceType': row['recurrence_type'],
            'recurrenceInterval': row['recurrence_interval'] if row['recurrence_interval'] is not None else 1,
            'recurrenceCount': row['recurrence_count'],
            'parentTaskId': row['parent_task_id'],
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'tags': tags if tags is not None else [],
            'attachments': attachments if attachments is not None else [],
        }

    def _rows_to_tasks(self, conn: sqlite3.Connection, rows: Sequence[Any]) -> List[Dict[str, Any]]:
        """批量把任务行转成字典，并一次性补齐标签与附件（避免 N+1）。"""
        if not rows:
            return []
        task_ids = [row['id'] for row in rows]
        tags_map = self._task_tags_map(conn, task_ids)
        attachments_map = self._attachments_map(conn, task_ids)
        return [
            self._row_to_task(row, tags_map.get(row['id'], []), attachments_map.get(row['id'], []))
            for row in rows
        ]

    def _task_to_params(self, task: Task) -> Tuple[Any, ...]:
        """Task 模型 → INSERT 参数（顺序与 _TASK_COLUMNS 一致）。"""
        return (
            task.id, task.title, task.description, int(bool(task.completed)), task.priority,
            task.category_id, task.due_date.isoformat() if task.due_date else None,
            int(bool(task.is_recurring)), task.recurrence_type, task.recurrence_interval,
            task.recurrence_count, task.parent_task_id,
            task.created_at.isoformat(), task.updated_at.isoformat(),
        )

    # ------------------------------------------------------------------ #
    # 基础 CRUD
    # ------------------------------------------------------------------ #

    def add_task(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """添加新任务（任务主体与标签在同一事务内写入）"""
        task = Task(
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None,
            is_recurring=task_data.get('isRecurring', False),
            recurrence_type=task_data.get('recurrenceType'),
            recurrence_interval=task_data.get('recurrenceInterval', 1),
            recurrence_count=task_data.get('recurrenceCount'),
            parent_task_id=task_data.get('parentTaskId'),
        )

        with self.tx() as conn:
            conn.execute(_INSERT_TASK_SQL, self._task_to_params(task))
            self._replace_tags(conn, task.id, task_data.get('tags', []))
            row = conn.execute(f'{_TASK_SELECT} WHERE id = ?', (task.id,)).fetchone()
            created = self._rows_to_tasks(conn, [row]) if row else None

        return created[0] if created else task.to_dict()

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        """获取所有任务"""
        with self.query() as conn:
            rows = conn.execute(f'{_TASK_SELECT} {_TASK_ORDER_BY}').fetchall()
            return self._rows_to_tasks(conn, rows)

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取单个任务"""
        with self.query() as conn:
            row = conn.execute(f'{_TASK_SELECT} WHERE id = ?', (task_id,)).fetchone()
            tasks = self._rows_to_tasks(conn, [row]) if row else []
        return tasks[0] if tasks else None

    def update_task(self, task_id: str, task_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """部分更新任务（任务唯一更新入口）。

        仅更新 task_data 中显式传入且受支持的字段，未传入的字段保持原值，
        避免调用方传参不全时把分类、周期等字段意外清空。

        标签是否同步完全由「task_data 中是否出现 tags 键」决定：出现则整体替换，
        不出现则保持原值。因此调用方只需提交待变更字段，无需额外开关参数。

        返回更新后的完整任务（含标签 / 附件）；任务不存在时返回 None。
        """
        assignments: List[str] = []
        params: List[Any] = []
        for key, column in _TASK_FIELD_MAP.items():
            if key in task_data:
                assignments.append(f'{column} = ?')
                params.append(_normalize_task_value(column, task_data[key]))

        need_update_tags = 'tags' in task_data
        if not assignments and not need_update_tags:
            # 没有需要变更的内容，直接回读
            return self.get_task(task_id)

        with self.tx() as conn:
            if assignments:
                assignments.append('updated_at = ?')
                params.append(datetime.now().isoformat())
                params.append(task_id)
                cursor = conn.execute(
                    f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ?", params)
                if cursor.rowcount == 0:
                    return None
            if need_update_tags:
                self._replace_tags(conn, task_id, task_data['tags'] or [])

        return self.get_task(task_id)

    def delete_task(self, task_id: str, delete_all: bool = False) -> None:
        """删除任务及其全部关联数据（单事务完成）。

        delete_all 为 True 且该任务属于周期任务族时，整个任务族一起删除；
        否则只删除该任务。两种情况都会同步清理父子关联 / 标签 / 附件 / 日历事件。
        """
        with self.tx() as conn:
            task_ids = self._recurring_family_ids(conn, task_id) if delete_all else [task_id]
            self._delete_tasks(conn, task_ids)
            self._delete_orphan_tags(conn)

    def _delete_tasks(self, conn: sqlite3.Connection, task_ids: Sequence[str]) -> int:
        """在同一事务内删除任务及其关联数据（父子关联 / 标签 / 附件 / 日历事件）。

        返回删除的任务数。
        """
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return 0

        deleted = 0
        for batch in _chunks(ids):
            placeholders = _placeholders(len(batch))
            # 既清理"作为子任务"也清理"作为父任务"的关联记录
            conn.execute(
                f'DELETE FROM task_relations WHERE sub_task_id IN ({placeholders})', tuple(batch))
            conn.execute(
                f'DELETE FROM task_relations WHERE main_task_id IN ({placeholders})', tuple(batch))
            conn.execute(
                f'DELETE FROM task_tags WHERE task_id IN ({placeholders})', tuple(batch))
            conn.execute(
                f'DELETE FROM attachments WHERE task_id IN ({placeholders})', tuple(batch))
            conn.execute(
                f'DELETE FROM calendar_events WHERE task_id IN ({placeholders})', tuple(batch))
            cursor = conn.execute(
                f'DELETE FROM tasks WHERE id IN ({placeholders})', tuple(batch))
            deleted += cursor.rowcount or 0
        return deleted

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #

    def get_tasks_paginated(self, page: int = 1, page_size: int = 10,
                            category_id: Optional[str] = None, status: Optional[str] = None,
                            priority: Optional[str] = None, due_date_filter: Optional[str] = None,
                            year: Optional[int] = None, month: Optional[int] = None,
                            search_query: Optional[Union[str, Dict[str, Any]]] = None,
                            custom_date: Optional[str] = None,
                            sync_start_time: Optional[Union[str, date]] = None,
                            sync_end_time: Optional[Union[str, date]] = None,
                            custom_start_date: Optional[str] = None,
                            custom_end_date: Optional[str] = None) -> Dict[str, Any]:
        """分页查询任务，支持多种筛选条件

        参数:
            page: 页码，从1开始
            page_size: 每页数量
            category_id: 分类ID筛选
            status: 状态筛选
            priority: 优先级筛选
            due_date_filter: 日期筛选
            year: 年份筛选
            month: 月份筛选
            search_query: 搜索条件，多条件之间为 AND 语义。支持两种形式：
                结构化 dict（推荐，由前端 chips 序列化而来）:
                    {'tags': [{'id': 't1', 'name': '工作'}, '紧急'],
                     'keywords': ['报表'],
                     'parent': {'id': 'p1', 'name': '项目A'}}
                旧字符串协议（兼容）: '#标签;关键词' 或 '>父任务名'
            custom_date: 自定义日期筛选（用于日历点击）
            sync_start_time: 自定义日期筛选（数据同步开始时间）
            sync_end_time: 自定义日期筛选（数据同步结束时间）
            custom_start_date: 自定义日期筛选（数据同步开始时间）
            custom_end_date: 自定义日期筛选（数据同步结束时间）

        返回:
            包含 tasks, total, page, page_size, total_pages 的字典
        """
        where_clauses: List[str] = []
        params: List[Any] = []

        # 自定义日期筛选（优先级最高，用于日历视图点击）
        if custom_date:
            where_clauses.append('date(due_date) = ?')
            params.append(custom_date)
        if custom_start_date and custom_end_date:
            where_clauses.append('date(due_date) BETWEEN ? AND ?')
            params.append(custom_start_date)
            params.append(custom_end_date)

        # 基础筛选（分类 / 优先级 / 状态 / 日期 / 年月）
        base_clauses, base_params = _build_base_filter_clauses(
            category_id=category_id,
            status=status,
            priority=priority,
            due_date_filter=due_date_filter,
            year=year,
            month=month,
            custom_date=custom_date,
            sync_start_time=sync_start_time,
            sync_end_time=sync_end_time,
        )
        where_clauses.extend(base_clauses)
        params.extend(base_params)

        # 搜索筛选（标签 / 父任务 / 普通文本），语义由 query 解析层统一处理
        search_clauses, search_params = SearchClauseBuilder().build(
            parse_search_query(search_query))
        where_clauses.extend(search_clauses)
        params.extend(search_params)

        # 构建完整的WHERE子句
        where_sql = ' AND '.join(where_clauses) if where_clauses else '1=1'

        with self.query() as conn:
            total = conn.execute(
                f'SELECT COUNT(*) FROM tasks WHERE {where_sql}', params).fetchone()[0]
            total_pages = (total + page_size - 1) // page_size if total > 0 else 0

            offset = (page - 1) * page_size
            rows = conn.execute(
                f'{_TASK_SELECT} WHERE {where_sql} {_TASK_ORDER_BY_PAGINATED} LIMIT ? OFFSET ?',
                params + [page_size, offset]
            ).fetchall()
            tasks = self._rows_to_tasks(conn, rows)

        return {
            'tasks': tasks,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
        }

    def get_tasks_by_ids(self, task_ids: List[str]) -> List[Dict[str, Any]]:
        """
        根据任务ID列表批量获取任务完整信息（含标签 / 附件）
        :param task_ids: 任务ID列表
        :return: 任务字典列表（顺序与传入ID无关）
        """
        if not task_ids:
            return []
        ids = list({tid for tid in task_ids if tid})
        if not ids:
            return []

        tasks: List[Dict[str, Any]] = []
        with self.query() as conn:
            for batch in _chunks(ids):
                rows = conn.execute(
                    f'{_TASK_SELECT} WHERE id IN ({_placeholders(len(batch))})', tuple(batch)
                ).fetchall()
                tasks.extend(self._rows_to_tasks(conn, rows))
        return tasks

    # ------------------------------------------------------------------ #
    # 周期性任务
    # ------------------------------------------------------------------ #

    def create_recurring_tasks(self, parent_task_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """创建周期性任务系列（父任务 + 子任务在同一事务内写入）

        recurrence_count 为空表示无限循环，此时按 MAX_RECURRENCE_OCCURRENCES 截断，
        避免无限生成任务写满磁盘。
        """
        parent_task = Task(
            title=parent_task_data.get('title', ''),
            description=parent_task_data.get('description', ''),
            completed=False,
            priority=parent_task_data.get('priority', 'none'),
            category_id=parent_task_data.get('categoryId'),
            due_date=datetime.fromisoformat(parent_task_data['dueDate']) if parent_task_data.get('dueDate') else None,
            is_recurring=True,
            recurrence_type=parent_task_data.get('recurrenceType'),
            recurrence_interval=parent_task_data.get('recurrenceInterval', 1),
            recurrence_count=parent_task_data.get('recurrenceCount'),
            parent_task_id=None,
        )

        children = self._build_recurring_children(parent_task)
        all_tasks = [parent_task] + children

        with self.tx() as conn:
            conn.executemany(_INSERT_TASK_SQL, [self._task_to_params(t) for t in all_tasks])
            rows = conn.execute(
                f'{_TASK_SELECT} WHERE id IN ({_placeholders(len(all_tasks))})',
                tuple(t.id for t in all_tasks)
            ).fetchall()
            by_id = {row['id']: row for row in rows}
            ordered = [by_id[t.id] for t in all_tasks if t.id in by_id]
            return self._rows_to_tasks(conn, ordered)

    @staticmethod
    def _build_recurring_children(parent_task: Task) -> List[Task]:
        """按周期规则生成子任务列表（不含父任务本身）。"""
        step = _RECURRENCE_STEPS.get(parent_task.recurrence_type or '')
        if not step or parent_task.due_date is None:
            return []

        try:
            interval = max(1, int(parent_task.recurrence_interval or 1))
        except (TypeError, ValueError):
            interval = 1

        # recurrence_count 表示任务总数（含父任务）；为空时按上限截断
        try:
            total = int(parent_task.recurrence_count) if parent_task.recurrence_count else MAX_RECURRENCE_OCCURRENCES
        except (TypeError, ValueError):
            total = MAX_RECURRENCE_OCCURRENCES
        total = max(1, min(total, MAX_RECURRENCE_OCCURRENCES))

        children: List[Task] = []
        current_date = parent_task.due_date
        while len(children) + 1 < total:
            current_date = current_date + step(interval)
            children.append(Task(
                title=parent_task.title,
                description=parent_task.description,
                completed=False,
                priority=parent_task.priority,
                category_id=parent_task.category_id,
                due_date=current_date,
                is_recurring=False,
                parent_task_id=parent_task.id,
            ))
        return children

    def _recurring_family_ids(self, conn: sqlite3.Connection, task_id: str) -> List[str]:
        """在同一事务内取出周期任务族（父任务 + 全部子任务）的 id。

        非周期任务或任务不存在时返回 ``[task_id]``，因此调用方无需再自行判断类型。
        """
        row = conn.execute('SELECT parent_task_id FROM tasks WHERE id = ?', (task_id,)).fetchone()
        if not row:
            return [task_id]
        # 自身是子任务时以父任务为根，否则以自身为根
        root_id = row['parent_task_id'] or task_id
        rows = conn.execute(
            'SELECT id FROM tasks WHERE id = ? OR parent_task_id = ?', (root_id, root_id)
        ).fetchall()
        return [r['id'] for r in rows]

    def get_recurring_family_ids(self, task_id: str) -> List[str]:
        """获取周期性任务族（父任务 + 全部子任务）的ID列表（非周期任务返回 [task_id]）"""
        with self.query() as conn:
            return self._recurring_family_ids(conn, task_id)

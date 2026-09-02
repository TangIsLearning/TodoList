# backend/api/mixins/task_relation_mixin.py
from typing import Any, Dict, List, Optional
from backend.utils.response_wrapper import api_handler

class TaskRelationMixin:
    """任务关联核心操作 Mixin"""

    @api_handler
    def get_children(self, task_id: str) -> List[Optional[Dict[str, Any]]]:
        """获取指定任务的直接子任务列表（完整任务信息）"""
        return self.db.get_children(task_id)

    @api_handler
    def get_parent(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取指定任务的父任务（完整任务信息）"""
        return self.db.get_parent(task_id)

    @api_handler
    def add_task_relation(self, sub_task_id: str, main_task_id: str) -> None:
        """为单个子任务设置父任务（若已存在则更新）"""
        sub = self.db.get_task(sub_task_id)
        if not sub:
            raise Exception(f'子任务不存在')
        main = self.db.get_task(main_task_id)
        if not main:
            raise Exception(f'父任务不存在')
        if sub_task_id == main_task_id:
            raise Exception(f'不能将自己设为父任务')
        if sub.get('isRecurring'):
            raise Exception(f'周期性任务不允许添加父任务关联')
        self.db.add_task_relation(sub_task_id, main_task_id)

    @api_handler
    def remove_task_relation(self, sub_task_id: str) -> None:
        """移除单个子任务的父任务关联"""
        sub = self.db.get_task(sub_task_id)
        if not sub:
            raise Exception(f'子任务不存在')
        self.db.delete_relation_by_children(sub_task_id)

    @api_handler
    def search_subtasks_by_parent_name(self, parent_name: str, page: int = 1, page_size: int = 10,
                                       category_id: Optional[str] = None, status: Optional[str] = None,
                                       priority: Optional[str] = None,
                                       due_date_filter: Optional[str] = None) -> Dict[str, Any]:
        """通过父任务名称搜索其子任务（要求父任务名称完全匹配），并按当前筛选条件过滤。

        筛选参数与 get_todos 语义一致（参考 operations.get_tasks_paginated）：
        - category_id: 'all'|'uncategorized'|<具体分类ID>|None
        - status: all|completed|uncompleted|pending|overdue
        - priority: all|high|medium|low|none
        - due_date_filter: all|today|tomorrow|week|month|no-due-date
        """
        from datetime import date, datetime, timedelta
        # 先查找父任务
        parent_task = self.db.find_task_by_title_exact(parent_name)
        if not parent_task:
            return {'tasks': [], 'total': 0, 'page': page, 'page_size': page_size, 'total_pages': 0}

        # 获取该父任务的子任务
        children = self.db.get_children(parent_task['id'])

        # 应用筛选条件（与 get_tasks_paginated 语义对齐）
        def _iso_date(val: Any) -> Optional[date]:
            if not val:
                return None
            try:
                return datetime.fromisoformat(str(val)).date()
            except Exception:
                return None

        today = datetime.now().date()

        def _pending_overdue(task: Dict[str, Any]) -> Dict[str, bool]:
            d = _iso_date(task.get('dueDate'))
            if task.get('completed'):
                return {'pending': False, 'overdue': False}
            return {
                'pending': d is None or d >= today,
                'overdue': d is not None and d < today,
            }

        # 计算日期区间
        def _tomorrow() -> date:
            if today.day < 28:
                return today.replace(day=today.day + 1)
            if today.month < 12:
                return today.replace(day=1, month=today.month + 1)
            return today.replace(year=today.year + 1, month=1, day=1)

        week_start = today - timedelta(days=today.weekday())
        week_end_candidate = week_start + timedelta(days=7)
        week_end = week_end_candidate if today.day <= 21 else today.replace(day=28)
        month_start = today.replace(month=today.month, day=1)
        if today.month == 12:
            next_month = today.replace(year=today.year + 1, month=1, day=1)
        else:
            next_month = month_start.replace(month=month_start.month + 1)
        month_end = next_month - timedelta(days=1)

        norm_status = status if status not in (None, 'all', '') else None
        norm_priority = priority if priority not in (None, 'all', '') else None
        norm_cat = category_id if category_id not in (None, 'all', '') else None
        norm_dd = due_date_filter if due_date_filter not in (None, 'all', '') else None

        filtered = []
        for t in children:
            # 状态筛选
            if norm_status:
                if norm_status == 'completed' and not t.get('completed'):
                    continue
                if norm_status == 'uncompleted' and t.get('completed'):
                    continue
                po = _pending_overdue(t)
                if norm_status == 'pending' and not po['pending']:
                    continue
                if norm_status == 'overdue' and not po['overdue']:
                    continue
            # 优先级筛选
            if norm_priority and (t.get('priority') or 'none') != norm_priority:
                continue
            # 分类筛选
            if norm_cat:
                cid = t.get('categoryId')
                if norm_cat == 'uncategorized':
                    if cid not in (None, ''):
                        continue
                elif cid != norm_cat:
                    continue
            # 日期筛选
            if norm_dd:
                d = _iso_date(t.get('dueDate'))
                if norm_dd == 'today':
                    if d != today:
                        continue
                elif norm_dd == 'tomorrow':
                    if d != _tomorrow():
                        continue
                elif norm_dd == 'week':
                    if d is None or not (week_start <= d < week_end):
                        continue
                elif norm_dd == 'month':
                    if d is None or not (month_start <= d <= month_end):
                        continue
                elif norm_dd == 'no-due-date':
                    if d is not None:
                        continue
            filtered.append(t)

        # 分页处理
        total = len(filtered)
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_children = filtered[start_idx:end_idx]

        return {
            'tasks': paginated_children,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
            'parent_task': {'id': parent_task['id'], 'title': parent_task['title']}
        }

    @api_handler
    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> Any:
        """搜索具有子任务的父任务（按标题模糊匹配），返回前 limit 条。

        供前端在搜索框输入 ">" 时调用，下拉展示有子任务的父任务建议。
        返回: {'success': True, 'tasks': [{id, title, priority, dueDate, completed, subtaskCount}, ...]}
        """
        return self.db.search_tasks_with_subtasks(keyword=keyword or '', limit=limit)
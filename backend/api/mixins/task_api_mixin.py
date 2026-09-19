# backend/api/mixins/task_api_mixin.py
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Union
from backend.features.recurrence import (
    END_COUNT,
    MODE_CRON,
    PREVIEW_OCCURRENCE_LIMIT,
    normalize_rule,
    preview_occurrences,
    validate_rule,
)
from backend.utils.response_wrapper import api_handler


def _parse_start_date(value: Any) -> Optional[date]:
    """解析周期起始日期（只取日期部分，时间由规则决定）。"""
    if not value:
        return None
    text = str(value).strip()
    if 'T' in text:
        text = text.split('T')[0]
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def validate_due_date(task_data: Union[Dict[str, Any], str]) -> Dict[str, Union[bool, str]]:
    """校验截止时间（完全拷贝原方法）"""
    if isinstance(task_data, dict):
        due_date_str = task_data.get('dueDate')
        if not due_date_str:
            return {'valid': True, 'message': ''}
    else:
        due_date_str = task_data

    if not due_date_str:
        return {'valid': True, 'message': ''}

    try:
        due_date = datetime.fromisoformat(due_date_str)
        now = datetime.now()
        if due_date < now:
            return {'valid': False, 'message': '截止时间不能早于当前时间'}
        return {'valid': True, 'message': ''}
    except ValueError:
        return { 'valid': False, 'message': '截止时间格式无效'}


def normalize_due_date(due_date: Optional[str]) -> Union[datetime, Optional[str]]:
    """将截止时间统一解析为时间对象，便于比较；无法解析时返回原值"""
    if not due_date:
        return None
    try:
        return datetime.fromisoformat(due_date)
    except (ValueError, TypeError):
        return due_date

class TaskApiMixin:
    """任务核心操作 Mixin"""

    @api_handler
    def add_todo(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """添加新任务"""
        validation_result = validate_due_date(task_data)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')

        if task_data['dueDate'] and self.is_android:
            target_time = datetime.fromisoformat(task_data['dueDate']).timestamp() * 1000
            self.service.add_task_reminder_to_calendar(task_data['title'], task_data['description'], target_time)
        task = self.db.add_task(task_data)
        # 处理附件（实体文件会被复制到存储目录）
        self.sync_task_attachments(task.get('id'), task_data.get('attachments'))
        return task

    @api_handler
    def get_todos(self, page: int = 1, page_size: int = 10,
                  category_id: Optional[str] = None, status: Optional[str] = None,
                  priority: Optional[str] = None, due_date_filter: Optional[str] = None,
                  year: Optional[int] = None, month: Optional[int] = None,
                  search_query: Optional[Union[str, Dict[str, Any]]] = None,
                  custom_date: Optional[str] = None,
                  custom_start_date: Optional[str] = None,
                  custom_end_date: Optional[str] = None) -> Dict[str, Any]:
        """分页获取任务，支持多种筛选条件。

        search_query 为搜索条件，标签 / 父任务 / 普通文本三种语义由
        backend.database.query 解析层统一处理，多条件之间为 AND：
            结构化（推荐）: {'tags': [{'id','name'}], 'keywords': [...],
                            'parent': {'id','name'}, 'anyTag': True}
            字符串（兼容）: '#标签;关键词' / '>父任务名' / '#'
        """
        return self.db.get_tasks_paginated(
            page=page,
            page_size=page_size,
            category_id=category_id,
            status=status,
            priority=priority,
            due_date_filter=due_date_filter,
            year=year,
            month=month,
            search_query=search_query,
            custom_date=custom_date,
            custom_start_date=custom_start_date,
            custom_end_date=custom_end_date
        )

    @api_handler
    def get_task_page(self, task_id: str, page_size: int = 10,
                      category_id: Optional[str] = None, status: Optional[str] = None,
                      priority: Optional[str] = None, due_date_filter: Optional[str] = None,
                      year: Optional[int] = None, month: Optional[int] = None,
                      search_query: Optional[Union[str, Dict[str, Any]]] = None,
                      custom_date: Optional[str] = None,
                      custom_start_date: Optional[str] = None,
                      custom_end_date: Optional[str] = None) -> Optional[int]:
        """定位任务在当前筛选条件下的页码（从1开始）。

        用于快捷键等外部入口新建任务后，把主窗口列表自动翻到新任务所在页；
        任务被当前筛选条件排除时返回 None。
        """
        return self.db.get_task_page(
            task_id=task_id,
            page_size=page_size,
            category_id=category_id,
            status=status,
            priority=priority,
            due_date_filter=due_date_filter,
            year=year,
            month=month,
            search_query=search_query,
            custom_date=custom_date,
            custom_start_date=custom_start_date,
            custom_end_date=custom_end_date
        )

    @api_handler
    def get_todo(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取单个任务"""
        return self.db.get_task(task_id)

    def _refresh_due_date_reminder(self, task_id: str, old_task: Optional[Dict[str, Any]],
                                   new_due_date: Optional[str]) -> None:
        """截止时间发生变化时刷新到期提醒，避免到期后不再提醒

        桌面端：清除已提醒标记，使其在新的截止时间再次弹窗；
        移动端：同步调整系统日历中的提醒时间。
        """
        old_due_date = (old_task or {}).get('dueDate')
        # 统一按时间对象比较，避免「10:30」与「10:30:00」这类格式差异导致误判
        if normalize_due_date(old_due_date) == normalize_due_date(new_due_date):
            return
        try:
            self.service.refresh_task_reminder(task_id, new_due_date, old_due_date)
        except Exception as e:
            self.get_logger.error(f"刷新任务到期提醒失败: {e}")

    @api_handler
    def update_todo(self, task_id: str, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新任务"""
        validation_result = validate_due_date(task_data)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')
        old_task = self.db.get_task(task_id)
        result = self.db.update_task(task_id, task_data)
        # 同步附件（新增/修改/删除）
        self.sync_task_attachments(task_id, task_data.get('attachments'))
        # 截止时间变更后刷新提醒，确保新截止时间到期时能弹窗
        self._refresh_due_date_reminder(task_id, old_task, task_data.get('dueDate'))
        return result

    @api_handler
    def update_todo_due_date(self, task_id: str, due_date: str) -> Dict[str, Any]:
        """更新任务"""
        validation_result = validate_due_date(due_date)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')
        old_task = self.db.get_task(task_id)
        result = self.db.update_task(task_id, {'dueDate': due_date})
        self._refresh_due_date_reminder(task_id, old_task, due_date)
        return result

    @api_handler
    def delete_todo(self, task_id: str, delete_all: bool = False) -> None:
        """删除任务"""
        # 用户确认删除后，先清理附件记录与实体文件
        try:
            if delete_all:
                for tid in self.db.get_recurring_family_ids(task_id):
                    self.cleanup_task_attachments(tid)
            else:
                self.cleanup_task_attachments(task_id)
        except Exception as e:
            self.get_logger.error(f"清理任务附件失败: {e}")

        self.db.delete_task(task_id, delete_all)

    @api_handler
    def add_recurring_todo(self, task_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """添加周期性任务

        周期由 ``recurrenceRule`` 描述（普通模式：每天 / 每周 / 每月 / 每年；Cron 模式）。
        传入的 ``dueDate`` 只取日期部分作为周期起始日，具体提醒时间点由规则决定。
        """
        rule = normalize_rule(task_data.get('recurrenceRule'))

        # 周期起始日期：只需校验日期不早于今天（时间点由规则决定，可能已早于当前时刻）
        start_date = _parse_start_date(task_data.get('dueDate'))
        if start_date is None:
            raise Exception('周期性任务必须设置起始日期')
        if start_date < datetime.now().date():
            raise Exception('周期起始日期不能早于今天')

        ok, message = validate_rule(rule)
        if not ok:
            raise Exception(message)

        # recurrence_type / count 为兼容旧数据与列表展示保留的摘要字段
        task_data['recurrenceType'] = MODE_CRON if rule.get('mode') == MODE_CRON else rule.get('freq')
        task_data['recurrenceCount'] = (
            rule.get('count') if rule.get('endType') == END_COUNT else None)

        result = self.db.create_recurring_tasks(task_data)
        for task in result:
            if task.get('dueDate') and self.is_android:
                target_time = datetime.fromisoformat(task['dueDate']).timestamp() * 1000
                self.service.add_task_reminder_to_calendar(task['title'], task['description'], target_time)
        # 附件挂在周期性任务的父任务上
        if result:
            self.sync_task_attachments(result[0].get('id'), task_data.get('attachments'))
        return result

    @api_handler
    def preview_recurring_occurrences(self, start_date: str, recurrence_rule: Dict[str, Any],
                                      limit: int = PREVIEW_OCCURRENCE_LIMIT) -> List[str]:
        """预览周期性任务接下来会产生的提醒时间（ISO 字符串列表，升序）

        用于在保存前把规则的实际效果展示给用户。
        """
        parsed_start = _parse_start_date(start_date)
        if parsed_start is None:
            raise Exception('请先选择周期起始日期')

        rule = normalize_rule(recurrence_rule)
        ok, message = validate_rule(rule)
        if not ok:
            raise Exception(message)

        return preview_occurrences(parsed_start, rule, limit=limit)

    @api_handler
    def toggle_todo(self, task_id: str) -> Dict[str, Any]:
        """切换任务完成状态

        习惯类周期任务在「标记完成」时按规则续建下一条待办，
        保证同一时刻只有一条未完成实例。
        """
        task = self.db.get_task(task_id)
        if not task:
            raise Exception(f'Task not found')
        # 只提交变更字段：避免回灌整份任务（含 tags）触发无必要的标签重写
        result = self.db.update_task(task_id, {'completed': not task['completed']})
        # 由未完成 -> 完成时才续建；重新开启不产生新任务
        if not task['completed']:
            self.db.create_next_habit_task(task_id)
        return result

    @api_handler
    def get_stats(self) -> Dict[str, Any]:
        """任务统计"""
        tasks = self.db.get_all_tasks()
        now = datetime.now()

        # 总未完成
        total_tasks = len(tasks)
        completed_tasks = sum(1 for task in tasks if task['completed'])
        uncompleted_tasks = total_tasks - completed_tasks

        # 今日已完成
        today_completed_tasks = sum([1 for task in tasks if task['completed'] and task['updatedAt'] and
                          datetime.fromisoformat(task['updatedAt']).date() == now.date()])
        # 已逾期
        over_due_tasks = sum([1 for task in tasks if not task['completed'] and task['dueDate'] and
                          datetime.fromisoformat(task['dueDate']) < now])

        return {
            'uncompleted': uncompleted_tasks,
            'today_completed': today_completed_tasks,
            'over_due': over_due_tasks,
            'completion_rate': round((completed_tasks / total_tasks * 100) if total_tasks > 0 else 0, 1)
        }
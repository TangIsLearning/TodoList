# backend/api/mixins/task_api_mixin.py
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
from backend.utils.response_wrapper import api_handler


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
                  search_query: Optional[str] = None, custom_date: Optional[str] = None,
                  custom_start_date: Optional[str] = None,
                  custom_end_date: Optional[str] = None) -> Dict[str, Any]:
        """分页获取任务，支持多种筛选条件"""
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
    def get_todo(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取单个任务"""
        return self.db.get_task(task_id)

    @api_handler
    def update_todo(self, task_id: str, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新任务"""
        validation_result = validate_due_date(task_data)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')
        result = self.db.update_task(task_id, task_data)
        # 同步附件（新增/修改/删除）
        self.sync_task_attachments(task_id, task_data.get('attachments'))
        return result

    @api_handler
    def update_todo_due_date(self, task_id: str, due_date: str) -> Dict[str, Any]:
        """更新任务"""
        validation_result = validate_due_date(due_date)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')
        return self.db.update_task_due_date(task_id, due_date)

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

        task = self.db.get_task(task_id)
        if task and (task.get('isRecurring') or task.get('parentTaskId')): # 检查是否为周期性任务
            self.db.delete_recurring_task(task_id, delete_all)
        else:
            self.db.delete_task(task_id)

    @api_handler
    def add_recurring_todo(self, task_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """添加周期性任务"""
        validation_result = validate_due_date(task_data)
        if not validation_result['valid']:
            raise Exception(f'{validation_result["message"]}')

        # 校验周期性任务参数
        if task_data.get('isRecurring'):
            if not task_data.get('recurrenceType'):
                raise Exception(f'周期类型不能为空')
            if not task_data.get('dueDate'):
                raise Exception(f'周期性任务必须设置截止时间')

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
    def toggle_todo(self, task_id: str) -> Dict[str, Any]:
        """切换任务完成状态"""
        task = self.db.get_task(task_id)
        if not task:
            raise Exception(f'Task not found')
        task['completed'] = not task['completed']
        return self.db.update_task(task_id, task, False)

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
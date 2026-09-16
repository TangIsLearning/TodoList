# backend/api/mixins/task_relation_api_mixin.py
from typing import Any, Dict, List, Optional
from backend.utils.response_wrapper import api_handler

class TaskRelationApiMixin:
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
    def get_parents_map(self, task_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """批量获取多个任务的父任务（列表页"关联父项任务"列使用）。

        :param task_ids: 任务ID列表
        :return: {子任务ID: {'id': 父任务ID, 'title': 父任务标题}}，无父任务的任务不出现在结果中
        """
        return self.db.get_parents_map(task_ids)

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
    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> Any:
        """搜索具有子任务的父任务（按标题模糊匹配），返回前 limit 条。

        供前端在搜索框输入 ">" 时调用，下拉展示有子任务的父任务建议。
        返回: {'success': True, 'tasks': [{id, title, priority, dueDate, completed, subtaskCount}, ...]}
        """
        return self.db.search_tasks_with_subtasks(keyword=keyword or '', limit=limit)
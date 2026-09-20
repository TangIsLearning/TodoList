# backend/api/mixins/task_relation_api_mixin.py
from typing import Any, Dict, List, Optional
from backend.utils.response_wrapper import api_handler
from backend.utils.api_errors import NotFoundError, ValidationError

class TaskRelationApiMixin:
    """任务关联核心操作 Mixin"""

    @api_handler
    def get_children(self, task_id: str) -> List[Dict[str, Any]]:
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

    def _validate_parent_change(self, sub_task_id: str,
                                main_task_id: Optional[str]) -> None:
        """校验一次父子关联变更是否合法（设置与解除两条路径共用同一份规则）。

        main_task_id 为空表示解除关联，此时只需要确认子任务本身存在。
        """
        sub = self.db.get_task(sub_task_id)
        if not sub:
            raise NotFoundError('子任务不存在')
        if not main_task_id:
            return
        main = self.db.get_task(main_task_id)
        if not main:
            raise NotFoundError('父任务不存在')
        if sub_task_id == main_task_id:
            raise ValidationError('不能将自己设为父任务')
        if sub.get('isRecurring'):
            raise ValidationError('周期性任务不允许添加父任务关联')

    @api_handler
    def set_task_parent(self, sub_task_id: str, main_task_id: Optional[str] = None) -> None:
        """设置 / 解除子任务的父任务（main_task_id 为空表示解除），在同一事务内完成。

        这是父子关联唯一的写入入口：相比前端分两次调用 remove + add，单事务可避免
        中途失败导致子任务丢失父任务（表现为按父任务名称/ID 搜索时查不到该子任务）。
        """
        self._validate_parent_change(sub_task_id, main_task_id)
        self.db.set_task_parent(sub_task_id, main_task_id)

    @api_handler
    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> Any:
        """搜索具有子任务的父任务（按标题模糊匹配），返回前 limit 条。

        供前端在搜索框输入 ">" 时调用，下拉展示有子任务的父任务建议。
        返回: {'success': True, 'tasks': [{id, title, priority, dueDate, completed, subtaskCount}, ...]}
        """
        return self.db.search_tasks_with_subtasks(keyword=keyword or '', limit=limit)
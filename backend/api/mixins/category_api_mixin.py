# backend/api/mixins/category_api_mixin.py
from typing import Any, Dict, List, Tuple
from backend.utils.response_wrapper import api_handler
from backend.utils.auto_sync import auto_sync

class CategoryApiMixin:
    """分类核心操作 Mixin"""

    @api_handler
    @auto_sync
    def add_category(self, category_data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        """添加新分类"""
        result = self.db.add_category(category_data)
        return result, "分类添加成功"

    @api_handler
    def get_categories(self) -> List[Dict[str, Any]]:
        """获取所有分类"""
        return self.db.get_all_categories()

    @api_handler
    def get_category_task_counts(self) -> Dict[str, Any]:
        """按分类统计未完成任务数（左侧分类计数）。

        替代此前「前端拉全量任务后自行遍历」的做法，返回体只有计数，
        见 CategoryCrudMixin.get_category_task_counts 的口径说明。
        """
        return self.db.get_category_task_counts()

    @api_handler
    @auto_sync
    def delete_category(self, category_id: str) -> None:
        """删除分类"""
        self.db.delete_category(category_id)

    @api_handler
    @auto_sync
    def update_category(self, category_id: str, category_data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        """更新分类"""
        result = self.db.update_category(category_id, category_data)
        return result, "分类更新成功"
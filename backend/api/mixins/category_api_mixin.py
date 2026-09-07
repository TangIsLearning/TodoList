# backend/api/mixins/category_api_mixin.py
from typing import Any, Dict, List, Tuple
from backend.utils.response_wrapper import api_handler

class CategoryApiMixin:
    """分类核心操作 Mixin"""

    @api_handler
    def add_category(self, category_data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        """添加新分类"""
        result = self.db.add_category(category_data)
        return result, "分类添加成功"

    @api_handler
    def get_categories(self) -> List[Dict[str, Any]]:
        """获取所有分类"""
        return self.db.get_all_categories()

    @api_handler
    def delete_category(self, category_id: str) -> None:
        """删除分类"""
        self.db.delete_category(category_id)

    @api_handler
    def update_category(self, category_id: str, category_data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        """更新分类"""
        result = self.db.update_category(category_id, category_data)
        return result, "分类更新成功"
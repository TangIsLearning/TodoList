# backend/api/mixins/tag_mixin.py
from typing import Any, Dict, List
from backend.utils.response_wrapper import api_handler

class TagMixin:
    """标签核心操作 Mixin"""

    @api_handler
    def get_all_tags(self) -> List[Dict[str, Any]]:
        """获取所有标签"""
        return self.db.get_all_tags()

    @api_handler
    def delete_tag(self, tag_id: str) -> None:
        """删除标签"""
        self.db.delete_tag(tag_id)
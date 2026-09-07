# backend/database/mixins/__init__.py
"""
Crud Mixins 集合
统一导出所有功能混入类，供 TodoDatabase 组合使用
"""

from .task_crud_mixin import TaskCrudMixin
from .category_crud_mixin import CategoryCrudMixin
from .tag_crud_mixin import TagCrudMixin
from .task_relation_crud_mixin import TaskRelationCrudMixin
from .setting_crud_mixin import SettingCrudMixin

# 定义一个组合所有 Crud 能力的基类（空类，仅用于继承）
class AllCrudMixins(
    TaskCrudMixin,
    CategoryCrudMixin,
    TagCrudMixin,
    TaskRelationCrudMixin,
    SettingCrudMixin
):
    """聚合所有 Crud 功能 Mixin，便于 TodoDatabase 单一继承"""
    pass

__all__ = [
    'TaskCrudMixin',
    'CategoryCrudMixin',
    'TagCrudMixin',
    'TaskRelationCrudMixin',
    'SettingCrudMixin',
    'AllCrudMixins'
]
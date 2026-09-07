# backend/api/mixins/__init__.py
"""
API Mixins 集合
统一导出所有功能混入类，供 TodoApi 组合使用
"""

from .category_api_mixin import CategoryApiMixin
from .config_api_mixin import ConfigApiMixin
from .datafile_api_mixin import DatafileApiMixin
from .p2p_api_mixin import P2PApiMixin
from .tag_api_mixin import TagApiMixin
from .task_api_mixin import TaskApiMixin
from .task_relation_api_mixin import TaskRelationApiMixin
from .utility_api_mixin import UtilityApiMixin
from .webdav_api_mixin import WebDavApiMixin

# 定义一个组合所有 API 能力的基类（空类，仅用于继承）
class AllApiMixins(
    CategoryApiMixin,
    ConfigApiMixin,
    DatafileApiMixin,
    P2PApiMixin,
    TagApiMixin,
    TaskApiMixin,
    TaskRelationApiMixin,
    UtilityApiMixin,
    WebDavApiMixin
):
    """聚合所有 API 功能 Mixin，便于 TodoApi 单一继承"""
    pass

# 控制 from backend.api.mixins import * 的行为
__all__ = [
    'CategoryApiMixin',
    'ConfigApiMixin',
    'DatafileApiMixin',
    'P2PApiMixin',
    'TagApiMixin',
    'TaskApiMixin',
    'TaskRelationApiMixin',
    'UtilityApiMixin',
    'WebDavApiMixin',
    'AllApiMixins'
]
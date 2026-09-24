"""存储目录的候选位置推断。

「用户没指明存哪儿时该往哪儿放」完全由平台决定，规则属于平台能力
（PlatformService 的路径方法），这里只做薄薄一层转发，把存储层的用词
（存储根、旧库、兜底库）映射到平台接口上。
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from backend.platforms.core.factory import get_platform_service


def get_fallback_data_file() -> Path:
    """配置项完全不可用时的兜底数据文件位置"""
    return Path(get_platform_service().get_fallback_data_file())


def get_default_storage_dir() -> Path:
    """用户尚未配置时使用的默认存储根目录"""
    return Path(get_platform_service().get_default_storage_dir())


def get_legacy_default_data_file() -> Optional[Path]:
    """旧版本默认的数据文件位置（存在则返回，用于迁移到新布局）"""
    for candidate in get_platform_service().get_legacy_data_files():
        candidate = Path(candidate)
        if candidate.exists():
            return candidate
    return None


__all__ = [
    'get_fallback_data_file',
    'get_default_storage_dir',
    'get_legacy_default_data_file',
]
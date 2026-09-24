#!/usr/bin/env python3
"""
工具类模块
"""
from __future__ import annotations

import re
import sys
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from backend import APP_ROOT

if TYPE_CHECKING:
    from backend.platforms.interface.service import PlatformService

# 平台目录下统一使用的应用名子目录
APP_DIR_NAME = 'TodoList'

def ensure_dir(path: Path) -> Path:
    """创建目录（已存在则跳过）"""
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    return path

def first_writable_dir(*paths: Optional[Path]) -> Optional[Path]:
    """按优先级创建并校验可写性，返回第一个成功者；全部失败返回 None

    平台实现用它逐级降级：候选目录可能因为权限（Android 跨包名）、只读挂载点
    （AppImage）或目录不存在而不可用，逐个试到能用的为止。
    """
    for path in paths:
        if path is None:
            continue
        try:
            candidate = Path(path)
            if not candidate.is_absolute():
                continue
            candidate.mkdir(parents=True, exist_ok=True)
            if os.access(str(candidate), os.W_OK):
                return candidate
        except Exception:
            continue
    return None

# 自定义强调色令牌：结构需与前端 js/utils/theme-colors.js 保持一致
ACCENT_COLOR_KEYS = (
    'primary', 'success', 'warning', 'danger', 'info',
    'priorityHigh', 'priorityMedium', 'priorityLow', 'priorityNone'
)
_HEX_COLOR_PATTERN = re.compile(r'^#[0-9a-fA-F]{6}$')

def normalize_accent_colors(value: Any) -> Optional[Dict[str, Any]]:
    """校验并规整自定义强调色配置，非法输入直接抛错以在写库前拦截。

    期望结构（深浅各一套，详见前端 theme-colors.js）：
        {
            "version": 1,
            "linkPriority": true,
            "baseTheme": "light",          # 自定义模式的基底：light / dark
            "light": {"primary": "#007bff", ...},
            "dark":  {"primary": "#007bff", ...}
        }
    传 None 表示清除自定义配色、回到出厂值。
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('自定义配色必须为对象')

    link_priority = value.get('linkPriority', True)
    if not isinstance(link_priority, bool):
        raise ValueError('linkPriority 必须为布尔值')

    base_theme = value.get('baseTheme', 'light')
    if base_theme not in ('light', 'dark'):
        raise ValueError('baseTheme 只能是 light 或 dark')

    result: Dict[str, Any] = {
        'version': int(value.get('version') or 1),
        'linkPriority': link_priority,
        'baseTheme': base_theme,
    }
    for mode in ('light', 'dark'):
        source = value.get(mode) or {}
        if not isinstance(source, dict):
            raise ValueError(f'{mode} 配色必须为对象')
        palette: Dict[str, str] = {}
        for key in ACCENT_COLOR_KEYS:
            color = source.get(key)
            if not isinstance(color, str) or not _HEX_COLOR_PATTERN.match(color.strip()):
                raise ValueError(f'{mode}.{key} 颜色格式非法（应为 #RRGGBB）')
            palette[key] = color.strip().lower()
        result[mode] = palette
    return result

def get_app_icon() -> str:
    """获取应用图标路径"""
    from backend.platforms.core.factory import get_platform_service

    service = get_platform_service()
    # 资源根目录由平台决定：打包后是 _MEIPASS 解压目录，开发态是项目根
    return str(service.get_app_icon(service.get_code_dir()))

def str_to_bool(value: str) -> bool:
    """字符串(布尔值)转换"""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return bool(value)  # 兜底转换

def get_app_path(platform_service: PlatformService) -> str:
    """获取应用可执行文件路径"""
    try:
        if getattr(sys, 'frozen', False):
            # Linux：优先获取真正的 AppImage 磁盘文件路径，防止指向临时挂载目录 ---
            app_path = os.environ.get('APPIMAGE')
            if not app_path:
                # 如果不是通过 AppImage 启动，则回退使用默认的 PyInstaller 路径
                app_path = sys.executable
            return app_path
        else:
            # 开发环境：main.py 位于应用根
            app_path = str(APP_ROOT / 'main.py')
            return app_path
    except Exception as e:
        platform_service.backend_logger().error(f"获取应用路径失败: {e}")
        raise

def get_launch_command(platform_service: PlatformService) -> str:
    """获取启动命令"""
    try:
        base_command = ''
        app_path = get_app_path(platform_service)
        if app_path.endswith('.py'):
            # Python脚本
            command = f'{base_command}"{sys.executable}" "{app_path}"'
        else:
            # 可执行文件
            command = f'{base_command}"{app_path}"'

        platform_service.backend_logger().info(f"生成启动命令: {command}")
        return command
    except Exception as e:
        platform_service.backend_logger().error(f"生成启动命令失败: {e}")
        raise
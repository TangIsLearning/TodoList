#!/usr/bin/env python3
"""
工具类模块
"""
from __future__ import annotations

import re
import sys
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from backend.platforms.interface.service import PlatformService

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
    # 判断是否为 PyInstaller 打包后的可执行文件
    if getattr(sys, 'frozen', False):
        # 打包后所有附加数据都会被解压到 sys._MEIPASS 临时目录
        base_path = Path(sys._MEIPASS)
        # --- 核心新增：如果 PyInstaller 将资源归类到了 _internal 目录，则自动追加该路径 ---
        if (base_path / '_internal').exists():
            base_path = base_path / '_internal'
    else:
        # 源码运行时，沿用你原来的相对路径查找逻辑（向上三级目录）
        base_path = Path(__file__).resolve().parent.parent.parent

    from backend.platforms.core.factory import get_platform_service
    service = get_platform_service()
    return service.get_app_icon(base_path)

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
            # 开发环境
            project_root = Path(__file__).parent.parent
            app_path = str(project_root / 'main.py')
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
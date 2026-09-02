#!/usr/bin/env python3
"""
工具类模块
"""
from __future__ import annotations

import sys
import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.platforms.interface.service import PlatformService

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
#!/usr/bin/env python3
"""
工具类模块
"""
import os

def get_app_icon():
    """获取应用图标路径"""
    from pathlib import Path
    # 尝试找到应用图标
    icon_paths = [
        Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "todo_icon.ico"),
        Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "asset", "todo_icon.ico")
    ]

    for path in icon_paths:
        if path.exists() and path.is_file():
            return path
    return None
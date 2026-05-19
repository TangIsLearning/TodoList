#!/usr/bin/env python3
"""
工具类模块
"""
import os
import sys

def get_app_icon():
    """获取应用图标路径"""
    from pathlib import Path
    # 尝试找到应用图标
    if sys.platform == 'darwin':
        return Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "todo_icon.icns")
    else:
        return Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "todo_icon.ico")
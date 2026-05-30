#!/usr/bin/env python3
"""
工具类模块
"""
import sys
from pathlib import Path

def get_app_icon():
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

    if sys.platform == 'darwin':
        return base_path / 'todo_icon.icns'
    elif sys.platform == 'win32':
        return base_path / 'todo_icon.ico'
    else:
        return base_path / 'todo_icon.png'
"""存储目录的候选位置推断。

「用户没指明存哪儿时该往哪儿放」完全由平台决定：Android 只能在应用私有目录里挑，
打包成 AppImage 后安装目录只读、必须落到用户目录，开发态则直接用项目根。
这里把这些平台差异收敛住，让上层只需认一个候选目录。
"""

from __future__ import annotations

import os
import platform
import sys
from pathlib import Path
from typing import Optional

from backend.config import (
    ANDROID_EXTERNAL_DIR,
    ANDROID_PRIMARY_DATA_DIR,
    ANDROID_PRIMARY_USR_DIR,
)
from backend.platforms.detection import is_android
from backend.storage.layout import DB_FILE_NAME

# 项目根目录（<project>/backend/storage/paths.py 往上三级）
_PROJECT_ROOT = Path(__file__).parent.parent.parent

# 连配置都读不出来时的兜底库位置：沿用旧版布局 <项目根>/data/todo.db
_FALLBACK_DATA_FILE = _PROJECT_ROOT / 'data' / DB_FILE_NAME


def get_fallback_data_file() -> Path:
    """配置项完全不可用时的兜底数据文件位置"""
    return _FALLBACK_DATA_FILE


def get_default_storage_dir() -> Path:
    """用户尚未配置时使用的默认存储根目录"""
    # Android 系统优先使用应用可写目录
    if is_android():
        android_dirs = [
            Path(ANDROID_PRIMARY_USR_DIR + '/files'),
            Path(ANDROID_EXTERNAL_DIR + '/files'),
            Path.home() / '.todolist'
        ]
        for dir_path in android_dirs:
            try:
                dir_path.mkdir(parents=True, exist_ok=True)
                if os.access(str(dir_path), os.W_OK):
                    return dir_path
            except Exception:
                continue
        fallback = Path(ANDROID_PRIMARY_DATA_DIR + '/files')
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback

    # 打包环境（PyInstaller）下的处理
    if getattr(sys, 'frozen', False):
        if platform.system() == 'Windows':
            appdata = os.environ.get('APPDATA') or os.environ.get('LOCALAPPDATA')
            base = Path(appdata) / 'TodoList' if appdata else Path.home() / '.todolist'
            base.mkdir(parents=True, exist_ok=True)
            return base
        if os.environ.get('APPIMAGE') is not None:
            base = Path.home() / '.todolist'
            base.mkdir(parents=True, exist_ok=True)
            return base

    # 开发 / 默认环境：项目根目录
    return _PROJECT_ROOT


def get_legacy_default_data_file() -> Optional[Path]:
    """旧版本默认的数据文件位置（存在则返回，用于迁移到新布局）"""
    candidates = []
    if is_android():
        candidates.extend([
            Path(ANDROID_PRIMARY_USR_DIR + '/databases/todo.db'),
            Path(ANDROID_EXTERNAL_DIR + '/databases/todo.db'),
        ])
    elif getattr(sys, 'frozen', False):
        if platform.system() == 'Windows':
            appdata = os.environ.get('APPDATA') or os.environ.get('LOCALAPPDATA')
            candidates.append(
                (Path(appdata) / 'TodoList' / 'data' / 'todo.db') if appdata
                else (Path.home() / '.todolist' / 'data' / 'todo.db')
            )
        elif os.environ.get('APPIMAGE') is not None:
            candidates.append(Path.home() / '.todolist' / 'data' / 'todo.db')

    candidates.append(_FALLBACK_DATA_FILE)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None

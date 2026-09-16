import sqlite3
from pathlib import Path

from backend.database import schema


def get_app_data_file() -> Path:
    """获取应用数据文件路径"""
    try:
        from backend.config import get_current_data_file
        return Path(get_current_data_file())
    except Exception as e:
        # 回退到默认路径
        project_root = Path(__file__).parent.parent.parent
        return project_root / 'data' / 'todo.db'

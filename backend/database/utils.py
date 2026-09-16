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


def migrate_database(cursor: sqlite3.Cursor) -> None:
    """数据库迁移：建表 / 建索引 / 补齐新字段 / 清理孤儿数据。

    具体 DDL 与迁移语句统一维护在 ``backend.database.schema``，
    此处仅保留兼容入口。
    """
    schema.initialize(cursor)

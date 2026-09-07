"""
TodoList应用的数据库操作
"""

from __future__ import annotations
import sqlite3
from pathlib import Path
from backend.database.mixins import AllCrudMixins
from backend.database.utils import get_app_data_file, migrate_database

class TodoDatabase(AllCrudMixins):
    """Todo数据库操作类"""
    def __init__(self) -> None:
        db_file = get_app_data_file()

        # 确保父目录存在
        db_file.parent.mkdir(parents=True, exist_ok=True)
        
        # 数据库文件路径
        self.db_path = str(db_file) if isinstance(db_file, Path) else db_file
        self.init_database()

    def get_connection(self) -> sqlite3.Connection:
        """获取数据库连接"""
        return sqlite3.connect(self.db_path)
    
    def init_database(self) -> None:
        """初始化数据库表"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建任务表，额外说明：tasks.parent_task_id 字段仅用于周期性任务，标记父模板ID，与普通父子任务关联（task_relations）无关。
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                completed BOOLEAN DEFAULT FALSE,
                priority TEXT DEFAULT 'none',
                category_id TEXT,
                due_date TEXT,
                is_recurring BOOLEAN DEFAULT FALSE,
                recurrence_type TEXT,
                recurrence_interval INTEGER DEFAULT 1,
                recurrence_count INTEGER,
                parent_task_id TEXT,
                created_at TEXT,
                updated_at TEXT,
                FOREIGN KEY (category_id) REFERENCES categories (id)
            )
        ''')
        
        # 创建分类表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#007bff',
                created_at TEXT
            )
        ''')

        # 创建设置表
        cursor.execute('''
                        CREATE TABLE IF NOT EXISTS settings (
                            key TEXT PRIMARY KEY,
                            value TEXT NOT NULL,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    ''')
        
        # 检查并添加新字段（用于数据库迁移）
        migrate_database(cursor)
        
        conn.commit()
        conn.close()
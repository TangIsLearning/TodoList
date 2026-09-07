"""
TodoList应用的数据库操作
"""

from __future__ import annotations
import sqlite3
from pathlib import Path
from backend.database.mixins import AllCrudMixins

def get_app_data_file() -> Path:
    """获取应用数据文件路径"""
    try:
        from backend.config import get_current_data_file
        return Path(get_current_data_file())
    except Exception as e:
        # 回退到默认路径
        project_root = Path(__file__).parent.parent.parent
        return project_root / 'data' / 'todo.db'

def _migrate_database(cursor: sqlite3.Cursor) -> None:
    """数据库迁移，添加新字段"""
    # 获取现有表结构
    cursor.execute("PRAGMA table_info(tasks)")
    columns = [column[1] for column in cursor.fetchall()]

    # 添加周期性任务相关字段
    new_columns = [
        ('is_recurring', 'BOOLEAN DEFAULT FALSE'),
        ('recurrence_type', 'TEXT'),
        ('recurrence_interval', 'INTEGER DEFAULT 1'),
        ('recurrence_count', 'INTEGER'),
        ('parent_task_id', 'TEXT')
    ]

    for column_name, column_def in new_columns:
        if column_name not in columns:
            cursor.execute(f'ALTER TABLE tasks ADD COLUMN {column_name} {column_def}')

    # 检查并创建标签相关表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#6c757d',
                created_at TEXT
            )
        ''')

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='task_tags'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE task_tags (
                task_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY (task_id, tag_id),
                FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
            )
        ''')

    # 新增 task_relations 表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='task_relations'")
    if not cursor.fetchone():
        cursor.execute('''
                CREATE TABLE task_relations (
                    sub_task_id TEXT NOT NULL,
                    main_task_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (sub_task_id, main_task_id),
                    UNIQUE(sub_task_id),   -- 确保每个子任务只能有一个父任务
                    FOREIGN KEY (sub_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
                    FOREIGN KEY (main_task_id) REFERENCES tasks (id) ON DELETE CASCADE
                )
            ''')
        cursor.execute('CREATE INDEX idx_task_relations_parent ON task_relations(main_task_id)')


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
        _migrate_database(cursor)
        
        conn.commit()
        conn.close()
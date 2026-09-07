import sqlite3
from pathlib import Path

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

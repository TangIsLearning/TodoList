# backend/database/schema.py
"""数据库结构的唯一来源（Single Source of Truth）。

所有建表 / 索引 / 迁移语句集中在本模块，供以下场景共用，避免 DDL 在多处漂移：
- ``TodoDatabase.init_database``：应用启动时初始化 / 升级主库
- ``DataExportManager._initialize_new_database``：新建或导入数据文件
- ``backend.database.utils.migrate_database``：历史库升级

约定：
- 所有 DDL 均使用 ``IF NOT EXISTS``，可重复执行（幂等）
- 索引统一在此声明，避免各模块分散创建
"""

from __future__ import annotations

from typing import Dict, List, Tuple

# --------------------------------------------------------------------------- #
# 表结构
# --------------------------------------------------------------------------- #

# 补充说明：tasks.parent_task_id 字段仅用于周期性任务，标记父模板 ID，
# 与普通父子任务关联（task_relations）无关。
TABLE_TASKS = '''
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
'''

TABLE_CATEGORIES = '''
    CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#007bff',
        created_at TEXT
    )
'''

TABLE_SETTINGS = '''
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
'''

TABLE_TAGS = '''
    CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#6c757d',
        created_at TEXT
    )
'''

TABLE_TASK_TAGS = '''
    CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (task_id, tag_id),
        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    )
'''

TABLE_TASK_RELATIONS = '''
    CREATE TABLE IF NOT EXISTS task_relations (
        sub_task_id TEXT NOT NULL,
        main_task_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (sub_task_id, main_task_id),
        UNIQUE(sub_task_id),   -- 确保每个子任务只能有一个父任务
        FOREIGN KEY (sub_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
        FOREIGN KEY (main_task_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
'''

# 附件仅存储元信息，文件实体存储在磁盘
TABLE_ATTACHMENTS = '''
    CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'file',
        name TEXT NOT NULL,
        file_path TEXT,
        url TEXT,
        size INTEGER,
        mime_type TEXT,
        is_image INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
'''

# 日历提醒事件关联表（移动端：记录任务对应的系统日历事件 ID）
TABLE_CALENDAR_EVENTS = '''
    CREATE TABLE IF NOT EXISTS calendar_events (
        task_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        updated_at TEXT
    )
'''

# 按依赖顺序排列：被引用的表先建
TABLES: Tuple[Tuple[str, str], ...] = (
    ('categories', TABLE_CATEGORIES),
    ('tasks', TABLE_TASKS),
    ('settings', TABLE_SETTINGS),
    ('tags', TABLE_TAGS),
    ('task_tags', TABLE_TASK_TAGS),
    ('task_relations', TABLE_TASK_RELATIONS),
    ('attachments', TABLE_ATTACHMENTS),
    ('calendar_events', TABLE_CALENDAR_EVENTS),
)

# --------------------------------------------------------------------------- #
# 索引
# --------------------------------------------------------------------------- #

INDEXES: Tuple[str, ...] = (
    'CREATE INDEX IF NOT EXISTS idx_task_relations_parent ON task_relations(main_task_id)',
    'CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id)',
    # 列表页按状态 + 截止时间筛选（overdue / pending / today / week 等）的高频组合
    'CREATE INDEX IF NOT EXISTS idx_tasks_completed_due ON tasks(completed, due_date)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id)',
    # 按标签反查任务、统计标签使用量
    'CREATE INDEX IF NOT EXISTS idx_task_tags_tag_id ON task_tags(tag_id)',
    # 周期性任务族查询
    'CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id)',
)

# --------------------------------------------------------------------------- #
# 迁移
# --------------------------------------------------------------------------- #

# 历史库缺少的列：(列名, 列定义)
TASK_MIGRATION_COLUMNS: Tuple[Tuple[str, str], ...] = (
    ('is_recurring', 'BOOLEAN DEFAULT FALSE'),
    ('recurrence_type', 'TEXT'),
    ('recurrence_interval', 'INTEGER DEFAULT 1'),
    ('recurrence_count', 'INTEGER'),
    ('parent_task_id', 'TEXT'),
)

# 启用外键约束前必须清理的孤儿数据（历史库在约束关闭期间产生）
# 元素为 (SQL, 说明)
ORPHAN_CLEANUP_STATEMENTS: Tuple[Tuple[str, str], ...] = (
    ('DELETE FROM task_tags WHERE task_id NOT IN (SELECT id FROM tasks)', '清理指向已删除任务的标签关联'),
    ('DELETE FROM task_tags WHERE tag_id NOT IN (SELECT id FROM tags)', '清理指向已删除标签的关联'),
    ('DELETE FROM attachments WHERE task_id NOT IN (SELECT id FROM tasks)', '清理无主附件记录'),
    ('DELETE FROM task_relations WHERE sub_task_id NOT IN (SELECT id FROM tasks)'
     ' OR main_task_id NOT IN (SELECT id FROM tasks)', '清理无效的父子任务关联'),
    ('DELETE FROM calendar_events WHERE task_id NOT IN (SELECT id FROM tasks)', '清理无效的日历事件关联'),
    ('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM task_tags)', '清理未被任何任务使用的标签'),
)


def create_tables(cursor) -> None:
    """创建全部表（幂等）。"""
    for _name, ddl in TABLES:
        cursor.execute(ddl)


def create_indexes(cursor) -> None:
    """创建全部索引（幂等）。

    必须在列迁移之后执行：历史库缺少 parent_task_id 等列时，
    先建索引会因 "no such column" 失败。
    """
    for ddl in INDEXES:
        cursor.execute(ddl)


def create_all(cursor) -> None:
    """创建全部表与索引（幂等）。仅用于全新的空数据库。"""
    create_tables(cursor)
    create_indexes(cursor)


def migrate_tasks(cursor) -> List[str]:
    """为 tasks 表补齐历史版本缺失的列，返回本次新增的列名。"""
    cursor.execute('PRAGMA table_info(tasks)')
    existing = {row[1] for row in cursor.fetchall()}

    added: List[str] = []
    for column_name, column_def in TASK_MIGRATION_COLUMNS:
        if column_name not in existing:
            cursor.execute(f'ALTER TABLE tasks ADD COLUMN {column_name} {column_def}')
            added.append(column_name)
    return added


def cleanup_orphans(cursor) -> Dict[str, int]:
    """清理孤儿数据，返回 {说明: 影响行数}。

    开启 ``PRAGMA foreign_keys = ON`` 前必须执行，否则既有的脏数据会让
    后续的写入（INSERT / UPDATE）直接失败。
    """
    report: Dict[str, int] = {}
    # 先清理子表关联，再清理标签，保证顺序无依赖
    for sql, label in ORPHAN_CLEANUP_STATEMENTS:
        cursor.execute(sql)
        affected = cursor.rowcount or 0
        if affected > 0:
            report[label] = affected
    return report


def initialize(cursor, cleanup: bool = True) -> Dict[str, object]:
    """一次性完成建表 + 迁移 + 建索引 + （可选）孤儿清理，返回迁移结果摘要。"""
    create_tables(cursor)
    added_columns = migrate_tasks(cursor)
    # 索引必须在列补齐后再建，否则历史库会因缺少列而失败
    create_indexes(cursor)
    orphans = cleanup_orphans(cursor) if cleanup else {}
    return {'added_columns': added_columns, 'cleaned_orphans': orphans}

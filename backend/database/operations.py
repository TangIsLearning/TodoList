"""
TodoList应用的数据库操作
"""

import json
import random
import string
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import os
import sys
import uuid

from backend.config import ANDROID_PACKAGE_NAME, ANDROID_PRIMARY_DATA_DIR
from backend.utils.logger import backend_logger
from backend.database.models import Tag, Task, Category


def get_app_data_file():
    """获取应用数据文件路径"""
    try:
        from backend.config import get_current_data_file
        return Path(get_current_data_file())
    except Exception as e:
        # 回退到默认路径
        project_root = Path(__file__).parent.parent.parent
        return project_root / 'data' / 'todo.db'

def _migrate_database(cursor):
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

    # ===== A 子系统：用户系统迁移 =====
    # 新增 users 表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                unit TEXT,
                department TEXT,
                role TEXT,
                avatar_color TEXT DEFAULT '#4f46e5',
                created_at TEXT NOT NULL,
                last_active_at TEXT,
                is_deleted INTEGER DEFAULT 0,
                UNIQUE(unit, department, display_name)
            )
        ''')
        cursor.execute('CREATE INDEX idx_users_owner ON users(unit, department, display_name)')

    # 新增 user_sessions 表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE user_sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_used_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')

    # 新增 task_audit_log 表
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='task_audit_log'")
    if not cursor.fetchone():
        cursor.execute('''
            CREATE TABLE task_audit_log (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                field TEXT,
                old_value TEXT,
                new_value TEXT,
                created_at TEXT NOT NULL
            )
        ''')
        cursor.execute('CREATE INDEX idx_audit_task ON task_audit_log(task_id, created_at)')

    # tasks 扩展字段（注意：函数顶部已经读过 columns，但要确保在最末尾再读一次最新值）
    cursor.execute("PRAGMA table_info(tasks)")
    columns_latest = [column[1] for column in cursor.fetchall()]

    task_new_cols = [
        ('owning_dept_id', 'TEXT'),
        ('cooperating_dept_ids', 'TEXT'),
        ('owner_user_id', 'TEXT'),
        ('cooperator_user_ids', 'TEXT'),
        ('audit_enabled', 'INTEGER DEFAULT 1')
    ]
    for col_name, col_def in task_new_cols:
        if col_name not in columns_latest:
            cursor.execute(f'ALTER TABLE tasks ADD COLUMN {col_name} {col_def}')

    # ===== B 子系统：多级分类迁移 =====
    # 扩展 categories 表：增加 parent_id / depth / owner_type / owner_id / icon / sort_order / is_deleted / updated_at
    # 若 categories 表尚未创建（如 _migrate_database 单独被调用），则跳过字段扩展
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(categories)")
        cat_columns = [c[1] for c in cursor.fetchall()]
        cat_new_cols = [
            ('parent_id', 'TEXT'),
            ('depth', 'INTEGER DEFAULT 0'),
            ('owner_type', "TEXT DEFAULT 'user'"),
            ('owner_id', 'TEXT'),
            ('icon', "TEXT DEFAULT '📁'"),
            ('sort_order', 'INTEGER DEFAULT 0'),
            ('is_deleted', 'INTEGER DEFAULT 0'),
            ('updated_at', 'TEXT'),
        ]
        for col_name, col_def in cat_new_cols:
            if col_name not in cat_columns:
                cursor.execute(f'ALTER TABLE categories ADD COLUMN {col_name} {col_def}')

        # 索引：常用查询路径
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_cat_owner ON categories(owner_type, owner_id, is_deleted)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_cat_parent ON categories(parent_id, sort_order)')

        # 老数据回填：若 owner_id 为空但存在历史行（迁移前创建），默认归属到占位 owner_id='legacy'
        cursor.execute("UPDATE categories SET owner_id = 'legacy' WHERE owner_id IS NULL")

    # tasks 扩展：category_ids JSON 数组（多分类）
    cursor.execute("PRAGMA table_info(tasks)")
    tasks_latest = [c[1] for c in cursor.fetchall()]
    if 'category_ids' not in tasks_latest:
        cursor.execute("ALTER TABLE tasks ADD COLUMN category_ids TEXT DEFAULT '[]'")
        # 数据迁移：旧 category_id 字段（单值外键）→ category_ids
        if 'category_id' in tasks_latest:
            cursor.execute("SELECT id, category_id FROM tasks WHERE category_id IS NOT NULL AND category_id != ''")
            for row in cursor.fetchall():
                try:
                    cursor.execute(
                        "UPDATE tasks SET category_ids = ? WHERE id = ?",
                        (json.dumps([row[1]]), row[0])
                    )
                except Exception:
                    pass

    # C 阶段：协作组 / 消息 / 文件 / 同步
    c_tables = [
        '''CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '👥',
            color TEXT DEFAULT '#4f46e5',
            description TEXT,
            join_code TEXT NOT NULL UNIQUE,
            created_by TEXT NOT NULL,
            is_hidden INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0
        )''',
        '''CREATE TABLE IF NOT EXISTS group_members (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            share_tasks INTEGER DEFAULT 0,
            share_categories INTEGER DEFAULT 0,
            share_group_tasks INTEGER DEFAULT 1,
            share_history INTEGER DEFAULT 0,
            joined_at TEXT NOT NULL,
            last_seen_at TEXT,
            UNIQUE(group_id, user_id)
        )''',
        '''CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            content TEXT,
            msg_type TEXT NOT NULL,
            attachment_ids TEXT,
            reply_to_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            read_by TEXT
        )''',
        '''CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT,
            file_hash TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT,
            storage_path TEXT NOT NULL,
            uploaded_by TEXT NOT NULL,
            created_at TEXT NOT NULL
        )''',
        '''CREATE TABLE IF NOT EXISTS sync_log (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            peer_id TEXT,
            user_id TEXT,
            has_conflict INTEGER DEFAULT 0,
            detail TEXT,
            created_at TEXT NOT NULL
        )''',
        '''CREATE TABLE IF NOT EXISTS file_storage (
            file_hash TEXT PRIMARY KEY,
            storage_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            ref_count INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )''',
    ]
    for ddl in c_tables:
        cursor.execute(ddl)

    # 索引
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_groups_join_code ON groups(join_code)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_id, created_at)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash)')

    # tasks 扩展字段
    cursor.execute("PRAGMA table_info(tasks)")
    cols = {r[1] for r in cursor.fetchall()}
    if 'group_id' not in cols:
        cursor.execute('ALTER TABLE tasks ADD COLUMN group_id TEXT')
    if 'synced_at' not in cols:
        cursor.execute('ALTER TABLE tasks ADD COLUMN synced_at TEXT')
    if 'version' not in cols:
        cursor.execute('ALTER TABLE tasks ADD COLUMN version INTEGER DEFAULT 1')


class TodoDatabase:
    """Todo数据库操作类"""
    def __init__(self):
        db_file = get_app_data_file()

        # 确保父目录存在
        db_file.parent.mkdir(parents=True, exist_ok=True)

        # 数据库文件路径
        self.db_path = str(db_file) if isinstance(db_file, Path) else db_file
        backend_logger.info(f"数据库路径: {self.db_path}")
        # 当前操作用户（用于审计日志）
        self._current_user_id = None
        self.init_database()

    @contextmanager
    def get_connection(self):
        """获取数据库连接（context manager）"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    # ===== A 阶段：当前用户 / 审计日志 =====

    def set_current_user(self, user_id):
        """设置当前操作用户（用于审计日志关联）"""
        self._current_user_id = user_id

    def _write_audit(self, conn, task_id, action, field=None, old=None, new=None):
        """内部：写审计日志（仅当 audit_enabled=1 且 current_user_id 已设置）。
        需要在 INSERT/UPDATE 已完成、conn 尚未 commit 的上下文中调用。
        """
        if not self._current_user_id:
            return
        cursor = conn.cursor()
        cursor.execute(
            'SELECT audit_enabled FROM tasks WHERE id = ?',
            (task_id,)
        )
        row = cursor.fetchone()
        if not row or not row[0]:
            return
        cursor.execute('''
            INSERT INTO task_audit_log
                (id, task_id, user_id, action, field, old_value, new_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            str(uuid.uuid4()), task_id, self._current_user_id,
            action, field, old, new, datetime.now().isoformat()
        ))

    def get_task_audit_log(self, task_id) -> list['TaskAuditLog']:
        """获取任务的全部审计日志（按时间倒序）。"""
        from backend.database.models import TaskAuditLog
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT * FROM task_audit_log
                WHERE task_id = ?
                ORDER BY created_at DESC
            ''', (task_id,))
            rows = cur.fetchall()
        return [
            TaskAuditLog(
                id=row['id'], task_id=row['task_id'], user_id=row['user_id'],
                action=row['action'], field=row['field'],
                old_value=row['old_value'], new_value=row['new_value'],
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None
            )
            for row in rows
        ]
    
    def init_database(self):
        """初始化数据库表"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建任务表
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

    # 任务相关操作
    def add_task(self, task_data):
        """添加新任务。
        task_data 支持 A 阶段扩展字段：
        - auditEnabled (bool, 默认 True)
        - owningDeptId (str)
        - cooperatingDeptIds (list[str] | str)
        - ownerUserId (str) — 默认回退到 currentUserId
        - cooperatorUserIds (list[str] | str)
        - currentUserId (str) — 用于审计日志关联用户
        - createdAt / created_at (str) — 可选，sync 场景下保留远端时间戳
        - updatedAt / updated_at (str) — 可选，同上
        """
        task = Task(
            id=task_data.get('id'),
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None,
            is_recurring=task_data.get('isRecurring', False),
            recurrence_type=task_data.get('recurrenceType'),
            recurrence_interval=task_data.get('recurrenceInterval', 1),
            recurrence_count=task_data.get('recurrenceCount'),
            parent_task_id=task_data.get('parentTaskId')
        )
        # created_at / updated_at：调用方显式传入时尊重调用方（sync 场景下保留远端时间戳）。
        # 兼容 snake_case 与 camelCase 两种命名。
        custom_created = task_data.get('created_at') or task_data.get('createdAt')
        custom_updated = task_data.get('updated_at') or task_data.get('updatedAt')
        if custom_created:
            try:
                task.created_at = datetime.fromisoformat(str(custom_created).replace('Z', '+00:00'))
            except (TypeError, ValueError):
                pass
        if custom_updated:
            try:
                task.updated_at = datetime.fromisoformat(str(custom_updated).replace('Z', '+00:00'))
            except (TypeError, ValueError):
                pass

        audit_enabled = 1 if task_data.get('auditEnabled', True) else 0
        owning_dept_id = task_data.get('owningDeptId')
        cooperating_dept_ids = json.dumps(task_data.get('cooperatingDeptIds') or [])
        owner_user_id = task_data.get('ownerUserId') or task_data.get('currentUserId')
        cooperator_user_ids = json.dumps(task_data.get('cooperatorUserIds') or [])
        # B 阶段：category_ids 多分类
        category_ids = task_data.get('categoryIds') or task_data.get('category_ids')
        if isinstance(category_ids, str):
            try:
                category_ids = json.loads(category_ids) if category_ids.strip() else []
            except (json.JSONDecodeError, TypeError):
                category_ids = []
        if not isinstance(category_ids, list):
            category_ids = []
        # 兼容旧 category 字段：当 categoryIds 缺省而 category 存在时，回退到单值数组
        if not category_ids and task_data.get('category'):
            category_ids = [task_data['category']]
        category_ids_json = json.dumps(category_ids)

        # 本次操作关联用户（优先 currentUserId，否则 owner_user_id）
        operator_id = task_data.get('currentUserId') or self._current_user_id
        if operator_id:
            self._current_user_id = operator_id

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO tasks (id, title, description, completed, priority,
                                  category_id, due_date, is_recurring, recurrence_type,
                                  recurrence_interval, recurrence_count, parent_task_id,
                                  created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                task.id, task.title, task.description, task.completed, task.priority,
                task.category_id, task.due_date.isoformat() if task.due_date else None,
                task.is_recurring, task.recurrence_type, task.recurrence_interval,
                task.recurrence_count, task.parent_task_id,
                task.created_at.isoformat(), task.updated_at.isoformat()
            ))

            # A 阶段扩展字段
            cursor.execute('''
                UPDATE tasks SET audit_enabled = ?, owning_dept_id = ?,
                                 cooperating_dept_ids = ?, owner_user_id = ?,
                                 cooperator_user_ids = ?,
                                 category_ids = ?
                WHERE id = ?
            ''', (audit_enabled, owning_dept_id, cooperating_dept_ids,
                  owner_user_id, cooperator_user_ids, category_ids_json, task.id))

            # 写 create 审计
            self._write_audit(conn, task.id, 'create')

            conn.commit()

        # 处理标签
        tags = task_data.get('tags', [])
        if tags:
            self.update_task_tags(task.id, tags)

        # 重新从 db 读取完整 dict（含 owner/cooperator 扩展字段）
        result = self.get_task(task.id) or task.to_dict()
        return result
    
    def get_all_tasks(self):
        """获取所有任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 明确指定字段顺序，避免依赖字段位置
        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count,
                   parent_task_id, created_at, updated_at,
                   owner_user_id, cooperator_user_ids, category_ids
            FROM tasks
            ORDER BY
                CASE
                    WHEN due_date IS NOT NULL THEN 1
                    ELSE 2
                END,
                due_date ASC,
                CASE priority
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END,
                created_at DESC
        ''')

        rows = cursor.fetchall()
        conn.close()

        tasks = []
        for row in rows:
            try:
                coop_ids = json.loads(row[15] or '[]')
            except (json.JSONDecodeError, TypeError):
                coop_ids = []
            try:
                cat_ids = json.loads(row[16] or '[]')
            except (json.JSONDecodeError, TypeError):
                cat_ids = []
            task_dict = {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'ownerUserId': row[14],
                'cooperatorUserIds': coop_ids,
                'categoryIds': cat_ids,
                'tags': self.get_task_tags(row[0])  # 添加标签信息
            }
            tasks.append(task_dict)

        return tasks

    def get_tasks_paginated(self, page=1, page_size=10, category_id=None, status=None, 
                            priority=None, due_date_filter=None, year=None, month=None,
                            search_query=None, custom_date=None, sync_start_time=None, sync_end_time=None,
                            custom_start_date=None, custom_end_date=None):
        """分页查询任务，支持多种筛选条件
        
        参数:
            page: 页码，从1开始
            page_size: 每页数量
            category_id: 分类ID筛选
            status: 状态筛选
            priority: 优先级筛选
            due_date_filter: 日期筛选
            year: 年份筛选
            month: 月份筛选
            search_query: 搜索关键词，多关键词请用分号分隔（如 "工作;紧急"）
            custom_date: 自定义日期筛选（用于日历点击）
            sync_start_time: 自定义日期筛选（数据同步开始时间）
            sync_end_time: 自定义日期筛选（数据同步结束时间）
            custom_start_date: 自定义日期筛选（数据同步开始时间）
            custom_end_date: 自定义日期筛选（数据同步结束时间）

        返回:
            包含 tasks, total, page, page_size, total_pages 的字典
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 构建WHERE条件
        where_clauses = []
        params = []
        
        # 自定义日期筛选（优先级最高，用于日历视图点击）
        if custom_date:
            where_clauses.append('date(due_date) = ?')
            params.append(custom_date)
        if custom_start_date and custom_end_date:
            where_clauses.append('date(due_date) BETWEEN ? AND ?')
            params.append(custom_start_date)
            params.append(custom_end_date)

        # 分类筛选
        if not custom_date:  # 如果有自定义日期筛选，则忽略其他日期筛选
            if category_id == 'uncategorized':
                where_clauses.append('(category_id IS NULL OR category_id = "")')
            elif category_id and category_id != 'all':
                where_clauses.append('category_id = ?')
                params.append(category_id)
        
        # 优先级筛选
        if priority and priority != 'all':
            where_clauses.append('priority = ?')
            params.append(priority)
        
        # 状态筛选
        today = datetime.now().date()
        if status == 'completed':
            where_clauses.append('completed = 1')
        elif status == 'uncompleted':
            where_clauses.append('completed = 0')
        elif status == 'pending':
            # 未完成且未逾期
            where_clauses.append('completed = 0')
            where_clauses.append('(due_date IS NULL OR date(due_date) >= ?)')
            params.append(today.isoformat())
        elif status == 'overdue':
            # 未完成且已逾期
            where_clauses.append('completed = 0')
            where_clauses.append('due_date IS NOT NULL')
            where_clauses.append('date(due_date) < ?')
            params.append(today.isoformat())
        
        # 日期筛选
        if due_date_filter and not custom_date:
            if due_date_filter == 'today':
                where_clauses.append('date(due_date) = ?')
                params.append(today.isoformat())
            elif due_date_filter == 'tomorrow':
                tomorrow = today.replace(day=today.day + 1) if today.day < 28 else (today.replace(day=1, month=today.month+1) if today.month < 12 else today.replace(year=today.year+1, month=1, day=1))
                where_clauses.append('date(due_date) = ?')
                params.append(tomorrow.isoformat())
            elif due_date_filter == 'week':
                week_start = today - timedelta(days=today.weekday())
                week_end = today.replace(day=week_start.day + 7) if today.day <= 21 else today.replace(day=28)
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(week_start.isoformat())
                params.append(week_end.isoformat())
            elif due_date_filter == 'month':
                month_start = today.replace(month=today.month, day=1)
                if today.month == 12:
                    next_month = today.replace(year=today.year + 1, month=1, day=1)
                else:
                    next_month = month_start.replace(month=month_start.month + 1)
                month_end = next_month - timedelta(days=1)
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(month_start.isoformat())
                params.append(month_end.isoformat())
            elif due_date_filter == 'sync': # 仅同步
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) >= ?')
                params.append(today.isoformat())
                where_clauses.append('date(created_at) BETWEEN ? AND ?')
                params.append(sync_start_time.isoformat())
                params.append(sync_end_time.isoformat())
            elif due_date_filter == 'no-due-date':
                where_clauses.append('(due_date IS NULL OR due_date = "")')
        
        # 年月筛选
        if year and not custom_date:
            where_clauses.append('strftime("%Y", date(created_at)) = ?')
            params.append(str(year))
        
        if month and not custom_date:
            where_clauses.append('strftime("%m", date(created_at)) = ?')
            params.append(str(month).zfill(2))
        
        # 搜索关键词
        if search_query:
            search_query = search_query.strip(';')
            if search_query:
                # 检查是否包含分号，支持多关键词
                keywords = [kw.strip() for kw in search_query.split(';') if kw.strip()]
                keyword_conditions = []
                for kw in keywords:
                    if kw.startswith('#'):
                        # 标签搜索
                        tag_name = kw[1:]
                        condition = '''
                                            id IN (SELECT task_id FROM task_tags WHERE tag_id IN (
                                                SELECT id FROM tags WHERE name LIKE ?
                                            ))
                                        '''
                        keyword_conditions.append(condition)
                        params.append(f'%{tag_name}%')
                    else:
                        # 普通文本搜索（标题、描述、标签）
                        condition = '''
                                            (title LIKE ? OR description LIKE ? OR id IN (
                                                SELECT task_id FROM task_tags WHERE tag_id IN (
                                                    SELECT id FROM tags WHERE name LIKE ?
                                                )
                                            ))
                                        '''
                        keyword_conditions.append(condition)
                        params.extend([f'%{kw}%', f'%{kw}%', f'%{kw}%'])
                # 将所有关键词条件用 OR 连接，并作为一个整体条件
                combined_condition = '(' + ' OR '.join(keyword_conditions) + ')'
                where_clauses.append(combined_condition)

        # 构建完整的WHERE子句
        where_sql = ' AND '.join(where_clauses) if where_clauses else '1=1'
        
        # 查询总数
        count_sql = f'SELECT COUNT(*) FROM tasks WHERE {where_sql}'
        cursor.execute(count_sql, params)
        total = cursor.fetchone()[0]
        
        # 计算总页数
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0
        
        # 查询分页数据
        offset = (page - 1) * page_size
        data_sql = f'''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count,
                   parent_task_id, created_at, updated_at,
                   owner_user_id, cooperator_user_ids, category_ids
            FROM tasks
            WHERE {where_sql}
            ORDER BY
                CASE
                    WHEN due_date IS NOT NULL THEN 1
                    ELSE 2
                END,
                due_date ASC,
                CASE priority
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END,
                created_at DESC
            LIMIT ? OFFSET ?
        '''

        cursor.execute(data_sql, params + [page_size, offset])
        rows = cursor.fetchall()

        tasks = []
        for row in rows:
            try:
                coop_ids = json.loads(row[15] or '[]')
            except (json.JSONDecodeError, TypeError):
                coop_ids = []
            try:
                cat_ids = json.loads(row[16] or '[]')
            except (json.JSONDecodeError, TypeError):
                cat_ids = []
            task_dict = {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'ownerUserId': row[14],
                'cooperatorUserIds': coop_ids,
                'categoryIds': cat_ids,
                'tags': self.get_task_tags(row[0])  # 添加标签信息
            }
            tasks.append(task_dict)
        
        conn.close()
        
        return {
            'tasks': tasks,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages
        }
    
    def get_task(self, task_id):
        """获取单个任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 明确指定字段顺序
        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count,
                   parent_task_id, created_at, updated_at,
                   owner_user_id, cooperator_user_ids, category_ids
            FROM tasks WHERE id = ?
        ''', (task_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return None

        try:
            coop_ids = json.loads(row[15] or '[]')
        except (json.JSONDecodeError, TypeError):
            coop_ids = []
        try:
            cat_ids = json.loads(row[16] or '[]')
        except (json.JSONDecodeError, TypeError):
            cat_ids = []
        task_dict = {
            'id': row[0],
            'title': row[1],
            'description': row[2],
            'completed': bool(row[3]),
            'priority': row[4],
            'categoryId': row[5],
            'dueDate': row[6],
            'isRecurring': bool(row[7]) if row[7] is not None else False,
            'recurrenceType': row[8],
            'recurrenceInterval': row[9] if row[9] is not None else 1,
            'recurrenceCount': row[10],
            'parentTaskId': row[11],
            'createdAt': row[12],
            'updatedAt': row[13],
            'ownerUserId': row[14],
            'cooperatorUserIds': coop_ids,
            'categoryIds': cat_ids,
            'tags': self.get_task_tags(task_id)  # 添加标签信息
        }

        conn.close()
        return task_dict
    
    def update_task(self, task_id, task_data, is_update_task_tags = True):
        """更新任务。
        支持 A 阶段扩展字段（同 add_task）。写字段级审计。
        """
        task = Task(
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None
        )

        operator_id = task_data.get('currentUserId') or self._current_user_id
        if operator_id:
            self._current_user_id = operator_id

        # 字段映射：驼峰 task_data 键 → 蛇形 tasks 表列
        field_pairs = [
            ('title', 'title', task.title),
            ('description', 'description', task.description),
            ('completed', 'completed', task.completed),
            ('priority', 'priority', task.priority),
            ('categoryId', 'category_id', task.category_id),
            ('dueDate', 'due_date', task.due_date.isoformat() if task.due_date else None),
        ]
        # 仅在 task_data 中显式提供的字段才参与更新
        provided = [(src, col, val) for src, col, val in field_pairs if src in task_data]

        with self.get_connection() as conn:
            cursor = conn.cursor()
            # 读旧值（用于字段级审计）
            cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
            old_row = cursor.fetchone()
            if not old_row:
                return None
            old_dict = dict(old_row)

            # 构建 UPDATE
            set_clauses = [f'{col} = ?' for _, col, _ in provided]
            # updated_at：调用方显式传入时尊重调用方（sync 场景下需要保留远端时间戳），
            # 否则用 datetime.now()。兼容 snake_case 与 camelCase 两种命名。
            if 'updated_at' in task_data:
                custom_updated_at = task_data['updated_at']
            elif 'updatedAt' in task_data:
                custom_updated_at = task_data['updatedAt']
            else:
                custom_updated_at = datetime.now().isoformat()
            set_clauses.append('updated_at = ?')
            update_values = [val for _, _, val in provided] + [custom_updated_at]

            # A 阶段扩展字段
            ext_updates = []
            ext_values = []
            if 'auditEnabled' in task_data:
                ext_updates.append('audit_enabled = ?')
                ext_values.append(1 if task_data['auditEnabled'] else 0)
            if 'owningDeptId' in task_data:
                ext_updates.append('owning_dept_id = ?')
                ext_values.append(task_data['owningDeptId'])
            if 'cooperatingDeptIds' in task_data:
                ext_updates.append('cooperating_dept_ids = ?')
                ext_values.append(json.dumps(task_data['cooperatingDeptIds'] or []))
            if 'ownerUserId' in task_data:
                ext_updates.append('owner_user_id = ?')
                ext_values.append(task_data['ownerUserId'] or operator_id)
            if 'cooperatorUserIds' in task_data:
                ext_updates.append('cooperator_user_ids = ?')
                ext_values.append(json.dumps(task_data['cooperatorUserIds'] or []))
            # B 阶段：category_ids 多分类
            if 'categoryIds' in task_data or 'category_ids' in task_data:
                raw = task_data.get('categoryIds') or task_data.get('category_ids')
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw) if raw.strip() else []
                    except (json.JSONDecodeError, TypeError):
                        raw = []
                if not isinstance(raw, list):
                    raw = []
                ext_updates.append('category_ids = ?')
                ext_values.append(json.dumps(raw))

            all_set = set_clauses + ext_updates
            cursor.execute(
                f'UPDATE tasks SET {", ".join(all_set)} WHERE id = ?',
                update_values + ext_values + [task_id]
            )

            # 字段级审计
            for src, col, new_val in provided:
                old_val = old_dict.get(col)
                if str(old_val) != str(new_val):
                    self._write_audit(conn, task_id, 'update', col, str(old_val), str(new_val))

            conn.commit()

        # 处理标签
        if is_update_task_tags:
            tags = task_data.get('tags', [])
            self.update_task_tags(task_id, tags)

        # 重新从 db 读取完整 dict（含 owner/cooperator 扩展字段）
        result = self.get_task(task_id) or task.to_dict()
        return result

    def delete_task(self, task_id, current_user_id=None):
        """删除任务（写 delete 审计）。"""
        if current_user_id:
            self._current_user_id = current_user_id

        with self.get_connection() as conn:
            cursor = conn.cursor()
            # 在删除前写 delete 审计（删除后无法 SELECT 旧值）
            self._write_audit(conn, task_id, 'delete')

            cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
            cursor.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))

            conn.commit()

        return {'success': True, 'deleted_id': task_id}
    
    # 分类相关操作
    def add_category(self, category_data):
        """添加新分类"""
        category = Category(
            name=category_data.get('name', ''),
            color=category_data.get('color', '#007bff')
        )
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO categories (id, name, color, created_at)
            VALUES (?, ?, ?, ?)
        ''', (category.id, category.name, category.color, category.created_at.isoformat()))
        
        conn.commit()
        conn.close()
        
        return category.to_dict()
    
    def get_all_categories(self):
        """获取所有分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM categories ORDER BY name')
        rows = cursor.fetchall()
        conn.close()
        
        categories = []
        for row in rows:
            category_dict = {
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3]
            }
            categories.append(category_dict)
        
        return categories
    
    def update_category(self, category_id, category_data):
        """更新分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 更新分类信息
        cursor.execute('''
            UPDATE categories 
            SET name = ?, color = ? 
            WHERE id = ?
        ''', (category_data.get('name', ''), category_data.get('color', '#007bff'), category_id))
        
        conn.commit()
        conn.close()
        
        # 返回更新后的分类信息
        return {
            'id': category_id,
            'name': category_data.get('name', ''),
            'color': category_data.get('color', '#007bff')
        }
    
    def delete_category(self, category_id):
        """删除分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 先将该分类的任务的分类ID设为NULL
        cursor.execute('UPDATE tasks SET category_id = NULL WHERE category_id = ?', (category_id,))
        
        # 删除分类
        cursor.execute('DELETE FROM categories WHERE id = ?', (category_id,))
        
        conn.commit()
        conn.close()
        
        return {'success': True, 'deleted_id': category_id}
    
    def create_recurring_tasks(self, parent_task_data):
        """创建周期性任务系列"""
        from dateutil.relativedelta import relativedelta
        
        tasks = []
        parent_task = Task(
            title=parent_task_data.get('title', ''),
            description=parent_task_data.get('description', ''),
            completed=False,
            priority=parent_task_data.get('priority', 'none'),
            category_id=parent_task_data.get('categoryId'),
            due_date=datetime.fromisoformat(parent_task_data['dueDate']) if parent_task_data.get('dueDate') else None,
            is_recurring=True,
            recurrence_type=parent_task_data.get('recurrenceType'),
            recurrence_interval=parent_task_data.get('recurrenceInterval', 1),
            recurrence_count=parent_task_data.get('recurrenceCount'),
            parent_task_id=None
        )
        
        # 创建父任务
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO tasks (id, title, description, completed, priority, 
                              category_id, due_date, is_recurring, recurrence_type, 
                              recurrence_interval, recurrence_count, parent_task_id, 
                              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            parent_task.id, parent_task.title, parent_task.description, parent_task.completed, 
            parent_task.priority, parent_task.category_id, 
            parent_task.due_date.isoformat() if parent_task.due_date else None,
            parent_task.is_recurring, parent_task.recurrence_type, parent_task.recurrence_interval,
            parent_task.recurrence_count, parent_task.parent_task_id,
            parent_task.created_at.isoformat(), parent_task.updated_at.isoformat()
        ))
        
        tasks.append(parent_task.to_dict())
        
        # 创建子任务
        if parent_task.due_date and parent_task.recurrence_type:
            current_date = parent_task.due_date
            count = 1
            
            while True:
                # 计算下一个任务日期
                if parent_task.recurrence_type == 'yearly':
                    next_date = current_date + relativedelta(years=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'monthly':
                    next_date = current_date + relativedelta(months=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'weekly':
                    next_date = current_date + relativedelta(weeks=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'daily':
                    next_date = current_date + relativedelta(days=parent_task.recurrence_interval)
                else:
                    break
                
                count += 1
                
                # 检查是否超过循环次数
                if parent_task.recurrence_count and count > parent_task.recurrence_count:
                    break
                
                # 创建子任务
                child_task = Task(
                    title=parent_task.title,
                    description=parent_task.description,
                    completed=False,
                    priority=parent_task.priority,
                    category_id=parent_task.category_id,
                    due_date=next_date,
                    is_recurring=False,
                    parent_task_id=parent_task.id
                )
                
                cursor.execute('''
                    INSERT INTO tasks (id, title, description, completed, priority, 
                                      category_id, due_date, is_recurring, recurrence_type, 
                                      recurrence_interval, recurrence_count, parent_task_id, 
                                      created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    child_task.id, child_task.title, child_task.description, child_task.completed,
                    child_task.priority, child_task.category_id,
                    child_task.due_date.isoformat() if child_task.due_date else None,
                    child_task.is_recurring, child_task.recurrence_type, child_task.recurrence_interval,
                    child_task.recurrence_count, child_task.parent_task_id,
                    child_task.created_at.isoformat(), child_task.updated_at.isoformat()
                ))
                
                tasks.append(child_task.to_dict())
                current_date = next_date
        
        conn.commit()
        conn.close()
        
        return tasks
    
    def delete_recurring_task(self, task_id, delete_all=False):
        """删除周期性任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        if delete_all:
            # 删除整个周期的任务
            # 先获取任务信息
            cursor.execute('SELECT parent_task_id, id FROM tasks WHERE id = ?', (task_id,))
            task_info = cursor.fetchone()
            
            if task_info:
                parent_id, current_id = task_info
                
                if parent_id:
                    # 如果是子任务，获取父任务ID，然后删除所有子任务
                    cursor.execute('DELETE FROM tasks WHERE parent_task_id = ?', (parent_id,))
                    cursor.execute('DELETE FROM tasks WHERE id = ?', (parent_id,))
                else:
                    # 如果是父任务，删除所有子任务和父任务
                    cursor.execute('DELETE FROM tasks WHERE parent_task_id = ?', (task_id,))
                    cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        else:
            # 只删除单个任务
            cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        
        conn.commit()
        conn.close()
        
        return {'success': True, 'deleted_id': task_id, 'delete_all': delete_all}

    # 设置相关操作
    def get_setting(self, key, default_value=None):
        """获取单个设置值"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
            result = cursor.fetchone()

            if result is None:
                return default_value

            # 尝试解析 JSON
            try:
                return json.loads(result[0])
            except json.JSONDecodeError:
                return result[0]

    def set_setting(self, key, value):
        """保存单个设置值"""
        # 将值转换为 JSON 字符串
        if isinstance(value, (dict, list, bool)):
            value_str = json.dumps(value)
        elif isinstance(value, str):
            value_str = value
        else:
            value_str = json.dumps(value)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', (key, value_str))
            conn.commit()

    def delete_setting(self, key):
        """删除单个设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM settings WHERE key = ?', (key,))
            conn.commit()

    def get_all_settings(self):
        """获取所有设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT key, value FROM settings')
            results = cursor.fetchall()

            settings = {}
            for key, value in results:
                try:
                    settings[key] = json.loads(value)
                except json.JSONDecodeError:
                    settings[key] = value

            return settings

    def reset_settings(self):
        """重置所有设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM settings')
            conn.commit()

    # ==================== 标签相关操作 ====================

    def parse_tags_from_text(self, text):
        """从文本中解析标签（格式：#标签名）"""
        import re
        if not text:
            return []
        # 匹配 #标签名 格式，标签名可以是中文、英文、数字、下划线
        pattern = r'#([\u4e00-\u9fa5a-zA-Z0-9_]+)'
        tags = re.findall(pattern, text)
        return list(set(tags))  # 去重

    def update_task_tags(self, task_id, tag_names):
        """更新任务的标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 先删除任务的所有标签关联
        cursor.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))

        # 添加或获取标签ID
        if tag_names:
            tag_ids = []
            for tag_name in tag_names:
                # 检查标签是否已存在
                cursor.execute('SELECT id FROM tags WHERE name = ?', (tag_name,))
                result = cursor.fetchone()

                if result:
                    tag_ids.append(result[0])
                else:
                    # 创建新标签
                    tag = Tag(name=tag_name)
                    cursor.execute('''
                        INSERT INTO tags (id, name, color, created_at)
                        VALUES (?, ?, ?, ?)
                    ''', (tag.id, tag.name, tag.color, tag.created_at.isoformat()))
                    tag_ids.append(tag.id)

            # 建立关联
            for tag_id in tag_ids:
                cursor.execute('''
                    INSERT OR IGNORE INTO task_tags (task_id, tag_id)
                    VALUES (?, ?)
                ''', (task_id, tag_id))

        conn.commit()
        conn.close()

    def get_task_tags(self, task_id):
        """获取任务的所有标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.id, t.name, t.color, t.created_at
            FROM tags t
            INNER JOIN task_tags tt ON t.id = tt.tag_id
            WHERE tt.task_id = ?
        ''', (task_id,))

        rows = cursor.fetchall()
        conn.close()

        tags = []
        for row in rows:
            tags.append({
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3]
            })
        return tags

    def get_all_tags(self):
        """获取所有标签及其使用次数"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.id, t.name, t.color, t.created_at, COUNT(tt.task_id) as task_count
            FROM tags t
            LEFT JOIN task_tags tt ON t.id = tt.tag_id
            GROUP BY t.id
            ORDER BY t.name
        ''')

        rows = cursor.fetchall()
        conn.close()

        tags = []
        for row in rows:
            tags.append({
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3],
                'taskCount': row[4]
            })
        return tags

    def delete_tag(self, tag_id):
        """删除标签"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
        # task_tags 中的关联记录会通过外键约束自动删除
        conn.commit()
        conn.close()
        return True


class UserManager:
    """用户管理：增删改查 + session 管理"""

    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    def create_user(self, display_name, unit=None, department=None,
                    role=None, avatar_color='#4f46e5') -> 'User':
        """创建用户。三元组重复时抛 ValueError。"""
        from backend.database.models import User
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            # 三元组唯一性校验
            cur.execute('''
                SELECT id FROM users
                WHERE unit IS ? AND department IS ? AND display_name = ?
                AND is_deleted = 0
            ''', (unit, department, display_name))
            if cur.fetchone():
                raise ValueError(f'该用户名+单位+部门组合已存在: {display_name}')

            now = datetime.now().isoformat()
            new_id = str(uuid.uuid4())
            cur.execute('''
                INSERT INTO users (id, display_name, unit, department, role,
                                   avatar_color, created_at, is_deleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            ''', (new_id, display_name, unit, department, role, avatar_color, now))
            conn.commit()

        return User(
            id=new_id, display_name=display_name, unit=unit,
            department=department, role=role, avatar_color=avatar_color,
            created_at=datetime.fromisoformat(now)
        )

    def get_user(self, user_id) -> 'User | None':
        """按 ID 获取用户（已软删除返回 None）"""
        from backend.database.models import User
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                'SELECT * FROM users WHERE id = ? AND is_deleted = 0',
                (user_id,)
            )
            row = cur.fetchone()
        if not row:
            return None
        return User(
            id=row['id'],
            display_name=row['display_name'],
            unit=row['unit'],
            department=row['department'],
            role=row['role'],
            avatar_color=row['avatar_color'] or '#4f46e5',
            created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            last_active_at=datetime.fromisoformat(row['last_active_at']) if row['last_active_at'] else None,
        )

    def update_user(self, user_id, display_name=None, unit=None, department=None,
                    role=None, avatar_color=None) -> 'User':
        """更新用户字段。三元组冲突时抛 ValueError。"""
        existing = self.get_user(user_id)
        if not existing:
            raise ValueError(f'用户不存在: {user_id}')

        new_dn = display_name if display_name is not None else existing.display_name
        new_unit = unit if unit is not None else existing.unit
        new_dept = department if department is not None else existing.department
        new_role = role if role is not None else existing.role
        new_color = avatar_color if avatar_color is not None else existing.avatar_color

        with self.db.get_connection() as conn:
            cur = conn.cursor()
            # 三元组唯一性校验
            cur.execute('''
                SELECT id FROM users
                WHERE unit IS ? AND department IS ? AND display_name = ?
                AND is_deleted = 0 AND id != ?
            ''', (new_unit, new_dept, new_dn, user_id))
            if cur.fetchone():
                raise ValueError(f'该用户名+单位+部门组合已存在: {new_dn}')

            cur.execute('''
                UPDATE users SET display_name=?, unit=?, department=?, role=?, avatar_color=?
                WHERE id=?
            ''', (new_dn, new_unit, new_dept, new_role, new_color, user_id))
            conn.commit()

        return self.get_user(user_id)

    def delete_user(self, user_id):
        """软删除用户。同时将该用户拥有的任务 owner_user_id 置 NULL，
        并从所有任务的 cooperator_user_ids JSON 中移除。"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE users SET is_deleted = 1 WHERE id = ?', (user_id,))
            # 该用户拥有的任务 owner_user_id 置 NULL
            cur.execute(
                'UPDATE tasks SET owner_user_id = NULL WHERE owner_user_id = ?',
                (user_id,)
            )
            # 从协办人 JSON 中移除该用户
            cur.execute(
                "SELECT id, cooperator_user_ids FROM tasks WHERE cooperator_user_ids LIKE ?",
                (f'%{user_id}%',)
            )
            for row in cur.fetchall():
                try:
                    ids = json.loads(row['cooperator_user_ids'] or '[]')
                except (json.JSONDecodeError, TypeError):
                    ids = []
                if user_id in ids:
                    ids.remove(user_id)
                    cur.execute(
                        'UPDATE tasks SET cooperator_user_ids = ? WHERE id = ?',
                        (json.dumps(ids), row['id'])
                    )
            conn.commit()

    def list_local_users(self) -> list['User']:
        """列出本机所有未删除用户。
        排序：last_active_at DESC（NULL 在后），created_at DESC 兜底。"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT * FROM users WHERE is_deleted = 0
                ORDER BY (last_active_at IS NULL), last_active_at DESC, created_at DESC
            ''')
            rows = cur.fetchall()
        return [self.get_user(row['id']) for row in rows]

    # ===== Session 管理 =====

    def create_session(self, user_id) -> str:
        """创建 session，返回 token。"""
        import secrets
        token = secrets.token_urlsafe(48)  # 64 字符左右
        now = datetime.now().isoformat()
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO user_sessions (token, user_id, created_at, last_used_at)
                VALUES (?, ?, ?, ?)
            ''', (token, user_id, now, now))
            cur.execute(
                'UPDATE users SET last_active_at = ? WHERE id = ?',
                (now, user_id)
            )
            conn.commit()
        return token

    def get_user_by_token(self, token) -> 'User | None':
        """根据 token 获取当前用户（session 不存在或用户已软删除时返回 None）"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT user_id FROM user_sessions WHERE token = ?', (token,))
            row = cur.fetchone()
        if not row:
            return None
        return self.get_user(row['user_id'])

    def heartbeat(self, token):
        """更新 session 和对应用户的 last_active_at。无效 token 静默忽略。"""
        now = datetime.now().isoformat()
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                'UPDATE user_sessions SET last_used_at = ? WHERE token = ?',
                (now, token)
            )
            cur.execute('''
                UPDATE users SET last_active_at = ?
                WHERE id = (SELECT user_id FROM user_sessions WHERE token = ?)
            ''', (now, token))
            conn.commit()

    def logout(self, token):
        """清除 session。"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM user_sessions WHERE token = ?', (token,))
            conn.commit()

    def get_current_token(self) -> str | None:
        """获取本机最近的活跃 session token（单活跃 session 约定）"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                'SELECT token FROM user_sessions ORDER BY last_used_at DESC LIMIT 1'
            )
            row = cur.fetchone()
        return row['token'] if row else None


# ============================================
# B 子系统：多级分类管理
# ============================================

class CategoryManager:
    """多级分类 CRUD + 树操作 + 拖拽原子事务
    - 树深度硬限制：3 级 (depth 0, 1, 2)
    - 同 owner_id / parent_id 下 name 唯一
    - 删除策略：有子级阻止；被引用任务自动清理
    - 拖拽：原子事务 + 深度同步 + 环检测
    """

    MAX_DEPTH = 2  # 0=根, 1=二级, 2=叶子

    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    # ---------- 基础查询 ----------

    def _row_to_dict(self, row):
        if row is None:
            return None
        return {
            'id': row['id'],
            'name': row['name'],
            'parentId': row['parent_id'],
            'depth': row['depth'],
            'ownerType': row['owner_type'],
            'ownerId': row['owner_id'],
            'icon': row['icon'] or '📁',
            'color': row['color'] or '#4f46e5',
            'sortOrder': row['sort_order'] or 0,
            'isDeleted': bool(row['is_deleted']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
        }

    def list_categories(self, owner_type='user', owner_id=''):
        """列出某 owner 的全部分类（按 sort_order 升序，深度升序）"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT * FROM categories
                WHERE owner_type = ? AND owner_id = ? AND is_deleted = 0
                ORDER BY depth ASC, sort_order ASC, created_at ASC
            ''', (owner_type, owner_id))
            return [self._row_to_dict(r) for r in cur.fetchall()]

    def get_category(self, category_id):
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM categories WHERE id = ?', (category_id,))
            return self._row_to_dict(cur.fetchone())

    def get_descendant_ids(self, category_id):
        """返回该节点及所有后代 id 列表（不含环）"""
        result = [category_id]
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT id FROM categories
                WHERE parent_id = ? AND is_deleted = 0
            ''', (category_id,))
            for r in cur.fetchall():
                result.extend(self.get_descendant_ids(r['id']))
        return result

    def is_descendant(self, ancestor_id, candidate_id):
        """candidate_id 是否为 ancestor_id 的后代（含自己）"""
        cur_id = candidate_id
        visited = set()
        with self.db.get_connection() as conn:
            c = conn.cursor()
            while cur_id and cur_id not in visited:
                visited.add(cur_id)
                if cur_id == ancestor_id:
                    return True
                c.execute('SELECT parent_id FROM categories WHERE id = ?', (cur_id,))
                row = c.fetchone()
                if not row:
                    return False
                cur_id = row['parent_id']
        return False

    def get_category_path(self, category_id):
        """返回"父 / 子 / 孙"形式的路径字符串"""
        parts = []
        cur_id = category_id
        visited = set()
        with self.db.get_connection() as conn:
            c = conn.cursor()
            while cur_id and cur_id not in visited:
                visited.add(cur_id)
                c.execute('SELECT name, parent_id FROM categories WHERE id = ?', (cur_id,))
                row = c.fetchone()
                if not row:
                    break
                parts.append(row['name'])
                cur_id = row['parent_id']
        return ' / '.join(reversed(parts))

    def get_task_count(self, category_id):
        """统计某分类（含所有后代）的任务数（去重）"""
        all_ids = set(self.get_descendant_ids(category_id))
        all_ids = [x for x in all_ids if x]
        if not all_ids:
            return 0
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            # SQLite JSON 解析使用 json_each
            placeholders = ','.join('?' for _ in all_ids)
            cur.execute(f'''
                SELECT COUNT(DISTINCT t.id) AS cnt
                FROM tasks t, json_each(t.category_ids) AS j
                WHERE j.value IN ({placeholders})
            ''', all_ids)
            row = cur.fetchone()
            return row['cnt'] if row else 0

    # ---------- 写操作 ----------

    def _validate_depth(self, parent_id):
        """返回新节点 depth；若 parent 已为叶子则抛 DEPTH_EXCEEDED"""
        if parent_id is None or parent_id == '':
            return 0
        p = self.get_category(parent_id)
        if not p or p['isDeleted']:
            raise ValueError('PARENT_NOT_FOUND')
        if p['depth'] >= self.MAX_DEPTH:
            raise ValueError('DEPTH_EXCEEDED')
        return p['depth'] + 1

    def _check_duplicate(self, owner_type, owner_id, parent_id, name, exclude_id=None):
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            sql = '''
                SELECT id FROM categories
                WHERE owner_type = ? AND owner_id = ? AND is_deleted = 0
                AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
                AND name = ?
            '''
            params = [owner_type, owner_id, parent_id, parent_id, name]
            if exclude_id:
                sql += ' AND id != ?'
                params.append(exclude_id)
            cur.execute(sql, params)
            if cur.fetchone():
                raise ValueError('DUPLICATE_NAME')

    def create_category(self, name, owner_type='user', owner_id='',
                        parent_id=None, icon='📁', color='#4f46e5',
                        sort_order=None):
        """创建分类。name 在同 owner+parent 下唯一。"""
        if not name or not name.strip():
            raise ValueError('NAME_EMPTY')
        name = name.strip()
        depth = self._validate_depth(parent_id)
        self._check_duplicate(owner_type, owner_id, parent_id, name)
        new_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        if sort_order is None:
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                cur.execute('''
                    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
                    FROM categories
                    WHERE owner_type = ? AND owner_id = ?
                    AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
                ''', (owner_type, owner_id, parent_id, parent_id))
                sort_order = cur.fetchone()['next']
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO categories
                    (id, name, parent_id, depth, owner_type, owner_id,
                     icon, color, sort_order, is_deleted, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ''', (new_id, name, parent_id, depth, owner_type, owner_id,
                  icon, color, sort_order, now, now))
            conn.commit()
        return self.get_category(new_id)

    def update_category(self, category_id, name=None, icon=None, color=None,
                        sort_order=None):
        """修改基础信息。parent_id 修改请使用 move_category"""
        existing = self.get_category(category_id)
        if not existing or existing['isDeleted']:
            raise ValueError('NOT_FOUND')
        sets = []
        params = []
        if name is not None and name.strip():
            self._check_duplicate(
                existing['ownerType'], existing['ownerId'],
                existing['parentId'], name.strip(), exclude_id=category_id)
            sets.append('name = ?')
            params.append(name.strip())
        if icon is not None:
            sets.append('icon = ?')
            params.append(icon)
        if color is not None:
            sets.append('color = ?')
            params.append(color)
        if sort_order is not None:
            sets.append('sort_order = ?')
            params.append(sort_order)
        if not sets:
            return existing
        sets.append('updated_at = ?')
        params.append(datetime.now().isoformat())
        params.append(category_id)
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute(f"UPDATE categories SET {', '.join(sets)} WHERE id = ?", params)
            conn.commit()
        return self.get_category(category_id)

    def move_category(self, category_id, new_parent_id, new_sort_order=None):
        """原子事务：移动分类到 new_parent_id 下；同步更新所有后代 depth。
        拒绝：DEPTH_EXCEEDED / WOULD_CREATE_CYCLE / NOT_FOUND
        """
        cat = self.get_category(category_id)
        if not cat or cat['isDeleted']:
            raise ValueError('NOT_FOUND')

        # 0) 自身 / 子树不能移动到自身子树下
        if new_parent_id and self.is_descendant(category_id, new_parent_id):
            raise ValueError('WOULD_CREATE_CYCLE')

        new_depth = self._validate_depth(new_parent_id)
        depth_delta = new_depth - cat['depth']

        if new_sort_order is None:
            new_sort_order = cat['sortOrder']

        with self.db.get_connection() as conn:
            cur = conn.cursor()
            # 更新当前节点
            cur.execute('''
                UPDATE categories
                SET parent_id = ?, depth = ?, sort_order = ?, updated_at = ?
                WHERE id = ?
            ''', (new_parent_id, new_depth, new_sort_order,
                  datetime.now().isoformat(), category_id))
            # 同步所有后代 depth
            if depth_delta != 0:
                descendants = self.get_descendant_ids(category_id)
                descendants = [x for x in descendants if x != category_id]
                for did in descendants:
                    cur.execute('SELECT depth FROM categories WHERE id = ?', (did,))
                    row = cur.fetchone()
                    if not row:
                        continue
                    cur.execute(
                        'UPDATE categories SET depth = ?, updated_at = ? WHERE id = ?',
                        (row['depth'] + depth_delta, datetime.now().isoformat(), did)
                    )
            conn.commit()
        return self.get_category(category_id)

    def delete_category(self, category_id):
        """安全删除：
        - 有子级 → HAS_CHILDREN
        - 软删除分类本身，并从被引用任务的 category_ids 数组中移除
        返回受影响的 task 数量
        """
        cat = self.get_category(category_id)
        if not cat or cat['isDeleted']:
            raise ValueError('NOT_FOUND')
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            # 1) 有子级阻止
            cur.execute('''
                SELECT id FROM categories
                WHERE parent_id = ? AND is_deleted = 0
            ''', (category_id,))
            if cur.fetchone():
                raise ValueError('HAS_CHILDREN')
            # 2) 软删除分类
            cur.execute('''
                UPDATE categories SET is_deleted = 1, updated_at = ?
                WHERE id = ?
            ''', (datetime.now().isoformat(), category_id))
            # 3) 清理任务引用
            affected = 0
            cur.execute('SELECT id, category_ids FROM tasks')
            for r in cur.fetchall():
                ids = self._parse_json_list(r['category_ids'])
                if category_id in ids:
                    ids = [x for x in ids if x != category_id]
                    cur.execute(
                        'UPDATE tasks SET category_ids = ? WHERE id = ?',
                        (json.dumps(ids), r['id'])
                    )
                    affected += 1
            conn.commit()
        return affected

    def add_category_to_task(self, task_id, category_id):
        """将分类 ID 添加到任务的 category_ids 数组（去重）"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT category_ids FROM tasks WHERE id = ?', (task_id,))
            row = cur.fetchone()
            if not row:
                raise ValueError('TASK_NOT_FOUND')
            ids = self._parse_json_list(row['category_ids'])
            if category_id not in ids:
                ids.append(category_id)
                cur.execute(
                    'UPDATE tasks SET category_ids = ? WHERE id = ?',
                    (json.dumps(ids), task_id)
                )
                conn.commit()

    def set_task_categories(self, task_id, category_ids):
        """设置任务的 category_ids。category_ids=[] 视为"无分类"。"""
        if category_ids is None:
            category_ids = []
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT id FROM tasks WHERE id = ?', (task_id,))
            if not cur.fetchone():
                raise ValueError('TASK_NOT_FOUND')
            cur.execute(
                'UPDATE tasks SET category_ids = ? WHERE id = ?',
                (json.dumps(list(category_ids)), task_id)
            )
            conn.commit()

    @staticmethod
    def _parse_json_list(s):
        if not s:
            return []
        try:
            v = json.loads(s)
            if isinstance(v, list):
                return [str(x) for x in v]
        except (json.JSONDecodeError, TypeError):
            pass
        return []


class GroupManager:
    """协作组管理：CRUD、连接码生成、成员管理"""

    # 避免歧义字符（0/O/1/I/L）
    _CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    def generate_join_code(self) -> str:
        head = ''.join(random.choices(self._CODE_ALPHABET, k=3))
        tail = ''.join(random.choices(self._CODE_ALPHABET, k=3))
        return f'{head}-{tail}'

    # ---------- 群组 CRUD ----------

    def create_group(self, name: str, created_by: str, join_code: str,
                     icon: str = '👥', color: str = '#4f46e5',
                     description: str = None, is_hidden: int = 0) -> 'Group':
        from backend.database.models import Group
        now = datetime.now().isoformat()
        g = Group(id=str(uuid.uuid4()), name=name, join_code=join_code,
                  created_by=created_by, created_at=now, updated_at=now,
                  icon=icon, color=color, description=description, is_hidden=is_hidden)
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''INSERT INTO groups
                (id, name, icon, color, description, join_code, created_by,
                 is_hidden, created_at, updated_at, is_deleted)
                VALUES (?,?,?,?,?,?,?,?,?,?,0)''',
                (g.id, g.name, g.icon, g.color, g.description, g.join_code,
                 g.created_by, g.is_hidden, g.created_at, g.updated_at))
            # 创建者自动加入为 owner
            conn.commit()
        # 添加 owner
        self.add_member(group_id=g.id, user_id=created_by, role='owner')
        return g

    def get_group(self, group_id: str) -> 'Group | None':
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM groups WHERE id = ? AND is_deleted = 0', (group_id,))
            row = cur.fetchone()
            return Group.from_dict(dict(row)) if row else None

    def get_group_by_code(self, join_code: str) -> 'Group | None':
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM groups WHERE join_code = ? AND is_deleted = 0', (join_code,))
            row = cur.fetchone()
            return Group.from_dict(dict(row)) if row else None

    def list_user_groups(self, user_id: str) -> list['Group']:
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''SELECT g.* FROM groups g
                JOIN group_members m ON m.group_id = g.id
                WHERE m.user_id = ? AND g.is_deleted = 0 AND m.last_seen_at IS NOT NULL
                ORDER BY g.created_at DESC''', (user_id,))
            return [Group.from_dict(dict(r)) for r in cur.fetchall()]

    def soft_delete_group(self, group_id: str, by_user: str) -> bool:
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT created_by FROM groups WHERE id = ?', (group_id,))
            row = cur.fetchone()
            if not row or row['created_by'] != by_user:
                return False
            cur.execute('UPDATE groups SET is_deleted = 1, updated_at = ? WHERE id = ?',
                        (datetime.now().isoformat(), group_id))
            conn.commit()
            return True

    # ---------- 成员管理 ----------

    def add_member(self, group_id: str, user_id: str, role: str,
                   share_tasks: int = 0, share_categories: int = 0,
                   share_group_tasks: int = 1, share_history: int = 0) -> 'GroupMember':
        from backend.database.models import GroupMember
        now = datetime.now().isoformat()
        m = GroupMember(id=str(uuid.uuid4()), group_id=group_id, user_id=user_id,
                        role=role, joined_at=now, last_seen_at=now,
                        share_tasks=share_tasks, share_categories=share_categories,
                        share_group_tasks=share_group_tasks, share_history=share_history)
        try:
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                cur.execute('''INSERT INTO group_members
                    (id, group_id, user_id, role, share_tasks, share_categories,
                     share_group_tasks, share_history, joined_at, last_seen_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''',
                    (m.id, m.group_id, m.user_id, m.role, m.share_tasks, m.share_categories,
                     m.share_group_tasks, m.share_history, m.joined_at, m.last_seen_at))
                conn.commit()
        except Exception as e:
            if 'UNIQUE' in str(e):
                raise ValueError('ALREADY_MEMBER') from e
            raise
        return m

    def list_members(self, group_id: str) -> list['GroupMember']:
        from backend.database.models import GroupMember
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at',
                        (group_id,))
            return [GroupMember.from_dict(dict(r)) for r in cur.fetchall()]

    def remove_member(self, group_id: str, user_id: str) -> bool:
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
                        (group_id, user_id))
            conn.commit()
            return cur.rowcount > 0


class MessageManager:
    """群消息管理：发送 / 列表 / 已读 / 软删除"""

    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    def send_message(self, group_id: str, sender_id: str, content: str = None,
                     msg_type: str = 'text', attachment_ids: list = None,
                     reply_to_id: str = None) -> 'Message':
        from backend.database.models import Message
        import uuid
        import json
        from datetime import datetime
        now = datetime.now().isoformat()
        m = Message(id=str(uuid.uuid4()), group_id=group_id, sender_id=sender_id,
                    msg_type=msg_type, content=content, created_at=now, updated_at=now,
                    attachment_ids=json.dumps(attachment_ids or []),
                    reply_to_id=reply_to_id)
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''INSERT INTO messages
                (id, group_id, sender_id, content, msg_type, attachment_ids,
                 reply_to_id, created_at, updated_at, is_deleted, read_by)
                VALUES (?,?,?,?,?,?,?,?,?,0,'{}')''',
                (m.id, m.group_id, m.sender_id, m.content, m.msg_type,
                 m.attachment_ids, m.reply_to_id, m.created_at, m.updated_at))
            conn.commit()
        return m

    def get_message(self, message_id: str) -> 'Message | None':
        from backend.database.models import Message
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM messages WHERE id = ? AND is_deleted = 0', (message_id,))
            row = cur.fetchone()
            return Message.from_dict(dict(row)) if row else None

    def list_messages(self, group_id: str, limit: int = 100, before: str = None) -> list['Message']:
        from backend.database.models import Message
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            if before:
                cur.execute('''SELECT * FROM messages
                    WHERE group_id = ? AND is_deleted = 0 AND created_at < ?
                    ORDER BY created_at ASC LIMIT ?''',
                    (group_id, before, limit))
            else:
                cur.execute('''SELECT * FROM messages
                    WHERE group_id = ? AND is_deleted = 0
                    ORDER BY created_at ASC LIMIT ?''',
                    (group_id, limit))
            return [Message.from_dict(dict(r)) for r in cur.fetchall()]

    def mark_read(self, message_id: str, user_id: str, at: str) -> bool:
        import json
        m = self.get_message(message_id)
        if not m:
            return False
        read_by = json.loads(m.read_by or '{}')
        read_by[user_id] = at
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE messages SET read_by = ? WHERE id = ?',
                        (json.dumps(read_by), message_id))
            conn.commit()
        return True

    def soft_delete_message(self, message_id: str, by_user: str) -> bool:
        from datetime import datetime
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT sender_id FROM messages WHERE id = ?', (message_id,))
            row = cur.fetchone()
            if not row or row['sender_id'] != by_user:
                return False
            cur.execute('UPDATE messages SET is_deleted = 1, updated_at = ? WHERE id = ?',
                        (datetime.now().isoformat(), message_id))
            conn.commit()
            return True


class SyncManager:
    """LAN 同步冲突解决 + 同步日志记录。
    - resolve_conflict：字段级最新时间戳胜出；删除 vs 修改时删除优先（当删除时间更新）
    - log_sync / list_recent_sync_logs：sync_log 表的写入与查询
    """

    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    @staticmethod
    def _ts(entity: dict, *keys) -> str:
        """获取时间戳字段，支持多种命名（updated_at / updatedAt 等）。

        A/B 阶段 get_task / 模型层统一用 camelCase（updatedAt / createdAt），
        C 阶段早期 sync 协议用 snake_case（updated_at / created_at）。
        冲突解决时两种命名都可能出现，故按顺序尝试直到找到第一个非空值。
        """
        if not entity:
            return ''
        for k in keys:
            v = entity.get(k)
            if v:
                return v
        return ''

    def resolve_conflict(self, local: dict, remote: dict, field: str = None) -> dict:
        """字段级最新时间戳胜出；删除 vs 修改时删除优先（当删除时间更新）"""
        if field:
            return remote if self._ts(remote, 'updated_at', 'updatedAt') > self._ts(local, 'updated_at', 'updatedAt') else local

        # 删除 vs 修改
        if remote.get('is_deleted') and not local.get('is_deleted'):
            if self._ts(remote, 'updated_at', 'updatedAt') > self._ts(local, 'updated_at', 'updatedAt'):
                return remote
        if local.get('is_deleted') and not remote.get('is_deleted'):
            if self._ts(local, 'updated_at', 'updatedAt') > self._ts(remote, 'updated_at', 'updatedAt'):
                return local

        # 字段级合并：优先按字段级时间戳，否则回退到实体级 updated_at
        result = dict(local)
        for key, val in remote.items():
            if key.endswith('_at') or key == 'version':
                continue
            if key not in local:
                result[key] = val
            else:
                # 字段级时间戳（带命名兼容）；缺省时回退到实体级 updated_at
                r_ts = self._ts(remote, f'{key}_updated_at', f'{key}_updatedAt') \
                       or self._ts(remote, 'updated_at', 'updatedAt')
                l_ts = self._ts(local, f'{key}_updated_at', f'{key}_updatedAt') \
                       or self._ts(local, 'updated_at', 'updatedAt')
                if r_ts > l_ts:
                    result[key] = val
        return result

    def log_sync(self, entity_type: str, entity_id: str, operation: str,
                 peer_id: str = None, user_id: str = None, has_conflict: int = 0,
                 detail: str = None) -> None:
        import uuid
        import json
        from datetime import datetime
        from backend.database.models import SyncLog
        log = SyncLog(id=str(uuid.uuid4()), entity_type=entity_type, entity_id=entity_id,
                      operation=operation, created_at=datetime.now().isoformat(),
                      peer_id=peer_id, user_id=user_id, has_conflict=has_conflict,
                      detail=json.dumps(detail) if isinstance(detail, (dict, list)) else detail)
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''INSERT INTO sync_log
                (id, entity_type, entity_id, operation, peer_id, user_id,
                 has_conflict, detail, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)''',
                (log.id, log.entity_type, log.entity_id, log.operation,
                 log.peer_id, log.user_id, log.has_conflict, log.detail, log.created_at))
            conn.commit()

    def list_recent_sync_logs(self, limit: int = 50) -> list:
        from backend.database.models import SyncLog
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''SELECT * FROM sync_log
                ORDER BY created_at DESC LIMIT ?''', (limit,))
            return [SyncLog.from_dict(dict(r)) for r in cur.fetchall()]
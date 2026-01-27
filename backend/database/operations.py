"""
TodoList应用的数据库操作
"""

import json
from datetime import datetime
from pathlib import Path
import sqlite3
import os
import sys
from backend.utils.logger import backend_logger
from backend.database.models import Tag, Task, Category


def get_app_data_dir():
    """获取应用数据目录"""
    # 首先检查是否为安卓环境
    is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ

    if is_android:
        # 安卓系统
        try:
            # 尝试使用安卓特定的API获取应用私有目录
            from android.storage import app_storage_path
            base_dir = Path(app_storage_path()) / 'TodoList'
        except ImportError:
            # 备选方案：使用标准的安卓应用数据目录
            if 'ANDROID_DATA' in os.environ:
                base_dir = Path('/data/data') / 'com.yourcompany.todolist' / 'files'
            else:
                # 安卓模拟器或其他情况
                base_dir = Path('/storage/emulated/0/Android/data/com.yourcompany.todolist/files')
    elif os.name == 'nt':  # Windows
        base_dir = Path(os.environ['APPDATA']) / 'TodoList'
    elif os.name == 'posix':  # macOS/Linux
        # 进一步细分Linux和macOS
        if sys.platform == 'darwin':  # macOS
            base_dir = Path.home() / 'Library' / 'Application Support' / 'TodoList'
        else:  # Linux和其他类Unix系统
            # 优先使用XDG标准
            xdg_data_home = os.environ.get('XDG_DATA_HOME')
            if xdg_data_home:
                base_dir = Path(xdg_data_home) / 'TodoList'
            else:
                base_dir = Path.home() / '.local' / 'share' / 'TodoList'
    else:
        base_dir = Path(__file__).parent.parent.parent / 'data'

    os.makedirs(base_dir, exist_ok=True)
    return base_dir


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


class TodoDatabase:
    """Todo数据库操作类"""
    def __init__(self):
        db_path = os.path.join(get_app_data_dir(), 'todo.db')
        
        # 数据库文件路径
        self.db_path = str(db_path) if isinstance(db_path, Path) else db_path
        backend_logger.info(f"数据库路径: {self.db_path}")
        self.init_database()

    def get_connection(self):
        """获取数据库连接"""
        return sqlite3.connect(self.db_path)
    
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
        """添加新任务"""
        task = Task(
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
        
        conn = sqlite3.connect(self.db_path)
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
        
        conn.commit()
        conn.close()

        # 处理标签
        tags = task_data.get('tags', [])
        if tags:
            self.update_task_tags(task.id, tags)

        return task.to_dict()
    
    def get_all_tasks(self):
        """获取所有任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 明确指定字段顺序，避免依赖字段位置
        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks 
            ORDER BY 
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
                'tags': self.get_task_tags(row[0])  # 添加标签信息
            }
            tasks.append(task_dict)
        
        return tasks

    def get_tasks_paginated(self, page=1, page_size=10, category_id=None, status=None, 
                            priority=None, due_date_filter=None, year=None, month=None,
                            search_query=None, custom_date=None):
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
            search_query: 搜索关键词
            custom_date: 自定义日期筛选（用于日历点击）
            
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
                week_end = today.replace(day=today.day + 7) if today.day <= 21 else today.replace(day=28)
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(today.isoformat())
                params.append(week_end.isoformat())
            elif due_date_filter == 'month':
                month_end = today.replace(day=28)  # 简化处理，取月末大致日期
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(today.isoformat())
                params.append(month_end.isoformat())
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
            # 检查是否为标签搜索（以 # 开头）
            if search_query.startswith('#'):
                # 标签搜索
                tag_name = search_query[1:]  # 移除 #
                where_clauses.append('''
                    id IN (SELECT task_id FROM task_tags WHERE tag_id IN (
                        SELECT id FROM tags WHERE name LIKE ?
                    ))
                ''')
                params.append(f'%{tag_name}%')
            else:
                # 普通文本搜索（同时搜索标题、描述和标签）
                where_clauses.append('''
                    (title LIKE ? OR description LIKE ? OR id IN (
                        SELECT task_id FROM task_tags WHERE tag_id IN (
                            SELECT id FROM tags WHERE name LIKE ?
                        )
                    ))
                ''')
                params.extend([f'%{search_query}%', f'%{search_query}%', f'%{search_query}%'])
        
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
                   parent_task_id, created_at, updated_at
            FROM tasks 
            WHERE {where_sql}
            ORDER BY 
                CASE priority 
                    WHEN 'high' THEN 1 
                    WHEN 'medium' THEN 2 
                    WHEN 'low' THEN 3 
                    ELSE 4 
                END,
                due_date ASC,
                created_at DESC
            LIMIT ? OFFSET ?
        '''
        
        cursor.execute(data_sql, params + [page_size, offset])
        rows = cursor.fetchall()
        
        tasks = []
        for row in rows:
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
                   parent_task_id, created_at, updated_at
            FROM tasks WHERE id = ?
        ''', (task_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return None

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
            'tags': self.get_task_tags(task_id)  # 添加标签信息
        }

        conn.close()
        return task_dict
    
    def update_task(self, task_id, task_data, is_update_task_tags = True):
        """更新任务"""
        task = Task(
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None
        )
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE tasks 
            SET title = ?, description = ?, completed = ?, priority = ?,
                category_id = ?, due_date = ?, updated_at = ?
            WHERE id = ?
        ''', (
            task.title, task.description, task.completed, task.priority,
            task.category_id, task.due_date.isoformat() if task.due_date else None,
            datetime.now().isoformat(), task_id
        ))
        
        conn.commit()
        conn.close()

        # 处理标签
        if is_update_task_tags:
            tags = task_data.get('tags', [])
            self.update_task_tags(task_id, tags)

        return task.to_dict()
    
    def delete_task(self, task_id):
        """删除任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        cursor.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))

        conn.commit()
        conn.close()
        
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
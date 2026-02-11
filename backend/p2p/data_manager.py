"""
数据管理模块 - 负责数据库的导出和导入
"""
import os
import sqlite3
import json
import shutil
from pathlib import Path
import sys
from backend.database.operations import get_app_data_dir

# 添加backend目录到Python路径
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

class DataManager:
    """数据管理器，负责数据的导出和导入"""

    def __init__(self, data_dir=None):
        """初始化数据管理器
        
        Args:
            data_dir (str, optional): 数据目录路径。如果为None，则使用配置的默认目录
        """
        if data_dir:
            self.app_data_dir = Path(data_dir)
        else:
            self.app_data_dir = get_app_data_dir()
        
        self.db_path = str(self.app_data_dir / 'todo.db')
        
        # 确保数据目录存在
        os.makedirs(self.app_data_dir, exist_ok=True)

    def export_data(self) -> dict:
        """导出数据库中的所有数据

        Returns:
            包含所有数据的字典，结构为 {'tasks': [...], 'categories': [...], 'settings': {...}}
        """
        try:
            print("路径查询：", self.db_path)
            conn = sqlite3.connect(self.db_path)
            print("连接异常")
            cursor = conn.cursor()
            print("游标异常")

            # 导出任务
            cursor.execute('SELECT * FROM tasks')
            tasks = []
            for row in cursor.fetchall():
                task_dict = {
                    'id': row[0],
                    'title': row[1],
                    'description': row[2],
                    'completed': bool(row[3]),
                    'priority': row[4],
                    'category_id': row[5],
                    'due_date': row[6],
                    'is_recurring': bool(row[7]) if row[7] is not None else False,
                    'recurrence_type': row[8],
                    'recurrence_interval': row[9] if row[9] is not None else 1,
                    'recurrence_count': row[10],
                    'parent_task_id': row[11],
                    'created_at': row[12],
                    'updated_at': row[13]
                }
                tasks.append(task_dict)

            # 导出分类
            cursor.execute('SELECT * FROM categories')
            categories = []
            for row in cursor.fetchall():
                category_dict = {
                    'id': row[0],
                    'name': row[1],
                    'color': row[2],
                    'created_at': row[3]
                }
                categories.append(category_dict)

            # 导出设置
            cursor.execute('SELECT * FROM settings')
            settings = {}
            for row in cursor.fetchall():
                try:
                    settings[row[0]] = json.loads(row[1])
                except:
                    settings[row[0]] = row[1]

            conn.close()

            print("导出数据无异常", str(Path(os.path.join(self.app_data_dir, 'todo.db')).stat().st_mtime))

            return {
                'version': '1.0',
                'export_time': str(Path(os.path.join(self.app_data_dir, 'todo.db')).stat().st_mtime),
                'tasks': tasks,
                'categories': categories,
                'settings': settings
            }

        except Exception as e:
            print(f"导出数据错误: {e}")
            return None

    def import_data(self, data: dict, backup: bool = True) -> bool:
        """导入数据到数据库

        Args:
            data: 要导入的数据字典
            backup: 是否在导入前备份当前数据

        Returns:
            导入是否成功
        """
        try:
            # 备份当前数据库
            if backup:
                backup_path = self._create_backup()
                print(f"已创建数据库备份: {backup_path}")

            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # 清空现有数据
            cursor.execute('DELETE FROM tasks')
            cursor.execute('DELETE FROM categories')
            cursor.execute('DELETE FROM settings')

            # 导入任务
            for task in data.get('tasks', []):
                cursor.execute('''
                    INSERT INTO tasks (id, title, description, completed, priority, category_id,
                                      due_date, is_recurring, recurrence_type, recurrence_interval,
                                      recurrence_count, parent_task_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    task['id'], task['title'], task['description'], task['completed'],
                    task['priority'], task['category_id'], task['due_date'],
                    task['is_recurring'], task['recurrence_type'],
                    task['recurrence_interval'], task['recurrence_count'],
                    task['parent_task_id'], task['created_at'], task['updated_at']
                ))

            # 导入分类
            for category in data.get('categories', []):
                cursor.execute('''
                    INSERT INTO categories (id, name, color, created_at)
                    VALUES (?, ?, ?, ?)
                ''', (category['id'], category['name'], category['color'], category['created_at']))

            # 导入设置
            for key, value in data.get('settings', {}).items():
                value_str = json.dumps(value) if not isinstance(value, str) else value
                cursor.execute('''
                    INSERT INTO settings (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                ''', (key, value_str))

            conn.commit()
            conn.close()

            print("数据导入成功")
            return True

        except Exception as e:
            print(f"导入数据错误: {e}")
            return False

    def get_data_summary(self) -> dict:
        """获取当前数据摘要

        Returns:
            包含数据统计信息的字典
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()

            # 统计任务数
            cursor.execute('SELECT COUNT(*) FROM tasks')
            total_tasks = cursor.fetchone()[0]

            # 统计已完成任务
            cursor.execute('SELECT COUNT(*) FROM tasks WHERE completed = 1')
            completed_tasks = cursor.fetchone()[0]

            # 统计分类数
            cursor.execute('SELECT COUNT(*) FROM categories')
            total_categories = cursor.fetchone()[0]

            # 获取最后更新时间
            cursor.execute('SELECT MAX(updated_at) FROM tasks')
            last_updated = cursor.fetchone()[0]

            conn.close()

            return {
                'total_tasks': total_tasks,
                'completed_tasks': completed_tasks,
                'total_categories': total_categories,
                'last_updated': last_updated
            }

        except Exception as e:
            print(f"获取数据摘要错误: {e}")
            return None

    def has_data(self) -> bool:
        """检查是否有数据"""
        summary = self.get_data_summary()
        return summary is not None and summary['total_tasks'] > 0

    def _create_backup(self) -> str:
        """创建数据库备份"""
        import time
        backup_dir = self.app_data_dir / 'backups'
        backup_dir.mkdir(exist_ok=True)

        timestamp = time.strftime('%Y%m%d_%H%M%S')
        backup_path = backup_dir / f'todo_backup_{timestamp}.db'

        shutil.copy2(self.db_path, backup_path)
        return str(backup_path)

    def switch_data_directory(self, new_data_dir: str) -> bool:
        """切换数据目录
        
        Args:
            new_data_dir (str): 新的数据目录路径
            
        Returns:
            bool: 切换是否成功
        """
        try:
            new_path = Path(new_data_dir)
            
            # 验证新目录
            if not new_path.exists():
                new_path.mkdir(parents=True, exist_ok=True)
            
            if not os.access(new_path, os.R_OK | os.W_OK):
                raise PermissionError(f"没有对目录 {new_data_dir} 的读写权限")
            
            # 如果当前数据库存在，先备份
            if os.path.exists(self.db_path):
                self._create_backup()
            
            # 更新实例属性
            self.app_data_dir = new_path
            self.db_path = str(new_path / 'todo.db')
            
            # 初始化新数据库（如果不存在）
            if not os.path.exists(self.db_path):
                self._initialize_new_database()
            
            print(f"数据目录已切换到: {new_data_dir}")
            return True
            
        except Exception as e:
            print(f"切换数据目录失败: {e}")
            return False
    
    def _initialize_new_database(self):
        """初始化新数据库表结构"""
        try:
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
            
            # 创建标签相关表
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
            
            conn.commit()
            conn.close()
            
        except Exception as e:
            print(f"初始化新数据库失败: {e}")
            raise

    def restore_backup(self, backup_path: str) -> bool:
        """从备份恢复数据库

        Args:
            backup_path: 备份文件路径

        Returns:
            恢复是否成功
        """
        try:
            # 先备份当前数据
            self._create_backup()

            # 恢复备份
            shutil.copy2(backup_path, self.db_path)
            print(f"已从备份恢复: {backup_path}")
            return True

        except Exception as e:
            print(f"恢复备份错误: {e}")
            return False

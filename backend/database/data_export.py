"""
数据管理模块 - 负责数据库的导出和导入
"""
from __future__ import annotations

import os
import sqlite3
import json
import shutil
from pathlib import Path
import sys
from typing import Any, Callable, Dict, List, Optional
from backend.utils.logger import LogManager

# 添加backend目录到Python路径
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

class DataExportManager(LogManager):
    """数据管理器，负责数据的导出和导入"""

    def __init__(self, data_file: Optional[str] = None) -> None:
        """初始化数据管理器
        
        Args:
            data_file (str, optional): 数据文件路径。如果为None，则使用配置的默认文件
        """
        super().__init__()
        if data_file:
            self.data_file = Path(data_file)
        else:
            from backend.config import get_current_data_file
            self.data_file = Path(get_current_data_file())
        
        # 确保父目录存在
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        
        # 数据库路径就是文件路径
        self.db_path = str(self.data_file)

        # 设置SQLite文本处理，避免编码问题
        self._text_factory: Callable[[Any], Any] = (
            lambda x: str(x, 'utf-8', 'replace') if isinstance(x, bytes) else x
        )

    # 获取安全的数据连接
    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.text_factory = self._text_factory
        return conn

    @staticmethod
    def _ensure_attachments_table(cursor: sqlite3.Cursor) -> None:
        """确保 attachments 表存在"""
        cursor.execute('''
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
        ''')

    # 简单的字符串清理
    def _clean_str(self, s: Any) -> Any:
        if s is None or not isinstance(s, str):
            return s
        try:
            return s.encode('utf-8', errors='ignore').decode('utf-8')
        except:
            return str(s)

    def export_data(self, include_attachments: bool = True) -> Optional[Dict[str, Any]]:
        """导出数据库中的所有数据

        Args:
            include_attachments: 是否导出附件数据（元信息 + 实体文件）。
                为 False 时不导出任何附件数据。

        Returns:
            包含所有数据的字典，结构为
            {'tasks': [...], 'categories': [...], 'attachments': [...],
             'attachment_files': {...}, 'settings': {...}}
        """
        try:
            self.get_logger.info("路径查询：%s", self.db_path)
            conn = self._get_connection()
            cursor = conn.cursor()

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

            # 导出附件元信息（可选，实体文件随后单独打包）
            attachments: List[Dict[str, Any]] = []
            if include_attachments:
                try:
                    cursor.execute('''
                        SELECT id, task_id, type, name, file_path, url, size, mime_type,
                               is_image, created_at, updated_at
                        FROM attachments
                    ''')
                    for row in cursor.fetchall():
                        attachments.append({
                            'id': row[0],
                            'task_id': row[1],
                            'type': row[2],
                            'name': row[3],
                            'file_path': row[4],
                            'url': row[5],
                            'size': row[6],
                            'mime_type': row[7],
                            'is_image': row[8],
                            'created_at': row[9],
                            'updated_at': row[10]
                        })
                except sqlite3.OperationalError:
                    attachments = []

            conn.close()

            self.get_logger.info("导出数据无异常")

            result: Dict[str, Any] = {
                'version': '1.0',
                'export_time': str(Path(self.db_path).stat().st_mtime),
                'tasks': tasks,
                'categories': categories,
                'attachments': attachments,
                'settings': settings,
                'include_attachments': include_attachments
            }
            if include_attachments:
                # 打包附件实体文件（base64），供接收端按原相对路径还原
                result['attachment_files'] = self._collect_attachment_files(attachments)
            return result

        except Exception as e:
            self.get_logger.error(f"导出数据错误: {e}")
            return None

    def _collect_attachment_files(self, attachments: List[Dict[str, Any]]) -> Dict[str, str]:
        """打包附件实体文件为 base64（仅 file 类型且本地存在的文件）"""
        try:
            from backend.features.attachment.attachment_service import get_attachment_service
            rel_paths = [
                a.get('file_path') for a in (attachments or [])
                if a.get('type', 'file') == 'file' and a.get('file_path')
            ]
            return get_attachment_service().collect_files(rel_paths)
        except Exception as e:
            self.get_logger.error(f"打包附件实体文件失败: {e}")
            return {}

    def _restore_attachment_files(self, files: Dict[str, str]) -> int:
        """还原附件实体文件到本地附件存储目录"""
        try:
            from backend.features.attachment.attachment_service import get_attachment_service
            return get_attachment_service().restore_files(files)
        except Exception as e:
            self.get_logger.error(f"还原附件实体文件失败: {e}")
            return 0

    def import_data(self, data: Dict[str, Any], backup: bool = True) -> bool:
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
                self.get_logger.info(f"已创建数据库备份: {backup_path}")

            conn = self._get_connection()
            cursor = conn.cursor()

            # 清空现有数据
            self._ensure_attachments_table(cursor)
            cursor.execute('DELETE FROM attachments')
            cursor.execute('DELETE FROM task_tags')
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
                    task['id'],
                    self._clean_str(task['title']),
                    self._clean_str(task['description']),
                    task['completed'],
                    task['priority'],
                    task['category_id'],
                    task['due_date'],
                    task['is_recurring'],
                    task['recurrence_type'],
                    task['recurrence_interval'],
                    task['recurrence_count'],
                    task['parent_task_id'],
                    task['created_at'],
                    task['updated_at']
                ))

            # 导入分类
            for category in data.get('categories', []):
                cursor.execute('''
                    INSERT INTO categories (id, name, color, created_at)
                    VALUES (?, ?, ?, ?)
                ''', (
                    category['id'],
                    self._clean_str(category['name']),
                    category['color'],
                    category['created_at']
                ))

            # 导入设置
            for key, value in data.get('settings', {}).items():
                # 使用 ensure_ascii=False 避免编码问题
                value_str = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
                cursor.execute('''
                    INSERT INTO settings (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                ''', (key, value_str))

            # 导入附件元信息（仅在有对应任务时导入，避免产生孤儿数据）
            for attachment in data.get('attachments', []) or []:
                if not attachment.get('task_id'):
                    continue
                cursor.execute('SELECT id FROM tasks WHERE id = ?', (attachment['task_id'],))
                if not cursor.fetchone():
                    continue
                cursor.execute('''
                    INSERT OR REPLACE INTO attachments
                        (id, task_id, type, name, file_path, url, size, mime_type,
                         is_image, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    attachment.get('id'),
                    attachment.get('task_id'),
                    attachment.get('type', 'file'),
                    self._clean_str(attachment.get('name')),
                    attachment.get('file_path'),
                    attachment.get('url'),
                    attachment.get('size'),
                    attachment.get('mime_type'),
                    attachment.get('is_image', 0),
                    attachment.get('created_at'),
                    attachment.get('updated_at')
                ))

            conn.commit()
            conn.close()

            # 还原附件实体文件（如传输方携带附件；未携带则不做任何处理）
            attachment_files = data.get('attachment_files') or {}
            if attachment_files:
                restored = self._restore_attachment_files(attachment_files)
                self.get_logger.info(f"已还原 {restored} 个附件实体文件")

            self.get_logger.info("数据导入成功")
            return True

        except Exception as e:
            self.get_logger.error(f"导入数据错误: {e}")
            return False

    def get_data_summary(self) -> Optional[Dict[str, Any]]:
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
            self.get_logger.error(f"获取数据摘要错误: {e}")
            return None

    def has_data(self) -> bool:
        """检查是否有数据"""
        summary = self.get_data_summary()
        return summary is not None and summary['total_tasks'] > 0

    def _create_backup(self) -> str:
        """创建数据库备份"""
        import time
        backup_dir = self.data_file.parent / 'backups'
        backup_dir.mkdir(exist_ok=True)

        timestamp = time.strftime('%Y%m%d_%H%M%S')
        backup_path = backup_dir / f'todo_backup_{timestamp}.db'

        shutil.copy2(self.db_path, backup_path)
        return str(backup_path)

    def switch_data_file(self, new_data_file: str) -> bool:
        """切换数据文件
        
        Args:
            new_data_file (str): 新的数据文件路径
            
        Returns:
            bool: 切换是否成功
        """
        try:
            new_path = Path(new_data_file)
            
            # 验证新文件
            if new_path.suffix.lower() not in ['.db']:
                raise ValueError("仅支持 .db 文件")
            
            # 确保父目录存在
            new_path.parent.mkdir(parents=True, exist_ok=True)
            
            if new_path.exists() and not os.access(new_path, os.R_OK | os.W_OK):
                raise PermissionError(f"没有对文件 {new_data_file} 的读写权限")
            elif not new_path.exists() and not os.access(new_path.parent, os.W_OK):
                raise PermissionError(f"没有在目录 {new_path.parent} 创建文件的权限")
            
            # 如果当前数据库存在，先备份
            if os.path.exists(self.db_path):
                self._create_backup()
            
            # 更新实例属性
            self.data_file = new_path
            self.db_path = str(new_path)
            
            # 初始化新数据库（如果不存在）
            if not os.path.exists(self.db_path):
                self._initialize_new_database()
            
            self.get_logger.info(f"数据文件已切换到: {new_data_file}")
            return True
            
        except Exception as e:
            self.get_logger.error(f"切换数据文件失败: {e}")
            return False
    
    def _initialize_new_database(self) -> None:
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

            # 创建附件表
            self._ensure_attachments_table(cursor)

            conn.commit()
            conn.close()
            
        except Exception as e:
            self.get_logger.error(f"初始化新数据库失败: {e}")
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
            self.get_logger.info(f"已从备份恢复: {backup_path}")
            return True

        except Exception as e:
            self.get_logger.error(f"恢复备份错误: {e}")
            return False

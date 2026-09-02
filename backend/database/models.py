"""
TodoList应用的数据模型定义
"""
from __future__ import annotations

from datetime import datetime
import uuid
from typing import Any, Dict, Optional


class Task:
    """任务数据模型"""
    
    def __init__(self, id: Optional[str] = None, title: str = '', description: str = '',
                 completed: bool = False, priority: str = 'none', category_id: Optional[str] = None,
                 due_date: Optional[datetime] = None, is_recurring: bool = False,
                 recurrence_type: Optional[str] = None, recurrence_interval: int = 1,
                 recurrence_count: Optional[int] = None,
                 parent_task_id: Optional[str] = None) -> None:
        self.id = id or str(uuid.uuid4())
        self.title = title
        self.description = description
        self.completed = completed
        self.priority = priority  # 'high', 'medium', 'low', 'none'
        self.category_id = category_id
        self.due_date = due_date
        self.is_recurring = is_recurring  # 是否为周期性任务
        self.recurrence_type = recurrence_type  # 'daily', 'weekly', 'monthly', 'yearly'
        self.recurrence_interval = recurrence_interval  # 间隔数
        self.recurrence_count = recurrence_count  # 循环次数，None表示无限循环
        self.parent_task_id = parent_task_id  # 父任务ID，用于周期性任务的子任务
        self.created_at = datetime.now()
        self.updated_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'completed': self.completed,
            'priority': self.priority,
            'categoryId': self.category_id,
            'dueDate': self.due_date.isoformat() if self.due_date else None,
            'isRecurring': self.is_recurring,
            'recurrenceType': self.recurrence_type,
            'recurrenceInterval': self.recurrence_interval,
            'recurrenceCount': self.recurrence_count,
            'parentTaskId': self.parent_task_id,
            'createdAt': self.created_at.isoformat(),
            'updatedAt': self.updated_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Task:
        """从字典创建Task实例"""
        task = cls(
            id=data.get('id'),
            title=data.get('title', ''),
            description=data.get('description', ''),
            completed=data.get('completed', False),
            priority=data.get('priority', 'none'),
            category_id=data.get('categoryId'),
            due_date=datetime.fromisoformat(data['dueDate']) if data.get('dueDate') else None,
            is_recurring=data.get('isRecurring', False),
            recurrence_type=data.get('recurrenceType'),
            recurrence_interval=data.get('recurrenceInterval', 1),
            recurrence_count=data.get('recurrenceCount'),
            parent_task_id=data.get('parentTaskId')
        )
        if 'createdAt' in data:
            task.created_at = datetime.fromisoformat(data['createdAt'])
        if 'updatedAt' in data:
            task.updated_at = datetime.fromisoformat(data['updatedAt'])
        return task


class Category:
    """分类数据模型"""
    
    def __init__(self, id: Optional[str] = None, name: str = '',
                 color: str = '#007bff') -> None:
        self.id = id or str(uuid.uuid4())
        self.name = name
        self.color = color
        self.created_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'createdAt': self.created_at.isoformat()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Category:
        """从字典创建Category实例"""
        category = cls(
            id=data.get('id'),
            name=data.get('name', ''),
            color=data.get('color', '#007bff')
        )
        if 'createdAt' in data:
            category.created_at = datetime.fromisoformat(data['createdAt'])
        return category


class Tag:
    """标签数据模型"""

    def __init__(self, id: Optional[str] = None, name: str = '',
                 color: str = '#6c757d') -> None:
        self.id = id or str(uuid.uuid4())
        self.name = name  # 标签名称，不包含#符号
        self.color = color
        self.created_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'createdAt': self.created_at.isoformat()
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Tag:
        """从字典创建Tag实例"""
        tag = cls(
            id=data.get('id'),
            name=data.get('name', ''),
            color=data.get('color', '#6c757d')
        )
        if 'createdAt' in data:
            tag.created_at = datetime.fromisoformat(data['createdAt'])
        return tag
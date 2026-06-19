"""
TodoList应用的数据模型定义
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional, List, Dict
import uuid


class Task:
    """任务数据模型"""
    
    def __init__(self, id=None, title='', description='', completed=False, 
                 priority='none', category_id=None, due_date=None, 
                 is_recurring=False, recurrence_type=None, recurrence_interval=1, 
                 recurrence_count=None, parent_task_id=None):
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
    
    def to_dict(self):
        """转换为字典格式"""
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
    def from_dict(cls, data):
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
    
    def __init__(self, id=None, name='', color='#007bff'):
        self.id = id or str(uuid.uuid4())
        self.name = name
        self.color = color
        self.created_at = datetime.now()
    
    def to_dict(self):
        """转换为字典格式"""
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'createdAt': self.created_at.isoformat()
        }
    
    @classmethod
    def from_dict(cls, data):
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

    def __init__(self, id=None, name='', color='#6c757d'):
        self.id = id or str(uuid.uuid4())
        self.name = name  # 标签名称，不包含#符号
        self.color = color
        self.created_at = datetime.now()

    def to_dict(self):
        """转换为字典格式"""
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'createdAt': self.created_at.isoformat()
        }

    @classmethod
    def from_dict(cls, data):
        """从字典创建Tag实例"""
        tag = cls(
            id=data.get('id'),
            name=data.get('name', ''),
            color=data.get('color', '#6c757d')
        )
        if 'createdAt' in data:
            tag.created_at = datetime.fromisoformat(data['createdAt'])
        return tag


class User:
    """用户数据模型"""

    def __init__(self, id=None, display_name='', unit=None, department=None,
                 role=None, avatar_color='#4f46e5', created_at=None,
                 last_active_at=None, is_deleted=False):
        self.id = id or str(uuid.uuid4())
        self.display_name = display_name
        self.unit = unit
        self.department = department
        self.role = role
        self.avatar_color = avatar_color
        self.created_at = created_at or datetime.now()
        self.last_active_at = last_active_at
        self.is_deleted = is_deleted

    def to_dict(self):
        """转换为字典格式"""
        return {
            'id': self.id,
            'displayName': self.display_name,
            'unit': self.unit,
            'department': self.department,
            'role': self.role,
            'avatarColor': self.avatar_color,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'lastActiveAt': self.last_active_at.isoformat() if self.last_active_at else None,
            'isDeleted': self.is_deleted
        }

    @classmethod
    def from_dict(cls, data):
        """从字典创建User实例"""
        user = cls(
            id=data.get('id'),
            display_name=data.get('displayName', ''),
            unit=data.get('unit'),
            department=data.get('department'),
            role=data.get('role'),
            avatar_color=data.get('avatarColor', '#4f46e5'),
            is_deleted=bool(data.get('isDeleted', False))
        )
        if data.get('createdAt'):
            user.created_at = datetime.fromisoformat(data['createdAt'])
        if data.get('lastActiveAt'):
            user.last_active_at = datetime.fromisoformat(data['lastActiveAt'])
        return user


class UserSession:
    """用户会话模型"""

    def __init__(self, token, user_id, created_at=None, last_used_at=None):
        self.token = token
        self.user_id = user_id
        self.created_at = created_at or datetime.now()
        self.last_used_at = last_used_at or datetime.now()

    def to_dict(self):
        """转换为字典格式"""
        return {
            'token': self.token,
            'userId': self.user_id,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'lastUsedAt': self.last_used_at.isoformat() if self.last_used_at else None
        }


class TaskAuditLog:
    """任务审计日志模型"""

    def __init__(self, id=None, task_id='', user_id='', action='',
                 field=None, old_value=None, new_value=None, created_at=None):
        self.id = id or str(uuid.uuid4())
        self.task_id = task_id
        self.user_id = user_id
        self.action = action  # create/update/complete/delete/restore
        self.field = field
        self.old_value = old_value
        self.new_value = new_value
        self.created_at = created_at or datetime.now()

    def to_dict(self):
        """转换为字典格式"""
        return {
            'id': self.id,
            'taskId': self.task_id,
            'userId': self.user_id,
            'action': self.action,
            'field': self.field,
            'oldValue': self.old_value,
            'newValue': self.new_value,
            'createdAt': self.created_at.isoformat() if self.created_at else None
        }


class Category:
    """多级分类数据模型（最多 3 级）"""

    def __init__(self, id=None, name='', parent_id=None, depth=0,
                 owner_type='user', owner_id='',
                 icon='📁', color='#4f46e5', sort_order=0,
                 is_deleted=0, created_at=None, updated_at=None):
        self.id = id or str(uuid.uuid4())
        self.name = name
        self.parent_id = parent_id
        self.depth = depth
        self.owner_type = owner_type
        self.owner_id = owner_id
        self.icon = icon
        self.color = color
        self.sort_order = sort_order
        self.is_deleted = is_deleted
        self.created_at = created_at or datetime.now()
        self.updated_at = updated_at or datetime.now()

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'parentId': self.parent_id,
            'depth': self.depth,
            'ownerType': self.owner_type,
            'ownerId': self.owner_id,
            'icon': self.icon,
            'color': self.color,
            'sortOrder': self.sort_order,
            'isDeleted': bool(self.is_deleted),
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'updatedAt': self.updated_at.isoformat() if self.updated_at else None,
        }

    @classmethod
    def from_dict(cls, d):
        if not d:
            return None
        return cls(
            id=d.get('id'),
            name=d.get('name', ''),
            parent_id=d.get('parent_id') or d.get('parentId'),
            depth=d.get('depth', 0),
            owner_type=d.get('owner_type') or d.get('ownerType') or 'user',
            owner_id=d.get('owner_id') or d.get('ownerId') or '',
            icon=d.get('icon', '📁'),
            color=d.get('color', '#4f46e5'),
            sort_order=d.get('sort_order') or d.get('sortOrder') or 0,
            is_deleted=d.get('is_deleted', 0) or d.get('isDeleted', 0) or 0,
            created_at=cls._parse_dt(d.get('created_at') or d.get('createdAt')),
            updated_at=cls._parse_dt(d.get('updated_at') or d.get('updatedAt')),
        )

    @staticmethod
    def _parse_dt(v):
        if v is None or v == '':
            return None
        if isinstance(v, datetime):
            return v
        try:
            return datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        except Exception:
            return None


# ===== C 阶段：协作 / 群组 / 同步 相关数据模型 =====

@dataclass
class Group:
    id: str
    name: str
    join_code: str
    created_by: str
    created_at: str
    updated_at: str
    icon: str = '👥'
    color: str = '#4f46e5'
    description: Optional[str] = None
    is_hidden: int = 0
    is_deleted: int = 0

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class GroupMember:
    id: str
    group_id: str
    user_id: str
    role: str  # 'owner' / 'member'
    joined_at: str
    share_tasks: int = 0
    share_categories: int = 0
    share_group_tasks: int = 1
    share_history: int = 0
    last_seen_at: Optional[str] = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class Message:
    id: str
    group_id: str
    sender_id: str
    msg_type: str  # 'text'/'file'/'image'/'system'
    created_at: str
    updated_at: str
    content: Optional[str] = None
    attachment_ids: Optional[str] = None  # JSON 数组
    reply_to_id: Optional[str] = None
    is_deleted: int = 0
    read_by: Optional[str] = None  # JSON {user_id: read_at}

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class Attachment:
    id: str
    file_hash: str
    file_name: str
    file_size: int
    storage_path: str
    uploaded_by: str
    created_at: str
    message_id: Optional[str] = None
    mime_type: Optional[str] = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class SyncLog:
    id: str
    entity_type: str  # 'task'/'category'/'message'/'group'/'attachment'
    entity_id: str
    operation: str  # 'push'/'pull'/'conflict'/'reject'
    created_at: str
    peer_id: Optional[str] = None
    user_id: Optional[str] = None
    has_conflict: int = 0
    detail: Optional[str] = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class FileStorage:
    file_hash: str
    storage_path: str
    file_size: int
    created_at: str
    ref_count: int = 1

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


# ===== D 阶段：节点注册表 / 网络事件日志 =====

@dataclass
class NetworkNode:
    """本机视角下的远端网络节点"""
    id: str
    last_seen: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    address: Optional[str] = None  # ip:port
    last_sync_at: Optional[str] = None
    status: str = 'online'  # online / syncing / offline
    protocol_version: Optional[str] = None
    group_ids: Optional[str] = None  # JSON 数组

    def to_dict(self):
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})


@dataclass
class NetworkEvent:
    """网络事件：连接/断开/握手成功/握手失败/协议错误/冲突"""
    id: str
    type: str  # peer_joined / peer_left / handshake_ok / handshake_fail / protocol_error / conflict
    created_at: str
    peer_id: Optional[str] = None
    user_id: Optional[str] = None
    detail: Optional[str] = None  # JSON / 文本

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict):
        keys = {f for f in cls.__dataclass_fields__}
        return cls(**{k: d[k] for k in keys if k in d})
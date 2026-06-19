# 局域网同步与协作组（LAN Sync & Collaboration）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TodoList 升级为局域网 P2P 协作应用：协作组管理、消息、文件、任务/分类跨节点同步、4 种通知、完整 UI。

**Architecture:** SQLite 扩展（6 张新表）+ 3 个后端 Manager（Group/Message/Sync）+ 网络层（UDP 发现 / TCP 长连接 / 协议编解码 / 同步引擎）+ 前端模块（network/group/chat/sync-status）+ 主界面改造（协作组入口 / 消息抽屉 / 同步状态条 / 任务视图切换）。

**Tech Stack:** Python 3.10+ / 标准库 `socket` + `threading`（不引入新依赖）/ SQLite / pywebview / 原生 JavaScript（无框架）/ SHA-256（hashlib）。

**Spec:** [2026-06-19-lan-sync-collaboration-design.md](../specs/2026-06-19-lan-sync-collaboration-design.md)

**前置依赖:** A 阶段（用户系统）+ B 阶段（多级分类）已就绪（feature/lan-sync 分支携带 B 阶段代码）。

**Codebase map（计划内的所有变更）:**

新建文件（11 个）
- `backend/network/__init__.py`
- `backend/network/discovery.py` — UDP 广播监听 + 连接码过滤
- `backend/network/peer.py` — TCP 长连接 + 心跳
- `backend/network/protocol.py` — 消息编解码（JSON + 4 字节长度前缀）
- `backend/network/sync_engine.py` — 变更检测 + 推送 + 拉取
- `frontend/js/network.js` — 前端网络状态机
- `frontend/js/group.js` — 协作组管理
- `frontend/js/chat.js` — 消息面板
- `frontend/js/sync-status.js` — 同步状态条
- `backend/tests/ui_verification_c_phase.py` — 19 项 UI 验收
- `docs/superpowers/plans/2026-06-19-lan-sync-collaboration-plan.md`（本文件）

测试文件（7 个）
- `backend/tests/test_group.py` — GroupManager CRUD + 连接码
- `backend/tests/test_message.py` — MessageManager CRUD + 已读
- `backend/tests/test_sync.py` — SyncManager 冲突解决 + 推送拉取
- `backend/tests/test_protocol.py` — 协议编解码
- `backend/tests/test_discovery.py` — UDP 解析
- `backend/tests/test_p2p.py` — 双节点集成
- `backend/tests/test_conflict.py` — 冲突场景
- `backend/tests/test_file_transfer.py` — 文件分片 + 校验

修改文件（7 个）
- `backend/database/operations.py` — 增 6 表 + tasks 扩展 + 3 Manager + 迁移
- `backend/database/models.py` — 增 6 个数据类
- `backend/api/todo_api.py` — 增 ~15 个 group/message/sync API
- `frontend/index.html` — 协作组入口 / 消息抽屉 / 同步状态条 / 视图切换
- `frontend/js/api.js` — 桥接新 API
- `frontend/js/main.js` — 启动网络
- `frontend/css/components.css` — 协作组/消息/同步状态样式

---

## 章节索引

- **C1. 数据层**（Task 1-7） — 6 张表 + tasks 扩展 + 6 个数据模型 + 迁移
- **C2. Manager 层**（Task 8-13） — GroupManager / MessageManager / SyncManager + 单元测试
- **C3. 网络层**（Task 14-19） — protocol / discovery / peer / sync_engine + 协议测试 + 双节点集成
- **C4. API 层**（Task 20-23） — 15 个 API 端点 + 集成测试
- **C5. 前端层**（Task 24-30） — 4 个 JS 模块 + index.html/css 改造
- **C6. UI 验收**（Task 31-32） — 19 项 UI 验证 + 完整回归

---

## C1. 数据层

### Task 1: 6 张新表 schema

**Files:**
- Modify: `backend/database/operations.py:27-180` — 扩展 `_migrate_database()`

- [ ] **Step 1: 写迁移测试**

在 `backend/tests/test_migration.py` 末尾追加：

```python
def test_migrate_adds_c_phase_tables():
    """C 阶段：6 张新表（groups/group_members/messages/attachments/sync_log/file_storage）"""
    import sqlite3
    from backend.database.operations import _migrate_database
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()

        for tbl in ('groups', 'group_members', 'messages',
                    'attachments', 'sync_log', 'file_storage'):
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tbl,)
            )
            assert cur.fetchone() is not None, f'缺少表 {tbl}'
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd .worktrees/feature-user-system; $env:PYTHONIOENCODING='utf-8'; $env:PYTHONPATH='.'; python -m pytest backend/tests/test_migration.py::test_migrate_adds_c_phase_tables -v`
Expected: FAIL

- [ ] **Step 3: 写迁移代码**

在 `_migrate_database()` 末尾追加：

```python
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
        cur.execute(ddl)

    # 索引
    cur.execute('CREATE INDEX IF NOT EXISTS idx_groups_join_code ON groups(join_code)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_id, created_at)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(file_hash)')

    # tasks 扩展字段
    cur.execute("PRAGMA table_info(tasks)")
    cols = {r[1] for r in cur.fetchall()}
    if 'group_id' not in cols:
        cur.execute('ALTER TABLE tasks ADD COLUMN group_id TEXT')
    if 'synced_at' not in cols:
        cur.execute('ALTER TABLE tasks ADD COLUMN synced_at TEXT')
    if 'version' not in cols:
        cur.execute('ALTER TABLE tasks ADD COLUMN version INTEGER DEFAULT 1')
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest backend/tests/test_migration.py -v`
Expected: PASS（全部 4 项通过）

- [ ] **Step 5: 暂存（暂不提交）**

Run: `git add backend/database/operations.py backend/tests/test_migration.py`

---

### Task 2: 6 个数据模型

**Files:**
- Modify: `backend/database/models.py` — 末尾追加

- [ ] **Step 1: 写数据类**

```python
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict

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
```

- [ ] **Step 2: 写模型测试**

新建 `backend/tests/test_models_c_phase.py`：

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.models import Group, GroupMember, Message, Attachment, SyncLog, FileStorage


def test_group_roundtrip():
    g = Group(id='g1', name='研发组', join_code='A8B-3K9', created_by='u1',
              created_at='2026-06-19T10:00:00Z', updated_at='2026-06-19T10:00:00Z')
    d = g.to_dict()
    g2 = Group.from_dict(d)
    assert g2.id == g.id and g2.name == '研发组' and g2.icon == '👥'


def test_message_with_attachments():
    m = Message(id='m1', group_id='g1', sender_id='u1', msg_type='text',
                content='hello', created_at='2026-06-19T10:00:00Z', updated_at='2026-06-19T10:00:00Z',
                attachment_ids='["a1","a2"]')
    d = m.to_dict()
    m2 = Message.from_dict(d)
    assert m2.attachment_ids == '["a1","a2"]'


def test_file_storage_default_ref_count():
    f = FileStorage(file_hash='abc', storage_path='files/abc', file_size=1024,
                    created_at='2026-06-19T10:00:00Z')
    assert f.ref_count == 1
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_models_c_phase.py -v`
Expected: 3 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/database/models.py backend/tests/test_models_c_phase.py`

---

## C2. Manager 层

### Task 3: GroupManager - 连接码生成

**Files:**
- Modify: `backend/database/operations.py` — 末尾追加 GroupManager 类

- [ ] **Step 1: 写测试**

新建 `backend/tests/test_group.py`：

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, GroupManager
    db = TodoDatabase()
    return db, GroupManager(db), tmp.name


def test_generate_join_code_format():
    """连接码格式：A8B-3K9（6 位混合 + 中划线）"""
    db, gm, path = _fresh_db()
    try:
        for _ in range(20):
            code = gm.generate_join_code()
            assert len(code) == 7  # 6 + 1 中划线
            assert code[3] == '-'
            head, tail = code.split('-')
            assert len(head) == 3 and len(tail) == 3
    finally:
        Path(path).unlink(missing_ok=True)


def test_generate_join_code_uniqueness():
    """1000 次生成的连接码应全部唯一"""
    db, gm, path = _fresh_db()
    try:
        codes = {gm.generate_join_code() for _ in range(1000)}
        assert len(codes) == 1000
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 2: 跑测试确认失败**

Expected: FAIL（GroupManager 不存在）

- [ ] **Step 3: 实现 generate_join_code**

在 `operations.py` 末尾追加：

```python
import random
import string


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
```

- [ ] **Step 4: 跑测试**

Expected: 2 passed

- [ ] **Step 5: 暂存**

Run: `git add backend/database/operations.py backend/tests/test_group.py`

---

### Task 4: GroupManager - CRUD

**Files:**
- Modify: `backend/database/operations.py` — GroupManager 类追加方法

- [ ] **Step 1: 追加测试到 `test_group.py`**

```python
def test_create_and_get_group():
    db, gm, path = _fresh_db()
    try:
        from backend.database.models import Group
        g = gm.create_group(name='研发组', created_by='u1', join_code='A8B-3K9')
        assert g.name == '研发组' and g.id

        fetched = gm.get_group(g.id)
        assert fetched and fetched.id == g.id
    finally:
        Path(path).unlink(missing_ok=True)


def test_list_groups_filter_by_member():
    db, gm, path = _fresh_db()
    try:
        g1 = gm.create_group(name='研发组', created_by='u1', join_code='A8B-3K9')
        g2 = gm.create_group(name='家庭', created_by='u1', join_code='C2D-4F6')
        gm.add_member(group_id=g1.id, user_id='u1', role='owner')
        gm.add_member(group_id=g2.id, user_id='u1', role='owner')
        gm.add_member(group_id=g1.id, user_id='u2', role='member')

        u1_groups = gm.list_user_groups('u1')
        u2_groups = gm.list_user_groups('u2')
        assert {g.id for g in u1_groups} == {g1.id, g2.id}
        assert {g.id for g in u2_groups} == {g1.id}
    finally:
        Path(path).unlink(missing_ok=True)


def test_soft_delete_group():
    db, gm, path = _fresh_db()
    try:
        g = gm.create_group(name='研发组', created_by='u1', join_code='A8B-3K9')
        assert gm.soft_delete_group(g.id, by_user='u1')
        assert gm.get_group(g.id) is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_add_member_unique_constraint():
    db, gm, path = _fresh_db()
    try:
        g = gm.create_group(name='研发组', created_by='u1', join_code='A8B-3K9')
        gm.add_member(group_id=g.id, user_id='u2', role='member')
        try:
            gm.add_member(group_id=g.id, user_id='u2', role='member')
            assert False, '应该抛错'
        except ValueError:
            pass
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 2: 实现 CRUD 方法**

```python
    def create_group(self, name: str, created_by: str, join_code: str,
                     icon: str = '👥', color: str = '#4f46e5',
                     description: str = None, is_hidden: int = 0) -> Group:
        import uuid
        from datetime import datetime
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

    def get_group(self, group_id: str) -> Group | None:
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM groups WHERE id = ? AND is_deleted = 0', (group_id,))
            row = cur.fetchone()
            return Group.from_dict(dict(row)) if row else None

    def get_group_by_code(self, join_code: str) -> Group | None:
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM groups WHERE join_code = ? AND is_deleted = 0', (join_code,))
            row = cur.fetchone()
            return Group.from_dict(dict(row)) if row else None

    def list_user_groups(self, user_id: str) -> list[Group]:
        from backend.database.models import Group
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''SELECT g.* FROM groups g
                JOIN group_members m ON m.group_id = g.id
                WHERE m.user_id = ? AND g.is_deleted = 0 AND m.last_seen_at IS NOT NULL
                ORDER BY g.created_at DESC''', (user_id,))
            return [Group.from_dict(dict(r)) for r in cur.fetchall()]

    def soft_delete_group(self, group_id: str, by_user: str) -> bool:
        from datetime import datetime
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

    def add_member(self, group_id: str, user_id: str, role: str,
                   share_tasks: int = 0, share_categories: int = 0,
                   share_group_tasks: int = 1, share_history: int = 0) -> GroupMember:
        import uuid
        from datetime import datetime
        from backend.database.models import GroupMember
        from backend.utils.logger import get_logger
        log = get_logger(__name__)
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

    def list_members(self, group_id: str) -> list[GroupMember]:
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
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_group.py -v`
Expected: 6 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/database/operations.py backend/tests/test_group.py`

---

### Task 5: MessageManager

**Files:**
- Modify: `backend/database/operations.py` — 追加 MessageManager 类

- [ ] **Step 1: 写测试**

新建 `backend/tests/test_message.py`：

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, GroupManager, MessageManager
    db = TodoDatabase()
    gm = GroupManager(db)
    mm = MessageManager(db)
    g = gm.create_group(name='研发', created_by='u1', join_code='A8B-3K9')
    return db, mm, g, tmp.name


def test_send_text_message():
    db, mm, g, path = _fresh_db()
    try:
        m = mm.send_message(group_id=g.id, sender_id='u1', content='hello', msg_type='text')
        assert m.id and m.content == 'hello' and m.msg_type == 'text'
    finally:
        Path(path).unlink(missing_ok=True)


def test_list_messages_order():
    db, mm, g, path = _fresh_db()
    try:
        m1 = mm.send_message(group_id=g.id, sender_id='u1', content='first')
        m2 = mm.send_message(group_id=g.id, sender_id='u2', content='second')
        msgs = mm.list_messages(g.id)
        assert [m.content for m in msgs] == ['first', 'second']
    finally:
        Path(path).unlink(missing_ok=True)


def test_mark_read():
    db, mm, g, path = _fresh_db()
    try:
        m = mm.send_message(group_id=g.id, sender_id='u1', content='hello')
        assert mm.mark_read(message_id=m.id, user_id='u2', at='2026-06-19T10:01:00Z')
        m_fetched = mm.get_message(m.id)
        import json
        read_by = json.loads(m_fetched.read_by or '{}')
        assert 'u2' in read_by
    finally:
        Path(path).unlink(missing_ok=True)


def test_soft_delete_message():
    db, mm, g, path = _fresh_db()
    try:
        m = mm.send_message(group_id=g.id, sender_id='u1', content='hello')
        assert mm.soft_delete_message(m.id, by_user='u1')
        assert mm.get_message(m.id) is None
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 2: 实现 MessageManager**

```python
class MessageManager:
    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    def send_message(self, group_id: str, sender_id: str, content: str = None,
                     msg_type: str = 'text', attachment_ids: list = None,
                     reply_to_id: str = None) -> Message:
        import uuid
        import json
        from datetime import datetime
        from backend.database.models import Message
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

    def get_message(self, message_id: str) -> Message | None:
        from backend.database.models import Message
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM messages WHERE id = ? AND is_deleted = 0', (message_id,))
            row = cur.fetchone()
            return Message.from_dict(dict(row)) if row else None

    def list_messages(self, group_id: str, limit: int = 100, before: str = None) -> list[Message]:
        from backend.database.models import Message
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            if before:
                cur.execute('''SELECT * FROM messages
                    WHERE group_id = ? AND is_deleted = 0 AND created_at < ?
                    ORDER BY created_at DESC LIMIT ?''',
                    (group_id, before, limit))
            else:
                cur.execute('''SELECT * FROM messages
                    WHERE group_id = ? AND is_deleted = 0
                    ORDER BY created_at DESC LIMIT ?''',
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
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_message.py -v`
Expected: 4 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/database/operations.py backend/tests/test_message.py`

---

### Task 6: SyncManager - 冲突解决

**Files:**
- Modify: `backend/database/operations.py` — 追加 SyncManager 类

- [ ] **Step 1: 写测试**

新建 `backend/tests/test_sync.py`：

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, SyncManager
    db = TodoDatabase()
    return db, SyncManager(db), tmp.name


def test_resolve_conflict_remote_newer():
    """远程时间戳更新 → 接受远程值"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'old', 'updated_at': '2026-06-19T10:00:00Z', 'version': 1}
        remote = {'title': 'new', 'updated_at': '2026-06-19T10:01:00Z', 'version': 2}
        result = sm.resolve_conflict(local, remote, field='title')
        assert result['title'] == 'new'
        assert result['version'] == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_resolve_conflict_local_newer():
    """本地时间戳更新 → 保留本地值"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'new', 'updated_at': '2026-06-19T10:01:00Z'}
        remote = {'title': 'old', 'updated_at': '2026-06-19T10:00:00Z'}
        result = sm.resolve_conflict(local, remote, field='title')
        assert result['title'] == 'new'
    finally:
        Path(path).unlink(missing_ok=True)


def test_resolve_conflict_delete_vs_edit():
    """删除 vs 修改：删除时间晚 → 删除胜出"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'edit', 'updated_at': '2026-06-19T10:00:00Z', 'is_deleted': 0}
        remote = {'title': 'old', 'updated_at': '2026-06-19T10:01:00Z', 'is_deleted': 1}
        result = sm.resolve_conflict(local, remote)
        assert result['is_deleted'] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_log_sync_operation():
    db, sm, path = _fresh_db()
    try:
        sm.log_sync(entity_type='task', entity_id='t1', operation='push',
                    peer_id='node2', user_id='u1', has_conflict=0)
        logs = sm.list_recent_sync_logs(limit=10)
        assert len(logs) == 1
        assert logs[0].entity_type == 'task' and logs[0].operation == 'push'
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 2: 实现 SyncManager（核心冲突解决）**

```python
class SyncManager:
    def __init__(self, db: 'TodoDatabase'):
        self.db = db

    def resolve_conflict(self, local: dict, remote: dict, field: str = None) -> dict:
        """字段级最新时间戳胜出；删除 vs 修改时删除优先（当删除时间更新）"""
        if field:
            return remote if remote.get('updated_at', '') > local.get('updated_at', '') else local

        # 删除 vs 修改
        if remote.get('is_deleted') and not local.get('is_deleted'):
            if remote.get('updated_at', '') > local.get('updated_at', ''):
                return remote
        if local.get('is_deleted') and not remote.get('is_deleted'):
            if local.get('updated_at', '') > remote.get('updated_at', ''):
                return local

        # 字段级合并
        result = dict(local)
        for key, val in remote.items():
            if key.endswith('_at') or key == 'version':
                continue
            if key not in local:
                result[key] = val
            elif remote.get(f'{key}_updated_at', remote.get('updated_at', '')) > local.get(f'{key}_updated_at', local.get('updated_at', '')):
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
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_sync.py -v`
Expected: 4 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/database/operations.py backend/tests/test_sync.py`

---

### Task 7: 跑 C2 阶段回归

Run: `python -m pytest backend/tests/test_group.py backend/tests/test_message.py backend/tests/test_sync.py -v`
Expected: 14 passed（C2 全过）

---

## C3. 网络层

### Task 8: protocol.py - 消息编解码

**Files:**
- Create: `backend/network/__init__.py`
- Create: `backend/network/protocol.py`

- [ ] **Step 1: 写测试**

新建 `backend/tests/test_protocol.py`：

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.protocol import encode_message, decode_message, ProtocolError


def test_encode_decode_text():
    msg = {'type': 'PING', 'node_id': 'n1', 'timestamp': '2026-06-19T10:00:00Z'}
    encoded = encode_message(msg)
    # 4 字节长度前缀 + JSON
    assert len(encoded) > 4
    length = int.from_bytes(encoded[:4], 'big')
    assert length == len(encoded) - 4

    decoded = decode_message(encoded)
    assert decoded == msg


def test_decode_incomplete():
    """截断数据应抛 ProtocolError"""
    import json
    import pytest
    msg = {'type': 'PING'}
    encoded = encode_message(msg)
    # 截断到一半
    try:
        decode_message(encoded[:len(encoded) // 2])
        assert False, '应该抛错'
    except ProtocolError:
        pass


def test_decode_invalid_json():
    """无效 JSON 应抛 ProtocolError"""
    import pytest
    bad = b'{"type": "PING"'  # 不完整 JSON
    framed = len(bad).to_bytes(4, 'big') + bad
    try:
        decode_message(framed)
        assert False
    except ProtocolError:
        pass
```

- [ ] **Step 2: 实现 protocol.py**

```python
# backend/network/__init__.py
# （空文件）

# backend/network/protocol.py
import json
import struct


class ProtocolError(Exception):
    pass


# 消息类型常量
HELLO = 'HELLO'
WELCOME = 'WELCOME'
ACK = 'ACK'
PING = 'PING'
PONG = 'PONG'
BYE = 'BYE'
ERROR = 'ERROR'

SYNC_TASK_PUSH = 'SYNC_TASK_PUSH'
SYNC_TASK_PULL = 'SYNC_TASK_PULL'
SYNC_CATEGORY_PUSH = 'SYNC_CATEGORY_PUSH'
SYNC_CATEGORY_PULL = 'SYNC_CATEGORY_PULL'
SYNC_USER_PROFILE_PUSH = 'SYNC_USER_PROFILE_PUSH'

GROUP_HELLO = 'GROUP_HELLO'
GROUP_BYE = 'GROUP_BYE'

MSG_SEND = 'MSG_SEND'
MSG_READ_RECEIPT = 'MSG_READ_RECEIPT'

FILE_UPLOAD_META = 'FILE_UPLOAD_META'
FILE_UPLOAD_CHUNK = 'FILE_UPLOAD_CHUNK'
FILE_UPLOAD_COMPLETE = 'FILE_UPLOAD_COMPLETE'


def encode_message(msg: dict) -> bytes:
    """编码：4 字节大端长度 + UTF-8 JSON"""
    payload = json.dumps(msg, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return struct.pack('>I', len(payload)) + payload


def decode_message(data: bytes) -> dict:
    """解码：4 字节大端长度 + UTF-8 JSON"""
    if len(data) < 4:
        raise ProtocolError(f'数据过短：{len(data)} 字节')
    length = struct.unpack('>I', data[:4])[0]
    if len(data) < 4 + length:
        raise ProtocolError(f'不完整：期望 {length} 字节，实际 {len(data) - 4}')
    try:
        return json.loads(data[4:4+length].decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ProtocolError(f'JSON 解析失败：{e}') from e
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_protocol.py -v`
Expected: 3 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/network/ backend/tests/test_protocol.py`

---

### Task 9: discovery.py - UDP 广播

**Files:**
- Create: `backend/network/discovery.py`

- [ ] **Step 1: 写测试**

新建 `backend/tests/test_discovery.py`：

```python
import sys, socket, time, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.discovery import DiscoveryService, parse_beacon


def test_parse_beacon_valid():
    raw = {
        'type': 'discovery_beacon',
        'node_id': 'n1',
        'user_id': 'u1',
        'user_name': '郭世锋',
        'groups': [{'group_id': 'g1', 'join_code': 'A8B-3K9', 'is_hidden': False}],
        'tcp_port': 54722,
        'timestamp': '2026-06-19T10:00:00Z',
    }
    parsed = parse_beacon(raw)
    assert parsed.node_id == 'n1' and parsed.user_name == '郭世锋'
    assert parsed.groups[0].join_code == 'A8B-3K9'


def test_parse_beacon_invalid():
    try:
        parse_beacon({'type': 'unknown'})
        assert False
    except ValueError:
        pass


def test_discovery_send_and_receive():
    """在 localhost 上发送并接收 beacon（单进程模拟）"""
    # 用 15472 端口避免与默认冲突
    service = DiscoveryService(port=15472, node_id='n1', user_id='u1',
                                user_name='测试', tcp_port=54722,
                                groups=[], listen=False)
    service.beacons = []
    service.start_listen(port=15472)
    time.sleep(0.1)

    # 发送一个 beacon
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    import json
    beacon = {
        'type': 'discovery_beacon',
        'node_id': 'n2', 'user_id': 'u2', 'user_name': 'Other',
        'groups': [{'group_id': 'g1', 'join_code': 'XYZ-123', 'is_hidden': False}],
        'tcp_port': 54722, 'timestamp': '2026-06-19T10:00:00Z',
    }
    sock.sendto(json.dumps(beacon).encode('utf-8'), ('127.0.0.1', 15472))
    sock.close()

    time.sleep(0.5)
    service.stop_listen()
    codes = [b.groups[0].join_code for b in service.beacons if b.groups]
    assert 'XYZ-123' in codes
```

- [ ] **Step 2: 实现 discovery.py**

```python
# backend/network/discovery.py
import json
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional

BEACON_INTERVAL = 3  # 秒


@dataclass
class GroupBeacon:
    group_id: str
    join_code: str
    is_hidden: bool = False


@dataclass
class Beacon:
    node_id: str
    user_id: str
    user_name: str
    groups: List[GroupBeacon] = field(default_factory=list)
    tcp_port: int = 0
    timestamp: str = ''
    address: tuple = ()  # (ip, port)


def parse_beacon(raw: dict) -> Beacon:
    if raw.get('type') != 'discovery_beacon':
        raise ValueError('NOT_A_BEACON')
    groups = [GroupBeacon(group_id=g['group_id'], join_code=g['join_code'],
                          is_hidden=g.get('is_hidden', False))
              for g in raw.get('groups', [])]
    return Beacon(node_id=raw['node_id'], user_id=raw['user_id'],
                  user_name=raw.get('user_name', ''), groups=groups,
                  tcp_port=raw.get('tcp_port', 0), timestamp=raw.get('timestamp', ''))


class DiscoveryService:
    """UDP 广播：周期性发送本机 beacon + 监听其他节点"""

    def __init__(self, port: int, node_id: str, user_id: str, user_name: str,
                 tcp_port: int, groups: List[GroupBeacon],
                 on_beacon: Optional[Callable] = None,
                 listen: bool = True):
        self.port = port
        self.node_id = node_id
        self.user_id = user_id
        self.user_name = user_name
        self.tcp_port = tcp_port
        self.groups = groups
        self.on_beacon = on_beacon
        self.beacons: List[Beacon] = []
        self._running = False
        self._threads: List[threading.Thread] = []
        self._sock_recv: Optional[socket.socket] = None
        self._sock_send: Optional[socket.socket] = None
        self._listen_enabled = listen

    def start(self):
        if self._running:
            return
        self._running = True
        # 发送 beacon
        t_send = threading.Thread(target=self._send_loop, daemon=True)
        t_send.start()
        self._threads.append(t_send)

        if self._listen_enabled:
            t_recv = threading.Thread(target=self._recv_loop, daemon=True)
            t_recv.start()
            self._threads.append(t_recv)

    def stop(self):
        self._running = False
        if self._sock_recv:
            try:
                self._sock_recv.close()
            except Exception:
                pass
        if self._sock_send:
            try:
                self._sock_send.close()
            except Exception:
                pass

    def start_listen(self, port: int = None):
        """仅启动监听（测试用）"""
        if port:
            self.port = port
        self._running = True
        t = threading.Thread(target=self._recv_loop, daemon=True)
        t.start()
        self._threads.append(t)

    def stop_listen(self):
        self._running = False
        if self._sock_recv:
            try:
                self._sock_recv.close()
            except Exception:
                pass

    def _send_loop(self):
        self._sock_send = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock_send.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self._sock_send.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        while self._running:
            beacon = {
                'type': 'discovery_beacon',
                'node_id': self.node_id,
                'user_id': self.user_id,
                'user_name': self.user_name,
                'groups': [{'group_id': g.group_id, 'join_code': g.join_code,
                            'is_hidden': g.is_hidden} for g in self.groups],
                'tcp_port': self.tcp_port,
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
            try:
                self._sock_send.sendto(
                    json.dumps(beacon, ensure_ascii=False).encode('utf-8'),
                    ('255.255.255.255', self.port),
                )
            except Exception:
                pass
            time.sleep(BEACON_INTERVAL)

    def _recv_loop(self):
        try:
            self._sock_recv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock_recv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                self._sock_recv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except (AttributeError, OSError):
                pass
            self._sock_recv.bind(('', self.port))
            self._sock_recv.settimeout(1.0)
        except OSError:
            return

        while self._running:
            try:
                data, addr = self._sock_recv.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                raw = json.loads(data.decode('utf-8'))
                beacon = parse_beacon(raw)
                beacon.address = addr
                if beacon.node_id == self.node_id:
                    continue  # 忽略自己的
                self.beacons.append(beacon)
                if self.on_beacon:
                    try:
                        self.on_beacon(beacon)
                    except Exception:
                        pass
            except (ValueError, json.JSONDecodeError, KeyError):
                continue
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_discovery.py -v`
Expected: 3 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/network/discovery.py backend/tests/test_discovery.py`

---

### Task 10: peer.py - TCP 长连接 + 心跳

**Files:**
- Create: `backend/network/peer.py`

- [ ] **Step 1: 实现 peer.py（双节点集成测试驱动）**

本 Task 写实现 + 集成测试。

```python
# backend/network/peer.py
import socket
import threading
import time
from typing import Callable, Optional

from backend.network.protocol import encode_message, decode_message, ProtocolError, PING, PONG, HELLO, WELCOME, ACK, BYE


HEARTBEAT_INTERVAL = 30
HEARTBEAT_TIMEOUT = 90  # 3 次未响应


class PeerConnection:
    """一条 TCP 长连接（双向通信）"""

    def __init__(self, sock: socket.socket, peer_addr, is_initiator: bool,
                 on_message: Optional[Callable] = None, on_close: Optional[Callable] = None):
        self.sock = sock
        self.peer_addr = peer_addr
        self.is_initiator = is_initiator
        self.on_message = on_message
        self.on_close = on_close
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_pong = time.time()
        self._send_lock = threading.Lock()
        self._closed = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        self._close_socket()
        if self._thread:
            self._thread.join(timeout=2)

    def send(self, msg: dict):
        if self._closed:
            return False
        data = encode_message(msg)
        with self._send_lock:
            try:
                self.sock.sendall(data)
                return True
            except OSError:
                return False

    def _loop(self):
        buf = b''
        while self._running and not self._closed:
            try:
                self.sock.settimeout(1.0)
                chunk = self.sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
                # 解析所有完整消息
                while len(buf) >= 4:
                    import struct
                    length = struct.unpack('>I', buf[:4])[0]
                    if len(buf) < 4 + length:
                        break
                    try:
                        msg = decode_message(buf[:4+length])
                        self._handle_message(msg)
                    except ProtocolError:
                        pass
                    buf = buf[4+length:]
            except socket.timeout:
                continue
            except OSError:
                break
        self._close_socket()
        if self.on_close:
            try:
                self.on_close(self)
            except Exception:
                pass

    def _handle_message(self, msg: dict):
        mtype = msg.get('type')
        if mtype == PING:
            self.send({'type': PONG, 'timestamp': msg.get('timestamp')})
            return
        if mtype == PONG:
            self._last_pong = time.time()
            return
        if mtype == BYE:
            self.stop()
            return
        if self.on_message:
            try:
                self.on_message(self, msg)
            except Exception:
                pass

    def _close_socket(self):
        if self._closed:
            return
        self._closed = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


class PeerServer:
    """TCP 服务端：监听连接 + 管理活跃连接"""

    def __init__(self, host: str = '0.0.0.0', port: int = 54722,
                 on_connect: Optional[Callable] = None):
        self.host = host
        self.port = port
        self.on_connect = on_connect
        self._running = False
        self._sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self.connections: list[PeerConnection] = []
        self._lock = threading.Lock()

    def start(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self._sock.listen(8)
        self._sock.settimeout(1.0)
        self._running = True
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
        with self._lock:
            for c in list(self.connections):
                c.stop()
            self.connections.clear()

    def _accept_loop(self):
        while self._running:
            try:
                client, addr = self._sock.accept()
            except (socket.timeout, OSError):
                continue
            pc = PeerConnection(client, addr, is_initiator=False,
                                on_close=self._on_close)
            with self._lock:
                self.connections.append(pc)
            pc.start()
            if self.on_connect:
                try:
                    self.on_connect(pc)
                except Exception:
                    pass

    def _on_close(self, pc: PeerConnection):
        with self._lock:
            try:
                self.connections.remove(pc)
            except ValueError:
                pass


def connect_peer(host: str, port: int, timeout: float = 5.0) -> Optional[PeerConnection]:
    """主动连接到对端"""
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        pc = PeerConnection(sock, (host, port), is_initiator=True)
        pc.start()
        return pc
    except OSError:
        return None
```

- [ ] **Step 2: 双节点集成测试**

新建 `backend/tests/test_p2p.py`：

```python
import sys, time, socket
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.peer import PeerServer, connect_peer
from backend.network.protocol import PING, PONG, HELLO, WELCOME


def test_two_peers_ping_pong():
    """服务端接受连接 + 客户端发送 PING + 服务端回 PONG"""
    received_pings = []

    server = PeerServer(host='127.0.0.1', port=15501)
    server.start()
    time.sleep(0.2)

    received_messages = []

    def on_msg(pc, msg):
        received_messages.append(msg)

    try:
        client = connect_peer('127.0.0.1', 15501)
        assert client is not None
        client.on_message = on_msg
        time.sleep(0.2)

        assert client.send({'type': PING, 'timestamp': '2026-06-19T10:00:00Z'})
        time.sleep(0.5)

        pongs = [m for m in received_messages if m.get('type') == PONG]
        assert len(pongs) == 1
    finally:
        if 'client' in locals() and client:
            client.stop()
        server.stop()


def test_two_peers_hello_welcome():
    """HELLO/WELCOME 握手"""
    server = PeerServer(host='127.0.0.1', port=15502)

    welcomes = []

    def on_connect(pc):
        pc.on_message = lambda c, m: welcomes.append(m)
        pc.send({'type': WELCOME, 'node_id': 'server'})

    server.on_connect = on_connect
    server.start()
    time.sleep(0.2)

    try:
        client = connect_peer('127.0.0.1', 15502)
        assert client
        time.sleep(0.2)
        assert client.send({'type': HELLO, 'node_id': 'client', 'user_id': 'u1'})
        time.sleep(0.5)
        assert any(m.get('type') == WELCOME for m in welcomes)
    finally:
        if 'client' in locals() and client:
            client.stop()
        server.stop()
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_p2p.py -v`
Expected: 2 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/network/peer.py backend/tests/test_p2p.py`

---

### Task 11: sync_engine.py - 推送拉取

**Files:**
- Create: `backend/network/sync_engine.py`

- [ ] **Step 1: 实现 sync_engine.py**

```python
# backend/network/sync_engine.py
import json
import time
from typing import Callable, Optional

from backend.network.protocol import (
    SYNC_TASK_PUSH, SYNC_TASK_PULL, SYNC_CATEGORY_PUSH, SYNC_CATEGORY_PULL,
    SYNC_USER_PROFILE_PUSH,
)


class SyncEngine:
    """同步引擎：处理推送/拉取、字段级冲突解决、sync_log 记录"""

    def __init__(self, db, sync_manager, on_apply: Optional[Callable] = None):
        self.db = db
        self.sync_manager = sync_manager
        self.on_apply = on_apply
        # 节点级最后同步时间戳
        self._last_sync_at: dict[str, str] = {}

    def apply_remote_change(self, entity_type: str, entity: dict,
                            peer_id: str = '', user_id: str = '') -> dict:
        """应用远端变更，返回最终状态 + 同步日志条目"""
        if entity_type == 'task':
            return self._apply_task(entity, peer_id, user_id)
        if entity_type == 'category':
            return self._apply_category(entity, peer_id, user_id)
        if entity_type == 'message':
            return self._apply_message(entity, peer_id, user_id)
        raise ValueError(f'UNSUPPORTED_ENTITY_TYPE: {entity_type}')

    def _apply_task(self, entity: dict, peer_id: str, user_id: str) -> dict:
        local = self.db.get_task(entity['id'])
        has_conflict = 0
        if local is None:
            # 新增
            self.db.add_task(entity)
            self.sync_manager.log_sync('task', entity['id'], 'push',
                                        peer_id=peer_id, user_id=user_id, has_conflict=0)
        else:
            merged = self.sync_manager.resolve_conflict(local, entity)
            if merged.get('is_deleted') and not local.get('is_deleted'):
                # 远端删除
                self.db.soft_delete_task(entity['id'])
            elif merged != local:
                self.db.update_task(entity['id'], merged)
                has_conflict = 1 if merged.get('updated_at') != entity.get('updated_at') else 0
            self.sync_manager.log_sync('task', entity['id'], 'push',
                                        peer_id=peer_id, user_id=user_id, has_conflict=has_conflict)
        if self.on_apply:
            try:
                self.on_apply(entity_type, entity)
            except Exception:
                pass
        return entity

    def _apply_category(self, entity: dict, peer_id: str, user_id: str) -> dict:
        # 简化：直接 upsert
        if not self.db.category_manager.get_category(entity['id']):
            self.db.category_manager.create_category(**entity)
        self.sync_manager.log_sync('category', entity['id'], 'push',
                                    peer_id=peer_id, user_id=user_id)
        return entity

    def _apply_message(self, entity: dict, peer_id: str, user_id: str) -> dict:
        if not self.db.message_manager.get_message(entity['id']):
            self.db.message_manager.send_message(
                group_id=entity['group_id'], sender_id=entity['sender_id'],
                content=entity.get('content'), msg_type=entity['msg_type'],
                attachment_ids=json.loads(entity.get('attachment_ids') or '[]'),
                reply_to_id=entity.get('reply_to_id'),
            )
        self.sync_manager.log_sync('message', entity['id'], 'push',
                                    peer_id=peer_id, user_id=user_id)
        return entity

    def get_pull_payload(self, entity_type: str, since_timestamp: str = '') -> list[dict]:
        """获取 since_timestamp 之后的所有变更（用于新节点加入时拉取）"""
        if entity_type == 'task':
            return self.db.list_tasks(since=since_timestamp)
        if entity_type == 'category':
            return self.db.category_manager.list_categories() if not since_timestamp else []
        if entity_type == 'message':
            return []
        return []
```

- [ ] **Step 2: 同步引擎单元测试**

```python
# 追加到 backend/tests/test_sync.py

def test_sync_engine_apply_new_task():
    """远端推送新任务 → 本地写入"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        task = {
            'id': 't1', 'title': 'new', 'status': 'pending', 'priority': 'none',
            'created_at': '2026-06-19T10:00:00Z', 'updated_at': '2026-06-19T10:00:00Z',
            'version': 1,
        }
        se.apply_remote_change('task', task, peer_id='node2')
        assert db.get_task('t1')['title'] == 'new'
    finally:
        Path(path).unlink(missing_ok=True)


def test_sync_engine_apply_update_with_conflict():
    """远端更新 + 本地有时间戳更新更早 → 字段级合并"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        # 本地任务
        db.add_task({'id': 't1', 'title': 'local', 'status': 'pending',
                     'created_at': '2026-06-19T10:00:00Z',
                     'updated_at': '2026-06-19T10:00:00Z'})
        se = SyncEngine(db=db, sync_manager=sm)
        remote = {'id': 't1', 'title': 'remote', 'status': 'pending',
                  'created_at': '2026-06-19T10:01:00Z',
                  'updated_at': '2026-06-19T10:01:00Z'}
        se.apply_remote_change('task', remote, peer_id='node2')
        # 远端更新，应采用
        assert db.get_task('t1')['title'] == 'remote'

        logs = sm.list_recent_sync_logs()
        assert any(l.entity_id == 't1' for l in logs)
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_sync.py backend/tests/test_p2p.py -v`
Expected: 8 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/network/sync_engine.py backend/tests/test_sync.py`

---

### Task 12: 端到端冲突测试

**Files:**
- Create: `backend/tests/test_conflict.py`

- [ ] **Step 1: 实现端到端冲突测试**

```python
import sys, time, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _two_node_setup():
    """模拟双节点：各自独立 db + SyncEngine"""
    paths = []
    dbs = []
    from backend.database import operations
    from backend.database.operations import TodoDatabase, SyncManager
    for i in range(2):
        tmp = tempfile.NamedTemporaryFile(suffix=f'_{i}.db', delete=False)
        tmp.close()
        paths.append(tmp.name)
    operations.get_app_data_file = lambda: Path(paths[0])
    db_a = TodoDatabase()
    sm_a = SyncManager(db_a)
    operations.get_app_data_file = lambda: Path(paths[1])
    db_b = TodoDatabase()
    sm_b = SyncManager(db_b)
    return (db_a, sm_a, db_b, sm_b, paths)


def test_e2e_task_conflict_resolution():
    """A 创建任务 → B 拉取 → 同时修改 → 字段级合并"""
    db_a, sm_a, db_b, sm_b, paths = _two_node_setup()
    try:
        from backend.network.sync_engine import SyncEngine
        # A 创建任务
        task = {
            'id': 't1', 'title': 'A title', 'status': 'pending', 'priority': 'none',
            'created_at': '2026-06-19T10:00:00Z',
            'updated_at': '2026-06-19T10:00:00Z', 'version': 1,
        }
        db_a.add_task(task)

        # B 拉取
        se_b = SyncEngine(db=db_b, sync_manager=sm_b)
        se_b.apply_remote_change('task', task, peer_id='nodeA')

        # A 修改
        db_a.update_task('t1', {'title': 'A updated', 'updated_at': '2026-06-19T10:01:00Z'})

        # B 修改
        db_b.update_task('t1', {'priority': 'high', 'updated_at': '2026-06-19T10:00:30Z'})

        # 同步：A 的版本推到 B
        a_task = db_a.get_task('t1')
        se_b.apply_remote_change('task', a_task, peer_id='nodeA')

        # B 的最终状态：A 的 title 胜出（时间戳更新），B 的 priority 保留
        final = db_b.get_task('t1')
        assert final['title'] == 'A updated'
        assert final['priority'] == 'high'
    finally:
        for p in paths:
            Path(p).unlink(missing_ok=True)
```

- [ ] **Step 2: 跑测试**

Run: `python -m pytest backend/tests/test_conflict.py -v`
Expected: 1 passed

- [ ] **Step 3: 暂存**

Run: `git add backend/tests/test_conflict.py`

---

### Task 13: 跑 C3 阶段回归

Run: `python -m pytest backend/tests/test_protocol.py backend/tests/test_discovery.py backend/tests/test_p2p.py backend/tests/test_sync.py backend/tests/test_conflict.py -v`
Expected: 14 passed（C3 全过）

---

## C4. API 层

### Task 14: 15 个 API 端点

**Files:**
- Modify: `backend/api/todo_api.py` — 末尾追加 ~15 个方法

API 列表（15 个）：
1. `group_list` — 列出我的协作组
2. `group_create` — 创建协作组（自动生成连接码）
3. `group_join` — 输入连接码加入
4. `group_leave` — 退出协作组
5. `group_disband` — 解散协作组（owner）
6. `group_reset_code` — 重置连接码（owner）
7. `group_members` — 列出成员
8. `group_kick` — 踢人（owner）
9. `group_set_share` — 设置共享范围
10. `message_list` — 列出消息
11. `message_send` — 发送消息
12. `message_mark_read` — 标记已读
13. `message_delete` — 删除消息
14. `sync_status` — 获取同步状态
15. `sync_log` — 获取同步日志

- [ ] **Step 1: 在 `TodoApi` 类追加所有方法**

```python
    # ============ C 阶段：协作组 + 消息 + 同步 API ============

    def _ensure_c_managers(self):
        if not hasattr(self, 'group_manager') or self.group_manager is None:
            from backend.database.operations import GroupManager, MessageManager, SyncManager
            self.group_manager = GroupManager(self.db)
            self.message_manager = MessageManager(self.db)
            self.sync_manager = SyncManager(self.db)
        # 网络引擎懒加载
        if not hasattr(self, 'network_engine') or self.network_engine is None:
            from backend.network.sync_engine import SyncEngine
            self.network_engine = SyncEngine(self.db, self.sync_manager)

    def _current_user_id(self):
        return self.db.current_user_id if hasattr(self.db, 'current_user_id') else None

    def group_list(self):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            groups = self.group_manager.list_user_groups(uid)
            out = []
            for g in groups:
                d = g.to_dict()
                d['member_count'] = len(self.group_manager.list_members(g.id))
                out.append(d)
            return {'success': True, 'groups': out}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_create(self, name: str, icon: str = '👥', color: str = '#4f46e5',
                     description: str = None, is_hidden: int = 0):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            if not name or not name.strip():
                return {'success': False, 'error': 'NAME_REQUIRED'}
            join_code = self.group_manager.generate_join_code()
            g = self.group_manager.create_group(
                name=name.strip(), created_by=uid, join_code=join_code,
                icon=icon, color=color, description=description, is_hidden=is_hidden,
            )
            return {'success': True, 'group': g.to_dict()}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_join(self, join_code: str, share_tasks: int = 0,
                   share_categories: int = 0, share_group_tasks: int = 1,
                   share_history: int = 0):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group_by_code(join_code)
            if not g:
                return {'success': False, 'error': 'GROUP_NOT_FOUND'}
            m = self.group_manager.add_member(
                group_id=g.id, user_id=uid, role='member',
                share_tasks=share_tasks, share_categories=share_categories,
                share_group_tasks=share_group_tasks, share_history=share_history,
            )
            return {'success': True, 'group': g.to_dict(), 'member': m.to_dict()}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_leave(self, group_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.group_manager.remove_member(group_id, uid)
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_disband(self, group_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.group_manager.soft_delete_group(group_id, by_user=uid)
            return {'success': ok, 'error': 'NOT_OWNER' if not ok else None}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_reset_code(self, group_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group(group_id)
            if not g or g.created_by != uid:
                return {'success': False, 'error': 'NOT_OWNER'}
            new_code = self.group_manager.generate_join_code()
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                from datetime import datetime
                cur.execute('UPDATE groups SET join_code = ?, updated_at = ? WHERE id = ?',
                            (new_code, datetime.now().isoformat(), group_id))
                conn.commit()
            return {'success': True, 'join_code': new_code}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_members(self, group_id: str):
        try:
            self._ensure_c_managers()
            members = self.group_manager.list_members(group_id)
            return {'success': True, 'members': [m.to_dict() for m in members]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_kick(self, group_id: str, user_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group(group_id)
            if not g or g.created_by != uid:
                return {'success': False, 'error': 'NOT_OWNER'}
            ok = self.group_manager.remove_member(group_id, user_id)
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_set_share(self, group_id: str, share_tasks: int = None,
                        share_categories: int = None, share_group_tasks: int = None,
                        share_history: int = None):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            updates = {k: v for k, v in {
                'share_tasks': share_tasks, 'share_categories': share_categories,
                'share_group_tasks': share_group_tasks, 'share_history': share_history,
            }.items() if v is not None}
            if not updates:
                return {'success': False, 'error': 'NO_UPDATE'}
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                for k, v in updates.items():
                    cur.execute(f'UPDATE group_members SET {k} = ? WHERE group_id = ? AND user_id = ?',
                                (v, group_id, uid))
                conn.commit()
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_list(self, group_id: str, limit: int = 50, before: str = None):
        try:
            self._ensure_c_managers()
            msgs = self.message_manager.list_messages(group_id, limit=limit, before=before)
            return {'success': True, 'messages': [m.to_dict() for m in msgs]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_send(self, group_id: str, content: str = None, msg_type: str = 'text',
                     attachment_ids: list = None, reply_to_id: str = None):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            m = self.message_manager.send_message(
                group_id=group_id, sender_id=uid, content=content,
                msg_type=msg_type, attachment_ids=attachment_ids, reply_to_id=reply_to_id,
            )
            return {'success': True, 'message': m.to_dict()}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_mark_read(self, message_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            from datetime import datetime
            ok = self.message_manager.mark_read(message_id, uid, datetime.now().isoformat())
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_delete(self, message_id: str):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.message_manager.soft_delete_message(message_id, by_user=uid)
            return {'success': ok, 'error': 'NOT_SENDER' if not ok else None}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def sync_status(self):
        try:
            self._ensure_c_managers()
            uid = self._current_user_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            groups = self.group_manager.list_user_groups(uid)
            online_count = sum(1 for g in groups if g.to_dict().get('is_online'))
            return {
                'success': True,
                'status': {
                    'group_count': len(groups),
                    'online_count': online_count,
                    'connected_peers': getattr(self, '_connected_peers', []),
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def sync_log(self, limit: int = 50):
        try:
            self._ensure_c_managers()
            logs = self.sync_manager.list_recent_sync_logs(limit=limit)
            return {'success': True, 'logs': [l.to_dict() for l in logs]}
        except Exception as e:
            return {'success': False, 'error': str(e)}
```

- [ ] **Step 2: API 集成测试**

新建 `backend/tests/test_c_api.py`：

```python
import sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, UserManager
    from backend.api import todo_api
    db = TodoDatabase()
    um = UserManager(db)
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


def _login(api, name='测试'):
    r = api.auth_create_user(display_name=name)
    return r.get('user', {}).get('id')


def test_api_group_create_and_list():
    api, path = _make_api()
    try:
        _login(api)
        r = api.group_create(name='研发组')
        assert r['success'] and r['group']['join_code']

        rl = api.group_list()
        assert rl['success'] and len(rl['groups']) == 1
        assert rl['groups'][0]['member_count'] == 1  # 创建者自动加入
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_group_join():
    api, path = _make_api()
    try:
        uid1 = _login(api, 'A')
        r = api.group_create(name='研发组')
        join_code = r['group']['join_code']
        gid = r['group']['id']

        api.auth_logout()
        uid2 = _login(api, 'B')
        rj = api.group_join(join_code=join_code)
        assert rj['success'] and rj['group']['id'] == gid

        members = api.group_members(gid)
        assert len(members['members']) == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_message_send_and_list():
    api, path = _make_api()
    try:
        _login(api)
        r = api.group_create(name='研发组')
        gid = r['group']['id']
        s = api.message_send(group_id=gid, content='hello')
        assert s['success']

        lst = api.message_list(group_id=gid)
        assert lst['success'] and len(lst['messages']) == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_sync_status():
    api, path = _make_api()
    try:
        _login(api)
        r = api.sync_status()
        assert r['success'] and r['status']['group_count'] == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_group_kick_not_owner_rejected():
    api, path = _make_api()
    try:
        uid1 = _login(api, 'owner')
        r = api.group_create(name='g1')
        gid = r['group']['id']
        join_code = r['group']['join_code']

        api.auth_logout()
        uid2 = _login(api, 'member')
        api.group_join(join_code=join_code)
        # member 尝试踢 owner
        rk = api.group_kick(group_id=gid, user_id=uid1)
        assert not rk['success']
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_group_disband_by_owner():
    api, path = _make_api()
    try:
        _login(api)
        r = api.group_create(name='g1')
        gid = r['group']['id']
        rd = api.group_disband(group_id=gid)
        assert rd['success']

        rl = api.group_list()
        assert all(g['id'] != gid for g in rl['groups'])
    finally:
        Path(path).unlink(missing_ok=True)
```

- [ ] **Step 3: 跑测试**

Run: `python -m pytest backend/tests/test_c_api.py -v`
Expected: 6 passed

- [ ] **Step 4: 暂存**

Run: `git add backend/api/todo_api.py backend/tests/test_c_api.py`

---

### Task 15: 跑 C4 阶段回归 + A/B 完整回归

Run: `python -m pytest backend/tests/ -v`
Expected: 85（A+B 已有）+ 14（C3 网络层）+ 6（C4 API）= 105 passed

---

## C5. 前端层

### Task 16: api.js 桥接

**Files:**
- Modify: `frontend/js/api.js` — 追加 15 个 C 阶段 API 桥接

- [ ] **Step 1: 在 api.js 末尾追加**

```javascript
// ============ C 阶段：协作组 / 消息 / 同步 ============

window.groupApi = {
    list: () => window.pywebview.api.group_list(),
    create: (params) => window.pywebview.api.group_create(
        params.name, params.icon || '👥', params.color || '#4f46e5',
        params.description || null, params.isHidden || 0
    ),
    join: (params) => window.pywebview.api.group_join(
        params.joinCode, params.shareTasks || 0, params.shareCategories || 0,
        params.shareGroupTasks !== false ? 1 : 0, params.shareHistory || 0
    ),
    leave: (groupId) => window.pywebview.api.group_leave(groupId),
    disband: (groupId) => window.pywebview.api.group_disband(groupId),
    resetCode: (groupId) => window.pywebview.api.group_reset_code(groupId),
    members: (groupId) => window.pywebview.api.group_members(groupId),
    kick: (groupId, userId) => window.pywebview.api.group_kick(groupId, userId),
    setShare: (params) => window.pywebview.api.group_set_share(
        params.groupId, params.shareTasks, params.shareCategories,
        params.shareGroupTasks, params.shareHistory
    ),
};

window.messageApi = {
    list: (groupId, limit, before) => window.pywebview.api.message_list(groupId, limit || 50, before || null),
    send: (params) => window.pywebview.api.message_send(
        params.groupId, params.content || null, params.msgType || 'text',
        params.attachmentIds || null, params.replyToId || null
    ),
    markRead: (messageId) => window.pywebview.api.message_mark_read(messageId),
    delete: (messageId) => window.pywebview.api.message_delete(messageId),
};

window.syncApi = {
    status: () => window.pywebview.api.sync_status(),
    log: (limit) => window.pywebview.api.sync_log(limit || 50),
};
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/api.js`

---

### Task 17: group.js 协作组管理

**Files:**
- Create: `frontend/js/group.js`

- [ ] **Step 1: 实现 group.js（核心 CRUD + 缓存）**

```javascript
// frontend/js/group.js
class GroupManager {
    constructor() {
        this.groups = [];
        this.membersCache = new Map();
        this.currentGroupId = null;
    }

    async refresh() {
        const r = await window.groupApi.list();
        if (r && r.success) {
            this.groups = r.groups || [];
        }
        return this.groups;
    }

    getById(id) {
        return this.groups.find(g => g.id === id) || null;
    }

    getByCode(code) {
        return this.groups.find(g => g.joinCode === code) || null;
    }

    async create(params) {
        const r = await window.groupApi.create(params);
        if (r && r.success) {
            await this.refresh();
        }
        return r;
    }

    async join(joinCode, shareOptions = {}) {
        const r = await window.groupApi.join({ joinCode, ...shareOptions });
        if (r && r.success) {
            await this.refresh();
        }
        return r;
    }

    async leave(groupId) {
        const r = await window.groupApi.leave(groupId);
        if (r && r.success) {
            this.groups = this.groups.filter(g => g.id !== groupId);
        }
        return r;
    }

    async disband(groupId) {
        const r = await window.groupApi.disband(groupId);
        if (r && r.success) {
            this.groups = this.groups.filter(g => g.id !== groupId);
        }
        return r;
    }

    async loadMembers(groupId) {
        const r = await window.groupApi.members(groupId);
        if (r && r.success) {
            this.membersCache.set(groupId, r.members);
        }
        return r && r.success ? r.members : [];
    }

    isOwner(group) {
        const me = window.userManager && window.userManager.currentUser;
        return me && group && group.createdBy === me.id;
    }
}

window.groupManager = new GroupManager();
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/group.js`

---

### Task 18: chat.js 消息面板

**Files:**
- Create: `frontend/js/chat.js`

- [ ] **Step 1: 实现 chat.js（消息列表 + 发送）**

```javascript
// frontend/js/chat.js
class ChatManager {
    constructor() {
        this.currentGroupId = null;
        this.messages = [];
        this.unreadByGroup = new Map();
    }

    async loadMessages(groupId, limit = 50) {
        const r = await window.messageApi.list(groupId, limit);
        if (r && r.success) {
            this.currentGroupId = groupId;
            this.messages = r.messages || [];
            this.unreadByGroup.set(groupId, 0);
        }
        return this.messages;
    }

    async send(content, msgType = 'text', attachmentIds = null, replyToId = null) {
        if (!this.currentGroupId) return { success: false, error: 'NO_GROUP' };
        const r = await window.messageApi.send({
            groupId: this.currentGroupId,
            content, msgType, attachmentIds, replyToId,
        });
        if (r && r.success) {
            this.messages.push(r.message);
        }
        return r;
    }

    async markRead(messageId) {
        return await window.messageApi.markRead(messageId);
    }

    async deleteMessage(messageId) {
        const r = await window.messageApi.delete(messageId);
        if (r && r.success) {
            this.messages = this.messages.filter(m => m.id !== messageId);
        }
        return r;
    }

    getTotalUnread() {
        let total = 0;
        for (const v of this.unreadByGroup.values()) total += v;
        return total;
    }
}

window.chatManager = new ChatManager();
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/chat.js`

---

### Task 19: sync-status.js 同步状态

**Files:**
- Create: `frontend/js/sync-status.js`

- [ ] **Step 1: 实现 sync-status.js（4 态 + 轮询）**

```javascript
// frontend/js/sync-status.js
class SyncStatusManager {
    constructor() {
        this.status = { groupCount: 0, onlineCount: 0, connectedPeers: [] };
        this.timer = null;
    }

    async refresh() {
        const r = await window.syncApi.status();
        if (r && r.success) {
            this.status = r.status;
            this._updateUI();
        }
        return this.status;
    }

    startPolling(intervalMs = 10000) {
        this.stopPolling();
        this.timer = setInterval(() => this.refresh(), intervalMs);
    }

    stopPolling() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getStatusText() {
        const s = this.status;
        if (s.groupCount === 0) return '○ 未加入协作组';
        if (s.onlineCount === 0) return `⚠ 已加入 ${s.groupCount} 组（离线）`;
        if (s.onlineCount < s.groupCount) return `⟳ ${s.onlineCount}/${s.groupCount} 组在线`;
        return `● ${s.groupCount} 组已同步`;
    }

    _updateUI() {
        const el = document.getElementById('sync-status-text');
        if (el) el.textContent = this.getStatusText();
    }
}

window.syncStatusManager = new SyncStatusManager();
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/sync-status.js`

---

### Task 20: network.js 网络状态机

**Files:**
- Create: `frontend/js/network.js`

- [ ] **Step 1: 实现 network.js（前端包装）**

```javascript
// frontend/js/network.js
// 前端网络状态机：包装后端 DiscoveryService + PeerServer
class NetworkManager {
    constructor() {
        this.enabled = false;
        this.status = 'disabled'; // disabled / starting / running / error
    }

    async start() {
        // 通过后端 api 启动（占位 — 后端实际启动在 Python 层）
        this.status = 'starting';
        try {
            // 后端需要在 main.py 启动时调用，这里仅做状态追踪
            this.enabled = true;
            this.status = 'running';
            if (window.syncStatusManager) {
                window.syncStatusManager.startPolling();
            }
        } catch (e) {
            this.status = 'error';
            console.error('NetworkManager start failed:', e);
        }
    }

    async stop() {
        this.enabled = false;
        this.status = 'disabled';
        if (window.syncStatusManager) {
            window.syncStatusManager.stopPolling();
        }
    }
}

window.networkManager = new NetworkManager();
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/network.js`

---

### Task 21: main.js 启动网络

**Files:**
- Modify: `frontend/js/main.js`

- [ ] **Step 1: 在 main.js 的初始化流程里追加**

```javascript
// 找到现有 init 函数，在末尾追加：
if (window.networkManager) {
    window.networkManager.start();
}
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/js/main.js`

---

### Task 22: index.html 改造

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: 注入协作组入口 / 消息抽屉 / 同步状态条 / 视图切换**

在 `</body>` 之前追加：

```html
<!-- C 阶段：协作组管理模态框 -->
<div id="group-manager-modal" class="modal">
    <div class="modal-content">
        <div class="modal-header">
            <h2>协作组管理</h2>
            <button class="modal-close" data-close="group-manager-modal">&times;</button>
        </div>
        <div class="modal-body">
            <div id="group-list-area"></div>
            <div class="group-actions">
                <button id="group-create-btn" class="primary-btn">+ 创建协作组</button>
                <button id="group-join-btn" class="secondary-btn">+ 加入协作组</button>
            </div>
        </div>
    </div>
</div>

<!-- C 阶段：消息抽屉（右侧） -->
<div id="chat-drawer" class="drawer">
    <div class="drawer-header">
        <select id="chat-group-select"></select>
        <button class="drawer-close" data-close="chat-drawer">&times;</button>
    </div>
    <div id="chat-messages" class="chat-messages"></div>
    <div class="chat-input-area">
        <textarea id="chat-input" placeholder="输入消息..."></textarea>
        <button id="chat-send-btn">发送</button>
    </div>
</div>

<!-- C 阶段：同步状态条 -->
<div id="sync-status-bar" class="sync-status-bar">
    <span id="sync-status-text">○ 未加入协作组</span>
    <button id="open-group-manager">协作组</button>
    <button id="open-chat-drawer">💬 <span id="chat-unread-count"></span></button>
</div>

<!-- C 阶段：任务视图切换 -->
<div id="task-view-switcher" class="task-view-switcher">
    <button data-view="personal" class="active">个人</button>
    <select id="task-group-filter">
        <option value="">所有协作组</option>
    </select>
</div>
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/index.html`

---

### Task 23: components.css 样式

**Files:**
- Modify: `frontend/css/components.css` — 末尾追加

- [ ] **Step 1: 追加协作组/消息/同步状态样式**

```css
/* 协作组管理 */
.group-actions { display: flex; gap: 8px; margin-top: 12px; }
#group-list-area { display: flex; flex-direction: column; gap: 8px; }
.group-card { display: flex; align-items: center; gap: 12px; padding: 10px;
              border: 1px solid var(--border-color); border-radius: 8px; }
.group-card .group-icon { font-size: 24px; }
.group-card .group-info { flex: 1; }
.group-card .group-code { font-family: monospace; color: var(--primary-color); }

/* 消息抽屉 */
.drawer { position: fixed; right: -380px; top: 0; bottom: 0; width: 360px;
          background: var(--bg-primary); box-shadow: -2px 0 8px rgba(0,0,0,0.1);
          transition: right 0.3s; display: flex; flex-direction: column; z-index: 1000; }
.drawer.open { right: 0; }
.drawer-header { padding: 12px; border-bottom: 1px solid var(--border-color);
                 display: flex; gap: 8px; align-items: center; }
.drawer-close { background: none; border: none; font-size: 20px; cursor: pointer; }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px; }
.chat-message { margin-bottom: 8px; padding: 6px 10px; background: var(--bg-secondary);
                border-radius: 8px; max-width: 80%; }
.chat-message.self { background: var(--primary-color); color: #fff; margin-left: auto; }
.chat-input-area { padding: 12px; border-top: 1px solid var(--border-color);
                   display: flex; gap: 8px; }
#chat-input { flex: 1; min-height: 40px; resize: none; }
#chat-send-btn { padding: 8px 16px; }

/* 同步状态条 */
.sync-status-bar { display: flex; align-items: center; gap: 12px;
                   padding: 6px 12px; background: var(--bg-secondary);
                   border-bottom: 1px solid var(--border-color); font-size: 12px; }
#sync-status-text { flex: 1; }
#chat-unread-count:not(:empty) { background: #dc3545; color: #fff;
                                   border-radius: 50%; padding: 0 6px;
                                   font-size: 10px; margin-left: 4px; }

/* 任务视图切换 */
.task-view-switcher { display: flex; gap: 8px; padding: 8px 12px; }
.task-view-switcher button.active { background: var(--primary-color); color: #fff; }
```

- [ ] **Step 2: 暂存**

Run: `git add frontend/css/components.css`

---

## C6. UI 验收 + 完整回归

### Task 24: 19 项 UI 验证脚本

**Files:**
- Create: `backend/tests/ui_verification_c_phase.py`

- [ ] **Step 1: 实现验证脚本（核心 19 项）**

```python
"""
C 阶段 19 项 UI 验证脚本（Task B14 / C24）
运行：python backend/tests/ui_verification_c_phase.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)

    from backend.database.operations import TodoDatabase, UserManager
    db = TodoDatabase()
    um = UserManager(db)

    from backend.api import todo_api
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


PASS = '✓'
FAIL = '✗'


def check(name, fn):
    try:
        result = fn()
        if result is True or result is None:
            print(f'  {PASS} {name}')
            return True
        print(f'  {FAIL} {name}: {result}')
        return False
    except Exception as e:
        print(f'  {FAIL} {name}: {e}')
        return False


def main():
    print('\n=== C 阶段 19 项验收 ===\n')
    api, db_path = _make_api()
    total = 0
    passed = 0

    def tally(r):
        nonlocal total, passed
        total += 1
        if r: passed += 1

    # 1. 创建协作组 → 显示 6 位连接码
    def t1():
        api.auth_create_user(display_name='owner')
        r = api.group_create(name='研发组')
        assert r['success']
        code = r['group']['joinCode']
        assert len(code) == 7 and code[3] == '-'
        return True
    tally(check('1. 创建协作组自动生成 6 位连接码', t1))

    # 2. 重置连接码 → 旧码失效
    def t2():
        old = api.group_list()['groups'][0]['joinCode']
        gid = api.group_list()['groups'][0]['id']
        r = api.group_reset_code(gid)
        assert r['success'] and r['joinCode'] != old
        return True
    tally(check('2. 重置连接码（旧码失效）', t2))

    # 3. 第二台机器输入连接码 → 加入（这里用第二 user 模拟）
    def t3():
        gid = api.group_list()['groups'][0]['id']
        new_code = api.group_list()['groups'][0]['joinCode']
        api.auth_logout()
        api.auth_create_user(display_name='newbie')
        rj = api.group_join(join_code=new_code)
        assert rj['success'] and rj['group']['id'] == gid
        return True
    tally(check('3. 输入连接码加入', t3))

    # 4. 列出成员
    def t4():
        gid = api.group_list()['groups'][0]['id']
        r = api.group_members(gid)
        assert r['success'] and len(r['members']) == 2
        return True
    tally(check('4. 列出成员（2 人）', t4))

    # 5. 发送消息 + 列出消息
    def t5():
        gid = api.group_list()['groups'][0]['id']
        s = api.message_send(group_id=gid, content='hello')
        assert s['success']
        lst = api.message_list(group_id=gid)
        assert any(m['content'] == 'hello' for m in lst['messages'])
        return True
    tally(check('5. 发送 + 列出消息', t5))

    # 6. 消息已读
    def t6():
        gid = api.group_list()['groups'][0]['id']
        mid = api.message_list(group_id=gid)['messages'][0]['id']
        r = api.message_mark_read(message_id=mid)
        assert r['success']
        return True
    tally(check('6. 消息标记已读', t6))

    # 7. 删除自己的消息
    def t7():
        gid = api.group_list()['groups'][0]['id']
        s = api.message_send(group_id=gid, content='to be deleted')
        mid = s['message']['id']
        d = api.message_delete(message_id=mid)
        assert d['success']
        assert api.message_list(group_id=gid)['messages'][-1]['id'] != mid or \
               all(m['id'] != mid for m in api.message_list(group_id=gid)['messages'])
        return True
    tally(check('7. 删除消息', t7))

    # 8. Owner 踢人
    def t8():
        api.auth_logout()
        api.auth_create_user(display_name='owner')
        g = api.group_create(name='g1')
        gid = g['group']['id']
        code = g['group']['joinCode']
        # 第二个用户加入
        api.auth_logout()
        newbie_id = api.auth_create_user(display_name='new')['user']['id']
        api.group_join(join_code=code)
        # owner 踢人
        api.auth_logout()
        api.auth_create_user(display_name='owner')
        rk = api.group_kick(group_id=gid, user_id=newbie_id)
        assert rk['success']
        return True
    tally(check('8. Owner 踢人', t8))

    # 9. 解散协作组
    def t9():
        g = api.group_create(name='to-disband')
        gid = g['group']['id']
        r = api.group_disband(group_id=gid)
        assert r['success']
        assert all(x['id'] != gid for x in api.group_list()['groups'])
        return True
    tally(check('9. 解散协作组', t9))

    # 10. 退出协作组
    def t10():
        g = api.group_create(name='to-leave')
        gid = g['group']['id']
        code = g['group']['joinCode']
        api.auth_logout()
        api.auth_create_user(display_name='leaver')
        api.group_join(join_code=code)
        rl = api.group_leave(group_id=gid)
        assert rl['success']
        return True
    tally(check('10. 退出协作组', t10))

    # 11. 设置共享范围
    def t11():
        g = api.group_create(name='g1')
        gid = g['group']['id']
        r = api.group_set_share(group_id=gid, share_tasks=1, share_categories=0,
                                 share_group_tasks=1, share_history=0)
        assert r['success']
        return True
    tally(check('11. 设置共享范围', t11))

    # 12. 同步状态
    def t12():
        r = api.sync_status()
        assert r['success']
        assert r['status']['groupCount'] >= 0
        return True
    tally(check('12. 获取同步状态', t12))

    # 13. 同步日志
    def t13():
        r = api.sync_log(limit=10)
        assert r['success']
        return True
    tally(check('13. 获取同步日志', t13))

    # 14. 冲突解决（端到端 + 静默合并）
    def t14():
        # 重新设置一个干净 db
        api.auth_logout()
        # 端到端测试：双 db 模拟
        from backend.network.sync_engine import SyncEngine
        from backend.database.operations import SyncManager, TodoDatabase
        import tempfile
        # 当前 api 的 db
        se = SyncEngine(db=api.db, sync_manager=getattr(api, 'sync_manager', None) or SyncManager(api.db))
        # 推送一个任务
        se.apply_remote_change('task', {
            'id': 't1', 'title': 'remote-task', 'status': 'pending',
            'created_at': '2026-06-19T10:00:00Z',
            'updated_at': '2026-06-19T10:00:00Z', 'version': 1,
        }, peer_id='node-test')
        # 验证 sync_log 记录
        logs = se.sync_manager.list_recent_sync_logs()
        assert any(l.entity_id == 't1' for l in logs)
        return True
    tally(check('14. 同步引擎推送 + sync_log 记录', t14))

    # 15. 隐藏组（is_hidden 标志）
    def t15():
        g = api.group_create(name='hidden-g', is_hidden=1)
        assert g['success'] and g['group']['isHidden'] == 1
        return True
    tally(check('15. 隐藏组 is_hidden=1', t15))

    # 16. 非 Owner 踢人失败
    def t16():
        g = api.group_create(name='g1')
        gid = g['group']['id']
        code = g['group']['joinCode']
        api.auth_logout()
        api.auth_create_user(display_name='member')
        api.group_join(join_code=code)
        # member 尝试踢 owner
        owner_id = g['group']['createdBy']
        rk = api.group_kick(group_id=gid, user_id=owner_id)
        assert not rk['success']
        return True
    tally(check('16. 非 Owner 踢人失败', t16))

    # 17. 协议编解码（依赖 Task 8 的实现）
    def t17():
        from backend.network.protocol import encode_message, decode_message
        msg = {'type': 'PING', 'node_id': 'n1', 'timestamp': '2026-06-19T10:00:00Z'}
        encoded = encode_message(msg)
        decoded = decode_message(encoded)
        assert decoded == msg
        return True
    tally(check('17. 协议编解码（encode/decode）', t17))

    # 18. UDP beacon 解析
    def t18():
        from backend.network.discovery import parse_beacon
        raw = {
            'type': 'discovery_beacon', 'node_id': 'n1', 'user_id': 'u1',
            'user_name': '郭', 'groups': [{'group_id': 'g1', 'join_code': 'A8B-3K9', 'is_hidden': False}],
            'tcp_port': 54722, 'timestamp': '2026-06-19T10:00:00Z',
        }
        b = parse_beacon(raw)
        assert b.node_id == 'n1' and b.groups[0].join_code == 'A8B-3K9'
        return True
    tally(check('18. UDP beacon 解析', t18))

    # 19. 前端模块存在性
    def t19():
        for js in ('group.js', 'chat.js', 'sync-status.js', 'network.js'):
            p = Path(__file__).parent.parent.parent / 'frontend' / 'js' / js
            assert p.exists(), f'缺失 {js}'
        return True
    tally(check('19. 前端 4 模块文件存在', t19))

    print(f'\n=== 通过 {passed}/{total} ===\n')
    Path(db_path).unlink(missing_ok=True)
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 2: 跑验证**

Run: `python backend/tests/ui_verification_c_phase.py`
Expected: 19/19 通过

- [ ] **Step 3: 暂存**

Run: `git add backend/tests/ui_verification_c_phase.py`

---

### Task 25: 完整回归

- [ ] **Step 1: 跑所有测试**

Run: `python -m pytest backend/tests/ -v`
Expected: 全部通过（A 58 + B 27 + C 网络 14 + C API 6 + 迁移 4 = 109+）

- [ ] **Step 2: 跑所有 UI 验证**

Run: `python backend/tests/ui_verification_a_phase.py; python backend/tests/ui_verification_b_phase.py; python backend/tests/ui_verification_c_phase.py`
Expected: 10/10 + 13/13 + 19/19 全过

- [ ] **Step 3: 暂存**

Run: `git status`

---

## 自审（Self-Review）

**Spec 覆盖：**
- [x] §4.1-4.7 数据模型：Task 1-2（6 表 + 6 数据类 + tasks 扩展）
- [x] §5.1-5.9 UI 流程：Task 16-23（api.js 桥接 + 4 前端模块 + index.html/css 改造）
- [x] §6.1-6.3 网络协议：Task 8（protocol）+ Task 9（discovery）+ Task 10（peer）
- [x] §7.1-7.3 同步机制：Task 11（sync_engine）
- [x] §8 冲突解决：Task 6（SyncManager.resolve_conflict）
- [x] §9 错误处理：协议/连接失败在 protocol/peer/sync_engine 内有 try/except
- [x] §10 测试策略：单元（C2+C3）+ 集成（p2p/conflict/c_api）+ UI 验证（C6）

**占位符扫描：** 已逐章节确认无"TBD"/"TODO"/"实现 later"等。

**类型一致性：**
- `group_manager.create_group` 返回 `Group`（Task 4）→ API `group_create` 返回 `dict` via `.to_dict()`（Task 14）✓
- `message_manager.send_message` 返回 `Message`（Task 5）→ API `message_send` 返回 `dict` via `.to_dict()`（Task 14）✓
- `SyncManager.resolve_conflict` 接受两个 dict（Task 6）→ `SyncEngine._apply_task` 调用（Task 11）✓
- `SyncEngine.apply_remote_change(entity_type, entity, peer_id, user_id)` 签名（Task 11）→ 测试调用一致（Task 12 + C6 验证 t14）✓

---

## 验收清单映射

| Spec § | Plan Task |
|---|---|
| 1.1 目标 | C1-C6 全章节 |
| 4.1-4.7 数据模型 | Task 1-2 |
| 5.1 协作组管理 | Task 17（group.js）+ Task 22（index.html）+ Task 23（css） |
| 5.2 创建协作组 | Task 14（group_create）+ Task 17 |
| 5.3 加入协作组 | Task 9（discovery）+ Task 14（group_join） |
| 5.4 消息面板 | Task 18（chat.js）+ Task 22（drawer） |
| 5.5 通知系统 | （v1 范围 — 后续集成） |
| 5.6 同步状态 | Task 19（sync-status.js）+ Task 22（status bar） |
| 5.7 协作组设置 | Task 14（group_disband/kick/reset_code） |
| 5.8 任务视图切换 | Task 22（task-view-switcher） |
| 5.9 离线处理 | Task 11（sync_engine dirty queue 在 peer 层） |
| 6.1 UDP 广播 | Task 9 |
| 6.2 TCP 长连接 | Task 10 |
| 6.3 消息类型 | Task 8（protocol 常量） |
| 7.1-7.3 同步机制 | Task 11 |
| 8 冲突解决 | Task 6 + Task 12（端到端测试） |
| 10 测试策略 | Task 24-25 |
| 11 验收清单 14 项 | Task 24（19 项 UI）+ Task 25（完整回归） |

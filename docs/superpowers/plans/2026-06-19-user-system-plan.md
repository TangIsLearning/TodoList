# 用户系统（User System）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TodoList 引入完整用户系统——多账号、用户卡片、任务协作扩展、字段级审计。

**Architecture:** SQLite 扩展 + `UserManager` 后端类 + `js/user.js` 前端模块 + 替换"联系作者"按钮为用户卡片。

**Tech Stack:** Python 3.10+ / SQLite / pywebview / 原生 JavaScript（无框架）/ 已有 utils（uuid / datetime）。

**Spec:** [2026-06-19-user-system-design.md](../specs/2026-06-19-user-system-design.md)

**Codebase map:**
- `backend/database/models.py` — 增 `User` / `UserSession` / `TaskAuditLog`
- `backend/database/operations.py` — 增 `UserManager`；扩展 `_migrate_database()`；`TodoDatabase` 增 `current_user_id` 上下文
- `backend/api/todo_api.py` — 增 9 个 auth/user API
- `frontend/js/user.js` — 新建
- `frontend/js/profile.js` — 新建
- `frontend/index.html` — 替换"联系作者"区域
- `frontend/css/components.css` — 增用户卡片样式

---

## Task 1: 数据库迁移（users / user_sessions / task_audit_log + tasks 扩展）

**Files:**
- Modify: `backend/database/operations.py:27-68` — 扩展 `_migrate_database()`

- [ ] **Step 1: 写迁移测试**

新建 `backend/tests/test_migration.py`：

```python
import sqlite3
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import _migrate_database

def test_migrate_adds_users_table():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()
        
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        )
        assert cur.fetchone() is not None
    finally:
        Path(path).unlink()

def test_migrate_adds_task_audit_log_table():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()
        
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task_audit_log'"
        )
        assert cur.fetchone() is not None
    finally:
        Path(path).unlink()

def test_migrate_adds_task_extension_columns():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()
        
        cols = [row[1] for row in conn.execute('PRAGMA table_info(tasks)').fetchall()]
        for expected in ['owning_dept_id', 'cooperating_dept_ids',
                         'owner_user_id', 'cooperator_user_ids', 'audit_enabled']:
            assert expected in cols, f'Missing column: {expected}'
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd d:\FamilyDocuments\01郭世锋\02Dev\TodoList
python -m pytest backend/tests/test_migration.py -v
```

Expected: 3 个测试 FAIL（`_migrate_database` 还没扩展）。

- [ ] **Step 3: 扩展 `_migrate_database()`**

修改 `backend/database/operations.py`，**追加**到 `_migrate_database()` 函数末尾（在 `task_tags` 创建之后）：

```python
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

    # tasks 扩展字段
    cursor.execute("PRAGMA table_info(tasks)")
    columns = [column[1] for column in cursor.fetchall()]
    
    task_new_cols = [
        ('owning_dept_id', 'TEXT'),
        ('cooperating_dept_ids', 'TEXT'),
        ('owner_user_id', 'TEXT'),
        ('cooperator_user_ids', 'TEXT'),
        ('audit_enabled', 'INTEGER DEFAULT 1')
    ]
    for col_name, col_def in task_new_cols:
        if col_name not in columns:
            cursor.execute(f'ALTER TABLE tasks ADD COLUMN {col_name} {col_def}')
```

注意：函数开头已有 `cursor.execute("PRAGMA table_info(tasks)")` 和 `columns = ...`，需要**复用**而不是重复定义。读取现有代码后修改。

- [ ] **Step 4: 再次运行测试**

```bash
python -m pytest backend/tests/test_migration.py -v
```

Expected: 3 个测试 PASS。

- [ ] **Step 5: 手动验证：现有数据库可正常升级**

启动应用：
```bash
python main.py
```

观察启动日志无报错；关闭后查看 `data/todo.db`：
```bash
sqlite3 data/todo.db ".schema users"  # Linux/macOS
# Windows 用 DB Browser for SQLite 或 python -c "import sqlite3; conn=sqlite3.connect('data/todo.db'); print(conn.execute('SELECT sql FROM sqlite_master WHERE name=\"users\"').fetchone()[0])"
```

Expected: 看到 `users` / `user_sessions` / `task_audit_log` 三表 schema 正确。

- [ ] **Step 6: Commit**

```bash
git add backend/database/operations.py backend/tests/test_migration.py
git commit -m "feat(user): migrate users, user_sessions, task_audit_log + tasks extension"
```

---

## Task 2: User 模型类

**Files:**
- Modify: `backend/database/models.py` — 增 `User` 类

- [ ] **Step 1: 写模型测试**

新建 `backend/tests/test_models_user.py`：

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.models import User

def test_user_to_dict():
    u = User(
        id='u-1', display_name='郭世锋', unit='某公司',
        department='研发部', role='工程师', avatar_color='#ff0000'
    )
    d = u.to_dict()
    assert d['id'] == 'u-1'
    assert d['displayName'] == '郭世锋'
    assert d['unit'] == '某公司'
    assert d['department'] == '研发部'
    assert d['role'] == '工程师'
    assert d['avatarColor'] == '#ff0000'
    assert d['isDeleted'] is False

def test_user_from_dict():
    data = {
        'id': 'u-2', 'displayName': '李明', 'unit': '某公司',
        'department': '产品部', 'role': 'PM', 'avatarColor': '#00ff00',
        'isDeleted': True
    }
    u = User.from_dict(data)
    assert u.id == 'u-2'
    assert u.display_name == '李明'
    assert u.unit == '某公司'
    assert u.department == '产品部'
    assert u.role == 'PM'
    assert u.avatar_color == '#00ff00'
    assert u.is_deleted is True

def test_user_default_avatar_color():
    u = User(display_name='测试')
    assert u.avatar_color == '#4f46e5'
```

- [ ] **Step 2: 运行测试确认失败**

```bash
python -m pytest backend/tests/test_models_user.py -v
```

Expected: FAIL (`User` 类不存在)。

- [ ] **Step 3: 在 `models.py` 末尾追加 `User` 类**

```python
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
        return cls(
            id=data.get('id'),
            display_name=data.get('displayName', ''),
            unit=data.get('unit'),
            department=data.get('department'),
            role=data.get('role'),
            avatar_color=data.get('avatarColor', '#4f46e5'),
            is_deleted=bool(data.get('isDeleted', False))
        )
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_models_user.py -v
```

Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/models.py backend/tests/test_models_user.py
git commit -m "feat(user): add User model class"
```

---

## Task 3: UserSession 和 TaskAuditLog 模型

**Files:**
- Modify: `backend/database/models.py` — 增 2 个类

- [ ] **Step 1: 写测试**

追加到 `backend/tests/test_models_user.py`：

```python
from backend.database.models import UserSession, TaskAuditLog

def test_user_session_to_dict():
    s = UserSession(token='abc123', user_id='u-1')
    d = s.to_dict()
    assert d['token'] == 'abc123'
    assert d['userId'] == 'u-1'

def test_task_audit_log_to_dict():
    log = TaskAuditLog(
        id='log-1', task_id='t-1', user_id='u-1',
        action='update', field='title',
        old_value='old', new_value='new'
    )
    d = log.to_dict()
    assert d['id'] == 'log-1'
    assert d['taskId'] == 't-1'
    assert d['userId'] == 'u-1'
    assert d['action'] == 'update'
    assert d['field'] == 'title'
    assert d['oldValue'] == 'old'
    assert d['newValue'] == 'new'
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_models_user.py -v
```

Expected: FAIL。

- [ ] **Step 3: 实现模型类**

追加到 `models.py` 末尾：

```python
class UserSession:
    """用户会话模型"""
    
    def __init__(self, token, user_id, created_at=None, last_used_at=None):
        self.token = token
        self.user_id = user_id
        self.created_at = created_at or datetime.now()
        self.last_used_at = last_used_at or datetime.now()
    
    def to_dict(self):
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
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_models_user.py -v
```

Expected: 5 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/models.py backend/tests/test_models_user.py
git commit -m "feat(user): add UserSession and TaskAuditLog models"
```

---

## Task 4: UserManager - 创建用户

**Files:**
- Modify: `backend/database/operations.py` — 增 `UserManager` 类
- Create: `backend/tests/test_user_manager.py`

- [ ] **Step 1: 写测试**

```python
import sys
import tempfile
import sqlite3
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import TodoDatabase, UserManager

def _fresh_db():
    """返回新 TodoDatabase 实例 + 清理"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    # 替换默认 db path
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    db = TodoDatabase()
    return db, tmp.name

def test_user_manager_create():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='郭世锋', unit='某公司', department='研发部')
        assert u.display_name == '郭世锋'
        assert u.id is not None
    finally:
        Path(path).unlink()

def test_user_manager_duplicate_triple_rejected():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        um.create_user(display_name='郭世锋', unit='某公司', department='研发部')
        try:
            um.create_user(display_name='郭世锋', unit='某公司', department='研发部')
            assert False, '应该抛错'
        except ValueError as e:
            assert '已存在' in str(e) or 'DUPLICATE' in str(e).upper()
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: FAIL (`UserManager` 不存在)。

- [ ] **Step 3: 实现 `UserManager` 骨架（只含 `create_user`）**

追加到 `backend/database/operations.py` 末尾：

```python
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
```

注：`TodoDatabase` 需要有 `get_connection()` 上下文管理器。如果没有，请在 `TodoDatabase` 类中**新增**：

```python
    @contextmanager
    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()
```

并在文件顶部导入 `from contextlib import contextmanager`。

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 2 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/operations.py backend/tests/test_user_manager.py
git commit -m "feat(user): UserManager.create_user with triple uniqueness"
```

---

## Task 5: UserManager - 查询/更新/删除/列表

**Files:**
- Modify: `backend/database/operations.py` — 增方法
- Modify: `backend/tests/test_user_manager.py`

- [ ] **Step 1: 追加测试**

```python
def test_user_manager_get_by_id():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='王芳')
        loaded = um.get_user(u.id)
        assert loaded is not None
        assert loaded.display_name == '王芳'
    finally:
        Path(path).unlink()

def test_user_manager_update():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='赵磊')
        um.update_user(u.id, role='架构师', avatar_color='#ff0000')
        loaded = um.get_user(u.id)
        assert loaded.role == '架构师'
        assert loaded.avatar_color == '#ff0000'
    finally:
        Path(path).unlink()

def test_user_manager_soft_delete():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='陈一')
        um.delete_user(u.id)
        # 软删除后 get_user 返回 None
        assert um.get_user(u.id) is None
        # 列表过滤已删
        assert all(x.id != u.id for x in um.list_local_users())
    finally:
        Path(path).unlink()

def test_user_manager_list_excludes_deleted():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u1 = um.create_user(display_name='A1')
        u2 = um.create_user(display_name='A2')
        um.delete_user(u1.id)
        users = um.list_local_users()
        ids = [u.id for u in users]
        assert u2.id in ids
        assert u1.id not in ids
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 4 个新测试 FAIL。

- [ ] **Step 3: 实现方法**

在 `UserManager` 类内 `create_user` 之后追加：

```python
    def get_user(self, user_id) -> 'User | None':
        from backend.database.models import User
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT * FROM users WHERE id = ? AND is_deleted = 0', (user_id,))
            row = cur.fetchone()
        if not row:
            return None
        return User(
            id=row['id'], display_name=row['display_name'],
            unit=row['unit'], department=row['department'], role=row['role'],
            avatar_color=row['avatar_color'] or '#4f46e5',
            created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None,
            last_active_at=datetime.fromisoformat(row['last_active_at']) if row['last_active_at'] else None
        )
    
    def update_user(self, user_id, display_name=None, unit=None, department=None,
                    role=None, avatar_color=None) -> 'User':
        from backend.database.models import User
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            existing = self.get_user(user_id)
            if not existing:
                raise ValueError(f'用户不存在: {user_id}')
            new_dn = display_name if display_name is not None else existing.display_name
            new_unit = unit if unit is not None else existing.unit
            new_dept = department if department is not None else existing.department
            new_role = role if role is not None else existing.role
            new_color = avatar_color if avatar_color is not None else existing.avatar_color
            
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
        """软删除：同时把其 owner_user_id 置 NULL，清除协办人引用"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE users SET is_deleted = 1 WHERE id = ?', (user_id,))
            # 该用户拥有的任务 owner_user_id 置 NULL
            cur.execute('UPDATE tasks SET owner_user_id = NULL WHERE owner_user_id = ?', (user_id,))
            # 从协办人 JSON 中移除该用户
            cur.execute("SELECT id, cooperator_user_ids FROM tasks WHERE cooperator_user_ids LIKE ?",
                        (f'%{user_id}%',))
            for row in cur.fetchall():
                ids = json.loads(row['cooperator_user_ids'] or '[]')
                if user_id in ids:
                    ids.remove(user_id)
                    cur.execute('UPDATE tasks SET cooperator_user_ids = ? WHERE id = ?',
                                (json.dumps(ids), row['id']))
            conn.commit()
    
    def list_local_users(self) -> list['User']:
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT * FROM users WHERE is_deleted = 0
                ORDER BY last_active_at DESC NULLS LAST, created_at DESC
            ''')
            rows = cur.fetchall()
        result = []
        for row in rows:
            result.append(self.get_user(row['id']))
        return result
```

注：SQLite 旧版本不支持 `NULLS LAST`，如果失败改用：
```sql
ORDER BY (last_active_at IS NULL), last_active_at DESC, created_at DESC
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 6 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/operations.py backend/tests/test_user_manager.py
git commit -m "feat(user): UserManager get/update/delete/list"
```

---

## Task 6: UserManager - Session 管理

**Files:**
- Modify: `backend/database/operations.py` — 增 session 方法
- Modify: `backend/tests/test_user_manager.py`

- [ ] **Step 1: 追加测试**

```python
def test_session_create_and_get():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='会话测试')
        token = um.create_session(u.id)
        assert token is not None
        assert len(token) >= 32
        loaded = um.get_user_by_token(token)
        assert loaded is not None
        assert loaded.id == u.id
    finally:
        Path(path).unlink()

def test_session_heartbeat():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='心跳测试')
        token = um.create_session(u.id)
        import time
        time.sleep(0.1)
        um.heartbeat(token)
        loaded = um.get_user_by_token(token)
        assert loaded.last_active_at is not None
    finally:
        Path(path).unlink()

def test_session_logout():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='退出测试')
        token = um.create_session(u.id)
        um.logout(token)
        assert um.get_user_by_token(token) is None
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 3 个新测试 FAIL。

- [ ] **Step 3: 实现方法**

在 `UserManager` 类内追加：

```python
    def create_session(self, user_id) -> str:
        """创建 session，返回 token"""
        import secrets
        token = secrets.token_urlsafe(48)  # 64 字符左右
        now = datetime.now().isoformat()
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO user_sessions (token, user_id, created_at, last_used_at)
                VALUES (?, ?, ?, ?)
            ''', (token, user_id, now, now))
            cur.execute('UPDATE users SET last_active_at = ? WHERE id = ?', (now, user_id))
            conn.commit()
        return token
    
    def get_user_by_token(self, token) -> 'User | None':
        """根据 token 获取当前用户"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT user_id FROM user_sessions WHERE token = ?', (token,))
            row = cur.fetchone()
        if not row:
            return None
        return self.get_user(row['user_id'])
    
    def heartbeat(self, token):
        """更新 session 和用户的 last_active_at"""
        now = datetime.now().isoformat()
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('UPDATE user_sessions SET last_used_at = ? WHERE token = ?',
                        (now, token))
            cur.execute('''
                UPDATE users SET last_active_at = ?
                WHERE id = (SELECT user_id FROM user_sessions WHERE token = ?)
            ''', (now, token))
            conn.commit()
    
    def logout(self, token):
        """清除 session"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('DELETE FROM user_sessions WHERE token = ?', (token,))
            conn.commit()
    
    def get_current_token(self) -> str | None:
        """获取本机当前的 session token（单活跃 session）"""
        with self.db.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('SELECT token FROM user_sessions ORDER BY last_used_at DESC LIMIT 1')
            row = cur.fetchone()
        return row['token'] if row else None
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 9 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/operations.py backend/tests/test_user_manager.py
git commit -m "feat(user): session management (create/get/heartbeat/logout)"
```

---

## Task 7: 任务审计日志写入

**Files:**
- Modify: `backend/database/operations.py` — `TodoDatabase` 增 `set_current_user` + 审计写入辅助
- Modify: `backend/tests/test_user_manager.py`

- [ ] **Step 1: 写测试**

```python
def test_audit_log_create():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='审计测试')
        db.set_current_user(u.id)
        t = db.add_todo(title='任务1', current_user_id=u.id)
        logs = db.get_task_audit_log(t.id)
        assert len(logs) == 1
        assert logs[0].action == 'create'
        assert logs[0].user_id == u.id
    finally:
        Path(path).unlink()

def test_audit_log_update_field_level():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='审计字段')
        db.set_current_user(u.id)
        t = db.add_todo(title='原标题', current_user_id=u.id)
        db.update_todo(t.id, {'title': '新标题'}, current_user_id=u.id)
        logs = db.get_task_audit_log(t.id)
        # 应该有 create + update 两条
        actions = [l.action for l in logs]
        assert 'create' in actions
        assert 'update' in actions
        update_log = next(l for l in logs if l.action == 'update')
        assert update_log.field == 'title'
        assert update_log.old_value == '原标题'
        assert update_log.new_value == '新标题'
    finally:
        Path(path).unlink()

def test_audit_disabled_no_log():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='审计关闭')
        db.set_current_user(u.id)
        t = db.add_todo(title='任务', audit_enabled=False, current_user_id=u.id)
        logs = db.get_task_audit_log(t.id)
        assert logs == []  # 审计关闭时不写
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 3 个新测试 FAIL（add_todo 不支持 audit_enabled 等）。

- [ ] **Step 3: 修改 `TodoDatabase` 增 current_user 字段 + 审计方法**

**注意**：现有 `add_todo` / `update_todo` 签名需保持兼容（`current_user_id` 和 `audit_enabled` 为可选）。

在 `TodoDatabase` 类开头加：

```python
    def __init__(self):
        # ... 现有初始化 ...
        self._current_user_id = None
    
    def set_current_user(self, user_id):
        self._current_user_id = user_id
    
    def _write_audit(self, conn, task_id, action, field=None, old=None, new=None):
        """内部：写审计日志（仅当 audit_enabled=1）"""
        if not self._current_user_id:
            return  # 无当前用户时跳过
        cur = conn.cursor()
        cur.execute('SELECT audit_enabled FROM tasks WHERE id = ?', (task_id,))
        row = cur.fetchone()
        if not row or not row[0]:
            return
        cur.execute('''
            INSERT INTO task_audit_log (id, task_id, user_id, action, field, old_value, new_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (str(uuid.uuid4()), task_id, self._current_user_id,
              action, field, old, new, datetime.now().isoformat()))
    
    def get_task_audit_log(self, task_id) -> list['TaskAuditLog']:
        from backend.database.models import TaskAuditLog
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('''
                SELECT * FROM task_audit_log WHERE task_id = ?
                ORDER BY created_at DESC
            ''', (task_id,))
            rows = cur.fetchall()
        result = []
        for row in rows:
            result.append(TaskAuditLog(
                id=row['id'], task_id=row['task_id'], user_id=row['user_id'],
                action=row['action'], field=row['field'],
                old_value=row['old_value'], new_value=row['new_value'],
                created_at=datetime.fromisoformat(row['created_at']) if row['created_at'] else None
            ))
        return result
```

修改 `add_todo` 在**事务结尾**写审计：

```python
    def add_todo(self, title, description='', due_date=None, priority='none',
                 category_id=None, is_recurring=False, recurrence_type=None,
                 recurrence_interval=1, recurrence_count=None, parent_task_id=None,
                 audit_enabled=True, current_user_id=None, **kwargs):
        # ... 现有 INSERT 逻辑 ...
        new_id = ...  # 已存在
        
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute('INSERT INTO tasks ...')  # 已存在
            # A 扩展字段
            cur.execute('''
                UPDATE tasks SET audit_enabled=?, owning_dept_id=?,
                                 cooperating_dept_ids=?, owner_user_id=?,
                                 cooperator_user_ids=?
                WHERE id=?
            ''', (1 if audit_enabled else 0,
                  kwargs.get('owning_dept_id'),
                  json.dumps(kwargs.get('cooperating_dept_ids') or []),
                  kwargs.get('owner_user_id') or current_user_id,
                  json.dumps(kwargs.get('cooperator_user_ids') or []),
                  new_id))
            # 写审计
            self._write_audit(conn, new_id, 'create')
            conn.commit()
        return task  # 或 self.get_todo(new_id)
```

具体修改方式：读现有 `add_todo` / `update_todo` / `delete_todo` / `toggle_todo` 实现，**在每个方法的事务末尾**插入：
- `add_todo` 后 → `_write_audit(conn, task_id, 'create')`
- `update_todo` 字段变更后 → 对每个变更字段写 `('update', field, old, new)` 审计
- `delete_todo` 后 → `_write_audit(conn, task_id, 'delete')`
- `toggle_todo` 后 → `_write_audit(conn, task_id, 'complete' or 'uncomplete')`

**update_todo 的字段级审计示例**：

```python
def update_todo(self, task_id, updates: dict, current_user_id=None, **kwargs):
    with self.get_connection() as conn:
        cur = conn.cursor()
        # 读旧值
        cur.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
        old_row = cur.fetchone()
        if not old_row:
            return None
        old_dict = dict(old_row)
        
        # 应用更新（保持现有 UPDATE 逻辑）
        # ... 现有 set clause 构建和执行 ...
        
        # 字段级审计
        for field, new_value in updates.items():
            old_value = old_dict.get(field)
            if str(old_value) != str(new_value):
                self._write_audit(conn, task_id, 'update', field, str(old_value), str(new_value))
        
        conn.commit()
    return self.get_todo(task_id)
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_user_manager.py -v
```

Expected: 12 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/database/operations.py backend/tests/test_user_manager.py
git commit -m "feat(user): task audit log (create/update/delete/complete)"
```

---

## Task 8: auth API - get_current_user / create_user

**Files:**
- Modify: `backend/api/todo_api.py` — 增 auth API
- Create: `backend/tests/test_auth_api.py`

- [ ] **Step 1: 写测试**

```python
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

def _setup_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase
    return TodoDatabase(), tmp.name

def test_api_auth_get_current_user_none():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_get_current_user
        result = auth_get_current_user()
        assert result['success'] is True
        assert result['user'] is None
        assert result['token'] is None
    finally:
        Path(path).unlink()

def test_api_auth_create_user():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user
        result = auth_create_user(display_name='API测试', unit='某公司', department='研发部')
        assert result['success'] is True
        assert result['user']['displayName'] == 'API测试'
        assert result['token'] is not None
        # 三元组重复
        result2 = auth_create_user(display_name='API测试', unit='某公司', department='研发部')
        assert result2['success'] is False
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 2 个测试 FAIL。

- [ ] **Step 3: 实现 API**

在 `backend/api/todo_api.py` 顶部导入：

```python
from backend.database.operations import UserManager, get_app_data_file
```

然后**追加** API 函数：

```python
def _get_user_manager() -> UserManager:
    """获取 UserManager 单例（使用全局 db path）"""
    from backend.database.operations import TodoDatabase
    if not hasattr(_get_user_manager, '_db'):
        _get_user_manager._db = TodoDatabase()
    return UserManager(_get_user_manager._db)


def _get_current_token() -> str | None:
    return _get_user_manager().get_current_token()


def auth_get_current_user() -> dict:
    token = _get_current_token()
    if not token:
        return {'success': True, 'user': None, 'token': None}
    um = _get_user_manager()
    user = um.get_user_by_token(token)
    return {'success': True, 'user': user.to_dict() if user else None, 'token': token}


def auth_create_user(display_name, unit=None, department=None, role=None,
                     avatar_color='#4f46e5') -> dict:
    um = _get_user_manager()
    try:
        user = um.create_user(display_name=display_name, unit=unit,
                              department=department, role=role, avatar_color=avatar_color)
        # 清除旧 session
        old_token = um.get_current_token()
        if old_token:
            um.logout(old_token)
        token = um.create_session(user.id)
        return {'success': True, 'user': user.to_dict(), 'token': token}
    except ValueError as e:
        return {'success': False, 'error': str(e)}
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 2 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/todo_api.py backend/tests/test_auth_api.py
git commit -m "feat(user): auth API - get_current_user, create_user"
```

---

## Task 9: auth API - switch / update / delete / logout

**Files:**
- Modify: `backend/api/todo_api.py` — 增 4 个 API

- [ ] **Step 1: 追加测试**

```python
def test_api_auth_switch_user():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, auth_switch_user, auth_get_current_user
        r1 = auth_create_user(display_name='用户1')
        r2 = auth_create_user(display_name='用户2')
        # 切换到用户1
        result = auth_switch_user(r1['user']['id'])
        assert result['success'] is True
        current = auth_get_current_user()
        assert current['user']['id'] == r1['user']['id']
    finally:
        Path(path).unlink()

def test_api_auth_update_user():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, auth_update_user
        r = auth_create_user(display_name='原名')
        result = auth_update_user(r['user']['id'], role='新角色', avatar_color='#00ff00')
        assert result['success'] is True
        assert result['user']['role'] == '新角色'
    finally:
        Path(path).unlink()

def test_api_auth_logout():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, auth_logout, auth_get_current_user
        auth_create_user(display_name='登出测试')
        result = auth_logout()
        assert result['success'] is True
        current = auth_get_current_user()
        assert current['user'] is None
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 3 个新测试 FAIL。

- [ ] **Step 3: 实现 API**

```python
def auth_switch_user(user_id: str) -> dict:
    um = _get_user_manager()
    user = um.get_user(user_id)
    if not user:
        return {'success': False, 'error': '用户不存在'}
    old_token = um.get_current_token()
    if old_token:
        um.logout(old_token)
    token = um.create_session(user_id)
    return {'success': True, 'user': user.to_dict(), 'token': token}


def auth_update_user(user_id: str, display_name=None, unit=None, department=None,
                     role=None, avatar_color=None) -> dict:
    um = _get_user_manager()
    try:
        user = um.update_user(user_id, display_name, unit, department, role, avatar_color)
        return {'success': True, 'user': user.to_dict()}
    except ValueError as e:
        return {'success': False, 'error': str(e)}


def auth_delete_user(user_id: str) -> dict:
    um = _get_user_manager()
    # 阻止删除最后一个账号
    remaining = [u for u in um.list_local_users() if u.id != user_id]
    if not remaining:
        return {'success': False, 'error': '至少保留一个账号'}
    # 如果删除的是当前用户，logout
    token = um.get_current_token()
    if token:
        current = um.get_user_by_token(token)
        if current and current.id == user_id:
            um.logout(token)
    um.delete_user(user_id)
    return {'success': True}


def auth_logout() -> dict:
    um = _get_user_manager()
    token = um.get_current_token()
    if token:
        um.logout(token)
    return {'success': True}
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 5 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/todo_api.py backend/tests/test_auth_api.py
git commit -m "feat(user): auth API - switch/update/delete/logout"
```

---

## Task 10: auth API - heartbeat / list_local_users / user_search / task_get_audit_log

**Files:**
- Modify: `backend/api/todo_api.py`

- [ ] **Step 1: 追加测试**

```python
def test_api_auth_heartbeat():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, auth_heartbeat, auth_get_current_user
        auth_create_user(display_name='心跳')
        result = auth_heartbeat()
        assert result['success'] is True
    finally:
        Path(path).unlink()

def test_api_auth_list_local_users():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, auth_list_local_users
        auth_create_user(display_name='A')
        auth_create_user(display_name='B')
        result = auth_list_local_users()
        assert result['success'] is True
        names = [u['displayName'] for u in result['users']]
        assert 'A' in names and 'B' in names
    finally:
        Path(path).unlink()

def test_api_user_search():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import auth_create_user, user_search
        auth_create_user(display_name='郭世锋', unit='研发部')
        auth_create_user(display_name='郭艾伦', unit='体育部')
        result = user_search('郭')
        assert result['success'] is True
        assert len(result['users']) == 2
    finally:
        Path(path).unlink()

def test_api_task_get_audit_log():
    db, path = _setup_db()
    try:
        from backend.api.todo_api import (auth_create_user, task_get_audit_log,
                                          todo_api_add_todo)
        r = auth_create_user(display_name='任务审计')
        # 通过 add_todo 创建任务（需 current_user_id）
        from backend.api.todo_api import _get_user_manager
        _get_user_manager().heartbeat(_get_user_manager().get_current_token())
        t = todo_api_add_todo(title='审计任务', current_user_id=r['user']['id'])
        result = task_get_audit_log(t['id'])
        assert result['success'] is True
        assert len(result['logs']) == 1
        assert result['logs'][0]['action'] == 'create'
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 4 个新测试 FAIL。

- [ ] **Step 3: 实现 API**

```python
def auth_heartbeat() -> dict:
    um = _get_user_manager()
    token = um.get_current_token()
    if token:
        um.heartbeat(token)
    return {'success': True}


def auth_list_local_users() -> dict:
    um = _get_user_manager()
    users = um.list_local_users()
    return {
        'success': True,
        'users': [
            {
                'id': u.id, 'displayName': u.display_name,
                'unit': u.unit, 'department': u.department,
                'role': u.role, 'avatarColor': u.avatar_color,
                'lastActiveAt': u.last_active_at.isoformat() if u.last_active_at else None
            }
            for u in users
        ]
    }


def user_search(query: str) -> dict:
    um = _get_user_manager()
    q = f'%{query}%'
    users = um.list_local_users()
    matched = [u for u in users if (
        query.lower() in (u.display_name or '').lower() or
        query.lower() in (u.unit or '').lower() or
        query.lower() in (u.department or '').lower()
    )]
    return {
        'success': True,
        'users': [u.to_dict() for u in matched]
    }


def task_get_audit_log(task_id: str) -> dict:
    db = _get_user_manager().db
    logs = db.get_task_audit_log(task_id)
    return {'success': True, 'logs': [l.to_dict() for l in logs]}
```

- [ ] **Step 4: 运行测试**

```bash
python -m pytest backend/tests/test_auth_api.py -v
```

Expected: 9 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/api/todo_api.py backend/tests/test_auth_api.py
git commit -m "feat(user): auth API - heartbeat/list/search, task audit log API"
```

---

## Task 11: 前端 js/api.js 增 user/auth 调用

**Files:**
- Modify: `frontend/js/api.js`（或现有调用层）

- [ ] **Step 1: 查找现有 API 调用层**

```bash
cd d:\FamilyDocuments\01郭世锋\02Dev\TodoList
ls frontend/js/
grep -l "pywebview\|api\." frontend/js/*.js
```

找到现有的 `pywebview.api` 调用约定。

- [ ] **Step 2: 增 user API 桥接**

在合适位置（如 `frontend/js/api.js` 或类似文件）追加：

```javascript
window.userApi = {
    getCurrent: () => pywebview.api.auth_get_current_user(),
    create: (data) => pywebview.api.auth_create_user(
        data.displayName, data.unit || null, data.department || null,
        data.role || null, data.avatarColor || '#4f46e5'
    ),
    switchUser: (userId) => pywebview.api.auth_switch_user(userId),
    update: (userId, data) => pywebview.api.auth_update_user(
        userId, data.displayName, data.unit, data.department,
        data.role, data.avatarColor
    ),
    delete: (userId) => pywebview.api.auth_delete_user(userId),
    logout: () => pywebview.api.auth_logout(),
    heartbeat: () => pywebview.api.auth_heartbeat(),
    list: () => pywebview.api.auth_list_local_users(),
    search: (q) => pywebview.api.user_search(q),
    getTaskAuditLog: (taskId) => pywebview.api.task_get_audit_log(taskId)
};
```

- [ ] **Step 3: 手动验证**

启动应用，打开 DevTools（F12），执行：
```javascript
userApi.getCurrent().then(r => console.log(r))
```

Expected: `{success: true, user: null, token: null}`

- [ ] **Step 4: Commit**

```bash
git add frontend/js/api.js
git commit -m "feat(user): frontend userApi bridge"
```

---

## Task 12: 前端 - 账号选择页（空状态）

**Files:**
- Modify: `frontend/index.html` — 增账号选择页 DOM
- Create: `frontend/js/user.js` — UserManager + 账号选择页逻辑

- [ ] **Step 1: 增 DOM 结构**

在 `index.html` 的 `<body>` 开头（其他 view 之前）增：

```html
<div id="account-selector-view" class="view-container" style="display: none;">
  <div class="account-selector-wrapper">
    <h1 class="account-selector-title">TodoList</h1>
    <p class="account-selector-subtitle">选择账号以继续</p>
    
    <div id="account-list" class="account-list">
      <!-- JS 动态填充 -->
    </div>
    
    <button id="btn-create-account" class="btn-primary">
      + 创建新账号
    </button>
  </div>
</div>
```

- [ ] **Step 2: 增 CSS 样式**

在 `frontend/css/components.css` 末尾追加：

```css
.account-selector-wrapper {
  max-width: 480px;
  margin: 80px auto;
  padding: 32px;
  text-align: center;
}
.account-selector-title {
  font-size: 2rem;
  margin-bottom: 8px;
  color: var(--text-primary, #e6e7eb);
}
.account-selector-subtitle {
  color: var(--text-secondary, #a0a3b1);
  margin-bottom: 32px;
}
.account-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}
.account-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--panel-bg, #1a1c23);
  border: 1px solid var(--border-color, #2a2d38);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s;
}
.account-item:hover {
  border-color: var(--accent-color, #4f46e5);
  background: var(--panel-hover, #252833);
}
.account-avatar-small {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 1rem;
  margin-right: 12px;
}
.account-info {
  flex: 1;
  text-align: left;
}
.account-name {
  font-weight: 600;
  color: var(--text-primary);
}
.account-meta {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 2px;
}
```

- [ ] **Step 3: 增 UserManager JS**

新建 `frontend/js/user.js`：

```javascript
// UserManager - 管理当前用户状态 + 账号选择页
class UserManager {
    constructor() {
        this.currentUser = null;
        this.currentToken = null;
        this.heartbeatTimer = null;
    }
    
    async init() {
        // 1. 检查当前用户
        const r = await window.userApi.getCurrent();
        if (r.success && r.user) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this._enterMainView();
        } else {
            this._showAccountSelector();
        }
    }
    
    async _showAccountSelector() {
        document.getElementById('main-view').style.display = 'none';
        document.getElementById('account-selector-view').style.display = 'block';
        await this._renderAccountList();
    }
    
    async _renderAccountList() {
        const r = await window.userApi.list();
        const list = document.getElementById('account-list');
        if (!r.users || r.users.length === 0) {
            list.innerHTML = '<p style="color: var(--text-secondary); padding: 24px;">还没有账号，点击下方按钮创建</p>';
            return;
        }
        list.innerHTML = r.users.map(u => `
            <div class="account-item" data-user-id="${u.id}">
                <div class="account-avatar-small" style="background: ${u.avatarColor}">
                    ${this._getInitial(u.displayName)}
                </div>
                <div class="account-info">
                    <div class="account-name">${this._escape(u.displayName)}</div>
                    <div class="account-meta">${this._escape(u.unit || '')} ${u.department ? '· ' + this._escape(u.department) : ''}</div>
                </div>
            </div>
        `).join('');
        
        // 绑定点击
        list.querySelectorAll('.account-item').forEach(el => {
            el.addEventListener('click', () => this.switchUser(el.dataset.userId));
        });
    }
    
    _getInitial(name) {
        return (name || '?').trim().charAt(0).toUpperCase();
    }
    
    _escape(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }
    
    async switchUser(userId) {
        const r = await window.userApi.switchUser(userId);
        if (r.success) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this._enterMainView();
        } else {
            alert('切换失败: ' + r.error);
        }
    }
    
    _enterMainView() {
        document.getElementById('account-selector-view').style.display = 'none';
        document.getElementById('main-view').style.display = 'block';
        this._startHeartbeat();
        // 触发全局事件让其他模块知道用户已切换
        window.dispatchEvent(new CustomEvent('user-changed', {detail: this.currentUser}));
    }
    
    _startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            window.userApi.heartbeat();
        }, 60000);
    }
    
    async logout() {
        await window.userApi.logout();
        this.currentUser = null;
        this.currentToken = null;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this._showAccountSelector();
    }
}

window.userManager = new UserManager();
```

- [ ] **Step 4: 在 `index.html` 引入 user.js + 启动**

修改 `index.html`：
- 在 `</body>` 前增 `<script src="js/user.js"></script>`
- 在 `main.js` 启动处增 `await window.userManager.init();`（或类似的启动钩子）

读取 `main.js` 找到启动点，在**所有现有初始化之前**调用 `userManager.init()`：

```javascript
document.addEventListener('DOMContentLoaded', async () => {
    await window.userManager.init();
    // ... 现有初始化代码
});
```

- [ ] **Step 5: 手动验证**

1. 删除 `data/todo.db`（或备份后删）
2. 启动应用
3. Expected: 显示"还没有账号，点击下方按钮创建"
4. 后续 Task 加"创建账号"模态框后再补全流程

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/css/components.css frontend/js/user.js frontend/js/main.js
git commit -m "feat(user): account selector view + UserManager"
```

---

## Task 13: 前端 - 创建账号模态框

**Files:**
- Modify: `frontend/index.html` — 增创建模态框 DOM
- Modify: `frontend/css/components.css` — 模态框样式
- Modify: `frontend/js/user.js` — 创建逻辑

- [ ] **Step 1: 增模态框 DOM**

在 `index.html` 末尾增：

```html
<div id="create-account-modal" class="modal" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h2>创建新账号</h2>
      <button class="modal-close" data-close="create-account-modal">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>用户名 *</label>
        <input type="text" id="ca-display-name" required>
      </div>
      <div class="form-group">
        <label>单位</label>
        <input type="text" id="ca-unit">
      </div>
      <div class="form-group">
        <label>部门</label>
        <input type="text" id="ca-department">
      </div>
      <div class="form-group">
        <label>角色（自我描述）</label>
        <input type="text" id="ca-role" placeholder="如：工程师、产品经理">
      </div>
      <div class="form-group">
        <label>头像颜色</label>
        <div class="color-picker" id="ca-color-picker">
          <div class="color-dot selected" data-color="#4f46e5" style="background:#4f46e5"></div>
          <div class="color-dot" data-color="#7c3aed" style="background:#7c3aed"></div>
          <div class="color-dot" data-color="#ec4899" style="background:#ec4899"></div>
          <div class="color-dot" data-color="#ef4444" style="background:#ef4444"></div>
          <div class="color-dot" data-color="#f59e0b" style="background:#f59e0b"></div>
          <div class="color-dot" data-color="#22c55e" style="background:#22c55e"></div>
          <div class="color-dot" data-color="#06b6d4" style="background:#06b6d4"></div>
          <div class="color-dot" data-color="#6b7280" style="background:#6b7280"></div>
        </div>
      </div>
      <div class="form-error" id="ca-error" style="display:none;color:#ef4444;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="create-account-modal">取消</button>
      <button class="btn-primary" id="ca-submit">创建</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 增 CSS 样式**

```css
.color-picker {
  display: flex;
  gap: 8px;
}
.color-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s;
}
.color-dot:hover { transform: scale(1.1); }
.color-dot.selected {
  border-color: var(--text-primary, #e6e7eb);
  box-shadow: 0 0 0 2px var(--bg, #0e0f13) inset;
}
```

- [ ] **Step 3: 增 JS 逻辑**

在 `user.js` 的 `UserManager` 类内追加：

```javascript
    initCreateAccountModal() {
        // 颜色选择
        document.querySelectorAll('#ca-color-picker .color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('#ca-color-picker .color-dot')
                    .forEach(d => d.classList.remove('selected'));
                dot.classList.add('selected');
            });
        });
        // 关闭按钮
        document.querySelectorAll('[data-close="create-account-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.closeCreateAccountModal());
        });
        // 提交
        document.getElementById('ca-submit').addEventListener('click', () => this.submitCreateAccount());
        
        // 触发按钮
        document.getElementById('btn-create-account').addEventListener('click', () => {
            this.openCreateAccountModal();
        });
    }
    
    openCreateAccountModal() {
        document.getElementById('create-account-modal').style.display = 'flex';
        document.getElementById('ca-display-name').focus();
    }
    
    closeCreateAccountModal() {
        document.getElementById('create-account-modal').style.display = 'none';
        // 重置表单
        document.getElementById('ca-display-name').value = '';
        document.getElementById('ca-unit').value = '';
        document.getElementById('ca-department').value = '';
        document.getElementById('ca-role').value = '';
        document.getElementById('ca-error').style.display = 'none';
    }
    
    async submitCreateAccount() {
        const displayName = document.getElementById('ca-display-name').value.trim();
        if (!displayName) {
            this._showError('请输入用户名');
            return;
        }
        const colorEl = document.querySelector('#ca-color-picker .color-dot.selected');
        const avatarColor = colorEl ? colorEl.dataset.color : '#4f46e5';
        
        const r = await window.userApi.create({
            displayName,
            unit: document.getElementById('ca-unit').value.trim() || null,
            department: document.getElementById('ca-department').value.trim() || null,
            role: document.getElementById('ca-role').value.trim() || null,
            avatarColor
        });
        if (r.success) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this.closeCreateAccountModal();
            this._enterMainView();
        } else {
            this._showError(r.error || '创建失败');
        }
    }
    
    _showError(msg) {
        const el = document.getElementById('ca-error');
        el.textContent = msg;
        el.style.display = 'block';
    }
```

并在 `init()` 末尾调用 `this.initCreateAccountModal()`。

- [ ] **Step 4: 手动验证**

1. 启动应用
2. 点击"+ 创建新账号"
3. Expected: 模态框弹出
4. 填写用户名/单位/部门/角色 → 选择颜色 → 点击"创建"
5. Expected: 进入主界面

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/css/components.css frontend/js/user.js
git commit -m "feat(user): create account modal"
```

---

## Task 14: 前端 - 替换"联系作者"为用户卡片 + 菜单

**Files:**
- Modify: `frontend/index.html` — 替换"联系作者"区域
- Modify: `frontend/css/components.css` — 用户卡片样式
- Modify: `frontend/js/user.js` — 渲染卡片 + 菜单交互

- [ ] **Step 1: 找到并删除"联系作者"按钮**

在 `index.html` 中搜索 "联系作者" 或 `contact-author`：

```bash
grep -n "联系作者\|contact" frontend/index.html
```

**删除**该 DOM 元素（包括链接/按钮）。

- [ ] **Step 2: 在同一位置插入用户卡片**

```html
<div id="user-card" class="user-card" style="display: none;">
  <div class="user-card-avatar" id="user-card-avatar">
    <span id="user-card-initial">?</span>
    <span class="online-indicator" id="user-card-online"></span>
  </div>
  <div class="user-card-info">
    <div class="user-card-line1">
      <span class="user-card-name" id="user-card-name">用户</span>
      <span class="user-card-role" id="user-card-role"></span>
    </div>
    <div class="user-card-line2" id="user-card-meta"></div>
  </div>
  <button class="user-card-arrow" id="user-card-arrow">▼</button>
  
  <div class="user-menu" id="user-menu" style="display: none;">
    <div class="user-menu-item" data-action="profile">
      <span>⚙</span> 个人设置
    </div>
    <div class="user-menu-item" data-action="switch">
      <span>↻</span> 切换账号
    </div>
    <div class="user-menu-item" data-action="groups">
      <span>👥</span> 协作组管理
    </div>
    <div class="user-menu-separator"></div>
    <div class="user-menu-item danger" data-action="logout">
      <span>⏏</span> 退出登录
    </div>
  </div>
</div>
```

- [ ] **Step 3: 增 CSS 样式**

```css
.user-card {
  position: fixed;
  left: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: var(--panel-bg, #1a1c23);
  border: 1px solid var(--border-color, #2a2d38);
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
  z-index: 100;
  transition: all 0.18s;
}
.user-card:hover {
  border-color: var(--accent-color, #4f46e5);
}
.user-card-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 1rem;
  position: relative;
  margin-right: 10px;
}
.online-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6b7280; /* 默认灰 */
  border: 2px solid var(--panel-bg, #1a1c23);
}
.online-indicator.online {
  background: #22c55e;
}
.user-card-info {
  display: flex;
  flex-direction: column;
  min-width: 100px;
}
.user-card-line1 {
  font-size: 0.9rem;
  color: var(--text-primary);
}
.user-card-name {
  font-weight: 600;
  margin-right: 6px;
}
.user-card-role {
  color: var(--text-secondary);
  font-size: 0.8rem;
}
.user-card-line2 {
  font-size: 0.75rem;
  color: var(--text-tertiary, #6b6e7c);
  margin-top: 2px;
}
.user-card-arrow {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.7rem;
  margin-left: 8px;
  cursor: pointer;
}
.user-menu {
  position: absolute;
  bottom: 60px;
  left: 0;
  min-width: 200px;
  background: var(--panel-bg, #1a1c23);
  border: 1px solid var(--border-color, #2a2d38);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  padding: 4px;
}
.user-menu-item {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.9rem;
  color: var(--text-primary);
}
.user-menu-item:hover {
  background: var(--panel-hover, #252833);
}
.user-menu-item.danger {
  color: #ef4444;
}
.user-menu-separator {
  height: 1px;
  background: var(--border-color, #2a2d38);
  margin: 4px 0;
}
```

- [ ] **Step 4: 增 JS 渲染和交互**

在 `user.js` 的 `_enterMainView()` 中追加：

```javascript
    _renderUserCard() {
        const u = this.currentUser;
        if (!u) return;
        const card = document.getElementById('user-card');
        card.style.display = 'flex';
        const avatar = document.getElementById('user-card-avatar');
        avatar.style.background = `linear-gradient(135deg, ${u.avatarColor}, ${this._darken(u.avatarColor)})`;
        document.getElementById('user-card-initial').textContent = this._getInitial(u.displayName);
        document.getElementById('user-card-name').textContent = u.displayName;
        document.getElementById('user-card-role').textContent = u.role || '';
        const meta = (u.unit || '') + (u.department ? ' · ' + u.department : '');
        document.getElementById('user-card-meta').textContent = meta;
        // 在线指示灯
        const online = document.getElementById('user-card-online');
        if (u.lastActiveAt) {
            const mins = (Date.now() - new Date(u.lastActiveAt).getTime()) / 60000;
            if (mins < 5) online.classList.add('online');
        }
    }
    
    _darken(hex) {
        // 简化的颜色加深（实际可写更好算法）
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgb(${Math.max(0, r-40)}, ${Math.max(0, g-40)}, ${Math.max(0, b-40)})`;
    }
    
    _initUserCardInteraction() {
        const card = document.getElementById('user-card');
        const menu = document.getElementById('user-menu');
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', () => { menu.style.display = 'none'; });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') menu.style.display = 'none';
        });
        menu.querySelectorAll('.user-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                menu.style.display = 'none';
                this._handleUserMenuAction(action);
            });
        });
    }
    
    _handleUserMenuAction(action) {
        if (action === 'profile') {
            this.openProfileModal();
        } else if (action === 'switch') {
            // 跳回账号选择页（保留 session）
            document.getElementById('user-card').style.display = 'none';
            this._showAccountSelector();
        } else if (action === 'groups') {
            alert('协作组管理功能开发中 (C 阶段实现)');
        } else if (action === 'logout') {
            if (confirm('确定要退出登录吗？')) {
                this.logout();
            }
        }
    }
```

并把 `_renderUserCard()` + `_initUserCardInteraction()` 调用加到 `_enterMainView()` 末尾。

- [ ] **Step 5: 手动验证**

1. 创建第一个账号后进入主界面
2. Expected: 左下角显示用户卡片（头像+用户名·角色+单位·部门+绿点+▼）
3. 点击卡片 → 4 项菜单弹出
4. 点击"协作组管理" → 弹"开发中"提示
5. 点击"退出登录" → 跳回账号选择页

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/css/components.css frontend/js/user.js
git commit -m "feat(user): user card with menu, replace contact-author"
```

---

## Task 15: 前端 - 个人设置模态框

**Files:**
- Modify: `frontend/index.html` — 增模态框
- Modify: `frontend/js/user.js` — 实现

- [ ] **Step 1: 增 DOM**

```html
<div id="profile-modal" class="modal" style="display: none;">
  <div class="modal-content">
    <div class="modal-header">
      <h2>个人设置</h2>
      <button class="modal-close" data-close="profile-modal">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>用户名</label>
        <input type="text" id="pr-display-name">
      </div>
      <div class="form-group">
        <label>单位</label>
        <input type="text" id="pr-unit">
      </div>
      <div class="form-group">
        <label>部门</label>
        <input type="text" id="pr-department">
      </div>
      <div class="form-group">
        <label>角色</label>
        <input type="text" id="pr-role">
      </div>
      <div class="form-group">
        <label>头像颜色</label>
        <div class="color-picker" id="pr-color-picker">
          <!-- 同 Task 13 的 8 个色块 -->
        </div>
      </div>
      <div class="form-error" id="pr-error" style="display:none;color:#ef4444;"></div>
      <div class="form-section-separator"></div>
      <div class="danger-zone">
        <button class="btn-danger" id="pr-delete">删除此账号</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" data-close="profile-modal">取消</button>
      <button class="btn-primary" id="pr-save">保存</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: 实现 JS**

在 `user.js` 追加：

```javascript
    openProfileModal() {
        const u = this.currentUser;
        document.getElementById('pr-display-name').value = u.displayName;
        document.getElementById('pr-unit').value = u.unit || '';
        document.getElementById('pr-department').value = u.department || '';
        document.getElementById('pr-role').value = u.role || '';
        // 颜色
        document.querySelectorAll('#pr-color-picker .color-dot').forEach(dot => {
            dot.classList.toggle('selected', dot.dataset.color === u.avatarColor);
        });
        document.getElementById('profile-modal').style.display = 'flex';
    }
    
    initProfileModal() {
        // 复制 Task 13 的 8 个色块到 #pr-color-picker
        const prPicker = document.getElementById('pr-color-picker');
        const colors = ['#4f46e5', '#7c3aed', '#ec4899', '#ef4444',
                        '#f59e0b', '#22c55e', '#06b6d4', '#6b7280'];
        prPicker.innerHTML = colors.map(c =>
            `<div class="color-dot" data-color="${c}" style="background:${c}"></div>`
        ).join('');
        prPicker.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                prPicker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
                dot.classList.add('selected');
            });
        });
        // 关闭
        document.querySelectorAll('[data-close="profile-modal"]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('profile-modal').style.display = 'none';
            });
        });
        // 保存
        document.getElementById('pr-save').addEventListener('click', () => this.saveProfile());
        // 删除
        document.getElementById('pr-delete').addEventListener('click', () => this.deleteCurrentAccount());
    }
    
    async saveProfile() {
        const u = this.currentUser;
        const colorEl = document.querySelector('#pr-color-picker .color-dot.selected');
        const r = await window.userApi.update(u.id, {
            displayName: document.getElementById('pr-display-name').value.trim(),
            unit: document.getElementById('pr-unit').value.trim() || null,
            department: document.getElementById('pr-department').value.trim() || null,
            role: document.getElementById('pr-role').value.trim() || null,
            avatarColor: colorEl ? colorEl.dataset.color : u.avatarColor
        });
        if (r.success) {
            this.currentUser = r.user;
            this._renderUserCard();
            document.getElementById('profile-modal').style.display = 'none';
        } else {
            document.getElementById('pr-error').textContent = r.error || '保存失败';
            document.getElementById('pr-error').style.display = 'block';
        }
    }
    
    async deleteCurrentAccount() {
        const u = this.currentUser;
        if (!confirm(`确定要删除账号"${u.displayName}"吗？此操作不可撤销（关联任务的责任人将置空）。`)) return;
        const r = await window.userApi.delete(u.id);
        if (r.success) {
            document.getElementById('profile-modal').style.display = 'none';
            await this.logout();
        } else {
            alert(r.error || '删除失败');
        }
    }
```

并在 `init()` 调用 `this.initProfileModal()`。

- [ ] **Step 3: 手动验证**

1. 进入主界面 → 点击用户卡片 → 个人设置
2. 修改用户名/单位/部门/角色/颜色
3. 保存 → 卡片实时更新
4. 删除账号（二次确认）→ 跳回账号选择页

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/js/user.js
git commit -m "feat(user): profile settings modal"
```

---

## Task 16: 前端 - 任务表单协作扩展字段

**Files:**
- Modify: `frontend/index.html`（或任务表单所在位置） — 增"协作与责任"分组
- Modify: `frontend/js/todo.js` — 提交时带协作字段

- [ ] **Step 1: 找到任务表单**

```bash
grep -n "task-modal\|添加任务\|新建任务" frontend/index.html
```

定位任务创建/编辑模态框。

- [ ] **Step 2: 在任务表单"更多选项"内增"协作与责任"分组**

```html
<details class="form-advanced">
  <summary>协作与责任</summary>
  <div class="form-group">
    <label>主责部门</label>
    <input type="text" id="task-owning-dept">
  </div>
  <div class="form-group">
    <label>协办部门（逗号分隔）</label>
    <input type="text" id="task-cooperating-depts" placeholder="如：测试部, 产品部">
  </div>
  <div class="form-group">
    <label>责任人</label>
    <select id="task-owner-user">
      <option value="">未指定</option>
    </select>
  </div>
  <div class="form-group">
    <label>协办人（多选）</label>
    <select id="task-cooperator-users" multiple size="4">
    </select>
  </div>
  <div class="form-group">
    <label>
      <input type="checkbox" id="task-audit-enabled" checked>
      启用审计日志
    </label>
  </div>
</details>
```

- [ ] **Step 3: 在 `todo.js` 打开任务表单时填充用户下拉**

找到打开任务表单的函数（如 `openTaskModal`），**在打开时**：

```javascript
async function _populateUserDropdowns() {
    const r = await window.userApi.list();
    if (!r.success) return;
    const ownerSelect = document.getElementById('task-owner-user');
    const coopSelect = document.getElementById('task-cooperator-users');
    if (!ownerSelect || !coopSelect) return;
    // 保留第一个 "未指定" 选项
    ownerSelect.innerHTML = '<option value="">未指定</option>' +
        r.users.map(u => `<option value="${u.id}">${u.displayName}${u.department ? ' · ' + u.department : ''}</option>`).join('');
    coopSelect.innerHTML = r.users.map(u =>
        `<option value="${u.id}">${u.displayName}</option>`
    ).join('');
}
```

并在 `openTaskModal` 开头调用 `_populateUserDropdowns()`。

- [ ] **Step 4: 在 `submitTask` 时携带协作字段**

找到任务提交函数，**在构造提交数据时**增字段：

```javascript
const taskData = {
    title: ...,
    // 现有字段
    owningDeptId: document.getElementById('task-owning-dept').value.trim() || null,
    cooperatingDeptIds: (document.getElementById('task-cooperating-depts').value || '')
        .split(',').map(s => s.trim()).filter(Boolean),
    ownerUserId: document.getElementById('task-owner-user').value || null,
    cooperatorUserIds: Array.from(
        document.getElementById('task-cooperator-users').selectedOptions
    ).map(o => o.value),
    auditEnabled: document.getElementById('task-audit-enabled').checked,
    currentUserId: window.userManager.currentUser.id
};
```

- [ ] **Step 5: 手动验证**

1. 创建任务，展开"协作与责任"
2. 填主责部门/协办部门/责任人/协办人/审计开关
3. 提交 → 任务卡片显示协作信息

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/js/todo.js
git commit -m "feat(user): task form collaboration fields"
```

---

## Task 17: 前端 - 任务详情显示协作 + 审计日志标签页

**Files:**
- Modify: `frontend/js/todo.js` — 任务详情 + 审计加载
- Modify: `frontend/index.html` — 详情模态框增"审计日志"标签页

- [ ] **Step 1: 任务详情显示协作信息**

找到任务详情渲染函数，在"分类"下方增：

```html
<div class="task-detail-collab">
  <div class="collab-row">
    <span class="collab-label">主责：</span>
    <span class="collab-value">${task.owningDeptId || '-'}</span>
    <span class="collab-sep">|</span>
    <span class="collab-label">责任人：</span>
    <span class="collab-value" id="task-owner-name">${task.ownerUserName || '未指定'}</span>
  </div>
  ${task.cooperatingDeptIds && task.cooperatingDeptIds.length ? `
  <div class="collab-row">
    <span class="collab-label">协办：</span>
    <span class="collab-value">${task.cooperatingDeptIds.join(', ')}</span>
    ${task.cooperatorUserNames && task.cooperatorUserNames.length ? `
      <span class="collab-sep">|</span>
      <span class="collab-label">协办人：</span>
      <span class="collab-value">${task.cooperatorUserNames.join(', ')}</span>
    ` : ''}
  </div>
  ` : ''}
</div>
```

注：后端 `get_todo` 需要把 `owner_user_id` 解析为 `ownerUserName`（join users 表）。在 `operations.py` 的 `get_todo` 内做 LEFT JOIN 处理（或在 API 层做）。

- [ ] **Step 2: 增"审计日志"标签页 DOM**

```html
<div class="tab-content" id="task-tab-audit" style="display:none;">
  <table class="audit-table">
    <thead>
      <tr>
        <th>时间</th>
        <th>操作人</th>
        <th>动作</th>
        <th>字段变更</th>
      </tr>
    </thead>
    <tbody id="audit-table-body">
      <!-- JS 填充 -->
    </tbody>
  </table>
</div>
```

- [ ] **Step 3: 加载并渲染审计**

在任务详情模态框打开时（如 `showTaskDetail`），**加载审计并渲染**：

```javascript
async function _loadAuditLog(taskId) {
    const r = await window.userApi.getTaskAuditLog(taskId);
    if (!r.success) return;
    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = r.logs.map(log => `
        <tr>
            <td>${new Date(log.createdAt).toLocaleString()}</td>
            <td>${log.userName || '已删除用户'}</td>
            <td>${log.action}</td>
            <td>${log.field ? `${log.field}: "${log.oldValue || ''}" → "${log.newValue || ''}"` : '-'}</td>
        </tr>
    `).join('');
}
```

注：API 需返回 `userName` 字段（join users 表查询）。修改 `task_get_audit_log` API：

```python
def task_get_audit_log(task_id: str) -> dict:
    db = _get_user_manager().db
    with db.get_connection() as conn:
        cur = conn.cursor()
        cur.execute('''
            SELECT a.*, u.display_name as user_name
            FROM task_audit_log a
            LEFT JOIN users u ON a.user_id = u.id AND u.is_deleted = 0
            WHERE a.task_id = ?
            ORDER BY a.created_at DESC
        ''', (task_id,))
        rows = cur.fetchall()
    return {
        'success': True,
        'logs': [
            {
                'id': r['id'], 'taskId': r['task_id'],
                'userId': r['user_id'],
                'userName': r['user_name'] or '已删除用户',
                'action': r['action'], 'field': r['field'],
                'oldValue': r['old_value'], 'newValue': r['new_value'],
                'createdAt': r['created_at']
            }
            for r in rows
        ]
    }
```

- [ ] **Step 4: 手动验证**

1. 创建任务 → 修改几次 → 打开详情
2. 切换到"审计日志"标签页
3. Expected: 看到 create + 多次 update 记录，操作人头像+名

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/js/todo.js backend/api/todo_api.py
git commit -m "feat(user): task detail with collab info and audit log tab"
```

---

## Task 18: 端到端集成测试

**Files:**
- Create: `backend/tests/test_e2e_user.py`

- [ ] **Step 1: 写端到端测试**

```python
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _setup():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase
    return TodoDatabase(), tmp.name


def test_e2e_full_user_lifecycle():
    """完整用户生命周期：创建 → 登录 → 任务协作 → 审计 → 删除"""
    db, path = _setup()
    try:
        from backend.api.todo_api import (
            auth_create_user, auth_switch_user, auth_get_current_user,
            auth_update_user, auth_logout, auth_delete_user, auth_list_local_users,
            user_search, task_get_audit_log
        )
        from backend.database.operations import UserManager, _get_user_manager
        
        # 1. 创建第一个账号
        r = auth_create_user(display_name='用户A', unit='公司', department='研发部', role='工程师')
        assert r['success']
        user_a = r['user']
        token_a = r['token']
        
        # 2. 创建第二个账号（不同部门）
        r = auth_create_user(display_name='用户B', unit='公司', department='产品部', role='PM')
        assert r['success']
        user_b = r['user']
        
        # 3. 切换到 A
        r = auth_switch_user(user_a['id'])
        assert r['success']
        assert auth_get_current_user()['user']['id'] == user_a['id']
        
        # 4. 创建任务（带协作字段）
        t = db.add_todo(title='A创建的任务', current_user_id=user_a['id'],
                        owner_user_id=user_a['id'],
                        cooperator_user_ids=[user_b['id']],
                        audit_enabled=True)
        assert t.id is not None
        
        # 5. 验证审计日志
        logs = db.get_task_audit_log(t.id)
        assert len(logs) == 1
        assert logs[0].action == 'create'
        assert logs[0].user_id == user_a['id']
        
        # 6. 更新任务 → 应写字段级审计
        db.update_todo(t.id, {'title': 'A修改的标题'}, current_user_id=user_a['id'])
        logs = db.get_task_audit_log(t.id)
        update_log = next(l for l in logs if l.action == 'update')
        assert update_log.field == 'title'
        assert update_log.old_value == 'A创建的任务'
        assert update_log.new_value == 'A修改的标题'
        
        # 7. 切换到 B
        r = auth_switch_user(user_b['id'])
        assert r['success']
        # 切换后 B 看到 A 创建的任务（按 owner_user_id）
        all_tasks = db.list_todos()
        assert any(task.id == t.id for task in all_tasks)
        
        # 8. 用户搜索
        r = user_search('用户')
        assert r['success']
        assert len(r['users']) == 2
        
        # 9. 退出登录
        r = auth_logout()
        assert r['success']
        assert auth_get_current_user()['user'] is None
        
        # 10. 切换回 A
        r = auth_switch_user(user_a['id'])
        assert r['success']
        
        # 11. 列表（应只看到 A 和 B）
        r = auth_list_local_users()
        ids = [u['id'] for u in r['users']]
        assert user_a['id'] in ids
        assert user_b['id'] in ids
        
        # 12. 删除 A
        r = auth_delete_user(user_a['id'])
        assert r['success']
        # A 的任务 owner_user_id 应置 NULL
        t_after = db.get_todo(t.id)
        assert t_after.owner_user_id is None
        
        # 13. 不能再切换 A
        r = auth_switch_user(user_a['id'])
        assert not r['success']
    finally:
        Path(path).unlink()
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest backend/tests/test_e2e_user.py -v
```

Expected: PASS。

- [ ] **Step 3: 运行所有 A 阶段测试**

```bash
python -m pytest backend/tests/ -v
```

Expected: 全部 PASS（除 C 还没实现的）。

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_e2e_user.py
git commit -m "test(user): end-to-end user lifecycle integration test"
```

---

## Task 19: 手动 UI 验证（10 项清单）

- [ ] **Step 1: 删除数据库全新启动**

```bash
# 备份后删除
cp data/todo.db data/todo.db.backup
rm data/todo.db
python main.py
```

- [ ] **Step 2: 验证清单**

逐项执行并打勾（参照 spec 第 8.4 节）：

- [ ] 首次启动空状态 → 创建第一个账号 → 进入主界面
- [ ] 重启应用 → 自动恢复登录（session 持久化）
- [ ] 创建第二个同名账号（不同单位）→ 成功
- [ ] 创建同名同单位同部门 → 失败（三元组校验）
- [ ] 用户菜单 4 项可点
- [ ] 个人设置改字段 → 卡片实时更新
- [ ] 切换账号 → 跳回选择页 → 选另一个 → 卡片更新
- [ ] 退出登录 → session 清空 → 重启后停在选择页
- [ ] 创建任务填协作字段 → 显示在卡片 → 审计日志有记录
- [ ] 5 分钟不活动 → 绿点变灰（验证 last_active_at）

- [ ] **Step 3: 数据完整性检查**

```bash
# 确认现有数据未损坏
python -c "
import sqlite3
conn = sqlite3.connect('data/todo.db')
print('Categories:', conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0])
print('Tasks:', conn.execute('SELECT COUNT(*) FROM tasks').fetchone()[0])
print('Users:', conn.execute('SELECT COUNT(*) FROM users WHERE is_deleted=0').fetchone()[0])
print('Audit logs:', conn.execute('SELECT COUNT(*) FROM task_audit_log').fetchone()[0])
"
```

Expected: 现有 categories / tasks 数 ≥ 0（保留旧数据），users ≥ 创建数，audit_logs ≥ 任务变更数。

- [ ] **Step 4: 提交（无新增代码，仅文档）**

如全部通过，不需要 commit。如有问题，新建 issue 文档并 commit。

---

## 验收（A 子系统实施完成标准）

1. 全新用户下载应用，第一次启动看到"账号选择页"空状态，能创建第一个账号
2. 同一台电脑可创建多个账号（用户名+单位+部门三元组互不冲突）
3. 关闭重开应用，自动恢复上次登录账号
4. 左下角"联系作者"按钮已被替换为用户卡片
5. 点击用户卡片展开 4 项菜单
6. 任务创建/编辑表单可填主责部门、协办部门、责任人、协办人、是否启用审计
7. 任务详情可见"协作与责任"信息
8. 任务详情"审计日志"标签页可看到所有变更记录
9. 单元测试、集成测试全部通过
10. 现有任务、分类、设置、标签数据完整无损

---

## 已知限制

- 1.0 心跳精度：UI 5 分钟超时依据 `last_active_at`，实际判定由前端 JS 完成（绿点/灰点）
- 1.1 三元组冲突：用户 B 在自己电脑可有同名账号，但同步进协作组时会冲突（C 阶段处理）
- 1.2 软删除：删除账号不级联审计日志（保留历史）

---

**计划完成。保存到 `docs/superpowers/plans/2026-06-19-user-system-plan.md`。**

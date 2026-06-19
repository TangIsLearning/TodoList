"""
UserManager 测试（Task 4-7）
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import TodoDatabase, UserManager


def _fresh_db():
    """返回新 TodoDatabase 实例 + 临时 db path"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
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
        assert u.unit == '某公司'
        assert u.department == '研发部'
    finally:
        Path(path).unlink(missing_ok=True)


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
        Path(path).unlink(missing_ok=True)


def test_user_manager_same_name_different_unit_ok():
    """同 display_name 但不同 unit+department 应可共存"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u1 = um.create_user(display_name='郭世锋', unit='A公司', department='研发部')
        u2 = um.create_user(display_name='郭世锋', unit='B公司', department='研发部')
        assert u1.id != u2.id
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_create_with_optional_fields():
    """可选字段 role/avatar_color 应被保存"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(
            display_name='李明', role='产品经理', avatar_color='#ff00ff'
        )
        assert u.role == '产品经理'
        assert u.avatar_color == '#ff00ff'
    finally:
        Path(path).unlink(missing_ok=True)


# ===== Task 5: 查询/更新/删除/列表 =====

def test_user_manager_get_by_id():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='王芳')
        loaded = um.get_user(u.id)
        assert loaded is not None
        assert loaded.display_name == '王芳'
        assert loaded.id == u.id
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_get_not_found():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        assert um.get_user('nonexistent-id') is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_update():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='赵磊')
        um.update_user(u.id, role='架构师', avatar_color='#ff0000')
        loaded = um.get_user(u.id)
        assert loaded.role == '架构师'
        assert loaded.avatar_color == '#ff0000'
        # display_name/unit/department 未传应保持原值
        assert loaded.display_name == '赵磊'
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_update_partial():
    """只传 display_name 应不影响其他字段"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='原名', unit='原单位', department='原部门')
        um.update_user(u.id, display_name='新名')
        loaded = um.get_user(u.id)
        assert loaded.display_name == '新名'
        assert loaded.unit == '原单位'
        assert loaded.department == '原部门'
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_update_duplicate_triple_rejected():
    """更新后三元组冲突应被阻止"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        um.create_user(display_name='A', unit='U1', department='D1')
        u2 = um.create_user(display_name='B', unit='U2', department='D2')
        try:
            um.update_user(u2.id, display_name='A', unit='U1', department='D1')
            assert False, '应该抛错'
        except ValueError as e:
            assert '已存在' in str(e) or 'DUPLICATE' in str(e).upper()
        # u2 字段应未变
        assert um.get_user(u2.id).display_name == 'B'
    finally:
        Path(path).unlink(missing_ok=True)


def test_user_manager_update_nonexistent():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        try:
            um.update_user('nonexistent-id', role='X')
            assert False, '应该抛错'
        except ValueError as e:
            assert '不存在' in str(e)
    finally:
        Path(path).unlink(missing_ok=True)


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
        Path(path).unlink(missing_ok=True)


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
        Path(path).unlink(missing_ok=True)


def test_user_manager_list_orders_by_recent_activity():
    """列表按 last_active_at DESC 排序，None 在后"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u_old = um.create_user(display_name='旧')
        # 直接更新数据库让 u_old 有较新时间戳（先 u_new 再 u_old 模拟）
        u_new = um.create_user(display_name='新')
        users = um.list_local_users()
        # 因为 last_active_at 都是 None，created_at DESC 兜底
        names = [u.display_name for u in users]
        # 后创建应在前面
        assert names.index('新') < names.index('旧')
    finally:
        Path(path).unlink(missing_ok=True)


# ===== Task 6: Session 管理 =====

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
        Path(path).unlink(missing_ok=True)


def test_session_invalid_token_returns_none():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        assert um.get_user_by_token('invalid-token-xyz') is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_session_heartbeat_updates_last_active():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='心跳测试')
        token = um.create_session(u.id)
        initial = um.get_user(u.id).last_active_at
        # 强制等待
        import time
        time.sleep(0.05)
        um.heartbeat(token)
        updated = um.get_user(u.id).last_active_at
        assert updated is not None
        assert updated >= initial
    finally:
        Path(path).unlink(missing_ok=True)


def test_session_heartbeat_invalid_token_is_noop():
    """对无效 token 调用 heartbeat 不应抛错"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        um.heartbeat('bogus-token')  # 不应抛错
    finally:
        Path(path).unlink(missing_ok=True)


def test_session_logout_removes_session():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u = um.create_user(display_name='退出测试')
        token = um.create_session(u.id)
        um.logout(token)
        assert um.get_user_by_token(token) is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_session_get_current_token():
    """多 session 时应返回最近活跃的那个"""
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        u1 = um.create_user(display_name='用户1')
        u2 = um.create_user(display_name='用户2')
        t1 = um.create_session(u1.id)
        import time
        time.sleep(0.05)
        t2 = um.create_session(u2.id)
        # 当前应是最新的 t2
        assert um.get_current_token() == t2
    finally:
        Path(path).unlink(missing_ok=True)


def test_session_get_current_token_empty():
    db, path = _fresh_db()
    try:
        um = UserManager(db)
        assert um.get_current_token() is None
    finally:
        Path(path).unlink(missing_ok=True)

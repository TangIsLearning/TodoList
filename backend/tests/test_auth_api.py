"""
auth API 集成测试（Task 8-10）
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    """创建一个 TodoApi 实例，注入测试用 db"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)

    from backend.database.operations import TodoDatabase, UserManager
    db = TodoDatabase()
    um = UserManager(db)

    # 绕过 TodoApi 真实 __init__，手动构造最小实例
    from backend.api import todo_api
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


def test_api_auth_get_current_user_none():
    api, path = _make_api()
    try:
        r = api.auth_get_current_user()
        assert r['success'] is True
        assert r['user'] is None
        assert r['token'] is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_create_user():
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='API测试', unit='某公司', department='研发部')
        assert r['success'] is True
        assert r['user']['displayName'] == 'API测试'
        assert r['user']['unit'] == '某公司'
        assert r['token'] is not None
        # 三元组重复
        r2 = api.auth_create_user(display_name='API测试', unit='某公司', department='研发部')
        assert r2['success'] is False
        assert '已存在' in r2['error']
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_switch_user():
    api, path = _make_api()
    try:
        r1 = api.auth_create_user(display_name='用户1')
        r2 = api.auth_create_user(display_name='用户2')
        # 切换到 r1
        result = api.auth_switch_user(r1['user']['id'])
        assert result['success'] is True
        current = api.auth_get_current_user()
        assert current['user']['id'] == r1['user']['id']
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_update_user():
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='原名')
        result = api.auth_update_user(
            r['user']['id'], role='新角色', avatar_color='#00ff00'
        )
        assert result['success'] is True
        assert result['user']['role'] == '新角色'
        assert result['user']['avatarColor'] == '#00ff00'
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_update_duplicate_rejected():
    api, path = _make_api()
    try:
        r1 = api.auth_create_user(display_name='A', unit='U1', department='D1')
        r2 = api.auth_create_user(display_name='B', unit='U2', department='D2')
        # 试图把 r2 改为与 r1 冲突
        result = api.auth_update_user(
            r2['user']['id'], display_name='A', unit='U1', department='D1'
        )
        assert result['success'] is False
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_logout():
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='登出测试')
        result = api.auth_logout()
        assert result['success'] is True
        current = api.auth_get_current_user()
        assert current['user'] is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_delete_user():
    api, path = _make_api()
    try:
        r1 = api.auth_create_user(display_name='A')
        r2 = api.auth_create_user(display_name='B')
        result = api.auth_delete_user(r1['user']['id'])
        assert result['success'] is True
        # 列表只剩 B
        listed = api.auth_list_local_users()
        ids = [u['id'] for u in listed['users']]
        assert r2['user']['id'] in ids
        assert r1['user']['id'] not in ids
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_delete_last_user_rejected():
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='唯一')
        result = api.auth_delete_user(r['user']['id'])
        assert result['success'] is False
        assert '至少保留' in result['error']
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_heartbeat():
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='心跳')
        result = api.auth_heartbeat()
        assert result['success'] is True
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_auth_list_local_users():
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='A')
        api.auth_create_user(display_name='B')
        result = api.auth_list_local_users()
        assert result['success'] is True
        names = [u['displayName'] for u in result['users']]
        assert 'A' in names and 'B' in names
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_user_search():
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='郭世锋', unit='研发部')
        api.auth_create_user(display_name='郭艾伦', unit='体育部')
        result = api.user_search('郭')
        assert result['success'] is True
        assert len(result['users']) == 2
        # 搜不到的关键词
        result2 = api.user_search('不存在')
        assert len(result2['users']) == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_task_get_audit_log():
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='任务审计')
        uid = r['user']['id']
        api.db.set_current_user(uid)
        t = api.db.add_task({'title': '审计任务', 'currentUserId': uid})
        result = api.task_get_audit_log(t['id'])
        assert result['success'] is True
        assert len(result['logs']) == 1
        assert result['logs'][0]['action'] == 'create'
        assert result['logs'][0]['userName'] == '任务审计'
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_task_get_audit_log_deleted_user_placeholder():
    """用户被软删除后审计日志应显示"已删除用户"占位"""
    api, path = _make_api()
    try:
        r1 = api.auth_create_user(display_name='将被删')
        uid = r1['user']['id']
        api.db.set_current_user(uid)
        t = api.db.add_task({'title': '任务', 'currentUserId': uid})
        # 软删除该用户（但要先创建另一个用户避免被拒绝）
        api.auth_create_user(display_name='保留账号')
        api.auth_delete_user(uid)
        # 查询审计日志
        result = api.task_get_audit_log(t['id'])
        assert result['success'] is True
        assert any(
            log['userName'] == '已删除用户' for log in result['logs']
        )
    finally:
        Path(path).unlink(missing_ok=True)

"""
Category API 集成测试（Task B13）
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    """构造 TodoApi + 注入临时 db"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)

    from backend.database.operations import TodoDatabase, UserManager, CategoryManager
    db = TodoDatabase()
    um = UserManager(db)
    cm = CategoryManager(db)

    from backend.api import todo_api
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.category_manager = cm
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


def _login(api, name='测试用户'):
    r = api.auth_create_user(display_name=name)
    assert r['success']
    return r['user']


def test_api_category_list_requires_login():
    api, path = _make_api()
    try:
        r = api.category_list()
        assert r['success'] is False
        assert r['error'] == 'NOT_LOGGED_IN'
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_crud_flow():
    api, path = _make_api()
    try:
        u = _login(api)

        # list 初始为空
        r = api.category_list()
        assert r['success']
        assert r['categories'] == []

        # create
        r = api.category_create(name='研发', parent_id=None, icon='⚡', color='#4f46e5')
        assert r['success']
        cid = r['category']['id']
        assert r['category']['depth'] == 0
        assert r['category']['icon'] == '⚡'

        # 重名应失败
        r2 = api.category_create(name='研发')
        assert r2['success'] is False
        assert 'DUPLICATE' in r2['error'] or '已存在' in r2['error']

        # create child
        r = api.category_create(name='后端', parent_id=cid)
        assert r['success']
        sub_id = r['category']['id']
        assert r['category']['depth'] == 1

        # update
        r = api.category_update(cid, name='研发2', icon='🔧', color='#ef4444')
        assert r['success']
        assert r['category']['name'] == '研发2'

        # move to root
        r = api.category_move(sub_id, None)
        assert r['success']
        assert r['category']['parentId'] is None
        assert r['category']['depth'] == 0

        # list
        r = api.category_list()
        assert r['success']
        assert len(r['categories']) == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_depth_exceeded():
    api, path = _make_api()
    try:
        _login(api)
        r1 = api.category_create(name='A')
        r2 = api.category_create(name='B', parent_id=r1['category']['id'])
        r3 = api.category_create(name='C', parent_id=r2['category']['id'])
        r4 = api.category_create(name='D', parent_id=r3['category']['id'])
        assert r4['success'] is False
        assert 'DEPTH_EXCEEDED' in r4['error'] or 'depth' in r4['error'].lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_move_cycle_rejected():
    api, path = _make_api()
    try:
        _login(api)
        r1 = api.category_create(name='A')
        r2 = api.category_create(name='B', parent_id=r1['category']['id'])
        # 把 A 移到 B 下 → 形成环
        r3 = api.category_move(r1['category']['id'], r2['category']['id'])
        assert r3['success'] is False
        assert 'WOULD_CREATE_CYCLE' in r3['error'] or '环' in r3['error'] or 'cycle' in r3['error'].lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_delete_with_children_rejected():
    api, path = _make_api()
    try:
        _login(api)
        r1 = api.category_create(name='A')
        api.category_create(name='B', parent_id=r1['category']['id'])
        r = api.category_delete(r1['category']['id'])
        assert r['success'] is False
        assert 'HAS_CHILDREN' in r['error'] or '子' in r['error']
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_path_and_descendants():
    api, path = _make_api()
    try:
        _login(api)
        r1 = api.category_create(name='研发')
        r2 = api.category_create(name='后端', parent_id=r1['category']['id'])
        r3 = api.category_create(name='性能', parent_id=r2['category']['id'])

        rp = api.category_get_path(r3['category']['id'])
        assert rp['success']
        assert '研发' in rp['path'] and '后端' in rp['path'] and '性能' in rp['path']

        rd = api.category_get_descendants(r1['category']['id'])
        assert rd['success']
        assert set(rd['ids']) == {r1['category']['id'], r2['category']['id'], r3['category']['id']}
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_task_integration():
    """分类 + 任务集成：创建任务时带 categoryIds，category_list 应统计 taskCount"""
    api, path = _make_api()
    try:
        _login(api)
        r = api.category_create(name='研发')
        cid = r['category']['id']

        # 创建一个带分类的任务
        add = api.add_todo({'title': '性能优化', 'categoryIds': [cid], 'priority': 'none'})
        assert add['success']

        # list 应包含 taskCount = 1
        rl = api.category_list()
        assert rl['success']
        cat = next(c for c in rl['categories'] if c['id'] == cid)
        assert cat['taskCount'] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_delete_clears_task_references():
    """删除分类应自动从任务的 category_ids 中移除"""
    api, path = _make_api()
    try:
        _login(api)
        r = api.category_create(name='研发')
        cid = r['category']['id']
        api.add_todo({'title': 'T', 'categoryIds': [cid]})
        rd = api.category_delete(cid)
        assert rd['success']
        assert rd['affectedTaskCount'] >= 1

        # list 应无该分类
        rl = api.category_list()
        assert all(c['id'] != cid for c in rl['categories'])
    finally:
        Path(path).unlink(missing_ok=True)


def test_api_category_per_user_isolation():
    """不同用户看到各自的分类树"""
    api, path = _make_api()
    try:
        u1 = _login(api, name='用户1')
        api.category_create(name='用户1的分类')
        api.auth_logout()
        _login(api, name='用户2')
        api.category_create(name='用户2的分类')
        rl = api.category_list()
        assert rl['success']
        names = [c['name'] for c in rl['categories']]
        assert '用户2的分类' in names
        assert '用户1的分类' not in names
    finally:
        Path(path).unlink(missing_ok=True)

"""
CategoryManager 单元测试（Task B12）

覆盖：
- CRUD：create / get / update / delete
- 树操作：list / children / descendants / path
- 深度校验：DEPTH_EXCEEDED
- 重名校验：DUPLICATE_NAME
- 环检测：WOULD_CREATE_CYCLE
- 移动：move / sort_order 改变 / depth 同步
- 删除安全：HAS_CHILDREN
- 任务引用：add_category_to_task / set_task_categories
"""

import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import TodoDatabase, UserManager, CategoryManager


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    db = TodoDatabase()
    um = UserManager(db)
    u = um.create_user(display_name='测试用户')
    return db, um, u, tmp.name


def test_create_root_category():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        c = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        assert c['name'] == '研发'
        assert c['depth'] == 0
        assert c['parentId'] is None
        assert c['ownerId'] == u.id
    finally:
        Path(path).unlink(missing_ok=True)


def test_create_child_depth_2():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        root = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        sub = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=root['id'])
        assert sub['depth'] == 1
        leaf = cm.create_category(name='性能', owner_type='user', owner_id=u.id, parent_id=sub['id'])
        assert leaf['depth'] == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_create_depth_exceeded():
    """叶子下不能再创建子级 → DEPTH_EXCEEDED"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='A', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='B', owner_type='user', owner_id=u.id, parent_id=r['id'])
        c = cm.create_category(name='C', owner_type='user', owner_id=u.id, parent_id=b['id'])
        try:
            cm.create_category(name='D', owner_type='user', owner_id=u.id, parent_id=c['id'])
            assert False, '应该抛错'
        except ValueError as e:
            assert 'DEPTH_EXCEEDED' in str(e) or '已为叶子' in str(e) or 'depth' in str(e).lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_duplicate_name_rejected():
    """同父级下重名 → DUPLICATE_NAME"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        try:
            cm.create_category(name='研发', owner_type='user', owner_id=u.id)
            assert False, '应该抛错'
        except ValueError as e:
            assert 'DUPLICATE' in str(e) or '已存在' in str(e)
    finally:
        Path(path).unlink(missing_ok=True)


def test_duplicate_name_different_parent_ok():
    """不同父级下同名应可共存"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r1 = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        r2 = cm.create_category(name='产品', owner_type='user', owner_id=u.id)
        s1 = cm.create_category(name='子', owner_type='user', owner_id=u.id, parent_id=r1['id'])
        s2 = cm.create_category(name='子', owner_type='user', owner_id=u.id, parent_id=r2['id'])
        assert s1['id'] != s2['id']
    finally:
        Path(path).unlink(missing_ok=True)


def test_list_categories_filter_by_owner():
    """list_categories 应按 owner_type/owner_id 过滤"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        u2 = um.create_user(display_name='用户2')
        cm.create_category(name='A用户分类', owner_type='user', owner_id=u.id)
        cm.create_category(name='B用户分类', owner_type='user', owner_id=u2.id)
        a_list = cm.list_categories('user', u.id)
        b_list = cm.list_categories('user', u2.id)
        assert len(a_list) == 1
        assert len(b_list) == 1
        assert a_list[0]['name'] == 'A用户分类'
        assert b_list[0]['name'] == 'B用户分类'
    finally:
        Path(path).unlink(missing_ok=True)


def test_get_descendant_ids():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r['id'])
        c = cm.create_category(name='性能', owner_type='user', owner_id=u.id, parent_id=b['id'])
        desc = cm.get_descendant_ids(r['id'])
        assert r['id'] in desc
        assert b['id'] in desc
        assert c['id'] in desc
        assert len(desc) == 3
    finally:
        Path(path).unlink(missing_ok=True)


def test_get_category_path():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r['id'])
        c = cm.create_category(name='性能', owner_type='user', owner_id=u.id, parent_id=b['id'])
        path_str = cm.get_category_path(c['id'])
        assert '研发' in path_str
        assert '后端' in path_str
        assert '性能' in path_str
    finally:
        Path(path).unlink(missing_ok=True)


def test_update_category_name_icon_color():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id, icon='📁', color='#4f46e5')
        r2 = cm.update_category(r['id'], name='研发2', icon='⚡', color='#ef4444')
        assert r2['name'] == '研发2'
        assert r2['icon'] == '⚡'
        assert r2['color'] == '#ef4444'
    finally:
        Path(path).unlink(missing_ok=True)


def test_move_category_to_root():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        s = cm.create_category(name='子', owner_type='user', owner_id=u.id, parent_id=r['id'])
        # 把 s 移到顶级
        moved = cm.move_category(s['id'], None)
        assert moved['parentId'] is None
        assert moved['depth'] == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_move_category_with_descendants_depth_sync():
    """移动时所有后代的 depth 也应同步"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r1 = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r1['id'])
        c = cm.create_category(name='性能', owner_type='user', owner_id=u.id, parent_id=b['id'])
        # 新建一个 r2，把 r1 移到 r2 下 => 整子树 depth+1
        r2 = cm.create_category(name='产品', owner_type='user', owner_id=u.id)
        cm.move_category(r1['id'], r2['id'])
        # 验证
        b2 = cm.get_category(b['id'])
        c2 = cm.get_category(c['id'])
        assert b2['depth'] == 2  # 原 1 + 1
        assert c2['depth'] == 3  # 原 2 + 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_move_category_cycle_rejected():
    """不能把父移到子树下 → WOULD_CREATE_CYCLE"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r['id'])
        try:
            cm.move_category(r['id'], b['id'])
            assert False, '应该抛错'
        except ValueError as e:
            assert 'WOULD_CREATE_CYCLE' in str(e) or '环' in str(e) or 'cycle' in str(e).lower()
    finally:
        Path(path).unlink(missing_ok=True)


def test_delete_category_with_children_rejected():
    """有子级时不能删除 → HAS_CHILDREN"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r['id'])
        try:
            cm.delete_category(r['id'])
            assert False, '应该抛错'
        except ValueError as e:
            assert 'HAS_CHILDREN' in str(e) or '子' in str(e)
    finally:
        Path(path).unlink(missing_ok=True)


def test_delete_category_clears_task_references():
    """删除分类应清理任务的 category_ids 引用"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        # 创建任务并加入分类
        task = db.add_task({'title': 'T', 'categoryIds': [r['id']]})
        affected = cm.delete_category(r['id'])
        assert affected >= 1
        t2 = db.get_task(task['id'])
        import json
        ids = json.loads(t2.get('categoryIds') or '[]') if isinstance(t2.get('categoryIds'), str) else (t2.get('categoryIds') or [])
        assert r['id'] not in ids
    finally:
        Path(path).unlink(missing_ok=True)


def test_add_category_to_task():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        c1 = cm.create_category(name='A', owner_type='user', owner_id=u.id)
        c2 = cm.create_category(name='B', owner_type='user', owner_id=u.id)
        task = db.add_task({'title': 'T'})
        cm.add_category_to_task(task['id'], c1['id'])
        cm.add_category_to_task(task['id'], c2['id'])
        cm.add_category_to_task(task['id'], c1['id'])  # 重复添加应去重
        t = db.get_task(task['id'])
        import json
        ids = json.loads(t['categoryIds'] or '[]') if isinstance(t['categoryIds'], str) else (t['categoryIds'] or [])
        assert c1['id'] in ids
        assert c2['id'] in ids
        assert len(ids) == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_set_task_categories_overwrite():
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        c1 = cm.create_category(name='A', owner_type='user', owner_id=u.id)
        c2 = cm.create_category(name='B', owner_type='user', owner_id=u.id)
        c3 = cm.create_category(name='C', owner_type='user', owner_id=u.id)
        task = db.add_task({'title': 'T', 'categoryIds': [c1['id'], c2['id']]})
        cm.set_task_categories(task['id'], [c2['id'], c3['id']])
        t = db.get_task(task['id'])
        import json
        ids = json.loads(t['categoryIds'] or '[]') if isinstance(t['categoryIds'], str) else (t['categoryIds'] or [])
        assert c1['id'] not in ids
        assert c2['id'] in ids
        assert c3['id'] in ids
        assert len(ids) == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_get_task_count_includes_descendants():
    """get_task_count 应包含所有后代的任务数"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        r = cm.create_category(name='研发', owner_type='user', owner_id=u.id)
        b = cm.create_category(name='后端', owner_type='user', owner_id=u.id, parent_id=r['id'])
        c = cm.create_category(name='性能', owner_type='user', owner_id=u.id, parent_id=b['id'])
        # 任务分布在 b 和 c
        db.add_task({'title': 'T1', 'categoryIds': [b['id']]})
        db.add_task({'title': 'T2', 'categoryIds': [c['id']]})
        n = cm.get_task_count(r['id'])
        assert n == 2
        n_b = cm.get_task_count(b['id'])
        assert n_b == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_move_category_sort_order():
    """移动时显式传 sort_order 应被保留"""
    db, um, u, path = _fresh_db()
    try:
        cm = CategoryManager(db)
        c1 = cm.create_category(name='A', owner_type='user', owner_id=u.id, sort_order=0)
        c2 = cm.create_category(name='B', owner_type='user', owner_id=u.id, sort_order=10)
        c3 = cm.create_category(name='C', owner_type='user', owner_id=u.id, sort_order=20)
        # 把 c3 移到 c1 之前：sort_order = -5
        moved = cm.move_category(c3['id'], None, new_sort_order=-5)
        assert moved['sortOrder'] == -5
    finally:
        Path(path).unlink(missing_ok=True)

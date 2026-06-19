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
        # create_group 已自动将 created_by 加为 owner
        # 这里仅追加 u2 为 g1 的 member
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

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

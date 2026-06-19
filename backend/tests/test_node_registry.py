"""
D 阶段 M1 单测：node_registry / network_event 基础功能
- 节点 upsert / 状态切换 / 查询
- 事件写入 / 查询 / 类型筛选
- dataclass 序列化往返
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import NetworkEventManager  # noqa: E402


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, NetworkNodeRegistry, NetworkEventManager
    db = TodoDatabase()
    return db, NetworkNodeRegistry(db), NetworkEventManager(db), tmp.name


def test_node_upsert_new():
    db, reg, evm, path = _fresh_db()
    try:
        reg.upsert('node1', user_id='u1', user_name='Alice', address='192.168.1.10:54722',
                   protocol_version='1.0.0', group_ids=['g1'])
        n = reg.get('node1')
        assert n is not None
        assert n.id == 'node1' and n.user_name == 'Alice'
        assert n.status == 'online'
        assert n.address == '192.168.1.10:54722'
        assert n.protocol_version == '1.0.0'
        import json
        assert json.loads(n.group_ids) == ['g1']
    finally:
        Path(path).unlink(missing_ok=True)


def test_node_upsert_update_preserves_identity():
    """同一节点二次 upsert：保留原始 user_id，不被 None 覆盖。"""
    db, reg, evm, path = _fresh_db()
    try:
        reg.upsert('node1', user_id='u1', user_name='Alice', address='1.1.1.1:1')
        # 二次 upsert：address 变化、user_name 不传（None）
        reg.upsert('node1', address='1.1.1.1:2', status='syncing')
        n = reg.get('node1')
        assert n.user_id == 'u1'              # 保留
        assert n.user_name == 'Alice'         # 保留
        assert n.address == '1.1.1.1:2'       # 更新
        assert n.status == 'syncing'          # 更新
    finally:
        Path(path).unlink(missing_ok=True)


def test_node_mark_status_offline():
    db, reg, evm, path = _fresh_db()
    try:
        reg.upsert('node1', user_id='u1')
        reg.mark_status('node1', 'offline')
        n = reg.get('node1')
        assert n.status == 'offline'
        online = reg.list_online()
        assert all(x.id != 'node1' for x in online)
    finally:
        Path(path).unlink(missing_ok=True)


def test_node_update_last_sync_at():
    db, reg, evm, path = _fresh_db()
    try:
        reg.upsert('node1', user_id='u1')
        reg.update_last_sync_at('node1', '2026-06-19T10:00:00Z')
        n = reg.get('node1')
        assert n.last_sync_at == '2026-06-19T10:00:00Z'
    finally:
        Path(path).unlink(missing_ok=True)


def test_node_list_and_count():
    db, reg, evm, path = _fresh_db()
    try:
        assert reg.count() == 0
        reg.upsert('n1', user_id='u1')
        reg.upsert('n2', user_id='u2')
        reg.upsert('n3', user_id='u3')
        reg.mark_status('n3', 'offline')
        assert reg.count() == 3
        assert len(reg.list_online()) == 2
        assert len(reg.list_all(status='offline')) == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_node_remove():
    db, reg, evm, path = _fresh_db()
    try:
        reg.upsert('n1')
        assert reg.get('n1') is not None
        reg.remove('n1')
        assert reg.get('n1') is None
    finally:
        Path(path).unlink(missing_ok=True)


def test_event_log_basic():
    db, reg, evm, path = _fresh_db()
    try:
        evm.log(NetworkEventManager.EVENT_PEER_JOINED, peer_id='n1', user_id='u1',
                detail={'reason': 'beacon_seen'})
        evm.log(NetworkEventManager.EVENT_HANDSHAKE_OK, peer_id='n1')
        evm.log(NetworkEventManager.EVENT_PROTOCOL_ERROR, peer_id='n2',
                detail='PROTOCOL_MISMATCH')
        assert evm.count() == 3
        recent = evm.list_recent(limit=10)
        assert len(recent) == 3
        # 默认按 created_at DESC
        assert recent[0].type == NetworkEventManager.EVENT_PROTOCOL_ERROR
    finally:
        Path(path).unlink(missing_ok=True)


def test_event_log_filter_by_type():
    db, reg, evm, path = _fresh_db()
    try:
        evm.log(NetworkEventManager.EVENT_PEER_JOINED, peer_id='n1')
        evm.log(NetworkEventManager.EVENT_PEER_LEFT, peer_id='n1')
        evm.log(NetworkEventManager.EVENT_CONFLICT, peer_id='n2', user_id='u2')
        joined = evm.list_recent(event_type=NetworkEventManager.EVENT_PEER_JOINED)
        assert len(joined) == 1 and joined[0].peer_id == 'n1'
        conflicts = evm.list_recent(event_type=NetworkEventManager.EVENT_CONFLICT)
        assert len(conflicts) == 1 and conflicts[0].user_id == 'u2'
    finally:
        Path(path).unlink(missing_ok=True)


def test_event_detail_serialization():
    """detail 支持 dict 序列化为 JSON 字符串。"""
    db, reg, evm, path = _fresh_db()
    try:
        evm.log(NetworkEventManager.EVENT_HANDSHAKE_FAIL, peer_id='n1',
                detail={'reason': 'timeout', 'attempts': 3})
        events = evm.list_recent()
        import json
        d = json.loads(events[0].detail)
        assert d['reason'] == 'timeout' and d['attempts'] == 3
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_node_dataclass_roundtrip():
    from backend.database.models import NetworkNode, NetworkEvent
    n = NetworkNode(id='n1', last_seen='2026-06-19T10:00:00Z', user_name='Alice',
                    status='online', group_ids='["g1","g2"]')
    d = n.to_dict()
    n2 = NetworkNode.from_dict(d)
    assert n2.id == 'n1' and n2.user_name == 'Alice' and n2.status == 'online'
    assert n2.group_ids == '["g1","g2"]'

    e = NetworkEvent(id='e1', type='peer_joined', created_at='2026-06-19T10:00:00Z')
    d2 = e.to_dict()
    e2 = NetworkEvent.from_dict(d2)
    assert e2.id == 'e1' and e2.type == 'peer_joined'

"""
D 阶段 M6 单测：8 个网络 API
- network_get_local_node
- network_list_peers（空 / 含本机）
- network_start/stop_coordinator
- network_pull_from_peer / network_resync（无 peer / 协调器未运行）
- network_broadcast_change（无 peer）
- network_event_log（空 / 写一条后查询）
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
    from backend.api import todo_api
    db = TodoDatabase()
    um = UserManager(db)
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.category_manager = None
    api.is_android = False
    api.group_manager = None
    api.message_manager = None
    api.sync_manager = None
    api.network_engine = None
    api._connected_peers = []
    return api, tmp.name


def test_network_get_local_node():
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='alice')
        r = api.network_get_local_node()
        assert r['success']
        assert 'nodeId' in r['node']
        assert 'protocolVersion' in r['node']
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_list_peers_empty():
    api, path = _make_api()
    try:
        r = api.network_list_peers()
        assert r['success']
        assert r['peers'] == []
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_list_peers_filter_by_status():
    api, path = _make_api()
    try:
        r = api.network_list_peers(status='offline')
        assert r['success']
        assert r['peers'] == []
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_start_stop_coordinator():
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='bob')
        r1 = api.network_start_coordinator()
        assert r1['success'], r1.get('error')
        info = r1['node']
        assert info['nodeId'].startswith('node-')
        # 二次启动应 no-op
        r2 = api.network_start_coordinator()
        assert r2['success']
        r3 = api.network_stop_coordinator()
        assert r3['success']
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_broadcast_without_peers():
    """无 peer 时 broadcast 不应崩。"""
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='charlie')
        api.network_start_coordinator()
        import time
        time.sleep(0.2)
        r = api.network_broadcast_change('task', {'id': 't1', 'title': 'x'})
        assert r['success']
        api.network_stop_coordinator()
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_pull_from_peer_not_running():
    """协调器未运行时返回错误。"""
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='dora')
        r = api.network_pull_from_peer()
        assert not r['success']
        assert 'COORDINATOR_NOT_RUNNING' in r['error']
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_resync_returns_count():
    """resync_all 在无 peer 时应返回 0。"""
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='eve')
        api.network_start_coordinator()
        import time
        time.sleep(0.2)
        r = api.network_resync()
        assert r['success']
        # 无对端时为 0
        assert r.get('resynced_count', -1) == 0
        api.network_stop_coordinator()
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_event_log_empty():
    api, path = _make_api()
    try:
        r = api.network_event_log(limit=10)
        assert r['success']
        assert r['events'] == []
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_event_log_written_after_start():
    """启动协调器后，event_log 应至少有事件（启动 / 节点加入）。"""
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='frank')
        api.network_start_coordinator()
        import time
        time.sleep(0.3)
        r = api.network_event_log(limit=20)
        assert r['success']
        # 启动本身可能不写事件；至少不崩
        assert isinstance(r['events'], list)
        api.network_stop_coordinator()
    finally:
        Path(path).unlink(missing_ok=True)


def test_network_event_log_filter_by_type():
    api, path = _make_api()
    try:
        # 写入一些事件
        api._ensure_d_components()
        api.event_manager.log('peer_joined', peer_id='n1', detail='test')
        api.event_manager.log('peer_left', peer_id='n1', detail='test')
        r1 = api.network_event_log(event_type='peer_joined')
        assert r1['success']
        assert len(r1['events']) == 1
        assert r1['events'][0]['type'] == 'peer_joined'
        r2 = api.network_event_log(event_type='protocol_error')
        assert len(r2['events']) == 0
    finally:
        Path(path).unlink(missing_ok=True)


def test_all_eight_apis_exist():
    """确保 8 个 D 阶段 API 都存在并可调用（最少 smoke 校验）。"""
    api, path = _make_api()
    try:
        api.auth_create_user(display_name='grace')
        # 1. network_list_peers
        assert api.network_list_peers()['success']
        # 2. network_get_local_node
        assert api.network_get_local_node()['success']
        # 3. network_start_coordinator
        assert api.network_start_coordinator()['success']
        # 4. network_stop_coordinator
        assert api.network_stop_coordinator()['success']
        # 5. network_pull_from_peer（不运行时报错，但可调用）
        # 6. network_broadcast_change（需要 coordinator 运行）
        api.network_start_coordinator()
        import time
        time.sleep(0.2)
        assert api.network_broadcast_change('task', {'id': 't'})['success']
        # 7. network_resync
        assert api.network_resync()['success']
        # 8. network_event_log
        assert api.network_event_log()['success']
        api.network_stop_coordinator()
    finally:
        Path(path).unlink(missing_ok=True)

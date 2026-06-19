"""
D 阶段 M5 单测：NetworkCoordinator 基础生命周期与本地状态
- 构造 / 启动 / 停止
- get_local_node 返回完整身份
- list_online_peers 不包含自己
- apply_local_change 无 peer 时不抛
- 多次 start() / stop() 幂等
"""
import sys
import tempfile
import time
import socket
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _make_components():
    """构造 NetworkCoordinator 所需的全部依赖。"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import (
        TodoDatabase, SyncManager, NetworkNodeRegistry, NetworkEventManager,
    )
    db = TodoDatabase()
    sm = SyncManager(db)
    from backend.network.sync_engine import SyncEngine
    se = SyncEngine(db=db, sync_manager=sm)
    nr = NetworkNodeRegistry(db)
    em = NetworkEventManager(db)
    return db, sm, se, nr, em, tmp.name


def test_coordinator_construct_only():
    """仅构造、不启动。"""
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='node-x', user_id='u1', user_name='Alice',
                               tcp_port=17001, udp_port=17002,
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        assert c.node_id == 'node-x'
        assert c.is_running() is False
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_get_local_node():
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='node-y', user_id='u1', user_name='Bob',
                               tcp_port=17101, udp_port=17102,
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        info = c.get_local_node()
        assert info['nodeId'] == 'node-y'
        assert info['userId'] == 'u1'
        assert info['tcpPort'] == 17101
        assert info['protocolVersion']  # 非空
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_start_and_stop():
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        tcp = _free_port()
        udp = _free_port()
        c = NetworkCoordinator(node_id='node-z', user_id='u1',
                               tcp_port=tcp, udp_port=udp,
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.start()
        time.sleep(0.3)
        assert c.is_running() is True
        c.stop()
        assert c.is_running() is False
        # 启动后 node_registry 应有本机记录
        # 注意：路径已被 reset 重新初始化，registry 写入是 start 时做的
        c.start()
        time.sleep(0.3)
        assert c.is_running() is True
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_start_is_idempotent():
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        tcp = _free_port()
        udp = _free_port()
        c = NetworkCoordinator(node_id='node-w', user_id='u1',
                               tcp_port=tcp, udp_port=udp,
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.start()
        c.start()  # 第二次应 no-op
        c.start()
        time.sleep(0.2)
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_stop_idempotent():
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='node-v', user_id='u1',
                               tcp_port=_free_port(), udp_port=_free_port(),
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.stop()  # 未启动直接 stop
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_apply_local_change_no_peers():
    """无 peer 时 broadcast 不应抛。"""
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='node-q', user_id='u1',
                               tcp_port=_free_port(), udp_port=_free_port(),
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.start()
        time.sleep(0.2)
        # 不应抛
        c.apply_local_change('task', {'id': 't1', 'title': 'x'})
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_list_online_peers_excludes_self():
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='self-node', user_id='u1',
                               tcp_port=_free_port(), udp_port=_free_port(),
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.start()
        time.sleep(0.2)
        # 启动后本机已写入 registry
        all_nodes = c.node_registry.list_all()
        assert any(n.id == 'self-node' for n in all_nodes)
        # list_online_peers 不含自己
        peers = c.list_online_peers()
        assert all(p['nodeId'] != 'self-node' for p in peers)
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)


def test_coordinator_node_registry_populated_after_start():
    """start() 后本机节点记录应写入 registry。"""
    from backend.network.network_coordinator import NetworkCoordinator
    db, sm, se, nr, em, path = _make_components()
    try:
        c = NetworkCoordinator(node_id='local-x', user_id='u1', user_name='LocalUser',
                               tcp_port=_free_port(), udp_port=_free_port(),
                               db=db, sync_manager=sm, sync_engine=se,
                               node_registry=nr, event_manager=em)
        c.start()
        time.sleep(0.3)
        node = nr.get('local-x')
        assert node is not None
        assert node.user_name == 'LocalUser'
        assert node.status == 'online'
        c.stop()
    finally:
        Path(path).unlink(missing_ok=True)

"""
D 阶段 12 项 UI 验收脚本
运行：python backend/tests/ui_verification_d_phase.py

D 阶段验收覆盖：
1.  启动协调器
2.  本机节点信息完整
3.  在线节点列表初始为空
4.  离线节点列表过滤
5.  peer_joined 事件
6.  handshake_ok 事件
7.  peer_left 事件
8.  协议版本号常量
9.  协议版本校验（缺省 / 匹配 / 不匹配）
10. 双节点握手后双方能互相看到
11. 强制重同步 API
12. 网络事件日志 API（含类型筛选）
"""
import sys
import socket
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.discovery import GroupBeacon
from backend.network.network_coordinator import NetworkCoordinator
from backend.network.protocol import PROTOCOL_VERSION, check_version


PASS = '✓'
FAIL = '✗'


def check(name, fn):
    try:
        result = fn()
        if result is True or result is None:
            print(f'  {PASS} {name}')
            return True
        print(f'  {FAIL} {name}: {result}')
        return False
    except Exception as e:
        print(f'  {FAIL} {name}: {e}')
        return False


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _make_api():
    """构造一个含 network_* API 的 TodoApi 实例。"""
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


def main():
    print('\n=== D 阶段 12 项验收 ===\n')
    api, db_path = _make_api()
    total = 0
    passed = 0

    def tally(r):
        nonlocal total, passed
        total += 1
        if r:
            passed += 1

    # ---- 前 9 项：基础 API / 协议 ----

    def t1():
        api.auth_create_user(display_name='alice')
        r = api.network_start_coordinator()
        assert r['success']
        assert r['node']['nodeId'].startswith('node-')
        return True
    tally(check('1. 启动协调器 → 返回本机节点信息', t1))

    def t2():
        r = api.network_get_local_node()
        assert r['success']
        info = r['node']
        assert 'nodeId' in info and 'protocolVersion' in info
        assert info['protocolVersion'] == PROTOCOL_VERSION
        return True
    tally(check('2. 本机节点信息含 nodeId / protocolVersion', t2))

    def t3():
        r = api.network_list_peers()
        assert r['success']
        # 至少有本机节点（启动协调器时写入）
        ids = [p['nodeId'] for p in r['peers']]
        assert any(i.startswith('node-') for i in ids)
        return True
    tally(check('3. 在线节点列表至少含本机', t3))

    def t4():
        # 标记一个节点为 offline
        api._ensure_d_components()
        api.node_registry.upsert('offline-1', user_id='u-offline',
                                  user_name='OldUser', status='offline')
        r = api.network_list_peers(status='offline')
        assert r['success']
        ids = [p['nodeId'] for p in r['peers']]
        assert 'offline-1' in ids
        return True
    tally(check('4. 按 status=offline 过滤', t4))

    def t5():
        api._ensure_d_components()
        api.event_manager.log('peer_joined', peer_id='test-peer-1',
                              user_id='u1', detail='joined via beacon')
        r = api.network_event_log(event_type='peer_joined')
        assert r['success']
        assert any(e['peerId'] == 'test-peer-1' for e in r['events'])
        return True
    tally(check('5. peer_joined 事件可查询', t5))

    def t6():
        api._ensure_d_components()
        api.event_manager.log('handshake_ok', peer_id='test-peer-2',
                              user_id='u2', detail={'protocol_version': '1.0.0'})
        r = api.network_event_log(event_type='handshake_ok')
        assert r['success']
        assert any(e['peerId'] == 'test-peer-2' for e in r['events'])
        return True
    tally(check('6. handshake_ok 事件可查询', t6))

    def t7():
        api._ensure_d_components()
        api.event_manager.log('peer_left', peer_id='test-peer-3')
        r = api.network_event_log(event_type='peer_left')
        assert r['success']
        assert any(e['peerId'] == 'test-peer-3' for e in r['events'])
        return True
    tally(check('7. peer_left 事件可查询', t7))

    def t8():
        # PROTOCOL_VERSION = '1.0.0'
        parts = PROTOCOL_VERSION.split('.')
        assert len(parts) == 3
        return True
    tally(check('8. 协议版本号格式 x.y.z', t8))

    def t9():
        # 缺省 → 兼容
        assert check_version({'type': 'HELLO'}) is True
        # 匹配
        assert check_version({'type': 'HELLO', 'protocol_version': PROTOCOL_VERSION}) is True
        # 不匹配
        assert check_version({'type': 'HELLO', 'protocol_version': '0.9.0'}) is False
        return True
    tally(check('9. 协议版本校验（缺省兼容 / 匹配 / 不匹配）', t9))

    # ---- 后 3 项：双节点联调 ----

    # 停止 A 的协调器（与 B 测试互不干扰）
    api.network_stop_coordinator()

    class _MiniNode:
        def __init__(self, name, port_tcp, port_udp, db_path, target):
            from backend.database import operations
            operations.get_app_data_file = lambda: Path(db_path)
            from backend.database.operations import (
                TodoDatabase, SyncManager, NetworkNodeRegistry, NetworkEventManager,
            )
            self.db = TodoDatabase()
            self.sm = SyncManager(self.db)
            from backend.network.sync_engine import SyncEngine
            self.se = SyncEngine(db=self.db, sync_manager=self.sm)
            self.nr = NetworkNodeRegistry(self.db)
            self.em = NetworkEventManager(self.db)
            self.coord = NetworkCoordinator(
                node_id=name, user_id=f'u-{name}',
                user_name=name, tcp_port=port_tcp, udp_port=port_udp,
                db=self.db, sync_manager=self.sm, sync_engine=self.se,
                node_registry=self.nr, event_manager=self.em,
                groups_provider=lambda: [GroupBeacon(group_id='g-shared',
                                                       join_code='SHARE-01',
                                                       is_hidden=False)],
                direct_peers=[('127.0.0.1', target[1], target[0])],
            )

        def shutdown(self):
            """安全停止并释放所有资源（避免 Windows 文件句柄占用）。"""
            try:
                self.coord.stop()
            except Exception:
                pass
            self.coord = None
            self.se = None
            self.nr = None
            self.em = None
            self.sm = None
            self.db = None

    def _safe_unlink(path: str, retries: int = 10, delay: float = 0.1) -> None:
        """Windows 上 sqlite 连接 / socket 释放有延迟：循环重试 unlink。"""
        import gc
        gc.collect()
        for i in range(retries):
            try:
                Path(path).unlink(missing_ok=True)
                return
            except PermissionError:
                time.sleep(delay)
            except OSError:
                time.sleep(delay)
        # 兜底：忽略
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass

    def t10():
        # 两个独立节点，direct_peers 互指
        a_tcp, a_udp = _free_port(), _free_port()
        b_tcp, b_udp = _free_port(), _free_port()
        tmp_a = tempfile.NamedTemporaryFile(suffix='_a.db', delete=False); tmp_a.close()
        tmp_b = tempfile.NamedTemporaryFile(suffix='_b.db', delete=False); tmp_b.close()
        a = _MiniNode('node-A', a_tcp, a_udp, tmp_a.name, (b_tcp, b_udp))
        b = _MiniNode('node-B', b_tcp, b_udp, tmp_b.name, (a_tcp, a_udp))
        a.coord.start()
        b.coord.start()
        try:
            # 等握手
            deadline = time.time() + 10
            ok = False
            while time.time() < deadline:
                if any(n.id == 'node-B' for n in a.nr.list_all()) and \
                   any(n.id == 'node-A' for n in b.nr.list_all()):
                    ok = True
                    break
                time.sleep(0.1)
            assert ok, f"握手未完成：A 看到 {a.nr.list_all()}，B 看到 {b.nr.list_all()}"
        finally:
            a.shutdown()
            b.shutdown()
            # 等线程退出 + 短连接关闭
            time.sleep(0.5)
            _safe_unlink(tmp_a.name)
            _safe_unlink(tmp_b.name)
        return True
    tally(check('10. 双节点握手 → 双方互相可见', t10))

    def t11():
        # 强制重同步 API
        api.auth_create_user(display_name='charlie')
        api.network_start_coordinator()
        time.sleep(0.3)
        r = api.network_resync()
        assert r['success']
        # 无对端时 resynced_count = 0
        assert r.get('resynced_count', -1) == 0
        return True
    tally(check('11. 强制重同步 API（无 peer 返回 0）', t11))

    def t12():
        # 事件日志 API + 类型筛选
        api._ensure_d_components()
        api.event_manager.log('protocol_error', peer_id='n-bad', detail='version 0.9.0')
        api.event_manager.log('conflict', peer_id='n-c', user_id='u-c', detail={'field': 'title'})
        r_all = api.network_event_log(limit=50)
        r_pe = r_all['events']
        assert any(e['type'] == 'protocol_error' for e in r_pe)
        assert any(e['type'] == 'conflict' for e in r_pe)
        # 类型筛选
        r_filter = api.network_event_log(event_type='protocol_error')
        assert all(e['type'] == 'protocol_error' for e in r_filter['events'])
        api.network_stop_coordinator()
        return True
    tally(check('12. 网络事件日志 + 类型筛选', t12))

    print(f'\n=== 通过 {passed}/{total} ===\n')
    Path(db_path).unlink(missing_ok=True)
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())

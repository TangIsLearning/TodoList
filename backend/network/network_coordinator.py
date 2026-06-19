# backend/network/network_coordinator.py
"""
D 阶段：网络协调器

把 DiscoveryService（UDP 发现）+ PeerServer（TCP 长连接）+ SyncEngine 串成一个完整的
数据流：发现 → 主动连接 → 握手 → 增量同步 → 本地变更广播 → 断线重连。

主要组件：
- NetworkCoordinator：顶层协调器，对外暴露 start / stop / apply_local_change
- HandshakeState：跟踪单条 PeerConnection 的握手状态（避免重复处理）

事件流向：
    1. start()：生成 node_id → 启动 PeerServer(on_connect) → 启动 DiscoveryService(on_beacon)
    2. on_beacon(beacon)：过滤本地已加入协作组 → connect_peer(beacon.address)
    3. on_connect(pc)：发送 SYNC_HANDSHAKE，标记 HandshakeState.WAITING_RESPONSE
    4. on_message(pc, msg)：
        - SYNC_HANDSHAKE：记录 peer → 响应 SYNC_HANDSHAKE_ACK
        - SYNC_PULL_REQUEST：用本地 get_pull_payload 构造 SYNC_PULL_RESPONSE
        - SYNC_PULL_RESPONSE：apply_pull_response
        - SYNC_BROADCAST：apply_remote_change
        - SYNC_BYE：mark_status(offline)
        - ERROR：log protocol_error 事件
    5. on_close(pc)：mark_status(offline) + 写 network_events
    6. apply_local_change(entity_type, entity)：遍历 NodeRegistry 在线 peer → SYNC_BROADCAST
"""
import threading
import socket
import time
import uuid
from typing import Callable, Optional, List, Set

from backend.network.discovery import (
    DiscoveryService, GroupBeacon, Beacon,
)
from backend.network.peer import PeerServer, PeerConnection, connect_peer
from backend.network.protocol import (
    encode_message, decode_message, ProtocolError,
    SYNC_HANDSHAKE, SYNC_PULL_REQUEST, SYNC_PULL_RESPONSE,
    SYNC_BROADCAST, SYNC_BYE, ERROR, HELLO, WELCOME,
    check_version, make_error, ERR_PROTOCOL_MISMATCH, ERR_UNKNOWN_TYPE,
    PROTOCOL_VERSION,
)


# 握手状态
class HandshakeState:
    PENDING = 'pending'              # 收到对端 HANDSHAKE 但未发送响应
    WAITING_RESPONSE = 'waiting'     # 已发送本机 HANDSHAKE，等待 ACK
    ESTABLISHED = 'established'      # 双向握手完成


class _PeerState:
    """单条 PeerConnection 关联的状态。"""

    def __init__(self, pc: PeerConnection, peer_id: str = ''):
        self.pc = pc
        self.peer_id = peer_id
        self.user_id = ''
        self.user_name = ''
        self.address = ''
        self.handshake_state = HandshakeState.PENDING
        self.last_seen = time.time()


class NetworkCoordinator:
    """网络协调器：连接 Discovery / PeerServer / SyncEngine / NodeRegistry / EventManager。"""

    def __init__(self,
                 node_id: str = None,
                 user_id: str = '',
                 user_name: str = '',
                 tcp_port: int = 54722,
                 udp_port: int = 54721,
                 db=None,
                 sync_manager=None,
                 sync_engine=None,
                 node_registry=None,
                 event_manager=None,
                 groups_provider: Optional[Callable[[], List[GroupBeacon]]] = None,
                 direct_peers: Optional[List[tuple]] = None):
        # 节点身份
        self.node_id = node_id or str(uuid.uuid4())
        self.user_id = user_id
        self.user_name = user_name
        self.tcp_port = tcp_port
        self.udp_port = udp_port

        # 协作组件
        self.db = db
        self.sync_manager = sync_manager
        self.sync_engine = sync_engine
        self.node_registry = node_registry
        self.event_manager = event_manager
        # 协作组列表提供者（注入）
        self._groups_provider = groups_provider or (lambda: [])
        # 定向对端列表：[(host, udp_port, tcp_port), ...]
        # 用于单播 beacon（解决 255.255.255.255 广播在某些网络不可达的问题）
        self._direct_peers: List[tuple] = list(direct_peers or [])

        # 内部状态
        self._running = False
        self._lock = threading.RLock()
        self._peers: dict[str, _PeerState] = {}    # peer_id -> state
        self._conns: dict[int, _PeerState] = {}    # id(pc) -> state
        self._server: Optional[PeerServer] = None
        self._discovery: Optional[DiscoveryService] = None
        self._direct_sock: Optional[socket.socket] = None
        self._direct_thread: Optional[threading.Thread] = None

    def add_direct_peer(self, host: str, udp_port: int, tcp_port: int) -> None:
        """添加一个已知对端：定向单播 beacon。"""
        with self._lock:
            self._direct_peers.append((host, udp_port, tcp_port))

    # ============ 生命周期 ============

    def start(self) -> None:
        """启动 PeerServer + Discovery。"""
        if self._running:
            return
        self._running = True

        # 1. PeerServer
        self._server = PeerServer(host='0.0.0.0', port=self.tcp_port,
                                   on_connect=self._on_server_connect)
        self._server.start()

        # 2. Discovery
        self._discovery = DiscoveryService(
            port=self.udp_port, node_id=self.node_id,
            user_id=self.user_id, user_name=self.user_name,
            tcp_port=self.tcp_port, groups=self._groups_provider(),
            on_beacon=self._on_beacon, listen=True,
        )
        self._discovery.start()

        # 3. 定向单播 beacon 循环（覆盖 255.255.255.255 不可达场景）
        if self._direct_peers:
            self._direct_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                self._direct_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            except Exception:
                pass
            self._direct_thread = threading.Thread(target=self._direct_send_loop, daemon=True)
            self._direct_thread.start()

        # 4. 节点注册表写入本机记录
        if self.node_registry:
            self.node_registry.upsert(
                node_id=self.node_id, user_id=self.user_id,
                user_name=self.user_name,
                address=f'0.0.0.0:{self.tcp_port}',
                status='online', protocol_version=PROTOCOL_VERSION,
                group_ids=[g.group_id for g in self._groups_provider()],
            )

    def _direct_send_loop(self) -> None:
        """定向单播 beacon 循环。"""
        import json as _json
        from backend.network.discovery import BEACON_INTERVAL
        while self._running:
            payload = {
                'type': 'discovery_beacon',
                'node_id': self.node_id,
                'user_id': self.user_id,
                'user_name': self.user_name,
                'groups': [{'group_id': g.group_id, 'join_code': g.join_code,
                            'is_hidden': g.is_hidden} for g in self._groups_provider()],
                'tcp_port': self.tcp_port,
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
            data = _json.dumps(payload, ensure_ascii=False).encode('utf-8')
            with self._lock:
                targets = list(self._direct_peers)
            for host, udp_port, _tcp in targets:
                try:
                    if self._direct_sock:
                        self._direct_sock.sendto(data, (host, udp_port))
                except Exception:
                    pass
            time.sleep(BEACON_INTERVAL)

    def stop(self) -> None:
        """停止所有组件。"""
        self._running = False
        if self._direct_sock:
            try:
                self._direct_sock.close()
            except Exception:
                pass
            self._direct_sock = None
        if self._discovery:
            self._discovery.stop()
            self._discovery = None
        if self._server:
            self._server.stop()
            self._server = None
        with self._lock:
            for state in list(self._peers.values()):
                try:
                    state.pc.send({'type': SYNC_BYE, 'reason': 'shutdown'})
                except Exception:
                    pass
                state.pc.stop()
            self._peers.clear()
            self._conns.clear()

    def is_running(self) -> bool:
        return self._running

    # ============ Discovery 回调 ============

    def _on_beacon(self, beacon: Beacon) -> None:
        """收到远端 beacon：过滤 → 主动连接。"""
        if not self._running:
            return
        # 不连自己
        if beacon.node_id == self.node_id:
            return
        # 只连在 beacon 中出现且本机也已加入的协作组（隐藏组不广播）
        local_groups = {g.group_id for g in self._groups_provider()}
        beacon_groups = {g.group_id for g in beacon.groups}
        if not (local_groups & beacon_groups):
            return
        # 已在连接列表则跳过
        with self._lock:
            if beacon.node_id in self._peers:
                return
            state = _PeerState(pc=None, peer_id=beacon.node_id)
            state.user_id = beacon.user_id
            state.user_name = beacon.user_name
            state.address = f'{beacon.address[0]}:{beacon.tcp_port}'
            self._peers[beacon.node_id] = state
        # 异步连接
        threading.Thread(target=self._connect_to_peer, args=(beacon,),
                         daemon=True).start()

    def _connect_to_peer(self, beacon: Beacon) -> None:
        """主动连接到对端。"""
        try:
            host, _ = beacon.address
            pc = connect_peer(host, beacon.tcp_port, timeout=5.0)
            if pc is None:
                self._log_event('connect_fail', peer_id=beacon.node_id,
                                detail=f'{host}:{beacon.tcp_port}')
                return
            with self._lock:
                state = self._peers.get(beacon.node_id)
                if state is None:
                    pc.stop()
                    return
                state.pc = pc
                state.handshake_state = HandshakeState.WAITING_RESPONSE
                self._conns[id(pc)] = state
            pc.on_message = self._make_on_message(state)
            pc.on_close = self._make_on_close(state)
            # 发送本机 HANDSHAKE
            self._send_handshake(state)
            if self.event_manager:
                self.event_manager.log('peer_joined', peer_id=beacon.node_id,
                                        user_id=beacon.user_id,
                                        detail=f'{host}:{beacon.tcp_port}')
        except Exception as e:
            self._log_event('connect_fail', peer_id=beacon.node_id, detail=str(e))

    # ============ PeerServer 回调 ============

    def _on_server_connect(self, pc: PeerConnection) -> None:
        """接受到对端主动连接。"""
        if not self._running:
            pc.stop()
            return
        state = _PeerState(pc=pc)
        with self._lock:
            self._conns[id(pc)] = state
        pc.on_message = self._make_on_message(state)
        pc.on_close = self._make_on_close(state)
        # 作为 server 端，主动发本机 HANDSHAKE 给对端
        # （对端如果是 client 端，已经在 _connect_to_peer 中发过；这里再发一次保证双向都有）
        self._send_handshake(state)

    def _make_on_message(self, state: _PeerState) -> Callable:
        def on_message(pc: PeerConnection, msg: dict) -> None:
            self._handle_message(state, msg)
        return on_message

    def _make_on_close(self, state: _PeerState) -> Callable:
        def on_close(pc: PeerConnection) -> None:
            self._handle_close(state, pc)
        return on_close

    # ============ 消息处理 ============

    def _handle_message(self, state: _PeerState, msg: dict) -> None:
        state.last_seen = time.time()
        mtype = msg.get('type')

        # 协议版本校验（缺省视为兼容）
        if not check_version(msg):
            self._log_event('protocol_error', peer_id=state.peer_id or msg.get('node_id'),
                            detail=f'got {msg.get("protocol_version")}')
            try:
                state.pc.send(make_error(ERR_PROTOCOL_MISMATCH,
                                         f'expect {PROTOCOL_VERSION}'))
            except Exception:
                pass
            return

        if mtype == SYNC_HANDSHAKE:
            self._handle_handshake(state, msg)
        elif mtype == SYNC_PULL_REQUEST:
            self._handle_pull_request(state, msg)
        elif mtype == SYNC_PULL_RESPONSE:
            self._handle_pull_response(state, msg)
        elif mtype == SYNC_BROADCAST:
            self._handle_broadcast(state, msg)
        elif mtype == SYNC_BYE:
            self._mark_offline(state.peer_id)
            try:
                state.pc.stop()
            except Exception:
                pass
        elif mtype == ERROR:
            self._log_event('protocol_error', peer_id=state.peer_id,
                            detail=msg.get('code') + ':' + msg.get('message', ''))
        elif mtype == HELLO:
            # 兼容旧握手：收到 HELLO 等价于收到 HANDSHAKE
            self._handle_handshake(state, {
                'type': SYNC_HANDSHAKE,
                'node_id': msg.get('node_id', state.peer_id),
                'user_id': msg.get('user_id', ''),
                'group_ids': msg.get('group_ids', []),
                'last_sync_at': msg.get('last_sync_at', ''),
            })
        # PING/PONG/WELCOME/ACK 由 PeerConnection 协议层透明处理，业务层不感知

    def _handle_handshake(self, state: _PeerState, msg: dict) -> None:
        """处理 HANDSHAKE：记录 peer → 标记 ESTABLISHED → 触发增量同步。"""
        peer_id = msg.get('node_id', '')
        user_id = msg.get('user_id', '')
        last_sync_at = msg.get('last_sync_at', '')
        group_ids = msg.get('group_ids', [])

        state.peer_id = peer_id
        state.user_id = user_id
        state.handshake_state = HandshakeState.ESTABLISHED

        if self.node_registry:
            self.node_registry.upsert(
                node_id=peer_id, user_id=user_id,
                user_name=msg.get('user_name', ''),
                address=state.address or '',
                status='online', protocol_version=PROTOCOL_VERSION,
                group_ids=group_ids,
            )
        if self.event_manager:
            self.event_manager.log('handshake_ok', peer_id=peer_id, user_id=user_id,
                                    detail={'last_sync_at': last_sync_at,
                                            'group_ids': group_ids})
        # 把本 peer 加入 _peers
        with self._lock:
            self._peers[peer_id] = state

        # 触发增量同步（从 last_sync_at 之后拉取本端应有但缺失的变更）
        if self.sync_engine:
            self.sync_engine.sync_with_peer(peer_id, since=last_sync_at)
            for et in ('task', 'category'):
                try:
                    payload = self.sync_engine.get_pull_payload(et, since_timestamp=last_sync_at)
                    if payload:
                        try:
                            state.pc.send({
                                'type': SYNC_PULL_REQUEST,
                                'entity_type': et,
                                'since': last_sync_at,
                            })
                        except Exception:
                            pass
                except Exception:
                    pass

    def _handle_pull_request(self, state: _PeerState, msg: dict) -> None:
        """处理对端的 PULL_REQUEST：用本地数据构造 PULL_RESPONSE 发回。"""
        if not self.sync_engine:
            return
        et = msg.get('entity_type', 'task')
        since = msg.get('since', '')
        try:
            payload = self.sync_engine.get_pull_payload(et, since_timestamp=since)
        except Exception:
            payload = []
        try:
            state.pc.send({
                'type': SYNC_PULL_RESPONSE,
                'entity_type': et,
                'entities': payload,
            })
        except Exception:
            pass

    def _handle_pull_response(self, state: _PeerState, msg: dict) -> None:
        """处理对端的 PULL_RESPONSE：apply 到本地。"""
        if not self.sync_engine:
            return
        et = msg.get('entity_type', 'task')
        entities = msg.get('entities', []) or []
        n = self.sync_engine.apply_pull_response(et, entities, peer_id=state.peer_id,
                                                 user_id=state.user_id)
        if n and self.event_manager:
            self.event_manager.log('pull_ok', peer_id=state.peer_id,
                                    detail={'entity_type': et, 'count': n})
        # 记录 last_sync_at
        if self.sync_engine:
            from datetime import datetime, timezone
            self.sync_engine.record_sync_at(state.peer_id,
                                            datetime.now(timezone.utc).isoformat())
        if self.node_registry:
            from datetime import datetime, timezone
            self.node_registry.update_last_sync_at(state.peer_id,
                                                    datetime.now(timezone.utc).isoformat())

    def _handle_broadcast(self, state: _PeerState, msg: dict) -> None:
        """处理对端广播的本地变更。"""
        if not self.sync_engine:
            return
        et = msg.get('entity_type', '')
        entity = msg.get('entity') or {}
        if not et or not entity:
            return
        try:
            self.sync_engine.apply_remote_change(et, entity, peer_id=state.peer_id,
                                                 user_id=state.user_id)
        except Exception as e:
            if self.event_manager:
                self.event_manager.log('apply_fail', peer_id=state.peer_id,
                                        detail=f'{et}: {e}')

    def _handle_close(self, state: _PeerState, pc: PeerConnection) -> None:
        """连接关闭：标记 offline。"""
        peer_id = state.peer_id
        with self._lock:
            self._conns.pop(id(pc), None)
            if peer_id and self._peers.get(peer_id) is state:
                # 保持 _peers 条目以便重连识别
                pass
        if peer_id:
            self._mark_offline(peer_id)

    # ============ 主动行为 ============

    def _send_handshake(self, state: _PeerState) -> None:
        """发送本机 HANDSHAKE。"""
        if not state.pc:
            return
        last_sync_at = ''
        if self.sync_engine and state.peer_id:
            last_sync_at = self.sync_engine.get_last_sync_at(state.peer_id)
        groups = [g.group_id for g in self._groups_provider()]
        try:
            state.pc.send({
                'type': SYNC_HANDSHAKE,
                'node_id': self.node_id,
                'user_id': self.user_id,
                'user_name': self.user_name,
                'group_ids': groups,
                'last_sync_at': last_sync_at,
            })
        except Exception:
            pass

    def apply_local_change(self, entity_type: str, entity: dict) -> None:
        """本地变更：向所有在线 peer 广播。"""
        if not self._running:
            return
        with self._lock:
            states = list(self._peers.values())
        for state in states:
            if not state.pc or state.handshake_state != HandshakeState.ESTABLISHED:
                continue
            try:
                state.pc.send({
                    'type': SYNC_BROADCAST,
                    'entity_type': entity_type,
                    'entity': entity,
                })
            except Exception:
                pass

    def resync_with_peer(self, peer_id: str) -> bool:
        """对指定 peer 触发增量重同步。"""
        with self._lock:
            state = self._peers.get(peer_id)
        if not state or not state.pc:
            return False
        last_sync_at = ''
        if self.sync_engine:
            last_sync_at = self.sync_engine.get_last_sync_at(peer_id)
        for et in ('task', 'category'):
            try:
                state.pc.send({
                    'type': SYNC_PULL_REQUEST,
                    'entity_type': et,
                    'since': last_sync_at,
                })
            except Exception:
                pass
        return True

    def resync_all(self) -> int:
        """对所有 peer 触发重同步，返回成功数。"""
        n = 0
        for pid in list(self._peers.keys()):
            if self.resync_with_peer(pid):
                n += 1
        return n

    # ============ 状态查询 ============

    def list_online_peers(self) -> List[dict]:
        """返回在线 peer 列表（供 UI 展示）。"""
        if self.node_registry:
            nodes = self.node_registry.list_online()
            return [
                {
                    'nodeId': n.id, 'userId': n.user_id, 'userName': n.user_name,
                    'address': n.address, 'status': n.status,
                    'lastSeen': n.last_seen, 'lastSyncAt': n.last_sync_at,
                    'protocolVersion': n.protocol_version,
                }
                for n in nodes if n.id != self.node_id
            ]
        return []

    def get_local_node(self) -> dict:
        return {
            'nodeId': self.node_id,
            'userId': self.user_id,
            'userName': self.user_name,
            'tcpPort': self.tcp_port,
            'udpPort': self.udp_port,
            'protocolVersion': PROTOCOL_VERSION,
        }

    def _mark_offline(self, peer_id: str) -> None:
        if not peer_id or not self.node_registry:
            return
        self.node_registry.mark_status(peer_id, 'offline')
        if self.event_manager:
            self.event_manager.log('peer_left', peer_id=peer_id)

    def _log_event(self, type_: str, peer_id: str = None, detail=None) -> None:
        if self.event_manager:
            self.event_manager.log(type_, peer_id=peer_id, detail=detail)

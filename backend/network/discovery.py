# backend/network/discovery.py
import json
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional

BEACON_INTERVAL = 3  # 秒


@dataclass
class GroupBeacon:
    group_id: str
    join_code: str
    is_hidden: bool = False


@dataclass
class Beacon:
    node_id: str
    user_id: str
    user_name: str
    groups: List[GroupBeacon] = field(default_factory=list)
    tcp_port: int = 0
    timestamp: str = ''
    address: tuple = ()  # (ip, port)


def parse_beacon(raw: dict) -> Beacon:
    if raw.get('type') != 'discovery_beacon':
        raise ValueError('NOT_A_BEACON')
    groups = [GroupBeacon(group_id=g['group_id'], join_code=g['join_code'],
                          is_hidden=g.get('is_hidden', False))
              for g in raw.get('groups', [])]
    return Beacon(node_id=raw['node_id'], user_id=raw['user_id'],
                  user_name=raw.get('user_name', ''), groups=groups,
                  tcp_port=raw.get('tcp_port', 0), timestamp=raw.get('timestamp', ''))


class DiscoveryService:
    """UDP 广播：周期性发送本机 beacon + 监听其他节点"""

    def __init__(self, port: int, node_id: str, user_id: str, user_name: str,
                 tcp_port: int, groups: List[GroupBeacon],
                 on_beacon: Optional[Callable] = None,
                 listen: bool = True):
        self.port = port
        self.node_id = node_id
        self.user_id = user_id
        self.user_name = user_name
        self.tcp_port = tcp_port
        self.groups = groups
        self.on_beacon = on_beacon
        self.beacons: List[Beacon] = []
        self._running = False
        self._threads: List[threading.Thread] = []
        self._sock_recv: Optional[socket.socket] = None
        self._sock_send: Optional[socket.socket] = None
        self._listen_enabled = listen

    def start(self):
        if self._running:
            return
        self._running = True
        # 发送 beacon
        t_send = threading.Thread(target=self._send_loop, daemon=True)
        t_send.start()
        self._threads.append(t_send)

        if self._listen_enabled:
            t_recv = threading.Thread(target=self._recv_loop, daemon=True)
            t_recv.start()
            self._threads.append(t_recv)

    def stop(self):
        self._running = False
        if self._sock_recv:
            try:
                self._sock_recv.close()
            except Exception:
                pass
        if self._sock_send:
            try:
                self._sock_send.close()
            except Exception:
                pass

    def start_listen(self, port: int = None):
        """仅启动监听（测试用）"""
        if port:
            self.port = port
        self._running = True
        t = threading.Thread(target=self._recv_loop, daemon=True)
        t.start()
        self._threads.append(t)

    def stop_listen(self):
        self._running = False
        if self._sock_recv:
            try:
                self._sock_recv.close()
            except Exception:
                pass

    def _send_loop(self):
        self._sock_send = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock_send.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self._sock_send.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        while self._running:
            beacon = {
                'type': 'discovery_beacon',
                'node_id': self.node_id,
                'user_id': self.user_id,
                'user_name': self.user_name,
                'groups': [{'group_id': g.group_id, 'join_code': g.join_code,
                            'is_hidden': g.is_hidden} for g in self.groups],
                'tcp_port': self.tcp_port,
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
            try:
                self._sock_send.sendto(
                    json.dumps(beacon, ensure_ascii=False).encode('utf-8'),
                    ('255.255.255.255', self.port),
                )
            except Exception:
                pass
            time.sleep(BEACON_INTERVAL)

    def _recv_loop(self):
        try:
            self._sock_recv = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock_recv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                self._sock_recv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except (AttributeError, OSError):
                pass
            self._sock_recv.bind(('', self.port))
            self._sock_recv.settimeout(1.0)
        except OSError:
            return

        while self._running:
            try:
                data, addr = self._sock_recv.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                raw = json.loads(data.decode('utf-8'))
                beacon = parse_beacon(raw)
                beacon.address = addr
                if beacon.node_id == self.node_id:
                    continue  # 忽略自己的
                self.beacons.append(beacon)
                if self.on_beacon:
                    try:
                        self.on_beacon(beacon)
                    except Exception:
                        pass
            except (ValueError, json.JSONDecodeError, KeyError):
                continue

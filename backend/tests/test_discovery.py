import sys, socket, time, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.discovery import DiscoveryService, parse_beacon


def test_parse_beacon_valid():
    raw = {
        'type': 'discovery_beacon',
        'node_id': 'n1',
        'user_id': 'u1',
        'user_name': '郭世锋',
        'groups': [{'group_id': 'g1', 'join_code': 'A8B-3K9', 'is_hidden': False}],
        'tcp_port': 54722,
        'timestamp': '2026-06-19T10:00:00Z',
    }
    parsed = parse_beacon(raw)
    assert parsed.node_id == 'n1' and parsed.user_name == '郭世锋'
    assert parsed.groups[0].join_code == 'A8B-3K9'


def test_parse_beacon_invalid():
    try:
        parse_beacon({'type': 'unknown'})
        assert False
    except ValueError:
        pass


def test_discovery_send_and_receive():
    """在 localhost 上发送并接收 beacon（单进程模拟）"""
    # 用 15472 端口避免与默认冲突
    service = DiscoveryService(port=15472, node_id='n1', user_id='u1',
                                user_name='测试', tcp_port=54722,
                                groups=[], listen=False)
    service.beacons = []
    service.start_listen(port=15472)
    time.sleep(0.1)

    # 发送一个 beacon
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    import json
    beacon = {
        'type': 'discovery_beacon',
        'node_id': 'n2', 'user_id': 'u2', 'user_name': 'Other',
        'groups': [{'group_id': 'g1', 'join_code': 'XYZ-123', 'is_hidden': False}],
        'tcp_port': 54722, 'timestamp': '2026-06-19T10:00:00Z',
    }
    sock.sendto(json.dumps(beacon).encode('utf-8'), ('127.0.0.1', 15472))
    sock.close()

    time.sleep(0.5)
    service.stop_listen()
    codes = [b.groups[0].join_code for b in service.beacons if b.groups]
    assert 'XYZ-123' in codes

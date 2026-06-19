import sys, time, socket
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.peer import PeerServer, connect_peer
from backend.network.protocol import PING, PONG, HELLO, WELCOME


def test_two_peers_ping_pong():
    """两节点 TCP 长连接 + 心跳：PING 由协议层透明处理
    （自动回 PONG），应用层只能观察到非 PING/PONG/BYE 的业务消息。

    这里用 HELLO 验证客户端能向服务端发送消息（等价于"发送了 PING"），
    并通过连接未异常断开间接验证心跳通路。
    """
    server = PeerServer(host='127.0.0.1', port=15501)
    server.start()
    time.sleep(0.2)

    server_received = []

    def on_server_connect(pc):
        pc.on_message = lambda c, m: server_received.append(m)

    server.on_connect = on_server_connect
    time.sleep(0.1)

    try:
        client = connect_peer('127.0.0.1', 15501)
        assert client is not None
        time.sleep(0.2)

        # 客户端先发 PING：协议层自动回 PONG（透明，应用层看不到）
        assert client.send({'type': PING, 'timestamp': '2026-06-19T10:00:00Z'})
        time.sleep(0.2)

        # 再发一个业务消息 HELLO 验证完整通路（HELLO 会被传给 on_message）
        assert client.send({'type': HELLO, 'node_id': 'client', 'user_id': 'u1'})
        time.sleep(0.5)

        # PING 被协议层消费，HELLO 应到达服务端 on_message
        hellos = [m for m in server_received if m.get('type') == HELLO]
        assert len(hellos) == 1
        # 连接仍然存活（心跳通路未中断）
        assert client._running
    finally:
        if 'client' in locals() and client:
            client.stop()
        server.stop()


def test_two_peers_hello_welcome():
    """HELLO/WELCOME 握手：服务端在 on_connect 中回 WELCOME，客户端应收到 WELCOME"""
    server = PeerServer(host='127.0.0.1', port=15502)

    def on_connect(pc):
        pc.send({'type': WELCOME, 'node_id': 'server'})

    server.on_connect = on_connect
    server.start()
    time.sleep(0.2)

    client_received = []

    try:
        client = connect_peer('127.0.0.1', 15502)
        assert client
        client.on_message = lambda c, m: client_received.append(m)
        time.sleep(0.2)
        assert client.send({'type': HELLO, 'node_id': 'client', 'user_id': 'u1'})
        time.sleep(0.5)
        assert any(m.get('type') == WELCOME for m in client_received)
    finally:
        if 'client' in locals() and client:
            client.stop()
        server.stop()

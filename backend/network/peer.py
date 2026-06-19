# backend/network/peer.py
import socket
import threading
import time
from typing import Callable, Optional

from backend.network.protocol import encode_message, decode_message, ProtocolError, PING, PONG, HELLO, WELCOME, ACK, BYE


HEARTBEAT_INTERVAL = 30
HEARTBEAT_TIMEOUT = 90  # 3 次未响应


class PeerConnection:
    """一条 TCP 长连接（双向通信）"""

    def __init__(self, sock: socket.socket, peer_addr, is_initiator: bool,
                 on_message: Optional[Callable] = None, on_close: Optional[Callable] = None):
        self.sock = sock
        self.peer_addr = peer_addr
        self.is_initiator = is_initiator
        self.on_message = on_message
        self.on_close = on_close
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_pong = time.time()
        self._send_lock = threading.Lock()
        self._closed = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        self._close_socket()
        if self._thread:
            self._thread.join(timeout=2)

    def send(self, msg: dict):
        if self._closed:
            return False
        data = encode_message(msg)
        with self._send_lock:
            try:
                self.sock.sendall(data)
                return True
            except OSError:
                return False

    def _loop(self):
        buf = b''
        while self._running and not self._closed:
            try:
                self.sock.settimeout(1.0)
                chunk = self.sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
                # 解析所有完整消息
                while len(buf) >= 4:
                    import struct
                    length = struct.unpack('>I', buf[:4])[0]
                    if len(buf) < 4 + length:
                        break
                    try:
                        msg = decode_message(buf[:4+length])
                        self._handle_message(msg)
                    except ProtocolError:
                        pass
                    buf = buf[4+length:]
            except socket.timeout:
                continue
            except OSError:
                break
        self._close_socket()
        if self.on_close:
            try:
                self.on_close(self)
            except Exception:
                pass

    def _handle_message(self, msg: dict):
        mtype = msg.get('type')
        if mtype == PING:
            self.send({'type': PONG, 'timestamp': msg.get('timestamp')})
            return
        if mtype == PONG:
            self._last_pong = time.time()
            return
        if mtype == BYE:
            self.stop()
            return
        if self.on_message:
            try:
                self.on_message(self, msg)
            except Exception:
                pass

    def _close_socket(self):
        if self._closed:
            return
        self._closed = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


class PeerServer:
    """TCP 服务端：监听连接 + 管理活跃连接"""

    def __init__(self, host: str = '0.0.0.0', port: int = 54722,
                 on_connect: Optional[Callable] = None):
        self.host = host
        self.port = port
        self.on_connect = on_connect
        self._running = False
        self._sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self.connections: list[PeerConnection] = []
        self._lock = threading.Lock()

    def start(self):
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.port))
        self._sock.listen(8)
        self._sock.settimeout(1.0)
        self._running = True
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
        with self._lock:
            for c in list(self.connections):
                c.stop()
            self.connections.clear()

    def _accept_loop(self):
        while self._running:
            try:
                client, addr = self._sock.accept()
            except (socket.timeout, OSError):
                continue
            pc = PeerConnection(client, addr, is_initiator=False,
                                on_close=self._on_close)
            with self._lock:
                self.connections.append(pc)
            pc.start()
            if self.on_connect:
                try:
                    self.on_connect(pc)
                except Exception:
                    pass

    def _on_close(self, pc: PeerConnection):
        with self._lock:
            try:
                self.connections.remove(pc)
            except ValueError:
                pass


def connect_peer(host: str, port: int, timeout: float = 5.0) -> Optional[PeerConnection]:
    """主动连接到对端"""
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        pc = PeerConnection(sock, (host, port), is_initiator=True)
        pc.start()
        return pc
    except OSError:
        return None

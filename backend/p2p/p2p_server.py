"""
P2P服务器模块 - 负责监听并共享数据
"""
import socket
import threading
import json
import struct
from typing import Callable, Optional, Tuple


class P2PServer:
    """P2P服务器，用于在局域网内共享数据"""

    def __init__(self, port: int = 5000, auto_manage_firewall: bool = True):
        self.port = port
        self.server_socket: Optional[socket.socket] = None
        self.is_running = False
        self.on_data_received_callback: Optional[Callable] = None
        self.on_data_request_callback: Optional[Callable] = None
        self.auto_manage_firewall = auto_manage_firewall
        self._firewall_manager = None

        # 如果启用自动防火墙管理，初始化防火墙管理器
        if self.auto_manage_firewall:
            try:
                from backend.p2p.firewall_manager import FirewallManager
                self._firewall_manager = FirewallManager(port=port)
                print(f"[P2P服务器] 防火墙自动管理已启用")
            except Exception as e:
                print(f"[P2P服务器] 警告：无法初始化防火墙管理器: {e}")
                self._firewall_manager = None

    def start(self, callback: Optional[Callable] = None) -> Tuple[bool, str]:
        """启动服务器

        Args:
            callback: 数据接收回调函数，参数为接收到的数据字典

        Returns:
            (success, message) 元组，success表示是否成功，message为详细信息
        """
        if self.is_running:
            return False, "服务器已在运行中"

        self.on_data_received_callback = callback

        # 自动添加防火墙规则
        firewall_message = ""
        if self._firewall_manager:
            print(f"[P2P服务器] 正在配置防火墙规则...")
            fw_success, fw_msg = self._firewall_manager.add_rule()
            if not fw_success:
                print(f"[P2P服务器] 警告：{fw_msg}")
                firewall_message = f"（注意：{fw_msg}）"
            else:
                print(f"[P2P服务器] {fw_msg}")
                firewall_message = f"（{fw_msg}）"

        try:
            self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.server_socket.bind(('0.0.0.0', self.port))
            self.server_socket.listen(5)
            self.is_running = True

            # 启动监听线程
            listen_thread = threading.Thread(target=self._listen_for_connections, daemon=True)
            listen_thread.start()

            print(f"[P2P服务器] ✓ 服务器启动成功，监听 0.0.0.0:{self.port}")
            return True, f"服务器启动成功{firewall_message}"

        except OSError as e:
            error_msg = f"服务器启动失败（端口 {self.port} 可能被占用）: {e}"
            print(f"[P2P服务器] ✗ {error_msg}")

            # 启动失败时清理防火墙规则
            if self._firewall_manager:
                self._firewall_manager.remove_rule()

            return False, error_msg
        except Exception as e:
            error_msg = f"服务器启动失败: {e}"
            print(f"[P2P服务器] ✗ {error_msg}")

            # 启动失败时清理防火墙规则
            if self._firewall_manager:
                self._firewall_manager.remove_rule()

            return False, error_msg

    def set_data_request_callback(self, callback: Callable):
        """设置数据请求回调函数

        Args:
            callback: 当收到数据请求时调用的函数，返回要共享的数据
        """
        self.on_data_request_callback = callback

    def stop(self) -> Tuple[bool, str]:
        """停止服务器

        Returns:
            (success, message) 元组，success表示是否成功，message为详细信息
        """
        print(f"[P2P服务器] 正在停止服务器...")

        self.is_running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except:
                pass
            self.server_socket = None

        # 自动删除防火墙规则
        if self._firewall_manager:
            print(f"[P2P服务器] 正在清理防火墙规则...")
            fw_success, fw_msg = self._firewall_manager.remove_rule()
            if not fw_success:
                print(f"[P2P服务器] 警告：{fw_msg}")
            else:
                print(f"[P2P服务器] {fw_msg}")

        print(f"[P2P服务器] ✓ 服务器已停止")
        return True, "服务器已停止"

    def _listen_for_connections(self):
        """监听连接"""
        while self.is_running:
            try:
                self.server_socket.settimeout(1.0)
                client_socket, address = self.server_socket.accept()
                print(f"收到来自 {address} 的连接")

                # 为每个客户端创建处理线程
                client_thread = threading.Thread(
                    target=self._handle_client,
                    args=(client_socket, address),
                    daemon=True
                )
                client_thread.start()
            except socket.timeout:
                continue
            except Exception as e:
                if self.is_running:
                    print(f"接受连接错误: {e}")
                break

    def _handle_client(self, client_socket: socket.socket, address):
        """处理客户端连接"""
        try:
            # 接收数据长度（4字节）
            length_data = self._receive_all(client_socket, 4)
            if not length_data:
                return

            data_length = struct.unpack('!I', length_data)[0]

            # 接收数据
            data_bytes = self._receive_all(client_socket, data_length)
            if not data_bytes:
                return

            # 解析JSON数据
            data = json.loads(data_bytes.decode('utf-8'))
            print(f"收到数据: {data.get('type', 'unknown')}")

            # 处理数据请求
            if data.get('type') == 'request_data':
                # 获取要共享的数据
                if self.on_data_request_callback:
                    shared_data = self.on_data_request_callback()
                    if shared_data:
                        # 发送共享的数据
                        self._send_data(client_socket, shared_data)
                        response = json.dumps({'status': 'success', 'message': '数据发送成功'})
                        self._send_response(client_socket, response)
                    else:
                        error_response = json.dumps({'status': 'error', 'message': '没有可共享的数据'})
                        self._send_response(client_socket, error_response)
                else:
                    error_response = json.dumps({'status': 'error', 'message': '数据请求回调未设置'})
                    self._send_response(client_socket, error_response)
            else:
                # 调用回调函数处理其他数据
                if self.on_data_received_callback:
                    self.on_data_received_callback(data, address)

                # 发送确认响应
                response = json.dumps({'status': 'success', 'message': '数据接收成功'})
                self._send_response(client_socket, response)

        except Exception as e:
            print(f"处理客户端错误: {e}")
            try:
                error_response = json.dumps({'status': 'error', 'message': str(e)})
                self._send_response(client_socket, error_response)
            except:
                pass
        finally:
            client_socket.close()

    def _receive_all(self, sock: socket.socket, length: int) -> Optional[bytes]:
        """接收指定长度的数据"""
        data = bytearray()
        while len(data) < length:
            chunk = sock.recv(length - len(data))
            if not chunk:
                return None
            data.extend(chunk)
        return bytes(data)

    def _send_data(self, sock: socket.socket, data: dict):
        """发送数据"""
        data_str = json.dumps(data, ensure_ascii=False)
        data_bytes = data_str.encode('utf-8')
        length_data = struct.pack('!I', len(data_bytes))
        sock.sendall(length_data + data_bytes)

    def _send_response(self, sock: socket.socket, response: str):
        """发送响应"""
        response_bytes = response.encode('utf-8')
        length_data = struct.pack('!I', len(response_bytes))
        sock.sendall(length_data + response_bytes)

    def get_local_ip(self) -> str:
        """获取本机IP地址"""
        try:
            # 连接到一个公网地址来获取本地IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except:
            return "127.0.0.1"

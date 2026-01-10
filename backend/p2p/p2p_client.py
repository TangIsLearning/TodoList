"""
P2P客户端模块 - 负责发现和接收共享数据
"""
import socket
import json
import struct
from typing import Optional, List, Tuple


class P2PClient:
    """P2P客户端，用于扫描局域网并接收共享数据"""

    def __init__(self):
        self.port = 5000

    def scan_devices(self, timeout: float = 3.0) -> List[Tuple[str, str]]:
        """扫描局域网内可用的设备

        Args:
            timeout: 扫描超时时间（秒）

        Returns:
            设备列表，每个设备为 (ip, hostname) 元组
        """
        import threading
        devices = []

        try:
            # 获取本机IP和网段
            local_ip = self._get_local_ip()
            if not local_ip or local_ip == "127.0.0.1":
                return devices

            # 解析网段（例如: 192.168.1.0/24）
            ip_parts = local_ip.split('.')
            network_base = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}"

            # 扫描网段内的设备
            threads = []
            results = []

            print(f"开始扫描网段: {network_base}.0/24, 本机IP: {local_ip}")

            for i in range(1, 255):
                target_ip = f"{network_base}.{i}"
                thread = threading.Thread(target=self._check_device, args=(target_ip, timeout, results, local_ip))
                thread.start()
                threads.append(thread)

            # 等待所有线程完成
            for thread in threads:
                thread.join()

            print(f"扫描完成，发现 {len(results)} 个设备")
            devices = [(ip, "TodoList设备") for ip in results]

        except Exception as e:
            print(f"扫描设备错误: {e}")
            import traceback
            traceback.print_exc()

        return devices

    def _check_device(self, ip: str, timeout: float, results: list, local_ip: str):
        """检查设备是否开放了P2P服务"""
        try:
            # 跳过本机IP
            if ip == local_ip:
                return

            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((ip, self.port))
            if result == 0:
                results.append(ip)
                print(f"发现设备: {ip}")
            sock.close()
        except:
            pass

    def get_local_ip(self) -> str:
        """获取本机IP地址"""
        return self._get_local_ip()

    def _get_local_ip(self) -> str:
        """获取本机IP地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except:
            return "127.0.0.1"

    def receive_data(self, ip: str, timeout: int = 30) -> Optional[dict]:
        """从指定设备接收数据

        Args:
            ip: 目标设备IP
            timeout: 超时时间（秒）

        Returns:
            接收到的数据字典，失败返回None
        """
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((ip, self.port))

            # 发送请求
            request = json.dumps({'type': 'request_data'})
            self._send_data(sock, request)

            # 接收数据长度
            length_data = self._receive_all(sock, 4)
            if not length_data:
                sock.close()
                return None

            data_length = struct.unpack('!I', length_data)[0]

            # 接收数据
            data_bytes = self._receive_all(sock, data_length)
            if not data_bytes:
                sock.close()
                return None

            # 解析数据
            data = json.loads(data_bytes.decode('utf-8'))

            # 接收响应确认
            response_length_data = self._receive_all(sock, 4)
            response_length = struct.unpack('!I', response_length_data)[0]
            response_data = self._receive_all(sock, response_length)
            response = json.loads(response_data.decode('utf-8'))

            sock.close()

            if response.get('status') == 'success':
                return data
            else:
                print(f"接收数据失败: {response.get('message')}")
                return None

        except Exception as e:
            print(f"接收数据错误: {e}")
            return None

    def _send_data(self, sock: socket.socket, data: str):
        """发送数据"""
        data_bytes = data.encode('utf-8')
        length_data = struct.pack('!I', len(data_bytes))
        sock.sendall(length_data + data_bytes)

    def _receive_all(self, sock: socket.socket, length: int) -> Optional[bytes]:
        """接收指定长度的数据"""
        data = bytearray()
        while len(data) < length:
            chunk = sock.recv(length - len(data))
            if not chunk:
                return None
            data.extend(chunk)
        return bytes(data)


import threading

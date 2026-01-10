"""
测试P2P设备扫描功能
"""

import sys
from pathlib import Path

# 添加backend目录到Python路径
backend_dir = Path(__file__).parent / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.p2p.p2p_client import P2PClient
from backend.p2p.p2p_server import P2PServer


def test_scan():
    """测试设备扫描"""
    print("="*60)
    print("测试P2P设备扫描")
    print("="*60)

    # 1. 先启动一个测试服务器
    print("\n1. 启动测试服务器...")
    server = P2PServer(port=5000)

    def callback(data, address):
        print(f"服务器收到来自 {address} 的连接")

    if server.start(callback):
        print(f"✓ 服务器启动成功")
        local_ip = server.get_local_ip()
        print(f"  本机IP: {local_ip}")
        print(f"  监听端口: {server.port}")
    else:
        print("✗ 服务器启动失败")
        return

    # 2. 创建客户端扫描设备
    print("\n2. 创建客户端并扫描设备...")
    client = P2PClient()

    import time
    print("等待服务器完全启动...")
    time.sleep(1)

    print("\n开始扫描（超时3秒）...")
    devices = client.scan_devices(timeout=3.0)

    print(f"\n扫描结果:")
    print("-"*60)
    if devices:
        for i, (ip, hostname) in enumerate(devices, 1):
            print(f"{i}. {hostname} - {ip}")
        print(f"\n共发现 {len(devices)} 个设备")
    else:
        print("未发现任何设备")
        print("注意：这是正常的，因为只扫描到本机IP已被过滤")

    print("-"*60)

    # 3. 测试连接自己的服务器（这应该被过滤）
    print("\n3. 测试是否过滤本机IP...")
    print(f"本机IP: {local_ip}")
    print(f"扫描结果中是否包含本机IP: {local_ip in [ip for ip, _ in devices]}")

    # 4. 清理
    print("\n4. 停止服务器...")
    server.stop()
    print("✓ 服务器已停止")

    print("\n" + "="*60)
    print("测试完成！")
    print("="*60)

    print("\n说明：")
    print("- 在单台设备上测试时，不会发现其他设备")
    print("- 需要在另一台设备上同时运行此应用")
    print("- 两台设备必须在同一局域网内")
    print("- 目标设备必须先启动数据共享功能")


if __name__ == '__main__':
    test_scan()

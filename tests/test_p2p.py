"""
P2P数据传输功能测试脚本
"""

import sys
from pathlib import Path

# 添加backend目录到Python路径
backend_dir = Path(__file__).parent / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

def test_data_manager():
    """测试数据管理器"""
    print("测试数据管理器...")
    try:
        from backend.p2p.data_manager import DataManager

        dm = DataManager()

        # 测试导出数据
        print("导出数据...")
        data = dm.export_data()
        if data:
            print(f"导出成功: {len(data['tasks'])} 个任务, {len(data['categories'])} 个分类")

            # 测试数据摘要
            summary = dm.get_data_summary()
            print(f"数据摘要: {summary}")

            # 测试是否有数据
            has_data = dm.has_data()
            print(f"有数据: {has_data}")
        else:
            print("导出失败")

    except Exception as e:
        print(f"数据管理器测试失败: {e}")
        import traceback
        traceback.print_exc()

def test_p2p_server():
    """测试P2P服务器"""
    print("\n测试P2P服务器...")
    try:
        from backend.p2p.p2p_server import P2PServer

        server = P2PServer(port=5000)

        def callback(data, address):
            print(f"接收到来自 {address} 的数据: {data.get('type', 'unknown')}")

        if server.start(callback):
            print("服务器启动成功")
            print(f"本地IP: {server.get_local_ip()}")
            print(f"端口: {server.port}")

            # 等待5秒后停止
            import time
            print("服务器运行5秒...")
            time.sleep(5)

            server.stop()
            print("服务器已停止")
        else:
            print("服务器启动失败")

    except Exception as e:
        print(f"P2P服务器测试失败: {e}")
        import traceback
        traceback.print_exc()

def test_p2p_client():
    """测试P2P客户端"""
    print("\n测试P2P客户端...")
    try:
        from backend.p2p.p2p_client import P2PClient

        client = P2PClient()
        local_ip = client.get_local_ip()
        print(f"本地IP: {local_ip}")

        # 扫描设备（不等待，因为可能没有其他设备）
        print("扫描设备（超时时间1秒）...")
        import time
        start_time = time.time()
        devices = client.scan_devices(timeout=1.0)
        end_time = time.time()

        print(f"扫描完成，耗时 {end_time - start_time:.2f} 秒")
        print(f"发现 {len(devices)} 个设备")
        for ip, name in devices:
            print(f"  - {name}: {ip}")

    except Exception as e:
        print(f"P2P客户端测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    print("P2P功能测试\n" + "="*50)

    # 测试数据管理器
    test_data_manager()

    # 测试P2P服务器
    test_p2p_server()

    # 测试P2P客户端
    test_p2p_client()

    print("\n测试完成！")

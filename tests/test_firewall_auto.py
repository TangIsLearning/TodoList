"""
测试P2P服务器自动防火墙管理功能
"""

import sys
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.p2p.p2p_server import P2PServer
from backend.p2p.firewall_manager import FirewallManager, is_admin


def test_firewall_manager():
    """测试防火墙管理器"""
    print("=" * 70)
    print("测试1: 防火墙管理器")
    print("=" * 70)

    print(f"\n当前用户权限: {'管理员' if is_admin() else '普通用户'}")

    # 创建防火墙管理器
    fw = FirewallManager(port=5353)

    # 获取规则信息
    print("\n[1.1] 获取防火墙规则信息...")
    info = fw.get_rule_info()
    for key, value in info.items():
        print(f"  {key}: {value}")

    # 检查规则是否存在
    print("\n[1.2] 检查规则是否存在...")
    exists = fw.is_rule_exists()
    print(f"  规则存在: {exists}")

    # 测试添加规则
    print("\n[1.3] 测试添加防火墙规则...")
    success, message = fw.add_rule()
    print(f"  成功: {success}")
    print(f"  消息: {message}")

    # 再次检查
    print("\n[1.4] 添加后再次检查规则...")
    exists = fw.is_rule_exists()
    print(f"  规则存在: {exists}")

    return fw


def test_server_with_firewall():
    """测试带防火墙管理的P2P服务器"""
    print("\n" + "=" * 70)
    print("测试2: P2P服务器（自动防火墙管理）")
    print("=" * 70)

    # 创建服务器（默认启用防火墙自动管理）
    print("\n[2.1] 创建P2P服务器...")
    server = P2PServer(port=5353, auto_manage_firewall=True)

    # 设置数据请求回调
    def data_callback():
        return {
            'version': '1.0',
            'tasks': [],
            'categories': [],
            'settings': {}
        }

    server.set_data_request_callback(data_callback)

    # 启动服务器
    print("\n[2.2] 启动服务器（会自动添加防火墙规则）...")
    success, message = server.start(data_callback)

    print(f"\n  成功: {success}")
    print(f"  消息: {message}")

    if success:
        print(f"\n  服务器状态: 运行中")
        print(f"  监听地址: 0.0.0.0:{server.port}")
        print(f"  本地IP: {server.get_local_ip()}")

        # 检查防火墙规则
        print("\n[2.3] 检查防火墙规则状态...")
        fw = FirewallManager(port=5353)
        info = fw.get_rule_info()
        print(f"  规则存在: {info['exists']}")
        print(f"  规则信息: {info['message']}")

        # 等待用户输入
        input("\n按 Enter 键停止服务器（会自动删除防火墙规则）...")

        # 停止服务器
        print("\n[2.4] 停止服务器（会自动删除防火墙规则）...")
        success, message = server.stop()
        print(f"\n  成功: {success}")
        print(f"  消息: {message}")

        # 检查防火墙规则
        print("\n[2.5] 检查防火墙规则状态...")
        info = fw.get_rule_info()
        print(f"  规则存在: {info['exists']}")
        print(f"  规则信息: {info['message']}")


def test_server_without_firewall():
    """测试不带防火墙管理的P2P服务器"""
    print("\n" + "=" * 70)
    print("测试3: P2P服务器（禁用防火墙自动管理）")
    print("=" * 70)

    # 创建服务器（禁用防火墙自动管理）
    print("\n[3.1] 创建P2P服务器（禁用防火墙管理）...")
    server = P2PServer(port=5353, auto_manage_firewall=False)

    # 启动服务器
    print("\n[3.2] 启动服务器...")
    success, message = server.start()
    print(f"\n  成功: {success}")
    print(f"  消息: {message}")

    if success:
        input("\n按 Enter 键停止服务器...")
        success, message = server.stop()
        print(f"\n  成功: {success}")
        print(f"  消息: {message}")


def test_firewall_cleanup():
    """测试防火墙规则清理"""
    print("\n" + "=" * 70)
    print("测试4: 清理防火墙规则")
    print("=" * 70)

    fw = FirewallManager(port=5353)

    print("\n[4.1] 检查并删除防火墙规则...")
    success, message = fw.remove_rule()
    print(f"  成功: {success}")
    print(f"  消息: {message}")

    print("\n[4.2] 确认规则已删除...")
    exists = fw.is_rule_exists()
    print(f"  规则存在: {exists}")


def main():
    print("\n" + "=" * 70)
    print("P2P服务器防火墙自动管理功能测试")
    print("=" * 70)

    try:
        # 测试防火墙管理器
        fw_manager = test_firewall_manager()

        # 测试带防火墙管理的服务器
        test_server_with_firewall()

        # 测试不带防火墙管理的服务器
        test_server_without_firewall()

        # 清理防火墙规则
        test_firewall_cleanup()

        print("\n" + "=" * 70)
        print("所有测试完成")
        print("=" * 70)

    except KeyboardInterrupt:
        print("\n\n测试被用户中断")

        # 确保清理防火墙规则
        print("\n清理防火墙规则...")
        fw = FirewallManager(port=5353)
        fw.remove_rule()

    except Exception as e:
        print(f"\n测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()

        # 确保清理防火墙规则
        print("\n清理防火墙规则...")
        fw = FirewallManager(port=5353)
        fw.remove_rule()


if __name__ == "__main__":
    main()

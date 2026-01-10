"""
防火墙权限问题修复测试脚本
用于验证防火墙自动配置是否正常工作
"""

import sys
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.p2p.firewall_manager import FirewallManager, is_admin


def test_admin_detection():
    """测试管理员权限检测"""
    print("=" * 70)
    print("测试1: 管理员权限检测")
    print("=" * 70)

    admin = is_admin()
    print(f"\n当前用户权限: {'管理员 ✓' if admin else '普通用户 ✗'}")

    if admin:
        print("\n当前以管理员身份运行，防火墙配置应该无需UAC提示")
    else:
        print("\n当前以普通用户身份运行，将尝试通过UAC提升权限")
        print("\n提示：如果看到UAC提示框，请点击'是'按钮")

    return admin


def test_firewall_manager():
    """测试防火墙管理器"""
    print("\n" + "=" * 70)
    print("测试2: 防火墙管理器功能")
    print("=" * 70)

    fw = FirewallManager(port=5353)

    # 获取规则信息
    print("\n[2.1] 获取防火墙规则信息...")
    info = fw.get_rule_info()
    print(f"  规则存在: {'是' if info['exists'] else '否'}")
    print(f"  可以管理: {'是' if info['can_manage'] else '否'}")
    print(f"  消息: {info['message']}")

    # 测试添加规则
    print("\n[2.2] 测试添加防火墙规则...")
    print("\n重要提示：")
    print("1. 如果看到UAC提示框，请点击'是'")
    print("2. 如果UAC提示框没有出现，可能已有管理员权限")
    print("3. 等待5-10秒让批处理文件执行完成\n")

    input("按 Enter 键继续...")

    success, message = fw.add_rule()
    print(f"\n结果: {'成功 ✓' if success else '失败 ✗'}")
    print(f"消息: {message}")

    if success:
        # 再次检查规则信息
        print("\n[2.3] 验证防火墙规则...")
        info = fw.get_rule_info()
        print(f"  规则存在: {'是' if info['exists'] else '否'}")

        if info['exists']:
            print("\n✓ 防火墙规则配置成功！")
            print(f"  端口: {fw.port}/TCP")
            print(f"  规则名称: {fw.rule_name}")

            # 询问是否删除规则
            print("\n" + "=" * 70)
            confirm = input("是否要删除防火墙规则？(y/n): ").lower()

            if confirm == 'y':
                print("\n[2.4] 测试删除防火墙规则...")
                print("\n重要提示：")
                print("1. 如果看到UAC提示框，请点击'是'")
                print("2. 等待5-10秒让批处理文件执行完成\n")

                input("按 Enter 键继续...")

                success, message = fw.remove_rule()
                print(f"\n结果: {'成功 ✓' if success else '失败 ✗'}")
                print(f"消息: {message}")

                if success:
                    print("\n[2.5] 验证防火墙规则已删除...")
                    info = fw.get_rule_info()
                    print(f"  规则存在: {'是' if info['exists'] else '否'}")

                    if not info['exists']:
                        print("\n✓ 防火墙规则已成功删除！")
        else:
            print("\n✗ 防火墙规则未添加成功")
            print("\n可能的原因：")
            print("1. 用户在UAC提示框中点击了'否'")
            print("2. 防火墙服务未运行")
            print("3. 批处理文件执行失败")
            print("\n建议：")
            print("1. 检查Windows防火墙服务是否正常运行")
            print("2. 以管理员身份运行此脚本")
            print("3. 手动运行批处理脚本：setup_firewall.bat")
    else:
        print("\n✗ 防火墙规则添加失败")
        print("\n错误信息:", message)
        print("\n建议：")
        print("1. 以管理员身份运行应用")
        print("2. 手动运行批处理脚本：setup_firewall.bat")
        print("3. 手动执行命令：")
        print('   netsh advfirewall firewall add rule name="TodoList P2P Server" dir=in action=allow protocol=TCP localport=5353')


def test_manual_check():
    """手动检查防火墙规则"""
    print("\n" + "=" * 70)
    print("测试3: 手动检查防火墙规则")
    print("=" * 70)

    import subprocess

    print("\n正在查询防火墙规则...")
    cmd = 'netsh advfirewall firewall show rule name="TodoList P2P Server"'

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0 and "找不到规则" not in result.stdout:
            print("\n✓ 防火墙规则存在")
            print("\n规则详情：")
            print(result.stdout)
        else:
            print("\n✗ 防火墙规则不存在")
            print("\n如需添加防火墙规则，请：")
            print("1. 运行批处理脚本：setup_firewall.bat")
            print("2. 或手动执行命令：")
            print('   netsh advfirewall firewall add rule name="TodoList P2P Server" dir=in action=allow protocol=TCP localport=5353')

    except Exception as e:
        print(f"\n查询失败: {e}")


def main():
    print("\n" + "=" * 70)
    print("防火墙权限问题修复 - 测试脚本")
    print("=" * 70)
    print("\n此脚本用于测试防火墙自动配置功能")
    print("如果遇到权限问题，将尝试通过UAC提升权限\n")

    try:
        # 测试1: 管理员权限检测
        is_admin_user = test_admin_detection()

        # 测试2: 防火墙管理器功能
        test_firewall_manager()

        # 测试3: 手动检查
        test_manual_check()

        print("\n" + "=" * 70)
        print("测试完成")
        print("=" * 70)

        print("\n总结：")
        print("- 如果防火墙规则添加成功，说明UAC提升功能正常")
        print("- 如果失败，请尝试以管理员身份运行应用")
        print("- 或使用批处理脚本：setup_firewall.bat")
        print("\n按 Enter 键退出...")
        input()

    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
    except Exception as e:
        print(f"\n测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()
        input("\n按 Enter 键退出...")


if __name__ == "__main__":
    main()

"""
Windows防火墙管理模块
用于自动添加/删除P2P服务所需的防火墙规则
"""
import platform
import subprocess
import os
from typing import Tuple


class FirewallManager:
    """Windows防火墙管理器"""

    def __init__(self, rule_name: str = "TodoList P2P Server", port: int = 5353):
        """初始化防火墙管理器

        Args:
            rule_name: 防火墙规则名称
            port: 需要开放的端口号
        """
        self.rule_name = rule_name
        self.port = port
        self.is_windows = platform.system() == "Windows"

    def is_rule_exists(self) -> bool:
        """检查防火墙规则是否已存在

        Returns:
            True表示规则已存在，False表示不存在
        """
        if not self.is_windows:
            return False

        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            # 使用netsh命令检查规则是否存在
            cmd = f'netsh advfirewall firewall show rule name="{self.rule_name}"'
            result = subprocess.run(
                cmd,
                startupinfo=startupinfo,
                shell=True,
                capture_output=True,
                text=True,
                timeout=5
            )

            # 如果返回包含"找不到规则"说明不存在
            return "找不到规则" not in result.stdout and result.returncode == 0

        except Exception as e:
            print(f"[防火墙] 检查规则失败: {e}")
            return False

    def add_rule(self) -> Tuple[bool, str]:
        """添加防火墙入站规则

        Returns:
            (success, message) 元组，success表示是否成功，message为详细信息
        """
        if not self.is_windows:
            return True, "非Windows系统，无需配置防火墙"

        # 检查规则是否已存在
        if self.is_rule_exists():
            print(f"[防火墙] 规则已存在: {self.rule_name}")
            return True, "防火墙规则已存在"

        # 检查是否有管理员权限
        if not is_admin():
            print(f"[防火墙] ⚠ 当前用户权限不足，尝试以管理员权限执行...")
            return self._add_rule_with_admin()

        try:
            # 构建netsh命令
            cmd = (
                f'netsh advfirewall firewall add rule '
                f'name="{self.rule_name}" '
                f'dir=in action=allow protocol=TCP localport={self.port} '
                f'description="TodoList P2P数据传输服务" '
                f'profile=any'
            )

            print(f"[防火墙] 正在添加防火墙规则...")
            print(f"[防火墙] 命令: {cmd}")

            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            result = subprocess.run(
                cmd,
                startupinfo=startupinfo,
                shell=True,
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                print(f"[防火墙] ✓ 防火墙规则添加成功")
                print(f"[防火墙] 规则名称: {self.rule_name}")
                print(f"[防火墙] 开放端口: {self.port}/TCP")
                return True, "防火墙规则添加成功"
            else:
                error_msg = result.stderr.strip() if result.stderr else "未知错误"
                print(f"[防火墙] ✗ 添加防火墙规则失败: {error_msg}")
                return False, f"添加防火墙规则失败: {error_msg}"

        except subprocess.TimeoutExpired:
            error_msg = "添加防火墙规则超时，请检查系统权限"
            print(f"[防火墙] ✗ {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = f"添加防火墙规则时发生异常: {str(e)}"
            print(f"[防火墙] ✗ {error_msg}")
            return False, error_msg

    def _add_rule_with_admin(self) -> Tuple[bool, str]:
        """以管理员权限添加防火墙规则

        Returns:
            (success, message) 元组
        """
        try:
            # 构建netsh命令
            cmd = (
                f'netsh advfirewall firewall add rule '
                f'name="{self.rule_name}" '
                f'dir=in action=allow protocol=TCP localport={self.port} '
                f'description="TodoList P2P数据传输服务" '
                f'profile=any'
            )

            print(f"[防火墙] ⚠ 当前用户权限不足")
            print(f"[防火墙] 正在创建临时批处理文件...")

            # 创建临时批处理文件
            import tempfile
            import uuid

            bat_filename = f"todo_firewall_add_{uuid.uuid4().hex[:8]}.bat"
            bat_path = os.path.join(tempfile.gettempdir(), bat_filename)

            # 写入批处理内容
            bat_content = f'''@echo off
chcp 65001 >nul 2>&1
echo 正在添加防火墙规则...
{cmd}
if errorlevel 1 (
    echo 防火墙规则添加失败
    pause
    exit /b 1
) else (
    echo 防火墙规则添加成功
)
echo 规则已添加，此窗口将在3秒后关闭...
timeout /t 3 /nobreak >nul
exit /b 0
'''

            with open(bat_path, 'w', encoding='gbk') as f:
                f.write(bat_content)

            print(f"[防火墙] 临时文件: {bat_path}")

            # 使用ShellExecute以管理员身份运行批处理文件
            import ctypes
            from ctypes import wintypes

            ShellExecute = ctypes.windll.shell32.ShellExecuteW
            ShellExecute.argtypes = [
                wintypes.HWND,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.INT
            ]
            ShellExecute.restype = wintypes.HINSTANCE

            print(f"[防火墙] 正在请求管理员权限...")
            print(f"[防火墙] 请在弹出的UAC提示框中点击'是'")

            # 使用runas动词请求管理员权限
            result = ShellExecute(
                None,
                "runas",
                bat_path,
                None,
                None,
                0  # SW_HIDE
            )

            if result > 32:
                # ShellExecute成功，等待批处理执行完成
                import time
                print(f"[防火墙] 正在等待防火墙规则配置完成...")
                time.sleep(5)  # 等待5秒给用户时间响应UAC

                # 检查规则是否添加成功
                if self.is_rule_exists():
                    print(f"[防火墙] ✓ 防火墙规则添加成功")
                    print(f"[防火墙] 规则名称: {self.rule_name}")
                    print(f"[防火墙] 开放端口: {self.port}/TCP")
                    return True, "防火墙规则添加成功"
                else:
                    # 规则未添加成功
                    print(f"[防火墙] ✗ 防火墙规则未添加")
                    error_msg = (
                        "防火墙规则添加失败\n\n"
                        "可能的原因：\n"
                        "1. 用户在UAC提示框中点击了'否'\n"
                        "2. 防火墙服务未运行\n"
                        "3. 端口被占用\n\n"
                        "建议：\n"
                        "1. 以管理员身份运行应用\n"
                        "2. 或使用批处理脚本 setup_firewall.bat\n"
                        "3. 或手动执行命令：\n"
                        f'   {cmd}'
                    )
                    return False, error_msg
            else:
                # ShellExecute失败
                print(f"[防火墙] ✗ 无法请求管理员权限（错误代码: {result}）")
                error_msg = (
                    "无法请求管理员权限\n\n"
                    "请尝试以下方法：\n"
                    "1. 以管理员身份运行应用（右键→以管理员身份运行）\n"
                    "2. 运行批处理脚本：setup_firewall.bat\n"
                    "3. 手动执行命令：\n"
                    f'   {cmd}'
                )
                return False, error_msg

        except Exception as e:
            print(f"[防火墙] ✗ 提升权限失败: {e}")
            import traceback
            traceback.print_exc()

            error_msg = (
                f"防火墙配置失败：{str(e)}\n\n"
                "建议：\n"
                "1. 以管理员身份运行应用\n"
                "2. 运行批处理脚本：setup_firewall.bat\n"
                "3. 手动配置防火墙"
            )
            return False, error_msg
        finally:
            # 清理临时文件
            try:
                if 'bat_path' in locals() and os.path.exists(bat_path):
                    # 延迟删除，确保批处理文件有机会执行
                    import threading
                    def cleanup_file():
                        import time
                        time.sleep(2)
                        try:
                            os.remove(bat_path)
                        except:
                            pass
                    threading.Thread(target=cleanup_file, daemon=True).start()
            except:
                pass

    def remove_rule(self) -> Tuple[bool, str]:
        """删除防火墙入站规则

        Returns:
            (success, message) 元组，success表示是否成功，message为详细信息
        """
        if not self.is_windows:
            return True, "非Windows系统，无需操作防火墙"

        # 检查规则是否存在
        if not self.is_rule_exists():
            print(f"[防火墙] 防火墙规则不存在: {self.rule_name}")
            return True, "防火墙规则不存在，无需删除"

        # 检查是否有管理员权限
        if not is_admin():
            print(f"[防火墙] ⚠ 当前用户权限不足，尝试以管理员权限执行...")
            return self._remove_rule_with_admin()

        try:
            # 构建netsh命令
            cmd = f'netsh advfirewall firewall delete rule name="{self.rule_name}"'

            print(f"[防火墙] 正在删除防火墙规则...")
            print(f"[防火墙] 命令: {cmd}")

            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            result = subprocess.run(
                cmd,
                startupinfo=startupinfo,
                shell=True,
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                print(f"[防火墙] ✓ 防火墙规则删除成功")
                return True, "防火墙规则删除成功"
            else:
                error_msg = result.stderr.strip() if result.stderr else "未知错误"
                print(f"[防火墙] ✗ 删除防火墙规则失败: {error_msg}")
                # 即使删除失败，如果规则不存在也视为成功
                if not self.is_rule_exists():
                    print(f"[防火墙] ✓ 防火墙规则已不存在，视为删除成功")
                    return True, "防火墙规则删除成功"
                return False, f"删除防火墙规则失败: {error_msg}"

        except subprocess.TimeoutExpired:
            error_msg = "删除防火墙规则超时，请检查系统权限"
            print(f"[防火墙] ✗ {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = f"删除防火墙规则时发生异常: {str(e)}"
            print(f"[防火墙] ✗ {error_msg}")
            return False, error_msg

    def _remove_rule_with_admin(self) -> Tuple[bool, str]:
        """以管理员权限删除防火墙规则

        Returns:
            (success, message) 元组
        """
        try:
            # 构建netsh命令
            cmd = f'netsh advfirewall firewall delete rule name="{self.rule_name}"'

            print(f"[防火墙] ⚠ 当前用户权限不足")
            print(f"[防火墙] 正在创建临时批处理文件...")

            # 创建临时批处理文件
            import tempfile
            import uuid

            bat_filename = f"todo_firewall_remove_{uuid.uuid4().hex[:8]}.bat"
            bat_path = os.path.join(tempfile.gettempdir(), bat_filename)

            # 写入批处理内容
            bat_content = f'''@echo off
chcp 65001 >nul 2>&1
echo 正在删除防火墙规则...
{cmd}
if errorlevel 1 (
    echo 防火墙规则删除失败
    pause
    exit /b 1
) else (
    echo 防火墙规则删除成功
)
echo 规则已删除，此窗口将在2秒后关闭...
timeout /t 2 /nobreak >nul
exit /b 0
'''

            with open(bat_path, 'w', encoding='gbk') as f:
                f.write(bat_content)

            print(f"[防火墙] 临时文件: {bat_path}")

            # 使用ShellExecute以管理员身份运行批处理文件
            import ctypes
            from ctypes import wintypes

            ShellExecute = ctypes.windll.shell32.ShellExecuteW
            ShellExecute.argtypes = [
                wintypes.HWND,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.LPCWSTR,
                wintypes.INT
            ]
            ShellExecute.restype = wintypes.HINSTANCE

            print(f"[防火墙] 正在请求管理员权限...")
            print(f"[防火墙] 请在弹出的UAC提示框中点击'是'")

            # 使用runas动词请求管理员权限
            result = ShellExecute(
                None,
                "runas",
                bat_path,
                None,
                None,
                0  # SW_HIDE
            )

            if result > 32:
                # ShellExecute成功，等待批处理执行完成
                import time
                print(f"[防火墙] 正在等待防火墙规则删除...")
                time.sleep(4)  # 等待4秒给用户时间响应UAC

                # 检查规则是否删除成功
                if not self.is_rule_exists():
                    print(f"[防火墙] ✓ 防火墙规则删除成功")
                    return True, "防火墙规则删除成功"
                else:
                    # 规则仍然存在
                    print(f"[防火墙] ✗ 防火墙规则仍然存在")
                    error_msg = (
                        "防火墙规则删除失败\n\n"
                        "可能的原因：\n"
                        "1. 用户在UAC提示框中点击了'否'\n"
                        "2. 规则已被其他程序锁定\n\n"
                        "建议：\n"
                        "1. 检查防火墙设置\n"
                        "2. 运行批处理脚本：remove_firewall.bat\n"
                        "3. 手动执行命令：\n"
                        f'   {cmd}'
                    )
                    return False, error_msg
            else:
                # ShellExecute失败
                print(f"[防火墙] ✗ 无法请求管理员权限（错误代码: {result}）")
                error_msg = (
                    "无法请求管理员权限\n\n"
                    "请尝试以下方法：\n"
                    "1. 以管理员身份运行应用（右键→以管理员身份运行）\n"
                    "2. 运行批处理脚本：remove_firewall.bat\n"
                    "3. 手动执行命令：\n"
                    f'   {cmd}'
                )
                return False, error_msg

        except Exception as e:
            print(f"[防火墙] ✗ 提升权限失败: {e}")
            import traceback
            traceback.print_exc()

            error_msg = (
                f"防火墙配置失败：{str(e)}\n\n"
                "建议：\n"
                "1. 以管理员身份运行应用\n"
                "2. 运行批处理脚本：remove_firewall.bat\n"
                "3. 手动配置防火墙"
            )
            return False, error_msg
        finally:
            # 清理临时文件
            try:
                if 'bat_path' in locals() and os.path.exists(bat_path):
                    # 延迟删除，确保批处理文件有机会执行
                    import threading
                    def cleanup_file():
                        import time
                        time.sleep(3)
                        try:
                            os.remove(bat_path)
                        except:
                            pass
                    threading.Thread(target=cleanup_file, daemon=True).start()
            except:
                pass

    def get_rule_info(self) -> dict:
        """获取防火墙规则信息

        Returns:
            包含规则详细信息的字典
        """
        info = {
            "rule_name": self.rule_name,
            "port": self.port,
            "is_windows": self.is_windows,
            "exists": False,
            "can_manage": False
        }

        if not self.is_windows:
            info["message"] = "非Windows系统"
            return info

        # 检查是否可以执行netsh命令
        try:
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            result = subprocess.run(
                'netsh advfirewall show allprofiles',
                startupinfo=startupinfo,
                shell=True,
                capture_output=True,
                text=True,
                timeout=5
            )
            info["can_manage"] = result.returncode == 0

        except:
            info["can_manage"] = False

        # 检查规则是否存在
        info["exists"] = self.is_rule_exists()

        if info["exists"]:
            info["message"] = f"防火墙规则已存在，端口 {self.port}/TCP 已开放"
        elif not info["can_manage"]:
            info["message"] = "当前用户权限不足，无法管理防火墙规则"
        else:
            info["message"] = f"防火墙规则不存在，需要手动添加或以管理员权限运行"

        return info


def is_admin() -> bool:
    """检查当前是否具有管理员权限（仅Windows）

    Returns:
        True表示有管理员权限，False表示没有
    """
    if platform.system() != "Windows":
        return True  # 非Windows系统默认返回True

    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False


if __name__ == "__main__":
    """测试防火墙管理器"""
    print("=" * 60)
    print("防火墙管理器测试")
    print("=" * 60)

    # 检查管理员权限
    print(f"\n当前用户权限: {'管理员' if is_admin() else '普通用户'}")

    # 创建防火墙管理器
    fw_manager = FirewallManager(port=5353)

    # 获取规则信息
    info = fw_manager.get_rule_info()
    print(f"\n规则信息:")
    for key, value in info.items():
        print(f"  {key}: {value}")

    # 测试添加规则
    print(f"\n测试添加规则...")
    success, message = fw_manager.add_rule()
    print(f"结果: {success}, {message}")

    # 再次检查规则信息
    info = fw_manager.get_rule_info()
    print(f"\n添加后的规则信息:")
    for key, value in info.items():
        print(f"  {key}: {value}")

    # 等待用户确认
    input("\n按 Enter 键继续删除规则...")

    # 测试删除规则
    print(f"\n测试删除规则...")
    success, message = fw_manager.remove_rule()
    print(f"结果: {success}, {message}")

    # 再次检查规则信息
    info = fw_manager.get_rule_info()
    print(f"\n删除后的规则信息:")
    for key, value in info.items():
        print(f"  {key}: {value}")

    print("\n测试完成")

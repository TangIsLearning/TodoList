# impl/desktop/win_impl.py
from backend.platforms.interface.service import PlatformService

import subprocess
import os
from typing import Tuple
from pathlib import Path
from backend.config_manager import get_config_manager

class FirewallManager:
    """Windows防火墙管理器：用于自动添加/删除P2P服务所需的防火墙规则"""

    def __init__(self, rule_name: str = "TodoList P2P Server", port: int = 5353):
        """初始化防火墙管理器

        Args:
            rule_name: 防火墙规则名称
            port: 需要开放的端口号
        """
        self.rule_name = rule_name
        self.port = port

    def is_rule_exists(self) -> bool:
        """检查防火墙规则是否已存在

        Returns:
            True表示规则已存在，False表示不存在
        """
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
                encoding='utf-8',
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
        # 检查规则是否已存在
        if self.is_rule_exists():
            print(f"[防火墙] 规则已存在: {self.rule_name}")
            return True, "防火墙规则已存在"

        # 检查是否有管理员权限
        if not is_admin():
            print(f"[防火墙] [WARN] 当前用户权限不足，尝试以管理员权限执行...")
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
                encoding='utf-8',
                timeout=10
            )

            if result.returncode == 0:
                print(f"[防火墙] [OK] 防火墙规则添加成功")
                print(f"[防火墙] 规则名称: {self.rule_name}")
                print(f"[防火墙] 开放端口: {self.port}/TCP")
                return True, "防火墙规则添加成功"
            else:
                error_msg = result.stderr.strip() if result.stderr else "未知错误"
                print(f"[防火墙] [FAIL] 添加防火墙规则失败: {error_msg}")
                return False, f"添加防火墙规则失败: {error_msg}"

        except subprocess.TimeoutExpired:
            error_msg = "添加防火墙规则超时，请检查系统权限"
            print(f"[防火墙] [FAIL] {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = f"添加防火墙规则时发生异常: {str(e)}"
            print(f"[防火墙] [FAIL] {error_msg}")
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

            print(f"[防火墙] [WARN] 当前用户权限不足")
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

            with open(bat_path, 'w', encoding='utf-8') as f:
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
                    print(f"[防火墙] [OK] 防火墙规则添加成功")
                    print(f"[防火墙] 规则名称: {self.rule_name}")
                    print(f"[防火墙] 开放端口: {self.port}/TCP")
                    return True, "防火墙规则添加成功"
                else:
                    # 规则未添加成功
                    print(f"[防火墙] [FAIL] 防火墙规则未添加")
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
                print(f"[防火墙] [FAIL] 无法请求管理员权限（错误代码: {result}）")
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
            print(f"[防火墙] [FAIL] 提升权限失败: {e}")
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
        # 检查规则是否存在
        if not self.is_rule_exists():
            print(f"[防火墙] 防火墙规则不存在: {self.rule_name}")
            return True, "防火墙规则不存在，无需删除"

        # 检查是否有管理员权限
        if not is_admin():
            print(f"[防火墙] [WARN] 当前用户权限不足，尝试以管理员权限执行...")
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
                encoding='utf-8',
                timeout=10
            )

            if result.returncode == 0:
                print(f"[防火墙] [OK] 防火墙规则删除成功")
                return True, "防火墙规则删除成功"
            else:
                error_msg = result.stderr.strip() if result.stderr else "未知错误"
                print(f"[防火墙] [FAIL] 删除防火墙规则失败: {error_msg}")
                # 即使删除失败，如果规则不存在也视为成功
                if not self.is_rule_exists():
                    print(f"[防火墙] [OK] 防火墙规则已不存在，视为删除成功")
                    return True, "防火墙规则删除成功"
                return False, f"删除防火墙规则失败: {error_msg}"

        except subprocess.TimeoutExpired:
            error_msg = "删除防火墙规则超时，请检查系统权限"
            print(f"[防火墙] [FAIL] {error_msg}")
            return False, error_msg
        except Exception as e:
            error_msg = f"删除防火墙规则时发生异常: {str(e)}"
            print(f"[防火墙] [FAIL] {error_msg}")
            return False, error_msg

    def _remove_rule_with_admin(self) -> Tuple[bool, str]:
        """以管理员权限删除防火墙规则

        Returns:
            (success, message) 元组
        """
        try:
            # 构建netsh命令
            cmd = f'netsh advfirewall firewall delete rule name="{self.rule_name}"'

            print(f"[防火墙] [WARN] 当前用户权限不足")
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

            with open(bat_path, 'w', encoding='utf-8') as f:
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
                    print(f"[防火墙] [OK] 防火墙规则删除成功")
                    return True, "防火墙规则删除成功"
                else:
                    # 规则仍然存在
                    print(f"[防火墙] [FAIL] 防火墙规则仍然存在")
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
                print(f"[防火墙] [FAIL] 无法请求管理员权限（错误代码: {result}）")
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
            print(f"[防火墙] [FAIL] 提升权限失败: {e}")
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
            "is_windows": True,
            "exists": False,
            "can_manage": False
        }

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
                encoding='utf-8',
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
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False

def enable_windows_auto_start(app_name) -> bool:
    """启用开机自启动"""
    from backend.utils import utils
    app_path = utils.get_app_path()

    try:
        import winreg

        # 启动命令
        launch_cmd = utils.get_launch_command()

        # 注册表路径
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

        # 打开注册表键
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
            # 设置注册表值
            winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, launch_cmd)

        print(f"Windows开机自启动已启用: {launch_cmd}")
        return True

    except ImportError:
        # 备用方案：使用启动文件夹
        startup_folder = Path(
            os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'
        startup_folder.mkdir(parents=True, exist_ok=True)

        # 创建快捷方式
        shortcut_path = startup_folder / f"{app_name}.lnk"

        # 使用Python创建快捷方式
        import pythoncom
        from win32com.client import Dispatch

        shell = Dispatch('WScript.Shell')
        shortcut = shell.CreateShortcut(str(shortcut_path))
        shortcut.Targetpath = app_path
        shortcut.WorkingDirectory = str(Path(app_path).parent)

        shortcut.save()

        print(f"Windows启动文件夹快捷方式已创建: {shortcut_path}")

        return True
    except Exception as e:
        print(f"启用开机自启动失败: {e}")
        return False

def disable_windows_auto_start(app_name) -> bool:
    """禁用开机自启动"""
    try:
        import winreg

        # 注册表路径
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

        # 尝试删除注册表项
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                winreg.DeleteValue(key, app_name)
        except FileNotFoundError:
            # 注册表项不存在，继续检查启动文件夹
            pass

        # 删除启动文件夹中的快捷方式和批处理文件
        startup_folder = Path(
            os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'

        # 删除快捷方式
        shortcut_path = startup_folder / f"{app_name}.lnk"
        if shortcut_path.exists():
            shortcut_path.unlink()

        # 删除批处理文件
        bat_path = startup_folder / f"{app_name}.bat"
        if bat_path.exists():
            bat_path.unlink()

        print("Windows开机自启动已禁用")
        return True

    except Exception as e:
        print(f"Windows禁用自启动失败: {e}")
        return False

class WindowsService(PlatformService):
    def shortcut_handler(self, shortcut, handler):
        try:
            import backend.globals
            from pynput import keyboard
            listener = keyboard.GlobalHotKeys({shortcut: handler})
            listener.start()
            print(f"【系统日志】快捷键监听成功挂载！当前在 Mac 下的标准热键为: {shortcut}")
            return None
        except Exception as e:
            print(f"【系统日志】快捷键挂载失败: {e}")

    def force_kill_process_tree(self, pid):
        """强制结束当前进程及其所有子进程的统一接口"""
        import subprocess
        import time
        # --- Windows ---
        # 优雅终止 (SIGTERM)
        subprocess.run(f'taskkill /PID {pid} /T', shell=True)
        time.sleep(2)
        # 强制终止 (SIGKILL)
        subprocess.run(f'taskkill /F /T /PID {pid}', shell=True, capture_output=True)

    def get_log_directory(self):
        """返回可写的日志目录的统一接口"""
        import sys
        # Windows: exe 同级目录（用户通常有写权限）
        exe_dir = Path(sys.executable).parent
        log_dir = exe_dir / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path):
        """获取应用图标的统一接口"""
        return base_path / 'todo_icon.ico'

    def is_ssl_enable(self):
        """获取是否开启ssl的统一接口"""
        return True

    def is_default_hide(self):
        """获取是否隐藏快捷键窗口的统一接口"""
        return True

    def icon_exit(self):
        """图标注销消息的统一接口"""
        pass

    def start_prepare(self):
        """应用启动前准备工作的统一接口"""
        pass

    def start_keyboard(self):
        """应用启用快捷键的统一接口"""
        from backend.platforms.impl.desktop.common.smart_task import SmartTaskInput
        SmartTaskInput()

    def start_desktop_task_reminder(self, is_start, event=None):
        """应用桌面端消息提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import start_reminder, stop_reminder
        if is_start:
            start_reminder(click_event=event)
        else:
            stop_reminder()

    def add_new_desktop_task_reminder(self):
        """应用桌面端新任务添加消息提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import get_reminder
        # 重置已提醒任务列表，确保新任务可以被提醒
        reminder = get_reminder()
        reminder.reset_notified_tasks()

    def check_calendar_permission(self):
        """校验日历使用权限的统一接口"""
        pass

    def add_task_reminder_to_calendar(self, title, desc, start_time_ms):
        """添加任务提醒到日历的统一接口"""
        pass

    def sync_reminder_to_calendar(self, sync_start_time, sync_end_time):
        """同步任务提醒到日历的统一接口"""
        pass

    def add_firewall_rule(self, port):
        """添加防火墙策略规则的统一接口"""
        firewall_manager = FirewallManager(port=port)
        return firewall_manager.add_rule()

    def remove_firewall_rule(self, port):
        """移除防火墙策略规则的统一接口"""
        firewall_manager = FirewallManager(port=port)
        return firewall_manager.remove_rule()

    def get_auto_start_status(self):
        """获取自动重启开关状态的统一接口"""
        from backend.database.operations import TodoDatabase
        auto_start_enabled = TodoDatabase().get_setting('auto_start_enabled', False)
        return {
            'enabled': auto_start_enabled,
            'platform': 'windows',
            'supported': True
        }

    def set_auto_start_enabled(self, enabled):
        """设置自动重启开关状态的统一接口"""
        print(f"设置开机自启动状态: {enabled}")
        try:
            # 保存配置
            from backend.database.operations import TodoDatabase
            TodoDatabase().set_setting('auto_start_enabled', enabled)

            app_name = "TodoList"

            # 根据状态设置或取消自启动
            if enabled:
                return enable_windows_auto_start(app_name)
            else:
                return disable_windows_auto_start(app_name)

        except Exception as e:
            print(f"设置开机自启动失败: {e}")
            return False

    def start_app(self):
        """启动应用的统一接口"""
        from backend.platforms.impl.desktop.common.system_tray import SystemTrayManager
        manager = SystemTrayManager(self)
        manager.start_app(True)

# 用于给工厂注册的导出变量
ExportService = WindowsService

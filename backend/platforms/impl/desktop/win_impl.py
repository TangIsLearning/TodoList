# impl/desktop/win_impl.py
import os
from pathlib import Path
from typing import Any, Callable, Optional, Tuple

from backend.platforms.impl.desktop.common.common_impl import DesktopCommonService
from backend.platforms.impl.desktop.win_firewall_manager import FirewallManager

class WindowsService(DesktopCommonService):
    def __init__(self):
        super().__init__()
        self._mutex_handle = None  # 用于保存互斥体句柄

    def shortcut_handler(self, shortcut: str, handler: Callable[[], None]) -> Optional[Any]:
        try:
            import backend.globals
            from pynput import keyboard
            listener = keyboard.GlobalHotKeys({shortcut: handler})
            listener.start()
            self.backend_logger().info(f"【系统日志】快捷键监听成功挂载！当前在 Mac 下的标准热键为: {shortcut}")
            return None
        except Exception as e:
            self.backend_logger().error(f"【系统日志】快捷键挂载失败: {e}")

    def force_kill_process_tree(self, pid: int) -> None:
        """强制结束当前进程及其所有子进程的统一接口"""
        import subprocess
        import time
        import win32api

        if self._mutex_handle:
            win32api.CloseHandle(self._mutex_handle)
        # --- Windows ---
        # 优雅终止 (SIGTERM)
        subprocess.run(f'taskkill /PID {pid} /T', shell=True)
        time.sleep(2)
        # 强制终止 (SIGKILL)
        subprocess.run(f'taskkill /F /T /PID {pid}', shell=True, capture_output=True)

    def get_log_directory(self) -> Path:
        """返回可写的日志目录的统一接口"""
        import sys
        # Windows: exe 同级目录（用户通常有写权限）
        exe_dir = Path(sys.executable).parent
        log_dir = exe_dir / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path: Path) -> Path:
        """获取应用图标的统一接口"""
        return base_path / 'todo_icon.ico'

    def activate_existing_window(self) -> bool:
        # 使用窗口标题查找，确保与创建时一致
        import win32gui
        import win32con
        hwnd = win32gui.FindWindow(None, self.APP_NAME)
        if hwnd:
            # 1. 如果窗口不可见（被 hide），则显示它
            if not win32gui.IsWindowVisible(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
            # 2. 如果窗口被最小化，则还原
            if win32gui.IsIconic(hwnd):
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            # 3. 将窗口置于前台
            win32gui.SetForegroundWindow(hwnd)
            # 4. （可选）强制置顶一次，避免被其他窗口遮挡
            win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                                  win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
            win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0,
                                  win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
            return True
        return False

    def hide_taskbar_icon(self, window: Any) -> None:
        """将快捷键窗口从 Windows 任务栏中隐藏，任务栏只保留主窗口"""
        try:
            native = getattr(window, 'native', None)
            if native is None:
                return

            # 注意：native.Handle 是 pythonnet 的 IntPtr，ctypes 无法直接识别，必须先转成 int
            hwnd = native.Handle.ToInt32()
            if not hwnd:
                return

            import ctypes

            GWL_EXSTYLE = -20
            WS_EX_TOOLWINDOW = 0x00000080
            WS_EX_APPWINDOW = 0x00040000

            SWP_NOMOVE = 0x0002
            SWP_NOSIZE = 0x0001
            SWP_NOZORDER = 0x0004
            SWP_NOACTIVATE = 0x0010
            SWP_FRAMECHANGED = 0x0020

            user32 = ctypes.windll.user32
            ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            # 添加 WS_EX_TOOLWINDOW 并移除 WS_EX_APPWINDOW，使窗口不在任务栏显示
            ex_style = (ex_style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style)
            # 通知系统窗口扩展样式已变更
            user32.SetWindowPos(
                hwnd, 0, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
            )
            self.backend_logger().info("快捷键窗口已从任务栏隐藏，仅保留主窗口任务栏图标")
        except Exception as e:
            self.backend_logger().error(f"隐藏快捷键窗口任务栏图标失败: {e}")

    def start_prepare(self) -> None:
        """应用启动前准备工作的统一接口"""
        import sys
        import win32event
        import win32api
        import winerror

        try:
            mutex = win32event.CreateMutex(None, False, self.APP_NAME)
            last_error = win32api.GetLastError()
            if last_error == winerror.ERROR_ALREADY_EXISTS:
                self.backend_logger().info("检测到已有实例，尝试激活窗口...")
                self.activate_existing_window()
                sys.exit(0)
            else:
                # 首次启动，保存互斥体句柄
                self._mutex_handle = mutex
                self.backend_logger().info("首次启动，已创建互斥体并保存句柄")
        except Exception as e:
            self.backend_logger().error(f"互斥体操作失败: {e}")
            # 如果创建失败，仍然允许启动，但可能导致多实例

    def add_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """添加防火墙策略规则的统一接口"""
        firewall_manager = FirewallManager(port=port)
        return firewall_manager.add_rule()

    def remove_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """移除防火墙策略规则的统一接口"""
        firewall_manager = FirewallManager(port=port)
        return firewall_manager.remove_rule()

    def _enable_auto_start_impl(self) -> bool:
        """启用开机自启动"""
        from backend.utils import utils
        app_path = utils.get_app_path(self)

        try:
            import winreg

            # 启动命令
            launch_cmd = utils.get_launch_command(self)

            # 注册表路径
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

            # 打开注册表键
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                # 设置注册表值
                winreg.SetValueEx(key, self.APP_NAME, 0, winreg.REG_SZ, launch_cmd)

            self.backend_logger().info(f"Windows开机自启动已启用: {launch_cmd}")
            return True

        except ImportError:
            # 备用方案：使用启动文件夹
            startup_folder = Path(
                os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'
            startup_folder.mkdir(parents=True, exist_ok=True)

            # 创建快捷方式
            shortcut_path = startup_folder / f"{self.APP_NAME}.lnk"

            # 使用Python创建快捷方式
            import pythoncom
            from win32com.client import Dispatch

            shell = Dispatch('WScript.Shell')
            shortcut = shell.CreateShortcut(str(shortcut_path))
            shortcut.Targetpath = app_path
            shortcut.WorkingDirectory = str(Path(app_path).parent)

            shortcut.save()

            self.backend_logger().warning(f"Windows启动文件夹快捷方式已创建: {shortcut_path}")

            return True
        except Exception as e:
            self.backend_logger().error(f"启用开机自启动失败: {e}")
            return False

    def _disable_auto_start_impl(self) -> bool:
        """禁用开机自启动"""
        try:
            import winreg

            # 注册表路径
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

            # 尝试删除注册表项
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                    winreg.DeleteValue(key, self.APP_NAME)
            except FileNotFoundError:
                # 注册表项不存在，继续检查启动文件夹
                pass

            # 删除启动文件夹中的快捷方式和批处理文件
            startup_folder = Path(
                os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'

            # 删除快捷方式
            shortcut_path = startup_folder / f"{self.APP_NAME}.lnk"
            if shortcut_path.exists():
                shortcut_path.unlink()

            # 删除批处理文件
            bat_path = startup_folder / f"{self.APP_NAME}.bat"
            if bat_path.exists():
                bat_path.unlink()

            self.backend_logger().info("Windows开机自启动已禁用")
            return True

        except Exception as e:
            self.backend_logger().error(f"Windows禁用自启动失败: {e}")
            return False

    def start_app(self) -> None:
        """启动应用的统一接口"""
        from backend.platforms.impl.desktop.common.system_tray import SystemTrayManager
        manager = SystemTrayManager()
        manager.start_app(True)

# 用于给工厂注册的导出变量
ExportService = WindowsService

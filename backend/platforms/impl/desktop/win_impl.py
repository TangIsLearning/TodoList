# impl/desktop/win_impl.py
from backend.platforms.interface.service import PlatformService

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
        from pathlib import Path
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

# 用于给工厂注册的导出变量
ExportService = WindowsService

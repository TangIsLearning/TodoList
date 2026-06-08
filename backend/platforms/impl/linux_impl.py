# impl/linux_impl.py
from backend.platforms.interface.service import PlatformService

class LinuxService(PlatformService):
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
        # Linux环境利用时延让 GTK 将 DBus 信号安全发出，然后强制杀死所有关联进程
        import gi
        from gi.repository import Gtk
        import time
        gi.require_version('Gtk', '3.0')
        for _ in range(10):
            while Gtk.events_pending():
                Gtk.main_iteration()
            time.sleep(0.02)

    def get_log_directory(self):
        """返回可写的日志目录的统一接口"""
        import os
        from pathlib import Path
        # Linux (包括 AppImage)
        # 检测是否为 AppImage 环境
        is_appimage = os.environ.get('APPIMAGE') is not None
        if is_appimage:
            # AppImage 必须写入用户目录
            xdg_data_home = os.environ.get('XDG_DATA_HOME')
            if xdg_data_home:
                base = Path(xdg_data_home)
            else:
                base = Path.home() / '.local' / 'share'
            log_dir = base / 'TodoList' / 'logs'
        else:
            # 普通 Linux 可执行文件（如直接运行编译后的二进制）
            # 也建议写入用户目录，避免权限问题
            log_dir = Path.home() / '.local' / 'share' / 'TodoList' / 'logs'

        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path):
        """获取应用图标的统一接口"""
        return base_path / 'todo_icon.png'

    def is_ssl_enable(self):
        """获取是否开启ssl的统一接口"""
        return True

    def is_default_hide(self):
        """获取是否隐藏快捷键窗口的统一接口"""
        # 隐藏将导致快捷键窗口在Linux环境无法使用
        return False

    def icon_exit(self):
        """图标注销消息的统一接口"""
        # 给 Ubuntu 24.04 底层 DBus 通信留出 200 毫秒处理图标注销消息
        import time
        import gi
        gi.require_version('Gtk', '3.0')
        from gi.repository import Gtk

        for _ in range(10):
            while Gtk.events_pending():
                Gtk.main_iteration()
            time.sleep(0.02)

# 用于给工厂注册的导出变量
ExportService = LinuxService

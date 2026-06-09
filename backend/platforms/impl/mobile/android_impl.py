# impl/mobile/android_impl.py
from backend.platforms.interface.service import PlatformService

class AndroidService(PlatformService):
    def shortcut_handler(self, shortcut, handler):
        pass

    def force_kill_process_tree(self, pid):
        pass

    def get_log_directory(self):
        import sys
        from pathlib import Path

        if getattr(sys, 'frozen', False):
            # 打包后的exe环境
            exe_dir = Path(sys.executable).parent
        else:
            # 开发环境
            exe_dir = Path(__file__).parent.parent.parent

        log_dir = exe_dir / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path):
        return base_path / 'todo_icon.ico'

    def is_ssl_enable(self):
        # 移动端需要开启ssl，避免在移动端使用报错存在安全问题
        return True

    def is_default_hide(self):
        return True

    def icon_exit(self):
        pass

    def start_prepare(self):
        pass

    def start_keyboard(self, webview):
        pass

    def start_desktop_task_reminder(self, is_start, event=None):
        pass

    def add_new_desktop_task_reminder(self):
        pass

# 用于给工厂注册的导出变量
ExportService = AndroidService

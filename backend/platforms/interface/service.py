# interfaces/service.py
from abc import ABC, abstractmethod

class PlatformService(ABC):
    @abstractmethod
    def shortcut_handler(self, shortcut, handler):
        """快捷键的统一接口"""
        pass

    @abstractmethod
    def force_kill_process_tree(self, pid):
        """强制结束当前进程及其所有子进程的统一接口"""
        pass

    @abstractmethod
    def get_log_directory(self):
        """返回可写的日志目录的统一接口"""
        pass

    @abstractmethod
    def get_app_icon(self, base_path):
        """获取应用图标的统一接口"""
        pass

    @abstractmethod
    def is_ssl_enable(self):
        """获取是否开启ssl的统一接口"""
        pass

    @abstractmethod
    def is_default_hide(self):
        """获取是否隐藏快捷键窗口的统一接口"""
        pass

    @abstractmethod
    def icon_exit(self):
        """图标注销消息的统一接口"""
        pass

    @abstractmethod
    def start_prepare(self):
        """应用启动前准备工作的统一接口"""
        pass

    @abstractmethod
    def start_keyboard(self, webview):
        """应用启用快捷键的统一接口"""
        pass

    @abstractmethod
    def start_desktop_task_reminder(self, is_start, event=None):
        """应用桌面端消息提醒的统一接口"""
        pass

    @abstractmethod
    def add_new_desktop_task_reminder(self):
        """应用桌面端新任务添加消息提醒的统一接口"""
        pass
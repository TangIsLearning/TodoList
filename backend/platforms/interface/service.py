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
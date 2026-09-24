# interfaces/service.py
from abc import ABC, abstractmethod
from logging import Logger
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from backend import APP_ROOT

class PlatformService(ABC):
    # 应用根（开发态项目根 / 打包态资源根），各平台实现共用
    PROJECT_ROOT: Path = APP_ROOT

    @abstractmethod
    def shortcut_handler(self, shortcut: str, handler: Callable[[], None]) -> Optional[Any]:
        """快捷键的统一接口"""
        pass

    @abstractmethod
    def force_kill_process_tree(self, pid: int) -> None:
        """强制结束当前进程及其所有子进程的统一接口"""
        pass

    @abstractmethod
    def get_app_icon(self, base_path: Path) -> Path:
        """获取应用图标的统一接口"""
        pass

    @abstractmethod
    def get_code_dir(self) -> Path:
        """只读资源根：frontend、图标、模板等随包分发的文件所在目录"""
        pass

    @abstractmethod
    def get_log_dir(self) -> Path:
        """可写日志目录"""
        pass

    @abstractmethod
    def get_config_dir(self) -> Path:
        """可写配置目录（已包含应用名子目录）"""
        pass

    @abstractmethod
    def get_writable_dirs(self) -> List[Path]:
        """按优先级返回候选可写根目录（未做可写性校验）"""
        pass

    @abstractmethod
    def get_legacy_data_files(self) -> List[Path]:
        """旧版本数据文件位置（迁移探测用，按优先级排列，允许不存在）"""
        pass

    @abstractmethod
    def get_fallback_data_file(self) -> Path:
        """配置完全读不出来时的兜底数据文件位置"""
        pass

    def get_default_storage_dir(self) -> Path:
        """用户未指定存储目录时的默认存储根（通用实现，暂无平台需要覆盖）

        取候选目录里第一个真正可写的；全部不可写时退到配置目录——配置目录在各
        平台都已经是用户级可写位置（桌面端 APPDATA / XDG、Android 应用私有目录），
        比「进程当前目录」可靠：后者在桌面端取决于从哪里启动，可能是任意目录
        甚至只读（p4a 下 cwd 恰好是应用私有目录，但那只是 Android 的巧合）。
        """
        from backend.utils.utils import first_writable_dir

        chosen = first_writable_dir(*self.get_writable_dirs())
        return chosen if chosen is not None else self.get_config_dir()

    @abstractmethod
    def get_window_geometry(self) -> Dict[str, int]:
        """获取主窗口位置和尺寸参数的统一接口

        返回的参数以 **kwargs 形式直接传给 webview.create_window：
        - 桌面端：返回 x / y / width / height，按主屏幕尺寸居中并占屏 80%；
        - 移动端：窗口由系统决定大小，且 pywebview 不支持 x/y/width/height，
          此时应返回空字典，由调用方不传任何几何参数。
        """
        pass

    @abstractmethod
    def is_ssl_enable(self) -> bool:
        """获取是否开启ssl的统一接口"""
        pass

    @abstractmethod
    def is_default_hide(self) -> bool:
        """获取是否隐藏快捷键窗口的统一接口"""
        pass

    @abstractmethod
    def icon_exit(self) -> None:
        """图标注销消息的统一接口"""
        pass

    @abstractmethod
    def start_prepare(self) -> None:
        """应用启动前准备工作的统一接口"""
        pass

    @abstractmethod
    def start_keyboard(self) -> None:
        """应用启用快捷键的统一接口"""
        pass

    @abstractmethod
    def start_desktop_task_reminder(self, is_start: bool, event: Any = None) -> None:
        """应用桌面端消息提醒的统一接口"""
        pass

    @abstractmethod
    def add_new_desktop_task_reminder(self) -> None:
        """应用桌面端新任务添加消息提醒的统一接口"""
        pass

    @abstractmethod
    def refresh_task_reminder(self, task_id: str, due_date: Optional[str] = None,
                              old_due_date: Optional[str] = None) -> None:
        """任务截止时间变更后刷新到期提醒的统一接口"""
        pass

    @abstractmethod
    def check_calendar_permission(self) -> Dict[str, bool]:
        """校验（必要时申请）日历使用权限的统一接口

        返回 granted（当前是否已授权）与 requested（本次是否发起过系统授权弹窗）。
        """
        pass

    @abstractmethod
    def add_task_reminder_to_calendar(self, title: str, desc: str, start_time_ms: Union[int, float]) -> None:
        """添加任务提醒到日历的统一接口"""
        pass

    @abstractmethod
    def sync_reminder_to_calendar(self, sync_start_time: Union[int, float],
                                  sync_end_time: Union[int, float]) -> None:
        """同步任务提醒到日历的统一接口"""
        pass

    @abstractmethod
    def add_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """添加防火墙策略规则的统一接口"""
        pass

    @abstractmethod
    def remove_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """移除防火墙策略规则的统一接口"""
        pass

    @abstractmethod
    def start_app(self) -> None:
        """启动应用的统一接口"""
        pass

    @abstractmethod
    def frontend_logger(self) -> Logger:
        """前端日志的统一接口"""
        pass

    @abstractmethod
    def backend_logger(self) -> Logger:
        """后端日志的统一接口"""
        pass

    @abstractmethod
    def export_tasks_excel(self, db: Any = None, priority: Optional[str] = None,
                           status: Optional[str] = None, year: Optional[int] = None,
                           month: Optional[int] = None, category_id: Optional[str] = None,
                           tag_ids: Optional[list] = None) -> None:
        """后端数据导出的统一接口"""
        pass

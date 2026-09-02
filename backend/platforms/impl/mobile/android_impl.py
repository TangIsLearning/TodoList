# impl/mobile/android_impl.py
from pathlib import Path
from typing import Any, Callable, List, Optional, Tuple, Union

from backend.platforms.interface.service import PlatformService

class AndroidService(PlatformService):
    def shortcut_handler(self, shortcut: str, handler: Callable[[], None]) -> Optional[Any]:
        pass

    def force_kill_process_tree(self, pid: int) -> None:
        pass

    def get_log_directory(self) -> Path:
        import sys

        if getattr(sys, 'frozen', False):
            # 打包后的exe环境
            exe_dir = Path(sys.executable).parent
        else:
            # 开发环境
            exe_dir = Path(__file__).parent.parent.parent

        log_dir = exe_dir / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path: Path) -> Path:
        return base_path / 'todo_icon.ico'

    def is_ssl_enable(self) -> bool:
        # 移动端需要开启ssl，避免在移动端使用报错存在安全问题
        return True

    def is_default_hide(self) -> bool:
        return True

    def icon_exit(self) -> None:
        pass

    def start_prepare(self) -> None:
        pass

    def start_keyboard(self) -> None:
        pass

    def start_desktop_task_reminder(self, is_start: bool, event: Any = None) -> None:
        pass

    def add_new_desktop_task_reminder(self) -> None:
        pass

    def check_calendar_permission(self) -> None:
        """校验日历使用权限的统一接口"""
        from backend.platforms.impl.mobile.common.calendar_manager import check_permission
        check_permission()

    def add_task_reminder_to_calendar(self, title: str, desc: str,
                                      start_time_ms: Union[int, float]) -> None:
        """添加任务提醒到日历的统一接口"""
        from backend.platforms.impl.mobile.common.calendar_manager import add_task_reminder_to_calendar
        add_task_reminder_to_calendar(title, desc, start_time_ms, self)

    def sync_reminder_to_calendar(self, sync_start_time: Union[int, float],
                                  sync_end_time: Union[int, float]) -> None:
        """同步任务提醒到日历的统一接口"""
        from backend.platforms.impl.mobile.common.calendar_manager import sync_reminder_to_calendar
        sync_reminder_to_calendar(sync_start_time, sync_end_time, self)

    def add_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """添加防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需配置防火墙"

    def remove_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """移除防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需操作防火墙"

    def start_app(self) -> None:
        """启动应用的统一接口"""
        from backend import start
        # 安卓端需要开启SSL，否则功能无法使用
        start.start_app(True, True, None)

    def frontend_logger(self) -> Any:
        """前端日志的统一接口"""
        from backend.utils.logger import setup_logger
        # 创建默认的logger实例
        return setup_logger(self, 'frontend')

    def backend_logger(self) -> Any:
        """后端日志的统一接口"""
        from backend.utils.logger import setup_logger
        # 创建默认的logger实例
        return setup_logger(self, 'backend')

    def export_tasks_excel(self, db: Any = None, priority: Optional[str] = None,
                           status: Optional[str] = None, year: Optional[int] = None,
                           month: Optional[int] = None, category_id: Optional[str] = None,
                           tag_ids: Optional[List[str]] = None) -> None:
        """后端数据导出的统一接口"""
        raise Exception(f'当前系统不支持')

# 用于给工厂注册的导出变量
ExportService = AndroidService

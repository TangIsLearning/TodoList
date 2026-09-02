# backend/api/mixins/utility_mixin.py
from typing import Any, List, Optional
from backend.utils.response_wrapper import api_handler

class UtilityMixin:
    """工具方法 Mixin"""

    @api_handler
    def check_calendar_permission(self) -> None:
        """检查权限"""
        self.service.check_calendar_permission()

    @api_handler
    def log(self, level: str, message: str, source: str = 'frontend') -> None:
        """从前端记录日志

        Args:
            level: 日志级别（debug, info, warning, error, critical）
            message: 日志消息
            source: 日志来源
        """
        log = self.service.frontend_logger()
        level_map = {
            'debug': log.debug,
            'info': log.info,
            'warning': log.warning,
            'error': log.error,
            'critical': log.critical
        }

        log_func = level_map.get(level.lower(), log.info)
        log_func(f"[{source}] {message}")

    @api_handler
    def open_in_browser(self, url: str) -> None:
        import webbrowser
        webbrowser.open(url)

    @api_handler
    def export_tasks_excel(self, priority: Optional[str] = None, status: Optional[str] = None,
                           year: Optional[int] = None, month: Optional[int] = None,
                           category_id: Optional[str] = None,
                           tag_ids: Optional[List[str]] = None) -> None:
        self.service.export_tasks_excel(self.db, priority, status, year, month, category_id, tag_ids)
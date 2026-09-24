"""
PlatformService的公共抽象基类，请勿实例化
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from backend.platforms.interface.service import PlatformService
from backend.utils.api_errors import CancelledError
from backend.utils.utils import APP_DIR_NAME, ensure_dir

class DesktopCommonService(PlatformService):
    APP_NAME: str = 'TodoList'

    # 无法获取屏幕信息时的兜底窗口尺寸
    DEFAULT_WINDOW_SIZE: tuple = (1000, 700)

    # ---------- 路径（桌面端通用） ----------
    # 桌面端有三种形态：开发态（源码运行）、PyInstaller 打包（sys.frozen）、
    # AppImage。差异集中在「资源从哪读」和「打包后数据往哪写」，
    # 真正需要子类定制的只有打包态日志目录，其余规则在这里统一实现。

    def get_code_dir(self) -> Path:
        """只读资源根：打包后是 _MEIPASS 解压目录，开发态是项目根"""
        if getattr(sys, 'frozen', False):
            base = Path(sys._MEIPASS)
            # PyInstaller 6.x 会把资源归类到 _internal 子目录
            if (base / '_internal').exists():
                base = base / '_internal'
            return base
        return self.PROJECT_ROOT

    def get_log_dir(self) -> Path:
        """打包态由子类决定，开发态统一落在项目根/logs"""
        if getattr(sys, 'frozen', False):
            return ensure_dir(self._packaged_log_dir())
        return ensure_dir(self.PROJECT_ROOT / 'logs')

    def _packaged_log_dir(self) -> Path:
        """打包态的日志目录；默认与开发态一致，由需要的平台覆盖"""
        return self.PROJECT_ROOT / 'logs'

    def get_config_dir(self) -> Path:
        """可写配置目录；默认遵循 XDG 约定，Windows 覆盖为 %APPDATA%"""
        return ensure_dir(Path.home() / '.config' / APP_DIR_NAME)

    def _packaged_data_dir(self) -> Path:
        """打包态的用户数据根（钩子，子类实现）

        安装目录通常只读（Program Files、AppImage 挂载点、.app  bundle），
        打包后数据必须落到用户目录，落到哪由各平台按自身惯例决定。
        """
        raise NotImplementedError

    def get_writable_dirs(self) -> List[Path]:
        """候选可写根目录

        打包态走平台各自的用户数据根，开发态就是项目根。
        """
        if getattr(sys, 'frozen', False):
            return [self._packaged_data_dir()]

        return [self.PROJECT_ROOT]

    def get_legacy_data_files(self) -> List[Path]:
        """旧版本数据文件位置（按优先级排列）"""
        candidates: List[Path] = []
        if getattr(sys, 'frozen', False):
            candidates.append(self._packaged_data_dir() / 'data' / 'todo.db')

        candidates.append(self.get_fallback_data_file())
        return candidates

    def get_fallback_data_file(self) -> Path:
        """沿用旧版布局 <项目根>/data/todo.db"""
        return self.PROJECT_ROOT / 'data' / 'todo.db'

    # ---------- 系统操作钩子（子类实现） ----------
    def _enable_auto_start_impl(self) -> bool:
        raise NotImplementedError

    def _disable_auto_start_impl(self) -> bool:
        raise NotImplementedError

    # ---------- 供 config_mixin 调用的系统操作 ----------
    def set_auto_start_system(self, enabled: bool) -> bool:
        """仅执行系统自启动操作，不操作数据库"""
        if enabled:
            return self._enable_auto_start_impl()
        else:
            return self._disable_auto_start_impl()

    def export_tasks_excel(self, db: Any = None, priority: Optional[str] = None,
                          status: Optional[str] = None, year: Optional[int] = None,
                          month: Optional[int] = None, category_id: Optional[str] = None,
                          tag_ids: Optional[List[str]] = None) -> None:
        """导出任务到Excel文件

        参数:
            priority: 优先级筛选，可选值: high/medium/low/none
            status: 状态筛选，可选值: completed/uncompleted
            year: 年份筛选
            month: 月份筛选
            category_id: 分类ID筛选
            tag_ids: 标签ID列表筛选
        """
        import webview
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
        from openpyxl.utils import get_column_letter
        from datetime import datetime

        # 筛选下推到 SQL，并一次性补齐标签 / 附件 / 父任务（避免全量加载与逐条查询）
        export_rows = db.get_export_rows(
            priority=priority, status=status, year=year, month=month,
            category_id=category_id, tag_ids=tag_ids
        )

        # 创建工作簿
        wb = Workbook()
        ws = wb.active
        ws.title = "任务导出"

        # 设置表头样式
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )

        # 写入表头
        headers = ["任务名称", "父任务", "任务完成状态", "任务优先级", "任务完成截止时间", "任务所属分类", "任务关联标签", "任务附件"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        # 优先级和状态映射
        priority_map = {'high': '高', 'medium': '中', 'low': '低', 'none': '无'}
        status_map = {True: '已完成', False: '未完成'}

        # 写入数据
        for row_idx, row in enumerate(export_rows, 2):
            # 格式化截止时间
            due_date = row.get('dueDate')
            if due_date:
                try:
                    dt = datetime.fromisoformat(due_date)
                    due_date_str = dt.strftime('%Y-%m-%d %H:%M')
                except:
                    due_date_str = due_date
            else:
                due_date_str = '无'

            row_data = [
                row.get('title', ''),
                row.get('parentTitle', '无'),
                status_map.get(row.get('completed'), '未完成'),
                priority_map.get(row.get('priority'), '无'),
                due_date_str,
                row.get('categoryName', '无分类'),
                row.get('tagNames', ''),
                row.get('attachmentNames', '')
            ]

            for col, value in enumerate(row_data, 1):
                cell = ws.cell(row=row_idx, column=col, value=value)
                cell.border = thin_border
                cell.alignment = Alignment(vertical="center")

        # 设置列宽
        column_widths = [30, 20, 15, 12, 20, 15, 25, 30]
        for col, width in enumerate(column_widths, 1):
            ws.column_dimensions[get_column_letter(col)].width = width

        # 打开保存对话框
        active_window = webview.active_window()
        if active_window:
            file_path = active_window.create_file_dialog(
                webview.FileDialog.SAVE,
                file_types=['Excel Files (*.xlsx)', 'All files (*.*)'],
                save_filename='tasks_export.xlsx'
            )

            if file_path:
                # create_file_dialog可能返回元组或字符串
                if isinstance(file_path, (list, tuple)):
                    file_path = file_path[0] if file_path else None

                if file_path:
                    # 确保文件扩展名为.xlsx
                    if not file_path.endswith('.xlsx'):
                        file_path += '.xlsx'
                    wb.save(file_path)
                    return
                else:
                    raise CancelledError('用户取消了保存')
            else:
                raise CancelledError('用户取消了保存')
        else:
            raise Exception(f'无法获取活动窗口')

    def get_window_geometry(self) -> Dict[str, int]:
        """桌面端：按主屏幕尺寸返回窗口几何参数（居中，占屏 80%）

        极端环境下拿不到屏幕信息时，回退到默认尺寸，避免因 screens 为空导致启动失败。
        """
        import webview

        try:
            screens = webview.screens
        except Exception as e:
            screens = []
            self.backend_logger().warning(f"获取屏幕信息失败，回退到默认窗口尺寸: {e}")

        target_screen = screens[0] if screens else None
        if not target_screen:
            self.backend_logger().warning("未获取到任何屏幕信息，回退到默认窗口尺寸")
            width, height = self.DEFAULT_WINDOW_SIZE
            return {'width': int(width), 'height': int(height)}

        screen_width = int(target_screen.width)
        screen_height = int(target_screen.height)
        return {
            'x': int(screen_width * 0.1),
            'y': int(screen_height * 0.1),
            'width': int(screen_width * 0.8),
            'height': int(screen_height * 0.8)
        }

    def is_ssl_enable(self) -> bool:
        """获取是否开启ssl的统一接口"""
        return True

    def is_default_hide(self) -> bool:
        """获取是否隐藏快捷键窗口的统一接口"""
        return True

    def icon_exit(self) -> None:
        """图标注销消息的统一接口"""
        pass

    def hide_taskbar_icon(self, window: Any) -> None:
        """将快捷键窗口从系统任务栏隐藏的统一接口（默认空实现，由各平台按需覆盖）"""
        pass

    def start_keyboard(self) -> None:
        """应用启用快捷键的统一接口"""
        from backend.platforms.impl.desktop.common.smart_task import SmartTaskInput
        sti = SmartTaskInput()
        # 平台特定处理：Windows 下将快捷键窗口从任务栏隐藏，只保留主窗口任务栏图标
        self.hide_taskbar_icon(sti.window)

    def start_desktop_task_reminder(self, is_start: bool, event: Any = None) -> None:
        """应用启用快捷键的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import start_reminder, stop_reminder
        if is_start:
            start_reminder(click_event=event)
        else:
            stop_reminder()

    def add_new_desktop_task_reminder(self) -> None:
        """应用桌面端新任务添加消息提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import get_reminder
        # 重置已提醒任务列表，确保新任务可以被提醒
        reminder = get_reminder()
        reminder.reset_notified_tasks()

    def refresh_task_reminder(self, task_id: str, due_date: Optional[str] = None,
                              old_due_date: Optional[str] = None) -> None:
        """任务截止时间变更后刷新到期提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import refresh_reminder
        refresh_reminder(task_id, due_date)

    def check_calendar_permission(self) -> Dict[str, bool]:
        """校验日历使用权限的统一接口

        桌面端不写入系统日历，视为无需权限。
        """
        return {'granted': True, 'requested': False}

    def add_task_reminder_to_calendar(self, title: str, desc: str,
                                      start_time_ms: Union[int, float]) -> None:
        """添加任务提醒到日历的统一接口"""
        pass

    def sync_reminder_to_calendar(self, sync_start_time: Union[int, float],
                                  sync_end_time: Union[int, float]) -> None:
        """同步任务提醒到日历的统一接口"""
        pass

    def add_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """添加防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需配置防火墙"

    def remove_firewall_rule(self, port: int) -> Tuple[bool, str]:
        """移除防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需操作防火墙"

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
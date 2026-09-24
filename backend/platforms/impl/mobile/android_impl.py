# impl/mobile/android_impl.py
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from backend.platforms.interface.service import PlatformService
from backend.utils.api_errors import PermissionDeniedError
from backend.utils.utils import APP_DIR_NAME, ensure_dir, first_writable_dir

# ---------- Android 目录探测（AndroidService 路径方法的内部实现） ----------
# Android 的可写目录全部与**包名**绑定：
#   - 私有目录 /data/user/0/<pkg>/files（/data/data/<pkg> 的同义链接）
#   - 外部目录 /sdcard/Android/data/<pkg>/files
# 而包名由构建配置（buildozer 的 package.domain / package.name）决定，写死包名在
# 构建配置变更后会静默失效：路径指向另一个应用的私有目录，mkdir 直接抛
# PermissionError。因此下面全部改成运行时探测，任何一步失败都安静返回 None，
# 由 first_writable_dir 兜住。

# p4a 注入、形如 /data/user/0/<pkg>/files[/app] 的环境变量
_APP_DIR_ENV_VARS = ('ANDROID_APP_PATH', 'ANDROID_ARGUMENT', 'ANDROID_UNPACK')
# p4a 注入、形如 /data/user/0/<pkg>/files 的环境变量
_FILES_DIR_ENV_VARS = ('ANDROID_PRIVATE',)
# 外部存储根（不同 ROM 下取值不同）
_EXTERNAL_STORAGE_ENV_VARS = ('EXTERNAL_STORAGE', 'ANDROID_EXTERNAL_STORAGE')

_dir_cache: Dict[str, Optional[object]] = {}


def _split(raw: str) -> List[str]:
    """拆分路径，去掉空段，统一分隔符"""
    return [part for part in str(raw).replace('\\', '/').split('/') if part]


def _package_from_path(raw: str) -> Optional[str]:
    """从 /data/user/0/<pkg>/files[/app] 这类路径里取出包名"""
    parts = _split(raw)
    for anchor, offset in (('files', 1), ('app', 2)):
        if anchor in parts:
            index = parts.index(anchor)
            if index >= offset:
                candidate = parts[index - offset]
                # 包名形如 com.xxx.yyy，至少包含一个点
                if '.' in candidate:
                    return candidate
    return None


def _activity() -> Optional[object]:
    """通过 jnius 拿到当前 Activity；非 Android 或获取失败时返回 None"""
    try:
        from jnius import autoclass  # type: ignore
    except Exception:
        return None

    try:
        return autoclass('org.kivy.android.PythonActivity').mActivity
    except Exception:
        return None


def _get_package_name() -> Optional[str]:
    """当前应用的包名；无法判定返回 None"""
    if 'package' in _dir_cache:
        return _dir_cache['package']  # type: ignore[return-value]

    package: Optional[str] = None
    for name in _FILES_DIR_ENV_VARS + _APP_DIR_ENV_VARS:
        value = os.environ.get(name)
        if value:
            package = _package_from_path(value)
            if package:
                break

    if not package:
        # 退路：p4a 启动后 cwd 与 sys.prefix 通常就是 <...>/<pkg>/files/app
        for value in (os.getcwd(), getattr(sys, 'prefix', '')):
            package = _package_from_path(value) if value else None
            if package:
                break

    if not package:
        activity = _activity()
        if activity is not None:
            try:
                package = activity.getPackageName()
            except Exception:
                package = None

    _dir_cache['package'] = package
    return package


def _get_app_files_dir() -> Optional[Path]:
    """应用私有 files 目录（/data/user/0/<pkg>/files）"""
    if 'files' in _dir_cache:
        return _dir_cache['files']  # type: ignore[return-value]

    path: Optional[Path] = None

    for name in _FILES_DIR_ENV_VARS:
        value = os.environ.get(name)
        if value:
            path = Path(value)
            break

    if path is None:
        for name in _APP_DIR_ENV_VARS:
            value = os.environ.get(name)
            if value:
                # .../files/app -> .../files
                candidate = Path(value)
                path = candidate.parent if candidate.name == 'app' else candidate
                break

    _dir_cache['files'] = path
    return path


def _get_app_data_dir() -> Optional[Path]:
    """应用私有根目录（/data/user/0/<pkg>），databases / shared_prefs 的传统落点"""
    if 'data' in _dir_cache:
        return _dir_cache['data']  # type: ignore[return-value]

    path: Optional[Path] = None
    files_dir = _get_app_files_dir()
    if files_dir is not None and files_dir.name == 'files':
        path = files_dir.parent

    _dir_cache['data'] = path
    return path


def _external_app_dir_from_jni() -> Optional[Path]:
    activity = _activity()
    if activity is None:
        return None
    try:
        external_files = activity.getExternalFilesDir(None)
        if external_files is None:
            return None
        # .../Android/data/<pkg>/files -> .../Android/data/<pkg>
        return Path(external_files.getAbsolutePath()).parent
    except Exception:
        return None


def _get_external_app_dir() -> Optional[Path]:
    """外部存储上的应用专属目录（/sdcard/Android/data/<pkg>）"""
    if 'external' in _dir_cache:
        return _dir_cache['external']  # type: ignore[return-value]

    path = _external_app_dir_from_jni()

    if path is None:
        package = _get_package_name()
        if package:
            base = None
            for name in _EXTERNAL_STORAGE_ENV_VARS:
                value = os.environ.get(name)
                if value:
                    base = Path(value)
                    break
            if base is None:
                base = Path('/sdcard')
            path = base / 'Android' / 'data' / package

    _dir_cache['external'] = path
    return path


def _get_external_files_dir() -> Optional[Path]:
    """外部存储上的 files 目录（/sdcard/Android/data/<pkg>/files）"""
    base = _get_external_app_dir()
    return base / 'files' if base is not None else None


class AndroidService(PlatformService):
    # ---------- 路径 ----------
    # 与桌面端最大的不同：可写目录全部与包名绑定，且外部存储需要运行时授权，
    # 因此每个目录都走「按优先级挑第一个可写」的逻辑，而不是写死一个位置。
    # 目录探测函数在同文件上方。

    def get_code_dir(self) -> Path:
        """应用资源根（p4a 下即 <app> 目录）"""
        root = self.PROJECT_ROOT
        return root if root.is_dir() else Path(os.getcwd())

    def get_log_dir(self) -> Path:
        return ensure_dir(self.get_code_dir() / 'logs')

    def get_config_dir(self) -> Path:
        candidates = [base / '.config' / APP_DIR_NAME
                      for base in self.get_writable_dirs()]

        chosen = first_writable_dir(*candidates)
        if chosen is not None:
            return chosen

        # 兜底：进程当前目录（p4a 下即应用私有 app 目录），必然可写
        return ensure_dir(Path(os.getcwd()) / APP_DIR_NAME)

    def get_writable_dirs(self) -> List[Path]:
        """候选可写根目录：应用私有 → 外部存储 → 用户目录 → 当前目录"""
        candidates: List[Path] = []

        files_dir = _get_app_files_dir()
        if files_dir is not None:
            candidates.append(files_dir)

        external_files = _get_external_files_dir()
        if external_files is not None:
            candidates.append(external_files)

        home = Path.home()
        if home.is_absolute():
            candidates.append(home / '.todolist')

        candidates.append(Path(os.getcwd()))
        return candidates

    def get_legacy_data_files(self) -> List[Path]:
        """旧版本数据文件位置（按优先级排列）"""
        candidates: List[Path] = []

        app_data_dir = _get_app_data_dir()
        if app_data_dir is not None:
            candidates.append(app_data_dir / 'databases' / 'todo.db')

        external_app_dir = _get_external_app_dir()
        if external_app_dir is not None:
            candidates.append(external_app_dir / 'databases' / 'todo.db')

        candidates.append(self.get_fallback_data_file())
        return candidates

    def get_fallback_data_file(self) -> Path:
        return self.get_code_dir() / 'data' / 'todo.db'

    def shortcut_handler(self, shortcut: str, handler: Callable[[], None]) -> Optional[Any]:
        pass

    def force_kill_process_tree(self, pid: int) -> None:
        pass

    def get_app_icon(self, base_path: Path) -> Path:
        return base_path / 'todo_icon.ico'

    def get_window_geometry(self) -> Dict[str, int]:
        """移动端不返回任何几何参数

        Android 下 pywebview 的 get_screens() 返回空列表，且 create_window 会忽略
        x/y/width/height（WebView 由系统布局铺满屏幕），因此这里返回空字典，
        调用方不会向 create_window 传入位置与尺寸参数。
        """
        return {}

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

    def refresh_task_reminder(self, task_id: str, due_date: Optional[str] = None,
                              old_due_date: Optional[str] = None) -> None:
        """移动端：截止时间变更后同步调整系统日历提醒时间"""
        from backend.platforms.impl.mobile.common.calendar_manager import refresh_task_reminder_in_calendar
        refresh_task_reminder_in_calendar(task_id, due_date, old_due_date, self)

    def check_calendar_permission(self) -> Dict[str, bool]:
        """校验（必要时申请）日历使用权限的统一接口

        返回 granted / requested 两个状态，供前端决定是否需要引导用户去系统设置开启。
        """
        from backend.platforms.impl.mobile.common.calendar_manager import get_permission_status
        return get_permission_status(self)

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
        raise PermissionDeniedError('当前系统不支持')

# 用于给工厂注册的导出变量
ExportService = AndroidService

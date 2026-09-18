"""存储能力的门面。

对外只暴露「数据存在哪」和「怎么搬过去」两组动作：路径该怎么解析、目录该怎么
排布、旧数据该怎么腾挪。调用方不必知道一次目录切换要先后找谁，只需调用
get_ / estimate / switch / cleanup 这类动词。

这里是唯一同时认识配置、迁移器、清理器的地方：配置管「偏好存到哪」，迁移管
「怎么搬」，清理管「旧的要怎么办」，编排关系集中一处才不会散落成隐式协议。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

from backend.config_manager import get_config_manager
from backend.storage.cleaner import get_storage_cleaner
from backend.storage.layout import (
    ATTACHMENT_DIR_NAME, DB_FILE_NAME, STORAGE_DIR_NAME,
)
from backend.storage.migrator import StorageMigrationCancelled, get_storage_migrator
from backend.storage.paths import (
    get_default_storage_dir, get_fallback_data_file, get_legacy_default_data_file,
)
from backend.utils.logger import LogManager

__all__ = [
    'StorageMigrationCancelled',
    'get_storage_dir', 'get_app_dir', 'get_attachment_dir', 'get_data_file',
    'get_storage_dir_version', 'switch_storage_dir', 'is_same_storage_dir',
    'estimate_migration', 'begin_migration', 'report_migration', 'finish_migration',
    'get_migration_state', 'is_migration_running', 'request_migration_cancel',
    'is_migration_cancelled', 'get_pending_backup', 'set_pending_backup',
    'cleanup_previous_backup',
]

_log = LogManager()


class _ResolvedState:
    """解析结果与版本号。

    dir 缓存解析结果，避免每次访问都重跑优先级判断；version 每次成功切换后自增，
    供持有路径缓存的实例判断缓存是否过期（见 TodoDatabase.db_path）。
    """

    def __init__(self) -> None:
        self.dir: Optional[Path] = None
        self.version: int = 0


_state = _ResolvedState()


# ==================== 路径解析 ====================

def _remember_backup(result: Any) -> None:
    """迁移若留下了旧数据备份，记下来待清理"""
    if result.backup_dir is not None:
        get_storage_cleaner().set_pending_backup(result.backup_dir)


def _ensure_layout(base_dir: Path, legacy_file: Optional[Path] = None,
                   progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> Any:
    """建立目录结构并在需要时迁移旧数据，顺带记下旧数据的落点。

    解析当前存储目录时可能顺手整理老布局（例如老版本把库直接放在 <base>/todo.db），
    这时同样会留下可清理的旧备份，因此与主动切换共用同一套记账。
    """
    result = get_storage_migrator().ensure_layout(base_dir, legacy_file, progress=progress)
    _remember_backup(result)
    return result


def get_storage_dir() -> Path:
    """当前生效的存储根目录

    优先级：
    1. 新配置 storage_dir（用户选择的存储目录）
    2. 旧配置 data_file（兼容老版本，取其父目录作为存储目录并迁移文件）
    3. 环境变量 TODO_STORAGE_DIR / TODO_DATA_FILE
    4. 默认目录
    """
    if _state.dir is not None:
        return _state.dir

    config = get_config_manager()

    # 1. 新配置：存储目录
    dir_config = config.get('storage_dir')
    if dir_config and isinstance(dir_config, str):
        base_dir = Path(dir_config)
        _ensure_layout(base_dir)
        _state.dir = base_dir
        return base_dir

    # 2. 旧配置：数据文件路径（适配老版本，迁移到新结构）
    legacy = config.get('data_file')
    if legacy and isinstance(legacy, str):
        legacy_file = Path(legacy)
        base_dir = legacy_file.parent
        _ensure_layout(base_dir, legacy_file)
        _state.dir = base_dir
        return base_dir

    # 3. 环境变量
    env_dir = os.environ.get('TODO_STORAGE_DIR')
    if env_dir:
        base_dir = Path(env_dir)
        _ensure_layout(base_dir)
        _state.dir = base_dir
        return base_dir

    env_file = os.environ.get('TODO_DATA_FILE')
    if env_file:
        legacy_file = Path(env_file)
        base_dir = legacy_file.parent
        _ensure_layout(base_dir, legacy_file)
        _state.dir = base_dir
        return base_dir

    # 4. 默认目录（同时迁移旧默认位置的数据）
    base_dir = get_default_storage_dir()
    _ensure_layout(base_dir, get_legacy_default_data_file())
    _state.dir = base_dir
    return base_dir


def get_app_dir() -> Path:
    """应用数据目录（<存储目录>/todolist）"""
    app_dir = get_storage_dir() / STORAGE_DIR_NAME
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


def get_attachment_dir() -> Path:
    """附件根目录（<存储目录>/todolist/attachment）"""
    attach_dir = get_app_dir() / ATTACHMENT_DIR_NAME
    attach_dir.mkdir(parents=True, exist_ok=True)
    return attach_dir


def get_data_file() -> str:
    """数据文件路径（<存储目录>/todolist/todo.db）"""
    return str(get_app_dir() / DB_FILE_NAME)


def get_data_file_or_fallback() -> str:
    """解析数据文件路径，解析不出时退回项目内的默认位置。

    只该由「无论如何都得连上一个库」的调用方使用：主数据库连接与导出导入管理器
    都在启动阶段被实例化，此刻抛异常等于整个应用起不来，退化到默认位置是更稳的
    取舍。纯展示用途（例如把路径显示在设置页）应当直接用 get_data_file()，
    让配置问题暴露出来而不是被悄悄掩盖。
    """
    try:
        return get_data_file()
    except Exception as e:
        _log.get_logger.error(f"解析数据文件路径失败，退回默认位置: {e}")
        fallback = get_fallback_data_file()
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return str(fallback)


def get_storage_dir_version() -> int:
    """存储目录变更版本号，每次成功切换后自增。

    持有路径缓存的实例（如 TodoDatabase 的 db_path）据此判断缓存是否过期，
    从而在用户切换存储目录后自动重解析到新库，避免出现仍指向旧库的陈旧连接。
    """
    return _state.version


def _current_data_file() -> Optional[Path]:
    """当前生效的数据文件路径；尚无可用存储目录时返回 None"""
    try:
        return Path(get_data_file())
    except Exception:
        return None


# ==================== 切换存储目录 ====================

def _normalize_dir(path: Any) -> str:
    """目录比较用的规范化形式：先绝对化（折叠 . / .. / 尾部分隔符），再按平台规则折叠大小写"""
    return os.path.normcase(os.path.abspath(str(path)))


def is_same_storage_dir(path: str) -> bool:
    """给定路径是否就是当前生效的存储目录。

    用于跳过"切到同一个目录"的无谓迁移：用户点应用时目录其实没改，跑一遍全量复制
    既耗时又会在原地留下一份没人用的副本。当前目录无法解析时按"有改动"返回，
    交给迁移流程兜底。
    """
    if not path or not isinstance(path, str):
        return False
    try:
        current = get_storage_dir()
    except Exception:
        return False
    return _normalize_dir(path) == _normalize_dir(current)


def switch_storage_dir(path: str,
                       progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> bool:
    """切换存储根目录，把既有数据迁过去，旧数据保留待后续清理"""
    if not path or not isinstance(path, str):
        raise ValueError("存储目录不能为空")

    path_obj = Path(path)

    # 记录哪些目录是本次新建的：失败回滚时只清理这些，绝不删除用户已有内容
    dirs_created = [
        path_obj,
        path_obj / STORAGE_DIR_NAME,
        path_obj / STORAGE_DIR_NAME / ATTACHMENT_DIR_NAME,
    ]
    existed_before = {str(directory): directory.exists() for directory in dirs_created}

    if path_obj.exists() and not path_obj.is_dir():
        raise ValueError("请选择一个目录，而不是文件")

    try:
        path_obj.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise ValueError(f"无法创建目录 {path_obj}: {e}")

    if not os.access(str(path_obj), os.W_OK):
        raise PermissionError(f"没有对目录 {path} 的写权限")

    # 若旧目录存在数据且新目录没有，则迁移，保证数据不丢失
    migrator = get_storage_migrator()
    legacy_db = _current_data_file()
    result = migrator.ensure_layout(path_obj, legacy_db, progress=progress)

    # 迁移是切换的一部分：失败即中止，避免"配置已切到新目录、数据仍在旧目录"的丢数据假象
    if not result.ok:
        migrator.remove_created_dirs(dirs_created, existed_before)
        raise RuntimeError(
            f"数据迁移失败，已取消切换并继续使用原目录"
            f"{f'（{legacy_db}）' if legacy_db else ''}"
            f"，请确认该文件未被其他程序占用后重试"
        )
    _remember_backup(result)

    config = get_config_manager()
    success = config.set('storage_dir', str(path_obj))
    if success:
        _state.dir = path_obj
        # 自增版本号，使所有持有路径缓存的实例在下次访问时重新解析到新库
        _state.version += 1
        # 清理旧的文件路径配置，避免后续继续使用旧逻辑
        config.delete('data_file')
        _log.get_logger.info(f"存储目录配置已保存到外部配置文件: {path_obj}")
    return success


# ==================== 迁移进度 ====================

def estimate_migration(target_dir: Path) -> Dict[str, Any]:
    """预估切到目标目录要搬运的数据量，供前端提示与二次确认"""
    return get_storage_migrator().estimate(target_dir, _current_data_file())


def begin_migration(target_dir: Path, estimate: Dict[str, Any]) -> None:
    """标记一次迁移开始，并把预估总量作为进度分母"""
    get_storage_migrator().begin(target_dir, estimate)


def report_migration(info: Dict[str, Any]) -> None:
    """接收迁移线程上报的进度"""
    get_storage_migrator().report(info)


def finish_migration(success: bool, message: str = '',
                     status: Optional[str] = None, **extra: Any) -> None:
    """结束一次迁移并记录结果（成功 / 失败 / 取消）"""
    get_storage_migrator().finish(success, message, status=status, **extra)


def get_migration_state() -> Dict[str, Any]:
    """迁移进度快照，前端轮询用"""
    return get_storage_migrator().get_state()


def is_migration_running() -> bool:
    return get_storage_migrator().is_running()


def request_migration_cancel() -> bool:
    """请求取消进行中的迁移；返回 False 表示当前没有可取消的任务"""
    return get_storage_migrator().request_cancel()


def is_migration_cancelled() -> bool:
    return get_storage_migrator().is_cancelled()


# ==================== 旧备份清理 ====================

def get_pending_backup() -> Optional[Path]:
    """上一次迁移遗留、等待清理的旧数据目录"""
    return get_storage_cleaner().get_pending_backup()


def set_pending_backup(value: Optional[Path]) -> None:
    """记录或清空待清理的旧数据目录"""
    get_storage_cleaner().set_pending_backup(value)


def cleanup_previous_backup() -> Tuple[bool, str]:
    """清理上一次切换目录后留在原位置的旧数据"""
    try:
        current_app_dir = get_app_dir()
    except Exception as e:
        return False, f"无法确定当前存储目录，已取消清理: {e}"
    return get_storage_cleaner().cleanup(current_app_dir)

"""
TodoList应用的配置文件
"""

import os
from pathlib import Path

# 应用配置
APP_NAME = "Todo List"
APP_VERSION = "0.1.0-alpha"
APP_WIDTH = 1000
APP_HEIGHT = 700
APP_MIN_WIDTH = 800
APP_MIN_HEIGHT = 600

# 数据库配置
DB_NAME = "todo.db"
DATA_DIR = "data"

# 前端配置
FRONTEND_DIR = "frontend"
INDEX_FILE = "index.html"

# 默认设置
DEFAULT_PRIORITY = "none"
DEFAULT_CATEGORY_COLOR = "#007bff"

# 优先级配置
PRIORITY_LEVELS = {
    "high": {"label": "高", "color": "#dc3545", "icon": "🔴"},
    "medium": {"label": "中", "color": "#ffc107", "icon": "🟡"},
    "low": {"label": "低", "color": "#28a745", "icon": "🟢"},
    "none": {"label": "无", "color": "#6c757d", "icon": "⚪"}
}

# 数据文件配置
DEFAULT_DATA_FILE = "data/todo.db"

# Android配置
ANDROID_PACKAGE_NAME = "com.pywebview.todos.todolist"
ANDROID_PRIMARY_USR_DIR = "/data/user/0/com.pywebview.todos.todolist"
ANDROID_PRIMARY_DATA_DIR = "/data/data/com.pywebview.todos.todolist"
ANDROID_EXTERNAL_DIR = "/sdcard/Android/data/com.pywebview.todos.todolist"

from backend.platforms.core.factory import get_platform_service
service = get_platform_service()
backend_logger = service.backend_logger()

def get_default_data_file() -> str:
    """获取默认数据文件路径"""
    # 获取项目根目录
    project_root = Path(__file__).parent.parent
    return str(project_root / DEFAULT_DATA_FILE)


def get_current_data_file() -> str:
    """获取当前配置的数据文件路径
    
    优先级：
    1. 从外部配置文件获取用户设置的文件
    2. 从环境变量获取
    3. 使用默认文件
    """
    # 首先尝试从外部配置管理器获取配置
    try:
        from backend.config_manager import get_data_file
        return get_data_file()
    except Exception as e:
        backend_logger.error(f"警告：从外部配置获取数据文件配置失败: {e}")
    
    # 回退到环境变量
    env_data_file = os.environ.get('TODO_DATA_FILE')
    if env_data_file:
        return env_data_file
    
    # 最后使用默认文件
    return get_default_data_file()


def get_current_storage_dir() -> str:
    """获取当前配置的存储目录（存储根目录）

    优先级：
    1. 从外部配置文件获取用户设置的存储目录
    2. 环境变量
    3. 默认目录
    """
    try:
        from backend.config_manager import get_storage_dir
        return str(get_storage_dir())
    except Exception as e:
        backend_logger.error(f"警告：从外部配置获取存储目录失败: {e}")

    env_dir = os.environ.get('TODO_STORAGE_DIR')
    if env_dir:
        return env_dir

    return str(Path(get_default_data_file()).parent)


def set_data_file(path: str) -> bool:
    """【兼容旧接口】设置数据存储目录

    Args:
        path (str): 存储目录路径（旧版本传入的是 db 文件路径，会自动取其父目录）
    """
    # 验证路径有效性
    if not path or not isinstance(path, str):
        raise ValueError("存储目录不能为空")

    path_obj = Path(path)
    # 兼容旧接口：如果传入的是 db 文件路径，则取其父目录作为存储目录
    if path_obj.suffix.lower() == '.db':
        path_obj = path_obj.parent

    # 检查路径是否存在，不存在则创建目录
    if not path_obj.exists():
        try:
            path_obj.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise ValueError(f"无法创建目录 {path_obj}: {e}")

    # 检查是否有读写权限
    if not os.access(str(path_obj), os.R_OK | os.W_OK):
        raise PermissionError(f"没有对目录 {path_obj} 的读写权限")

    # 保存到外部配置文件
    try:
        from backend.config_manager import set_storage_dir as set_external_storage_dir
        success = set_external_storage_dir(str(path_obj))
        if success:
            backend_logger.info(f"存储目录配置已保存到外部配置文件: {path_obj}")
            return True
        else:
            raise Exception("外部配置保存失败")
    except Exception as e:
        backend_logger.error(f"警告：保存存储目录配置到外部配置失败: {e}")
        # 如果外部配置保存失败，回退到环境变量
        os.environ['TODO_STORAGE_DIR'] = str(path_obj)
        return True
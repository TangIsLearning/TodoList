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

# 数据目录配置
DEFAULT_DATA_DIR = "data"


def get_default_data_directory():
    """获取默认数据目录路径"""
    # 获取项目根目录
    project_root = Path(__file__).parent.parent
    return str(project_root / DEFAULT_DATA_DIR)


def get_current_data_directory():
    """获取当前配置的数据目录路径
    
    优先级：
    1. 从数据库settings表获取用户设置的目录
    2. 从环境变量获取
    3. 使用默认目录
    """
    # 首先尝试从数据库获取配置
    try:
        from backend.database.operations import TodoDatabase
        db = TodoDatabase()
        # 获取用户设置的数据目录
        user_data_dir = db.get_setting('data_directory', None)
        if user_data_dir and isinstance(user_data_dir, str):
            return user_data_dir
    except Exception as e:
        print(f"警告：从数据库获取数据目录配置失败: {e}")
    
    # 回退到环境变量
    env_data_dir = os.environ.get('TODO_DATA_DIR')
    if env_data_dir:
        return env_data_dir
    
    # 最后使用默认目录
    return get_default_data_directory()


def set_data_directory(path):
    """设置数据目录路径
    
    Args:
        path (str): 新的数据目录路径
    """
    # 验证路径有效性
    if not path or not isinstance(path, str):
        raise ValueError("数据目录路径不能为空")
    
    path_obj = Path(path)
    
    # 检查路径是否存在，不存在则创建
    if not path_obj.exists():
        try:
            path_obj.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise ValueError(f"无法创建目录 {path}: {e}")
    
    # 检查是否有读写权限
    if not os.access(path, os.R_OK | os.W_OK):
        raise PermissionError(f"没有对目录 {path} 的读写权限")
    
    # 保存到数据库settings表
    try:
        from backend.database.operations import TodoDatabase
        db = TodoDatabase()
        # 保存用户设置的数据目录
        db.set_setting('data_directory', path)
        # 同时保存默认数据目录作为参考
        db.set_setting('default_data_directory', get_default_data_directory())
        print(f"数据目录配置已保存到数据库: {path}")
    except Exception as e:
        print(f"警告：保存数据目录配置到数据库失败: {e}")
        # 如果数据库保存失败，仍然使用环境变量作为后备
        os.environ['TODO_DATA_DIR'] = path
    
    return True
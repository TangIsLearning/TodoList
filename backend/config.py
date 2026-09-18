"""
TodoList应用的配置文件
"""

from pathlib import Path

# 应用配置
APP_NAME = "Todo List"
APP_VERSION = "0.1.0-alpha"
APP_WIDTH = 1000
APP_HEIGHT = 700
APP_MIN_WIDTH = 800
APP_MIN_HEIGHT = 600

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

def get_default_data_file() -> str:
    """获取默认数据文件路径"""
    # 获取项目根目录
    project_root = Path(__file__).parent.parent
    return str(project_root / DEFAULT_DATA_FILE)
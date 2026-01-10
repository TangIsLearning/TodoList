"""
TodoList应用的配置文件
"""

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
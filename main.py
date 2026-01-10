#!/usr/bin/env python3
"""
TodoList桌面应用启动脚本
"""

import sys
import os
from pathlib import Path

# 获取项目根目录
project_root = Path(__file__).parent
backend_dir = project_root / 'backend'

Path(backend_dir).mkdir(parents=True, exist_ok=True)

# 添加后端目录到Python路径
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# 切换到backend目录作为工作目录
os.chdir(str(backend_dir))

# 导入并启动应用
try:
    from backend import start
    from backend.utils.logger import app_logger
    
    app_logger.info("=" * 60)
    app_logger.info("从 main.py 启动 TodoList 应用")
    app_logger.info("=" * 60)
    start.start_app(window=None)
except ImportError as e:
    print(f"导入错误: {e}")
    print("请检查Python环境是否正确安装了依赖：pip install pywebview")
    sys.exit(1)
except Exception as e:
    print(f"启动应用失败: {e}")
    sys.exit(1)
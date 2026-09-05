#!/usr/bin/env python3
"""
TodoList桌面应用启动脚本
"""

import sys
import os
from pathlib import Path

# 1. 代码根目录（只读）与数据存储目录（可写）分离
project_root = Path(__file__).parent

# 检查是否在打包环境（AppImage / PyInstaller 单文件模式）下运行
if hasattr(sys, '_MEIPASS'):
    # 如果是打包环境，将可写目录指向用户家目录下的 .todolist 文件夹
    data_dir = Path.home() / '.todolist'
else:
    # 如果是本地开发环境，依然保存在项目根目录下
    data_dir = project_root

# 2. 在安全的可写路径下创建 backend 文件夹
backend_dir = data_dir / 'backend'
Path(backend_dir).mkdir(parents=True, exist_ok=True)  # 此时不会再报只读错误

# 3. 将【代码】的 backend 目录添加到 Python 路径（依然从解压后的只读路径读取代码）
code_backend_dir = project_root / 'backend'
if str(code_backend_dir) not in sys.path:
    sys.path.insert(0, str(code_backend_dir))

# 4. 切换到可写的工作目录
os.chdir(str(data_dir))

from backend.platforms.core.factory import get_platform_service
service = get_platform_service()
backend_logger = service.backend_logger()

if __name__ == '__main__':
    try:
        from backend import start

        backend_logger.info("=" * 60)
        backend_logger.info("从 main.py 启动 TodoList 应用")
        backend_logger.info("=" * 60)

        service.start_prepare()
        service.start_app()

    except ImportError as e:
        print(f"导入错误: {e}")
        print("请检查Python环境是否正确安装了依赖：pip install pywebview")
        sys.exit(1)
    except Exception as e:
        print(f"启动应用失败: {e}")
        sys.exit(1)
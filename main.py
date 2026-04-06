#!/usr/bin/env python3
"""
TodoList桌面应用启动脚本
"""

import sys
import os
from pathlib import Path
from backend.reminder.task_reminder import start_reminder, stop_reminder

# 获取项目根目录
project_root = Path(__file__).parent
backend_dir = project_root / 'backend'

Path(backend_dir).mkdir(parents=True, exist_ok=True)

# 添加后端目录到Python路径
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# 切换到backend目录作为工作目录
os.chdir(str(backend_dir))

if sys.platform == 'darwin':
    import multiprocessing
    ctx = multiprocessing.get_context('spawn')
    Process = ctx.Process
    Queue = ctx.Queue
else:
    import multiprocessing
    Process = multiprocessing.Process
    Queue = multiprocessing.Queue

webview_process = None

if __name__ == '__main__':
    def start_webview_process():
        global webview_process
        webview_process = Process(target=start.start_app)
        webview_process.start()

    def on_open(icon=None, item=None):
        global webview_process
        if not webview_process.is_alive():
            start_webview_process()

    def on_exit(icon, item):
        icon.stop()

    # 导入并启动应用
    try:
        from backend import start
        from backend.utils.logger import app_logger

        app_logger.info("=" * 60)
        app_logger.info("从 main.py 启动 TodoList 应用")
        app_logger.info("=" * 60)

        if hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ:
            # 启动任务提醒服务
            app_logger.info("启动任务提醒服务...")
            start_reminder()
            start.start_app()
        else:
            from PIL import Image
            from pystray import Icon, Menu, MenuItem
            from multiprocessing import Process

            # 用于解决打包后的多进程问题
            multiprocessing.freeze_support()

            # 启动任务提醒服务
            app_logger.info("启动任务提醒服务...")
            start_reminder(click_event=on_open)

            webview_process = Process(target=start.start_app)
            webview_process.start()

            image = Image.open(Path(os.path.dirname(__file__), "todo_icon.ico"))
            menu = Menu(MenuItem('打开应用', on_open, default=True), MenuItem('彻底退出', on_exit))
            icon = Icon('TodoList', image, menu=menu, title='TodoList')
            icon.run()

            webview_process.terminate()

        # 应用关闭时停止提醒服务
        app_logger.info("停止任务提醒服务...")
        stop_reminder()
    except ImportError as e:
        print(f"导入错误: {e}")
        print("请检查Python环境是否正确安装了依赖：pip install pywebview")
        sys.exit(1)
    except Exception as e:
        print(f"启动应用失败: {e}")
        sys.exit(1)
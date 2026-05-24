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

def run_tkinter_process():
    if sys.platform != 'darwin':
        from backend.keyboard.smart_task import SmartTaskInput
        smart_task = SmartTaskInput()
        smart_task.run()

if __name__ == '__main__':
    if sys.platform == 'darwin':
        # 强制在主线程预热 TIS API，防止后台线程后续并发调用导致崩溃
        import ctypes
        import ctypes.util

        try:
            # 加载 Carbon 框架并调用一次获取当前输入源
            carbon = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/Carbon.framework/Carbon')
            carbon.TISCopyCurrentKeyboardInputSource()
        except Exception:
            pass

    def start_webview_process():
        global webview_process
        webview_process = Process(target=start.start_app)
        webview_process.start()

    def on_open(icon=None, item=None):
        global webview_process
        import threading
        with threading.Lock():
            if webview_process is None or not webview_process.is_alive():
                # 如果存在僵尸进程，先清理
                if webview_process is not None:
                    webview_process.terminate()
                    webview_process.join()
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
            from backend.utils import utils

            # 用于解决打包后的多进程问题
            multiprocessing.freeze_support()

            # 启动任务提醒服务
            app_logger.info("启动任务提醒服务...")
            start_reminder(click_event=on_open)

            # 由于进程问题，当前功能不完备，因而不在mac桌面端启用快捷键功能
            if sys.platform != 'darwin':
                # 启动快捷键操作
                app_logger.info("启动快捷键操作...")
                tk_process = multiprocessing.Process(target=run_tkinter_process, daemon=True)
                tk_process.start()

            webview_process = Process(target=start.start_app)
            webview_process.start()

            image = Image.open(utils.get_app_icon())
            menu = Menu(MenuItem('打开应用', on_open, default=True), MenuItem('彻底退出', on_exit))
            icon = Icon('TodoList', image, menu=menu, title='TodoList')
            icon.run()

            # 退出时清理
            if webview_process and webview_process.is_alive():
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
#!/usr/bin/env python3
"""
TodoList桌面应用启动脚本
"""

import sys
import os
import logging
import backend.globals
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

def run_tkinter_process():
    if sys.platform != 'darwin':
        from backend.keyboard.smart_task import SmartTaskInput
        smart_task = SmartTaskInput()
        smart_task.run()

def force_kill_process_tree():
    """
    跨平台强制结束当前进程及其所有子进程。
    优先尝试优雅终止，超时后强制结束。
    """
    import subprocess
    import time
    import signal

    pid = os.getpid()
    app_logger.info(f"准备结束当前进程树，主进程PID: {pid}")

    try:
        if sys.platform == 'win32':
            # --- Windows ---
            # 优雅终止 (SIGTERM)
            subprocess.run(f'taskkill /PID {pid} /T', shell=True)
            time.sleep(2)
            # 强制终止 (SIGKILL)
            subprocess.run(f'taskkill /F /T /PID {pid}', shell=True, capture_output=True)

        elif sys.platform == 'darwin':
            # --- macOS ---
            # 优雅终止 (SIGTERM)
            subprocess.run(['kill', '-TERM', str(pid)])
            time.sleep(2)
            # 强制终止 (SIGKILL)
            subprocess.run(['kill', '-KILL', str(pid)])
            # 强制终止所有子进程，使用 pgrep -P 查找并传递给 kill -9[reference:5]
            subprocess.run(f'pgrep -P {pid} | xargs kill -9', shell=True)

        else:
            # --- Linux 或其他类Unix系统 ---
            # 优雅终止 (SIGTERM)
            os.kill(pid, signal.SIGTERM)
            time.sleep(2)
            # 强制终止 (SIGKILL)
            os.kill(pid, signal.SIGKILL)
            # 强制终止所有子进程
            subprocess.run(f'pgrep -P {pid} | xargs kill -9', shell=True)

    except Exception as e:
        app_logger.error(f"在尝试终止进程树时出错: {e}")

    app_logger.info("退出程序。")
    # 最后使用 os._exit 作为终极保障，确保程序退出
    os._exit(0)

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

    def on_open(icon=None, item=None):
        """显示已隐藏的窗口"""
        try:
            if backend.globals.window:
                backend.globals.window.show()
        except Exception:
            pass

    def on_exit(icon, item):
        """彻底退出：销毁窗口并停止托盘"""
        # 1. 停止任务提醒（释放 asyncio、WinRT 线程）
        try:
            stop_reminder()
        except Exception:
            pass

        # 2. 销毁 webview 窗口
        try:
            if backend.globals.window:
                backend.globals.window.destroy()
        except Exception:
            pass

        # 3. 停止托盘图标
        icon.stop()

        # 4. 关闭日志文件（防止占用）
        logging.shutdown()

        # 5. 强制退出进程（杀死所有残留线程）
        force_kill_process_tree()

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
            from backend.utils import utils

            # 快捷键进程（仅 Windows/Linux）
            if sys.platform != 'darwin':
                import multiprocessing
                multiprocessing.freeze_support()
                tk_process = multiprocessing.Process(target=run_tkinter_process, daemon=True)
                tk_process.start()

            # 启动任务提醒服务
            app_logger.info("启动任务提醒服务...")
            start_reminder(click_event=on_open)

            # 创建系统托盘，但不在主线程阻塞运行
            image = Image.open(utils.get_app_icon())
            menu = Menu(MenuItem('打开应用', on_open, default=True), MenuItem('彻底退出', on_exit))
            icon = Icon('TodoList', image, menu=menu, title='TodoList')
            # 在后台线程启动托盘
            icon.run_detached()

            # 主线程运行 WebView（阻塞直到窗口被 destroy）
            start.start_app()

    except ImportError as e:
        print(f"导入错误: {e}")
        print("请检查Python环境是否正确安装了依赖：pip install pywebview")
        sys.exit(1)
    except Exception as e:
        print(f"启动应用失败: {e}")
        sys.exit(1)
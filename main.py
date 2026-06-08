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

def force_kill_process_tree():
    """
    跨平台强制结束当前进程及其所有子进程。
    优先尝试优雅终止，超时后强制结束。
    """
    pid = os.getpid()
    app_logger.info(f"准备结束当前进程树，主进程PID: {pid}")

    try:
        from backend.platforms.core.factory import get_platform_service
        service = get_platform_service()
        service.force_kill_process_tree(pid)
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

    def clean_up_resources():
        """抽取出的公共清理逻辑，确保资源完全释放"""
        # 1. 停止任务提醒
        try:
            stop_reminder()
            app_logger.info("提醒服务已停止")
        except Exception as e:
            app_logger.info(f"停止提醒服务异常: {e}")

        # 2. 销毁 webview 窗口
        try:
            if backend.globals.window:
                backend.globals.window.destroy()
            app_logger.info("窗口已销毁")
        except Exception as e:
            app_logger.info(f"销毁窗口异常: {e}")

        # 3. 关闭日志
        logging.shutdown()

    def on_exit(icon, item):
        """点击系统托盘菜单的彻底退出"""
        app_logger.info("开始从托盘菜单执行彻底退出流程...")
        clean_up_resources()

        # 隐藏并停止托盘
        try:
            icon.visible = False
            icon.stop()
            app_logger.info("已向 Ubuntu 系统请求隐藏并关闭托盘")
        except Exception as e:
            app_logger.info(f"icon stop error: {e}")

        # 强制退出进程（杀死所有残留线程）
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
            app_logger.info("77777: WebView 窗口已关闭（通常是用户点击了窗口的 [X]）")

            # 如果主线程运行到这里，说明主窗口被关闭了，我们需要同步将托盘和进程连带一起关闭
            app_logger.info("正在清理托盘并彻底退出程序...")
            clean_up_resources()

            try:
                icon.visible = False
                icon.stop()
            except Exception:
                pass

            from backend.platforms.core.factory import get_platform_service
            service = get_platform_service()
            service.icon_exit()

            app_logger.info("8888: 进程收尾，彻底退出。")
            os._exit(0)

    except ImportError as e:
        print(f"导入错误: {e}")
        print("请检查Python环境是否正确安装了依赖：pip install pywebview")
        sys.exit(1)
    except Exception as e:
        print(f"启动应用失败: {e}")
        sys.exit(1)
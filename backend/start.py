#!/usr/bin/env python3
"""
Todo List 桌面应用主程序
使用 PyWebView 创建桌面应用窗口
"""

import os
import sys
from pathlib import Path

import webview
from backend.utils.logger import app_logger

# 获取当前目录
current_dir = Path(__file__).parent

# 设置默认窗口置顶为false
window_on_top = False

def get_resource_path(relative_path):
    """获取资源文件的绝对路径，支持打包后的可执行文件"""
    try:
        # PyInstaller创建临时文件夹，将路径存储在_MEIPASS中
        base_path = sys._MEIPASS
    except AttributeError:
        base_path = current_dir.parent
    
    # 如果是前端文件，需要特殊处理
    if relative_path.startswith('frontend/'):
        resource_path = os.path.join(base_path, relative_path)
        if not os.path.exists(resource_path):
            # 如果在临时目录中找不到，尝试在原目录结构中查找
            resource_path = os.path.join(current_dir.parent, relative_path)
    else:
        resource_path = os.path.join(base_path, relative_path)
    
    return resource_path

# 定义本地化字符串字典
chinese_localization = {
    'global.quitConfirmation': '温馨提示：\n关闭后，程序将最小化到系统托盘以保持消息后台提醒。\n如需彻底关闭，请在托盘右键退出~',
    'global.ok': '确定',
    'global.cancel': '取消'
}

def start_app():
    """启动TodoList桌面应用"""

    def on_closing():
        """窗口关闭点击事件：仅首次关闭弹窗提醒"""
        from backend.database.operations import TodoDatabase
        settings_db = TodoDatabase()
        confirm_close = settings_db.get_setting('confirm_close', True)
        is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ
        if is_android:
            backend.globals.window.confirm_close = False
        elif confirm_close:
            backend.globals.window.confirm_close = True
            settings_db.set_setting('confirm_close', False)
        else:
            backend.globals.window.confirm_close = False
        backend.globals.window.hide()
        return False  # 阻止窗口被销毁，从而实现控制窗口显示和隐藏，而非开启和关闭

    app_logger.info("=" * 60)
    app_logger.info("TodoList 应用启动")
    app_logger.info("=" * 60)

    # 创建一个极简的加载中 HTML 字符串，让窗口瞬间显示，避免白屏
    loading_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { background-color: #f5f5f5; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; color: #666; margin: 0; }
            .loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .container { text-align: center; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="loader"></div>
            <div>应用正在加载中，请稍候...</div>
        </div>
    </body>
    </html>
    """

    # 创建窗口：首先加载内存中的 loading 页面（零磁盘 I/O，瞬间弹出）
    app_logger.info("创建应用窗口并展示加载动画...")
    import backend.globals
    backend.globals.window = webview.create_window(
        'TodoList',
        html=loading_html,  # 【关键】改用 html= 启动，不传递文件路径
        js_api=None,  # 此时先不绑定 API，等全加载完后再载入
        width=1400,
        height=900,
        text_select=True,
        resizable=True
    )

    backend.globals.window.events.closing += on_closing

    # 将后端耗时初始化逻辑，放到初始化回调中异步执行
    def lazy_initialize(window):
        app_logger.info("异步后台：开始加载后端模块与初始化...")

        # 在子线程中延时或直接导入耗时模块
        from backend.api.todo_api import TodoApi
        from backend.webdav.data_sync import get_data_sync_manager
        from backend.utils import utils

        # 创建API实例
        api = TodoApi()
        app_logger.info("TodoApi 实例创建成功")

        # 初始化数据同步管理器
        app_logger.info("初始化数据同步管理器...")
        sync_manager = get_data_sync_manager()

        # 设置同步回调，当云端数据更新时刷新前端
        def on_sync_complete():
            try:
                if backend.globals.window:
                    js_str = """
                        // 重新加载任务列表
                        if (window.todoManager) { window.todoManager.loadTasks(); }
                        if (window.categoryManager) { window.categoryManager.loadCategories(); window.categoryManager.renderCategories(false); }
                        """
                    backend.globals.window.evaluate_js(js_str)
                    app_logger.info("前端页面已刷新以反映云端数据变化")
            except Exception as e:
                app_logger.error(f"同步回调执行失败: {e}")

        sync_manager.set_sync_callback(on_sync_complete)

        # 启动自动同步
        sync_manager.start_auto_sync()

        # 获取前端文件路径
        frontend_path = get_resource_path('frontend/index.html')
        app_logger.info(f"前端文件路径: {frontend_path}")
        # 重新绑定 API 并将窗口重定向到真正的业务前端文件
        window.set_title('TodoList')
        window.load_url(frontend_path)
        # 动态绑定之前延迟初始化的后台 API
        window._js_api = api
        window.on_top = utils.str_to_bool(api.db.get_setting('window_on_top', False))
        # 保存全局变量，以便在 finally 中能够正常关闭
        window.user_data = {'sync_manager': sync_manager}

        # 快捷键功能(仅在桌面端启用)
        service.start_keyboard(webview)

    app_logger.info("启动webview...")
    try:
        from backend.platforms.core.factory import get_platform_service
        service = get_platform_service()
        ssl_enable = service.is_ssl_enable()
        # 将 lazy_initialize 函数作为第一个参数传入
        # pywebview 启动窗口后会立即在后台启动一个线程执行此函数，解决Linux端窗口卡死问题
        webview.start(lazy_initialize, backend.globals.window,
                      private_mode=False, ssl=ssl_enable, debug=False, localization=chinese_localization)
    finally:
        # 窗口关闭后，停止自动同步
        app_logger.info("正在停止后台服务...")
        try:
            if hasattr(backend.globals.window, 'user_data') and 'sync_manager' in backend.globals.window.user_data:
                backend.globals.window.user_data['sync_manager'].stop_auto_sync()
        except Exception as e:
            app_logger.error(f"停止自动同步服务失败: {e}")
        app_logger.info("TodoList 应用已关闭")
        app_logger.info("=" * 60)

if __name__ == '__main__':
    start_app()
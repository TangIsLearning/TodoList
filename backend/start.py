#!/usr/bin/env python3
"""
Todo List 桌面应用主程序
使用 PyWebView 创建桌面应用窗口
"""

import webview
import os
import sys
from pathlib import Path

from backend.api.todo_api import TodoApi
from backend.utils.logger import app_logger
from backend.webdav.data_sync import get_data_sync_manager

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

    def bind(*args):
        """绑定窗口置顶点击事件"""
        button = backend.globals.window.dom.get_element('#window-top-toggle')
        button.events.change += change_handler

    def change_handler(e):
        """窗口置顶点击事件"""
        global window_on_top
        window_on_top = not window_on_top
        app_logger.info("TodoList 应用当前是否设置置顶：" + str(window_on_top))
        backend.globals.window.on_top = window_on_top

    def on_closing():
        """窗口关闭点击事件：仅首次关闭弹窗提醒"""
        from backend.database.operations import TodoDatabase
        settings_db = TodoDatabase()
        confirm_close = settings_db.get_setting('confirm_close', True)
        is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ
        if confirm_close or not is_android:
            backend.globals.window.confirm_close = True
            settings_db.set_setting('confirm_close', False)
        else:
            backend.globals.window.confirm_close = False

    app_logger.info("=" * 60)
    app_logger.info("TodoList 应用启动")
    app_logger.info("=" * 60)
    
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
                    if (window.todoManager) {
                        window.todoManager.loadTasks();
                    }
                    if (window.categoryManager) {
                        window.categoryManager.loadCategories();
                        window.categoryManager.renderCategories(false);
                    }
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

    # 创建窗口
    app_logger.info("创建应用窗口...")
    import backend.globals
    backend.globals.window = webview.create_window(
        'TodoList',
        frontend_path,
        js_api=api,
        width=1400,
        height=900,
        text_select=True,
        resizable=True
    )

    backend.globals.window.events.closing += on_closing

    app_logger.info("启动webview...")
    webview.start(bind, backend.globals.window, private_mode=False, ssl=True, debug=False, localization= chinese_localization)

    app_logger.info("TodoList 应用已关闭")
    app_logger.info("=" * 60)

if __name__ == '__main__':
    start_app()
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
from backend.utils.task_reminder import start_reminder, stop_reminder
from backend.utils.logger import app_logger

# 获取当前目录
current_dir = Path(__file__).parent

# 设置全局窗口
window = None

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

def start_app(window):
    """启动TodoList桌面应用"""

    def bind(window):
        """绑定窗口置顶点击事件"""
        button = window.dom.get_element('#window-top-toggle')
        button.events.change += change_handler

    def change_handler(e):
        """窗口置顶点击事件"""
        global window_on_top
        window_on_top = not window_on_top
        app_logger.info("TodoList 应用当前是否设置置顶：" + str(window_on_top))
        window.on_top = window_on_top

    app_logger.info("=" * 60)
    app_logger.info("TodoList 应用启动")
    app_logger.info("=" * 60)
    
    # 创建API实例
    api = TodoApi()
    app_logger.info("TodoApi 实例创建成功")
    
    # 启动任务提醒服务
    app_logger.info("启动任务提醒服务...")
    start_reminder()
    
    # 获取前端文件路径
    frontend_path = get_resource_path('frontend/index.html')
    app_logger.info(f"前端文件路径: {frontend_path}")

    # 创建窗口
    app_logger.info("创建应用窗口...")
    window = webview.create_window(
        'Todo-List',
        frontend_path,
        js_api=api,
        width=1400,
        height=900,
        resizable=True
    )

    app_logger.info("启动webview...")
    webview.start(bind, window, ssl=True, debug=True)
    
    # 应用关闭时停止提醒服务
    app_logger.info("停止任务提醒服务...")
    stop_reminder()
    app_logger.info("TodoList 应用已关闭")
    app_logger.info("=" * 60)

if __name__ == '__main__':
    start_app(window)
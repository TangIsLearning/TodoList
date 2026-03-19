#!/usr/bin/env python3
"""
任务到期提醒功能模块
支持桌面端通知栏消息提醒
"""

import threading
import time
import sys
import os
import platform
import backend.globals
from datetime import datetime
from queue import Queue
from backend.utils import utils
from backend.database.operations import TodoDatabase
from backend.utils.logger import app_logger


class TaskReminder:
    """任务到期提醒器"""
    
    def __init__(self):
        self.running = False
        self.check_interval = 30  # 检查间隔(秒),默认30秒
        self.notification_queue = Queue()
        self.db = TodoDatabase()
        self.notified_tasks = set()  # 已提醒的任务ID集合
        self.scheduled_tasks = {}  # 已安排提醒的任务 {task_id: due_datetime}
        self.check_thread = None
        self.asyncio_thread = None
        self.notify_thread = None
        self.system = platform.system()
        self.notifier = None
        self.is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ
        if not self.is_android:
            import asyncio
            self.loop = asyncio.new_event_loop()

    def start(self):
        """启动提醒服务"""
        if self.running:
            return
            
        self.running = True
        self.notified_tasks.clear()
        self.scheduled_tasks.clear()
        
        # 启动检查线程
        self.check_thread = threading.Thread(target=self._check_tasks, daemon=True)
        self.check_thread.start()

        # 专门负责运行 asyncio 循环的线程
        self.asyncio_thread = threading.Thread(target=self._run_asyncio, daemon=True)
        self.asyncio_thread.start()

        # 启动通知线程
        self.notify_thread = threading.Thread(target=self._process_notifications, daemon=True)
        self.notify_thread.start()
        
        app_logger.info("任务到期提醒服务已启动")
        
    def stop(self):
        """停止提醒服务"""
        self.running = False
        if self.check_thread:
            self.check_thread.join(timeout=2)
        if self.notify_thread:
            self.notify_thread.join(timeout=2)
        app_logger.info("任务到期提醒服务已停止")
        
    def _check_tasks(self):
        """后台线程检查任务到期"""
        while self.running:
            try:
                # 获取所有未完成的任务
                tasks = self.db.get_all_tasks()
                now = datetime.now()
                
                for task in tasks:
                    # 跳过已完成的任务
                    if task['completed']:
                        continue
                        
                    # 跳过没有截止时间的任务
                    if not task.get('dueDate'):
                        continue
                        
                    # 解析截止时间
                    try:
                        due_date = datetime.fromisoformat(task['dueDate'])
                    except (ValueError, TypeError):
                        continue
                    
                    task_id = task['id']
                    
                    # 检查任务是否到期
                    if now >= due_date:
                        # 如果任务已过期且未被提醒过
                        if task_id not in self.notified_tasks:
                            # 添加到提醒队列
                            self.notification_queue.put({
                                'task_id': task_id,
                                'title': task['title'],
                                'due_date': due_date,
                                'priority': task.get('priority', 'none')
                            })
                            
                            # 记录已提醒的任务
                            self.notified_tasks.add(task_id)
                    else:
                        # 未到期的任务,记录以便后续检查
                        self.scheduled_tasks[task_id] = due_date
                
                # 清理已完成任务的提醒记录
                self._cleanup_completed_tasks(tasks)
                
            except Exception as e:
                print(f"检查任务时出错: {e}")
            
            # 等待下一次检查
            time.sleep(self.check_interval)

    def _run_asyncio(self):
        # 专门负责运行 asyncio 循环的线程
        import asyncio
        asyncio.set_event_loop(self.loop)
        from desktop_notifier import DesktopNotifier

        self.notifier = DesktopNotifier(
            app_name="TodoList",
            app_icon=utils.get_app_icon(),
            notification_limit=5,
        )
        self.loop.run_forever()

    def _cleanup_completed_tasks(self, current_tasks):
        """清理已完成或已删除任务的记录"""
        current_task_ids = {task['id'] for task in current_tasks}
        
        # 清理已删除任务的通知记录
        to_remove = []
        for task_id in list(self.notified_tasks):
            if task_id not in current_task_ids:
                to_remove.append(task_id)
        
        for task_id in to_remove:
            self.notified_tasks.discard(task_id)
            self.scheduled_tasks.pop(task_id, None)
            
    def _process_notifications(self):
        """处理提醒通知"""
        while self.running:
            try:
                notification = self.notification_queue.get(timeout=1)
                if not self.is_android:
                    import asyncio
                    asyncio.run_coroutine_threadsafe(self._show_notification(notification), self.loop)
            except Exception as e:
                pass  # 队列为空或超时

    async def _show_notification(self, notification):
        """显示系统通知"""
        def force_focus(window_title):
            """强制聚焦屏幕"""
            import win32gui
            import win32con
            hwnd = win32gui.FindWindow(None, window_title)
            if hwnd:
                # 恢复窗口（如果最小化）
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                # 强制推至前台
                win32gui.SetForegroundWindow(hwnd)

        def on_click():
            """定义点击通知时的回调函数"""
            print("用户点击了通知，准备唤醒窗口...")
            # 关键判断：确保窗口实例存在且未被销毁
            if backend.globals.window:
                try:
                    # 1. 从最小化恢复
                    backend.globals.window.restore
                    # 2. 提到最前显示（如果之前是 hide 状态）
                    backend.globals.window.show
                    # 3. 某些平台下可能需要额外聚焦
                    backend.globals.window.focus
                    force_focus("TodoList")
                except Exception as e:
                    print(f"唤醒失败，窗口可能已关闭: {e}")
            else:
                print("错误：找不到窗口实例！")

        try:
            task_title = notification['title']
            due_date = notification['due_date']
            priority = notification['priority']
            
            # 计算过期时长
            now = datetime.now()
            overdue_duration = now - due_date
            
            if overdue_duration.days > 0:
                time_str = f"{overdue_duration.days}天前"
            elif overdue_duration.seconds >= 3600:
                hours = overdue_duration.seconds // 3600
                time_str = f"{hours}小时前"
            else:
                minutes = overdue_duration.seconds // 60
                time_str = f"{minutes}分钟前"
            
            # 构建通知消息
            message = f"任务「{task_title}」已于{time_str}到期"
            
            # 根据优先级设置提醒标题
            if priority == 'high':
                title = "⚠️ 高优先级任务到期提醒"
            elif priority == 'medium':
                title = "📋 任务到期提醒"
            else:
                title = "📝 任务到期提醒"

            from desktop_notifier.common import Button
            from desktop_notifier import Urgency
            await self.notifier.send(
                title=title,
                message=message,
                urgency=Urgency.Critical if priority == 'high' else Urgency.Normal,
                on_clicked=lambda: on_click(),
                timeout=0  # 0表示通知常驻
            )
        except Exception as e:
            print(f"显示通知时出错: {e}")

    def reset_notified_tasks(self):
        """重置已提醒任务列表(用于测试或重新提醒)"""
        self.notified_tasks.clear()
        print("已重置已提醒任务列表")
    
    def get_pending_tasks_count(self):
        """获取待提醒的任务数量"""
        return len(self.scheduled_tasks) - len(self.notified_tasks)


# 全局提醒器实例
_reminder = None

def get_reminder():
    """获取提醒器单例"""
    global _reminder
    if _reminder is None:
        _reminder = TaskReminder()
    return _reminder

def start_reminder():
    """启动提醒服务"""
    reminder = get_reminder()
    reminder.start()
    return reminder

def stop_reminder():
    """停止提醒服务"""
    reminder = get_reminder()
    reminder.stop()

def reset_reminder():
    """重置提醒器状态"""
    reminder = get_reminder()
    reminder.reset_notified_tasks()

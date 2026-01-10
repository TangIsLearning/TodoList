#!/usr/bin/env python3
"""
任务到期提醒功能模块
支持Windows系统通知栏消息提醒
"""

import threading
import time
from datetime import datetime, timedelta
from queue import Queue
import platform
import subprocess

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
        self.notify_thread = None
        self.system = platform.system()
        
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
                self._show_notification(notification)
            except Exception as e:
                pass  # 队列为空或超时
                
    def _show_notification(self, notification):
        """显示系统通知"""
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
            
            # 根据操作系统显示不同的通知
            if self.system == 'Windows':
                self._show_windows_notification(title, message)
            elif self.system == 'Darwin':  # macOS
                self._show_macos_notification(title, message)
            elif self.system == 'Linux':
                self._show_linux_notification(title, message)
            else:
                print(f"\n{title}\n{message}\n")
                
        except Exception as e:
            print(f"显示通知时出错: {e}")
    
    def _show_windows_notification(self, title, message):
        """在Windows系统显示通知"""
        try:
            # 使用Windows PowerShell显示Toast通知
            ps_script = f'''
            Add-Type -AssemblyName System.Windows.Forms
            $global:balloon = New-Object System.Windows.Forms.NotifyIcon
            $path = (Get-Process -Id $pid).Path
            $balloon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
            $balloon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
            $balloon.BalloonTipText = '{message}'
            $balloon.BalloonTipTitle = '{title}'
            $balloon.Visible = $true
            $balloon.ShowBalloonTip(10000)
            Start-Sleep -Seconds 10
            $balloon.Dispose()
            '''
            
            # 执行PowerShell脚本
            result = subprocess.run(
                ['powershell', '-Command', ps_script],
                capture_output=True,
                text=True,
                timeout=15
            )
            
            if result.returncode != 0:
                print(f"Windows通知执行失败: {result.stderr}")
                
        except Exception as e:
            print(f"显示Windows通知失败: {e}")
    
    def _show_macos_notification(self, title, message):
        """在macOS系统显示通知"""
        try:
            script = f'display notification "{message}" with title "{title}"'
            subprocess.run(['osascript', '-e', script], timeout=5)
        except Exception as e:
            print(f"显示macOS通知失败: {e}")
    
    def _show_linux_notification(self, title, message):
        """在Linux系统显示通知"""
        try:
            subprocess.run([
                'notify-send',
                title,
                message
            ], timeout=5)
        except Exception as e:
            print(f"显示Linux通知失败: {e}")
    
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

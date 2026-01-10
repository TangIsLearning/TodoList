#!/usr/bin/env python3
"""
测试任务到期提醒功能
使用Windows通知栏显示提醒
"""

import sys
import os
import time
from pathlib import Path
from datetime import datetime, timedelta

# 添加backend目录到路径
backend_dir = Path(__file__).parent / 'backend'
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.database.operations import TodoDatabase
from backend.utils.task_reminder import start_reminder, stop_reminder


def create_test_tasks():
    """创建测试任务"""
    db = TodoDatabase()
    
    now = datetime.now()
    
    # 任务1: 即将到期(当前时间+30秒)
    due_soon = now + timedelta(seconds=30)
    task1 = {
        'title': '测试任务-即将到期',
        'description': '这个任务将在30秒后到期',
        'completed': False,
        'priority': 'high',
        'dueDate': due_soon.isoformat()
    }
    
    # 任务2: 已过期
    due_overdue = now - timedelta(minutes=2)
    task2 = {
        'title': '测试任务-已过期',
        'description': '这个任务已经过期2分钟',
        'completed': False,
        'priority': 'medium',
        'dueDate': due_overdue.isoformat()
    }
    
    # 任务3: 低优先级即将到期
    due_low = now + timedelta(seconds=45)
    task3 = {
        'title': '测试任务-低优先级',
        'description': '低优先级任务45秒后到期',
        'completed': False,
        'priority': 'low',
        'dueDate': due_low.isoformat()
    }
    
    # 任务4: 无截止时间(不应提醒)
    task4 = {
        'title': '测试任务-无截止时间',
        'description': '这个任务没有截止时间',
        'completed': False,
        'priority': 'none',
        'dueDate': None
    }
    
    # 任务5: 已完成(不应提醒)
    task5 = {
        'title': '测试任务-已完成',
        'description': '这个任务已完成',
        'completed': True,
        'priority': 'high',
        'dueDate': (now - timedelta(minutes=1)).isoformat()
    }
    
    tasks = [task1, task2, task3, task4, task5]
    created = []
    
    try:
        for task in tasks:
            result = db.add_task(task)
            created.append(result)
        
        print("=" * 60)
        print("创建测试任务成功:")
        print("=" * 60)
        print(f"\n✓ 任务1(高优先级,即将到期): {task1['title']}")
        print(f"  到期时间: {due_soon.strftime('%H:%M:%S')}")
        print(f"\n✓ 任务2(中优先级,已过期): {task2['title']}")
        print(f"  过期时间: {due_overdue.strftime('%H:%M:%S')}")
        print(f"\n✓ 任务3(低优先级,即将到期): {task3['title']}")
        print(f"  到期时间: {due_low.strftime('%H:%M:%S')}")
        print(f"\n✓ 任务4(无截止时间): {task4['title']}")
        print(f"  不会收到提醒")
        print(f"\n✓ 任务5(已完成): {task5['title']}")
        print(f"  不会收到提醒")
        print()
        return True
    except Exception as e:
        print(f"✗ 创建测试任务失败: {e}")
        return False


def cleanup_test_tasks():
    """清理测试任务"""
    try:
        db = TodoDatabase()
        tasks = db.get_all_tasks()
        
        # 删除所有以"测试任务"开头的任务
        for task in tasks:
            if task['title'].startswith('测试任务'):
                db.delete_task(task['id'])
        
        print("\n测试任务已清理")
    except Exception as e:
        print(f"清理测试任务时出错: {e}")


def test_reminder_basic():
    """基本提醒功能测试"""
    print("\n" + "=" * 60)
    print("任务到期提醒功能测试")
    print("=" * 60)
    print()
    
    # 创建测试任务
    if not create_test_tasks():
        return
    
    # 启动提醒服务
    print("正在启动提醒服务...")
    reminder = start_reminder()
    print("✓ 提醒服务已启动")
    print()
    
    print("提醒服务正在运行:")
    print("- 检查间隔: 30秒")
    print("- 通知方式: Windows系统通知")
    print()
    print("预期结果:")
    print("1. 立即: 看到「测试任务-已过期」的通知")
    print("2. 约30秒后: 看到「测试任务-即将到期」的通知")
    print("3. 约45秒后: 看到「测试任务-低优先级」的通知")
    print()
    print("注意: 请查看Windows右下角通知栏")
    print()
    print("=" * 60)
    print("按 Ctrl+C 停止测试")
    print("=" * 60)
    print()
    
    try:
        # 保持运行
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n")
        print("正在停止提醒服务...")
        stop_reminder()
        print("✓ 提醒服务已停止")
        
        # 清理测试任务
        cleanup_test_tasks()
        print("测试结束")


if __name__ == '__main__':
    test_reminder_basic()

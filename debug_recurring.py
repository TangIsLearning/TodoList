#!/usr/bin/env python3
"""
调试周期性任务功能
"""

import sys
from pathlib import Path

# 添加后端路径
backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))

from database.operations import TodoDatabase
from datetime import datetime, timedelta

def debug_recurring_tasks():
    """调试周期性任务"""
    print("开始调试周期性任务...")
    
    # 初始化数据库
    db = TodoDatabase()
    
    # 清理现有测试数据（可选）
    # db.delete_all_tasks()  # 如果有这个方法的话
    
    # 创建测试周期性任务
    tomorrow = datetime.now() + timedelta(days=1)
    test_task_data = {
        'title': '测试周期任务',
        'description': '这是一个测试周期性任务',
        'priority': 'medium',
        'categoryId': None,
        'dueDate': tomorrow.isoformat(),
        'isRecurring': True,
        'recurrenceType': 'weekly',
        'recurrenceInterval': 1,
        'recurrenceCount': 3
    }
    
    print(f"创建周期性任务: {test_task_data}")
    
    try:
        # 创建周期性任务
        tasks = db.create_recurring_tasks(test_task_data)
        print(f"成功创建 {len(tasks)} 个任务")
        
        # 获取所有任务并检查数据结构
        all_tasks = db.get_all_tasks()
        print(f"\n数据库中共有 {len(all_tasks)} 个任务")
        
        for i, task in enumerate(all_tasks, 1):
            print(f"任务 {i}:")
            print(f"  ID: {task['id']}")
            print(f"  标题: {task['title']}")
            print(f"  是否周期性: {task.get('isRecurring', 'missing')}")
            print(f"  周期类型: {task.get('recurrenceType', 'missing')}")
            print(f"  父任务ID: {task.get('parentTaskId', 'missing')}")
            print(f"  截止日期: {task.get('dueDate', 'missing')}")
            print()
            
            # 验证字段是否存在
            required_fields = ['isRecurring', 'recurrenceType', 'recurrenceInterval', 'recurrenceCount', 'parentTaskId']
            missing_fields = [field for field in required_fields if field not in task]
            if missing_fields:
                print(f"  ❌ 缺少字段: {missing_fields}")
            else:
                print(f"  ✅ 所有字段都存在")
            print()
        
        # 测试获取单个任务
        if tasks:
            first_task = db.get_task(tasks[0]['id'])
            print(f"获取单个任务测试:")
            print(f"  isRecurring: {first_task.get('isRecurring', 'missing')}")
            print(f"  parentTaskId: {first_task.get('parentTaskId', 'missing')}")
        
    except Exception as e:
        print(f"❌ 调试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_recurring_tasks()
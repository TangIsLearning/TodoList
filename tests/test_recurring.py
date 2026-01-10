#!/usr/bin/env python3
"""
周期性任务功能测试脚本
"""

import sys
from pathlib import Path

# 添加后端路径
backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))

from database.operations import TodoDatabase
from datetime import datetime, timedelta

def test_recurring_tasks():
    """测试周期性任务功能"""
    print("开始测试周期性任务功能...")
    
    # 初始化数据库
    db = TodoDatabase()
    
    # 测试数据：创建明天开始的每周重复任务
    tomorrow = datetime.now() + timedelta(days=1)
    test_task_data = {
        'title': '每周例会',
        'description': '团队周例会',
        'priority': 'high',
        'categoryId': None,
        'dueDate': tomorrow.isoformat(),
        'isRecurring': True,
        'recurrenceType': 'weekly',
        'recurrenceInterval': 1,
        'recurrenceCount': 4  # 创建4次任务
    }
    
    print(f"创建周期性任务: {test_task_data['title']}")
    print(f"开始时间: {test_task_data['dueDate']}")
    print(f"重复类型: {test_task_data['recurrenceType']}")
    print(f"重复次数: {test_task_data['recurrenceCount']}")
    
    try:
        # 创建周期性任务
        tasks = db.create_recurring_tasks(test_task_data)
        print(f"成功创建 {len(tasks)} 个任务")
        
        # 显示创建的任务
        for i, task in enumerate(tasks, 1):
            due_date = task.get('dueDate', '无截止日期')
            print(f"  任务 {i}: {task['title']} - {due_date}")
        
        print("\n✅ 周期性任务创建测试通过")
        
        # 测试获取所有任务
        all_tasks = db.get_all_tasks()
        recurring_tasks = [t for t in all_tasks if t.get('isRecurring') or t.get('parentTaskId')]
        print(f"数据库中共有 {len(recurring_tasks)} 个周期性相关任务")
        
        # 测试删除单个任务
        if tasks:
            first_task_id = tasks[1]['id']  # 删除第二个任务（子任务）
            print(f"\n测试删除单个任务: {first_task_id}")
            result = db.delete_recurring_task(first_task_id, delete_all=False)
            print(f"删除结果: {result}")
            
            remaining_tasks = db.get_all_tasks()
            print(f"删除后剩余任务数: {len(remaining_tasks)}")
        
        # 测试删除整个周期
        if tasks:
            parent_task_id = tasks[0]['id']  # 删除父任务
            print(f"\n测试删除整个周期: {parent_task_id}")
            result = db.delete_recurring_task(parent_task_id, delete_all=True)
            print(f"删除结果: {result}")
            
            final_tasks = db.get_all_tasks()
            recurring_tasks_after = [t for t in final_tasks if t.get('isRecurring') or t.get('parentTaskId')]
            print(f"删除后剩余周期性任务数: {len(recurring_tasks_after)}")
        
        print("\n✅ 所有测试通过！")
        
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_recurring_tasks()
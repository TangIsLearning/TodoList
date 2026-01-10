"""
测试分页功能的脚本
"""

import sys
from pathlib import Path

# 添加backend目录到Python路径
backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))

from database.operations import TodoDatabase

def test_pagination():
    """测试分页功能"""
    print("测试分页功能...")
    
    db = TodoDatabase()
    
    # 测试1: 获取第一页，每页10条
    print("\n=== 测试1: 第一页，每页10条 ===")
    result = db.get_tasks_paginated(page=1, page_size=10)
    print(f"总数: {result['total']}")
    print(f"当前页: {result['page']}")
    print(f"每页数量: {result['page_size']}")
    print(f"总页数: {result['total_pages']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试2: 按优先级筛选
    print("\n=== 测试2: 按高优先级筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, priority='high')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试3: 按状态筛选（未完成）
    print("\n=== 测试3: 按未完成状态筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, status='uncompleted')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试4: 按状态筛选（未完成且未逾期）
    print("\n=== 测试4: 按未完成未逾期筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, status='pending')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试5: 按状态筛选（未完成且已逾期）
    print("\n=== 测试5: 按未完成已逾期筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, status='overdue')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试6: 按日期筛选（今天）
    print("\n=== 测试6: 按今天日期筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, due_date_filter='today')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试7: 按日期筛选（本周内）
    print("\n=== 测试7: 按本周内筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, due_date_filter='week')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试8: 按日期筛选（无截止日期）
    print("\n=== 测试8: 按无截止日期筛选 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, due_date_filter='no-due-date')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试9: 自定义日期筛选
    print("\n=== 测试9: 自定义日期筛选 ===")
    from datetime import datetime
    custom_date = datetime.now().date().isoformat()
    result = db.get_tasks_paginated(page=1, page_size=10, custom_date=custom_date)
    print(f"筛选日期: {custom_date}")
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试10: 搜索关键词
    print("\n=== 测试10: 搜索关键词 ===")
    result = db.get_tasks_paginated(page=1, page_size=10, search_query='test')
    print(f"搜索关键词: test")
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    # 测试11: 组合筛选
    print("\n=== 测试11: 组合筛选（高优先级 + 未完成） ===")
    result = db.get_tasks_paginated(page=1, page_size=10, priority='high', status='uncompleted')
    print(f"总数: {result['total']}")
    print(f"返回任务数: {len(result['tasks'])}")
    
    print("\n=== 分页功能测试完成 ===")

if __name__ == '__main__':
    test_pagination()

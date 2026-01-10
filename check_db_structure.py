#!/usr/bin/env python3
"""
检查数据库表结构
"""

import sys
from pathlib import Path

# 添加后端路径
backend_dir = Path(__file__).parent / 'backend'
sys.path.insert(0, str(backend_dir))

from database.operations import TodoDatabase

def check_database_structure():
    """检查数据库表结构"""
    print("检查数据库表结构...")
    
    # 初始化数据库
    db = TodoDatabase()
    
    conn = db.get_connection() if hasattr(db, 'get_connection') else None
    if not conn:
        import sqlite3
        conn = sqlite3.connect(db.db_path)
    
    cursor = conn.cursor()
    
    # 获取tasks表的结构
    cursor.execute("PRAGMA table_info(tasks)")
    columns = cursor.fetchall()
    
    print("tasks表结构:")
    for i, col in enumerate(columns):
        print(f"  {i}: {col[1]} {col[2]} (NOT NULL: {bool(col[3])}, DEFAULT: {col[4]})")
    
    print("\n字段索引:")
    for i, col in enumerate(columns):
        print(f"  索引 {i}: {col[1]}")
    
    conn.close()
    
    # 检查是否有足够的新字段
    new_fields = ['is_recurring', 'recurrence_type', 'recurrence_interval', 'recurrence_count', 'parent_task_id']
    existing_fields = [col[1] for col in columns]
    
    print(f"\n检查新字段:")
    for field in new_fields:
        exists = field in existing_fields
        print(f"  {field}: {'✅ 存在' if exists else '❌ 缺失'}")
    
    return len([f for f in new_fields if f in existing_fields]) == len(new_fields)

if __name__ == "__main__":
    success = check_database_structure()
    print(f"\n数据库结构{'✅ 正确' if success else '❌ 有问题'}")
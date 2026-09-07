import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional

class TaskRelationCrudMixin:

    def add_task_relation(self, sub_task_id: str, main_task_id: str) -> None:
        """添加或更新一条关联（确保单父）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        # 由于 UNIQUE(task_id) 约束，直接用 INSERT OR REPLACE 即可
        cursor.execute('''
            INSERT OR REPLACE INTO task_relations (sub_task_id, main_task_id, created_at)
            VALUES (?, ?, ?)
        ''', (sub_task_id, main_task_id, datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def _update_task_relation(self, sub_task_id: str, new_main_task_id: Optional[str]) -> None:
        """更新任务的父任务（new_parent_id 可为 None 表示删除）"""
        if new_main_task_id is None:
            self.delete_relation_by_children(sub_task_id)
        else:
            self.add_task_relation(sub_task_id, new_main_task_id)

    def delete_relation_by_children(self, task_id: str) -> None:
        """删除该任务作为子任务的关联"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM task_relations WHERE sub_task_id = ?', (task_id,))
        conn.commit()
        conn.close()

    def delete_relations_by_parent(self, task_id: str) -> None:
        """删除所有以 main_task_id 为父的关联"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM task_relations WHERE main_task_id = ?', (task_id,))
        conn.commit()
        conn.close()

    def get_children(self, task_id: str) -> List[Optional[Dict[str, Any]]]:
        """获取指定任务的所有直接子任务（单层查询）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        # 查询关联表中的子任务 ID
        cursor.execute('SELECT sub_task_id FROM task_relations WHERE main_task_id = ?', (task_id,))
        children = [self.get_task(row[0]) for row in cursor.fetchall()]
        conn.close()

        if not children:
            return []
        return children

    def get_parent(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务的父任务（如果有）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT main_task_id FROM task_relations WHERE sub_task_id = ?', (task_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return self.get_task(row[0])
        return None
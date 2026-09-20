# backend/database/mixins/category_crud_mixin.py
from typing import Any, Dict, List

from backend.database.models import Category


class CategoryCrudMixin:

    def add_category(self, category_data: Dict[str, Any]) -> Dict[str, Any]:
        """添加新分类"""
        category = Category(
            name=category_data.get('name', ''),
            color=category_data.get('color', '#007bff')
        )

        with self.tx() as conn:
            conn.execute(
                'INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)',
                (category.id, category.name, category.color, category.created_at.isoformat())
            )

        return category.to_dict()

    def get_all_categories(self) -> List[Dict[str, Any]]:
        """获取所有分类"""
        with self.query() as conn:
            rows = conn.execute(
                'SELECT id, name, color, created_at FROM categories ORDER BY name'
            ).fetchall()

        return [{
            'id': row['id'],
            'name': row['name'],
            'color': row['color'],
            'createdAt': row['created_at'],
        } for row in rows]

    def get_category_task_counts(self) -> Dict[str, Any]:
        """按分类统计未完成任务数（左侧分类计数专用）。

        返回两组计数，前端按场景各取所需：
            {'all': 未完成总数, 'total': 全部任务总数,
             'counts': {category_id: 未完成任务数},   # 左侧分类计数
             'totals': {category_id: 全部任务数}}      # 删除分类时的"受影响任务数"

        未分类任务只计入 all / total，不出现在按分类的字典中。
        """
        with self.query() as conn:
            all_uncompleted = conn.execute(
                'SELECT COUNT(*) AS count FROM tasks WHERE completed = 0'
            ).fetchone()['count']
            all_total = conn.execute(
                'SELECT COUNT(*) AS count FROM tasks'
            ).fetchone()['count']

            rows = conn.execute(
                'SELECT category_id, '
                'COUNT(*) AS total, '
                'SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS uncompleted '
                'FROM tasks WHERE category_id IS NOT NULL '
                'GROUP BY category_id'
            ).fetchall()

        return {
            'all': all_uncompleted,
            'total': all_total,
            'counts': {row['category_id']: row['uncompleted'] for row in rows},
            'totals': {row['category_id']: row['total'] for row in rows},
        }

    def update_category(self, category_id: str, category_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新分类"""
        name = category_data.get('name', '')
        color = category_data.get('color', '#007bff')

        with self.tx() as conn:
            conn.execute(
                'UPDATE categories SET name = ?, color = ? WHERE id = ?', (name, color, category_id))

        # 返回更新后的分类信息
        return {'id': category_id, 'name': name, 'color': color}

    def delete_category(self, category_id: str) -> None:
        """删除分类（先解除任务对该分类的引用，与删除在同一事务内）"""
        with self.tx() as conn:
            conn.execute('UPDATE tasks SET category_id = NULL WHERE category_id = ?', (category_id,))
            conn.execute('DELETE FROM categories WHERE id = ?', (category_id,))

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

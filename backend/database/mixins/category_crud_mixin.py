import sqlite3
from typing import Any, Dict, List
from backend.database.models import Category

class CategoryCrudMixin:

    def add_category(self, category_data: Dict[str, Any]) -> Dict[str, Any]:
        """添加新分类"""
        category = Category(
            name=category_data.get('name', ''),
            color=category_data.get('color', '#007bff')
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO categories (id, name, color, created_at)
            VALUES (?, ?, ?, ?)
        ''', (category.id, category.name, category.color, category.created_at.isoformat()))

        conn.commit()
        conn.close()

        return category.to_dict()

    def get_all_categories(self) -> List[Dict[str, Any]]:
        """获取所有分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('SELECT * FROM categories ORDER BY name')
        rows = cursor.fetchall()
        conn.close()

        categories = []
        for row in rows:
            category_dict = {
                'id': row[0],
                'name': row[1],
                'color': row[2],
                'createdAt': row[3]
            }
            categories.append(category_dict)

        return categories

    def update_category(self, category_id: str, category_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 更新分类信息
        cursor.execute('''
            UPDATE categories 
            SET name = ?, color = ? 
            WHERE id = ?
        ''', (category_data.get('name', ''), category_data.get('color', '#007bff'), category_id))

        conn.commit()
        conn.close()

        # 返回更新后的分类信息
        return {
            'id': category_id,
            'name': category_data.get('name', ''),
            'color': category_data.get('color', '#007bff')
        }

    def delete_category(self, category_id: str) -> None:
        """删除分类"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 先将该分类的任务的分类ID设为NULL
        cursor.execute('UPDATE tasks SET category_id = NULL WHERE category_id = ?', (category_id,))

        # 删除分类
        cursor.execute('DELETE FROM categories WHERE id = ?', (category_id,))

        conn.commit()
        conn.close()
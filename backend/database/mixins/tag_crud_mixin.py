# backend/database/mixins/tag_crud_mixin.py
from typing import Any, Dict, List, Optional, Sequence

from backend.database.mixins._helpers import chunks, placeholders
from backend.database.models import Tag

_TAG_COLUMNS = 'id, name, color, created_at'


def _row_to_tag(row: Any) -> Dict[str, Any]:
    return {
        'id': row['id'],
        'name': row['name'],
        'color': row['color'],
        'createdAt': row['created_at'],
    }


class TagCrudMixin:
    """标签 CRUD。

    对外方法自行管理连接；``_`` 开头且首参为 ``conn`` 的方法供其他 mixin
    在同一事务内复用（例如新增 / 查询任务时批量补齐标签）。
    """

    # ------------------------------------------------------------------ #
    # 关联维护
    # ------------------------------------------------------------------ #

    def _replace_tags(self, conn, task_id: str, tag_names: Optional[Sequence[str]]) -> None:
        """在同一事务内把任务的标签整体替换为 tag_names。"""
        conn.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))
        if not tag_names:
            return

        tag_ids: List[str] = []
        for tag_name in tag_names:
            if not tag_name:
                continue
            row = conn.execute('SELECT id FROM tags WHERE name = ?', (tag_name,)).fetchone()
            if row:
                tag_ids.append(row['id'])
            else:
                tag = Tag(name=tag_name)
                conn.execute(
                    f'INSERT INTO tags ({_TAG_COLUMNS}) VALUES (?, ?, ?, ?)',
                    (tag.id, tag.name, tag.color, tag.created_at.isoformat())
                )
                tag_ids.append(tag.id)

        if tag_ids:
            conn.executemany(
                'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)',
                [(task_id, tag_id) for tag_id in tag_ids]
            )

    def _task_tags_map(self, conn, task_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
        """批量获取多个任务的标签，返回 {task_id: [tag]}（一次查询，避免 N+1）。"""
        result: Dict[str, List[Dict[str, Any]]] = {tid: [] for tid in task_ids}
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return result

        for batch in chunks(ids):
            marks = placeholders(len(batch))
            rows = conn.execute(
                f'SELECT tt.task_id, t.id, t.name, t.color, t.created_at '
                f'FROM task_tags tt JOIN tags t ON t.id = tt.tag_id '
                f'WHERE tt.task_id IN ({marks}) '
                f'ORDER BY t.name',
                tuple(batch)
            ).fetchall()
            for row in rows:
                result.setdefault(row['task_id'], []).append(_row_to_tag(row))
        return result

    def get_task_tags(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的所有标签"""
        with self.query() as conn:
            return self._task_tags_map(conn, [task_id]).get(task_id, [])

    def _delete_orphan_tags(self, conn) -> int:
        """删除未关联任何任务的标签，返回删除数量。"""
        cursor = conn.execute(
            'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM task_tags)')
        return cursor.rowcount or 0

    # ------------------------------------------------------------------ #
    # 标签本体
    # ------------------------------------------------------------------ #

    def get_all_tags(self) -> List[Dict[str, Any]]:
        """获取所有标签及其使用次数"""
        with self.query() as conn:
            rows = conn.execute(
                'SELECT t.id, t.name, t.color, t.created_at, COUNT(tt.task_id) AS task_count '
                'FROM tags t LEFT JOIN task_tags tt ON t.id = tt.tag_id '
                'GROUP BY t.id ORDER BY t.name'
            ).fetchall()

        return [{
            'id': row['id'],
            'name': row['name'],
            'color': row['color'],
            'createdAt': row['created_at'],
            'taskCount': row['task_count'],
        } for row in rows]

    def update_tag(self, tag_id: str, tag_data: Dict[str, Any]) -> Dict[str, Any]:
        """更新标签（如重命名标签名称）"""
        new_name = (tag_data.get('name') or '').strip()
        if not new_name:
            raise ValueError('标签名称不能为空')

        with self.tx() as conn:
            # 重名校验（排除自身）
            if conn.execute(
                'SELECT id FROM tags WHERE name = ? AND id != ?', (new_name, tag_id)
            ).fetchone():
                raise ValueError('标签名称已存在')

            # 未传颜色时保持不变
            row = conn.execute('SELECT color FROM tags WHERE id = ?', (tag_id,)).fetchone()
            if not row:
                raise ValueError('标签不存在')
            color = tag_data.get('color') or row['color']

            conn.execute(
                'UPDATE tags SET name = ?, color = ? WHERE id = ?', (new_name, color, tag_id))

        return {'id': tag_id, 'name': new_name, 'color': color}

    def delete_tag(self, tag_id: str) -> bool:
        """删除标签及其全部关联"""
        with self.tx() as conn:
            conn.execute('DELETE FROM task_tags WHERE tag_id = ?', (tag_id,))
            conn.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
        return True

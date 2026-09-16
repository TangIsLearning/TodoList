# backend/database/mixins/attachment_crud_mixin.py
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from backend.database.models import Attachment

# 附件统一查询列
_ATTACHMENT_COLUMNS = (
    'id, task_id, type, name, file_path, url, size, mime_type, is_image, created_at, updated_at'
)
_ATTACHMENT_COLUMN_COUNT = len(_ATTACHMENT_COLUMNS.split(','))
_ATTACHMENT_SELECT = f'SELECT {_ATTACHMENT_COLUMNS} FROM attachments'
_ATTACHMENT_INSERT = (
    f'INSERT INTO attachments ({_ATTACHMENT_COLUMNS}) '
    f"VALUES ({', '.join(['?'] * _ATTACHMENT_COLUMN_COUNT)})"
)

# SQLite 单条语句的参数上限，批量操作按此拆分
_SQLITE_MAX_VARS = 500


def _chunks(items: Sequence[Any], size: int = _SQLITE_MAX_VARS) -> List[Sequence[Any]]:
    return [items[start:start + size] for start in range(0, len(items), size)]


class AttachmentCrudMixin:
    """附件数据 CRUD（仅存储附件元信息，不含文件内容）"""

    @staticmethod
    def _row_to_attachment(row: Any) -> Dict[str, Any]:
        return {
            'id': row['id'],
            'taskId': row['task_id'],
            'type': row['type'],
            'name': row['name'],
            'filePath': row['file_path'],
            'url': row['url'],
            'size': row['size'],
            'mimeType': row['mime_type'],
            'isImage': bool(row['is_image']),
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
        }

    # ------------------------------------------------------------------ #
    # 批量补齐（供任务列表在同一连接内复用，避免 N+1）
    # ------------------------------------------------------------------ #

    def _attachments_map(self, conn, task_ids: Sequence[str]) -> Dict[str, List[Dict[str, Any]]]:
        """批量获取多个任务的附件，返回 {task_id: [attachment]}。"""
        result: Dict[str, List[Dict[str, Any]]] = {tid: [] for tid in task_ids}
        ids = [tid for tid in (task_ids or []) if tid]
        if not ids:
            return result

        for batch in _chunks(ids):
            placeholders = ','.join(['?'] * len(batch))
            rows = conn.execute(
                f'{_ATTACHMENT_SELECT} WHERE task_id IN ({placeholders}) ORDER BY created_at ASC',
                tuple(batch)
            ).fetchall()
            for row in rows:
                att = self._row_to_attachment(row)
                result.setdefault(att['taskId'], []).append(att)
        return result

    # ------------------------------------------------------------------ #
    # 基础 CRUD
    # ------------------------------------------------------------------ #

    def add_attachment(self, task_id: str, att_data: Dict[str, Any]) -> Dict[str, Any]:
        """新增附件记录"""
        attachment = Attachment.from_dict({**att_data, 'taskId': task_id})
        with self.tx() as conn:
            conn.execute(
                _ATTACHMENT_INSERT,
                (
                    attachment.id,
                    attachment.task_id,
                    attachment.type,
                    attachment.name,
                    attachment.file_path,
                    attachment.url,
                    attachment.size,
                    attachment.mime_type,
                    1 if attachment.is_image else 0,
                    attachment.created_at.isoformat(),
                    attachment.updated_at.isoformat(),
                )
            )
        return attachment.to_dict()

    def get_task_attachments(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的附件列表"""
        if not task_id:
            return []
        with self.query() as conn:
            return self._attachments_map(conn, [task_id]).get(task_id, [])

    def get_attachments_by_task_ids(self, task_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """批量获取多个任务的附件，返回 {task_id: [attachments]}"""
        if not task_ids:
            return {}
        with self.query() as conn:
            return self._attachments_map(conn, task_ids)

    def get_attachment(self, attachment_id: str) -> Optional[Dict[str, Any]]:
        """获取单个附件"""
        with self.query() as conn:
            row = conn.execute(
                f'{_ATTACHMENT_SELECT} WHERE id = ?', (attachment_id,)).fetchone()
        return self._row_to_attachment(row) if row else None

    def update_attachment(self, attachment_id: str, att_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新附件记录（名称、链接地址等）"""
        with self.tx() as conn:
            row = conn.execute(
                f'{_ATTACHMENT_SELECT} WHERE id = ?', (attachment_id,)).fetchone()
            if not row:
                return None

            existing = self._row_to_attachment(row)
            updated = {
                **existing,
                'name': att_data.get('name', existing['name']),
                'url': att_data.get('url', existing['url']),
                'filePath': att_data.get('filePath', existing['filePath']),
                'size': att_data.get('size', existing['size']),
                'mimeType': att_data.get('mimeType', existing['mimeType']),
                'isImage': att_data.get('isImage', existing['isImage']),
                'updatedAt': datetime.now().isoformat(),
            }

            conn.execute(
                'UPDATE attachments '
                'SET name = ?, url = ?, file_path = ?, size = ?, mime_type = ?, is_image = ?, updated_at = ? '
                'WHERE id = ?',
                (
                    updated['name'], updated['url'], updated['filePath'], updated['size'],
                    updated['mimeType'], 1 if updated['isImage'] else 0,
                    updated['updatedAt'], attachment_id,
                )
            )
        return updated

    def delete_attachment(self, attachment_id: str) -> bool:
        """删除附件记录"""
        with self.tx() as conn:
            conn.execute('DELETE FROM attachments WHERE id = ?', (attachment_id,))
        return True

    def delete_task_attachments(self, task_id: str) -> List[Dict[str, Any]]:
        """删除任务的所有附件记录，返回被删除的附件（用于清理实体文件）"""
        with self.tx() as conn:
            rows = conn.execute(
                f'{_ATTACHMENT_SELECT} WHERE task_id = ? ORDER BY created_at ASC', (task_id,)
            ).fetchall()
            if not rows:
                return []
            conn.execute('DELETE FROM attachments WHERE task_id = ?', (task_id,))
        return [self._row_to_attachment(row) for row in rows]

    def get_all_attachments(self) -> List[Dict[str, Any]]:
        """获取所有附件（用于数据导出）"""
        with self.query() as conn:
            rows = conn.execute(f'{_ATTACHMENT_SELECT} ORDER BY created_at ASC').fetchall()
        return [self._row_to_attachment(row) for row in rows]

    def delete_all_attachments(self) -> None:
        """清空所有附件记录（用于数据导入）"""
        with self.tx() as conn:
            conn.execute('DELETE FROM attachments')

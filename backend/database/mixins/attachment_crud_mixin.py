# backend/database/mixins/attachment_crud_mixin.py
import sqlite3
from typing import Any, Dict, List, Optional
from backend.database.models import Attachment


class AttachmentCrudMixin:
    """附件数据 CRUD（仅存储附件元信息，不含文件内容）"""

    @staticmethod
    def _row_to_attachment(row: Any) -> Dict[str, Any]:
        return {
            'id': row[0],
            'taskId': row[1],
            'type': row[2],
            'name': row[3],
            'filePath': row[4],
            'url': row[5],
            'size': row[6],
            'mimeType': row[7],
            'isImage': bool(row[8]),
            'createdAt': row[9],
            'updatedAt': row[10],
        }

    def add_attachment(self, task_id: str, att_data: Dict[str, Any]) -> Dict[str, Any]:
        """新增附件记录"""
        attachment = Attachment.from_dict({**att_data, 'taskId': task_id})
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO attachments (id, task_id, type, name, file_path, url, size,
                                     mime_type, is_image, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
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
        ))
        conn.commit()
        conn.close()
        return attachment.to_dict()

    def get_task_attachments(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的附件列表"""
        if not task_id:
            return []
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, task_id, type, name, file_path, url, size, mime_type, is_image, created_at, updated_at
            FROM attachments
            WHERE task_id = ?
            ORDER BY created_at ASC
        ''', (task_id,))
        rows = cursor.fetchall()
        conn.close()
        return [self._row_to_attachment(row) for row in rows]

    def get_attachments_by_task_ids(self, task_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """批量获取多个任务的附件，返回 {task_id: [attachments]}"""
        result: Dict[str, List[Dict[str, Any]]] = {tid: [] for tid in task_ids}
        if not task_ids:
            return result
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        placeholders = ','.join('?' for _ in task_ids)
        cursor.execute(f'''
            SELECT id, task_id, type, name, file_path, url, size, mime_type, is_image, created_at, updated_at
            FROM attachments
            WHERE task_id IN ({placeholders})
            ORDER BY created_at ASC
        ''', tuple(task_ids))
        rows = cursor.fetchall()
        conn.close()
        for row in rows:
            att = self._row_to_attachment(row)
            result.setdefault(att['taskId'], []).append(att)
        return result

    def get_attachment(self, attachment_id: str) -> Optional[Dict[str, Any]]:
        """获取单个附件"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, task_id, type, name, file_path, url, size, mime_type, is_image, created_at, updated_at
            FROM attachments
            WHERE id = ?
        ''', (attachment_id,))
        row = cursor.fetchone()
        conn.close()
        return self._row_to_attachment(row) if row else None

    def update_attachment(self, attachment_id: str, att_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """更新附件记录（名称、链接地址等）"""
        existing = self.get_attachment(attachment_id)
        if not existing:
            return None

        from datetime import datetime
        name = att_data.get('name', existing['name'])
        url = att_data.get('url', existing['url'])
        file_path = att_data.get('filePath', existing['filePath'])
        size = att_data.get('size', existing['size'])
        mime_type = att_data.get('mimeType', existing['mimeType'])
        is_image = att_data.get('isImage', existing['isImage'])

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE attachments
            SET name = ?, url = ?, file_path = ?, size = ?, mime_type = ?, is_image = ?, updated_at = ?
            WHERE id = ?
        ''', (
            name, url, file_path, size, mime_type,
            1 if is_image else 0,
            datetime.now().isoformat(),
            attachment_id,
        ))
        conn.commit()
        conn.close()
        return self.get_attachment(attachment_id)

    def delete_attachment(self, attachment_id: str) -> bool:
        """删除附件记录"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM attachments WHERE id = ?', (attachment_id,))
        conn.commit()
        conn.close()
        return True

    def delete_task_attachments(self, task_id: str) -> List[Dict[str, Any]]:
        """删除任务的所有附件记录，返回被删除的附件（用于清理实体文件）"""
        attachments = self.get_task_attachments(task_id)
        if not attachments:
            return []
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM attachments WHERE task_id = ?', (task_id,))
        conn.commit()
        conn.close()
        return attachments

    def get_all_attachments(self) -> List[Dict[str, Any]]:
        """获取所有附件（用于数据导出）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, task_id, type, name, file_path, url, size, mime_type, is_image, created_at, updated_at
            FROM attachments
            ORDER BY created_at ASC
        ''')
        rows = cursor.fetchall()
        conn.close()
        return [self._row_to_attachment(row) for row in rows]

    def delete_all_attachments(self) -> None:
        """清空所有附件记录（用于数据导入）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM attachments')
        conn.commit()
        conn.close()
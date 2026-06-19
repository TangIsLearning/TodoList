# backend/network/sync_engine.py
import json
import time
from typing import Callable, Optional

from backend.network.protocol import (
    SYNC_TASK_PUSH, SYNC_TASK_PULL, SYNC_CATEGORY_PUSH, SYNC_CATEGORY_PULL,
    SYNC_USER_PROFILE_PUSH,
)


class SyncEngine:
    """同步引擎：处理推送/拉取、字段级冲突解决、sync_log 记录"""

    def __init__(self, db, sync_manager, on_apply: Optional[Callable] = None):
        self.db = db
        self.sync_manager = sync_manager
        self.on_apply = on_apply
        # 节点级最后同步时间戳
        self._last_sync_at: dict[str, str] = {}

    def apply_remote_change(self, entity_type: str, entity: dict,
                            peer_id: str = '', user_id: str = '') -> dict:
        """应用远端变更，返回最终状态 + 同步日志条目"""
        if entity_type == 'task':
            return self._apply_task(entity, peer_id, user_id)
        if entity_type == 'category':
            return self._apply_category(entity, peer_id, user_id)
        if entity_type == 'message':
            return self._apply_message(entity, peer_id, user_id)
        raise ValueError(f'UNSUPPORTED_ENTITY_TYPE: {entity_type}')

    def _apply_task(self, entity: dict, peer_id: str, user_id: str) -> dict:
        local = self.db.get_task(entity['id'])
        has_conflict = 0
        if local is None:
            # 新增
            self.db.add_task(entity)
            self.sync_manager.log_sync('task', entity['id'], 'push',
                                        peer_id=peer_id, user_id=user_id, has_conflict=0)
        else:
            merged = self.sync_manager.resolve_conflict(local, entity)
            if merged.get('is_deleted') and not local.get('is_deleted'):
                # 远端删除
                self.db.soft_delete_task(entity['id'])
            elif merged != local:
                self.db.update_task(entity['id'], merged)
                has_conflict = 1 if merged.get('updated_at') != entity.get('updated_at') else 0
            self.sync_manager.log_sync('task', entity['id'], 'push',
                                        peer_id=peer_id, user_id=user_id, has_conflict=has_conflict)
        if self.on_apply:
            try:
                self.on_apply(entity_type, entity)
            except Exception:
                pass
        return entity

    def _apply_category(self, entity: dict, peer_id: str, user_id: str) -> dict:
        # 简化：直接 upsert
        if not self.db.category_manager.get_category(entity['id']):
            self.db.category_manager.create_category(**entity)
        self.sync_manager.log_sync('category', entity['id'], 'push',
                                    peer_id=peer_id, user_id=user_id)
        return entity

    def _apply_message(self, entity: dict, peer_id: str, user_id: str) -> dict:
        if not self.db.message_manager.get_message(entity['id']):
            self.db.message_manager.send_message(
                group_id=entity['group_id'], sender_id=entity['sender_id'],
                content=entity.get('content'), msg_type=entity['msg_type'],
                attachment_ids=json.loads(entity.get('attachment_ids') or '[]'),
                reply_to_id=entity.get('reply_to_id'),
            )
        self.sync_manager.log_sync('message', entity['id'], 'push',
                                    peer_id=peer_id, user_id=user_id)
        return entity

    def get_pull_payload(self, entity_type: str, since_timestamp: str = '') -> list[dict]:
        """获取 since_timestamp 之后的所有变更（用于新节点加入时拉取）"""
        if entity_type == 'task':
            return self.db.list_tasks(since=since_timestamp)
        if entity_type == 'category':
            return self.db.category_manager.list_categories() if not since_timestamp else []
        if entity_type == 'message':
            return []
        return []

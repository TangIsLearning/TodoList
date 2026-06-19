# backend/network/sync_engine.py
import json
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from backend.network.protocol import (
    SYNC_TASK_PUSH, SYNC_TASK_PULL, SYNC_CATEGORY_PUSH, SYNC_CATEGORY_PULL,
    SYNC_USER_PROFILE_PUSH,
)


# ===== D 阶段：clock-skew 容忍 =====
SKEW_TOLERANCE_SEC = 1.0  # 视为同时的最大时间差


def _parse_ts(ts: str) -> Optional[datetime]:
    """将 ISO-8601 时间戳解析为 datetime（兼容 Z 后缀与无时区）。"""
    if not ts:
        return None
    try:
        s = str(ts).replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def resolve_with_skew(local_ts: str, remote_ts: str,
                      local_id: str, remote_id: str) -> str:
    """Clock-skew 容忍冲突解决。

    返回胜出方的标识 ('local' / 'remote')。
    - |Δt| < SKEW_TOLERANCE_SEC：视为同时 → 节点 ID 字典序大的胜出
    - 否则：时间戳更新的胜出
    - 解析失败回退：按节点 ID 字典序
    """
    ldt = _parse_ts(local_ts)
    rdt = _parse_ts(remote_ts)
    if ldt and rdt:
        delta = abs((rdt - ldt).total_seconds())
        if delta < SKEW_TOLERANCE_SEC:
            return 'remote' if remote_id > local_id else 'local'
        return 'remote' if rdt > ldt else 'local'
    # 时间戳解析失败：回退到 ID 字典序
    return 'remote' if (remote_id or '') > (local_id or '') else 'local'


class SyncEngine:
    """同步引擎：处理推送/拉取、字段级冲突解决、sync_log 记录"""

    def __init__(self, db, sync_manager, on_apply: Optional[Callable] = None):
        self.db = db
        self.sync_manager = sync_manager
        self.on_apply = on_apply
        # 节点级最后同步时间戳
        self._last_sync_at: dict[str, str] = {}

    def _ts(self, entity: dict, *keys) -> str:
        """获取时间戳字段，支持多种命名（updated_at / updatedAt 等）。

        A/B 阶段 get_task / 模型层统一用 camelCase（updatedAt / createdAt），
        C 阶段早期 sync 协议用 snake_case（updated_at / created_at）。
        冲突解决时两种命名都可能出现，故按顺序尝试直到找到第一个非空值。
        """
        if not entity:
            return ''
        for k in keys:
            v = entity.get(k)
            if v:
                return v
        return ''

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

    # ===== D 阶段：增量同步 =====
    def apply_pull_response(self, entity_type: str, entities: list,
                            peer_id: str = '', user_id: str = '') -> int:
        """应用远端 PULL_RESPONSE 拉取结果，逐条 apply_remote_change。

        返回成功 apply 的数量。
        """
        applied = 0
        for ent in entities:
            try:
                self.apply_remote_change(entity_type, ent, peer_id=peer_id, user_id=user_id)
                applied += 1
            except Exception:
                # 单条失败不影响整批
                pass
        return applied

    def sync_with_peer(self, peer_id: str, since: str = '',
                       entity_types: tuple = ('task', 'category')) -> dict:
        """对指定 peer 触发增量同步。

        返回 {entity_type: count}。
        实际发送由 NetworkCoordinator 完成；本方法只负责生成本地应有的 PULL_REQUEST 数据。
        调用方需把 PULL_REQUEST 通过 PeerConnection 发送，收到 PULL_RESPONSE 后调用
        apply_pull_response 落地。
        """
        # 仅生成 since / entity_types 元数据，发送与接收在协调器层
        self._last_sync_at[peer_id] = since or ''
        return {
            'peer_id': peer_id,
            'since': since or '',
            'entity_types': list(entity_types),
        }

    def record_sync_at(self, peer_id: str, ts: str = None) -> None:
        """记录对 peer 的最后同步时间戳。"""
        self._last_sync_at[peer_id] = ts or datetime.now(timezone.utc).isoformat()

    def get_last_sync_at(self, peer_id: str) -> str:
        return self._last_sync_at.get(peer_id, '')

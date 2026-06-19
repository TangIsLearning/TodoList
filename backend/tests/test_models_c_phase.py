"""
C 阶段 6 个数据模型测试
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.models import (
    Group,
    GroupMember,
    Message,
    Attachment,
    SyncLog,
    FileStorage,
)


def test_group_roundtrip():
    g = Group(
        id='g1',
        name='研发组',
        join_code='A8B-3K9',
        created_by='u1',
        created_at='2026-06-19T10:00:00Z',
        updated_at='2026-06-19T10:00:00Z',
    )
    d = g.to_dict()
    g2 = Group.from_dict(d)
    assert g2.id == g.id
    assert g2.name == '研发组'
    assert g2.icon == '👥'


def test_message_with_attachments():
    m = Message(
        id='m1',
        group_id='g1',
        sender_id='u1',
        msg_type='text',
        content='hello',
        created_at='2026-06-19T10:00:00Z',
        updated_at='2026-06-19T10:00:00Z',
        attachment_ids='["a1","a2"]',
    )
    d = m.to_dict()
    m2 = Message.from_dict(d)
    assert m2.attachment_ids == '["a1","a2"]'


def test_file_storage_default_ref_count():
    f = FileStorage(
        file_hash='abc',
        storage_path='files/abc',
        file_size=1024,
        created_at='2026-06-19T10:00:00Z',
    )
    assert f.ref_count == 1

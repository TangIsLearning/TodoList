"""
D 阶段 M3 单测：同步协议扩展
- 6 个新消息常量存在
- encode_message 自动注入 protocol_version
- decode_message 透传
- check_version：缺失视为兼容、不一致返回 False
- make_error 标准格式
- VERSIONED_TYPES 包含全部 D 阶段消息
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.protocol import (  # noqa: E402
    encode_message, decode_message, ProtocolError,
    PROTOCOL_VERSION, VERSIONED_TYPES,
    SYNC_HANDSHAKE, SYNC_PULL_REQUEST, SYNC_PULL_RESPONSE,
    SYNC_BROADCAST, SYNC_RESYNC_REQUEST, SYNC_BYE,
    ERR_PROTOCOL_MISMATCH, ERR_UNKNOWN_TYPE,
    check_version, make_error, HELLO, BYE, ERROR,
)


def test_new_message_types_exist():
    assert SYNC_HANDSHAKE == 'SYNC_HANDSHAKE'
    assert SYNC_PULL_REQUEST == 'SYNC_PULL_REQUEST'
    assert SYNC_PULL_RESPONSE == 'SYNC_PULL_RESPONSE'
    assert SYNC_BROADCAST == 'SYNC_BROADCAST'
    assert SYNC_RESYNC_REQUEST == 'SYNC_RESYNC_REQUEST'
    assert SYNC_BYE == 'SYNC_BYE'


def test_protocol_version_constant():
    assert PROTOCOL_VERSION == '1.0.0'
    parts = PROTOCOL_VERSION.split('.')
    assert len(parts) == 3


def test_versioned_types_contains_all():
    """所有 D 阶段新增消息都应在 VERSIONED_TYPES 中。"""
    required = {SYNC_HANDSHAKE, SYNC_PULL_REQUEST, SYNC_PULL_RESPONSE,
                SYNC_BROADCAST, SYNC_RESYNC_REQUEST, SYNC_BYE,
                HELLO, BYE, ERROR}
    for t in required:
        assert t in VERSIONED_TYPES, f'{t} 缺失'


def test_encode_auto_injects_version():
    """未指定 protocol_version 的消息，编码后应自动注入。"""
    msg = {'type': SYNC_HANDSHAKE, 'node_id': 'n1', 'user_id': 'u1'}
    encoded = encode_message(msg)
    decoded = decode_message(encoded)
    assert decoded['protocol_version'] == PROTOCOL_VERSION
    assert decoded['type'] == SYNC_HANDSHAKE
    assert decoded['node_id'] == 'n1'


def test_encode_preserves_existing_version():
    """若调用方已显式指定 protocol_version，编码后保留。"""
    msg = {'type': SYNC_HANDSHAKE, 'protocol_version': '0.9.0', 'node_id': 'n1'}
    encoded = encode_message(msg)
    decoded = decode_message(encoded)
    assert decoded['protocol_version'] == '0.9.0'


def test_encode_does_not_inject_for_unknown_type():
    """未在 VERSIONED_TYPES 中的消息，不强制注入 protocol_version。"""
    msg = {'type': 'CUSTOM', 'foo': 'bar'}
    encoded = encode_message(msg)
    decoded = decode_message(encoded)
    assert 'protocol_version' not in decoded


def test_decode_incomplete():
    try:
        decode_message(b'\x00\x00\x00\x10short')
        assert False, '应该抛 ProtocolError'
    except ProtocolError:
        pass


def test_decode_invalid_json():
    bad = b'\x00\x00\x00\x05{not}'
    try:
        decode_message(bad)
        assert False, '应该抛 ProtocolError'
    except ProtocolError:
        pass


def test_check_version_missing_field_is_compatible():
    """旧消息不带 protocol_version 字段 → 视为兼容。"""
    msg = {'type': HELLO}
    assert check_version(msg) is True


def test_check_version_matching():
    msg = {'type': HELLO, 'protocol_version': PROTOCOL_VERSION}
    assert check_version(msg) is True


def test_check_version_mismatch():
    msg = {'type': HELLO, 'protocol_version': '0.9.0'}
    assert check_version(msg) is False


def test_check_version_with_custom_expected():
    msg = {'type': HELLO, 'protocol_version': '2.0.0'}
    assert check_version(msg, expected='2.0.0') is True
    assert check_version(msg, expected=PROTOCOL_VERSION) is False


def test_make_error_format():
    err = make_error(ERR_PROTOCOL_MISMATCH, 'version 0.9 not supported')
    assert err['type'] == ERROR
    assert err['code'] == ERR_PROTOCOL_MISMATCH
    assert err['message'] == 'version 0.9 not supported'
    assert err['protocol_version'] == PROTOCOL_VERSION


def test_round_trip_complex_payload():
    """完整 HANDSHAKE 消息往返。"""
    msg = {
        'type': SYNC_HANDSHAKE,
        'node_id': 'node-abc',
        'user_id': 'user-1',
        'user_name': 'Alice',
        'group_ids': ['g1', 'g2'],
        'last_sync_at': '2026-06-19T10:00:00Z',
    }
    encoded = encode_message(msg)
    decoded = decode_message(encoded)
    assert decoded['type'] == SYNC_HANDSHAKE
    assert decoded['node_id'] == 'node-abc'
    assert decoded['group_ids'] == ['g1', 'g2']
    assert decoded['last_sync_at'] == '2026-06-19T10:00:00Z'
    assert decoded['protocol_version'] == PROTOCOL_VERSION


def test_error_codes_constants():
    assert ERR_PROTOCOL_MISMATCH == 'PROTOCOL_MISMATCH'
    assert ERR_UNKNOWN_TYPE == 'UNKNOWN_TYPE'

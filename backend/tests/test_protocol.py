import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.network.protocol import encode_message, decode_message, ProtocolError


def test_encode_decode_text():
    msg = {'type': 'PING', 'node_id': 'n1', 'timestamp': '2026-06-19T10:00:00Z'}
    encoded = encode_message(msg)
    # 4 字节长度前缀 + JSON
    assert len(encoded) > 4
    length = int.from_bytes(encoded[:4], 'big')
    assert length == len(encoded) - 4

    decoded = decode_message(encoded)
    assert decoded == msg


def test_decode_incomplete():
    """截断数据应抛 ProtocolError"""
    import json
    import pytest
    msg = {'type': 'PING'}
    encoded = encode_message(msg)
    # 截断到一半
    try:
        decode_message(encoded[:len(encoded) // 2])
        assert False, '应该抛错'
    except ProtocolError:
        pass


def test_decode_invalid_json():
    """无效 JSON 应抛 ProtocolError"""
    import pytest
    bad = b'{"type": "PING"'  # 不完整 JSON
    framed = len(bad).to_bytes(4, 'big') + bad
    try:
        decode_message(framed)
        assert False
    except ProtocolError:
        pass

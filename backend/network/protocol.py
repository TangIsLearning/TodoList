import json
import struct


class ProtocolError(Exception):
    pass


# ===== D 阶段：协议版本号 =====
PROTOCOL_VERSION = '1.0.0'

# ===== 已有 C 阶段协议常量 =====
HELLO = 'HELLO'
WELCOME = 'WELCOME'
ACK = 'ACK'
PING = 'PING'
PONG = 'PONG'
BYE = 'BYE'
ERROR = 'ERROR'

SYNC_TASK_PUSH = 'SYNC_TASK_PUSH'
SYNC_TASK_PULL = 'SYNC_TASK_PULL'
SYNC_CATEGORY_PUSH = 'SYNC_CATEGORY_PUSH'
SYNC_CATEGORY_PULL = 'SYNC_CATEGORY_PULL'
SYNC_USER_PROFILE_PUSH = 'SYNC_USER_PROFILE_PUSH'

GROUP_HELLO = 'GROUP_HELLO'
GROUP_BYE = 'GROUP_BYE'

MSG_SEND = 'MSG_SEND'
MSG_READ_RECEIPT = 'MSG_READ_RECEIPT'

FILE_UPLOAD_META = 'FILE_UPLOAD_META'
FILE_UPLOAD_CHUNK = 'FILE_UPLOAD_CHUNK'
FILE_UPLOAD_COMPLETE = 'FILE_UPLOAD_COMPLETE'


# ===== D 阶段新增：握手 / 拉取 / 广播 / 重同步 / 主动断开 =====

SYNC_HANDSHAKE = 'SYNC_HANDSHAKE'
"""节点身份交换：protocol_version, node_id, user_id, group_ids[], last_sync_at"""

SYNC_PULL_REQUEST = 'SYNC_PULL_REQUEST'
"""拉取请求：protocol_version, entity_type, since"""

SYNC_PULL_RESPONSE = 'SYNC_PULL_RESPONSE'
"""拉取响应：protocol_version, entity_type, entities[]"""

SYNC_BROADCAST = 'SYNC_BROADCAST'
"""本地变更广播：protocol_version, entity_type, entity"""

SYNC_RESYNC_REQUEST = 'SYNC_RESYNC_REQUEST'
"""重连后全节点增量同步请求：protocol_version, since"""

SYNC_BYE = 'SYNC_BYE'
"""主动断开：protocol_version, reason"""

# 错误码
ERR_PROTOCOL_MISMATCH = 'PROTOCOL_MISMATCH'
ERR_UNKNOWN_TYPE = 'UNKNOWN_TYPE'
ERR_PAYLOAD_INVALID = 'PAYLOAD_INVALID'

# 所有需要协议版本号的消息类型（D 阶段新增）
VERSIONED_TYPES = {
    SYNC_HANDSHAKE, SYNC_PULL_REQUEST, SYNC_PULL_RESPONSE,
    SYNC_BROADCAST, SYNC_RESYNC_REQUEST, SYNC_BYE,
    HELLO, WELCOME, ACK, BYE, ERROR,
    SYNC_TASK_PUSH, SYNC_TASK_PULL,
    SYNC_CATEGORY_PUSH, SYNC_CATEGORY_PULL,
    SYNC_USER_PROFILE_PUSH,
    GROUP_HELLO, GROUP_BYE,
    MSG_SEND, MSG_READ_RECEIPT,
}


def _add_version(msg: dict) -> dict:
    """自动注入 protocol_version 字段（若已存在不覆盖）。"""
    if 'protocol_version' not in msg and msg.get('type') in VERSIONED_TYPES:
        msg['protocol_version'] = PROTOCOL_VERSION
    return msg


def encode_message(msg: dict) -> bytes:
    """编码：4 字节大端长度 + UTF-8 JSON（自动注入 protocol_version）。"""
    msg = _add_version(dict(msg))
    payload = json.dumps(msg, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return struct.pack('>I', len(payload)) + payload


def decode_message(data: bytes) -> dict:
    """解码：4 字节大端长度 + UTF-8 JSON"""
    if len(data) < 4:
        raise ProtocolError(f'数据过短：{len(data)} 字节')
    length = struct.unpack('>I', data[:4])[0]
    if len(data) < 4 + length:
        raise ProtocolError(f'不完整：期望 {length} 字节，实际 {len(data) - 4}')
    try:
        return json.loads(data[4:4+length].decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ProtocolError(f'JSON 解析失败：{e}') from e


def check_version(msg: dict, expected: str = PROTOCOL_VERSION) -> bool:
    """校验协议版本号。

    返回 True 表示版本匹配。
    - 消息不含 protocol_version 字段 → 视为旧协议 → 返回 True（向后兼容）
    - 字段存在但与 expected 不一致 → 返回 False
    """
    if 'protocol_version' not in msg:
        return True  # 向后兼容：旧消息不带版本号
    return msg.get('protocol_version') == expected


def make_error(code: str, message: str) -> dict:
    """构造标准 ERROR 消息（含协议版本）。"""
    return {
        'type': ERROR,
        'protocol_version': PROTOCOL_VERSION,
        'code': code,
        'message': message,
    }

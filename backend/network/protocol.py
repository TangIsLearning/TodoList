import json
import struct


class ProtocolError(Exception):
    pass


# 消息类型常量
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


def encode_message(msg: dict) -> bytes:
    """编码：4 字节大端长度 + UTF-8 JSON"""
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

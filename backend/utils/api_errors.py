"""
API 错误码与异常类型

解决的问题：此前 API 层所有异常在 response_wrapper 里被统一吞成
{"success": False, "error": str(e)}，既没有稳定可判断的错误类型，后端日志里
也查不到任何记录，排障只能靠前端 logger.error。

约定：
    API 层 / 服务层抛出具体异常类型，由 api_handler 统一转成
    {"success": False, "error": 文案, "code": 错误码}

    from backend.utils.api_errors import ValidationError, NotFoundError
    raise ValidationError('标签名称不能为空')
    raise NotFoundError('任务不存在')

历史代码里的内置异常（ValueError / KeyError / FileNotFoundError 等）无需改动，
resolve_error 会自动映射出合理 code；只有裸 raise Exception(...) 无法推断语义，
会落到 INTERNAL_ERROR，建议逐步替换为上面的具体类型。
"""
from __future__ import annotations

import sqlite3
from typing import Any, Dict, List, Optional, Tuple, Type

# ——— 错误码 ———
VALIDATION_ERROR = 'VALIDATION_ERROR'   # 参数缺失 / 格式非法 / 业务规则不允许
NOT_FOUND = 'NOT_FOUND'                 # 资源不存在
CONFLICT = 'CONFLICT'                   # 状态冲突：重名、已有任务进行中
PERMISSION_DENIED = 'PERMISSION_DENIED'  # 权限/系统能力不支持
TIMEOUT = 'TIMEOUT'                     # 超时
CANCELLED = 'CANCELLED'                 # 用户在系统对话框里取消，不是失败
STORAGE_ERROR = 'STORAGE_ERROR'         # 文件/目录读写失败
DATABASE_ERROR = 'DATABASE_ERROR'       # SQLite 出错
INTERNAL_ERROR = 'INTERNAL_ERROR'       # 未预期异常


class ApiError(Exception):
    """API 异常基类，携带错误码"""

    code: str = INTERNAL_ERROR

    def __init__(self, message: str = '', code: Optional[str] = None) -> None:
        self.message = message or self.__class__.__name__
        if code:
            self.code = code
        super().__init__(self.message)


class ValidationError(ApiError):
    code = VALIDATION_ERROR


class NotFoundError(ApiError):
    code = NOT_FOUND


class ConflictError(ApiError):
    code = CONFLICT


class PermissionDeniedError(ApiError):
    code = PERMISSION_DENIED


class CancelledError(ApiError):
    """用户主动取消（目录/文件选择框等）。前端可据此跳过错误提示"""

    code = CANCELLED


class StorageError(ApiError):
    code = STORAGE_ERROR


class DatabaseError(ApiError):
    code = DATABASE_ERROR


# 内置异常 → 错误码。顺序敏感：子类必须排在父类之前
# （FileNotFoundError 在 OSError 前，sqlite3.IntegrityError 由 sqlite3.Error 兜住）
#
# 只收语义无歧义的几类。KeyError / IndexError / TypeError 之类既能是"查不到"
# 也可能是代码缺陷（取了不存在的键），一旦归进这里就只记 warning 不记堆栈，
# 反而会掩盖缺陷；它们落到 INTERNAL_ERROR 并带堆栈，排障时更容易发现。
_BUILTIN_CODE_MAP: List[Tuple[Type[BaseException], str]] = [
    (FileNotFoundError, NOT_FOUND),
    (PermissionError, PERMISSION_DENIED),
    (TimeoutError, TIMEOUT),
    (sqlite3.Error, DATABASE_ERROR),
    (ValueError, VALIDATION_ERROR),
    (OSError, STORAGE_ERROR),
]


def resolve_error(exc: BaseException) -> Tuple[str, bool]:
    """返回 (错误码, 是否预期内异常)

    expected=True 表示异常语义已知（业务校验/资源不存在等），日志记 warning 即可；
    False 表示未预期异常，需要连堆栈一起记录，便于排障。
    """
    if isinstance(exc, ApiError):
        return exc.code, True

    for exc_type, code in _BUILTIN_CODE_MAP:
        if isinstance(exc, exc_type):
            return code, True

    return INTERNAL_ERROR, False


def error_response(exc: BaseException, code: Optional[str] = None) -> Dict[str, Any]:
    """构造统一错误响应。error 字段保持原文案，前端既有展示逻辑不受影响"""
    resolved = code or resolve_error(exc)[0]
    return {
        "success": False,
        "error": str(exc),
        "code": resolved,
    }

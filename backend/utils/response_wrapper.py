"""
API 响应统一格式工具
提供成功/失败响应构造方法以及自动处理异常的装饰器
"""
import functools
from typing import Any, Callable, Dict, Optional


def success_response(
    data: Optional[Any] = None,
    message: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    构造统一成功响应
    :param data: 业务数据
    :param message: 可选提示信息
    :param extra: 额外字段（如分页元数据），会合并到根层级
    """
    resp = {"success": True}
    if data is not None:
        resp["data"] = data
    if message:
        resp["message"] = message
    if extra:
        resp.update(extra)
    return resp

def api_handler(func: Callable[..., Any]) -> Callable[..., Dict[str, Any]]:
    """
    统一 API 装饰器：
    - 捕获方法中的所有异常并转换为错误响应
    - 根据返回值自动构造成功响应
    支持以下返回值形式：
        - None          -> 返回 {"success": True, "message": "操作成功"}
        - 任意数据       -> 返回 {"success": True, "data": 数据}
        - (data, msg)   -> 返回 {"success": True, "data": data, "message": msg}
        - (data, extra, msg) -> 返回 {"success": True, "data": data, "message": msg, **extra}
        - {'data': ..., ...} -> 提取 data 字段，其余作为 extra 合并
    """
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        try:
            result = func(*args, **kwargs)

            if result is None:
                return success_response(message="操作成功")

            # 如果返回的是字典且包含 'data' 键，将其拆分
            if isinstance(result, dict) and 'data' in result:
                data = result.pop('data')
                extra = result  # 剩余字段
                return success_response(data=data, extra=extra)

            # 处理元组 (data, extra, message) 或 (data, message)
            if isinstance(result, tuple):
                if len(result) == 3:
                    data, extra, message = result
                elif len(result) == 2:
                    data, message = result
                    extra = None
                else:
                    # 超过3个元素只取第一个作为 data
                    data = result[0]
                    extra = None
                    message = None
                return success_response(data=data, extra=extra, message=message)

            # 其他情况直接作为 data
            return success_response(data=result)

        except Exception as e:
            return {"success": False, "error": str(e)}

    return wrapper
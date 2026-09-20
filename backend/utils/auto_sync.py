"""写操作 API 的自动云端同步钩子

此前由前端在改完数据后手工调用 trigger_upload_on_change（散落在 todo.js /
todo.modals.js 多处），漏调一次就丢一次同步。改为在写操作 API 上标 @auto_sync，
成功后由后端统一触发，前端不必再记得调。
"""
import functools
import logging
from typing import Any, Callable

_logger = logging.getLogger('backend.api')


def auto_sync(func: Callable) -> Callable:
    """写操作成功后自动触发云端同步上传

    必须贴在 @api_handler 下方（先于 api_handler 执行）：
    - 操作本身抛异常 → 异常直接往上抛，不会触发同步
    - 同步自身失败 → 只记 warning，不影响已经成功的操作
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        _trigger_upload(args[0] if args else None, func.__name__)
        return result

    return wrapper


def _trigger_upload(api_instance: Any, method_name: str) -> None:
    sync_manager = getattr(api_instance, 'sync_manager', None)
    trigger = getattr(sync_manager, 'trigger_upload_on_change', None)
    if trigger is None:
        return
    try:
        trigger()
    except Exception as e:
        _logger.warning('API %s 触发云端同步失败: %s', method_name, e)

"""
移动端消息日历提醒功能
"""
from __future__ import annotations

from typing import Any, List, Optional, Union

from jnius import autoclass, cast
from datetime import datetime

from backend.database.todo_database import TodoDatabase

# 日历事件标题前缀，用于识别本应用写入的提醒
EVENT_TITLE_PREFIX = "【todoList】提醒："


def _build_event_title(title: str) -> str:
    """构造日历事件标题"""
    return EVENT_TITLE_PREFIX + str(title)


def _to_java_string_array(values: List[str]) -> Any:
    """将 Python 列表转换为 Java String[]（兼容不同 pyjnius 版本的转换方式）"""
    values = [str(value) for value in values]
    try:
        return cast('[Ljava.lang.String;', values)
    except Exception:
        return autoclass('[Ljava.lang.String;')(values)


def _to_timestamp_ms(due_date: Optional[str]) -> Optional[float]:
    """将 ISO 格式的截止时间转换为毫秒时间戳"""
    if not due_date:
        return None
    try:
        return datetime.fromisoformat(due_date).timestamp() * 1000
    except (ValueError, TypeError):
        return None


def check_permission() -> None:
    from android import mActivity
    # 1. 检查权限 (使用原生方法)
    perms = ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"]
    need_request: List[str] = []
    for p in perms:
        # 这里的 checkSelfPermission 在 Activity 环境下是存在的，0 代表 PERMISSION_GRANTED
        if mActivity.checkSelfPermission(p) != 0:
            need_request.append(p)

    # 2. 如果需要申请，直接调用 mActivity.requestPermissions
    if need_request:
        # 直接将 Python 列表传入，Pyjnius 会尝试自动匹配 String[] 签名
        # 如果自动匹配失败，我们使用显式的 Java 签名调用
        try:
            # 这里的 123 是 requestCode，可以是任意正整数
            mActivity.requestPermissions(need_request, 123)
        except Exception:
            # 备选方案：如果直接传列表报错，手动指定方法签名
            request_method = mActivity.getClass().getMethod(
                "requestPermissions",
                autoclass('[Ljava.lang.String;'),  # 这是 Java 中 String[] 的内部类名表示法
                autoclass('int')
            )
            request_method.invoke(mActivity, cast('[Ljava.lang.String;', need_request), 123)

def add_task_reminder_to_calendar(title: str, desc: str, start_time_ms: Union[int, float],
                                  platform_service: Any) -> Optional[str]:
    """新增系统日历提醒，返回日历事件ID（失败返回 None）"""
    from android import mActivity
    try:
        # 1. 获取必要的原生类
        Uri = autoclass('android.net.Uri')
        ContentValues = autoclass('android.content.ContentValues')
        Long = autoclass('java.lang.Long')
        Integer = autoclass('java.lang.Integer')
        TimeZone = autoclass('java.util.TimeZone')

        # 日历相关的 URI 字符串
        EVENTS_URI = Uri.parse("content://com.android.calendar/events")
        REMINDERS_URI = Uri.parse("content://com.android.calendar/reminders")

        # 2. 构造日程数据
        values = ContentValues()
        # 重点：通过 type-safe 的方式逐个放入（如果 put 依然报错，尝试下面的反射法）
        # 这里我们利用 Python 字符串作为 key，Long/Integer 对象作为 value
        values.put("title", _build_event_title(title))
        values.put("description", str(desc))
        values.put("dtstart", Long(int(start_time_ms)))
        values.put("dtend", Long(int(start_time_ms + 1000 * 60 * 60 * 12)))
        values.put("calendar_id", Integer(1))
        values.put("eventTimezone", TimeZone.getDefault().getID())

        # 3. 插入日程
        content_resolver = mActivity.getContentResolver()
        event_uri = content_resolver.insert(EVENTS_URI, values)

        if not event_uri:
            platform_service.backend_logger().error("日程插入失败，请确认日历权限已开启")
            return None

        event_id = str(event_uri.getLastPathSegment())

        # 4. 插入提醒
        rem_values = ContentValues()
        rem_values.put("event_id", Long(int(event_id)))
        rem_values.put("method", Integer(1))  # 1 = METHOD_ALERT
        rem_values.put("minutes", Integer(0))  # 0 = 准时

        content_resolver.insert(REMINDERS_URI, rem_values)
        platform_service.backend_logger().info(f"添加提醒成功！事件ID: {event_id}")
        return event_id

    except Exception as e:
        # 如果还是报 put 错误，打印出具体的错误信息
        platform_service.backend_logger().error(f"执行失败: {str(e)}")
        return None

def delete_task_reminder_from_calendar(event_id: Union[str, int], platform_service: Any) -> bool:
    """删除系统日历中的提醒事件"""
    from android import mActivity
    try:
        Uri = autoclass('android.net.Uri')
        content_resolver = mActivity.getContentResolver()

        # 1. 删除事件本身
        events_uri = Uri.parse("content://com.android.calendar/events")
        content_resolver.delete(Uri.withAppendedPath(events_uri, str(event_id)), None, None)

        # 2. 部分系统不会级联删除提醒记录，这里显式清理一次（失败可忽略）
        try:
            reminders_uri = Uri.parse("content://com.android.calendar/reminders")
            content_resolver.delete(reminders_uri, "event_id = ?",
                                    _to_java_string_array([str(event_id)]))
        except Exception as e:
            platform_service.backend_logger().warning(f"清理日历提醒记录失败（可忽略）: {str(e)}")

        platform_service.backend_logger().info(f"删除提醒成功！事件ID: {event_id}")
        return True
    except Exception as e:
        platform_service.backend_logger().error(f"删除提醒失败: {str(e)}")
        return False

def find_task_reminder_event_id(title: str, start_time_ms: Union[int, float],
                                platform_service: Any) -> Optional[str]:
    """按标题 + 开始时间回查日历事件ID（兼容未记录事件ID的历史数据）"""
    from android import mActivity
    try:
        Uri = autoclass('android.net.Uri')
        content_resolver = mActivity.getContentResolver()
        cursor = content_resolver.query(
            Uri.parse("content://com.android.calendar/events"),
            _to_java_string_array(['_id']),
            "title = ? AND dtstart = ?",
            _to_java_string_array([_build_event_title(title), str(int(start_time_ms))]),
            None
        )
        if cursor is None:
            return None

        try:
            if cursor.moveToFirst():
                return str(cursor.getString(0))
            return None
        finally:
            cursor.close()
    except Exception as e:
        platform_service.backend_logger().error(f"回查日历提醒失败: {str(e)}")
        return None

def refresh_task_reminder_in_calendar(task_id: str, new_due_date: Optional[str],
                                      old_due_date: Optional[str],
                                      platform_service: Any) -> Optional[str]:
    """截止时间变更后刷新系统日历提醒

    先尽量清除旧的日历提醒（优先用已记录的事件ID，否则按标题 + 旧开始时间回查），
    再按新的截止时间新增提醒；即便旧提醒清除失败，也保证新的截止时间一定会提醒。
    """
    db = TodoDatabase()
    task = db.get_task(task_id) or {}
    title = task.get('title', '')
    description = task.get('description', '')

    old_start_time_ms = _to_timestamp_ms(old_due_date)
    new_start_time_ms = _to_timestamp_ms(new_due_date)

    # 1. 清除旧的日历提醒
    old_event_id = db.get_calendar_event_id(task_id)
    if not old_event_id and old_start_time_ms:
        old_event_id = find_task_reminder_event_id(title, old_start_time_ms, platform_service)
    if old_event_id:
        delete_task_reminder_from_calendar(old_event_id, platform_service)
        db.delete_calendar_event_id(task_id)

    # 2. 截止时间被清空时，删除旧提醒后即可结束
    if not new_start_time_ms:
        return None

    # 3. 按新的截止时间新增提醒，并记录事件ID便于下次变更时清除
    new_event_id = add_task_reminder_to_calendar(title, description, new_start_time_ms, platform_service)
    if new_event_id:
        db.save_calendar_event_id(task_id, new_event_id)
        platform_service.backend_logger().info(f"任务 {task_id} 截止时间已变更，日历提醒已刷新")
    else:
        platform_service.backend_logger().error(f"任务 {task_id} 截止时间已变更，但日历提醒刷新失败")
    return new_event_id

def sync_reminder_to_calendar(sync_start_time: Union[int, float],
                              sync_end_time: Union[int, float],
                              platform_service: Any) -> None:
    db = TodoDatabase()
    result = db.get_tasks_paginated(
        page_size=999,
        status='uncompleted',
        due_date_filter='sync',
        sync_start_time= datetime.fromtimestamp(sync_start_time).date(),
        sync_end_time= datetime.fromtimestamp(sync_end_time).date()
    )
    if result['tasks']:
        platform_service.backend_logger().error(f"添加提醒成功！事件ID: {result['tasks']}")
        for task in result['tasks']:
            target_time = datetime.fromisoformat(task['dueDate']).timestamp() * 1000
            event_id = add_task_reminder_to_calendar(task['title'], task['description'], target_time, platform_service)
            if event_id:
                db.save_calendar_event_id(task['id'], event_id)

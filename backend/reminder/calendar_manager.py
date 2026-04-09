"""
移动端消息日历提醒功能
"""

import os
import sys

from jnius import autoclass, cast
from datetime import datetime

from backend.database.operations import TodoDatabase

def check_permission():
    from android import mActivity
    # 1. 检查权限 (使用原生方法)
    perms = ["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"]
    need_request = []
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

def add_task_reminder_to_calendar(title, desc, start_time_ms):
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
        values.put("title", "【todoList】提醒：" + str(title))
        values.put("description", str(desc))
        values.put("dtstart", Long(int(start_time_ms)))
        values.put("dtend", Long(int(start_time_ms + 1000 * 60 * 60 * 12)))
        values.put("calendar_id", Integer(1))
        values.put("eventTimezone", TimeZone.getDefault().getID())

        # 3. 插入日程
        content_resolver = mActivity.getContentResolver()
        event_uri = content_resolver.insert(EVENTS_URI, values)

        if not event_uri:
            return "日程插入失败，请确认日历权限已开启"

        event_id = event_uri.getLastPathSegment()

        # 4. 插入提醒
        rem_values = ContentValues()
        rem_values.put("event_id", Long(int(event_id)))
        rem_values.put("method", Integer(1))  # 1 = METHOD_ALERT
        rem_values.put("minutes", Integer(0))  # 0 = 准时

        content_resolver.insert(REMINDERS_URI, rem_values)
        print(f"添加提醒成功！事件ID: {event_id}")
        return f"设置成功！事件ID: {event_id}"

    except Exception as e:
        # 如果还是报 put 错误，打印出具体的错误信息
        print(f"执行失败: {str(e)}")
        return f"执行失败: {str(e)}"

def sync_reminder_to_calendar(sync_start_time, sync_end_time):
    if hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ:
        db = TodoDatabase()
        result = db.get_tasks_paginated(
            page_size=999,
            status='uncompleted',
            due_date_filter='sync',
            sync_start_time= datetime.fromtimestamp(sync_start_time).date(),
            sync_end_time= datetime.fromtimestamp(sync_end_time).date()
        )
        if result['tasks']:
            print(f"添加提醒成功！事件ID: {result['tasks']}")
            for task in result['tasks']:
                target_time = datetime.fromisoformat(task['dueDate']).timestamp() * 1000
                add_task_reminder_to_calendar(task['title'], task['description'], target_time)
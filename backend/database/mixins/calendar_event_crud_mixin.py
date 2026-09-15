import sqlite3
from datetime import datetime
from typing import Optional

class CalendarEventCrudMixin:
    """任务与系统日历提醒事件的关联关系（仅移动端使用）

    记录任务对应的系统日历事件ID，便于截止时间变更后定位并清除旧的日历提醒。
    """

    def get_calendar_event_id(self, task_id: str) -> Optional[str]:
        """获取任务对应的日历事件ID"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('SELECT event_id FROM calendar_events WHERE task_id = ?', (task_id,))
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else None

    def save_calendar_event_id(self, task_id: str, event_id: Optional[str]) -> None:
        """保存（或更新）任务对应的日历事件ID"""
        if not task_id or not event_id:
            return

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO calendar_events (task_id, event_id, updated_at)
            VALUES (?, ?, ?)
        ''', (task_id, str(event_id), datetime.now().isoformat()))
        conn.commit()
        conn.close()

    def delete_calendar_event_id(self, task_id: str) -> None:
        """删除任务与日历事件的关联记录"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM calendar_events WHERE task_id = ?', (task_id,))
        conn.commit()
        conn.close()

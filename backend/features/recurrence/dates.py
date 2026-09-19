# backend/features/recurrence/dates.py
"""日期 / 时间的基础解析工具。

被 cron / rules / occurrences 共用，是本包最底层：不依赖包内其它模块，也不依赖数据库。
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Any, Dict, List, Optional, Sequence, Set

_WEEKDAY_LABELS: Dict[int, str] = {
    1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
}


def weekday_label(weekday: int) -> str:
    """ISO 星期（1=周一 … 7=周日）→ 中文短标签。"""
    return _WEEKDAY_LABELS.get(weekday, str(weekday))


def _parse_time(value: Any) -> Optional[time]:
    """把 'HH:MM'（或 'HH:MM:SS'）解析为 time，失败返回 None。"""
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    parts = text.split(':')
    if len(parts) < 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour, minute)


def parse_date(value: Any) -> Optional[date]:
    """把 'YYYY-MM-DD'（或完整 ISO 时间串）解析为 date，失败返回 None。"""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text if 'T' not in text else text.split('T')[0]).date()
    except ValueError:
        return None


def _minutes_of(value: time) -> int:
    return value.hour * 60 + value.minute


def _normalize_times(value: Any) -> List[str]:
    """归一化时间点列表：过滤非法值、去重并升序排序。"""
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        return []

    seen: Set[str] = set()
    result: List[str] = []
    for item in value:
        parsed = _parse_time(item)
        if parsed is None:
            continue
        text = f'{parsed.hour:02d}:{parsed.minute:02d}'
        if text in seen:
            continue
        seen.add(text)
        result.append(text)
    result.sort()
    return result


def _normalize_int_list(value: Any, low: int, high: int,
                        extra: Sequence[int] = ()) -> List[int]:
    """归一化整数列表（如星期 / 每月日期），过滤越界值并升序去重。"""
    if value is None:
        return []
    if isinstance(value, (int, float)):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        return []

    result: Set[int] = set()
    for item in value:
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if low <= number <= high or number in tuple(extra):
            result.add(number)
    return sorted(result)


def _normalize_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default

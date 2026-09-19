# backend/features/recurrence/occurrences.py
"""按周期规则生成发生时间。

这是规则引擎的出口：由持久层（任务续建）与接口层（预览）共同消费。
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from backend.features.recurrence.cron import CronError, _CronSchedule, compile_cron
from backend.features.recurrence.dates import (
    _minutes_of,
    _normalize_int,
    _parse_time,
    parse_date,
)
from backend.features.recurrence.rules import (
    DAILY_MODE_INTERVAL,
    END_COUNT,
    END_HABIT,
    FREQ_DAILY,
    FREQ_MONTHLY,
    FREQ_WEEKLY,
    FREQ_YEARLY,
    LAST_DAY,
    MAX_RECURRENCE_OCCURRENCES,
    MAX_SCAN_DAYS,
    MODE_CRON,
    PREVIEW_OCCURRENCE_LIMIT,
    validate_rule,
)


def _interval_times(rule: Dict[str, Any]) -> List[time]:
    """按「时间段 + 间隔」展开当天的时间点（含首尾）。"""
    start = _parse_time(rule.get('intervalStart'))
    end = _parse_time(rule.get('intervalEnd'))
    minutes = rule.get('intervalMinutes') or 0
    if start is None or end is None or int(minutes) <= 0:
        return []

    end_minutes = _minutes_of(end)
    current = _minutes_of(start)
    step = int(minutes)
    result: List[time] = []
    while current <= end_minutes:
        result.append(time(current // 60, current % 60))
        current += step
    return result


def _match_day_of_month(day: date, day_value: Optional[int]) -> bool:
    if day_value is None:
        return False
    if day_value == LAST_DAY:
        return day.day == calendar.monthrange(day.year, day.month)[1]
    return day.day == day_value


def _times_of_day(day: date, rule: Dict[str, Any], cron: Optional[_CronSchedule],
                  times: List[time]) -> List[time]:
    """返回某一天需要提醒的时间点列表（不含 Cron 编译结果时使用 times）。"""
    if rule.get('mode') == MODE_CRON:
        return cron.times_of_day(day) if cron else []

    freq = rule.get('freq')
    if freq == FREQ_DAILY:
        if rule.get('dailyMode') == DAILY_MODE_INTERVAL:
            return _interval_times(rule)
        return times

    if freq == FREQ_WEEKLY:
        return times if day.isoweekday() in (rule.get('weekdays') or []) else []

    if freq == FREQ_MONTHLY:
        month_days = rule.get('monthDays') or []
        hit = any(_match_day_of_month(day, value) for value in month_days)
        return times if hit else []

    if freq == FREQ_YEARLY:
        if day.month == rule.get('yearlyMonth') and _match_day_of_month(day, rule.get('yearlyDay')):
            return times
        return []

    return []


def _scan_occurrences(start: date, rule: Dict[str, Any], limit: int, floor: datetime,
                      end_date: Optional[date], scan_days: int) -> List[datetime]:
    """按天扫描规则命中的时间点，返回升序的发生时间（数量达到 limit 即停止）。"""
    cron: Optional[_CronSchedule] = None
    if rule.get('mode') == MODE_CRON:
        try:
            cron = compile_cron(rule.get('cron') or '')
        except CronError:
            return []

    times = [t for t in (_parse_time(item) for item in (rule.get('times') or [])) if t]

    results: List[datetime] = []
    day = start
    for _ in range(scan_days):
        if end_date and day > end_date:
            break
        for moment in _times_of_day(day, rule, cron, times):
            occurrence = datetime.combine(day, moment)
            if occurrence <= floor:
                continue
            results.append(occurrence)
            if len(results) >= limit:
                return results
        day += timedelta(days=1)

    return results


def build_occurrences(start: date, rule: Optional[Dict[str, Any]],
                      limit: int = MAX_RECURRENCE_OCCURRENCES,
                      now: Optional[datetime] = None) -> List[datetime]:
    """按规则生成发生时间列表（升序，已按 limit 截断）。

    参数:
        start: 周期起始日期（提醒时间点由规则决定，起始日期只提供日期部分）
        rule: 归一化后的规则字典
        limit: 最多生成的条数上限
        now: 时间下限基准，早于该时刻的发生时间会被跳过（默认取当前时间），
            避免补建出一批已经过期的提醒

    习惯类任务（endType = habit）同一时刻只保留一条待办，因此固定只生成第一个
    发生时间，后续由 :func:`next_occurrence_after` 在完成后续建。
    """
    if not rule or start is None:
        return []

    ok, _message = validate_rule(rule)
    if not ok:
        return []

    end_type = rule.get('endType') or END_HABIT
    if end_type == END_HABIT:
        limit = 1
    else:
        limit = max(1, min(int(limit), MAX_RECURRENCE_OCCURRENCES))
        count = _normalize_int(rule.get('count'))
        if end_type == END_COUNT and count:
            limit = max(1, min(limit, int(count)))

    end_date = parse_date(rule.get('endDate'))
    scan_days = MAX_SCAN_DAYS
    if end_date:
        scan_days = min(scan_days, max(0, (end_date - start).days + 1))
    if scan_days <= 0:
        return []

    return _scan_occurrences(start, rule, limit, now or datetime.now(),
                             end_date, scan_days)


def next_occurrence_after(start: date, rule: Optional[Dict[str, Any]],
                          after: datetime) -> Optional[datetime]:
    """返回严格晚于 ``after`` 的下一个发生时间（习惯任务续建用），无匹配返回 None。"""
    if not rule or start is None:
        return None

    ok, _message = validate_rule(rule)
    if not ok:
        return None

    # 从「规则起始日」与「当前时间」中较晚的一天开始扫描，避免重复扫描历史区间
    scan_start = start if start > after.date() else after.date()
    results = _scan_occurrences(scan_start, rule, 1, after, None, MAX_SCAN_DAYS)
    return results[0] if results else None


def preview_occurrences(start: date, rule: Optional[Dict[str, Any]],
                        limit: int = PREVIEW_OCCURRENCE_LIMIT,
                        now: Optional[datetime] = None) -> List[str]:
    """生成预览用的发生时间（ISO 字符串列表）。"""
    occurrences = build_occurrences(
        start, rule, limit=max(1, min(int(limit), PREVIEW_OCCURRENCE_LIMIT)), now=now)
    return [item.isoformat() for item in occurrences]

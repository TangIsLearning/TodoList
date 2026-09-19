# backend/features/recurrence/rules.py
"""周期规则的常量定义、归一化 / 序列化 / 校验。

规则以 JSON 字符串存放在 ``tasks.recurrence_rule`` 列（仅父任务持有），支持两种模式：
普通模式（每天 / 每周 / 每月 / 每年）与 Cron 模式，详见 :func:`validate_rule`。
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple

from backend.features.recurrence.cron import CronError, compile_cron
from backend.features.recurrence.dates import (
    _minutes_of,
    _normalize_int,
    _normalize_int_list,
    _normalize_times,
    _parse_time,
    parse_date,
)

# recurrence_count / endType 为空（永不结束）时，周期性任务最多生成的任务总数（含父任务）
MAX_RECURRENCE_OCCURRENCES = 200
# 预览接口一次最多返回的发生时间条数
PREVIEW_OCCURRENCE_LIMIT = 10
# 生成时的最大扫描天数（约 10 年），防止规则永远匹配不到时死循环
MAX_SCAN_DAYS = 3653

MODE_NORMAL = 'normal'
MODE_CRON = 'cron'

FREQ_DAILY = 'daily'
FREQ_WEEKLY = 'weekly'
FREQ_MONTHLY = 'monthly'
FREQ_YEARLY = 'yearly'
FREQUENCIES: Tuple[str, ...] = (FREQ_DAILY, FREQ_WEEKLY, FREQ_MONTHLY, FREQ_YEARLY)

DAILY_MODE_TIMES = 'times'
DAILY_MODE_INTERVAL = 'interval'

END_NEVER = 'never'  # 历史取值，已废弃；归一化时按「习惯」处理
END_COUNT = 'count'
END_DATE = 'date'
# 习惯：同一时刻只保留一条未完成待办，完成后才按周期生成下一条，避免无限创建任务
END_HABIT = 'habit'
END_TYPES: Tuple[str, ...] = (END_COUNT, END_DATE, END_HABIT)

# 每月 / 每年日期中的「最后一天」哨兵值
LAST_DAY = -1


def rule_from_json(raw: Any) -> Optional[Dict[str, Any]]:
    """把数据库中的 JSON 字符串解析为规则字典；空值或非法格式返回 None。"""
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def rule_to_json(rule: Optional[Dict[str, Any]]) -> Optional[str]:
    """规则字典 → JSON 字符串（空规则返回 None）。"""
    if not rule:
        return None
    return json.dumps(rule, ensure_ascii=False, sort_keys=True)


def normalize_rule(data: Any) -> Dict[str, Any]:
    """把前端传入的规则（dict 或 JSON 字符串）归一化为标准结构。

    归一化只做「清洗」，不做业务校验；校验请使用 :func:`validate_rule`。
    """
    raw = rule_from_json(data)
    if not raw:
        return {}

    mode = raw.get('mode') or MODE_NORMAL
    if mode not in (MODE_NORMAL, MODE_CRON):
        mode = MODE_NORMAL

    rule: Dict[str, Any] = {
        'mode': mode,
        'freq': raw.get('freq') if raw.get('freq') in FREQUENCIES else None,
        'dailyMode': raw.get('dailyMode') if raw.get('dailyMode') in (
            DAILY_MODE_TIMES, DAILY_MODE_INTERVAL) else DAILY_MODE_TIMES,
        'times': _normalize_times(raw.get('times')),
        'intervalStart': _normalize_time_str(raw.get('intervalStart'), '09:00'),
        'intervalEnd': _normalize_time_str(raw.get('intervalEnd'), '18:00'),
        'intervalMinutes': _normalize_int(raw.get('intervalMinutes'), 60) or 60,
        'weekdays': _normalize_int_list(raw.get('weekdays'), 1, 7),
        'monthDays': _normalize_int_list(raw.get('monthDays'), 1, 31, extra=(LAST_DAY,)),
        'yearlyMonth': _normalize_int(raw.get('yearlyMonth')),
        'yearlyDay': _normalize_int(raw.get('yearlyDay')),
        'cron': str(raw.get('cron') or '').strip(),
        'endType': _normalize_end_type(raw.get('endType')),
        'count': _normalize_int(raw.get('count')),
        'endDate': _as_date_str(raw.get('endDate')),
    }

    if rule['endType'] != END_COUNT:
        rule['count'] = None
    if rule['endType'] != END_DATE:
        rule['endDate'] = None

    if rule['mode'] == MODE_CRON:
        # Cron 模式下频率等普通模式字段无意义，统一清空，避免脏数据干扰展示
        rule.update(freq=None, dailyMode=DAILY_MODE_TIMES, times=[],
                    weekdays=[], monthDays=[], yearlyMonth=None, yearlyDay=None)
    return rule


def _normalize_end_type(value: Any) -> str:
    """归一化结束方式；历史数据的 'never' 与缺失值都按「习惯」处理（不会无限建任务）。"""
    if value == END_NEVER or value == END_HABIT:
        return END_HABIT
    return value if value in END_TYPES else END_HABIT


def _normalize_time_str(value: Any, default: str) -> str:
    parsed = _parse_time(value)
    return f'{parsed.hour:02d}:{parsed.minute:02d}' if parsed else default


def _as_date_str(value: Any) -> Optional[str]:
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else None


def validate_rule(rule: Optional[Dict[str, Any]]) -> Tuple[bool, str]:
    """校验规则是否可用，返回 ``(是否通过, 错误提示)``。"""
    if not rule:
        return False, '周期规则不能为空'

    mode = rule.get('mode') or MODE_NORMAL
    if mode == MODE_CRON:
        expr = (rule.get('cron') or '').strip()
        if not expr:
            return False, 'Cron 表达式不能为空'
        try:
            compile_cron(expr)
        except CronError as exc:
            return False, f'Cron 表达式无效：{exc}'
        return _validate_end(rule)

    freq = rule.get('freq')
    if freq not in FREQUENCIES:
        return False, '请选择重复周期'

    if freq == FREQ_DAILY:
        if rule.get('dailyMode') == DAILY_MODE_INTERVAL:
            start = _parse_time(rule.get('intervalStart'))
            end = _parse_time(rule.get('intervalEnd'))
            minutes = rule.get('intervalMinutes') or 0
            if start is None or end is None:
                return False, '请填写完整的时间段'
            if _minutes_of(end) <= _minutes_of(start):
                return False, '时间段结束时间需晚于开始时间'
            if not 1 <= int(minutes) <= 1440:
                return False, '间隔分钟需在 1-1440 之间'
        elif not rule.get('times'):
            return False, '请至少添加一个提醒时间点'

    elif freq == FREQ_WEEKLY:
        if not rule.get('weekdays'):
            return False, '请至少选择一个星期'
        if not rule.get('times'):
            return False, '请至少添加一个提醒时间点'

    elif freq == FREQ_MONTHLY:
        if not rule.get('monthDays'):
            return False, '请至少选择一个日期'
        if not rule.get('times'):
            return False, '请至少添加一个提醒时间点'

    elif freq == FREQ_YEARLY:
        month = rule.get('yearlyMonth')
        day = rule.get('yearlyDay')
        if not month or not 1 <= int(month) <= 12:
            return False, '请选择有效的月份'
        if day is None or (day != LAST_DAY and not 1 <= int(day) <= 31):
            return False, '请选择有效的日期'
        if not rule.get('times'):
            return False, '请添加一个提醒时间点'

    return _validate_end(rule)


def _validate_end(rule: Dict[str, Any]) -> Tuple[bool, str]:
    end_type = rule.get('endType') or END_HABIT
    if end_type == END_COUNT:
        count = rule.get('count')
        if not count or int(count) < 1:
            return False, '请输入有效的循环次数'
    elif end_type == END_DATE:
        if not parse_date(rule.get('endDate')):
            return False, '请选择有效的结束日期'
    return True, ''

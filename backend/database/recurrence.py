# backend/database/recurrence.py
"""周期性任务规则引擎。

规则以 JSON 字符串存放在 ``tasks.recurrence_rule`` 列（仅父任务持有），支持两种配置模式：

- **普通模式（normal）**：每天 / 每周 / 每月 / 每年
  - 每天：可配置多个时间点（09:00 / 14:00 / 21:30），或使用「时间段 + 间隔」
    （09:00–18:00 每隔 45 分钟）
  - 每周：任意星期组合 × 多个时间点
  - 每月：任意日期组合（含「最后一天」）× 多个时间点
  - 每年：固定「月 + 日」× 单个时间点
- **Cron 模式（cron）**：标准 5 字段 Cron 表达式（分 时 日 月 周）

结束方式有三种：

- ``count``：按次数结束
- ``date``：按日期结束
- ``habit``：习惯。同一时刻只保留一条未完成待办，完成后才按周期生成下一条
  （``build_occurrences`` 只产出第一个发生时间，续建由 ``next_occurrence_after`` 完成），
  因此不会产生无限任务

模块职责：规则归一化 / 校验 / 发生时间生成。不依赖任何第三方库
（Cron 解析为内置实现，避免为打包产物引入新依赖）。
"""

from __future__ import annotations

import calendar
import json
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

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

_WEEKDAY_LABELS: Dict[int, str] = {
    1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日',
}


# --------------------------------------------------------------------------- #
# 基础解析工具
# --------------------------------------------------------------------------- #

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


# --------------------------------------------------------------------------- #
# Cron 表达式（5 字段：分 时 日 月 周）
# --------------------------------------------------------------------------- #

_CRON_FIELDS: Tuple[Tuple[str, int, int], ...] = (
    ('分钟', 0, 59),
    ('小时', 0, 23),
    ('日', 1, 31),
    ('月', 1, 12),
    ('周', 0, 7),
)


class CronError(ValueError):
    """Cron 表达式非法。"""


def _parse_cron_field(field: str, name: str, low: int, high: int) -> Set[int]:
    """解析单个 Cron 字段，支持 `*`、`*/n`、`a-b`、`a-b/n`、`a,b,c`。"""
    values: Set[int] = set()
    for chunk in field.split(','):
        chunk = chunk.strip()
        if not chunk:
            raise CronError(f'Cron {name}字段不能为空')

        step = 1
        if '/' in chunk:
            chunk, raw_step = chunk.split('/', 1)
            step = _normalize_int(raw_step.strip())
            if not step or step < 1:
                raise CronError(f'Cron {name}字段步长非法')

        chunk = chunk.strip()
        if chunk == '*':
            start, end = low, high
        elif '-' in chunk[1:]:
            raw_start, raw_end = chunk.split('-', 1)
            start = _normalize_int(raw_start.strip())
            end = _normalize_int(raw_end.strip())
        else:
            start = end = _normalize_int(chunk)

        if start is None or end is None:
            raise CronError(f'Cron {name}字段格式非法')
        if start > end:
            start, end = end, start
        if start < low or end > high:
            raise CronError(f'Cron {name}字段取值需在 {low}-{high} 之间')

        values.update(range(start, end + 1, step))
    if not values:
        raise CronError(f'Cron {name}字段未匹配到任何取值')
    return values


class _CronSchedule:
    """编译后的 Cron 计划，用于按天快速判定是否命中。"""

    __slots__ = ('minutes', 'hours', 'dom', 'month', 'dow',
                 'dom_restricted', 'dow_restricted', '_day_times')

    def __init__(self, expr: str) -> None:
        fields = expr.split()
        if len(fields) != 5:
            raise CronError('Cron 表达式需为 5 个字段：分 时 日 月 周')

        raw = [f.strip() for f in fields]
        minute_field, hour_field, dom_field, month_field, dow_field = raw

        self.minutes = _parse_cron_field(minute_field, *_CRON_FIELDS[0])
        self.hours = _parse_cron_field(hour_field, *_CRON_FIELDS[1])
        self.dom = _parse_cron_field(dom_field, *_CRON_FIELDS[2])
        self.month = _parse_cron_field(month_field, *_CRON_FIELDS[3])
        dow = _parse_cron_field(dow_field, *_CRON_FIELDS[4])
        # 0 与 7 均表示周日，统一收敛为 0
        self.dow = {0 if d == 7 else d for d in dow}

        # 标准 Cron 语义：日与周同时被限定时取「或」，否则取「与」
        self.dom_restricted = dom_field != '*'
        self.dow_restricted = dow_field != '*'

        self._day_times = [time(h, m) for h in sorted(self.hours) for m in sorted(self.minutes)]

    def times_of_day(self, day: date) -> List[time]:
        if day.month not in self.month:
            return []
        dom_hit = day.day in self.dom
        # ISO 星期：周一=1 … 周六=6；Cron 周字段：周日=0，故 7 % 7 = 0
        dow_hit = (day.isoweekday() % 7) in self.dow
        if self.dom_restricted and self.dow_restricted:
            if not (dom_hit or dow_hit):
                return []
        elif not (dom_hit and dow_hit):
            return []
        return self._day_times


def compile_cron(expr: str) -> _CronSchedule:
    """编译 Cron 表达式，非法时抛出 CronError（message 可直接展示给用户）。"""
    return _CronSchedule(expr)


# --------------------------------------------------------------------------- #
# 规则归一化 / 序列化 / 校验
# --------------------------------------------------------------------------- #

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


# --------------------------------------------------------------------------- #
# 发生时间生成
# --------------------------------------------------------------------------- #

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

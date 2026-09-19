# backend/features/recurrence/cron.py
"""标准 5 字段 Cron 表达式（分 时 日 月 周）的解析与编译。

Cron 解析为内置实现，避免为打包产物引入第三方依赖。
"""
from __future__ import annotations

from datetime import date, time
from typing import List, Set, Tuple

from backend.features.recurrence.dates import _normalize_int

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

# backend/features/recurrence/__init__.py
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

这里是统一门面，日常请直接从本包导入；需要单独关注某一块时再按模块引用：
- backend.features.recurrence.rules：常量 + 归一化 / 序列化 / 校验
- backend.features.recurrence.occurrences：发生时间生成
- backend.features.recurrence.cron：Cron 表达式编译
- backend.features.recurrence.dates：日期 / 时间解析工具
"""

from backend.features.recurrence.cron import CronError, compile_cron
from backend.features.recurrence.dates import parse_date, weekday_label
from backend.features.recurrence.occurrences import (
    build_occurrences,
    next_occurrence_after,
    preview_occurrences,
)
from backend.features.recurrence.rules import (
    DAILY_MODE_INTERVAL,
    DAILY_MODE_TIMES,
    END_COUNT,
    END_DATE,
    END_HABIT,
    END_NEVER,
    END_TYPES,
    FREQ_DAILY,
    FREQ_MONTHLY,
    FREQ_WEEKLY,
    FREQ_YEARLY,
    FREQUENCIES,
    LAST_DAY,
    MAX_RECURRENCE_OCCURRENCES,
    MAX_SCAN_DAYS,
    MODE_CRON,
    MODE_NORMAL,
    PREVIEW_OCCURRENCE_LIMIT,
    normalize_rule,
    rule_from_json,
    rule_to_json,
    validate_rule,
)

__all__ = [
    # 规则常量
    'MODE_NORMAL',
    'MODE_CRON',
    'FREQ_DAILY',
    'FREQ_WEEKLY',
    'FREQ_MONTHLY',
    'FREQ_YEARLY',
    'FREQUENCIES',
    'DAILY_MODE_TIMES',
    'DAILY_MODE_INTERVAL',
    'END_NEVER',
    'END_COUNT',
    'END_DATE',
    'END_HABIT',
    'END_TYPES',
    'LAST_DAY',
    'MAX_RECURRENCE_OCCURRENCES',
    'MAX_SCAN_DAYS',
    'PREVIEW_OCCURRENCE_LIMIT',
    # 日期工具
    'weekday_label',
    'parse_date',
    # Cron
    'CronError',
    'compile_cron',
    # 规则归一化 / 校验
    'rule_from_json',
    'rule_to_json',
    'normalize_rule',
    'validate_rule',
    # 发生时间生成
    'build_occurrences',
    'next_occurrence_after',
    'preview_occurrences',
]

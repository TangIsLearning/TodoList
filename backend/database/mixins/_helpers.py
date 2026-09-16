# backend/database/mixins/_helpers.py
"""Crud Mixin 共享的 SQL 组装工具。

集中定义批量操作所需的常量与纯函数，避免各 mixin 各自复制一份实现。
"""
from typing import Any, Iterable, Sequence

# SQLite 单条语句的参数上限，批量操作按此拆分
SQLITE_MAX_VARS = 500


def chunks(items: Sequence[Any], size: int = SQLITE_MAX_VARS) -> Iterable[Sequence[Any]]:
    """按 SQLite 参数上限把批量参数切片，避免单条语句参数超限。"""
    for start in range(0, len(items), size):
        yield items[start:start + size]


def placeholders(count: int) -> str:
    """生成 count 个以逗号分隔的 '?' 占位符，用于 IN (...) 子句。"""
    return ','.join(['?'] * count)

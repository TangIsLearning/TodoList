# backend/database/query/types.py
"""任务查询的结构化表示。"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ParentRef:
    """父任务引用（'>父任务' 搜索模式）。

    id 优先：前端从建议下拉选中时会带上精确 ID，可消除同名任务的歧义。
    没有 id 时按 name 精确匹配回退（不区分大小写）。
    """

    id: str | None = None
    name: str | None = None

    def is_empty(self) -> bool:
        return not self.id and not self.name


@dataclass(frozen=True)
class ParsedQuery:
    """解析后的查询条件。

    各条件之间为 AND 语义：任务必须同时满足所有条件才会命中。

    tags:     标签名（模糊匹配，兼容旧 '#标签' 字符串协议）
    tag_ids:  精确标签 ID（前端 chips 直接提供，优先于名称匹配）
    keywords: 普通文本关键词（匹配标题 / 描述 / 标签名）
    parent:   父任务引用，命中其直接子任务
    """

    tags: tuple[str, ...] = ()
    tag_ids: tuple[str, ...] = ()
    keywords: tuple[str, ...] = ()
    parent: ParentRef | None = None
    # 只要"含有任意标签"即可（对应快捷筛选"含标签任务"，旧协议里用单独的 '#' 表示）
    has_any_tag: bool = False

    def is_empty(self) -> bool:
        if self.tags or self.tag_ids or self.keywords or self.has_any_tag:
            return False
        return self.parent is None or self.parent.is_empty()

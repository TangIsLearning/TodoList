# backend/database/query/parser.py
"""搜索查询的唯一解析入口。

纯函数模块：不连接数据库、不依赖表结构，可独立单测。
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Union

from backend.database.query.types import ParsedQuery, ParentRef

# '>' 前缀：父任务搜索；'#' 前缀：标签搜索；'@' 前缀：截止时间搜索
PARENT_PREFIX = '>'
TAG_PREFIX = '#'
DUE_PREFIX = '@'
# 旧字符串协议中多个关键词的分隔符
KEYWORD_SEPARATOR = ';'


def parse_search_query(raw: Union[str, Dict[str, Any], None]) -> ParsedQuery:
    """把前端传入的原始查询解析成 ParsedQuery。

    支持三种输入：
      1. 结构化 dict（前端 chips 的序列化结果，推荐）:
         {'tags': [{'id': 't1', 'name': '工作'}, '紧急'],
          'keywords': ['报表'],
          'parent': {'id': 'p1', 'name': '项目A'},
          'dueDate': '2026-09-19',  # 可选：截止日期（当天，忽略时刻）
          'anyTag': True}          # 可选：只要含有任意标签
      2. 旧字符串协议（兼容保留）:
         '#工作;紧急'  ->  标签"工作" AND 关键词"紧急"
         '>项目A'      ->  项目A 的子任务
         '@2026-09-19' ->  截止日期在 2026-09-19 的任务
         '#'           ->  含有任意标签的任务
         '报表'        ->  关键词"报表"
      3. None / 空串 -> 空查询
    """
    if raw is None:
        return ParsedQuery()
    if isinstance(raw, dict):
        return _from_dict(raw)
    if isinstance(raw, str):
        text = raw.strip()
        return _from_string(text) if text else ParsedQuery()
    return ParsedQuery()


def _from_string(text: str) -> ParsedQuery:
    """解析旧字符串协议。

    '>' / '@' 只在整串开头生效；'#' 只在片段开头生效，且后面必须有内容，
    否则 '#' / '>' / '@' 会被当作普通文本的一部分。
    """
    if text.startswith(PARENT_PREFIX):
        name = text[len(PARENT_PREFIX):].strip()
        if name:
            return ParsedQuery(parent=ParentRef(id=None, name=name))
        return ParsedQuery()

    if text.startswith(DUE_PREFIX):
        due_date = _normalize_due_date(text)
        # 解析失败时退回普通关键词，避免用户输入被静默丢弃
        return ParsedQuery(due_date=due_date) if due_date else ParsedQuery(keywords=(text,))

    tags: List[str] = []
    keywords: List[str] = []
    has_any_tag = False
    for part in text.strip(KEYWORD_SEPARATOR).split(KEYWORD_SEPARATOR):
        kw = part.strip()
        if not kw:
            continue
        if kw.startswith(TAG_PREFIX):
            name = kw[len(TAG_PREFIX):].strip()
            if name:
                tags.append(name)
            else:
                # 裸 '#'：只要含有任意标签即可（快捷筛选"含标签任务"）
                has_any_tag = True
            continue
        keywords.append(kw)

    return ParsedQuery(
        tags=tuple(tags),
        keywords=tuple(keywords),
        has_any_tag=has_any_tag,
    )


def _from_dict(data: Dict[str, Any]) -> ParsedQuery:
    """解析前端结构化查询对象。"""
    tags: List[str] = []
    tag_ids: List[str] = []
    for item in _as_list(data.get('tags')):
        if isinstance(item, dict):
            name = _clean_str(item.get('name'))
            tag_id = _clean_str(item.get('id'))
            # 有精确 ID 时优先用 ID，避免同名标签歧义
            if tag_id:
                tag_ids.append(tag_id)
            elif name:
                tags.append(name)
            continue
        name = _clean_str(item)
        if name:
            tags.append(name)

    keywords = [kw for kw in (_clean_str(k) for k in _as_list(data.get('keywords'))) if kw]

    return ParsedQuery(
        tags=tuple(tags),
        tag_ids=tuple(tag_ids),
        keywords=tuple(keywords),
        parent=_parse_parent(data.get('parent')),
        due_date=_normalize_due_date(data.get('dueDate')),
        has_any_tag=bool(data.get('anyTag')),
    )


def _normalize_due_date(raw: Any) -> Optional[str]:
    """把 '2026-09-19' / '@2026-09-19' / '2026/9/19' 归一化为 YYYY-MM-DD。

    非法或日期不存在（如 2026-02-30）时返回 None，由调用方决定是忽略还是退回关键词。
    """
    text = _clean_str(raw)
    if not text:
        return None
    if text.startswith(DUE_PREFIX):
        text = text[len(DUE_PREFIX):].strip()
    parts = text.replace('/', '-').split('-')
    if len(parts) != 3:
        return None
    try:
        year, month, day = (int(part) for part in parts)
        parsed = date(year, month, day)
    except (ValueError, TypeError):
        return None
    return parsed.isoformat()


def _parse_parent(raw: Any) -> Optional[ParentRef]:
    if isinstance(raw, dict):
        parent_id = _clean_str(raw.get('id'))
        parent_name = _clean_str(raw.get('name'))
        if parent_id or parent_name:
            return ParentRef(id=parent_id, name=parent_name)
        return None
    if isinstance(raw, str) and raw.strip():
        return ParentRef(id=None, name=raw.strip())
    return None


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _clean_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None

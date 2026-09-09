# backend/database/mixins/statistics_crud_mixin.py
"""
统计查询 Mixin
提供面向「统计视图」的聚合查询能力：
- 时间口径：创建时间(created) / 截止时间(due) / 完成时间(completed)
- 时间范围：全部 / 年 / 月 / 具体周
- 分类筛选

为避免对历史数据分布做过强假设，聚合统一在 Python 侧基于
TaskCrudMixin.get_all_tasks() 完成（当前数据规模在数千条内，性能可接受），
同时便于跨月/跨天做零填充、保持各图表口径一致。
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

# 优先级展示顺序
_PRIORITY_ORDER = ['high', 'medium', 'low', 'none']


def _safe_dt(value) -> Optional[datetime]:
    """宽松解析 ISO 时间字符串 / 纯日期字符串，统一返回 naive datetime。"""
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.fromisoformat(s[:19])
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


def _month_range(ym: str):
    """根据 'YYYY-MM' 返回该月首日与末日(date)。"""
    year, month = int(ym[:4]), int(ym[5:7])
    first = date(year, month, 1)
    if month == 12:
        nxt = date(year + 1, 1, 1)
    else:
        nxt = date(year, month + 1, 1)
    return first, nxt - timedelta(days=1)


class StatisticsCrudMixin:

    def _statistics_basis_dt(self, task: Dict[str, Any], date_basis: str) -> Optional[datetime]:
        """按统计口径取出任务的时间值。"""
        if date_basis == 'created':
            return _safe_dt(task.get('createdAt'))
        if date_basis == 'due':
            if not task.get('dueDate'):
                return None
            return _safe_dt(task.get('dueDate'))
        # completed：以完成任务时的 updated_at 近似完成时间
        if not task.get('completed'):
            return None
        return _safe_dt(task.get('updatedAt'))

    def get_statistics_options(self, date_basis: str = 'created') -> Dict[str, Any]:
        """返回指定时间口径下，可用于筛选的年/月/周候选项。"""
        dates: List[datetime] = []
        try:
            import sqlite3
            conn = sqlite3.connect(self.db_path)
            try:
                rows = conn.execute(
                    'SELECT completed, created_at, due_date, updated_at FROM tasks'
                ).fetchall()
            finally:
                conn.close()
            for completed, created_at, due_date, updated_at in rows:
                if date_basis == 'due':
                    dt = _safe_dt(due_date)
                elif date_basis == 'completed':
                    dt = _safe_dt(updated_at) if completed else None
                else:
                    dt = _safe_dt(created_at)
                if dt:
                    dates.append(dt)
        except Exception:
            # 表结构异常时退化为从任务列表计算
            tasks = self.get_all_tasks()
            dates = [dt for t in tasks if (dt := self._statistics_basis_dt(t, date_basis))]

        years: List[str] = []
        months: List[str] = []
        week_starts: List[date] = []

        for dt in dates:
            ym = dt.strftime('%Y-%m')
            if ym not in months:
                months.append(ym)
            y = dt.strftime('%Y')
            if y not in years:
                years.append(y)
            monday = dt.date() - timedelta(days=dt.weekday())
            if monday not in week_starts:
                week_starts.append(monday)

        years.sort()
        months.sort()
        week_starts.sort()

        weeks = []
        for monday in week_starts:
            sunday = monday + timedelta(days=6)
            weeks.append({
                'start': monday.isoformat(),
                'end': sunday.isoformat(),
            })

        return {
            'basis': date_basis,
            'years': years,
            'months': months,
            'weeks': weeks,
        }

    def get_task_statistics(
        self,
        date_basis: str = 'created',
        scope: str = 'all',
        year: Optional[str] = None,
        month: Optional[str] = None,
        week: Optional[str] = None,
        category_id: Optional[str] = None,
        tag_ids: Optional[list] = None,
    ) -> Dict[str, Any]:
        """统计查询主入口，返回统计视图所需的聚合数据。"""
        basis = date_basis if date_basis in ('created', 'due', 'completed') else 'created'
        # 归一化分类筛选值
        sel_cat = None
        if category_id not in (None, '', 'all'):
            sel_cat = str(category_id)
        # 归一化标签筛选值：命中任意一个即计入（与列表 #标签 搜索的 OR 语义一致）
        sel_tags = None
        if tag_ids:
            norm = {str(t) for t in tag_ids if t is not None and str(t) not in ('', 'all')}
            if norm:
                sel_tags = norm

        all_tasks = self.get_all_tasks()

        # ---- 1. 计算该任务所属统计时间点，并做时间范围筛选 ----
        now = datetime.now()
        today = now.date()

        # 时间范围边界（含首尾）。scope 为 all 时不做限制
        start_day: Optional[date] = None
        end_day: Optional[date] = None
        if scope == 'year' and year:
            y = int(str(year)[:4])
            start_day = date(y, 1, 1)
            end_day = date(y, 12, 31)
        elif scope == 'month' and month:
            start_day, end_day = _month_range(str(month)[:7])
        elif scope == 'week' and week:
            try:
                monday = date.fromisoformat(str(week)[:10])
            except ValueError:
                monday = None
            if monday is not None:
                # 将任意给定日归一到所在周周一
                monday = monday - timedelta(days=monday.weekday())
                start_day = monday
                end_day = monday + timedelta(days=6)

        included: List[Dict[str, Any]] = []
        pairs: List = []  # (task, basis_datetime)，保持与 included 一一对应
        for task in all_tasks:
            # 完成时间口径只统计已完成的任务（未完成没有完成时间）
            if basis == 'completed' and not task.get('completed'):
                continue
            cat_id = task.get('categoryId')
            if sel_cat == 'uncategorized':
                if cat_id is not None:
                    continue
            elif sel_cat is not None and (cat_id is None or str(cat_id) != sel_cat):
                continue
            if sel_tags is not None:
                task_tag_ids = {
                    str(tg.get('id'))
                    for tg in (task.get('tags') or [])
                    if tg.get('id') is not None
                }
                if not (task_tag_ids & sel_tags):
                    continue

            dt = self._statistics_basis_dt(task, basis)
            if start_day is not None:
                if dt is None:
                    continue
                d = dt.date()
                if d < start_day or d > end_day:
                    continue
            included.append(task)
            pairs.append((task, dt))
        basis_dates = [p[1] for p in pairs if p[1] is not None]

        # ---- 2. KPI ----
        total = len(included)
        completed = sum(1 for t in included if t.get('completed'))
        uncompleted = total - completed
        completion_rate = round(completed / total * 100, 1) if total else 0.0

        overdue = 0
        no_due = 0
        for t in included:
            due_str = t.get('dueDate')
            due_dt = _safe_dt(due_str) if due_str else None
            if due_dt is None:
                no_due += 1
            elif not t.get('completed') and due_dt.date() < today:
                overdue += 1

        # ---- 3. 趋势 ----
        # 粒度与筛选档位一一对应：
        #   全部时间 -> 年粒度（横轴：2026、2025 ...）
        #   按年份   -> 月粒度（横轴：该年 01月-12月）
        #   按月份   -> 日粒度（横轴：该月 1日-月末）
        #   按周     -> 日粒度（横轴：该周 周一-周日）
        # 月/周等有明确边界的选择即使范围内无任务，也会输出补 0 的完整序列。
        if scope == 'all':
            trend_granularity = 'year'
        elif scope == 'year':
            trend_granularity = 'month'
        else:
            trend_granularity = 'day'

        items: List[Dict[str, Any]] = []

        def _count_bucket(predicate):
            cnt = 0
            cnt_done = 0
            for task, dt in pairs:
                if dt is not None and predicate(dt):
                    cnt += 1
                    if task.get('completed'):
                        cnt_done += 1
            return cnt, cnt_done

        if trend_granularity == 'year':
            # 全部时间：按年聚合（横轴为有数据的年份）
            yr_set = sorted({d.strftime('%Y') for d in basis_dates})
            for yr in yr_set:
                cnt, cnt_done = _count_bucket(lambda dt, y=yr: dt.strftime('%Y') == y)
                items.append({
                    'key': yr,
                    'label': yr,
                    'total': cnt,
                    'completed': cnt_done,
                    'uncompleted': cnt - cnt_done,
                })
        elif trend_granularity == 'month':
            # 按年份：展示该年 1-12 月（跨月连续、无任务月份补 0）
            cur = last = None
            if scope == 'year' and start_day is not None:
                cur = f'{start_day.year}-01'
                last = f'{start_day.year}-12'
            else:
                ym_set = {d.strftime('%Y-%m') for d in basis_dates}
                if ym_set:
                    cur, last = min(ym_set), max(ym_set)
            while cur and cur <= last:
                ym = cur
                first_day, last_day = _month_range(ym)
                cnt, cnt_done = _count_bucket(
                    lambda dt, f=first_day, l=last_day: f <= dt.date() <= l)
                items.append({
                    'key': ym,
                    'label': ym,
                    'total': cnt,
                    'completed': cnt_done,
                    'uncompleted': cnt - cnt_done,
                })
                # 推进到下一个月
                if int(ym[5:7]) == 12:
                    cur = f'{int(ym[:4]) + 1}-01'
                else:
                    cur = f'{ym[:4]}-{int(ym[5:7]) + 1:02d}'
        else:
            # 按月份/按周：展示完整逐日序列（含无任务日期）
            if start_day is not None:
                day = start_day
                max_day = end_day
                while day <= max_day:
                    cnt, cnt_done = _count_bucket(lambda dt, d=day: dt.date() == d)
                    items.append({
                        'key': day.isoformat(),
                        'label': day.isoformat(),
                        'total': cnt,
                        'completed': cnt_done,
                        'uncompleted': cnt - cnt_done,
                    })
                    day += timedelta(days=1)

        # ---- 4. 完成状态 ----
        status = {'completed': completed, 'uncompleted': uncompleted}

        # ---- 5. 优先级分布 ----
        pri_count: Dict[str, int] = {'high': 0, 'medium': 0, 'low': 0, 'none': 0}
        for t in included:
            p = t.get('priority')
            if p not in pri_count:
                p = 'none'
            pri_count[p] += 1
        priority_dist = [
            {'key': p, 'count': pri_count[p]}
            for p in _PRIORITY_ORDER
        ]

        # ---- 6. 分类分布（含完成率） ----
        categories = self.get_all_categories()
        cat_map = {str(c.get('id')): c for c in categories}
        cat_stat: Dict[str, Dict[str, Any]] = {}
        for t in included:
            cid = t.get('categoryId')
            key = str(cid) if cid is not None else 'uncategorized'
            if key not in cat_stat:
                info = cat_map.get(key, {})
                cat_stat[key] = {
                    'id': cid,
                    'name': info.get('name', '未分类'),
                    'color': info.get('color', '#6c757d'),
                    'count': 0,
                    'completed': 0,
                }
            cat_stat[key]['count'] += 1
            if t.get('completed'):
                cat_stat[key]['completed'] += 1

        category_dist = []
        for item in cat_stat.values():
            count = item['count']
            item['rate'] = round(item['completed'] / count * 100, 1) if count else 0.0
            category_dist.append(item)
        category_dist.sort(key=lambda x: (-x['count'], x['name']))

        # ---- 7. 截止日期相关的周/时分布（仅统计有截止日期的任务） ----
        weekday_counts = [0] * 7
        hour_counts = [0] * 24
        for t in included:
            due_str = t.get('dueDate')
            due_dt = _safe_dt(due_str) if due_str else None
            if due_dt is None:
                continue
            weekday_counts[due_dt.weekday()] += 1
            hour_counts[due_dt.hour] += 1

        # ---- 8. 标签使用量（限定在当前筛选集合内） ----
        tag_count: Dict[str, int] = {}
        for t in included:
            for tag in (t.get('tags') or []):
                name = tag.get('name')
                if name:
                    tag_count[name] = tag_count.get(name, 0) + 1
        tag_usage = sorted(
            ({'name': k, 'count': v} for k, v in tag_count.items()),
            key=lambda x: (-x['count'], x['name']),
        )[:15]

        # ---- 9. 逾期未完成任务明细 ----
        overdue_tasks = []
        for t in included:
            if t.get('completed'):
                continue
            due_str = t.get('dueDate')
            due_dt = _safe_dt(due_str) if due_str else None
            if due_dt is None or due_dt.date() >= today:
                continue
            cid = t.get('categoryId')
            key = str(cid) if cid is not None else 'uncategorized'
            info = cat_map.get(key, {})
            overdue_tasks.append({
                'id': t.get('id'),
                'title': t.get('title'),
                'dueDate': due_dt.isoformat(sep=' ', timespec='minutes'),
                'categoryId': cid,
                'categoryName': info.get('name', '未分类'),
                'color': info.get('color', '#6c757d'),
                'priority': t.get('priority') or 'none',
            })
        overdue_tasks.sort(key=lambda x: x['dueDate'])
        overdue_tasks = overdue_tasks[:200]

        return {
            'basis': basis,
            'scope': scope,
            'categoryId': sel_cat,
            'kpi': {
                'total': total,
                'completed': completed,
                'uncompleted': uncompleted,
                'completionRate': completion_rate,
                'overdue': overdue,
                'noDueDate': no_due,
            },
            'trend': {
                'granularity': trend_granularity,
                'items': items,
            },
            'status': status,
            'priority': priority_dist,
            'category': category_dist,
            'weekday': [{'day': i, 'count': weekday_counts[i]} for i in range(7)],
            'hour': [{'hour': i, 'count': hour_counts[i]} for i in range(24)],
            'tags': tag_usage,
            'overdueTasks': overdue_tasks,
        }

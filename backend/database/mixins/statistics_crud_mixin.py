# backend/database/mixins/statistics_crud_mixin.py
"""
统计查询 Mixin
提供面向「统计视图」的聚合查询能力：
- 时间口径：创建时间(created) / 截止时间(due) / 完成时间(completed)
- 时间范围：全部 / 年 / 月 / 具体周
- 分类筛选
- 共享筛选维度（优先级 / 搜索），语义与任务列表共用同一套；状态恒按全部聚合

为避免对历史数据分布做过强假设，聚合统一在 Python 侧基于
TaskCrudMixin.get_all_tasks() 完成（当前数据规模在数千条内，性能可接受），
同时便于跨月/跨天做零填充、保持各图表口径一致。
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.database.query.filter import TaskFilter

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


def _is_overdue(task: Dict[str, Any], due_dt: Optional[datetime], now: datetime) -> bool:
    """统一的逾期判定：未完成且截止时刻早于"此刻"。

    全项目共用这一个口径（顶部统计条、统计面板 KPI、逾期明细、前端任务列表的
    红色截止时间），避免出现同一份数据给出两个逾期数：
    今天上午 9 点到期、现在下午 2 点，算逾期。
    """
    return not task.get('completed') and due_dt is not None and due_dt < now


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

    @staticmethod
    def _build_overview(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """顶部统计条的四项指标（全局口径）。

        与 kpi 的区别：kpi 是「按本次筛选（时间口径 / 范围 / 分类 / 标签）过滤后」
        的指标；overview 恒为整个库的口径，因为顶部统计条展示的是总体状态，
        不该随统计视图的筛选变化。两者共用同一份 tasks 列表，不额外全量加载。
        逾期判定与 kpi.overdue / 逾期明细共用 _is_overdue，口径一致。

        注：顶部统计条单独走 SQL 聚合版 get_overview_statistics（不加载任务），
        口径与本函数一致；调整逾期 / 今日完成判定时要两处同步。
        """
        now = datetime.now()
        total = len(tasks)
        completed = 0
        today_completed = 0
        over_due = 0
        for task in tasks:
            if task.get('completed'):
                completed += 1
                updated = _safe_dt(task.get('updatedAt'))
                if updated and updated.date() == now.date():
                    today_completed += 1
                continue
            if _is_overdue(task, _safe_dt(task.get('dueDate')), now):
                over_due += 1

        return {
            'uncompleted': total - completed,
            'today_completed': today_completed,
            'over_due': over_due,
            'completion_rate': round(completed / total * 100, 1) if total else 0.0,
        }

    def get_overview_statistics(self) -> Dict[str, Any]:
        """顶部统计条的四项指标（全局口径），走 SQL 聚合，不加载任务。

        与 _build_overview 同一口径（未完成 / 今日完成 / 已逾期 / 完成率），
        但统计条只要这四个数，此前却调用 get_task_statistics：
        后者 get_all_tasks() 全量加载，并在 Python 侧算出趋势、分布、优先级、
        分类、逾期明细等一整套图表数据，绝大多数结果被丢弃。

        口径对齐要点：
        - 逾期判定与 _is_overdue 一致：未完成且截止时刻早于"此刻"。
          SQLite 的 datetime('now') 取的是 UTC，所以由 Python 传入本地 now 串，
          与列表筛选 status='overdue' 的写法保持一致。
        - 时间列可能带时区偏移或 'Z'，SQLite 的 datetime() 遇到这类串返回 NULL 会漏计，
          而 _safe_dt 会解析成墙上时间；这里统一截取前 19 位
          （'YYYY-MM-DDTHH:MM:SS'），与 _safe_dt 的结果对齐。
        - 行集与 get_all_tasks() 一致（tasks 全表，无额外过滤）。
        """
        now = datetime.now()
        with self.query() as conn:
            row = conn.execute(
                'SELECT COUNT(*) AS total, '
                '  SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed, '
                '  SUM(CASE WHEN completed = 1 '
                '           AND date(substr(updated_at, 1, 10)) = ? THEN 1 ELSE 0 END) AS today_completed, '
                '  SUM(CASE WHEN completed = 0 AND due_date IS NOT NULL AND due_date <> \'\' '
                '           AND datetime(substr(due_date, 1, 19)) < datetime(?) '
                '           THEN 1 ELSE 0 END) AS over_due '
                'FROM tasks',
                (now.strftime('%Y-%m-%d'), now.isoformat(sep=' ', timespec='seconds')),
            ).fetchone()

        total = row['total'] or 0
        completed = row['completed'] or 0
        return {
            'uncompleted': total - completed,
            'today_completed': row['today_completed'] or 0,
            'over_due': row['over_due'] or 0,
            'completion_rate': round(completed / total * 100, 1) if total else 0.0,
        }

    def get_statistics_options(self, date_basis: str = 'created') -> Dict[str, Any]:
        """返回指定时间口径下，可用于筛选的年/月/周候选项。"""
        dates: List[datetime] = []
        try:
            with self.query() as conn:
                rows = conn.execute(
                    'SELECT completed, created_at, due_date, updated_at FROM tasks'
                ).fetchall()
            for row in rows:
                if date_basis == 'due':
                    dt = _safe_dt(row['due_date'])
                elif date_basis == 'completed':
                    dt = _safe_dt(row['updated_at']) if row['completed'] else None
                else:
                    dt = _safe_dt(row['created_at'])
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

    def _statistics_matching_ids(
        self,
        priority: Optional[str],
        search_query: Optional[Any],
    ) -> Optional[set]:
        """取「优先级 / 搜索」两个共享维度命中的任务 id 集合。

        复用 TaskFilter 与列表查询的 WHERE 构建，保证同一份筛选条件在列表和统计里
        筛出的是同一批任务，不必在统计侧重写一遍匹配规则（尤其是搜索的标签 /
        父任务 / 关键词语义）。两个维度都不限时返回 None，调用方据此跳过判断。
        """
        f = TaskFilter(
            priority=priority if priority not in (None, '', 'all') else None,
            search_query=search_query,
        )
        if not (f.priority or f.search_query):
            return None
        where, params = self._build_list_where_clauses(f)
        with self.query() as conn:
            rows = conn.execute(f'SELECT id FROM tasks WHERE {where}', params).fetchall()
        return {row[0] for row in rows}

    def get_task_statistics(
        self,
        date_basis: str = 'created',
        scope: str = 'all',
        year: Optional[str] = None,
        month: Optional[str] = None,
        week: Optional[str] = None,
        category_id: Optional[str] = None,
        tag_ids: Optional[list] = None,
        priority: Optional[str] = None,
        search_query: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """统计查询主入口，返回统计视图所需的聚合数据。"""
        basis = date_basis if date_basis in ('created', 'due', 'completed') else 'created'
        # 归一化分类筛选值
        sel_cat = None
        if category_id not in (None, '', 'all'):
            sel_cat = str(category_id)
        # 归一化标签筛选值：必须命中全部选中标签（与列表搜索的 AND 语义一致，
        # 搜索语义的统一定义见 backend/database/query）
        sel_tags = None
        if tag_ids:
            norm = {str(t) for t in tag_ids if t is not None and str(t) not in ('', 'all')}
            if norm:
                sel_tags = norm

        # 优先级 / 搜索与列表共用同一套语义，借列表的 WHERE 先取一次命中 id
        sel_ids = self._statistics_matching_ids(priority, search_query)

        all_tasks = self.get_all_tasks()

        # ---- 1. 计算该任务所属统计时间点，并做时间范围筛选 ----
        now = datetime.now()

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
        due_dts: List[Optional[datetime]] = []  # 截止时间，与 included 一一对应，避免重复解析
        for task in all_tasks:
            # 共享筛选维度已在 SQL 侧筛过一次，这里只认命中结果
            if sel_ids is not None and task.get('id') not in sel_ids:
                continue
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
                if not sel_tags.issubset(task_tag_ids):
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
            due_dts.append(_safe_dt(task.get('dueDate')))
        basis_dates = [p[1] for p in pairs if p[1] is not None]

        # ---- 2. KPI ----
        total = len(included)
        completed = sum(1 for t in included if t.get('completed'))
        uncompleted = total - completed
        completion_rate = round(completed / total * 100, 1) if total else 0.0

        overdue = 0
        no_due = 0
        for idx, t in enumerate(included):
            due_dt = due_dts[idx]
            if due_dt is None:
                no_due += 1
            elif _is_overdue(t, due_dt, now):
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

        # 先按粒度一次性分桶（O(N)），再按横轴序列输出，避免"每个桶全量扫描一次"
        def _bucket_key(dt: datetime) -> str:
            if trend_granularity == 'year':
                return dt.strftime('%Y')
            if trend_granularity == 'month':
                return dt.strftime('%Y-%m')
            return dt.date().isoformat()

        totals: Dict[str, int] = {}
        dones: Dict[str, int] = {}
        for task, dt in pairs:
            if dt is None:
                continue
            key = _bucket_key(dt)
            totals[key] = totals.get(key, 0) + 1
            if task.get('completed'):
                dones[key] = dones.get(key, 0) + 1

        def _make_items(keys: List[str]) -> List[Dict[str, Any]]:
            result: List[Dict[str, Any]] = []
            for key in keys:
                cnt = totals.get(key, 0)
                cnt_done = dones.get(key, 0)
                result.append({
                    'key': key,
                    'label': key,
                    'total': cnt,
                    'completed': cnt_done,
                    'uncompleted': cnt - cnt_done,
                })
            return result

        if trend_granularity == 'year':
            # 全部时间：按年聚合（横轴为有数据的年份）
            items = _make_items(sorted(totals.keys()))
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
            ym_keys: List[str] = []
            while cur and cur <= last:
                ym_keys.append(cur)
                # 推进到下一个月
                if int(cur[5:7]) == 12:
                    cur = f'{int(cur[:4]) + 1}-01'
                else:
                    cur = f'{cur[:4]}-{int(cur[5:7]) + 1:02d}'
            items = _make_items(ym_keys)
        else:
            # 按月份/按周：展示完整逐日序列（含无任务日期）
            day_keys: List[str] = []
            if start_day is not None and end_day is not None:
                day = start_day
                while day <= end_day:
                    day_keys.append(day.isoformat())
                    day += timedelta(days=1)
            items = _make_items(day_keys)

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
        for due_dt in due_dts:
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
        for idx, t in enumerate(included):
            due_dt = due_dts[idx]
            if not _is_overdue(t, due_dt, now):
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
            # 全局口径的顶部统计条指标，与本次筛选无关
            'overview': self._build_overview(all_tasks),
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

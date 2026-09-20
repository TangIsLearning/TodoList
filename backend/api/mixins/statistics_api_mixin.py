# backend/api/mixins/statistics_api_mixin.py
"""
统计视图 API Mixin
提供统计视图所需的筛选项元数据与聚合统计查询。
"""

from typing import Any, Dict, Optional
from backend.utils.response_wrapper import api_handler


class StatisticsApiMixin:

    @api_handler
    def get_statistics_options(self, date_basis: str = 'created') -> Dict[str, Any]:
        """获取指定统计口径下可用的年/月/周候选项。"""
        return self.db.get_statistics_options(date_basis=date_basis)

    @api_handler
    def get_overview_statistics(self) -> Dict[str, Any]:
        """顶部统计条专用的四项全局指标（SQL 聚合，不加载任务）。

        统计视图请继续用 get_task_statistics：它已经加载了全量任务，
        overview 由同一份数据算出，零额外成本；这里只服务于"只要四个数"的场景。
        """
        return self.db.get_overview_statistics()

    @api_handler
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
        """统计视图聚合查询，同时附带顶部统计条的全局指标。

        返回体中的 overview 为「整个库」的口径（不受下列筛选参数影响），
        供顶部统计条使用；其余字段为按筛选条件聚合的结果。两者共用同一次
        全量任务加载，因此一次请求即可同时满足统计视图与顶部条。

        参数:
            date_basis: 统计口径 created/due/completed
            scope:      时间范围 all/year/month/week
            year:       scope=year 时，年份，如 '2026'
            month:      scope=month 时，月份，如 '2026-02'
            week:       scope=week 时，所在周的周一日期，如 '2026-02-02'
            category_id: 分类过滤，'all'/None 为全部分类，'uncategorized' 为未分类
            tag_ids:    标签 id 列表，任务需同时命中全部标签才计入（与列表搜索的 AND 语义一致）
        """
        return self.db.get_task_statistics(
            date_basis=date_basis,
            scope=scope,
            year=year,
            month=month,
            week=week,
            category_id=category_id,
            tag_ids=tag_ids,
        )

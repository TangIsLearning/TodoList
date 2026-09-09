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
        """统计视图聚合查询。

        参数:
            date_basis: 统计口径 created/due/completed
            scope:      时间范围 all/year/month/week
            year:       scope=year 时，年份，如 '2026'
            month:      scope=month 时，月份，如 '2026-02'
            week:       scope=week 时，所在周的周一日期，如 '2026-02-02'
            category_id: 分类过滤，'all'/None 为全部分类，'uncategorized' 为未分类
            tag_ids:    标签 id 列表，任务命中其中任意一个标签即计入（与列表 #标签 搜索一致）
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

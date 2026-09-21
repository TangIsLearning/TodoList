// 各视图共享的筛选条件：ViewManager 决定「看哪个视图」，这里决定「看哪些数据」。
// 五个维度与后端 TaskFilter 字段一一对应，build() 折算成后端期望的形状；searchQuery 是
// chips 构建的结构化查询，语义见 view-filter.search.js。
// 全局筛选栏的下拉框与搜索框是这份条件自身的界面（写在工具栏、与视图切换器同层），
// 故归本模块绑定；各视图内部的业务 DOM 不碰。

// 与 index.html 中 status-filter 的默认选中项一致，构造函数与 resetFilters() 共用
const DEFAULT_STATUS = 'uncompleted';

class ViewFilter {
    constructor() {
        // 'all' 表示该维度不限，build() 时统一折算成 null 交给后端
        this.categoryId = 'all';      // 所属分类
        this.status = DEFAULT_STATUS; // 完成状态
        this.priority = 'all';        // 优先级
        this.dueDateFilter = 'all';   // 日期快捷筛选（今天 / 本周 …）
        this.searchQuery = null;      // 结构化查询对象（chips 构建结果）

        // 搜索栏交互实现见 view-filter.search.js
        this.searchChips = [];        // chips：{ type: 'tag'|'text'|'due', value, tagId?, color? }
        this._chipEls = new WeakMap(); // chip 对象 → 其 DOM 元素，用于增删时做增量更新
        this._searchDebounceTimer = null;
        this._subtaskSuggestTimer = null;
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
        this.subtaskParent = { id: null, title: null }; // 子任务搜索已确定的父任务
        this.dropdown = null;          // 子任务建议下拉容器（惰性解析）
        this.searchDuePicker = null;   // 搜索栏"按截止时间搜索"的日历实例
    }

    // 统一的取数条件：字段名与后端 TaskFilter 一致，四个视图与任务定位共用同一份
    build() {
        return {
            categoryId: this.categoryId === 'all' ? null : this.categoryId,
            status: this.status === 'all' ? null : this.status,
            priority: this.priority === 'all' ? null : this.priority,
            dueDateFilter: this.dueDateFilter === 'all' ? null : this.dueDateFilter,
            searchQuery: this.searchQuery || null
        };
    }

    // 条件变更后的统一出口：调用方不必知道当前在哪个视图，由路由挑前台视图的重建入口
    async commitChange() {
        // 条件变了意味着结果集从头开始：在别的视图换过筛选再切回列表，也该停在第一页
        window.todoManager?.resetForNewResult();

        // 不走 notifyDataChanged：数据没变只是查询条件变了，常驻计数与统计条不必重算
        await window.refreshRouter?.refreshIfVisible();
    }

    // 顶部快捷筛选（未完成任务 / 已逾期 / 全部 / 今天 / 含标签）：一次性改写多个维度
    async applyQuickFilter({ status = 'all', dueDateFilter = 'all', tag = '' } = {}) {
        // 残留的 #标签 chip 会盖掉快捷筛选的"含标签"语义，先清空
        this.clearSearchChips();

        this.status = status;
        this.dueDateFilter = dueDateFilter;
        this.priority = 'all';

        // '#' 的"含标签"语义已在 buildSearchQuery() 里，交给它解析以免手拼漏字段
        if (this.searchInput) this.searchInput.value = tag;
        this.searchQuery = tag ? this.buildSearchQuery() : null;

        this.syncFilterControls();
        await this.commitChange();
    }

    // 回写控件：下拉框的用户操作本就与状态一致，只有程序化改条件才需要这一步
    syncFilterControls() {
        const statusFilter = document.getElementById('status-filter');
        const dueDateFilter = document.getElementById('due-date-filter');
        const priorityFilter = document.getElementById('priority-filter');
        if (statusFilter) statusFilter.value = this.status;
        if (dueDateFilter) dueDateFilter.value = this.dueDateFilter;
        if (priorityFilter) priorityFilter.value = this.priority;
        this.updateSearchClearButton();
    }

    // 清掉与具体数据绑定的条件（切库 / 导入后）：旧分类 id 与旧 chip 会命中不存在的数据，
    // 必须清；status / priority / dueDateFilter 是固定枚举，换库后依然有效，刻意保留。
    clearDataScopedFilters() {
        this.categoryId = 'all';
        this.clearSearchChips();
        if (this.searchInput) this.searchInput.value = '';
        this.searchQuery = null;
        this.updateSearchClearButton();
    }

    // 重置到默认条件（"重置应用状态"用）。只改条件与控件，取数由调用方决定
    resetFilters() {
        this.clearDataScopedFilters();
        // 回到与初次进入一致的默认状态（'uncompleted'），而不是"所有状态"
        this.status = DEFAULT_STATUS;
        this.priority = 'all';
        this.dueDateFilter = 'all';
        this.syncFilterControls();
    }

    init() {
        this.bindGlobalFilterControls();
        this.initSearchBar();
    }

    initSearchBar() {
        this.searchInput = document.getElementById('search-input');
        this.searchTagWrapper = document.getElementById('search-tag-wrapper');
        this.searchClearBtn = document.getElementById('search-clear-btn');
        this.searchBtn = document.getElementById('search-btn');
        if (this.searchInput && this.searchTagWrapper) this.initSearchTagInput();
    }

    // 这三个控件不在任何单一视图内，故归本模块绑定：此前 todo.js 与 timeline.js 各监听
    // 一遍，改一次下拉框两个 handler 都跑
    bindGlobalFilterControls() {
        const controls = [
            ['priority-filter', 'priority'],
            ['status-filter', 'status'],
            ['due-date-filter', 'dueDateFilter']
        ];
        for (const [elementId, dimension] of controls) {
            document.getElementById(elementId)?.addEventListener('change', async (e) => {
                this[dimension] = e.target.value;
                await this.commitChange();
            });
        }
    }
}

window.viewFilter = new ViewFilter();

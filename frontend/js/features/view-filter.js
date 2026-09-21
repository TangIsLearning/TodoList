/**
 * 各视图共享的筛选条件：与 view-manager 平级的一等模块。
 *
 * ViewManager 负责决定「看哪个视图」，这里负责决定「看哪些数据」：
 * 列表、日历、时间轴、统计四个视图都从这里取同一份条件，
 * 不再各自维护一份状态，也不再各自拼一份参数。
 *
 * 五个维度的取值与后端 TaskFilter 的字段一一对应，build() 负责折算成后端期望的形状。
 * searchQuery 是 chips 构建出的结构化查询对象，具体语义见 view-filter.search.js。
 *
 * 职责边界：
 * - 不碰各视图内部的业务 DOM（任务卡片、日历格子、时间轴等）；
 * - 但全局筛选栏的下拉框是「共享条件」自身的用户界面：它们写在工具栏里、与视图
 *   切换器同层，四个视图共用，所以归本模块统一绑定，见 bindGlobalFilterControls()；
 * - 条件变化后的取数由 commitChange() 按当前视图分发，调用方不必再各自记住要刷谁。
 */
// 完成状态的初始值，与 index.html 中 status-filter 的默认选中项一致。
// 构造函数与 resetFilters() 共用这一处，避免两处各写一份字面量后漂移。
const DEFAULT_STATUS = 'uncompleted';

class ViewFilter {
    constructor() {
        // 'all' 表示该维度不限，build() 时统一折算成 null 交给后端
        this.categoryId = 'all';      // 所属分类
        this.status = DEFAULT_STATUS; // 完成状态
        this.priority = 'all';        // 优先级
        this.dueDateFilter = 'all';   // 日期快捷筛选（今天 / 本周 …）
        this.searchQuery = null;      // 结构化查询对象（chips 构建结果）

        // 搜索栏状态：搜索框同样写在全局工具栏，所以和三个下拉框一样归本模块，
        // 交互实现见 view-filter.search.js
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

    // 统一的取数条件对象：字段名与后端 TaskFilter 一致，四个视图与任务定位共用同一份。
    // 此前由 TodoManager.buildListFilter() 提供、时间轴另有一份手拼的副本，
    // 现在收敛到唯一入口，新增或调整筛选维度时不必再改多处。
    build() {
        return {
            categoryId: this.categoryId === 'all' ? null : this.categoryId,
            status: this.status === 'all' ? null : this.status,
            priority: this.priority === 'all' ? null : this.priority,
            dueDateFilter: this.dueDateFilter === 'all' ? null : this.dueDateFilter,
            searchQuery: this.searchQuery || null
        };
    }

    // 共享条件变更后的统一处置：改完条件的调用方都走这里，不必各自记住要刷谁。
    //
    // 列表已与其他视图一样登记在刷新路由里，所以这里不必再区分当前在哪个视图：
    // 一律交给刷新路由，由它挑前台视图的重建入口（列表在前台就是 loadTasks），
    // 不在前台的一个都不惊动。
    //
    // 只是"通知"，不再有人靠比对条件签名去事后猜测筛选变没变。
    async commitChange() {
        // 条件变了意味着结果集从头开始。这与当前在哪个视图无关：
        // 在别的视图换过筛选再切回列表，也该停在第一页，而不是落在旧的页码上。
        window.todoManager?.resetForNewResult();

        // 只刷前台视图，不走 notifyDataChanged：变的只是查询条件，数据本身没变，
        // 左侧分类计数与顶部统计条的口径都与筛选无关，不必重算或重播动画。
        await window.refreshRouter?.refreshIfVisible();
    }

    // 顶部快捷筛选（未完成任务 / 已逾期 / 全部 / 今天 / 含标签）：一次性改写多个维度。
    // 与三个下拉框、搜索栏走同一条 commitChange() 路径，调用方不必自己判断该刷谁。
    async applyQuickFilter({ status = 'all', dueDateFilter = 'all', tag = '' } = {}) {
        // 快捷筛选与残留 chip 语义冲突（残留的 #标签 会盖掉"含标签"），先清空
        this.clearSearchChips();

        this.status = status;
        this.dueDateFilter = dueDateFilter;
        this.priority = 'all';

        // tag 交给搜索栏统一解析：'#' 的"含标签任务"语义 buildSearchQuery() 里已有，
        // 不再在这里手拼一份结构化对象（手拼会漏掉 dueDate 等字段，见该方法注释）
        if (this.searchInput) this.searchInput.value = tag;
        this.searchQuery = tag ? this.buildSearchQuery() : null;

        this.syncFilterControls();
        await this.commitChange();
    }

    // 把当前条件回写到全局筛选栏的控件。下拉框的用户操作由浏览器保证与状态一致，
    // 只有"程序化改条件"的路径（快捷筛选、切库、重置）才需要这一步。
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

    // 重置到默认条件（"重置应用状态"用）。只改条件与控件，取数由调用方决定。
    // 复用 clearDataScopedFilters：分类与搜索条件同样属于"会随数据失效"的那部分，
    // 这里只额外把三个枚举维度拨回默认，避免两处各写一份清空逻辑后漂移。
    resetFilters() {
        this.clearDataScopedFilters();
        // 回到与初次进入一致的默认状态（'uncompleted'），而不是"所有状态"
        this.status = DEFAULT_STATUS;
        this.priority = 'all';
        this.dueDateFilter = 'all';
        this.syncFilterControls();
    }

    // 模块生命周期入口，与 ViewManager 平级，由 main.js 的模块清单统一驱动。
    init() {
        this.bindGlobalFilterControls();
        this.initSearchBar();
    }

    // 解析搜索栏的元素引用并接管其输入交互（实现见 view-filter.search.js）。
    // 与三个下拉框同理：搜索框不在任何单一视图内，四个视图共用同一份 searchQuery。
    initSearchBar() {
        this.searchInput = document.getElementById('search-input');
        this.searchTagWrapper = document.getElementById('search-tag-wrapper');
        this.searchClearBtn = document.getElementById('search-clear-btn');
        this.searchBtn = document.getElementById('search-btn');
        if (this.searchInput && this.searchTagWrapper) this.initSearchTagInput();
    }

    // 绑定全局筛选栏的下拉框。
    //
    // 这三个控件不在任何单一视图内，因此既不属于 todo.js 也不属于 timeline.js。
    // 此前两个模块各自监听同一批元素：改一次下拉框两个 handler 都跑，
    // 且在非列表视图下还会把不在前台的列表也拉一遍。
    bindGlobalFilterControls() {
        const controls = [
            ['priority-filter', 'priority'],
            ['status-filter', 'status'],
            ['due-date-filter', 'dueDateFilter']
        ];
        for (const [elementId, dimension] of controls) {
            document.getElementById(elementId)?.addEventListener('change', async (e) => {
                // 直接按维度写字段：维度名来自上面的表，写的是哪个字段在这里一眼可见
                this[dimension] = e.target.value;
                await this.commitChange();
            });
        }
    }
}

window.viewFilter = new ViewFilter();

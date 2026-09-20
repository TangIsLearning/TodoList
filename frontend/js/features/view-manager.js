// 视图路由模块：持有全局视图状态，负责在各视图之间切换
//
// 这段逻辑此前挂在 CalendarManager 上，但它管的是四个全局视图容器
// （列表 / 日历 / 时间轴 / 统计），日历专属的只有取数那一步。
// 由此产生两处错位：
// - 其它模块想知道"当前在哪个视图"，只能来问 calendarManager.currentView；
// - 日历模块反过来要调度 todoManager / timelineManager / statsManager。
// 视图状态与切换归位到这里后，CalendarManager 回到纯月历职责，
// 各模块也从"问日历"改成"问视图管理器"。

// 旧视图淡出时长，需与 animations.css 的 --anim-duration-fast 保持一致
const VIEW_FADE_OUT_MS = 200;

class ViewManager {
    constructor() {
        // 当前视图：list(列表) / calendar(日历) / timeline(时间轴) / stats(统计)
        this.currentView = 'list';
        this.supportedViews = ['list', 'calendar', 'timeline', 'stats'];
        this._switchToken = 0; // 视图切换令牌：快速连续切换时只让最后一次生效
        this._viewSkeleton = null; // 当前视图切换插入的占位骨架
    }

    // 视图切换期间放宽加载遮罩显示延迟：本地查询通常很快，避免黑遮罩一闪而过
    static get LOADING_DELAY() {
        return 400;
    }

    // 初始化
    init() {
        this.bindEvents();
        // 初始化视图状态：默认列表视图
        this.syncViewIndicators(this.currentView);
    }

    // 绑定事件（顶部下拉框；月历按钮由 CalendarManager 自行绑定）
    bindEvents() {
        const viewToggleSelect = document.getElementById('view-toggle-select');
        viewToggleSelect?.addEventListener('change', (e) => this.toggleView(e));
    }

    // 切换视图（事件入口：顶部下拉框 change 事件）
    async toggleView(event) {
        const target = event?.target ?? event?.currentTarget;
        const viewName = target?.value || this.currentView || 'list';
        await this.switchView(viewName);
    }

    // 切换视图（统一入口，顶部下拉框与小屏更多菜单共用）
    // viewName: list | calendar | timeline | stats
    async switchView(viewName) {
        const targetView = this.supportedViews.includes(viewName) ? viewName : 'list';
        const tasksView = document.getElementById('tasks-view');
        const pagination = document.getElementById('pagination');
        const calendarView = document.getElementById('calendar-view');
        const dueDateFilter = document.getElementById('due-date-filter');
        const prevMonthFilter = document.getElementById('filter-prev-month');
        const nextMonthFilter = document.getElementById('filter-next-month');
        const groupDividerFilter = document.getElementById('filter-group-divider');
        const timelineView = document.getElementById('timeline-view');
        const statsView = document.getElementById('stats-view');

        const viewEls = {
            calendar: calendarView,
            timeline: timelineView,
            stats: statsView,
            list: tasksView
        };
        const prevViewEl = viewEls[this.currentView];
        const targetViewEl = viewEls[targetView];
        // 快速连续切换时，只让最后一次切换继续往下走
        const switchToken = ++this._switchToken;
        const abortIfStale = () => {
            if (switchToken !== this._switchToken) return true;
            return false;
        };

        // 切换期间放宽加载遮罩的显示延迟，避免数据很快返回时黑遮罩闪一下
        Utils.setLoadingDelay(ViewManager.LOADING_DELAY);

        // 旧视图先淡出，让内容"退场"而不是瞬间消失（同一视图重复进入无需淡出）
        if (prevViewEl && prevViewEl !== targetViewEl && !Utils.prefersReducedMotion()) {
            Utils.beginRefresh(prevViewEl);
            await Utils.wait(VIEW_FADE_OUT_MS);
            if (abortIfStale()) {
                Utils.setLoadingDelay(null);
                return;
            }
        }

        // 先隐藏所有视图容器，避免上个视图残留
        [timelineView, tasksView, pagination, calendarView, statsView].forEach(el => {
            if (el) el.style.display = 'none';
        });
        document.body.classList.remove('stats-mode');

        // 目标视图还没有任何内容时先放骨架占位（容器隐藏时插入，稍后 display 即显示）
        this.showViewSkeleton(targetViewEl, targetView);

        // 先更新视图状态，保证后续异步加载（分页渲染等）基于新视图执行
        this.currentView = targetView;
        this.syncViewIndicators(targetView);

        switch (targetView) {
            // 切换到日历视图
            case 'calendar': {
                if (calendarView) calendarView.style.display = 'flex';
                this.prepareViewEnter(calendarView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'block';
                if (nextMonthFilter) nextMonthFilter.style.display = 'block';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                if (window.todoManager) {
                    // 日历按整月展示，先丢掉单日条件（截止时间 chip），否则日历只剩那一天
                    window.todoManager.clearDueDateChip();
                    window.todoManager.customDateFilter = null; // 清除自定义日期筛选
                }
                // 走日历专用取数：只回月历格需要的字段（标题 / 完成 / 截止时间 / 优先级）。
                // 此前是 pageSize = 9999 调分页接口，既拉回整份任务（描述、周期规则、
                // 标签、附件月历都用不上），也会把 9999 残留给列表视图。
                await window.calendarManager?.loadCalendarTasks();
                break;
            }
            // 切换到时间轴视图
            case 'timeline': {
                if (timelineView) timelineView.style.display = 'flex';
                this.prepareViewEnter(timelineView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'none';
                if (nextMonthFilter) nextMonthFilter.style.display = 'none';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                // 通知TimelineManager进行筛选
                if (window.timelineManager) await window.timelineManager.renderTimeline();
                break;
            }
            // 切换到统计视图
            case 'stats': {
                if (statsView) statsView.style.display = 'block';
                this.prepareViewEnter(statsView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'none';
                if (nextMonthFilter) nextMonthFilter.style.display = 'none';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                document.body.classList.add('stats-mode');
                // 通知统计管理器加载数据
                if (window.statsManager) window.statsManager.onViewEnter();
                break;
            }
            // 切换到列表视图
            case 'list':
            default: {
                if (tasksView) tasksView.style.display = 'block';
                this.prepareViewEnter(tasksView);
                if (pagination) pagination.style.display = 'flex';
                this.setDueDateFilterState(dueDateFilter, false);
                if (prevMonthFilter) prevMonthFilter.style.display = 'none';
                if (nextMonthFilter) nextMonthFilter.style.display = 'none';
                if (groupDividerFilter) groupDividerFilter.style.display = 'none';
                const filterPageSize = 10;
                // 通知TodoManager进行筛选
                if (window.todoManager) {
                    window.todoManager.currentPage = 1; // 重置到第一页
                    window.todoManager.pageSize = filterPageSize; // 设置分页数量
                    window.todoManager.customDateFilter = null; // 清除自定义日期筛选
                    window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
                    await window.todoManager.loadTasks();
                }
                break;
            }
        }

        if (abortIfStale()) {
            this.clearViewSkeleton();
            Utils.endRefresh(targetViewEl);
            Utils.setLoadingDelay(null);
            return;
        }

        // 真实内容已渲染，移除占位骨架并淡入，避免"旧内容消失 → 新内容瞬间出现"的闪烁
        this.clearViewSkeleton();
        Utils.endRefresh(targetViewEl);
        Utils.setLoadingDelay(null);
    }

    // 目标视图取数期间的状态：已有内容则整体淡化，无内容时由骨架占位（二者互斥）
    prepareViewEnter(viewEl) {
        if (!viewEl) return;
        if (this._viewSkeleton) return; // 已有骨架占位，不再叠加淡化
        Utils.beginRefresh(viewEl);
    }

    // 目标视图首次进入（容器为空）时插入骨架，返回是否插入
    showViewSkeleton(viewEl, targetView) {
        // 统计视图自带"加载统计数据中..."占位，不再叠加骨架
        if (!viewEl || targetView === 'stats' || Utils.prefersReducedMotion()) return false;
        // 容器内已有内容时插入会与旧内容重叠，此时交给淡化处理
        if (viewEl.textContent.trim() !== '') return false;

        const skeleton = document.createElement('div');
        skeleton.className = 'view-skeleton';
        skeleton.innerHTML = '<i></i>'.repeat(5);
        viewEl.appendChild(skeleton);
        this._viewSkeleton = skeleton;
        return true;
    }

    clearViewSkeleton() {
        this._viewSkeleton?.remove();
        this._viewSkeleton = null;
    }

    // 设置截止日期筛选器的可用状态
    setDueDateFilterState(dueDateFilter, disabled) {
        if (!dueDateFilter) return;
        dueDateFilter.disabled = disabled;
        dueDateFilter.style.pointerEvents = 'auto';
        dueDateFilter.style.cursor = disabled ? 'not-allowed' : 'default';
    }

    // 同步顶部下拉框与小屏更多菜单的视图状态
    syncViewIndicators(viewName) {
        const viewToggleSelect = document.getElementById('view-toggle-select');
        if (viewToggleSelect && viewToggleSelect.value !== viewName) {
            viewToggleSelect.value = viewName;
        }

        // 高亮小屏更多菜单中当前所在的视图项
        const moreMenuLinks = document.querySelectorAll('.more-menu-link[data-action="switch-view"]');
        moreMenuLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.view === viewName);
        });
    }
}

// 创建全局实例
window.viewManager = new ViewManager();

// 视图路由模块：持有全局视图状态，负责在各视图之间切换。
// 此前挂在 CalendarManager 上，导致其它模块要"问日历"拿当前视图、日历反向调度其它模块；
// 归位后 CalendarManager 回到纯月历职责。

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

    init() {
        this.bindEvents();
        this.syncViewIndicators(this.currentView);
    }

    // 月历按钮由 CalendarManager 自行绑定
    bindEvents() {
        const viewToggleSelect = document.getElementById('view-toggle-select');
        viewToggleSelect?.addEventListener('change', (e) => this.toggleView(e));
    }

    async toggleView(event) {
        const target = event?.target ?? event?.currentTarget;
        const viewName = target?.value || this.currentView || 'list';
        await this.switchView(viewName);
    }

    // 统一入口：顶部下拉框与小屏更多菜单共用
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

        // 空容器先放骨架占位（容器隐藏时插入，稍后 display 即显示）
        this.showViewSkeleton(targetViewEl, targetView);

        // 先更新视图状态，保证后续异步加载（分页渲染等）基于新视图执行
        this.currentView = targetView;
        this.syncViewIndicators(targetView);

        switch (targetView) {
            case 'calendar': {
                if (calendarView) calendarView.style.display = 'flex';
                this.prepareViewEnter(calendarView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'block';
                if (nextMonthFilter) nextMonthFilter.style.display = 'block';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                if (window.todoManager) {
                    // 日历按整月展示，先丢掉单日条件（截止时间 chip），否则日历只剩那一天
                    window.viewFilter.clearDueDateChip();
                }
                // 走日历专用取数：只回月历格需要的字段。此前是 pageSize=9999 调分页接口，
                // 既拉回描述/周期规则/标签/附件等月历用不上的内容，也会把 9999 残留给列表视图
                await window.calendarManager?.loadCalendarTasks();
                break;
            }
            case 'timeline': {
                if (timelineView) timelineView.style.display = 'flex';
                this.prepareViewEnter(timelineView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'none';
                if (nextMonthFilter) nextMonthFilter.style.display = 'none';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                if (window.timelineManager) await window.timelineManager.renderTimeline();
                break;
            }
            case 'stats': {
                if (statsView) statsView.style.display = 'block';
                this.prepareViewEnter(statsView);
                this.setDueDateFilterState(dueDateFilter, true);
                if (prevMonthFilter) prevMonthFilter.style.display = 'none';
                if (nextMonthFilter) nextMonthFilter.style.display = 'none';
                if (groupDividerFilter) groupDividerFilter.style.display = 'block';
                document.body.classList.add('stats-mode');
                if (window.statsManager) window.statsManager.onViewEnter();
                break;
            }
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
                if (window.todoManager) {
                    window.todoManager.pageSize = filterPageSize;
                    window.todoManager.resetForNewResult(); // 结果集从头开始
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

    // 容器为空时插入骨架，返回是否插入
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

        const moreMenuLinks = document.querySelectorAll('.more-menu-link[data-action="switch-view"]');
        moreMenuLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.view === viewName);
        });
    }
}

window.viewManager = new ViewManager();

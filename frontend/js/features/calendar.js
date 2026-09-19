// 日历视图管理模块

// 旧视图淡出时长，需与 animations.css 的 --anim-duration-fast 保持一致
const VIEW_FADE_OUT_MS = 200;

class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        // 当前视图：list(列表) / calendar(日历) / timeline(时间轴) / stats(统计)
        this.currentView = 'list';
        this.supportedViews = ['list', 'calendar', 'timeline', 'stats'];
        this.tasks = [];
        this.currentMonth = null;
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

    // 绑定事件
    bindEvents() {
        const viewToggleSelect = document.getElementById('view-toggle-select');
        const prevMonthBtn = document.getElementById('prev-month');
        const nextMonthBtn = document.getElementById('next-month');
        this.currentMonth = document.getElementById('calendar-background-month');
        this.currentMonth.textContent = this.currentDate.getMonth() + 1;
        viewToggleSelect?.addEventListener('change', (e) => this.toggleView(e));
        prevMonthBtn?.addEventListener('click', () => this.previousMonth());
        nextMonthBtn?.addEventListener('click', () => this.nextMonth());
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
        Utils.setLoadingDelay(CalendarManager.LOADING_DELAY);

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
                const filterPageSize = 9999; // 假定单月任务最多9999个任务
                // 通知TodoManager进行筛选
                if (window.todoManager) {
                    // 日历按整月展示，先丢掉单日条件（截止时间 chip），否则日历只剩那一天
                    window.todoManager.clearDueDateChip();
                    window.todoManager.currentPage = 1; // 重置到第一页
                    window.todoManager.pageSize = filterPageSize; // 设置分页数量
                    window.todoManager.customDateFilter = null; // 清除自定义日期筛选
                    window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
                    await window.todoManager.loadTasks();
                }
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

    // 上一个月
    previousMonth() {
        const monthIndex = this.currentDate.getMonth();
        this.currentMonth.textContent = monthIndex == 0 ? 12 : monthIndex;
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        // 新月份从左侧滑入，与前进步骤方向相反
        this._pendingSlide = 'prev';
        this.renderCalendar();
    }

    // 下一个月
    nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        this.currentMonth.textContent = this.currentDate.getMonth() + 1;
        // 新月份从右侧滑入
        this._pendingSlide = 'next';
        this.renderCalendar();
    }

    // 更新任务数据
    updateTasks(tasks) {
        this.tasks = tasks;
        if (this.currentView === 'calendar') {
            this.renderCalendar();
        }
    }

    // 渲染日历
    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        // 渲染日历天数
        this.renderCalendarDays(year, month);
    }

    // 渲染日历天数
    renderCalendarDays(year, month) {
        const calendarDays = document.getElementById('calendar-days');
        if (!calendarDays) return;

        calendarDays.innerHTML = '';

        // 获取当月第一天和最后一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        // 获取当月第一天是星期几（0-6，0是星期日）
        const firstDayOfWeek = firstDay.getDay();

        // 获取当月天数
        const daysInMonth = lastDay.getDate();

        // 获取上个月的天数
        const prevMonthLastDay = new Date(year, month, 0).getDate();

        // 获取今天的日期（用于标记今天）
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
        const todayDate = today.getDate();

        // 渲染上个月的尾部天数
        for (let i = firstDayOfWeek - 1; i >= 0; i--) {
            const day = prevMonthLastDay - i;
            const dayEl = this.createDayElement(day, year, month - 1, true);
            calendarDays.appendChild(dayEl);
        }

        // 渲染当月天数
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = isCurrentMonth && day === todayDate;
            const dayEl = this.createDayElement(day, year, month, false, isToday);
            calendarDays.appendChild(dayEl);
        }

        // 渲染下个月的开始天数
        const totalRenderedDays = firstDayOfWeek + daysInMonth;
        const remainingDays = 42 - totalRenderedDays;
        for (let day = 1; day <= remainingDays % 7; day++) {
            const dayEl = this.createDayElement(day, year, month + 1, true);
            calendarDays.appendChild(dayEl);
        }

        // 翻月时按方向播放滑动入场（任务数据更新触发的重绘不播放）
        this.applyMonthSlide(calendarDays);
    }

    // 播放月份切换动画：next 从右侧滑入、prev 从左侧滑入
    applyMonthSlide(container) {
        const direction = this._pendingSlide;
        this._pendingSlide = null;
        if (!direction) return;

        Utils.playAnimation(container, direction === 'next' ? 'slide-from-right' : 'slide-from-left');
    }

    // 创建日期元素
    createDayElement(day, year, month, isOtherMonth = false, isToday = false) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        if (isOtherMonth) {
            dayEl.classList.add('other-month');
        }

        if (isToday) {
            dayEl.classList.add('today');
        }

        // 日期数字
        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        dayEl.appendChild(dayNumber);

        // 获取该日期的任务
        const dateStr = this.formatDateString(year, month, day);
        const dayTasks = this.getTasksForDate(dateStr);

        if (dayTasks.length > 0 && !isOtherMonth) {
            dayEl.classList.add('has-tasks');
        }

        // 任务指示器容器
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'calendar-day-tasks';

        // 显示最多3个任务
        const displayTasks = dayTasks.slice(0, 2);
        displayTasks.forEach(task => {
            const taskIndicator = document.createElement('div');
            taskIndicator.className = 'calendar-task-indicator';
            taskIndicator.textContent = task.title;

            if (task.completed) {
                taskIndicator.classList.add('completed');
            } else if (task.priority === 'high') {
                taskIndicator.classList.add('high-priority');
            } else if (task.priority === 'medium') {
                taskIndicator.classList.add('medium-priority');
            } else if (task.priority === 'low') {
                taskIndicator.classList.add('low-priority');
            }

            tasksContainer.appendChild(taskIndicator);
        });

        dayEl.appendChild(tasksContainer);

        // 任务统计
        if (dayTasks.length > 0 && !isOtherMonth) {
            const completedCount = dayTasks.filter(t => t.completed).length;
            const totalCount = dayTasks.length;
            const completionRate = Math.round((completedCount / totalCount) * 100);

            // 完成进度条
            const completionBar = document.createElement('div');
            completionBar.className = 'calendar-completion-bar';
            const completionFill = document.createElement('div');
            completionFill.className = 'calendar-completion-fill';
            completionFill.style.width = `${completionRate}%`;
            completionBar.appendChild(completionFill);
            dayEl.appendChild(completionBar);

            // 任务数量
            const taskCount = document.createElement('div');
            taskCount.className = 'calendar-task-count';
            taskCount.textContent = `${completedCount}/${totalCount}`;
            dayEl.appendChild(taskCount);
        }

        // 点击日期跳转到任务列表
        if (!isOtherMonth) {
            dayEl.addEventListener('click', (e) => this.handleDayClick(dateStr, e));
        }

        return dayEl;
    }

    // 格式化日期字符串
    formatDateString(year, month, day) {
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        return `${year}-${monthStr}-${dayStr}`;
    }

    // 获取指定日期的任务
    getTasksForDate(dateStr) {
        return this.tasks.filter(task => {
            if (!task.dueDate) return false;
            
            // 提取日期部分（忽略时间）
            const taskDate = task.dueDate.split('T')[0];
            return taskDate === dateStr;
        });
    }

    // 处理日期点击
    async handleDayClick(dateStr, event) {
        // 切换回列表视图
        await this.switchView('list');

        // 具体日期改由搜索栏的"截止时间" chip 承载，下拉框回到"所有时间"以免条件叠加为空
        const dueDateFilter = document.getElementById('due-date-filter');
        if (dueDateFilter) dueDateFilter.value = 'all';

        if (window.todoManager) {
            // 旧的自定义日期筛选不再使用，避免与 chip 重复表达同一条件
            window.todoManager.customDateFilter = null;
            window.todoManager.dueDateFilter = 'all';
            // 回显到搜索栏：生成一个"截止 YYYY-MM-DD" chip，可单独点 × 移除
            window.todoManager.setDueDateChip(dateStr);

            // 显示提示信息
            Utils.showToast(`${window.languageManager.getText('showTaskFor', '当前任务日期：')} ${dateStr}`, 'info');
        }
    }
}

// 创建全局实例
window.calendarManager = new CalendarManager();

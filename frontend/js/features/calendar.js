class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.tasks = [];
        this.currentMonth = null;
        // 登记到刷新路由：数据/筛选变更时由它判断是否在前台，这里不再自判
        window.refreshRouter?.register('calendar', () => this.loadCalendarTasks());
    }

    init() {
        this.bindEvents();
    }

    // 月历翻月按钮；顶部视图下拉框由 ViewManager 绑定
    bindEvents() {
        const prevMonthBtn = document.getElementById('prev-month');
        const nextMonthBtn = document.getElementById('next-month');
        this.currentMonth = document.getElementById('calendar-background-month');
        this.currentMonth.textContent = this.currentDate.getMonth() + 1;
        prevMonthBtn?.addEventListener('click', () => this.previousMonth());
        nextMonthBtn?.addEventListener('click', () => this.nextMonth());
    }

    previousMonth() {
        const monthIndex = this.currentDate.getMonth();
        this.currentMonth.textContent = monthIndex == 0 ? 12 : monthIndex;
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        // 新月份从左侧滑入，与前进步骤方向相反
        this._pendingSlide = 'prev';
        this.renderCalendar();
    }

    nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        this.currentMonth.textContent = this.currentDate.getMonth() + 1;
        this._pendingSlide = 'next';
        this.renderCalendar();
    }

    // 日历视图专用取数：沿用当前生效的筛选（分类 / 优先级 / 状态 / 搜索 chips），
    // 只拿月历格渲染需要的字段，不带分页。
    async loadCalendarTasks() {
        const filter = window.viewFilter.build();
        // 月历按整天铺开，单日条件会让月历只剩那一天（进入日历时已清掉 chip）
        filter.dueDateFilter = null;
        await Utils.apiCall({
            apiMethod: 'get_calendar_tasks',
            apiArgs: [filter],
            onSuccess: (response) => {
                this.tasks = response.data || [];
                if (window.viewManager.currentView === 'calendar') this.renderCalendar();
            }
        });
    }

    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        this.renderCalendarDays(year, month);
    }

    renderCalendarDays(year, month) {
        const calendarDays = document.getElementById('calendar-days');
        if (!calendarDays) return;

        calendarDays.innerHTML = '';

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        // 0 是星期日
        const firstDayOfWeek = firstDay.getDay();

        const daysInMonth = lastDay.getDate();

        const prevMonthLastDay = new Date(year, month, 0).getDate();

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

    createDayElement(day, year, month, isOtherMonth = false, isToday = false) {
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';

        if (isOtherMonth) {
            dayEl.classList.add('other-month');
        }

        if (isToday) {
            dayEl.classList.add('today');
        }

        const dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        dayEl.appendChild(dayNumber);

        const dateStr = this.formatDateString(year, month, day);
        const dayTasks = this.getTasksForDate(dateStr);

        if (dayTasks.length > 0 && !isOtherMonth) {
            dayEl.classList.add('has-tasks');
        }

        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'calendar-day-tasks';

        // 最多显示 2 个任务
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

        if (dayTasks.length > 0 && !isOtherMonth) {
            const completedCount = dayTasks.filter(t => t.completed).length;
            const totalCount = dayTasks.length;
            const completionRate = Math.round((completedCount / totalCount) * 100);

            const completionBar = document.createElement('div');
            completionBar.className = 'calendar-completion-bar';
            const completionFill = document.createElement('div');
            completionFill.className = 'calendar-completion-fill';
            completionFill.style.width = `${completionRate}%`;
            completionBar.appendChild(completionFill);
            dayEl.appendChild(completionBar);

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

    formatDateString(year, month, day) {
        const monthStr = String(month + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        return `${year}-${monthStr}-${dayStr}`;
    }

    getTasksForDate(dateStr) {
        return this.tasks.filter(task => {
            if (!task.dueDate) return false;
            
            // 提取日期部分（忽略时间）
            const taskDate = task.dueDate.split('T')[0];
            return taskDate === dateStr;
        });
    }

    async handleDayClick(dateStr, event) {
        await window.viewManager.switchView('list');

        // 具体日期改由搜索栏的"截止时间" chip 承载，下拉框回到"所有时间"以免条件叠加为空
        const dueDateFilter = document.getElementById('due-date-filter');
        if (dueDateFilter) dueDateFilter.value = 'all';

        if (window.todoManager) {
            // 单日条件统一由下面的 chip 承载，快捷筛选拨回"全部"以免两者叠加
            window.viewFilter.dueDateFilter = 'all';
            // 回显到搜索栏：生成一个"截止 YYYY-MM-DD" chip，可单独点 × 移除
            window.viewFilter.setDueDateChip(dateStr);

            Utils.showToast(`${window.languageManager.getText('showTaskFor', '当前任务日期：')} ${dateStr}`, 'info');
        }
    }
}

window.calendarManager = new CalendarManager();

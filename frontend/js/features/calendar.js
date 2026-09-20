// 日历视图模块

class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.tasks = [];
        this.currentMonth = null;
    }

    // 初始化
    init() {
        this.bindEvents();
    }

    // 绑定事件（月历翻月按钮；顶部视图下拉框由 ViewManager 绑定）
    bindEvents() {
        const prevMonthBtn = document.getElementById('prev-month');
        const nextMonthBtn = document.getElementById('next-month');
        this.currentMonth = document.getElementById('calendar-background-month');
        this.currentMonth.textContent = this.currentDate.getMonth() + 1;
        prevMonthBtn?.addEventListener('click', () => this.previousMonth());
        nextMonthBtn?.addEventListener('click', () => this.nextMonth());
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
        // 日历视图的数据源是 get_calendar_tasks（只回月历格所需字段），
        // 列表的分页结果不能覆盖它，否则月历会退化成列表当前页的那十几条。
        // 数据变更后的日历刷新由 App.notifyDataChanged 触发 loadCalendarTasks。
        if (window.viewManager.currentView === 'calendar') {
            this.renderCalendar();
            return;
        }
        this.tasks = tasks;
    }

    // 日历视图专用取数：沿用列表当前生效的筛选（分类 / 优先级 / 状态 / 搜索 chips），
    // 只拿月历格渲染需要的字段，不带分页。
    async loadCalendarTasks() {
        let filter = null;
        if (window.todoManager) {
            filter = window.todoManager.buildListFilter();
            // 月历按整天铺开，单日条件会让月历只剩那一天（进入日历时已清掉 chip）
            filter.dueDateFilter = null;
            filter.dueDate = null;
        }
        await Utils.apiCall({
            apiMethod: 'get_calendar_tasks',
            apiArgs: [filter],
            onSuccess: (response) => {
                this.tasks = response.data || [];
                if (window.viewManager.currentView === 'calendar') this.renderCalendar();
            }
        });
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
        // 切换回列表视图（视图切换由 ViewManager 负责）
        await window.viewManager.switchView('list');

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

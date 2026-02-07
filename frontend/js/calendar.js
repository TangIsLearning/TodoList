// 日历视图管理模块

class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.currentView = 'list'; // 'list' 或 'calendar'
        this.tasks = [];
    }

    // 初始化
    init() {
        this.bindEvents();
    }

    // 绑定事件
    bindEvents() {
        const viewToggleBtn = document.getElementById('view-toggle-btn');
        const prevMonthBtn = document.getElementById('prev-month');
        const nextMonthBtn = document.getElementById('next-month');

        if (viewToggleBtn) {
            viewToggleBtn.addEventListener('click', () => this.toggleView());
        }

        if (prevMonthBtn) {
            prevMonthBtn.addEventListener('click', () => this.previousMonth());
        }

        if (nextMonthBtn) {
            nextMonthBtn.addEventListener('click', () => this.nextMonth());
        }
    }

    // 切换视图
    async toggleView() {
        const tasksView = document.getElementById('tasks-view');
        const pagination = document.getElementById('pagination');
        const calendarView = document.getElementById('calendar-view');
        const viewToggleBtn = document.getElementById('view-toggle-btn');
        let filterPageSize;

        if (this.currentView === 'list') {
            // 切换到日历视图
            tasksView.style.display = 'none';
            pagination.style.display = 'none';
            calendarView.style.display = 'block';
            viewToggleBtn.textContent = '📋 列表视图';
            viewToggleBtn.classList.add('active');
            this.currentView = 'calendar';
            filterPageSize = 9999; // 假定单月任务最多9999个任务
        } else {
            // 切换到列表视图
            tasksView.style.display = 'block';
            pagination.style.display = 'flex';
            calendarView.style.display = 'none';
            viewToggleBtn.textContent = '📅 日历视图';
            viewToggleBtn.classList.remove('active');
            this.currentView = 'list';
            filterPageSize = 10;
        }

        // 通知TodoManager进行筛选
        if (window.todoManager) {
            window.todoManager.currentPage = 1; // 重置到第一页
            window.todoManager.pageSize = filterPageSize; // 设置分页数量
            window.todoManager.customDateFilter = null; // 清除自定义日期筛选
            window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
            await window.todoManager.loadTasks();
            console.log('Filter completed'); // 调试日志
        } else {
            console.log('TodoManager not available'); // 调试日志
        }
    }

    // 上一个月
    previousMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        this.renderCalendar();
    }

    // 下一个月
    nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
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

        // 更新标题
        const monthYearEl = document.getElementById('current-month-year');
        if (monthYearEl) {
            monthYearEl.textContent = `${year}年 ${month + 1}月`;
        }

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

        // 渲染下个月的开始天数（补足6周42天）
        const totalRenderedDays = firstDayOfWeek + daysInMonth;
        const remainingDays = 42 - totalRenderedDays;
        for (let day = 1; day <= remainingDays; day++) {
            const dayEl = this.createDayElement(day, year, month + 1, true);
            calendarDays.appendChild(dayEl);
        }
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
        const displayTasks = dayTasks.slice(0, 3);
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
            taskCount.textContent = `${completedCount}/${totalCount} 已完成`;
            if (dayTasks.length > 3) {
                taskCount.textContent += ` (还有${dayTasks.length - 3}个)`;
            }
            dayEl.appendChild(taskCount);
        }

        // 点击日期跳转到任务列表
        if (!isOtherMonth) {
            dayEl.addEventListener('click', () => this.handleDayClick(dateStr));
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
    async handleDayClick(dateStr) {
        // 切换回列表视图
        await this.toggleView();

        // 设置截止日期筛选为指定日期
        const dueDateFilter = document.getElementById('due-date-filter');
        if (dueDateFilter) {
            // 重置为"所有时间"，因为我们要通过自定义日期筛选来实现
            dueDateFilter.value = 'all';
        }

        // 触发筛选更新，筛选出该日期的任务
        if (window.todoManager) {
            // 如果当前有自定义日期筛选，先清除它
            if (window.todoManager.customDateFilter) {
                window.todoManager.customDateFilter = null;
            }
            // 设置自定义日期筛选
            window.todoManager.customDateFilter = dateStr;
            // 重置到第一页
            window.todoManager.currentPage = 1;
            // 重置无限下拉状态
            window.todoManager.resetInfiniteScroll();
            // 重新加载任务
            await window.todoManager.loadTasks();

            // 显示提示信息
            Utils.showToast(`${window.languageManager.getText('showTaskFor', '当前任务日期：')} ${dateStr}`, 'info');
        }
    }
}

// 创建全局实例
window.calendarManager = new CalendarManager();

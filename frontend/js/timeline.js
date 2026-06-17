// 时间轴视图管理模块

class TimelineManager {
    constructor() {
        // ---------- 数据模型 ----------
        this.tasks = [];
        this.startDate = null;
        this.weekCount = 1;
        this.max_weeks = 4;
        this.timelineStartHour = 0;
        this.timelineEndHour = 24;
        this.currentDragTaskId = null;
        this.resizeObserver = null;
        this.priorityFilter = 'all';
        this.statusFilter = 'uncompleted';
        this.dueDateFilter = 'all';
        this.categoryId = null;
    }

    async init() {
        this.bindEvents();
        this.startDate = this.getStartOfWeek(new Date());
        this.weekCount = 1;
        const initDates = this.getDateRange();
        await this.renderTimeline();
    }

    async getTasks(startDate, endDate) {
        const response = await window.pywebview.api.get_todos(
            1,  // page
            999999,  // page_size - 设置一个足够大的值以获取所有任务
            this.categoryId=== 'all' ? null : this.currentFilter,
            this.statusFilter === 'all' ? null : this.statusFilter,
            this.priorityFilter === 'all' ? null : this.priorityFilter,
            this.dueDateFilter === 'all' ? null : this.dueDateFilter,
            null,  // year
            null,  // month
            null,  // search-input
            null,  // custom-date
            this.formatDate(startDate),
            this.formatDate(endDate)
        );
        if (response.success) {
            // 使用当前筛选条件下的所有任务更新分类计数
            return this.convertTasks(response.tasks);
        }
        return []
    }

    convertTasks(tasks) {
        return tasks.map(task => {
            const dueDate = task.dueDate;
            if (!dueDate) {
              // 若没有 dueDate，可跳过或返回占位
              return null;
            }

            // 分离日期和时间
            const [date, time] = dueDate.split('T');
            const hour = parseInt(time.split(':')[0], 10);

            // 计算时段：时间点归属于前一个整点时段
            let slotKey;
            if (hour === 0) {
                // 0点特殊处理，可根据实际需求改为 '23-24'（跨天）或 '0-1'
                slotKey = '0-1';
            } else {
                slotKey = `${hour - 1}-${hour}`;
            }

            return {
                id: task.id,          // 保留原 ID（若需生成 t1, t2 可改为 `t${index+1}`）
                title: task.title,
                date: date,
                slotKey: slotKey
            };
        }).filter(task => task !== null); // 过滤无效项
    }

    formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    bindEvents() {
        document.getElementById('prevWeekBtn').addEventListener('click', () => this.shiftStartDate(-1));
        document.getElementById('nextWeekBtn').addEventListener('click', () => this.shiftStartDate(1));
        document.getElementById('weekMinusBtn').addEventListener('click', () => this.changeWeekCount(-1));
        document.getElementById('weekPlusBtn').addEventListener('click', () => this.changeWeekCount(1));
        document.getElementById('priority-filter').addEventListener('change', async (e) => {
                this.priorityFilter = e.target.value;
                this.renderTimeline();
            });
        document.getElementById('status-filter').addEventListener('change', async (e) => {
                this.statusFilter = e.target.value;
                this.renderTimeline();
            });
        document.getElementById('due-date-filter').addEventListener('change', async (e) => {
                this.dueDateFilter = e.target.value;
                this.renderTimeline();
            });
        document.addEventListener('click', (e) => {
            // 分类筛选 - 确保不是点击按钮时触发
            if (e.target.closest('.category-item') && !e.target.closest('.category-edit-btn') && !e.target.closest('.category-delete-btn')) {
                const categoryItem = e.target.closest('.category-item');
                this.categoryId = categoryItem.dataset.category;
                this.renderTimeline();
            }
        });
        this.timelineStartHour = 0;
        this.timelineEndHour = 24;
        window.addEventListener('resize', () => this.adaptLayoutToViewport());
    }

    // 辅助函数: 获取某周周一
    getStartOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = (day === 0 ? -6 : 1) - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    getEndOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = (7 - day) % 7; // 到下一个周日
        d.setDate(d.getDate() + diff);
        d.setHours(0,0,0,0); // 去除时间部分，只保留日期
        return d;
    }

    getDateRange() {
        let dates = [];
        let current = new Date(this.startDate);
        const totalDays = this.weekCount * 7;
        for (let i = 0; i < totalDays; i++) {
            let yyyy = current.getFullYear();
            let mm = String(current.getMonth() + 1).padStart(2, '0');
            let dd = String(current.getDate()).padStart(2, '0');
            dates.push(`${yyyy}-${mm}-${dd}`);
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    // 构建时间轴分段 (0-8合并，8-18每小时等分，18-24合并) + 根据显示区间过滤
    buildTimeSlots() {
        const fullSegments = [
            { name: "0:00 - 8:00", key: "0-8", start: 0, end: 8 },
            ...Array.from({ length: 10 }, (_, i) => {
                let hour = 8 + i;
                return { name: `${hour}:00 - ${hour+1}:00`, key: `${hour}-${hour+1}`, start: hour, end: hour+1 };
            }),
            { name: "18:00 - 24:00", key: "18-24", start: 18, end: 24 }
        ];
        return fullSegments.filter(seg => seg.end > this.timelineStartHour && seg.start < this.timelineEndHour);
    }

    // 动态调整行高与列宽，确保不出现滚动条（完全自适应）
    adaptLayoutToViewport() {
        const container = document.getElementById('timelineContainer');
        const timeAxisCol = document.querySelector('.time-axis-col');
        const datesHeader = document.querySelector('.dates-header');
        const bodyRows = document.querySelector('.body-rows');
        const timeSlotsElems = document.querySelectorAll('.time-slot-row');
        const timelineRows = document.querySelectorAll('.timeline-row');

        if (!container) return;
        const containerHeight = container.clientHeight;
        const headerHeight = document.querySelector('.dates-header')?.offsetHeight || 48;
        const availableHeight = containerHeight - headerHeight;
        const slotCount = timeSlotsElems.length;
        if (slotCount === 0) return;

        // 动态计算每行高度，使所有行恰好占满可用区域，不留滚动条
        const rowHeight = Math.max(32, Math.floor(availableHeight / slotCount));
        timeSlotsElems.forEach(row => {
            row.style.height = `${rowHeight}px`;
            row.style.lineHeight = `${rowHeight}px`;
        });
        timelineRows.forEach(row => {
            row.style.height = `${rowHeight}px`;
        });

        // 动态调整右侧grid-cell内任务卡片字体基准 (通过CSS变量)
        const dateCount = this.getDateRange().length;
        // 根据列数动态设定卡片最小字体和间距，列越多字体越小
        let baseFontScale = Math.min(1, Math.max(0.6, 14 / (dateCount * 0.8)));
        document.documentElement.style.setProperty('--task-card-scale', baseFontScale);
        // 直接操控卡片样式内联
        const cards = document.querySelectorAll('.task-card');
        cards.forEach(card => {
            let computedSize = Math.max(9, 14 - dateCount * 0.3);
            card.style.fontSize = `${Math.min(13, Math.max(9, computedSize))}px`;
        });
    }

    // 渲染主视图 + 自适应
    async renderTimeline() {
        const dates = this.getDateRange();
        const timeSlots = this.buildTimeSlots();
        const container = document.getElementById('timelineGrid');
        if (!container) return;

        document.getElementById('weekCountIndicator').innerText = `${this.weekCount}周 / 最多4周`;
        const startDateObj = new Date(this.startDate);
        const endDateObj = new Date(this.startDate);
        endDateObj.setDate(endDateObj.getDate() + (this.weekCount*7) - 1);
        this.tasks = await this.getTasks(startDateObj, endDateObj);
        const formatMD = (d) => `${d.getMonth()+1}/${d.getDate()}`;
        document.getElementById('dateRangeLabel').innerHTML = `📅 ${formatMD(startDateObj)} - ${formatMD(endDateObj)}  (${this.weekCount*7}天)`;

        // 构建左侧列
        let leftColHtml = `<div class="time-axis-col"><div class="time-header-placeholder">⏰ 时间轴</div>`;
        timeSlots.forEach(slot => {
            leftColHtml += `<div class="time-slot-row" data-slot-key="${slot.key}">${slot.name}</div>`;
        });
        leftColHtml += `</div>`;

        // 右侧：头部日期 + 主体行
        let rightHtml = `<div class="dates-grid"><div class="dates-header">`;
        dates.forEach(dateStr => {
            const dateObj = new Date(dateStr);
            const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
            const weekdayName = weekdays[dateObj.getDay()];
            rightHtml += `<div class="date-cell" data-date="${dateStr}" title="${dateStr}">
                            ${dateStr.slice(5)} <span class="weekday">${weekdayName}</span>
                          </div>`;
        });
        rightHtml += `</div><div class="body-rows">`;

        for (let rowIdx = 0; rowIdx < timeSlots.length; rowIdx++) {
            const slot = timeSlots[rowIdx];
            rightHtml += `<div class="timeline-row" data-row-slot="${slot.key}">`;
            for (let colIdx = 0; colIdx < dates.length; colIdx++) {
                const dateStr = dates[colIdx];
                const cellTasks = this.tasks.filter(t => t.date === dateStr && t.slotKey === slot.key);
                let tasksHtml = '';
                if (cellTasks.length === 0) {
                    tasksHtml = `<div class="empty-cell-message" style="font-size:0.6rem;">+</div>`;
                } else {
                    cellTasks.forEach(task => {
                        tasksHtml += `
                            <div class="task-card" draggable="true" data-task-id="${task.id}">
                                <span class="task-name">${this.escapeHtml(task.title)}</span>
                                <button class="delete-task" data-task-id="${task.id}">✕</button>
                            </div>
                        `;
                    });
                }
                rightHtml += `<div class="grid-cell" data-date="${dateStr}" data-slot="${slot.key}">${tasksHtml}</div>`;
            }
            rightHtml += `</div>`;
        }
        rightHtml += `</div></div>`;

        container.innerHTML = leftColHtml + rightHtml;

        // 绑定拖拽事件和删除
        this.attachDragEvents();
        this.attachDeleteEvents();

        // 执行自适应布局 (无滚动条)
        setTimeout(() => {
            this.adaptLayoutToViewport();
        }, 10);

        // 监听resize重新适配
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.adaptLayoutToViewport());
        const containerElem = document.getElementById('timelineContainer');
        if (containerElem) this.resizeObserver.observe(containerElem);
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    // 拖拽逻辑
    attachDragEvents() {
        const cards = document.querySelectorAll('.task-card');
        cards.forEach(card => {
            card.setAttribute('draggable', 'true');
            card.addEventListener('dragstart', (e) => this.handleDragStart(e));
            card.addEventListener('dragend', (e) => this.handleDragEnd(e));
            const delBtn = card.querySelector('.delete-task');
            if (delBtn) delBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        });
        const cells = document.querySelectorAll('.grid-cell');
        cells.forEach(cell => {
            cell.addEventListener('dragover', (e) => {
                e.preventDefault();
                cell.classList.add('drag-over');
            });
            cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
            cell.addEventListener('drop', (e) => this.handleDropOnCell(e));
        });
    }

    handleDragStart(e) {
        const taskCard = e.target.closest('.task-card');
        if (!taskCard) return;
        const taskId = taskCard.getAttribute('data-task-id');
        if (taskId) {
            this.currentDragTaskId = taskId;
            e.dataTransfer.setData('text/plain', taskId);
            e.dataTransfer.effectAllowed = 'move';
            taskCard.classList.add('dragging');
        }
    }

    handleDragEnd(e) {
        const draggingCard = document.querySelector('.task-card.dragging');
        if (draggingCard) draggingCard.classList.remove('dragging');
        this.currentDragTaskId = null;
        document.querySelectorAll('.grid-cell').forEach(cell => cell.classList.remove('drag-over'));
    }

    async handleDropOnCell(e) {
        e.preventDefault();
        const targetCell = e.currentTarget;
        targetCell.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (!taskId) return;
        const targetDate = targetCell.getAttribute('data-date');
        const targetSlot = targetCell.getAttribute('data-slot');
        if (!targetDate || !targetSlot) return;
        const taskIdx = this.tasks.findIndex(t => t.id === taskId);
        if (taskIdx !== -1) {
            this.tasks[taskIdx].date = targetDate;
            this.tasks[taskIdx].slotKey = targetSlot;
            await this.renderTimeline();
        }
    }

    attachDeleteEvents() {
        document.querySelectorAll('.delete-task').forEach(btn => {
            btn.removeEventListener('click', (e) => this.handleDelete(e));
            btn.addEventListener('click', (e) => this.handleDelete(e));
        });
    }

    async handleDelete(e) {
        e.stopPropagation();
        const taskId = e.currentTarget.getAttribute('data-task-id');
        if (taskId) {
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            await this.renderTimeline();
        }
    }

    async changeWeekCount(delta) {
        let newCount = this.weekCount + delta;
        if (newCount < 1) newCount = 1;
        if (newCount > this.max_weeks) newCount = this.max_weeks;
        if (newCount !== this.weekCount) {
            this.weekCount = newCount;
            await this.renderTimeline();
        }
    }

    async shiftStartDate(deltaWeeks) {
        let newStart = new Date(this.startDate);
        newStart.setDate(newStart.getDate() + deltaWeeks * 7);
        this.startDate = newStart;
        await this.renderTimeline();
    }
}

// 创建全局实例
window.timelineManager = new TimelineManager();
// 任务管理模块

class TodoManager {
    constructor() {
        this.instances = [];
        this.tasks = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.priorityFilter = 'all';
        this.statusFilter = 'uncompleted';
        this.dueDateFilter = 'all';
        this.sortBy = 'created_at'; // 使用默认排序逻辑
        this.sortOrder = 'desc';
        this.customDateFilter = null; // 自定义日期筛选（用于日历视图）
        // 父任务选择器状态
        this.parentTaskState = {
            currentPage: 1,
            pageSize: 10,
            searchQuery: '',
            selectedId: '',
            hasMore: false,
            isLoading: false,
            isOpen: false,
            editingTaskId: ''
        };
        // 分页相关
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalTasks = 0;
        this.totalPages = 0;
        // 无限下拉相关
        this.isLoadingMore = false;
        this.hasMoreTasks = true;
        this.scrollThreshold = 300; // 距离底部300px时开始加载
        this.scrollListener = null;
        // 标签相关
        this.availableTags = [];
        this.selectedTags = [];
        this.isShowMoreTags = false;
        this.defaultShowTags = 5;
        // 搜索标签 chips：{ type: 'tag'|'text', value, tagId?, color? }
        this.searchChips = [];
        this._searchDebounceTimer = null;
        // 子任务搜索建议下拉（输入 ">" 触发）
        this._subtaskSuggestTimer = null;
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
        // 日期范围缓存
        this.currentDateRange = null;
        // 统计数据更新防抖
        this._statsDebounceTimer = null;
        this._pendingFromZero = false;
        this._statsTagDebounceTimer = null;
        this._tagPendingFromZero = false;
        // DOM 元素缓存与统一管理
        this.cacheDomRefs();
        // 附件管理（表单中的附件选择/展示/移除、详情中的附件展示）
        this.attachmentManager = new AttachmentManager(this);
        // 设置日期组件
        this.pikaday = new Pikaday({
            field: this.datePicker,
            format: 'YYYY-MM-DD',
            showDaysInNextAndPreviousMonths: true,
            firstDay: 1,
            toString: function(date, format) {
                const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

                const day = String(date.getDate()).padStart(2, '0');
                const monthName = String(months[date.getMonth()]).padStart(2, '0');
                const year = date.getFullYear();

                return `${year}-${monthName}-${day}`;
            },
            i18n: {
                previousMonth: 'Prev',
                nextMonth: 'Next',
                months: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
                weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            },
            onSelect: function(selectedDate) {
                if (selectedDate) {
                    const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

                    const year = selectedDate.getFullYear();
                    const day = String(selectedDate.getDate()).padStart(2, '0');
                    const monthName = String(months[selectedDate.getMonth()]).padStart(2, '0');

                    document.getElementById('task-due-date-picker').value = `${year}-${monthName}-${day}`;
                }
            }
        });
    }
    
    // 初始化
    async init() {
        this.bindEvents();

        // 设置默认筛选为"全部"
        this.currentFilter = 'all';
        
        // 初始化搜索清空按钮状态
        this.updateSearchClearButton();
        
        await this.loadTasks();
        
        // 初始化无限下拉功能
        this.initInfiniteScroll();

        // 初始化标签管理模块
        await this.loadTagsModule(true);
    }

    // 统一缓存所有 DOM 节点
    cacheDomRefs() {
        const dom = {
            tasksList: 'tasks-list',
            pagination: 'pagination',
            noMoreTask: 'no-more-tasks',
            loadingMoreTask: 'loading-more',
            tasksContainer: 'tasks-view',
            firstBtn: 'pagination-first',
            prevBtn: 'pagination-prev',
            nextBtn: 'pagination-next',
            lastBtn: 'pagination-last',
            pageSizeSelect: 'page-size-select',
            dropdown: 'subtask-suggestions',
            showMoreTags: 'show-more-tags',
            showLessTags: 'show-less-tags',
            tagSelector: 'tags-selector',
            searchInput: 'search-input',
            searchTagWrapper: 'search-tag-wrapper',
            searchClearBtn: 'search-clear-btn',
            isRecurringCheckbox: 'is-recurring',
            recurringOptions: 'recurring-options',
            recurrenceToggle: 'recurrence-toggle',
            recurrenceCount: 'recurrence-count',
            recurrenceType: 'recurrence-type',
            datePicker: 'task-due-date-picker',
            timeInput: 'task-due-time',
            clearDateBtn: 'clear-date',
            clearTimeBtn: 'clear-time',
            modalTitle: 'modal-title',
            taskForm: 'task-form',
            taskTitle: 'task-title',
            taskDescription: 'task-description',
            taskPrioritySelect: 'task-priority',
            taskCategorySelect: 'task-category',
            taskParent: 'task-parent',
            taskParentInput: 'task-parent-input',
            taskParentDropdown: 'parent-task-dropdown',
            moreOptionsToggle: 'more-options-toggle',
            moreOptionsContent: 'more-options-content',
            searchBtn: 'search-btn',
            priorityFilterSelect: 'priority-filter',
            statusFilterSelect: 'status-filter',
            dueDateFilterSelect: 'due-date-filter',
            addTaskBtn: 'add-task-btn',
            addTaskFab: 'add-task-fab',
            taskModalClose: 'modal-close',
            taskCancelBtn: 'cancel-btn',
            showMoreTagsSpan: 'show-tags',
            recurrenceError: 'recurrence-error',
            datetimeError: 'datetime-error',
            emptyState: 'empty-state',
            parentTaskCombobox: 'parent-task-combobox',
            loadMoreParentTask: 'load-more-btn',
            paginationShow: 'pagination-showing',
            paginationNum: 'pagination-numbers',
            totalUncompletedTasksStats: 'total-uncompleted-tasks',
            todayCompletedTasksStats: 'today-completed-tasks',
            completionRateStats: 'completion-rate',
            overDueDateStats: 'over-due-date-tasks',
            dateRangeStats: 'stats-date-range',
            addTagBtn: 'add-tag-btn',
            tagsSection: 'tags-section',
            tagsList: 'tags-list',
        };
        Object.entries(dom).forEach(([key, id]) => {
            this[key] = document.getElementById(id);
        });
    }

    // 绑定事件
    bindEvents() {
        // 监听窗口大小变化，切换分页/无限下拉模式
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 300);
        });

        // 搜索（标签 chips 输入模式）
        this.initSearchTagInput();

        this.searchBtn?.addEventListener('click', () => {
            // 若输入框中是完整的 #标签，先提交为 chip
            this.commitInputAsChipIfTag();
            this.syncSearchQuery(0);
        });

        // 清空搜索按钮
        this.searchClearBtn?.addEventListener('click', () => this.clearSearch());

        // 筛选器
        this.priorityFilterSelect?.addEventListener('change', (e) => this.onFilterChange('priorityFilter', e.target.value));
        this.statusFilterSelect?.addEventListener('change', (e) => this.onFilterChange('statusFilter', e.target.value));
        this.dueDateFilterSelect?.addEventListener('change', (e) => this.onFilterChange('dueDateFilter', e.target.value));

        // 添加任务按钮
        this.addTaskBtn?.addEventListener('click', () => this.showAddTaskModal());
        this.addTaskFab?.addEventListener('click', () => this.showAddTaskModal());

        // 任务表单
        this.taskForm?.addEventListener('submit', (e) => this.handleTaskSubmit(e));

        // 模态框关闭按钮
        this.taskModalClose?.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));
        this.taskCancelBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));

        // 更多选项展开/收起按钮
        this.moreOptionsToggle?.addEventListener('click', () => this.toggleMoreOptions());

        // 周期性任务复选框
        this.isRecurringCheckbox?.addEventListener('change', (e) => this.toggleRecurringOptions());

        // 日期时间清空按钮
        this.clearDateBtn?.addEventListener('click', () => {
            this.datePicker.value = '';
            this.clearDateBtn.classList.remove('visible');
            this.addInputValueListeners();
        });
        this.clearTimeBtn?.addEventListener('click', () => {
            this.timeInput.value = '';
            this.clearTimeBtn.classList.remove('visible');
            this.addInputValueListeners();
        });

        // 展示更多/更少标签
        this.showMoreTagsSpan?.addEventListener('click', () => this.toggleMoreTags());

        // 绑定分页相关的监听事件
        this.firstBtn?.addEventListener('click', () => this.goToPage(1));
        this.prevBtn?.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        this.nextBtn?.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        this.lastBtn?.addEventListener('click', () => this.goToPage(this.totalPages));
        this.pageSizeSelect?.addEventListener('change', (e) => this.changePageSize(e.target.value));
    }

    // 通用筛选器处理
    async onFilterChange(filterType, value) {
        this[filterType] = value;
        this.currentPage = 1;
        this.customDateFilter = null;
        this.resetInfiniteScroll();
        await this.loadTasks();
    }
    
    // 展开/收起更多选项
    toggleMoreOptions() {
        if (this.moreOptionsContent.style.display === 'none' || this.moreOptionsContent.style.display === '') {
            this.moreOptionsContent.style.display = 'block';
            this.moreOptionsToggle.classList.add('expanded');
            this.moreOptionsToggle.querySelector('.toggle-icon').textContent = '-';
        } else {
            this.moreOptionsContent.style.display = 'none';
            this.moreOptionsToggle.classList.remove('expanded');
            this.moreOptionsToggle.querySelector('.toggle-icon').textContent = '+';
        }
    }
    
    // 重置更多选项状态
    resetMoreOptions() {
        this.moreOptionsContent.style.display = 'none';
        this.moreOptionsToggle.classList.remove('expanded');
        this.moreOptionsToggle.querySelector('.toggle-icon').textContent = '+';

        // 重置周期性任务选项
        this.isRecurringCheckbox.checked = false;
        this.recurringOptions.style.display = 'none';

        // 重置循环次数的必填状态
        this.recurrenceCount.required = false;
        this.recurrenceCount.value = '';
        this.recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
        this.recurrenceType.value = '';
    }
    
    // 为编辑模式添加周期性任务提示
    addRecurringEditNotice() {
        const recurringSection = document.querySelector('.recurring-options')?.parentElement;
        if (recurringSection) {
            // 检查是否已有提示
            let notice = recurringSection.querySelector('.edit-notice');
            if (!notice) {
                notice = document.createElement('div');
                notice.className = 'edit-notice';
                notice.innerHTML = `⚠️ ${window.languageManager.getText('recurringEditNotice', '非周期性任务编辑模式下不支持改周期性任务')}`;
                
                // 插入到周期性选项区域之前
                recurringSection.insertBefore(notice, this.recurringOptions);
            }
        }
    }
    
    // 移除编辑模式提示
    removeRecurringEditNotice() {
        const notice = document.querySelector('.edit-notice');
        if (notice) notice.remove();
    }
    
    // 展开/收起周期性任务选项
    toggleRecurringOptions() {
        this.recurrenceError.textContent =
            window.languageManager.getText('recurringErrorNotice', '周期性任务，日期不能为空，否则无法确定周期开始时间');

        const isChecked = this.isRecurringCheckbox.checked;
        this.recurringOptions.style.display = isChecked ? 'block' : 'none';
        this.recurrenceCount.required = isChecked;
        this.datePicker.required = isChecked;
        this.timeInput.required = isChecked;
        this.recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');

        const hasError = isChecked && (!this.datePicker.value || !this.timeInput.value);
        this.recurrenceError.style.display = hasError ? 'block' : 'none';
        this.datePicker.style.borderColor = hasError ? '#e74c3c' : '';
        this.timeInput.style.borderColor = hasError ? '#e74c3c' : '';
    }
    
    // 添加输入值变化监听
    addInputValueListeners() {
        const setError = (valid, msg) => {
            Object.assign(this.datetimeError.style, { display: valid ? 'none' : 'block' });
            this.datetimeError.textContent = valid ? '' : msg;
            const color = valid ? '' : '#e74c3c';
            this.datePicker.style.borderColor = color;
            this.timeInput.style.borderColor = color;
            if (valid) this.toggleRecurringOptions();
        };

        const validate = () => {
            const { valid, message } = BusinessUtils.DateTimeValidator.validateDateTime(
                this.datePicker.value || null,
                this.timeInput.value || null
            );
            setError(valid, message);
        };

        const updateBtn = (input, btn) => btn.classList.toggle('visible', !!input.value);

        // 日期变化处理（含权限）
        const onDateChange = async () => {
            updateBtn(this.datePicker, this.clearDateBtn);
            if (!localStorage.getItem('calendar_permission') && this.isMobileDevice?.()) {
                await Utils.apiCall({ apiMethod: 'check_calendar_permission', successCheck: () => true });
                localStorage.setItem('calendar_permission', 'true');
            }
            validate();
        };

        // 时间变化处理
        const onTimeChange = () => {
            updateBtn(this.timeInput, this.clearTimeBtn);
            validate();
        };

        // 初始化 + 绑定
        [onDateChange, onTimeChange].forEach(fn => fn());
        this.datePicker.addEventListener('input', onDateChange);
        this.datePicker.addEventListener('change', onDateChange);
        this.timeInput.addEventListener('input', onTimeChange);
        this.timeInput.addEventListener('change', onTimeChange);
    }
    
    // 加载任务
    async loadTasks(fromZero = false) {
        Utils.setLoading(true, '加载任务...');
        const isLoadSubtasks = this.searchQuery && this.searchQuery.startsWith('>') && this.searchQuery.substring(1).trim();
        const categoryIdArg = this.currentFilter === 'all' ? null : this.currentFilter;
        const statusArg = this.statusFilter === 'all' ? null : this.statusFilter;
        const priorityArg = this.priorityFilter === 'all' ? null : this.priorityFilter;
        const dueDateArg = this.dueDateFilter === 'all' ? null : this.dueDateFilter;
        let apiMethod;
        let apiArgs;
        if (isLoadSubtasks) {
            apiMethod = 'search_subtasks_by_parent_name';
            // 参数顺序需与后端 TodoApi.search_subtasks_by_parent_name 签名对齐：
            // (parent_name, page, page_size, category_id, status, priority, due_date_filter)
            apiArgs = [
                this.searchQuery.substring(1).trim(),
                this.currentPage,
                this.pageSize,
                categoryIdArg,
                statusArg,
                priorityArg,
                dueDateArg
            ];
        } else {
            apiMethod = 'get_todos';
            apiArgs = [
                this.currentPage,
                this.pageSize,
                categoryIdArg,
                statusArg,
                priorityArg,
                dueDateArg,
                null,  // year
                null,  // month
                this.searchQuery || null,
                this.customDateFilter || null
            ];
        }
        await Utils.apiCall({
            apiMethod: apiMethod,
            apiArgs: apiArgs,
            onSuccess: (response) => {
                this.tasks = response.data.tasks;
                this.totalTasks = response.data.total;
                this.totalPages = response.data.total_pages;
                if (window.innerWidth > 480) {
                    // 大屏幕(大于480px)：使用表格分页模式，每页10条
                    this.renderTasks();
                    this.renderPagination();
                    // 隐藏无限下拉相关
                    if (this.loadingMoreTask) this.loadingMoreTask.style.display = 'none';
                    if (this.noMoreTask) this.noMoreTask.style.display = 'none';
                } else {
                    // 小屏幕：使用无限下拉模式
                    this.renderTasks();
                    this.initInfiniteScroll();
                }

                this.updateStats(fromZero);
                this.updateCategoryCounts(fromZero);

                // 更新日历视图数据
                if (window.calendarManager) window.calendarManager.updateTasks(this.tasks);

                // 同步分类筛选状态
                if (window.categoryManager) window.categoryManager.setActiveCategory(this.currentFilter);

                // 若统计视图正处于前台，按当前 分类+标签 chips 同步刷新统计
                this._syncStatsFilterIfVisible();
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('loadingTaskFailed', '加载任务失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });

    }
    
    // 渲染任务列表
    async renderTasks() {
        // 更新日历视图数据
        if (window.calendarManager) window.calendarManager.updateTasks(this.tasks);

        if (this.tasks.length === 0) {
            this.tasksList.style.setProperty('display', 'none', 'important');
            this.emptyState.style.display = 'block';
            // 隐藏分页
            this.pagination.style.display = 'none';
            return;
        }

        // 根据屏幕尺寸设置display样式 (大于480px使用表格布局)
        const isLargeScreen = window.innerWidth > 480;
        this.tasksList.style.display = isLargeScreen ? 'table' : 'flex';
        this.emptyState.style.display = 'none';

        // 生成HTML
        let html = '';

        // 大屏幕添加表头
        if (isLargeScreen) {
            html += `
                <div class="tasks-header">
                    <div class="tasks-header-row">
                        <div class="tasks-header-cell">${window.languageManager.getText('taskHeaderName', '任务名称')}</div>
                        <div class="tasks-header-cell">${window.languageManager.getText('taskHeaderPriority', '优先级')}</div>
                        <div class="tasks-header-cell">${window.languageManager.getText('taskHeaderDueDate', '到期时间')}</div>
                        <div class="tasks-header-cell">${window.languageManager.getText('taskHeaderTag', '标签')}</div>
                        <div class="tasks-header-cell">${window.languageManager.getText('taskHeaderAction', '操作')}</div>
                    </div>
                </div>
            `;
        }

        html += this.tasks.map(task => this.createTaskElement(task)).join('');
        this.tasksList.innerHTML = html;

        // 绑定任务事件
        await this.bindTaskEvents();
    }
    
    // 创建任务元素
    createTaskElement(task) {
        const priorityInfo = Utils.getPriorityInfo(task.priority);
        // 只有未完成的任务才检查是否逾期
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);
        const isLargeScreen = window.innerWidth > 480;

        // 渲染标签
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = task.tags.map(tag =>
                `<span class="task-tag" style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                </span>`
            ).join('');
        }

        // 大屏幕表格式布局
        if (isLargeScreen) {
            return `
                <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
                    <div class="task-header">
                        <div class="task-header-content">
                            <div class="task-checkbox ${task.completed ? 'checked' : ''}"
                                 data-task-id="${task.id}"></div>
                            <div class="task-content">
                                <h3 class="task-title" title="${task.title}">
                                    ${Utils.escapeHtml(task.title)}
                                    ${(task.parentTaskId || task.isRecurring) ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                                    <span class="subtask-count" data-task-id="${task.id}" data-task-title="${Utils.escapeHtml(task.title)}" style="display: none; cursor: pointer;">📋 <span class="count">0</span></span>
                                </h3>
                            </div>
                        </div>
                        <p class="task-description" style="display: none;">${task.description ? Utils.escapeHtml(task.description) : ''}</p>
                    </div>
                    <div class="task-meta">
                        <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                            ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                        </span>
                    </div>
                    <div class="task-due-date-cell">
                        ${task.dueDate ? `
                            <span class="task-due-date ${isOverdue ? 'overdue' : ''}" title="截止时间">
                                📅 ${Utils.formatDate(task.dueDate)}
                            </span>
                        ` : '<span style="color: var(--text-muted);">-</span>'}
                    </div>
                    <div class="task-tags">
                        ${tagsHtml || '<span style="color: var(--text-muted);">-</span>'}
                    </div>
                    <div class="task-actions">
                        <button class="btn view" data-task-id="${task.id}"
                                title="查看详情">👁️</button>
                        <button class="btn edit" data-task-id="${task.id}"
                                title="编辑">✏️</button>
                        <button class="btn delete" data-task-id="${task.id}"
                                title="删除">🗑️</button>
                    </div>
                </div>
            `;
        }

        // 小屏幕卡片式布局(保持原样)
        return `
            <div class="small-screen-task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
                <div class="task-header">
                    <div class="task-checkbox ${task.completed ? 'checked' : ''}"
                         data-task-id="${task.id}"></div>
                    <div class="task-content">
                        <h3 class="task-title">
                            ${Utils.escapeHtml(task.title)}
                            ${task.isRecurring ? `<span class="recurring-badge">${window.languageManager.getText('recurrenceType', '周期性')}</span>` : ''}
                            ${task.parentTaskId ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                            <span class="subtask-count" data-task-id="${task.id}" data-task-title="${Utils.escapeHtml(task.title)}" style="display: none; cursor: pointer;">📋 <span class="count">0</span></span>
                        </h3>
                        ${task.description ? `<p class="task-description">${Utils.escapeHtml(task.description)}</p>` : ''}
                        <div class="task-meta">
                            <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                                ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                            </span>
                            ${task.categoryId ? `
                                <span class="task-category" data-category-id="${task.categoryId}">
                                    📁 加载中...
                                </span>
                            ` : ''}
                            ${task.dueDate ? `
                                <span class="task-due-date ${isOverdue ? 'overdue' : ''}"
                                      title="截止时间">
                                    📅 ${Utils.formatDate(task.dueDate)}
                                </span>
                            ` : ''}
                            ${tagsHtml ? `<div class="task-tags">${tagsHtml}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn view" data-task-id="${task.id}"
                                title="查看">👁️</button>
                    <button class="btn edit" data-task-id="${task.id}"
                            title="编辑">✏️</button>
                    <button class="btn delete" data-task-id="${task.id}"
                            title="删除">🗑️</button>
                </div>
            </div>
        `;
    }
    
    // 绑定任务事件
    async bindTaskEvents() {
        // 复选框点击
        document.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.toggleTask(taskId);
            };
        });

        // 查看详情按钮(仅大屏幕)
        document.querySelectorAll('.btn.view').forEach(btn => {
            btn.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.viewTaskDetails(taskId);
            };
        });

        // 先重置所有小屏幕任务项的样式
        document.querySelectorAll('.small-screen-task-item').forEach(item => {
            const content = item.querySelector('.task-header');
            if (content) {
                // 重置所有样式到初始状态
                content.style.left = '0px';
                content.style.transition = 'left 0.2s ease';
                content._isOpen = false;
            }

            // 移除之前绑定的所有事件（包括触摸事件）
            if (item._dragStartHandler) {
                item.removeEventListener('mousedown', item._dragStartHandler);
                item.removeEventListener('touchstart', item._dragStartHandler);
            }
            if (item._dragMoveHandler) {
                item.removeEventListener('mousemove', item._dragMoveHandler);
                item.removeEventListener('touchmove', item._dragMoveHandler);
            }
            if (item._dragEndHandler) {
                item.removeEventListener('mouseup', item._dragEndHandler);
                item.removeEventListener('touchend', item._dragEndHandler);
                item.removeEventListener('touchcancel', item._dragEndHandler);
            }
            if (item._clickHandler) item.removeEventListener('click', item._clickHandler);
        });

        // 清空实例数组
        this.instances = [];

        // 重新绑定
        document.querySelectorAll('.small-screen-task-item').forEach(item => {
            const content = item.querySelector('.task-header');
            if (!content) return;

            const btnWidth = 80;

            // 确保初始状态正确
            content.style.left = '0px';
            content.style.position = 'relative';
            content._isOpen = false;

            // 为每个item创建独立的状态
            const state = {
                isDragging: false,
                startX: 0,
                currentX: 0,
                currentLeft: 0,
                isOpen: false,
                startClientX: 0, // 用于存储触摸或鼠标的起始X坐标
                startClientY: 0  // 用于存储触摸或鼠标的起始Y坐标
            };

            // 获取客户端X坐标的统一函数
            const getClientX = (e) => {
                if (e.type.startsWith('touch')) return e.touches[0] ? e.touches[0].clientX : 0;
                return e.clientX;
            };

            // 阻止默认行为的统一函数
            const preventDefault = (e) => {
                if (e.cancelable) e.preventDefault();
            };

            // 创建事件处理函数
            const dragStartHandler = (e) => {
                // 如果点击的是操作按钮区域或复选框，不触发拖拽
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 如果当前是打开状态，只关闭但不开始拖拽
                if (content._isOpen) {
                    // 关闭当前项
                    content._isOpen = false;
                    content.style.left = '0px';
                    content.style.transition = 'left 0.2s ease';

                    // 从实例数组中移除
                    const index = this.instances.indexOf(content);
                    if (index > -1) this.instances.splice(index, 1);

                    preventDefault(e);
                    e.stopPropagation();
                    return;
                }

                // 开始拖拽
                state.isDragging = true;
                state.startClientX = getClientX(e);
                state.startClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                state.currentLeft = content.offsetLeft;
                state.currentX = 0;

                content.style.transition = 'none';
                // 暂时不阻止默认行为，等判断是水平拖拽后再阻止
            };

            const dragMoveHandler = (e) => {
                if (!state.isDragging) return;

                const currentClientX = getClientX(e);
                if (currentClientX === 0) return; // 无效的触摸点

                const currentClientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
                const deltaX = currentClientX - state.startClientX;
                const deltaY = currentClientY - state.startClientY;

                // 只有当水平拖拽距离大于垂直拖拽距离时，才认为是水平拖拽
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    preventDefault(e);

                    let newLeft = state.currentLeft + deltaX;

                    // 边界限制
                    if (newLeft > 0) newLeft = 0;
                    if (newLeft < -btnWidth) newLeft = -btnWidth;

                    content.style.left = newLeft + 'px';
                    state.currentX = newLeft;
                } else {
                    // 垂直拖拽，不阻止默认行为，允许滚动
                    state.isDragging = false;
                }
            };

            const dragEndHandler = (e) => {
                if (!state.isDragging) return;

                state.isDragging = false;
                content.style.transition = 'left 0.2s ease';

                // 判断是否打开
                if (state.currentX < -btnWidth / 2) {
                    // 打开前关闭其他所有项
                    this.instances.forEach(instance => {
                        if (instance && instance !== content) {
                            instance.style.left = '0px';
                            instance.style.transition = 'left 0.2s ease';
                            instance._isOpen = false;
                        }
                    });

                    // 打开当前项
                    content._isOpen = true;
                    content.style.left = -btnWidth + 'px';

                    // 更新实例数组
                    this.instances = [content];
                } else {
                    // 关闭当前项
                    content._isOpen = false;
                    content.style.left = '0px';

                    // 从实例数组中移除
                    const index = this.instances.indexOf(content);
                    if (index > -1) this.instances.splice(index, 1);
                }

                // 重置拖拽状态
                state.currentX = 0;
                state.currentLeft = 0;

                preventDefault(e);
            };

            // 点击处理函数
            const clickHandler = (e) => {
                // 如果点击的是操作按钮区域或复选框，不处理
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) return;

                // 如果当前是打开状态，阻止点击事件
                if (content._isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            };

            // 存储事件处理函数
            item._dragStartHandler = dragStartHandler;
            item._dragMoveHandler = dragMoveHandler;
            item._dragEndHandler = dragEndHandler;
            item._clickHandler = clickHandler;

            // 绑定鼠标事件
            item.addEventListener('mousedown', dragStartHandler);
            item.addEventListener('mousemove', dragMoveHandler);
            item.addEventListener('mouseup', dragEndHandler);

            // 绑定触摸事件（移动端）
            item.addEventListener('touchstart', dragStartHandler);
            item.addEventListener('touchmove', dragMoveHandler, { passive: false });
            item.addEventListener('touchend', dragEndHandler);
            item.addEventListener('touchcancel', dragEndHandler);

            // 点击和原生拖拽阻止
            item.addEventListener('click', clickHandler);
            item.addEventListener('dragstart', (e) => e.preventDefault());
        });

        // 全局点击关闭（也要支持触摸）
        const closeAllHandler = (e) => {
            if (!e.target.closest('.small-screen-task-item')) {
                this.instances.forEach(instance => {
                    if (instance) {
                        instance.style.left = '0px';
                        instance.style.transition = 'left 0.2s ease';
                        instance._isOpen = false;
                    }
                });
                this.instances = [];
            }
        };

        document.addEventListener('click', closeAllHandler);
        document.addEventListener('touchstart', closeAllHandler); // 添加触摸支持

        await this.loadSubtaskCounts();

        // 绑定子任务数量徽章点击事件
        this.bindSubtaskCountEvents();

        // 添加CSS样式防止移动端默认行为
        const style = document.createElement('style');
        style.textContent = `
            .small-screen-task-item {
                user-select: none;
                -webkit-user-select: none;
            }
            .task-header {
                will-change: transform; /* 优化性能 */
            }
        `;
        document.head.appendChild(style);

        // 编辑按钮
        document.querySelectorAll('.btn.edit').forEach(btn => {
            const taskId = btn.dataset.taskId;
            const task = this.tasks.find(t => t.id === taskId);

            // 如果是周期性任务，禁用编辑按钮并添加点击提示
            if (task && (task.isRecurring || task.parentTaskId)) {
                btn.disabled = true;
                btn.title = `${window.languageManager.getText('recurringTaskEditTip', '周期性任务不支持编辑')}`;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';

                // 设置点击事件处理，显示提示信息
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    Utils.showToast(window.languageManager.getText('periodicTaskEditFailed', '周期性任务不支持编辑，请删除后重新创建'), 'warning');
                };
            } else {
                btn.disabled = false;
                btn.title = `${window.languageManager.getText('normalTaskEditTip', '编辑')}`;
                btn.style.opacity = '';
                btn.style.cursor = '';

                // 设置编辑功能
                btn.onclick = (e) => {
                    const taskId = e.target.dataset.taskId;
                    this.editTask(taskId);
                };
            }
        });

        // 删除按钮
        document.querySelectorAll('.btn.delete').forEach(btn => {
            btn.onclick = async (e) => {
                const taskId = e.target.dataset.taskId;
                await this.deleteTask(taskId);
            };
        });

        // 加载分类名称
        await this.loadCategoryNames();
    }
    
    // 加载分类名称
    async loadCategoryNames() {
        await Utils.apiCall({
            apiMethod: 'get_categories',
            onSuccess: (response) => {
                const categories = response.data;
                const categoryMap = {};

                categories.forEach(cat => {
                    categoryMap[cat.id] = cat.name;
                });

                document.querySelectorAll('.task-category').forEach(el => {
                    const categoryId = el.dataset.categoryId;
                    const categoryName = categoryMap[categoryId] || '未知分类';
                    el.textContent = `📁 ${categoryName}`;
                });
            }
        });
    }
    
    // 切换任务状态
    async toggleTask(taskId) {
        // 获取当前任务状态
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // 如果是要完成任务，检查是否有未完成的子任务
        if (!task.completed) {
            let hasUnCompletedChildren = false;
            await Utils.apiCall({
                apiMethod: 'get_children',
                apiArgs: [taskId],
                onSuccess: (response) => {
                    const children = response.data;
                    if (children && children.length > 0) {
                        const uncompletedChildren = children.filter(child => !child.completed);
                        hasUnCompletedChildren = uncompletedChildren.length > 0;
                    }
                }
            });
            if (hasUnCompletedChildren) {
                Utils.showToast(window.languageManager.getText('cannotCompleteWithUncompletedChildren',
                    '该任务存在未完成的子任务，请先完成所有子任务'), 'warning');
                return;
            }
        }

        await Utils.apiCall({
            apiMethod: 'toggle_todo',
            apiArgs: [taskId],
            onSuccess: (response) => {
                // 更新本地数据
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    task.completed = response.data.completed;
                    task.updatedAt = response.data.updatedAt;

                    // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                    Utils.showToast(task.completed ?
                        window.languageManager.getText('taskCompleted', '任务已完成') :
                        window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                    // 触发云端同步上传
                    Utils.apiCall({apiMethod: 'trigger_upload_on_change', successCheck: (response) => true});
                    // 完成任务后刷新任务列表数据
                    this.loadTasks(true);
                }
            },
            onError: (error) => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            }
        });
    }
    
    // 显示添加任务模态框
    showAddTaskModal() {
        this.modalTitle.textContent = '新建任务';
        this.taskForm.reset();
        this.taskForm.dataset.editingId = '';
        
        // 重置更多选项状态
        this.resetMoreOptions();
        
        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();
        
        // 移除编辑模式提示（如果存在）
        this.removeRecurringEditNotice();
        
        // 截止日期默认为空，不设置默认值
        this.timeInput.value = '';

        // 重置已选标签
        this.selectedTags = [];

        // 添加输入值变化监听
        this.addInputValueListeners();

        // 获取当前选中的分类ID
        const currentCategory = this.currentFilter && this.currentFilter !== 'all' ? this.currentFilter : '';

        // 加载分类选项并设置默认选中
        this.loadCategoryOptions(currentCategory);

        // 重置并初始化父任务选择器
        this.parentTaskState.editingTaskId = '';
        this.resetParentTaskCombobox();
        this.initParentTaskCombobox();

        // 加载标签选择器
        this.loadTagsSelector();

        // 重置附件
        this.attachmentManager?.reset();

        Utils.ModalManager.show('task-modal');
    }
    
    // 初始化父任务选择器
    initParentTaskCombobox() {
        // 点击输入框打开下拉
        this.taskParentInput.addEventListener('focus', async (e) => {
            this.parentTaskState.isOpen = true;
            this.taskParentDropdown.style.display = 'block';
            
            // 如果没有内容，加载初始数据
            const results = this.taskParentDropdown.querySelector('.combobox-results');
            if (results.children.length === 0 && !this.parentTaskState.isLoading) await this.loadParentTasks(false);
        });
        
        // 输入搜索
        let searchTimeout;
        this.taskParentInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            // 如果输入框为空，清空父任务选择
            if (query === '') {
                this.taskParent.value = '';
                this.parentTaskState.selectedId = '';
            }
            
            searchTimeout = setTimeout(async () => {
                if (query !== this.parentTaskState.searchQuery) {
                    this.parentTaskState.searchQuery = query;
                    this.parentTaskState.currentPage = 1;
                    await this.loadParentTasks(true);
                }
            }, 300);
        });
        
        // 点击其他地方关闭
        document.addEventListener('click', (e) => {
            if (!this.parentTaskCombobox.contains(e.target)) {
                this.taskParentDropdown.style.display = 'none';
                this.parentTaskState.isOpen = false;
            }
        });
        
        // 加载更多
        this.loadMoreParentTask.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.loadParentTasks(false);
        });
    }
    
    // 加载父任务列表
    async loadParentTasks(isNewSearch = false) {
        const results = this.taskParentDropdown.querySelector('.combobox-results');
        const loading = this.taskParentDropdown.querySelector('.combobox-loading');
        const loadMore = this.taskParentDropdown.querySelector('.combobox-load-more');
        const empty = this.taskParentDropdown.querySelector('.combobox-empty');
        
        if (this.parentTaskState.isLoading) return;
        this.parentTaskState.isLoading = true;
        
        loading.style.display = 'block';
        empty.style.display = 'none';

        const searchQuery = this.parentTaskState.searchQuery;
        const page = this.parentTaskState.currentPage;
        const pageSize = this.parentTaskState.pageSize;
        await Utils.apiCall({
            apiMethod: 'get_todos',
            apiArgs: [page, pageSize, null, 'uncompleted', null, null, null, null, searchQuery || null],
            onSuccess: (response) => {
                let tasks = response.data.tasks.filter(t => !t.isRecurring && !t.parentTaskId);

                // 排除当前编辑的任务
                if (this.parentTaskState.editingTaskId) {
                    tasks = tasks.filter(t => t.id !== this.parentTaskState.editingTaskId);
                }

                if (isNewSearch) results.innerHTML = '';

                // 渲染任务列表
                if (tasks.length > 0) {
                    tasks.forEach(task => {
                        const item = this.createParentTaskItem(task);
                        results.appendChild(item);
                    });

                    // 使用后端返回的分页信息判断是否有更多
                    const total = response.data.total || 0;
                    const loadedCount = page * pageSize;
                    this.parentTaskState.hasMore = loadedCount < total;

                    loadMore.style.display = this.parentTaskState.hasMore ? 'block' : 'none';
                    empty.style.display = 'none';
                } else if (results.children.length === 0) {
                    empty.style.display = 'block';
                    loadMore.style.display = 'none';
                }
            },
            onFinally: () => {
                this.parentTaskState.isLoading = false;
                this.parentTaskState.currentPage++;
                loading.style.display = 'none';
            }
        });
    }
    
    // 创建父任务列表项
    createParentTaskItem(task) {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.dataset.taskId = task.id;
        item.dataset.taskTitle = task.title;
        
        // 显示任务标题和状态
        item.innerHTML = `
            <span class="task-title ${task.completed ? 'completed' : ''}">${Utils.escapeHtml(task.title)}</span>
        `;
        
        item.addEventListener('click', () => this.selectParentTask(task));
        
        return item;
    }
    
    // 选择父任务
    selectParentTask(task) {
        this.taskParentInput.value = task.title;
        this.taskParent.value = task.id;
        this.parentTaskState.selectedId = task.id;
        this.taskParentDropdown.style.display = 'none';
        this.parentTaskState.isOpen = false;
    }
    
    // 重置父任务选择器
    resetParentTaskCombobox() {
        const results = document.querySelector('.combobox-results');
        
        this.taskParentInput.value = '';
        this.taskParent.value = '';
        this.parentTaskState.selectedId = '';
        this.parentTaskState.searchQuery = '';
        this.parentTaskState.currentPage = 1;
        this.parentTaskState.hasMore = false;
        
        if (results) results.innerHTML = '';
    }
    
    // 初始化父任务选择器（编辑模式）
    async initParentTaskForEdit(taskId) {
        // 重置并初始化选择器
        this.parentTaskState.editingTaskId = taskId;
        this.resetParentTaskCombobox();
        this.initParentTaskCombobox();
        
        // 获取当前任务的父任务
        await Utils.apiCall({
            apiMethod: 'get_parent',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const parent = response.data;
                if (parent) {
                    this.taskParent.value = parent.id;
                    this.taskParentInput.value = parent.title;
                    this.parentTaskState.selectedId = parent.id;
                }
            }
        });
    }
    
    // 加载子任务数量并更新显示
    async loadSubtaskCounts() {
        const subtaskCountEls = document.querySelectorAll('.subtask-count');
        if (subtaskCountEls.length === 0) return;
        
        const taskIds = Array.from(subtaskCountEls).map(el => el.dataset.taskId);

        for (const taskId of taskIds) {
            await Utils.apiCall({
                apiMethod: 'get_children',
                apiArgs: [taskId],
                onSuccess: (response) => {
                    const children = response.data;
                    if (children && children.length > 0) {
                        const countEl = document.querySelector(`.subtask-count[data-task-id="${taskId}"]`);
                        if (countEl) {
                            const countSpan = countEl.querySelector('.count');
                            if (countSpan) countSpan.textContent = children.length;
                            countEl.style.display = 'inline';
                        }
                    }
                }
            });
        }
    }
    
    // 绑定子任务数量徽章点击事件
    bindSubtaskCountEvents() {
        document.querySelectorAll('.subtask-count').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const count = el.querySelector('.count');
                const countValue = parseInt(count?.textContent || '0');
                
                if (countValue > 0) {
                    const taskTitle = el.dataset.taskTitle;
                    if (taskTitle) {
                        // 进入子任务搜索模式：清空 chips 并透传 ">父任务名"
                        this.searchChips = [];
                        this.renderSearchChips();
                        this.searchInput.value = `>${taskTitle}`;
                        this.syncSearchQuery(0);
                    }
                }
            });
        });
    }
    
    // 查看任务详情
    async viewTaskDetails(taskId) {
        let task = this.tasks.find(t => t.id === taskId);

        // 如果当前页任务中不存在该任务，再查询数据库
        if (!task) {
            await Utils.apiCall({
                apiMethod: 'get_todo',
                apiArgs: [taskId],
                onSuccess: (response) => task = response.data
            });
        }
        if (!task) return;

        const priorityInfo = Utils.getPriorityInfo(task.priority);
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);

        // 渲染标签HTML
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = task.tags.map(tag =>
                `<span class="task-tag" style="background-color: ${tag.color}; border: 1px solid ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                </span>`
            ).join('');
        } else {
            tagsHtml = `<span style="color: var(--text-secondary);">${window.languageManager.getText('noTaskTags', '无标签')}</span>`;
        }

        // 获取父任务和子任务信息
        let parentInfo = '';
        let childrenInfo = '';

        await Utils.apiCall({
            apiMethod: 'get_parent',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const parent = response.data;
                if (parent) {
                    parentInfo = `
                        <div>
                            <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('parentTask', '父任务')}</strong>
                            <span style="color: var(--primary-color); font-size: 14px; cursor: pointer;" class="link-text" data-task-id="${parent.id}">
                                🔗 ${Utils.escapeHtml(parent.title)}
                            </span>
                        </div>
                    `;
                }
            }
        });

        await Utils.apiCall({
            apiMethod: 'get_children',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const children = response.data;
                if (children && children.length > 0) {
                    const childrenHtml = children.map(child =>
                        `<span style="display: block; color: var(--primary-color); font-size: 14px; cursor: pointer; margin-bottom: 4px;" class="link-text" data-task-id="${child.id}">
                            📋 ${Utils.escapeHtml(child.title)} ${child.completed ? '✓' : ''}
                        </span>`
                    ).join('');
                    childrenInfo = `
                        <div style="grid-column: 1 / -1;">
                            <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('subTasks', '子任务')} (${children.length})</strong>
                            <div>${childrenHtml}</div>
                        </div>
                    `;
                }
            }
        });

        // 附件信息
        const attachmentsInfo = this.attachmentManager
            ? this.attachmentManager.buildDetailHtml(task)
            : '';

        const detailContent = `
            <div style="padding: 20px;">
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 20px; color: var(--text-primary); margin-bottom: 10px;">
                        ${Utils.escapeHtml(task.title)}
                        ${task.isRecurring ? `<span class="recurring-badge">${window.languageManager.getText('recurrenceType', '周期性')}</span>` : ''}
                        ${task.parentTaskId ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                    </h3>
                    <p style="color: var(--text-secondary); line-height: 1.6;">
                        ${task.description ? Utils.escapeHtml(task.description).replace(/\n/g, '<br>') : window.languageManager.getText('noTaskDescription', '无描述')}
                    </p>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskStatus', '状态')}</strong>
                        <span style="padding: 6px 12px; border-radius: 8px; font-size: 14px; font-weight: 500;
                              ${task.completed ? 'background-color: var(--success-color); color: white;' : 'background-color: var(--priority-medium); color: var(--text-primary);'}">
                            ${task.completed ? window.languageManager.getText('statusCompleted', '已完成') : window.languageManager.getText('statusUncompleted', '未完成')}
                        </span>
                    </div>

                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskPriority', '优先级')}</strong>
                        <span class="task-priority ${task.priority}" style="font-size: 14px; padding: 6px 12px;">
                            ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                        </span>
                    </div>

                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskDueDate', '截止日期')}</strong>
                        <span style="color: ${isOverdue ? 'var(--danger-color)' : 'var(--text-primary)'}; font-size: 14px;">
                            ${task.dueDate ? `📅 ${Utils.formatDate(task.dueDate)}` : window.languageManager.getText('dueDateNoDueDate', '无截止日期')}
                        </span>
                    </div>

                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskCategory', '分类')}</strong>
                        <span style="color: var(--text-primary); font-size: 14px;">
                            ${task.categoryId ? '📁 <span class="task-category-detail" data-category-id="${task.categoryId}">加载中...</span>' : window.languageManager.getText('uncategorized', '无分类')}
                        </span>
                    </div>

                    ${parentInfo}

                    <div style="grid-column: 1 / -1;">
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskTags', '标签')}</strong>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${tagsHtml}
                        </div>
                    </div>

                    ${attachmentsInfo}

                    ${childrenInfo}

                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskCreateTime', '创建时间')}</strong>
                        <span style="color: var(--text-primary); font-size: 14px;">
                            ${task.createdAt ? `📅 ${Utils.formatDate(task.createdAt)}` : '-'}
                        </span>
                    </div>

                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskUpdateTime', '更新时间')}</strong>
                        <span style="color: var(--text-primary); font-size: 14px;">
                            ${task.updatedAt ? `📅 ${Utils.formatDate(task.updatedAt)}` : '-'}
                        </span>
                    </div>
                </div>
            </div>
        `;

        Utils.confirmDialog(
            detailContent,
            null,
            null,
            '任务详情',
            'view-modal'
        );

        // 加载分类名称
        await this.loadCategoryNameForDetail(task.categoryId);

        // 绑定关联任务点击事件
        document.querySelectorAll('.link-text[data-task-id]').forEach(el => {
            el.onclick = (e) => {
                const targetTaskId = e.currentTarget.dataset.taskId;
                Utils.ModalManager.hide('view-modal');
                this.viewTaskDetails(targetTaskId);
            };
        });

        // 绑定附件点击事件（图片预览 / 文件打开 / 链接跳转）
        this.attachmentManager?.bindDetailEvents(task);
    }

    // 加载分类名称(用于详情对话框)
    async loadCategoryNameForDetail(categoryId) {
        if (!categoryId) return;

        await Utils.apiCall({
            apiMethod: 'get_categories',
            onSuccess: (response) => {
                const categories = response.data;
                const category = categories.find(cat => cat.id === categoryId);
                const categoryEl = document.querySelector('.task-category-detail');
                if (category && categoryEl) {
                    categoryEl.textContent = category.name;
                }
            }
        });
    }

    // 编辑任务
    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 如果是周期性任务，禁用编辑
        if (task.isRecurring || task.parentTaskId) {
            Utils.showToast(window.languageManager.getText('periodicTaskEditFailed', '周期性任务不支持编辑，请删除后重新创建'), 'warning');
            return;
        }
        
        this.modalTitle.textContent = '编辑任务';
        this.taskForm.dataset.editingId = taskId;

        // 重置更多选项状态
        this.resetMoreOptions();
        
        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();
        
        // 移除编辑模式提示（如果存在）
        this.removeRecurringEditNotice();

        // 填充表单
        this.taskTitle.value = task.title;
        this.taskDescription.value = task.description || '';
        this.taskPrioritySelect.value = task.priority;

        // 设置已选标签
        this.selectedTags = task.tags ? task.tags.map(t => t.id) : [];

        // 如果有截止日期，自动展开更多选项
        if (task.dueDate) {
            const [datePart, timePart] = task.dueDate.split('T');
            this.datePicker.value = datePart;
            this.timeInput.value = timePart;
            
            // 自动展开更多选项
            this.moreOptionsContent.style.display = 'block';
            this.moreOptionsToggle.classList.add('expanded');
            this.moreOptionsToggle.querySelector('.toggle-icon').textContent = '-';
        }
        
        // 禁用周期性任务选项（编辑模式下不允许转换为周期性任务）
        this.disableRecurringOptions();
        
        // 添加编辑模式提示
        this.addRecurringEditNotice();
        
        // 加载分类选项
        this.loadCategoryOptions(task.categoryId);

        // 初始化父任务选择器（编辑模式需要先获取已选的父任务）
        this.initParentTaskForEdit(task.id);
        
        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载标签选择器
        this.loadTagsSelector();

        // 加载已有附件
        this.attachmentManager?.loadFromTask(task);

        Utils.ModalManager.show('task-modal');
    }
    
    // 加载父任务选项（编辑模式）
    async loadParentTaskOptionsForEdit(taskId) {
        let parentId = '';
        await Utils.apiCall({
            apiMethod: 'get_parent',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const parent = response.data;
                if (parent) {
                    parentId = parent.id
                }
            }
        });
        await this.loadParentTaskOptions(parentId);
    }
    
    // 禁用周期性任务选项
    disableRecurringOptions() {
        // 禁用复选框和相关选项
        this.isRecurringCheckbox.disabled = true;
        this.isRecurringCheckbox.checked = false;
        this.isRecurringCheckbox.title = '编辑模式下不支持创建周期性任务';
        this.recurrenceToggle.style.display = 'none';
        this.isRecurringCheckbox.style.display = 'none';

        // 隐藏周期性选项区域
        this.recurringOptions.style.display = 'none';

        // 重置相关字段
        this.recurrenceType.value = '';
        this.recurrenceType.disabled = true;
        this.recurrenceCount.value = '';
        this.recurrenceCount.disabled = true;
    }
    
    // 启用周期性任务选项
    enableRecurringOptions() {
        // 启用复选框
        this.isRecurringCheckbox.disabled = false;
        this.isRecurringCheckbox.checked = false;
        this.isRecurringCheckbox.title = '';
        this.recurrenceToggle.style.display = 'flex';
        this.isRecurringCheckbox.style.display = 'block';

        // 启用其他字段
        this.recurrenceType.disabled = false;
        this.recurrenceCount.disabled = false;

        // 确保周期性选项区域是隐藏的（默认状态）
        this.recurringOptions.style.display = 'none';
    }
    
    // 加载分类选项
    async loadCategoryOptions(selectedId = '') {
        await Utils.apiCall({
            apiMethod: 'get_categories',
            onSuccess: (response) => {
                const categories = response.data;
                this.taskCategorySelect.innerHTML = `<option value="">${window.languageManager.getText('uncategorized', '未分类')}</option>`;
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    option.selected = cat.id === selectedId;
                    this.taskCategorySelect.appendChild(option);
                });
            }
        });
    }
    
    // 处理任务表单提交
    async handleTaskSubmit(e) {
        e.preventDefault();
        
        const taskForm = e.target;
        const editingId = taskForm.dataset.editingId;
        const isEdit = editingId && editingId !== '';

        const dateStr = this.datePicker.value || null;
        const timeStr = this.timeInput.value || null;
        
        // 校验截止时间
        const dateTimeValidation = BusinessUtils.DateTimeValidator.validateDateTime(dateStr, timeStr);
        if (!dateTimeValidation.valid) {
            Utils.showToast(dateTimeValidation.message, 'warning');
            return;
        }
        
        let isoDateStr = null;
        if (dateStr && timeStr) isoDateStr = `${dateStr}T${timeStr}`;

        const parentTaskId = this.taskParent.value || null;

        const taskData = {
            title: this.taskTitle.value.trim(),
            description: this.taskDescription.value.trim(),
            priority: this.taskPrioritySelect.value,
            categoryId: this.taskCategorySelect.value || null,
            dueDate: isoDateStr || null,
            tags: this.getSelectedTagsNames(),
            attachments: this.attachmentManager ? this.attachmentManager.getAttachments() : []
        };
        
        // 编辑模式下强制清除周期性任务相关数据
        if (!isEdit) {
            // 只有在新建模式下才允许设置周期性任务
            taskData.isRecurring = this.isRecurringCheckbox.checked;
            taskData.recurrenceType = this.recurrenceType.value || null;
            taskData.recurrenceCount = this.recurrenceCount.value ?
                parseInt(this.recurrenceCount.value) : null;

            // 验证周期性任务的必填项
            if (taskData.isRecurring) {
                if (!taskData.recurrenceType) {
                    Utils.showToast(window.languageManager.getText('errorRecurrenceTypeRequired', '请选择重复周期'), 'warning');
                    return;
                }
                if (!taskData.recurrenceCount || taskData.recurrenceCount < 1) {
                    Utils.showToast(window.languageManager.getText('errorRecurrenceCountRequired', '请输入有效的循环次数'), 'warning');
                    return;
                }
            }
        } else {
            // 编辑模式下确保不会提交周期性任务数据
            taskData.isRecurring = false;
            taskData.recurrenceType = null;
            taskData.recurrenceCount = null;
        }
        
        if (!taskData.title) {
            Utils.showToast(window.languageManager.getText('errorTitleRequired', '请输入任务标题'), 'warning');
            return;
        }

        let apiMethod;
        let apiArgs;
        if (isEdit) {
            apiMethod = 'update_todo';
            apiArgs = [editingId, taskData];
        } else {
            apiMethod = taskData.isRecurring ? 'add_recurring_todo' : 'add_todo';
            apiArgs = [taskData];
        }

        await Utils.apiCall({
            apiMethod: apiMethod,
            apiArgs: apiArgs,
            onSuccess: (response) => {
                const message = isEdit ? window.languageManager.getText('taskUpdated', '任务更新成功') :
                    window.languageManager.getText('taskCreated', '任务创建成功');

                const taskId = isEdit ? editingId : response.data.id;

                // 处理父任务关联
                if (isEdit) {
                    // 编辑模式下需要处理父任务的更新/删除
                    // 获取当前父任务
                    Utils.apiCall({
                        apiMethod: 'get_parent',
                        apiArgs: [taskId],
                        onSuccess: (response) => {
                            const parent = response.data;
                            const currentParentId = parent ? parent.id : null;
                            // 父任务发生了变化：先删除旧关联，再添加新关联
                            if (currentParentId) Utils.apiCall({apiMethod: 'remove_task_relation', apiArgs: [taskId], successCheck: (response) => true})
                            if (parentTaskId) Utils.apiCall({apiMethod: 'add_task_relation', apiArgs: [taskId, parentTaskId], successCheck: (response) => true})
                        },
                        onError: (error) => {
                            Utils.showToast(window.languageManager.getText('updateParentRelationFailed', '更新父任务关联失败'), 'warning');
                        }
                    });
                } else if (parentTaskId) {
                    // 新建模式下直接添加关联
                    Utils.apiCall({
                        apiMethod: 'add_task_relation',
                        apiArgs: [taskId, parentTaskId],
                        successCheck: (response) => true,
                        onError: (error) => {
                            Utils.showToast(window.languageManager.getText('addParentRelationFailed', '添加父任务关联失败'), 'warning');
                        }
                    });
                }

                Utils.showToast(message, 'success');
                Utils.ModalManager.hide('task-modal');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (this.isMobileDevice()) this.resetInfiniteScroll(); // 重置无限下拉状态
                this.loadTasks(true);
                window.timelineManager.renderTimeline();

                // loadTasks() 内部已经调用了 updateCategoryCounts()，不需要再调用 renderCategories()
                // renderCategories() 会重新获取所有任务（默认只取前10条），导致数据不准确

                // 触发云端同步上传
                Utils.apiCall({apiMethod: 'trigger_upload_on_change', successCheck: (response) => true});
                this.loadTagsModule(true);
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });
    }
    
    // 删除任务
    async deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // 检查是否有子任务
        let checkChildrenFailed = false;
        await Utils.apiCall({
            apiMethod: 'get_children',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const children = response.data;
                if (children && children.length > 0) {
                    Utils.showToast(
                        window.languageManager.getText('cannotDeleteWithChildren', '该任务存在子任务，请先解除关联后再删除'),
                        'warning'
                    );
                    checkChildrenFailed = true;
                }
            }
        });
        if (checkChildrenFailed) return;
        
        // 检查是否为周期性任务
        const isRecurringTask = task.isRecurring || task.parentTaskId;
        
        if (isRecurringTask) {
            this.showRecurringDeleteDialog(task);
        } else {
            // 普通任务删除确认
            Utils.confirmDialog(
                `确定要删除任务"${task.title}"吗？\n此操作无法撤销。`,
                async () => {
                    await this.performDelete(taskId, false);
                }
            );
        }
    }
    
    // 显示周期性任务删除对话框
    showRecurringDeleteDialog(task) {
        const dialogContent = `
            <div style="margin-bottom: 16px;">
                <strong>${Utils.escapeHtml(task.title)}</strong>
            </div>
            <div class="recurring-delete-options">
                <div class="recurring-delete-option">
                    <input type="radio" id="delete-single" name="delete-option" value="single" checked>
                    <label for="delete-single" class="recurring-delete-option-label">
                        <span class="primary">仅删除此任务</span>
                        <span class="secondary">删除当前选中的任务，保留周期中的其他任务</span>
                    </label>
                </div>
                <div class="recurring-delete-option">
                    <input type="radio" id="delete-all" name="delete-option" value="all">
                    <label for="delete-all" class="recurring-delete-option-label">
                        <span class="primary">删除整个周期</span>
                        <span class="secondary">删除此周期内的所有任务</span>
                    </label>
                </div>
            </div>
        `;
        
        Utils.confirmDialog(
            dialogContent,
            async () => {
                // 在确认时实时获取选中的值
                const checkedRadio = document.querySelector('input[name="delete-option"]:checked');

                const deleteOption = checkedRadio ? checkedRadio.value : 'single';
                const deleteAll = deleteOption === 'all';
                logger.info('删除选项:', deleteOption, 'deleteAll:', deleteAll);
                await this.performDelete(task.id, deleteAll);
            },
            () => {
                logger.info('删除操作被取消');
            },
            '删除周期性任务'
        );
    }
    
    // 执行删除操作
    async performDelete(taskId, deleteAll) {
        Utils.setLoading(true, '删除中...');
        await Utils.apiCall({
            apiMethod: 'delete_todo',
            apiArgs: [taskId, deleteAll],
            onSuccess: (response) => {
                const message = deleteAll ?
                    window.languageManager.getText('periodicTaskDeleted', '整个周期任务删除成功') :
                    window.languageManager.getText('taskDeleted', '任务删除成功');
                Utils.showToast(message, 'success');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (this.isMobileDevice()) {
                    this.resetInfiniteScroll(); // 重置无限下拉状态
                } else {
                    // 安全检查：确保任务列表存在
                    if (Array.isArray(this.tasks)) {
                        // 如果删除任务后，页面任务数量为空且有前置页，渲染前置页数据
                        if (this.tasks.length === 0 && this.currentPage > 1) {
                            this.currentPage = this.currentPage - 1;
                        }
                    } else {
                        logger.warning('任务列表状态异常，重新初始化');
                        this.tasks = [];
                    }
                }
                window.timelineManager.renderTimeline();
                // loadTasks() 已经包含了 updateStats() 和 updateCategoryCounts() 的调用
                // 不需要再调用 renderCategories()，否则会导致数据不准确

                // 触发云端同步上传
                Utils.apiCall({apiMethod: 'trigger_upload_on_change', successCheck: (response) => true});
                this.loadTagsModule(true);
            },
            onError: (error) => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            },
            onFinally: () => {
                Utils.setLoading(false);
                // 重新加载任务以确保数据一致性
                this.loadTasks(true);
            }
        });
    }
    
    // 更新分类任务数量：当前保持分类数量更新变化不受搜索条件影响，因而设置大部分入参为null
    async updateCategoryCounts(fromZero = false) {
        if (window.categoryManager) {
            // 获取当前筛选条件下的所有任务（不分页）
            await Utils.apiCall({
                apiMethod: 'get_todos',
                apiArgs: [
                    1,  // page
                    999999,  // page_size - 设置一个足够大的值以获取所有任务
                    null,  // 分类
                    'uncompleted',  // 状态
                    null,  // 优先级
                    null,  // 逾期
                    null,  // year
                    null,  // month
                    null,  // search-input
                    null   // custom-date
                ],
                onSuccess: (response) => {
                    window.categoryManager.updateCategoryCounts(response.data.tasks, fromZero);
                },
                onError: (error) => {
                    // 如果获取失败，使用当前页的任务
                    window.categoryManager.updateCategoryCounts(this.tasks, fromZero);
                }
            });
        }
    }

    // 渲染分页组件
    renderPagination() {
        // 仅列表视图显示分页；日历/时间轴/统计等视图加载任务后隐藏，避免分页错位显示
        if (window.calendarManager && window.calendarManager.currentView !== 'list') {
            this.pagination.style.display = 'none';
            return;
        }

        // 如果没有任务，隐藏分页
        if (this.totalTasks === 0) {
            this.pagination.style.display = 'none';
            return;
        }
        
        this.pagination.style.display = 'flex';
        
        // 更新显示信息
        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.totalTasks);
        this.paginationShow.textContent =
            `${window.languageManager.getText('paginationShowing', '显示')} ${start}-${end} ${window.languageManager.getText('paginationOf', '共')} ${this.totalTasks} ${window.languageManager.getText('paginationItems', '条')}`;

        // 更新每页数量选择器
        this.pageSizeSelect.value = this.pageSize;
        
        // 更新按钮状态
        this.firstBtn.disabled = this.currentPage === 1;
        this.prevBtn.disabled = this.currentPage === 1;
        this.nextBtn.disabled = this.currentPage === this.totalPages;
        this.lastBtn.disabled = this.currentPage === this.totalPages;
        
        // 生成页码按钮
        let pageNumbers = '';
        const maxButtons = 5; // 最多显示5个页码按钮
        
        if (this.totalPages <= maxButtons) {
            // 总页数较少，显示所有页码
            for (let i = 1; i <= this.totalPages; i++) {
                pageNumbers += `<button class="btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else {
            // 总页数较多，智能显示页码
            if (this.currentPage <= 3) {
                // 当前页在前面
                for (let i = 1; i <= 4; i++) {
                    pageNumbers += `<button class="btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                pageNumbers += `<button class="btn" data-page="${this.totalPages}">${this.totalPages}</button>`;
            } else if (this.currentPage >= this.totalPages - 2) {
                // 当前页在后面
                pageNumbers += `<button class="btn" data-page="1">1</button>`;
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                for (let i = this.totalPages - 3; i <= this.totalPages; i++) {
                    pageNumbers += `<button class="btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
            } else {
                // 当前页在中间
                pageNumbers += `<button class="btn" data-page="1">1</button>`;
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                for (let i = this.currentPage - 1; i <= this.currentPage + 1; i++) {
                    pageNumbers += `<button class="btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                pageNumbers += `<button class="btn" data-page="${this.totalPages}">${this.totalPages}</button>`;
            }
        }
        
        // 绑定页码点击事件
        this.paginationNum.innerHTML = pageNumbers;
        this.paginationNum.querySelectorAll('.btn').forEach(btn => {
            btn.onclick = () => {
                const page = parseInt(btn.dataset.page);
                this.goToPage(page);
            };
        });
    }

    // 跳转到指定页
    async goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;

        this.currentPage = page;
        await this.loadTasks();
        
        // 滚动到任务列表顶部
        this.tasksContainer.scrollTop = 0;
    }

    // 更改每页显示数量
    async changePageSize(pageSize) {
        if (pageSize === this.pageSize) return;
        
        this.pageSize = parseInt(pageSize);
        this.currentPage = 1; // 重置到第一页
        this.resetInfiniteScroll(); // 重置无限下拉状态
        await this.loadTasks();
    }
    
    // 更新统计信息
    async updateStats(fromZero = false) {
        if (fromZero) this._pendingFromZero = true;

        if (this._statsDebounceTimer) {
            clearTimeout(this._statsDebounceTimer);
        }

        this._statsDebounceTimer = setTimeout(() => {
            const shouldFromZero = this._pendingFromZero;
            this._pendingFromZero = false;
            this._statsDebounceTimer = null;

            const now = new Date();
            const dateRangeText = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
            this.dateRangeStats.innerHTML = `<span class="date-range-text">${dateRangeText}</span>`;

            Utils.apiCall({
                apiMethod: 'get_stats',
                onSuccess: (response) => {
                    const totalUncompleted = response.data.uncompleted;
                    const todayCompleted = response.data.today_completed;
                    const rate = response.data.completion_rate;
                    const overDueDate = response.data.over_due || 0;

                    this.overDueDateStats.style.color = overDueDate == 0 ? 'var(--text-primary)' : 'red';

                    Utils.animateNumber(this.totalUncompletedTasksStats, totalUncompleted, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                    Utils.animateNumber(this.todayCompletedTasksStats, todayCompleted, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                    Utils.animateNumber(this.completionRateStats, rate, { duration: 600, suffix: '%', decimals: 1, easing: 'easeOutCubic', fromZero: shouldFromZero });
                    Utils.animateNumber(this.overDueDateStats, overDueDate, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                }
            });
        }, 200);
    }

    // ===== 搜索标签 chips 相关 =====
    // 初始化搜索标签输入框
    initSearchTagInput() {
        // 键盘交互：空格提交 #标签、退格删除最后一个 chip、回车提交/搜索
        this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));

        // 输入变化：实时更新清空按钮，并防抖触发搜索（自由文本搜索）
        // 当输入以 ">" 开头（且无 chip）时，进入子任务建议模式：仅刷新下拉，不重载主列表
        this.searchInput.addEventListener('input', () => {
            this.updateSearchClearButton();
            if (this.isSubtaskSuggestMode(this.searchInput.value)) {
                this.scheduleSubtaskSuggestions(250);
            } else {
                this.hideSubtaskSuggestions();
                this.scheduleSearch(300);
            }
        });
        this.searchInput.addEventListener('change', () => this.updateSearchClearButton());

        // 失焦时延时关闭下拉（延时以允许点击命中建议项）
        this.searchInput.addEventListener('blur', () => {
            setTimeout(() => this.hideSubtaskSuggestions(), 150);
        });

        // 点击 wrapper 空白区域时聚焦输入框
        this.searchTagWrapper.addEventListener('click', (e) => {
            if (e.target === this.searchInput) return;
            if (e.target.classList && e.target.classList.contains('search-chip-remove')) return;
            this.searchInput.focus();
        });

        // 初始渲染（空）
        this.renderSearchChips();
    }

    // 处理搜索输入框的键盘事件
    handleSearchKeydown(e) {
        const searchInput = e.target;
        const val = searchInput.value;
        const tagPattern = /^#[\u4e00-\u9fa5a-zA-Z0-9_]+$/;

        // 子任务建议下拉的键盘交互（仅当处于 ">" 模式且下拉有项时）
        if (this.isSubtaskSuggestMode(val) && this._subtaskSuggestItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._subtaskSuggestIndex = (this._subtaskSuggestIndex + 1) % this._subtaskSuggestItems.length;
                this._highlightSubtaskSuggestion();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._subtaskSuggestIndex = (this._subtaskSuggestIndex - 1 + this._subtaskSuggestItems.length) % this._subtaskSuggestItems.length;
                this._highlightSubtaskSuggestion();
                return;
            }
            if (e.key === 'Enter' && this._subtaskSuggestIndex >= 0) {
                const item = this._subtaskSuggestItems[this._subtaskSuggestIndex];
                if (item) {
                    e.preventDefault();
                    this.selectSubtaskSuggestion(item.title);
                    return;
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hideSubtaskSuggestions();
                return;
            }
        }

        // 空格：若当前输入是一个完整的 #标签，则提交为 chip
        if ((e.key === ' ' || e.code === 'Space') && tagPattern.test(val)) {
            e.preventDefault();
            this.addSearchChip({ type: 'tag', value: val.substring(1) });
            searchInput.value = '';
            this.syncSearchQuery(0);
            return;
        }

        // 退格：输入框为空时删除最后一个 chip
        if (e.key === 'Backspace' && val === '' && this.searchChips.length > 0) {
            e.preventDefault();
            this.removeSearchChip(this.searchChips.length - 1);
            this.syncSearchQuery(0);
            return;
        }

        // 回车：提交 #标签（若是），并触发搜索
        if (e.key === 'Enter') {
            e.preventDefault();
            if (tagPattern.test(val)) {
                this.addSearchChip({ type: 'tag', value: val.substring(1) });
                searchInput.value = '';
            }
            this.hideSubtaskSuggestions();
            this.syncSearchQuery(0);
            return;
        }
    }

    // 若输入框内容是完整的 #标签，提交为 chip（用于搜索按钮点击）
    commitInputAsChipIfTag() {
        const val = this.searchInput.value.trim();
        if (/^#[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(val)) {
            this.addSearchChip({ type: 'tag', value: val.substring(1) });
            this.searchInput.value = '';
        }
    }

    // 创建一个 chip DOM 元素
    createChipElement(chip) {
        const el = document.createElement('span');
        el.className = 'search-chip';
        const label = chip.type === 'tag' ? '#' + chip.value : chip.value;
        el.innerHTML = `
            <span class="search-chip-label"></span>
            <span class="search-chip-remove" title="移除">×</span>
        `;
        el.querySelector('.search-chip-label').textContent = label;
        el.querySelector('.search-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = this.searchChips.indexOf(chip);
            if (idx !== -1) {
                this.removeSearchChip(idx);
                this.syncSearchQuery(0);
            }
        });
        return el;
    }

    // 渲染所有 chips（插入到输入框之前）
    renderSearchChips() {
        // 清除旧 chips
        this.searchTagWrapper.querySelectorAll('.search-chip').forEach(el => el.remove());
        // 在输入框前依次插入
        this.searchChips.forEach(chip => {
            this.searchTagWrapper.insertBefore(this.createChipElement(chip), this.searchInput);
        });
    }

    // 添加一个 chip（自动按名称匹配已有标签以补全 tagId/color，去重）
    addSearchChip(chip) {
        if (!chip || !chip.value) return false;
        // 标签类型：若没有 tagId，尝试按名称匹配已加载的标签
        if (chip.type === 'tag' && !chip.tagId) {
            const match = this.availableTags.find(t => t.name.toLowerCase() === chip.value.toLowerCase());
            if (match) {
                chip.tagId = match.id;
                chip.color = chip.color || match.color;
            }
        }
        // 去重（按类型 + 值，忽略大小写）
        const exists = this.searchChips.some(c =>
            c.type === chip.type && c.value.toLowerCase() === chip.value.toLowerCase());
        if (exists) return false;
        this.searchChips.push(chip);
        this.renderSearchChips();
        return true;
    }

    // 移除指定索引的 chip
    removeSearchChip(index) {
        if (index < 0 || index >= this.searchChips.length) return false;
        this.searchChips.splice(index, 1);
        this.renderSearchChips();
        return true;
    }

    // 按 tagId 移除 chip（用于标签模块取消选择）
    removeSearchChipByTagId(tagId) {
        const idx = this.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (idx !== -1) {
            this.removeSearchChip(idx);
            return true;
        }
        return false;
    }

    // 切换左侧标签的 chip 选择状态
    toggleTagChip(tagId) {
        const tag = this.availableTags.find(t => t.id === tagId);
        if (!tag) return;
        const existing = this.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (existing !== -1) {
            this.removeSearchChip(existing);
        } else {
            this.addSearchChip({ type: 'tag', value: tag.name, tagId: tag.id, color: tag.color });
        }
        this.syncSearchQuery(0);
    }

    // 将 chips + 输入框文本转换为后端支持的搜索字符串
    // 后端约定：关键词以 ";" 分隔；#前缀表示标签搜索，其余为普通文本搜索；
    // 特殊：当无 chip 且输入以 ">" 开头时，按子任务搜索原样透传。
    buildSearchQuery() {
        const text = this.searchInput ? this.searchInput.value.trim() : '';
        if (this.searchChips.length === 0 && text.startsWith('>')) {
            return text;
        }
        const parts = this.searchChips.map(c => c.type === 'tag' ? '#' + c.value : c.value);
        if (text) parts.push(text);
        return parts.join(';');
    }

    // 同步 searchQuery、清空按钮、标签模块选中态，并触发搜索
    syncSearchQuery(delay = 0) {
        this.searchQuery = this.buildSearchQuery();
        this.updateSearchClearButton();
        this.refreshTagModuleSelection();
        this.scheduleSearch(delay);
    }

    // 统计视图处于前台时，让统计按当前筛选（分类 + 左侧点选的标签 chips）刷新。
    // 仅刷新统计数据，不改变统计视图已选的时间范围/周期。
    _syncStatsFilterIfVisible() {
        const cm = window.calendarManager;
        if (cm && cm.currentView === 'stats' && window.statsManager) {
            window.statsManager.reloadStatsIfVisible();
        }
    }

    // 防抖触发搜索任务加载
    scheduleSearch(delay = 300) {
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(async () => {
            this._searchDebounceTimer = null;
            this.searchQuery = this.buildSearchQuery();
            this.currentPage = 1;
            this.customDateFilter = null; // 清除自定义日期筛选
            this.resetInfiniteScroll(); // 重置无限下拉状态
            await this.loadTasks();
        }, delay);
    }

    // ===== 子任务搜索建议下拉（输入 ">" 触发） =====
    // 判断当前是否处于子任务建议模式：无 chip 且输入以 ">" 开头
    // 与 buildSearchQuery 的 ">" 透传条件保持一致
    isSubtaskSuggestMode(value) {
        const v = (value || '').trim();
        return this.searchChips.length === 0 && v.startsWith('>');
    }

    // 防抖拉取「有子任务的父任务」建议
    // 调用后端前，自动将搜索内容 ">" 转换为后端支持的关键字（剥离 ">" 前缀并 trim）
    scheduleSubtaskSuggestions(delay = 250) {
        if (this._subtaskSuggestTimer) clearTimeout(this._subtaskSuggestTimer);
        this._subtaskSuggestTimer = setTimeout(async () => {
            this._subtaskSuggestTimer = null;
            // 防抖期间状态可能变化，再次确认仍处于 ">" 模式
            if (!this.isSubtaskSuggestMode(this.searchInput.value)) {
                this.hideSubtaskSuggestions();
                return;
            }
            // 转换：剥离 ">" 前缀并 trim，得到后端支持的关键字
            const keyword = this.searchInput.value.trim().substring(1).trim();
            await Utils.apiCall({
                apiMethod: 'search_tasks_with_subtasks',
                apiArgs: [keyword, 5],
                onSuccess: (response) => this.renderSubtaskSuggestions(response.data || []),
                onError: () => this.hideSubtaskSuggestions()
            });
        }, delay);
    }

    // 渲染建议下拉（至多 5 条）
    renderSubtaskSuggestions(tasks) {
        let dropdown = document.getElementById('subtask-suggestions');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'subtask-suggestions';
            dropdown.className = 'subtask-suggestions';
            this.searchTagWrapper.appendChild(dropdown);
        }
        dropdown.innerHTML = '';
        this._subtaskSuggestItems = (tasks || []).slice(0, 5);
        this._subtaskSuggestIndex = -1;

        if (this._subtaskSuggestItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'subtask-suggestion-empty';
            empty.textContent = window.languageManager
                ? window.languageManager.getText('subtaskSuggestEmpty', '无匹配的父任务')
                : '无匹配的父任务';
            dropdown.appendChild(empty);
            dropdown.classList.add('visible');
            return;
        }

        const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢', none: '⚪' };
        const unitText = window.languageManager
            ? window.languageManager.getText('subtaskUnit', '子任务')
            : '子任务';
        this._subtaskSuggestItems.forEach((task, idx) => {
            const item = document.createElement('div');
            item.className = 'subtask-suggestion-item';
            item.dataset.index = String(idx);

            const titleEl = document.createElement('span');
            titleEl.className = 'subtask-suggestion-title';
            const emoji = priorityEmoji[task.priority] || '⚪';
            titleEl.textContent = `${emoji} ${task.title}`;

            const countEl = document.createElement('span');
            countEl.className = 'subtask-suggestion-count';
            countEl.textContent = `${task.subtaskCount} ${unitText}`;

            // mousedown 阻止默认行为，防止输入框失焦导致下拉先被关闭
            item.addEventListener('mousedown', (e) => e.preventDefault());
            item.addEventListener('click', () => this.selectSubtaskSuggestion(task.title));

            item.appendChild(titleEl);
            item.appendChild(countEl);
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
    }

    // 高亮当前选中的建议项并滚动到可见
    _highlightSubtaskSuggestion() {
        const items = this.dropdown.querySelectorAll('.subtask-suggestion-item');
        items.forEach((el, i) => el.classList.toggle('active', i === this._subtaskSuggestIndex));
        const active = this.dropdown.querySelector('.subtask-suggestion-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    // 选中某条建议：填充 ">+精确标题" 并触发现有子任务搜索流程
    selectSubtaskSuggestion(title) {
        this.searchInput.value = '>' + title;
        this.hideSubtaskSuggestions();
        this.syncSearchQuery(0);
    }

    // 隐藏建议下拉并清理状态
    hideSubtaskSuggestions() {
        if (this._subtaskSuggestTimer) {
            clearTimeout(this._subtaskSuggestTimer);
            this._subtaskSuggestTimer = null;
        }
        this.dropdown?.classList.remove('visible');
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
    }

    // 根据当前 chips 刷新左侧标签模块的选中态（仅切换 selected 类，不整体重渲染）
    refreshTagModuleSelection() {
        const selectedIds = this.searchChips
            .filter(c => c.type === 'tag' && c.tagId)
            .map(c => c.tagId);
        document.querySelectorAll('.tag-module-item').forEach(item => {
            const id = item.dataset.tagId;
            item.classList.toggle('selected', selectedIds.includes(id));
        });
    }

    // 清空搜索
    async clearSearch() {
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        this.hideSubtaskSuggestions();
        this.searchChips = [];
        this.renderSearchChips();
        this.searchInput.value = '';
        this.searchQuery = '';
        this.currentPage = 1;
        this.customDateFilter = null;
        this.resetInfiniteScroll(); // 重置无限下拉状态
        this.refreshTagModuleSelection();
        await this.loadTasks();
        this.updateSearchClearButton();
    }

    // 更新搜索清空按钮状态
    updateSearchClearButton() {
        const hasText = this.searchInput.value.trim().length > 0;
        const hasChips = this.searchChips.length > 0;
        if (hasText || hasChips) {
            this.searchClearBtn.classList.add('visible');
        } else {
            this.searchClearBtn.classList.remove('visible');
        }
    }

    // 判断是否为移动端或小屏幕
    isMobileDevice() {
        return window.innerWidth <= 480;
    }

    // 初始化无限下拉功能
    initInfiniteScroll() {
        // 移除已存在的监听器
        if (this.scrollListener) {
            this.tasksContainer.removeEventListener('scroll', this.scrollListener);
            this.scrollListener = null;
        }

        // 只在移动端启用无限下拉
        if (!this.isMobileDevice()) return;

        // 添加滚动监听器
        this.scrollListener = async () => {
            if (this.isLoadingMore || !this.hasMoreTasks) return;

            const scrollPosition = this.tasksContainer.scrollTop + this.tasksContainer.clientHeight;
            const scrollHeight = this.tasksContainer.scrollHeight;

            // 当滚动位置距离底部小于阈值时，加载更多
            if (scrollPosition >= scrollHeight - this.scrollThreshold) await this.loadMoreTasks();
        };

        this.tasksContainer.addEventListener('scroll', this.scrollListener, { passive: true });
        logger.info('Infinite scroll listener attached');

        // 检查是否需要自动加载更多（内容不足以滚动时）
        setTimeout(() => this.checkAndLoadMoreIfNeeded(), 100);
    }

    // 检查是否需要自动加载更多任务
    checkAndLoadMoreIfNeeded() {
        if (!this.isMobileDevice() || this.isLoadingMore || !this.hasMoreTasks) return;

        const scrollHeight = this.tasksContainer.scrollHeight;
        const clientHeight = this.tasksContainer.clientHeight;

        logger.info('Checking if need to load more - scrollHeight:', scrollHeight, 'clientHeight:', clientHeight, 'currentPage:', this.currentPage, 'totalPages:', this.totalPages);

        // 如果内容高度小于等于容器高度，说明所有任务都在可视范围内，需要加载更多
        // 同时确保还有更多页面可加载
        if (scrollHeight <= clientHeight && this.currentPage < this.totalPages) {
            logger.info('Content fits in viewport, auto-loading more tasks');
            this.loadMoreTasks().then(() => {
                // 加载完成后再次检查,直到内容超过容器高度
                setTimeout(() => this.checkAndLoadMoreIfNeeded(), 100);
            });
        }
    }

    // 加载更多任务（无限下拉）
    async loadMoreTasks() {
        if (this.isLoadingMore || !this.hasMoreTasks) return;

        // 如果已经是最后一页，不再加载
        if (this.currentPage >= this.totalPages) {
            this.hasMoreTasks = false;
            this.showNoMoreTasks();
            return;
        }

        this.isLoadingMore = true;
        this.showLoadingMore();
        const nextPage = this.currentPage + 1;
        await Utils.apiCall({
            apiMethod: 'get_todos',
            apiArgs: [
                nextPage,
                this.pageSize,
                this.currentFilter === 'all' ? null : this.currentFilter,
                this.statusFilter === 'all' ? null : this.statusFilter,
                this.priorityFilter === 'all' ? null : this.priorityFilter,
                this.dueDateFilter === 'all' ? null : this.dueDateFilter,
                null,
                null,
                this.searchQuery || null,
                this.customDateFilter || null
            ],
            onSuccess: (response) => {
                if (response.data.tasks.length > 0) {
                    // 将新任务追加到现有任务列表
                    this.tasks = [...this.tasks, ...response.data.tasks];
                    this.currentPage = nextPage;
                    // 渲染新增的任务
                    this.appendTasks(response.data.tasks);
                    // 检查是否还有更多任务
                    this.hasMoreTasks = this.currentPage < this.totalPages;
                    // 如果是最后一页，显示到底提示
                    if (!this.hasMoreTasks) this.showNoMoreTasks();
                } else {
                    this.hasMoreTasks = false;
                    this.showNoMoreTasks();
                }
            },
            onError: (error) => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            },
            onFinally: () => {
                this.isLoadingMore = false;
                this.loadingMoreTask?.remove();
            }
        });
    }

    // 追加任务到列表
    appendTasks(newTasks) {
        // 生成新任务的HTML并追加到列表
        const tasksHtml = newTasks.map(task => this.createTaskElement(task)).join('');
        this.tasksList.insertAdjacentHTML('beforeend', tasksHtml);

        // 绑定新增任务的事件
        this.bindTaskEvents();
    }

    // 显示"加载更多"指示器
    showLoadingMore() {
        const loadingMoreDiv = document.createElement('div');
        loadingMoreDiv.id = 'loading-more';
        loadingMoreDiv.className = 'loading-more';
        loadingMoreDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        `;
        this.tasksList.appendChild(loadingMoreDiv);
    }

    // 显示"已经到底了"提示
    showNoMoreTasks() {
        const noMoreDiv = document.createElement('div');
        noMoreDiv.id = 'no-more-tasks';
        noMoreDiv.className = 'no-more-tasks';
        noMoreDiv.innerHTML = `
            <span class="no-more-text">- 已经到底了 -</span>
        `;
        this.tasksList.appendChild(noMoreDiv);
    }

    // 重置无限下拉状态
    resetInfiniteScroll() {
        this.isLoadingMore = false;
        this.hasMoreTasks = true;
        this.currentPage = 1;
        this.noMoreTask?.remove();
        this.loadingMoreTask?.remove();
        this.loadTasks();
    }

    // 处理窗口大小变化
    handleResize() {
        const isLargeScreen = window.innerWidth > 480;

        if (isLargeScreen) {
            // 切换到大屏幕：使用分页模式，每页10条
            logger.info('Switching to large screen mode');

            // 设置列表为表格布局
            this.tasksList.style.display = 'table';

            // 移除无限下拉
            if (this.scrollListener) {
                this.tasksContainer.removeEventListener('scroll', this.scrollListener);
                this.scrollListener = null;
            }

            // 显示分页
            this.pagination.style.display = 'flex';

            // 如果当前页不是第一页，重置到第一页
            if (this.currentPage > 1) {
                this.currentPage = 1;
                this.loadTasks();
            } else {
                this.renderTasks();
                this.renderPagination();
            }
        } else {
            // 切换到小屏幕：使用无限下拉模式
            logger.info('Switching to small screen mode');

            // 设置列表为flex布局
            this.tasksList.style.display = 'flex';

            if (this.currentPage > 1) {
                this.currentPage = 1;
                this.loadTasks();
            } else {
                this.renderTasks();
            }

            // 隐藏分页
            this.pagination.style.display = 'none';

            // 初始化无限下拉
            this.initInfiniteScroll();
        }
    }

    // 解析标签
    parseTags(text) {
        if (!text) return [];
        // 匹配 #标签名 格式，标签名可以是中文、英文、数字、下划线
        const pattern = /#([\u4e00-\u9fa5a-zA-Z0-9_]+)/g;
        const matches = text.match(pattern);
        if (!matches) return [];
        // 提取标签名称（移除 # 符号）
        return matches.map(tag => tag.substring(1)).filter(tag => tag.length > 0);
    }

    // 加载标签选择器
    async loadTagsSelector() {
        await Utils.apiCall({
            apiMethod: 'get_all_tags',
            onSuccess: (response) => {
                this.availableTags = response.data;
                this.renderTagsSelector();
            }
        });
    }

    // 渲染标签选择器
    renderTagsSelector() {
        let html = '';

        // 渲染现有标签
        this.availableTags.forEach(tag => {
            const isSelected = this.selectedTags.includes(tag.id);
            const count = tag.taskCount || 0;

            html += `
                <span class="tag-selector-item ${isSelected ? 'selected' : ''}"
                      data-tag-id="${tag.id}"
                      style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                    <span class="tag-count">${count}</span>
                    ${count === 0 ? '<span class="tag-delete" data-action="delete-tag">×</span>' : ''}
                </span>
            `;
        });

        // 添加"新增标签"按钮
        html += `
            <span class="tag-add-btn" id="add-tag-btn">
                + ${window.languageManager.getText('taskTag', '标签')}
            </span>
        `;

        this.tagSelector.innerHTML = html;

        // 绑定事件
        this.bindTagsSelectorEvents();
    }

    // 绑定标签选择器事件
    bindTagsSelectorEvents() {
        // 标签点击事件（选择/取消选择）
        this.tagSelector.querySelectorAll('.tag-selector-item').forEach(item => {
            item.onclick = (e) => {
                // 如果点击的是删除按钮，不触发选择
                if (e.target.classList.contains('tag-delete')) {
                    e.stopPropagation();
                    return;
                }

                const tagId = item.dataset.tagId;
                this.toggleTagSelection(tagId);
            };

            // 删除标签事件
            const deleteBtn = item.querySelector('.tag-delete');
            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();
                    const tagId = item.dataset.tagId;
                    this.deleteTag(tagId);
                };
            }
        });

        // 新增标签按钮点击事件
        const addBtn = document.getElementById('add-tag-btn');
        if (addBtn) addBtn.onclick = () => this.showAddTagInput();
    }

    // 切换标签选择状态
    toggleTagSelection(tagId) {
        const index = this.selectedTags.indexOf(tagId);
        if (index === -1) {
            this.selectedTags.push(tagId);
        } else {
            this.selectedTags.splice(index, 1);
        }
        this.renderTagsSelector();
    }

    // 删除标签（tagName 用于展示更明确的确认文案）
    async deleteTag(tagId, tagName = null) {
        const tag = this.availableTags.find(t => t.id === tagId);
        const name = tagName || (tag && tag.name) || '';
        Utils.confirmDialog(
            name ? `确定要删除标签“${name}”吗？` : '确定要删除这个标签吗？',
            async () => {
                await Utils.apiCall({
                    apiMethod: 'delete_tag',
                    apiArgs: [tagId],
                    onSuccess: (response) => {
                        Utils.showToast(window.languageManager.getText('taskTagDeleted', '标签删除成功'), 'success');
                        // 从已选标签中移除
                        const index = this.selectedTags.indexOf(tagId);
                        if (index !== -1) this.selectedTags.splice(index, 1);
                        // 若该标签在搜索选中态中，同步移除
                        this.removeSearchChipByTagId(tagId);
                        // 重新加载标签
                        this.loadTagsSelector();
                        this.loadTagsModule(true);
                    },
                    onError: (error) => {
                        Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                    }
                });
            }
        );
    }

    generateRandomId() {
        // 时间戳确保唯一性，随机数增加安全性
        return `new-tag-input-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // 显示新增标签输入框
    showAddTagInput() {
        const addBtn = document.getElementById('add-tag-btn');
        if (!addBtn) return;

        // 生成当前counter值对应的ID
        const currentId = this.generateRandomId();

        const inputHtml = `
            <span class="tag-input-mode" id="tag-input-mode">
                <input type="text" id="${currentId}" placeholder="标签名" maxlength="20">
                <button class="btn btn--colorless" id="cancel-add-tag">×</button>
            </span>
        `;

        addBtn.replaceWith(document.createElement('span'));
        const inputContainer = document.getElementById('tag-input-mode');
        if (inputContainer) {
            inputContainer.outerHTML = inputHtml;
        } else {
            this.tagSelector.insertAdjacentHTML('beforeend', inputHtml);
        }

        // 绑定事件
        const input = document.getElementById(currentId);
        const cancelBtn = document.getElementById('cancel-add-tag');

        input.focus();
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                await this.addNewTag(input.value.trim());
            } else if (e.key === 'Escape') {
                this.renderTagsSelector();
            }
        });

        if (cancelBtn) cancelBtn.onclick = () => this.renderTagsSelector();
    }

    // 添加新标签
    async addNewTag(tagName) {
        if (!tagName) {
            Utils.showToast(window.languageManager.getText('errorTagNameRequired', '请输入标签名'), 'warning');
            return;
        }

        // 检查标签是否已存在
        if (this.availableTags.some(tag => tag.name === tagName)) {
            Utils.showToast(window.languageManager.getText('errorTagExisted', '标签已存在'), 'warning');
            return;
        }

        // 添加到已选标签
        const newTag = {
            id: 'new-' + Date.now(),
            name: tagName,
            color: '#6c757d',
            taskCount: 0
        };
        this.availableTags.push(newTag);
        this.selectedTags.push(newTag.id);

        this.renderTagsSelector();
    }

    // 获取已选标签的名称列表
    getSelectedTagsNames() {
        return this.availableTags
            .filter(tag => this.selectedTags.includes(tag.id))
            .map(tag => tag.name);
    }

    // 加载标签管理模块数据
    async loadTagsModule(fromZero = false) {
        await Utils.apiCall({
            apiMethod: 'get_all_tags',
            onSuccess: (response) => {
                this.availableTags = response.data;
                const shouldDisable = this.availableTags.length <= this.defaultShowTags;

                // 批量设置两个按钮的状态
                [this.showMoreTags, this.showLessTags].forEach(btn => {
                    btn.disabled = shouldDisable;
                    btn.style.pointerEvents = 'auto';
                    btn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
                });

                this.renderTagsModule(fromZero);
            }
        });
    }

    // 渲染标签管理模块
    // 选中态以搜索 chips 为唯一数据源（type 为 'tag' 的 chip）
    renderTagsModule(fromZero = false) {
        if (this.availableTags.length <= 0) {
            this.tagsSection.style.display = 'none';
            return;
        }
        this.tagsSection.style.display = 'block';

        const selectedTagIds = this.searchChips
            .filter(c => c.type === 'tag' && c.tagId)
            .map(c => c.tagId);

        let html = '';

        // 渲染现有标签
        this.availableTags.forEach((tag, index) => {
            if (!this.isShowMoreTags && index >= this.defaultShowTags) {
                // 在判断条件是不展开全部标签情况下，超过限定数量的标签不展示
                this.showMoreTags.style.display = 'none';
                this.showLessTags.style.display = 'block';
                return;
            }
            this.showMoreTags.style.display = 'block';
            this.showLessTags.style.display = 'none';
            const isSelected = selectedTagIds.includes(tag.id);
            const count = tag.taskCount || 0;
            // 标签存在引用（count>0）时可编辑名称；无引用（count=0）时可删除
            const action = count > 0
                ? { type: 'edit', icon: '✏️', title: '编辑标签' }
                : { type: 'delete', icon: '🗑️', title: '删除标签' };

            html += `
                <span class="tag-module-item ${isSelected ? 'selected' : ''}"
                      data-tag-id="${tag.id}"
                      style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                    <span id="${tag.id}" class="tag-count">${count}</span>
                    <span class="tag-action-icon" data-tag-action="${action.type}"
                          title="${action.title}">${action.icon}</span>
                </span>
            `;
        });

        this.tagsList.innerHTML = html;

        // 搜索内容的变更由 chips 相关方法负责，这里只负责渲染标签列表与事件绑定
        this.bindTagModuleEvents(this.tagsList);

        if (fromZero) this._tagPendingFromZero = true;

        if (this._statsTagDebounceTimer) {
            clearTimeout(this._statsTagDebounceTimer);
        }

        this._statsTagDebounceTimer = setTimeout(async () => {
            const shouldFromZero = this._tagPendingFromZero;
            this._tagPendingFromZero = false;
            this._statsTagDebounceTimer = null;

            this.availableTags.forEach((tag, index) => {
                const countEl = document.getElementById(tag.id);
                const count = tag.taskCount || 0;
                if (countEl) {
                    Utils.animateNumber(countEl, count, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                }
            });
        }, 200);
    }

    // 标签管理模块绑定事件：
    // 点击标签本体切换对应的搜索 chip；悬浮操作图标用于编辑/删除标签
    bindTagModuleEvents(tagsList) {
        tagsList.querySelectorAll('.tag-module-item').forEach(item => {
            // 悬浮在标签上的编辑/删除图标
            const actionEl = item.querySelector('.tag-action-icon');
            if (actionEl) {
                actionEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tagId = item.dataset.tagId;
                    const tag = this.availableTags.find(t => t.id === tagId);
                    if (!tag) return;
                    if (actionEl.dataset.tagAction === 'delete') {
                        // 无引用标签：删除前弹窗确认，避免误操作
                        this.deleteTag(tagId, tag.name);
                    } else if (actionEl.dataset.tagAction === 'edit') {
                        // 有引用标签：内联编辑标签名称
                        this.startRenameTag(tagId);
                    }
                });
            }

            // 点击标签本体 -> 切换对应的搜索 chip（点击操作图标时不触发筛选）
            item.addEventListener('click', (e) => {
                if (e.target.closest('.tag-action-icon')) return;
                const tagId = item.dataset.tagId;
                this.toggleTagChip(tagId);
            });
        });
    }

    // 开始内联编辑标签名称
    startRenameTag(tagId) {
        let item = this.tagsList.querySelector(`.tag-module-item[data-tag-id="${tagId}"]`);
        const tag = this.availableTags.find(t => t.id === tagId);
        if (!item || !tag) return;

        // 若已有其他标签正处于编辑状态，先退出恢复原状（重渲染后重新获取目标节点）
        const editing = this.tagsList.querySelector('.tag-module-item.editing');
        if (editing && editing !== item) {
            this.renderTagsModule();
            item = this.tagsList.querySelector(`.tag-module-item[data-tag-id="${tagId}"]`);
            if (!item) return;
        }

        item.classList.add('editing');
        item.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-edit-input';
        input.value = tag.name;
        input.maxLength = 20;
        input.placeholder = '标签名';
        item.appendChild(input);

        let finished = false;
        const finish = (callback) => {
            if (finished) return;
            finished = true;
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            callback();
        };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(() => this.commitTagRename(tagId, input.value.trim()));
            } else if (e.key === 'Escape') {
                finish(() => this.renderTagsModule());
            }
        };
        const handleBlur = () => finish(() => this.renderTagsModule());

        input.addEventListener('keydown', handleKeydown);
        input.addEventListener('blur', handleBlur);
        input.focus();
        input.select();
    }

    // 提交标签重命名
    async commitTagRename(tagId, newName) {
        if (!newName) {
            Utils.showToast(window.languageManager.getText('errorTagNameRequired', '请输入标签名'), 'warning');
            this.renderTagsModule();
            return;
        }

        // 重名校验（排除自身）
        if (this.availableTags.some(t => t.id !== tagId && t.name === newName)) {
            Utils.showToast(window.languageManager.getText('errorTagExisted', '标签已存在'), 'warning');
            this.renderTagsModule();
            return;
        }

        Utils.setLoading(true, '更新中...');
        await Utils.apiCall({
            apiMethod: 'update_tag',
            apiArgs: [tagId, { name: newName }],
            onSuccess: () => {
                Utils.showToast(window.languageManager.getText('tagUpdated', '标签更新成功'), 'success');

                // 同步本地标签名称及搜索 chip 的显示文本
                const localTag = this.availableTags.find(t => t.id === tagId);
                if (localTag) localTag.name = newName;
                let chipRenamed = false;
                this.searchChips.forEach(c => {
                    if (c.type === 'tag' && c.tagId === tagId) {
                        c.value = newName;
                        chipRenamed = true;
                    }
                });

                // 刷新标签列表，并重新加载任务以更新任务中展示的标签名称
                this.loadTagsModule(true);
                if (chipRenamed) {
                    // 有选中该标签：同步搜索条件（含新标签名）后刷新任务
                    this.renderSearchChips();
                    this.syncSearchQuery(0);
                } else {
                    this.loadTasks();
                }
            },
            onError: (error) => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                // 退出编辑态，恢复原标签列表
                this.renderTagsModule();
            },
            onFinally: () => Utils.setLoading(false)
        });
    }

    toggleMoreTags(fromZero = false) {
        this.isShowMoreTags = !this.isShowMoreTags;
        this.showMoreTags.style.display = this.isShowMoreTags ? 'none' : 'block';
        this.showLessTags.style.display = this.isShowMoreTags ? 'block' : 'none';
        this.loadTagsModule(fromZero);
    }
}

// 创建全局实例
window.todoManager = new TodoManager();

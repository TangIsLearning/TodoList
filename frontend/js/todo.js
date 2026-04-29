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
        // 统计维度
        this.statsDimension = 'all'; // all, year, month, week, day
        // 日期范围缓存
        this.currentDateRange = null;
        // 设置日期组件
        this.pikaday = new Pikaday({
            field: document.getElementById('task-due-date-picker'),
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
    
    // 将Date对象转换为本地时间的datetime-local格式字符串
    toDateTimeLocalString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    // 初始化
    async init() {
        this.bindEvents();
        this.bindPaginationEvents();
        
        // 设置默认筛选为"全部"
        this.currentFilter = 'all';
        
        // 初始化搜索清空按钮状态
        this.updateSearchClearButton();
        
        await this.loadTasks();
        
        // 初始化无限下拉功能
        this.initInfiniteScroll();
    }
    
    // 触发云端同步上传
    async triggerCloudUpload() {
        try {
            if (window.pywebview && window.pywebview.api) {
                await window.pywebview.api.trigger_upload_on_change();
            }
        } catch (error) {
            console.error('触发云端上传失败:', error);
        }
    }

    // 绑定事件
    bindEvents() {
        // 统计维度切换
        const dimensionBtns = document.querySelectorAll('.dimension-btn');
        dimensionBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                // 更新选中状态
                dimensionBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新当前维度
                this.statsDimension = btn.dataset.dimension;

                // 重新加载统计数据
                await this.updateStats();
            });
        });

        // 监听窗口大小变化，切换分页/无限下拉模式
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 300);
        });

        // 搜索
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const searchClearBtn = document.getElementById('search-clear-btn');
        
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce(async () => {
                this.searchQuery = searchInput.value.trim();
                this.currentPage = 1; // 重置到第一页
                this.customDateFilter = null; // 清除自定义日期筛选
                this.resetInfiniteScroll(); // 重置无限下拉状态
                await this.loadTasks();
                // 更新清空按钮显示状态
                this.updateSearchClearButton();
            }, 300));
            
            // 监听输入值变化，实时更新清空按钮
            searchInput.addEventListener('input', () => this.updateSearchClearButton());
            searchInput.addEventListener('change', () => this.updateSearchClearButton());
        }
        
        if (searchBtn) {
            searchBtn.addEventListener('click', async () => {
                this.searchQuery = searchInput.value.trim();
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                this.resetInfiniteScroll(); // 重置无限下拉状态
                await this.loadTasks();
            });
        }
        
        // 清空搜索按钮
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', () => this.clearSearch());
        }
        
        // 筛选器
        const priorityFilter = document.getElementById('priority-filter');
        const statusFilter = document.getElementById('status-filter');
        const dueDateFilter = document.getElementById('due-date-filter');
        
        if (priorityFilter) {
            priorityFilter.addEventListener('change', async (e) => {
                this.priorityFilter = e.target.value;
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                this.resetInfiniteScroll(); // 重置无限下拉状态
                await this.loadTasks();
            });
        }
        
        if (statusFilter) {
            statusFilter.addEventListener('change', async (e) => {
                this.statusFilter = e.target.value;
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                this.resetInfiniteScroll(); // 重置无限下拉状态
                await this.loadTasks();
            });
        }
        
        if (dueDateFilter) {
            dueDateFilter.addEventListener('change', async (e) => {
                this.dueDateFilter = e.target.value;
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                this.resetInfiniteScroll(); // 重置无限下拉状态
                await this.loadTasks();
            });
        }
        
        // 添加任务按钮(桌面端)
        const addTaskBtn = document.getElementById('add-task-btn');
        if (addTaskBtn) {
            addTaskBtn.addEventListener('click', () => this.showAddTaskModal());
        }

        // 添加任务悬浮按钮(移动端)
        const addTaskFab = document.getElementById('add-task-fab');
        if (addTaskFab) {
            addTaskFab.addEventListener('click', () => this.showAddTaskModal());
        }
        
        // 任务表单
        const taskForm = document.getElementById('task-form');
        if (taskForm) {
            taskForm.addEventListener('submit', (e) => this.handleTaskSubmit(e));
        }
        
        // 模态框关闭按钮
        const modalClose = document.getElementById('modal-close');
        const cancelBtn = document.getElementById('cancel-btn');
        
        if (modalClose) {
            modalClose.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));
        }
        
        // 更多选项展开/收起按钮
        const moreOptionsToggle = document.getElementById('more-options-toggle');
        if (moreOptionsToggle) {
            moreOptionsToggle.addEventListener('click', () => this.toggleMoreOptions());
        }
        
        // 周期性任务复选框
        const isRecurringCheckbox = document.getElementById('is-recurring');
        if (isRecurringCheckbox) {
            isRecurringCheckbox.addEventListener('change', (e) => this.toggleRecurringOptions());
        }
        
        // 日期时间清空按钮
        const clearDateBtn = document.querySelector('.clear-date');
        const clearTimeBtn = document.querySelector('.clear-time');
        
        if (clearDateBtn) {
            clearDateBtn.addEventListener('click', () => {
                this.clearDateInput();
                this.addInputValueListeners();
            });
        }
        
        if (clearTimeBtn) {
            clearTimeBtn.addEventListener('click', () => {
                this.clearTimeInput();
                this.addInputValueListeners();
            });
        }
    }
    
    // 展开/收起更多选项
    toggleMoreOptions() {
        const moreOptionsContent = document.getElementById('more-options-content');
        const moreOptionsToggle = document.getElementById('more-options-toggle');
        const toggleIcon = moreOptionsToggle.querySelector('.toggle-icon');
        
        if (moreOptionsContent.style.display === 'none' || moreOptionsContent.style.display === '') {
            moreOptionsContent.style.display = 'block';
            moreOptionsToggle.classList.add('expanded');
            toggleIcon.textContent = '-';
        } else {
            moreOptionsContent.style.display = 'none';
            moreOptionsToggle.classList.remove('expanded');
            toggleIcon.textContent = '+';
        }
    }
    
    // 重置更多选项状态
    resetMoreOptions() {
        const moreOptionsContent = document.getElementById('more-options-content');
        const moreOptionsToggle = document.getElementById('more-options-toggle');
        const toggleIcon = moreOptionsToggle.querySelector('.toggle-icon');
        
        if (moreOptionsContent && moreOptionsToggle && toggleIcon) {
            moreOptionsContent.style.display = 'none';
            moreOptionsToggle.classList.remove('expanded');
            toggleIcon.textContent = '+';
        }
        
        // 重置周期性任务选项
        const isRecurringCheckbox = document.getElementById('is-recurring');
        const recurringOptions = document.getElementById('recurring-options');
        const recurrenceCount = document.getElementById('recurrence-count');
        const recurrenceType = document.getElementById('recurrence-type');

        if (isRecurringCheckbox && recurringOptions) {
            isRecurringCheckbox.checked = false;
            recurringOptions.style.display = 'none';
        }

        // 重置循环次数的必填状态
        if (recurrenceCount) {
            recurrenceCount.required = false;
            recurrenceCount.value = '';
            recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
        }
        if (recurrenceType) {
            recurrenceType.value = '';
        }
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
                const recurringOptions = document.getElementById('recurring-options');
                if (recurringOptions) {
                    recurringSection.insertBefore(notice, recurringOptions);
                }
            }
        }
    }
    
    // 移除编辑模式提示
    removeRecurringEditNotice() {
        const notice = document.querySelector('.edit-notice');
        if (notice) {
            notice.remove();
        }
    }
    
    // 展开/收起周期性任务选项
    toggleRecurringOptions() {
        const isRecurringCheckbox = document.getElementById('is-recurring');
        const recurringOptions = document.getElementById('recurring-options');
        const recurrenceCount = document.getElementById('recurrence-count');
        const recurrenceType = document.getElementById('recurrence-type');

        if (isRecurringCheckbox.checked) {
            recurringOptions.style.display = 'block';
            // 勾选周期性任务时，设置循环次数为必填
            if (recurrenceCount) {
                recurrenceCount.required = true;

            }
        } else {
            recurringOptions.style.display = 'none';
            // 取消勾选时，移除必填限制
            if (recurrenceCount) {
                recurrenceCount.required = false;
            }
        }
        recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
    }
    
    // 清空日期输入
    clearDateInput() {
        const datePicker = document.getElementById('task-due-date-picker');
        const clearBtn = document.querySelector('.clear-date');
        
        if (datePicker) {
            datePicker.value = '';
            
            // 更新清空按钮状态
            if (clearBtn) {
                clearBtn.classList.remove('visible');
            }
        }
    }
    
    // 清空时间输入
    clearTimeInput() {
        const timeInput = document.getElementById('task-due-time');
        const clearBtn = document.querySelector('.clear-time');
        
        if (timeInput) {
            timeInput.value = '';
            
            // 更新清空按钮状态
            if (clearBtn) {
                clearBtn.classList.remove('visible');
            }
        }
    }
    
    // 添加输入值变化监听
    addInputValueListeners() {
        const datePicker = document.getElementById('task-due-date-picker');
        const timeInput = document.getElementById('task-due-time');
        const clearDateBtn = document.querySelector('.clear-date');
        const clearTimeBtn = document.querySelector('.clear-time');
        
        // 实时校验函数
        const validateDateTime = () => {
            const dateStr = datePicker.value || null;
            const timeStr = timeInput.value || null;
            
            // 执行校验
            const validation = BusinessUtils.DateTimeValidator.validateDateTime(dateStr, timeStr);
            
            // 获取或创建错误消息容器
            let errorContainer = document.querySelector('.datetime-error');
            if (!errorContainer) {
                errorContainer = document.createElement('div');
                errorContainer.className = 'datetime-error';
                const datetimeGroup = document.querySelector('.datetime-group');
                if (datetimeGroup) {
                    datetimeGroup.appendChild(errorContainer);
                }
            }
            
            // 显示或隐藏错误消息
            if (!validation.valid) {
                errorContainer.textContent = validation.message;
                errorContainer.style.display = 'block';
                datePicker.style.borderColor = '#e74c3c';
                timeInput.style.borderColor = '#e74c3c';
            } else {
                errorContainer.style.display = 'none';
                datePicker.style.borderColor = '';
                timeInput.style.borderColor = '';
            }
        };
        
        // 监听日期输入变化
        if (datePicker && clearDateBtn) {
            const updateClearDateBtn = async () => {
                if (datePicker.value) {
                    clearDateBtn.classList.add('visible');
                } else {
                    clearDateBtn.classList.remove('visible');
                }
                // 添加日历权限检查
                const hasPermission = localStorage.getItem('calendar_permission') === 'true';
                if (!hasPermission) {
                    await window.pywebview.api.check_calendar_permission();
                    localStorage.setItem('calendar_permission', 'true');
                }
                // 执行实时校验
                validateDateTime();
            };
            
            // 初始状态
            updateClearDateBtn();
            
            // 监听变化
            datePicker.addEventListener('input', updateClearDateBtn);
            datePicker.addEventListener('change', updateClearDateBtn);
        }
        
        // 监听时间输入变化
        if (timeInput && clearTimeBtn) {
            const updateClearTimeBtn = () => {
                if (timeInput.value) {
                    clearTimeBtn.classList.add('visible');
                } else {
                    clearTimeBtn.classList.remove('visible');
                }
                // 执行实时校验
                validateDateTime();
            };
            
            // 初始状态
            updateClearTimeBtn();
            
            // 监听变化
            timeInput.addEventListener('input', updateClearTimeBtn);
            timeInput.addEventListener('change', updateClearTimeBtn);
        }
    }

    // 加载pywebview的todos-api
    async safeGetTodos(...args) {
        // 先等待 pywebview 加载完成
        const isLoaded = await Utils.loadPywebviewApi();

        if (!isLoaded) {
           throw new Error('pywebview加载失败！');
        }

        // pywebview 已加载，正常调用
        return await window.pywebview.api.get_todos(...args);
    }
    
    // 加载任务
    async loadTasks() {
        try {
            Utils.setLoading(true, '加载任务...');

            // 查询数据库
            let response = await this.safeGetTodos(
                this.currentPage,
                this.pageSize,
                this.currentFilter === 'all' ? null : this.currentFilter,
                this.statusFilter === 'all' ? null : this.statusFilter,
                this.priorityFilter === 'all' ? null : this.priorityFilter,
                this.dueDateFilter === 'all' ? null : this.dueDateFilter,
                null,  // year
                null,  // month
                this.searchQuery || null,
                this.customDateFilter || null
            );
            console.log('查询数据库');
            
            if (response.success) {
                this.tasks = response.tasks;
                this.totalTasks = response.total;
                this.totalPages = response.total_pages;

                // 调试信息：检查周期性任务字段
                const recurringTasks = this.tasks.filter(t => t.isRecurring || t.parentTaskId);
                console.log('加载任务完成，周期性任务数量:', recurringTasks.length);
                recurringTasks.forEach(task => {
                    console.log('周期性任务详情:', {
                        id: task.id,
                        title: task.title,
                        isRecurring: task.isRecurring,
                        parentTaskId: task.parentTaskId,
                        recurrenceType: task.recurrenceType
                    });
                });

                // 根据屏幕尺寸决定显示模式
                const isLargeScreen = window.innerWidth > 480;

                if (isLargeScreen) {
                    // 大屏幕(大于480px)：使用表格分页模式，每页10条
                    await this.renderTasks();
                    this.renderPagination();

                    // 隐藏无限下拉相关
                    const loadingMoreEl = document.getElementById('loading-more');
                    const noMoreEl = document.getElementById('no-more-tasks');
                    if (loadingMoreEl) loadingMoreEl.style.display = 'none';
                    if (noMoreEl) noMoreEl.style.display = 'none';
                } else {
                    // 小屏幕：使用无限下拉模式
                    await this.renderTasks();
                    this.initInfiniteScroll();
                }

                await this.updateStats();
                await this.updateCategoryCounts();

                // 更新日历视图数据
                if (window.calendarManager) {
                    window.calendarManager.updateTasks(this.tasks);
                }

                // 同步分类筛选状态
                if (window.categoryManager) {
                    window.categoryManager.setActiveCategory(this.currentFilter);
                }
            } else {
                console.error('加载任务失败:', response.error);
                Utils.showToast(window.languageManager.getText('loadingTaskFailed', '加载任务失败'), 'error');
            }
        } catch (error) {
            console.error('加载任务失败:', error);
            Utils.showToast(window.languageManager.getText('loadingTaskFailed', '加载任务失败'), 'error');
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 渲染任务列表
    async renderTasks() {
        const tasksList = document.getElementById('tasks-list');
        const emptyState = document.getElementById('empty-state');
        const pagination = document.getElementById('pagination');

        if (!tasksList) return;

        console.log('Rendering tasks with filter:', this.currentFilter); // 调试日志
        console.log('Total tasks:', this.tasks.length); // 调试日志

        // 不再需要前端过滤，因为后端已经处理了筛选
        const filteredTasks = this.tasks;
        console.log('Filtered tasks:', filteredTasks.length); // 调试日志

        // 更新日历视图数据
        if (window.calendarManager) {
            window.calendarManager.updateTasks(this.tasks);
        }

        if (filteredTasks.length === 0) {
            tasksList.style.setProperty('display', 'none', 'important');
            emptyState.style.display = 'block';
            // 隐藏分页
            if (pagination) {
                pagination.style.display = 'none';
            }
            return;
        }

        // 根据屏幕尺寸设置display样式 (大于480px使用表格布局)
        const isLargeScreen = window.innerWidth > 480;
        tasksList.style.display = isLargeScreen ? 'table' : 'flex';
        emptyState.style.display = 'none';

        // 不再需要前端排序，后端已排序
        const sortedTasks = filteredTasks;

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

        html += sortedTasks.map(task => this.createTaskElement(task)).join('');
        tasksList.innerHTML = html;

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
                                <h3 class="task-title">
                                    ${Utils.escapeHtml(task.title)}
                                    ${task.isRecurring ? `<span class="recurring-badge">${window.languageManager.getText('recurrenceType', '周期性')}</span>` : ''}
                                    ${task.parentTaskId ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
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
                        <button class="task-action-btn view" data-task-id="${task.id}"
                                title="查看详情">👁️</button>
                        <button class="task-action-btn edit" data-task-id="${task.id}"
                                title="编辑">✏️</button>
                        <button class="task-action-btn delete" data-task-id="${task.id}"
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
                    <button class="task-action-btn view" data-task-id="${task.id}"
                                title="查看">👁️</button>
                    <button class="task-action-btn edit" data-task-id="${task.id}"
                            title="编辑">✏️</button>
                    <button class="task-action-btn delete" data-task-id="${task.id}"
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
        document.querySelectorAll('.task-action-btn.view').forEach(btn => {
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
            if (item._clickHandler) {
                item.removeEventListener('click', item._clickHandler);
            }
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
                if (e.type.startsWith('touch')) {
                    return e.touches[0] ? e.touches[0].clientX : 0;
                }
                return e.clientX;
            };

            // 阻止默认行为的统一函数
            const preventDefault = (e) => {
                if (e.cancelable) {
                    e.preventDefault();
                }
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
                    if (index > -1) {
                        this.instances.splice(index, 1);
                    }

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
                    if (index > -1) {
                        this.instances.splice(index, 1);
                    }
                }

                // 重置拖拽状态
                state.currentX = 0;
                state.currentLeft = 0;

                preventDefault(e);
            };

            // 点击处理函数
            const clickHandler = (e) => {
                // 如果点击的是操作按钮区域或复选框，不处理
                if (e.target.closest('.task-actions') || e.target.closest('.task-checkbox')) {
                    return;
                }

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
        document.querySelectorAll('.task-action-btn.edit').forEach(btn => {
            const taskId = btn.dataset.taskId;
            const task = this.tasks.find(t => t.id === taskId);

            // 调试信息
            console.log(`编辑按钮调试 - 任务ID: ${taskId}`, {
                task: task,
                isRecurring: task?.isRecurring,
                parentTaskId: task?.parentTaskId
            });

            // 如果是周期性任务，禁用编辑按钮并添加点击提示
            if (task && (task.isRecurring || task.parentTaskId)) {
                btn.disabled = true;
                btn.title = `${window.languageManager.getText('recurringTaskEditTip', '周期性任务不支持编辑')}`;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                console.log(`禁用编辑按钮: ${taskId}`);

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
                console.log(`启用编辑按钮: ${taskId}`);

                // 设置编辑功能
                btn.onclick = (e) => {
                    const taskId = e.target.dataset.taskId;
                    this.editTask(taskId);
                };
            }
        });

        // 删除按钮
        document.querySelectorAll('.task-action-btn.delete').forEach(btn => {
            btn.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.deleteTask(taskId);
            };
        });

        // 加载分类名称
        await this.loadCategoryNames();
    }
    
    // 加载分类名称
    async loadCategoryNames() {
        try {
            // 确保pywebview已加载完成
            const isLoaded = await Utils.loadPywebviewApi();
            if (!isLoaded) {
                console.error('pywebview未加载，无法获取分类');
                return;
            }
            
            const response = await window.pywebview.api.get_categories();
            if (response.success) {
                const categories = response.categories;
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
        } catch (error) {
            console.error('加载分类失败:', error);
        }
    }
    
    // 切换任务状态
    async toggleTask(taskId) {
        try {
            const response = await window.pywebview.api.toggle_todo(taskId);
            if (response.success) {
                // 更新本地数据
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    task.completed = response.task.completed;
                    task.updatedAt = response.task.updatedAt;
                    this.renderTasks();
                    await this.updateStats();
                    await this.updateCategoryCounts();
                    
                    // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                    Utils.showToast(task.completed ?
                        window.languageManager.getText('taskCompleted', '任务已完成') :
                        window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                    // 触发云端同步上传
                    await this.triggerCloudUpload();
                }
            } else {
                Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')}: ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
        }
    }
    
    // 显示添加任务模态框
    showAddTaskModal() {
        const modalTitle = document.getElementById('modal-title');
        const taskForm = document.getElementById('task-form');
        
        modalTitle.textContent = '新建任务';
        taskForm.reset();
        taskForm.dataset.editingId = '';
        
        // 重置更多选项状态
        this.resetMoreOptions();
        
        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();
        
        // 移除编辑模式提示（如果存在）
        this.removeRecurringEditNotice();
        
        // 截止日期默认为空，不设置默认值
        document.getElementById('task-due-time').value = '';

        // 重置已选标签
        this.selectedTags = [];

        // 添加输入值变化监听
        this.addInputValueListeners();

        // 获取当前选中的分类ID
        const currentCategory = this.currentFilter && this.currentFilter !== 'all' ? this.currentFilter : '';
        console.log('Setting default category for new task:', currentCategory || 'no category');
        
        // 加载分类选项并设置默认选中
        this.loadCategoryOptions(currentCategory);

        // 加载标签选择器
        this.loadTagsSelector();

        Utils.ModalManager.show('task-modal');
    }
    
    // 查看任务详情
    async viewTaskDetails(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
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

                    <div style="grid-column: 1 / -1;">
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskTags', '标签')}</strong>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${tagsHtml}
                        </div>
                    </div>

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
    }

    // 加载分类名称(用于详情对话框)
    async loadCategoryNameForDetail(categoryId) {
        if (!categoryId) return;

        try {
            const response = await window.pywebview.api.get_categories();
            if (response.success) {
                const categories = response.categories;
                const category = categories.find(cat => cat.id === categoryId);
                const categoryEl = document.querySelector('.task-category-detail');
                if (category && categoryEl) {
                    categoryEl.textContent = category.name;
                }
            }
        } catch (error) {
            console.error('加载分类失败:', error);
        }
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
        
        const modalTitle = document.getElementById('modal-title');
        const taskForm = document.getElementById('task-form');
        
        modalTitle.textContent = '编辑任务';
        taskForm.dataset.editingId = taskId;

        // 重置更多选项状态
        this.resetMoreOptions();
        
        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();
        
        // 移除编辑模式提示（如果存在）
        this.removeRecurringEditNotice();

        // 填充表单
        document.getElementById('task-title').value = task.title;
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-priority').value = task.priority;

        // 设置已选标签
        this.selectedTags = task.tags ? task.tags.map(t => t.id) : [];

        // 如果有截止日期，自动展开更多选项
        if (task.dueDate) {
            const [datePart, timePart] = task.dueDate.split('T');
            document.getElementById('task-due-date-picker').value = datePart;
            document.getElementById('task-due-time').value = timePart;
            
            // 自动展开更多选项
            const moreOptionsContent = document.getElementById('more-options-content');
            const moreOptionsToggle = document.getElementById('more-options-toggle');
            const toggleIcon = moreOptionsToggle.querySelector('.toggle-icon');
            
            if (moreOptionsContent && moreOptionsToggle && toggleIcon) {
                moreOptionsContent.style.display = 'block';
                moreOptionsToggle.classList.add('expanded');
                toggleIcon.textContent = '-';
            }
        }
        
        // 禁用周期性任务选项（编辑模式下不允许转换为周期性任务）
        this.disableRecurringOptions();
        
        // 添加编辑模式提示
        this.addRecurringEditNotice();
        
        // 加载分类选项
        this.loadCategoryOptions(task.categoryId);
        
        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载标签选择器
        this.loadTagsSelector();

        Utils.ModalManager.show('task-modal');
    }
    
    // 禁用周期性任务选项
    disableRecurringOptions() {
        const recurrenceToggle = document.getElementById('recurrence-toggle');
        const isRecurringCheckbox = document.getElementById('is-recurring');
        const recurringOptions = document.getElementById('recurring-options');
        const recurrenceType = document.getElementById('recurrence-type');
        const recurrenceCount = document.getElementById('recurrence-count');

        // 禁用复选框和相关选项
        if (isRecurringCheckbox) {
            isRecurringCheckbox.disabled = true;
            isRecurringCheckbox.checked = false;
            isRecurringCheckbox.title = '编辑模式下不支持创建周期性任务';
            recurrenceToggle.style.display = 'none';
            isRecurringCheckbox.style.display = 'none';
        }
        
        // 隐藏周期性选项区域
        if (recurringOptions) {
            recurringOptions.style.display = 'none';
        }
        
        // 重置相关字段
        if (recurrenceType) {
            recurrenceType.value = '';
            recurrenceType.disabled = true;
        }
        
        if (recurrenceCount) {
            recurrenceCount.value = '';
            recurrenceCount.disabled = true;
        }
    }
    
    // 启用周期性任务选项
    enableRecurringOptions() {
        const recurrenceToggle = document.getElementById('recurrence-toggle');
        const isRecurringCheckbox = document.getElementById('is-recurring');
        const recurrenceType = document.getElementById('recurrence-type');
        const recurrenceCount = document.getElementById('recurrence-count');

        // 启用复选框
        if (isRecurringCheckbox) {
            isRecurringCheckbox.disabled = false;
            isRecurringCheckbox.checked = false;
            isRecurringCheckbox.title = '';
            recurrenceToggle.style.display = 'block';
            isRecurringCheckbox.style.display = 'block';
        }
        
        // 启用其他字段
        if (recurrenceType) {
            recurrenceType.disabled = false;
        }
        
        if (recurrenceCount) {
            recurrenceCount.disabled = false;
        }
        
        // 确保周期性选项区域是隐藏的（默认状态）
        const recurringOptions = document.getElementById('recurring-options');
        if (recurringOptions) {
            recurringOptions.style.display = 'none';
        }
    }
    
    // 加载分类选项
    async loadCategoryOptions(selectedId = '') {
        const categorySelect = document.getElementById('task-category');
        if (!categorySelect) return;
        
        try {
            const response = await window.pywebview.api.get_categories();
            if (response.success) {
                const categories = response.categories;
                
                categorySelect.innerHTML = `<option value="">${window.languageManager.getText('uncategorized', '未分类')}</option>`;
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    option.selected = cat.id === selectedId;
                    categorySelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('加载分类选项失败:', error);
        }
    }
    
    // 处理任务表单提交
    async handleTaskSubmit(e) {
        e.preventDefault();
        
        const taskForm = e.target;
        const editingId = taskForm.dataset.editingId;
        const isEdit = editingId && editingId !== '';

        const dateStr = document.getElementById('task-due-date-picker').value || null;
        const timeStr = document.getElementById('task-due-time').value || null;
        
        // 校验截止时间
        const dateTimeValidation = BusinessUtils.DateTimeValidator.validateDateTime(dateStr, timeStr);
        if (!dateTimeValidation.valid) {
            Utils.showToast(dateTimeValidation.message, 'warning');
            return;
        }
        
        let isoDateStr = null;
        if (dateStr && timeStr) {
            isoDateStr = `${dateStr}T${timeStr}`;
        }

        const taskData = {
            title: document.getElementById('task-title').value.trim(),
            description: document.getElementById('task-description').value.trim(),
            priority: document.getElementById('task-priority').value,
            categoryId: document.getElementById('task-category').value || null,
            dueDate: isoDateStr || null,
            tags: this.getSelectedTagsNames()
        };
        
        // 编辑模式下强制清除周期性任务相关数据
        if (!isEdit) {
            // 只有在新建模式下才允许设置周期性任务
            taskData.isRecurring = document.getElementById('is-recurring').checked;
            taskData.recurrenceType = document.getElementById('recurrence-type').value || null;
            taskData.recurrenceCount = document.getElementById('recurrence-count').value ?
                parseInt(document.getElementById('recurrence-count').value) : null;

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
        
        try {
            Utils.setLoading(true, isEdit ? '保存中...' : '创建中...');
            
            let response;
            if (isEdit) {
                response = await window.pywebview.api.update_todo(editingId, taskData);
            } else {
                // 如果是周期性任务，使用专门的API
                if (taskData.isRecurring) {
                    response = await window.pywebview.api.add_recurring_todo(taskData);
                } else {
                    response = await window.pywebview.api.add_todo(taskData);
                }
            }
            
            if (response.success) {
                const message = isEdit ? window.languageManager.getText('taskUpdated', '任务更新成功') :
                    window.languageManager.getText('taskCreated', '任务创建成功');
                Utils.showToast(message, 'success');
                Utils.ModalManager.hide('task-modal');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (this.isMobileDevice()) {
                    this.resetInfiniteScroll(); // 重置无限下拉状态
                    await this.loadTasks();
                } else {
                    await this.loadTasks();
                }

                // loadTasks() 内部已经调用了 updateCategoryCounts()，不需要再调用 renderCategories()
                // renderCategories() 会重新获取所有任务（默认只取前10条），导致数据不准确
                
                // 触发云端同步上传
                await this.triggerCloudUpload();
            } else {
                Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('保存任务失败:', error);
            Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 删除任务
    deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
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
        console.log('显示周期性任务删除对话框:', task);
        
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
        
        console.log('对话框内容已创建');
        
        Utils.confirmDialog(
            dialogContent,
            async () => {
                console.log('确认删除回调被调用');
                // 在确认时实时获取选中的值
                const checkedRadio = document.querySelector('input[name="delete-option"]:checked');
                console.log('找到的选中单选框:', checkedRadio);
                
                const deleteOption = checkedRadio ? checkedRadio.value : 'single';
                const deleteAll = deleteOption === 'all';
                console.log('删除选项:', deleteOption, 'deleteAll:', deleteAll);
                await this.performDelete(task.id, deleteAll);
            },
            () => {
                console.log('删除操作被取消');
            },
            '删除周期性任务'
        );
        
        console.log('confirmDialog已调用');
    }
    
    // 执行删除操作
    async performDelete(taskId, deleteAll) {
        console.log('开始执行删除操作:', { taskId, deleteAll });
        
        try {
            Utils.setLoading(true, '删除中...');
            
            const response = await window.pywebview.api.delete_todo(taskId, deleteAll);
            console.log('删除API响应:', response);
            
            if (response.success) {
                const message = deleteAll ?
                    window.languageManager.getText('periodicTaskDeleted', '整个周期任务删除成功') :
                    window.languageManager.getText('taskDeleted', '任务删除成功');
                Utils.showToast(message, 'success');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (this.isMobileDevice()) {
                    this.resetInfiniteScroll(); // 重置无限下拉状态
                    await this.loadTasks();
                } else {
                    // 安全检查：确保任务列表存在
                    if (Array.isArray(this.tasks)) {
                        await this.loadTasks();
                        // 如果删除任务后，页面任务数量为空且有前置页，渲染前置页数据
                        if (this.tasks.length === 0 && this.currentPage > 1) {
                            this.currentPage = this.currentPage - 1;
                            await this.loadTasks();
                        }
                    } else {
                        console.warn('任务列表状态异常，重新初始化');
                        this.tasks = [];
                        await this.loadTasks();
                    }
                }
                // loadTasks() 已经包含了 updateStats() 和 updateCategoryCounts() 的调用
                // 不需要再调用 renderCategories()，否则会导致数据不准确
                
                // 触发云端同步上传
                await this.triggerCloudUpload();
            } else {
                Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${response.error}`, 'error');
            }
        } catch (error) {
            console.error('删除任务失败:', error);
            Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            
            // 发生错误时重新加载任务以确保数据一致性
            try {
                await this.loadTasks();
                // loadTasks() 已经包含了 updateStats() 和 updateCategoryCounts() 的调用
                // 这里不需要重复调用
            } catch (reloadError) {
                console.error('重新加载任务失败:', reloadError);
            }
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 更新分类任务数量：当前保持分类数量更新变化不受搜索条件影响，因而设置大部分入参为null
    async updateCategoryCounts() {
        if (window.categoryManager) {
            // 获取当前筛选条件下的所有任务（不分页）
            const response = await window.pywebview.api.get_todos(
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
            );

            if (response.success) {
                // 使用当前筛选条件下的所有任务更新分类计数
                window.categoryManager.updateCategoryCounts(response.tasks);
            } else {
                // 如果获取失败，使用当前页的任务
                window.categoryManager.updateCategoryCounts(this.tasks);
            }
        }
    }

    // 渲染分页组件
    renderPagination() {
        const pagination = document.getElementById('pagination');
        const showingEl = document.getElementById('pagination-showing');
        const pageSizeSelect = document.getElementById('page-size-select');
        const firstBtn = document.getElementById('pagination-first');
        const prevBtn = document.getElementById('pagination-prev');
        const nextBtn = document.getElementById('pagination-next');
        const lastBtn = document.getElementById('pagination-last');
        const numbersDiv = document.getElementById('pagination-numbers');

        // 如果是日历视图，隐藏分页
        if (window.calendarManager && window.calendarManager.currentView === 'calendar') {
            pagination.style.display = 'none';
            return;
        }

        // 如果没有任务，隐藏分页
        if (this.totalTasks === 0) {
            pagination.style.display = 'none';
            return;
        }
        
        pagination.style.display = 'flex';
        
        // 更新显示信息
        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.totalTasks);
        showingEl.textContent = `${window.languageManager.getText('paginationShowing', '显示')} ${start}-${end} ${window.languageManager.getText('paginationOf', '共')} ${this.totalTasks} ${window.languageManager.getText('paginationItems', '条')}`;

        // 更新每页数量选择器
        pageSizeSelect.value = this.pageSize;
        
        // 更新按钮状态
        firstBtn.disabled = this.currentPage === 1;
        prevBtn.disabled = this.currentPage === 1;
        nextBtn.disabled = this.currentPage === this.totalPages;
        lastBtn.disabled = this.currentPage === this.totalPages;
        
        // 生成页码按钮
        let pageNumbers = '';
        const maxButtons = 5; // 最多显示5个页码按钮
        
        if (this.totalPages <= maxButtons) {
            // 总页数较少，显示所有页码
            for (let i = 1; i <= this.totalPages; i++) {
                pageNumbers += `<button class="pagination-number ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else {
            // 总页数较多，智能显示页码
            if (this.currentPage <= 3) {
                // 当前页在前面
                for (let i = 1; i <= 4; i++) {
                    pageNumbers += `<button class="pagination-number ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                pageNumbers += `<button class="pagination-number" data-page="${this.totalPages}">${this.totalPages}</button>`;
            } else if (this.currentPage >= this.totalPages - 2) {
                // 当前页在后面
                pageNumbers += `<button class="pagination-number" data-page="1">1</button>`;
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                for (let i = this.totalPages - 3; i <= this.totalPages; i++) {
                    pageNumbers += `<button class="pagination-number ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
            } else {
                // 当前页在中间
                pageNumbers += `<button class="pagination-number" data-page="1">1</button>`;
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                for (let i = this.currentPage - 1; i <= this.currentPage + 1; i++) {
                    pageNumbers += `<button class="pagination-number ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
                }
                pageNumbers += `<span class="pagination-ellipsis">...</span>`;
                pageNumbers += `<button class="pagination-number" data-page="${this.totalPages}">${this.totalPages}</button>`;
            }
        }
        
        numbersDiv.innerHTML = pageNumbers;
        
        // 绑定页码点击事件
        numbersDiv.querySelectorAll('.pagination-number').forEach(btn => {
            btn.onclick = () => {
                const page = parseInt(btn.dataset.page);
                this.goToPage(page);
            };
        });
    }

    // 跳转到指定页
    async goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) {
            return;
        }
        
        this.currentPage = page;
        await this.loadTasks();
        
        // 滚动到任务列表顶部
        const tasksContainer = document.getElementById('tasks-view');
        if (tasksContainer) {
            tasksContainer.scrollTop = 0;
        }
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
    async updateStats() {
        try {
            // 更新日期范围显示
            this.updateStatsDateRange();

            // 从后端获取所有任务的统计数据
            const response = await window.pywebview.api.get_stats(this.statsDimension);

            if (response.success) {
                const totalTasksEl = document.getElementById('total-tasks');
                const completedTasksEl = document.getElementById('completed-tasks');
                const completionRateEl = document.getElementById('completion-rate');
                const noDueDateEl = document.getElementById('no-due-date-tasks');

                if (!totalTasksEl || !completedTasksEl || !completionRateEl || !noDueDateEl) return;

                const total = response.stats.total;
                const completed = response.stats.completed;
                const rate = response.stats.completion_rate;
                const noDueDate = response.stats.no_due_date || 0;

                totalTasksEl.textContent = total;
                completedTasksEl.textContent = completed;
                completionRateEl.textContent = rate + '%';
                noDueDateEl.textContent = noDueDate;
            }
        } catch (error) {
            console.error('更新统计信息失败:', error);
        }
    }

    // 更新统计日期范围显示
    updateStatsDateRange() {
        const dateRangeEl = document.getElementById('stats-date-range');
        if (!dateRangeEl) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const weekDay = now.getDay(); // 0-6, 0 is Sunday

        let dateRangeText = '';

        switch (this.statsDimension) {
            case 'all':
                dateRangeText = `${window.languageManager.getText('statsTimeDimension.all', '全部')}`;
                break;
            case 'year':
                dateRangeText = `${year}`;
                break;
            case 'month':
                dateRangeText = `${year}-${month}`;
                break;
            case 'week':
                // 计算本周的周一和周日
                const monday = new Date(now);
                monday.setDate(now.getDate() - (weekDay === 0 ? 6 : weekDay - 1));
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);

                const mondayMonth = monday.getMonth() + 1;
                const mondayDay = monday.getDate();
                const sundayMonth = sunday.getMonth() + 1;
                const sundayDay = sunday.getDate();

                // 如果跨月，显示月份
                if (mondayMonth === sundayMonth) {
                    dateRangeText = `${mondayMonth}/${mondayDay} - ${mondayMonth}/${sundayDay}`;
                } else {
                    dateRangeText = `${mondayMonth}/${mondayDay} - ${sundayMonth}/${sundayDay}`;
                }
                break;
            case 'day':
                dateRangeText = `${year}-${month}-${day}`;
                break;
        }

        dateRangeEl.innerHTML = `<span class="date-range-text">${dateRangeText}</span>`;
    }
    
    // 清空搜索
    async clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
            this.searchQuery = '';
            this.currentPage = 1;
            this.resetInfiniteScroll(); // 重置无限下拉状态
            await this.loadTasks();
            this.updateSearchClearButton();
        }
    }
    
    // 更新搜索清空按钮状态
    updateSearchClearButton() {
        const searchInput = document.getElementById('search-input');
        const searchClearBtn = document.getElementById('search-clear-btn');
        
        if (searchInput && searchClearBtn) {
            if (searchInput.value.trim()) {
                searchClearBtn.classList.add('visible');
            } else {
                searchClearBtn.classList.remove('visible');
            }
        }
    }

    // 绑定分页事件
    bindPaginationEvents() {
        const firstBtn = document.getElementById('pagination-first');
        const prevBtn = document.getElementById('pagination-prev');
        const nextBtn = document.getElementById('pagination-next');
        const lastBtn = document.getElementById('pagination-last');
        const pageSizeSelect = document.getElementById('page-size-select');
        
        if (firstBtn) {
            firstBtn.addEventListener('click', () => this.goToPage(1));
        }
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        }
        
        if (lastBtn) {
            lastBtn.addEventListener('click', () => this.goToPage(this.totalPages));
        }
        
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', (e) => {
                this.changePageSize(e.target.value);
            });
        }
    }

    // 判断是否为移动端或小屏幕
    isMobileDevice() {
        return window.innerWidth <= 480;
    }

    // 初始化无限下拉功能
    initInfiniteScroll() {
        // 移除已存在的监听器
        this.removeInfiniteScroll();

        // 只在移动端启用无限下拉
        if (!this.isMobileDevice()) {
            return;
        }

        const tasksContainer = document.getElementById('tasks-view');
        if (!tasksContainer) return;

        // 添加滚动监听器
        this.scrollListener = async () => {
            if (this.isLoadingMore || !this.hasMoreTasks) {
                return;
            }

            const scrollPosition = tasksContainer.scrollTop + tasksContainer.clientHeight;
            const scrollHeight = tasksContainer.scrollHeight;

            // 当滚动位置距离底部小于阈值时，加载更多
            if (scrollPosition >= scrollHeight - this.scrollThreshold) {
                await this.loadMoreTasks();
            }
        };

        tasksContainer.addEventListener('scroll', this.scrollListener, { passive: true });
        console.log('Infinite scroll listener attached');

        // 检查是否需要自动加载更多（内容不足以滚动时）
        setTimeout(() => this.checkAndLoadMoreIfNeeded(), 100);
    }

    // 检查是否需要自动加载更多任务
    checkAndLoadMoreIfNeeded() {
        if (!this.isMobileDevice() || this.isLoadingMore || !this.hasMoreTasks) {
            return;
        }

        const tasksContainer = document.getElementById('tasks-view');
        if (!tasksContainer) return;

        const scrollHeight = tasksContainer.scrollHeight;
        const clientHeight = tasksContainer.clientHeight;

        console.log('Checking if need to load more - scrollHeight:', scrollHeight, 'clientHeight:', clientHeight, 'currentPage:', this.currentPage, 'totalPages:', this.totalPages);

        // 如果内容高度小于等于容器高度，说明所有任务都在可视范围内，需要加载更多
        // 同时确保还有更多页面可加载
        if (scrollHeight <= clientHeight && this.currentPage < this.totalPages) {
            console.log('Content fits in viewport, auto-loading more tasks');
            this.loadMoreTasks().then(() => {
                // 加载完成后再次检查,直到内容超过容器高度
                setTimeout(() => this.checkAndLoadMoreIfNeeded(), 100);
            });
        }
    }

    // 移除无限下拉监听器
    removeInfiniteScroll() {
        if (this.scrollListener) {
            const tasksContainer = document.getElementById('tasks-view');
            if (tasksContainer) {
                tasksContainer.removeEventListener('scroll', this.scrollListener);
            }
            this.scrollListener = null;
        }
    }

    // 加载更多任务（无限下拉）
    async loadMoreTasks() {
        if (this.isLoadingMore || !this.hasMoreTasks) {
            return;
        }

        // 如果已经是最后一页，不再加载
        if (this.currentPage >= this.totalPages) {
            this.hasMoreTasks = false;
            this.showNoMoreTasks();
            return;
        }

        this.isLoadingMore = true;
        this.showLoadingMore();

        try {
            const nextPage = this.currentPage + 1;
            const response = await this.safeGetTodos(
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
            );

            if (response.success && response.tasks.length > 0) {
                // 将新任务追加到现有任务列表
                this.tasks = [...this.tasks, ...response.tasks];
                this.currentPage = nextPage;

                // 渲染新增的任务
                this.appendTasks(response.tasks);

                // 检查是否还有更多任务
                this.hasMoreTasks = this.currentPage < this.totalPages;

                // 如果是最后一页，显示到底提示
                if (!this.hasMoreTasks) {
                    this.showNoMoreTasks();
                }
            } else {
                this.hasMoreTasks = false;
                this.showNoMoreTasks();
            }
        } catch (error) {
            console.error('加载更多任务失败:', error);
            Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
        } finally {
            this.isLoadingMore = false;
            this.hideLoadingMore();
        }
    }

    // 追加任务到列表
    appendTasks(newTasks) {
        const tasksList = document.getElementById('tasks-list');
        if (!tasksList) return;

        // 生成新任务的HTML并追加到列表
        const tasksHtml = newTasks.map(task => this.createTaskElement(task)).join('');
        tasksList.insertAdjacentHTML('beforeend', tasksHtml);

        // 绑定新增任务的事件
        this.bindTaskEvents();
    }

    // 显示"加载更多"指示器
    showLoadingMore() {
        const loadingMoreEl = document.getElementById('loading-more');
        if (loadingMoreEl) return;

        const tasksList = document.getElementById('tasks-list');
        if (!tasksList) return;

        const loadingMoreDiv = document.createElement('div');
        loadingMoreDiv.id = 'loading-more';
        loadingMoreDiv.className = 'loading-more';
        loadingMoreDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        `;
        tasksList.appendChild(loadingMoreDiv);
    }

    // 隐藏"加载更多"指示器
    hideLoadingMore() {
        const loadingMoreEl = document.getElementById('loading-more');
        if (loadingMoreEl) {
            loadingMoreEl.remove();
        }
    }

    // 显示"已经到底了"提示
    showNoMoreTasks() {
        const noMoreEl = document.getElementById('no-more-tasks');
        if (noMoreEl) return;

        const tasksList = document.getElementById('tasks-list');
        if (!tasksList) return;

        const noMoreDiv = document.createElement('div');
        noMoreDiv.id = 'no-more-tasks';
        noMoreDiv.className = 'no-more-tasks';
        noMoreDiv.innerHTML = `
            <span class="no-more-text">- 已经到底了 -</span>
        `;
        tasksList.appendChild(noMoreDiv);
    }

    // 隐藏"已经到底了"提示
    hideNoMoreTasks() {
        const noMoreEl = document.getElementById('no-more-tasks');
        if (noMoreEl) {
            noMoreEl.remove();
        }
    }

    // 重置无限下拉状态
    resetInfiniteScroll() {
        this.isLoadingMore = false;
        this.hasMoreTasks = true;
        this.currentPage = 1;
        this.hideLoadingMore();
        this.hideNoMoreTasks();
        this.loadTasks();
    }

    // 处理窗口大小变化
    handleResize() {
        const isLargeScreen = window.innerWidth > 480;
        const pagination = document.getElementById('pagination');
        const tasksList = document.getElementById('tasks-list');

        if (isLargeScreen) {
            // 切换到大屏幕：使用分页模式，每页10条
            console.log('Switching to large screen mode');

            // 设置列表为表格布局
            if (tasksList) {
                tasksList.style.display = 'table';
            }

            // 移除无限下拉
            this.removeInfiniteScroll();

            // 显示分页
            if (pagination) {
                pagination.style.display = 'flex';
            }

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
            console.log('Switching to small screen mode');

            // 设置列表为flex布局
            if (tasksList) {
                tasksList.style.display = 'flex';
            }

            if (this.currentPage > 1) {
                this.currentPage = 1;
                this.loadTasks();
            } else {
                this.renderTasks();
            }

            // 隐藏分页
            if (pagination) {
                pagination.style.display = 'none';
            }

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
        try {
            const response = await window.pywebview.api.get_all_tags();
            if (response.success) {
                this.availableTags = response.tags;
                this.renderTagsSelector();
            }
        } catch (error) {
            console.error('加载标签失败:', error);
        }
    }

    // 渲染标签选择器
    renderTagsSelector() {
        const selector = document.getElementById('tags-selector');
        if (!selector) return;

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

        selector.innerHTML = html;

        // 绑定事件
        this.bindTagsSelectorEvents();
    }

    // 绑定标签选择器事件
    bindTagsSelectorEvents() {
        const selector = document.getElementById('tags-selector');
        if (!selector) return;

        // 标签点击事件（选择/取消选择）
        selector.querySelectorAll('.tag-selector-item').forEach(item => {
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
        if (addBtn) {
            addBtn.onclick = () => this.showAddTagInput();
        }
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

    // 删除标签
    async deleteTag(tagId) {
        Utils.confirmDialog(
            '确定要删除这个标签吗？',
            async () => {
                try {
                    const response = await window.pywebview.api.delete_tag(tagId);
                    if (response.success) {
                        Utils.showToast(window.languageManager.getText('taskTagDeleted', '标签删除成功'), 'success');
                        // 从已选标签中移除
                        const index = this.selectedTags.indexOf(tagId);
                        if (index !== -1) {
                            this.selectedTags.splice(index, 1);
                        }
                        // 重新加载标签
                        await this.loadTagsSelector();
                    } else {
                        Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${response.error}`, 'error');
                    }
                } catch (error) {
                    console.error('删除标签失败:', error);
                    Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                }
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
                <button class="btn-cancel" id="cancel-add-tag">×</button>
            </span>
        `;

        addBtn.replaceWith(document.createElement('span'));
        const inputContainer = document.getElementById('tag-input-mode');
        if (inputContainer) {
            inputContainer.outerHTML = inputHtml;
        } else {
            const selector = document.getElementById('tags-selector');
            selector.insertAdjacentHTML('beforeend', inputHtml);
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

        if (cancelBtn) {
            cancelBtn.onclick = () => this.renderTagsSelector();
        }
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
}

// 创建全局实例
window.todoManager = new TodoManager();

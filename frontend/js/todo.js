// 任务管理模块

class TodoManager {
    constructor() {
        this.tasks = [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.priorityFilter = 'all';
        this.statusFilter = 'all';
        this.dueDateFilter = 'all';
        this.sortBy = 'created_at'; // 使用默认排序逻辑
        this.sortOrder = 'desc';
        this.customDateFilter = null; // 自定义日期筛选（用于日历视图）
        // 分页相关
        this.currentPage = 1;
        this.pageSize = 10;
        this.totalTasks = 0;
        this.totalPages = 0;
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

        // 搜索
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const searchClearBtn = document.getElementById('search-clear-btn');
        
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce(async () => {
                this.searchQuery = searchInput.value.trim();
                this.currentPage = 1; // 重置到第一页
                this.customDateFilter = null; // 清除自定义日期筛选
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
                await this.loadTasks();
            });
        }
        
        if (statusFilter) {
            statusFilter.addEventListener('change', async (e) => {
                this.statusFilter = e.target.value;
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                await this.loadTasks();
            });
        }
        
        if (dueDateFilter) {
            dueDateFilter.addEventListener('change', async (e) => {
                this.dueDateFilter = e.target.value;
                this.currentPage = 1;
                this.customDateFilter = null; // 清除自定义日期筛选
                await this.loadTasks();
            });
        }
        
        // 添加任务按钮
        const addTaskBtn = document.getElementById('add-task-btn');
        if (addTaskBtn) {
            addTaskBtn.addEventListener('click', () => this.showAddTaskModal());
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
            clearDateBtn.addEventListener('click', () => this.clearDateInput());
        }
        
        if (clearTimeBtn) {
            clearTimeBtn.addEventListener('click', () => this.clearTimeInput());
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
        
        if (isRecurringCheckbox && recurringOptions) {
            isRecurringCheckbox.checked = false;
            recurringOptions.style.display = 'none';
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
                notice.style.cssText = `
                    background-color: #fff3cd;
                    border: 1px solid #ffeaa7;
                    color: #856404;
                    padding: 8px 12px;
                    border-radius: 4px;
                    margin-top: 8px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                `;
                notice.innerHTML = '⚠️ 非周期性任务编辑模式下不支持改周期性任务';
                
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
        
        if (isRecurringCheckbox.checked) {
            recurringOptions.style.display = 'block';
        } else {
            recurringOptions.style.display = 'none';
        }
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
            const validation = Utils.DateTimeValidator.validateDateTime(dateStr, timeStr);
            
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
            const updateClearDateBtn = () => {
                if (datePicker.value) {
                    clearDateBtn.classList.add('visible');
                } else {
                    clearDateBtn.classList.remove('visible');
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

    // 加载pywebview的api
    async loadPywebviewApi(maxRetries = 10, interval = 500) {
        for (let i = 0; i < maxRetries; i++) {
            if (pywebview && pywebview.api) {
                return true; // pywebview 已加载完成
            }

            if (i < maxRetries - 1) {
                console.log(`等待 pywebview 加载... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        }
        return false; // 超时未加载
    }

    // 加载pywebview的todos-api
    async safeGetTodos(...args) {
        // 先等待 pywebview 加载完成
        const isLoaded = await this.loadPywebviewApi();

        if (!isLoaded) {
           throw new Error('pywebview加载失败！');
        }

        // pywebview 已加载，正常调用
        return await pywebview.api.get_todos(...args);
    }
    
    // 加载任务
    async loadTasks() {
        try {
            Utils.setLoading(true, '加载任务...');
            
            let response;
            let useCache = false;

            try {
                // 查询数据库
                response = await this.safeGetTodos(
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
            } catch (error) {
                // 使用缓存
                const cachedData = window.DataCache.get('tasks');
                if (cachedData) {
                    console.log('使用缓存数据');
                    response = cachedData;
                    useCache = true;
                } else {
                    console.log('无缓存数据，加载任务为空');
                    response = { success: false, tasks: [], total: 0, total_pages: 0 };
                }
            }
            
            if (response.success) {
                this.tasks = response.tasks;
                this.totalTasks = response.total;
                this.totalPages = response.total_pages;

                // 缓存任务数据（仅首次加载全部数据时缓存）
                if (!useCache && this.currentPage === 1 &&
                    this.currentFilter === 'all' &&
                    this.statusFilter === 'all' &&
                    this.priorityFilter === 'all' &&
                    this.dueDateFilter === 'all' &&
                    !this.searchQuery && !this.customDateFilter) {
                    window.DataCache.set('tasks', response);
                }

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

                this.renderTasks();
                this.renderPagination();
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

                if (useCache) {
                    Utils.showToast('使用缓存数据，网络连接可能异常', 'warning');
                }
            } else {
                Utils.showToast('无缓存加载任务失败', 'error');
            }
        } catch (error) {
            console.error('加载任务失败:', error);
            Utils.showToast('加载任务失败', 'error');
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 渲染任务列表
    renderTasks() {
        const tasksList = document.getElementById('tasks-list');
        const emptyState = document.getElementById('empty-state');
        
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
            tasksList.style.display = 'none';
            emptyState.style.display = 'block';
            // 隐藏分页
            document.getElementById('pagination').style.display = 'none';
            return;
        }
        
        tasksList.style.display = 'flex';
        emptyState.style.display = 'none';
        
        // 不再需要前端排序，后端已排序
        const sortedTasks = filteredTasks;
        
        // 生成HTML
        tasksList.innerHTML = sortedTasks.map(task => this.createTaskElement(task)).join('');
        
        // 绑定任务事件
        this.bindTaskEvents();
    }
    
    // 过滤任务
    filterTasks() {
        return this.tasks.filter(task => {
            // 自定义日期筛选（用于日历视图点击日期）
            if (this.customDateFilter) {
                if (!task.dueDate) return false;
                const taskDate = task.dueDate.split('T')[0];
                if (taskDate !== this.customDateFilter) return false;
            }
            
            // 搜索过滤
            if (this.searchQuery && !this.matchesSearch(task, this.searchQuery)) {
                return false;
            }
            
            // 优先级过滤
            if (this.priorityFilter !== 'all' && task.priority !== this.priorityFilter) {
                return false;
            }
            
            // 状态过滤
            if (this.statusFilter === 'completed' && !task.completed) {
                return false;
            }
            if (this.statusFilter === 'uncompleted' && task.completed) {
                return false;
            }
            if (this.statusFilter === 'pending') {
                // 未逾期筛选：只显示未完成且未过截止日期的任务
                if (task.completed) {
                    return false;
                }
                // 未完成场景
                // 无截止日期，都算未完成，无需判断
                // 有截止日期，看是否逾期
                const taskDate = new Date(task.dueDate);
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                // 如果任务截止日期晚于今天，则视为未逾期
                if (taskDate < today) {
                    return false;
                }
            }
            if (this.statusFilter === 'overdue') {
                // 已逾期筛选：只显示未完成且已过截止日期的任务
                if (task.completed) {
                    return false;
                }
                if (!task.dueDate) {
                    return false;
                }
                const taskDate = new Date(task.dueDate);
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                
                // 如果任务截止日期早于今天，则视为逾期
                if (taskDate >= today) {
                    return false;
                }
            }
            
            // 截止日期过滤
            if (this.dueDateFilter !== 'all') {
                if (!task.dueDate) {
                    // 无截止日期的任务
                    if (this.dueDateFilter !== 'no-due-date') {
                        return false;
                    }
                } else {
                    // 有截止日期的任务
                    if (this.dueDateFilter === 'no-due-date') {
                        return false;
                    }
                    
                    const taskDate = new Date(task.dueDate);
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const weekEnd = new Date(today);
                    weekEnd.setDate(weekEnd.getDate() + 7);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); // 本月最后一天

                    switch (this.dueDateFilter) {
                        case 'today':
                            if (taskDate.toDateString() !== today.toDateString() && taskDate > today) {
                                return false;
                            }
                            break;
                        case 'tomorrow':
                            if (taskDate.toDateString() !== tomorrow.toDateString() && taskDate > tomorrow) {
                                return false;
                            }
                            break;
                        case 'week':
                            if (taskDate > weekEnd) {
                                return false;
                            }
                            break;
                        case 'month':
                            if (taskDate > monthEnd) {
                                return false;
                            }
                            break;
                    }
                }
            }
            
            // 分类过滤
            if (this.currentFilter && this.currentFilter !== 'all') {
                if (this.currentFilter === 'uncategorized') {
                    // 显示未分类的任务
                    if (task.categoryId) {
                        return false;
                    }
                } else {
                    // 显示指定分类的任务
                    if (task.categoryId !== this.currentFilter) {
                        return false;
                    }
                }
            }
            
            return true;
        });
    }
    
    // 搜索匹配
    matchesSearch(task, query) {
        const searchFields = [
            task.title,
            task.description || ''
        ];
        
        return searchFields.some(field => 
            field.toLowerCase().includes(query.toLowerCase())
        );
    }
    
    // 排序任务
    sortTasks(tasks) {
        // 默认使用优先级+截止日期的复合排序
        return tasks.sort((a, b) => {
            // 如果用户手动设置了排序方式，则使用原有逻辑
            if (this.sortBy !== 'created_at') {
                return this.customSort(a, b);
            }
            

            
            // 默认排序：优先级 + 截止日期紧急程度
            return this.defaultSort(a, b);
        });
    }
    
    // 默认排序逻辑：优先级 + 截止日期紧急程度
    defaultSort(a, b) {
        // 优先级排序（高->中->低->无）
        const priorityOrder = { high: 1, medium: 2, low: 3, none: 4 };
        const aPriority = priorityOrder[a.priority] || 4;
        const bPriority = priorityOrder[b.priority] || 4;
        
        // 如果优先级不同，直接按优先级排序
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }
        
        // 优先级相同，按截止日期紧急程度排序
        return this.sortByDueDateUrgency(a, b);
    }
    
    // 按截止日期紧急程度排序
    sortByDueDateUrgency(a, b) {
        const now = new Date();
        
        // 处理无截止日期的任务
        const aHasDueDate = a.dueDate ? 1 : 0;
        const bHasDueDate = b.dueDate ? 1 : 0;
        
        // 有截止日期的排在前面
        if (aHasDueDate !== bHasDueDate) {
            return bHasDueDate - aHasDueDate;
        }
        
        // 都没有截止日期，保持原顺序
        if (!a.dueDate && !b.dueDate) {
            return 0;
        }
        
        // 都有截止日期，按紧急程度排序
        const aDueDate = new Date(a.dueDate);
        const bDueDate = new Date(b.dueDate);
        
        // 只比较日期部分，忽略时间
        const aDateOnly = new Date(aDueDate.getFullYear(), aDueDate.getMonth(), aDueDate.getDate());
        const bDateOnly = new Date(bDueDate.getFullYear(), bDueDate.getMonth(), bDueDate.getDate());
        const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // 计算紧急程度分数（越小越紧急）
        const aUrgency = this.calculateUrgencyScore(aDateOnly, nowDateOnly);
        const bUrgency = this.calculateUrgencyScore(bDateOnly, nowDateOnly);
        
        return aUrgency - bUrgency;
    }
    
    // 计算紧急程度分数
    calculateUrgencyScore(dueDate, now) {
        const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            // 已逾期，按逾期天数排序（逾期越久分数越小）
            return -1000 + diffDays; // -1000是基准，diffDays是负数
        } else if (diffDays === 0) {
            // 今天到期
            return -100;
        } else if (diffDays === 1) {
            // 明天到期
            return -50;
        } else if (diffDays <= 7) {
            // 本周内
            return -10 + diffDays;
        } else {
            // 更远期
            return 100 + diffDays;
        }
    }
    
    // 自定义排序逻辑（用户手动设置的排序方式）
    customSort(a, b) {
        let aValue = a[this.sortBy];
        let bValue = b[this.sortBy];
        
        // 处理日期
        if (this.sortBy === 'created_at' || this.sortBy === 'updated_at' || this.sortBy === 'due_date') {
            aValue = new Date(aValue || 0);
            bValue = new Date(bValue || 0);
        }
        
        // 处理优先级
        if (this.sortBy === 'priority') {
            const priorityOrder = { high: 1, medium: 2, low: 3, none: 4 };
            aValue = priorityOrder[a.priority] || 4;
            bValue = priorityOrder[b.priority] || 4;
        }
        
        let result = 0;
        if (aValue < bValue) result = -1;
        else if (aValue > bValue) result = 1;
        
        return this.sortOrder === 'asc' ? result : -result;
    }
    
    // 创建任务元素
    createTaskElement(task) {
        const priorityInfo = Utils.getPriorityInfo(task.priority);
        // 只有未完成的任务才检查是否逾期
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);

        // 渲染标签
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = task.tags.map(tag =>
                `<span class="task-tag" style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                </span>`
            ).join('');
        }

        return `
            <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
                <div class="task-header">
                    <div class="task-checkbox ${task.completed ? 'checked' : ''}"
                         data-task-id="${task.id}"></div>
                    <div class="task-content">
                        <h3 class="task-title">
                            ${Utils.escapeHtml(task.title)}
                            ${task.isRecurring ? '<span class="recurring-badge">周期性</span>' : ''}
                            ${task.parentTaskId ? '<span class="recurring-badge">周期任务</span>' : ''}
                        </h3>
                        ${task.description ? `<p class="task-description">${Utils.escapeHtml(task.description)}</p>` : ''}
                        <div class="task-meta">
                            <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                                ${priorityInfo.icon} ${priorityInfo.label}
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
                    <div class="task-actions">
                        <button class="task-action-btn edit" data-task-id="${task.id}"
                                title="编辑">✏️</button>
                        <button class="task-action-btn delete" data-task-id="${task.id}"
                                title="删除">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }
    
    // 绑定任务事件
    bindTaskEvents() {
        // 复选框点击
        document.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.toggleTask(taskId);
            };
        });
        
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
                btn.title = '周期性任务不支持编辑';
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                console.log(`禁用编辑按钮: ${taskId}`);
                
                // 设置点击事件处理，显示提示信息
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    Utils.showToast('周期性任务不支持编辑，请删除后重新创建', 'warning');
                };
            } else {
                btn.disabled = false;
                btn.title = '编辑';
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
        this.loadCategoryNames();
    }
    
    // 加载分类名称
    loadCategoryNames() {
        try {
            const response = pywebview.api.get_categories();
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
            const response = await pywebview.api.toggle_todo(taskId);
            if (response.success) {
                // 更新本地数据
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    task.completed = response.task.completed;
                    task.updatedAt = response.task.updatedAt;
                    this.renderTasks();
                    await this.updateStats();
                    await this.updateCategoryCounts();
                    
                    // 清除缓存，因为数据已更新
                    window.DataCache.remove('tasks');
                    
                    // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                    Utils.showToast(task.completed ? '任务已完成' : '任务已重新开启', 'success');
                }
            } else {
                Utils.showToast('操作失败: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            Utils.showToast('操作失败', 'error');
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
    
    // 编辑任务
    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // 如果是周期性任务，禁用编辑
        if (task.isRecurring || task.parentTaskId) {
            Utils.showToast('周期性任务不支持编辑，请删除后重新创建', 'warning');
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
            const response = await pywebview.api.get_categories();
            if (response.success) {
                const categories = response.categories;
                
                categorySelect.innerHTML = '<option value="">无分类</option>';
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
        const dateTimeValidation = Utils.DateTimeValidator.validateDateTime(dateStr, timeStr);
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
        } else {
            // 编辑模式下确保不会提交周期性任务数据
            taskData.isRecurring = false;
            taskData.recurrenceType = null;
            taskData.recurrenceCount = null;
        }
        
        if (!taskData.title) {
            Utils.showToast('请输入任务标题', 'warning');
            return;
        }
        
        try {
            Utils.setLoading(true, isEdit ? '保存中...' : '创建中...');
            
            let response;
            if (isEdit) {
                response = await pywebview.api.update_todo(editingId, taskData);
            } else {
                // 如果是周期性任务，使用专门的API
                if (taskData.isRecurring) {
                    response = await pywebview.api.add_recurring_todo(taskData);
                } else {
                    response = await pywebview.api.add_todo(taskData);
                }
            }
            
            if (response.success) {
                const message = isEdit ? '任务更新成功' :
                    (taskData.isRecurring ? `成功创建${response.tasks?.length || 1}个周期性任务` : '任务创建成功');
                Utils.showToast(message, 'success');
                Utils.ModalManager.hide('task-modal');
                
                // 清除缓存，因为数据已更新
                window.DataCache.remove('tasks');
                
                await this.loadTasks();
                // loadTasks() 内部已经调用了 updateCategoryCounts()，不需要再调用 renderCategories()
                // renderCategories() 会重新获取所有任务（默认只取前10条），导致数据不准确
            } else {
                Utils.showToast((isEdit ? '更新' : '创建') + '失败: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('保存任务失败:', error);
            Utils.showToast('保存失败', 'error');
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
            
            const response = await pywebview.api.delete_todo(taskId, deleteAll);
            console.log('删除API响应:', response);
            
            if (response.success) {
                const message = deleteAll ? '整个周期任务删除成功' : '任务删除成功';
                Utils.showToast(message, 'success');
                
                // 清除缓存，因为数据已更新
                window.DataCache.remove('tasks');
                
                // 安全检查：确保任务列表存在
                if (Array.isArray(this.tasks)) {
                    console.log('删除前任务数量:', this.tasks.length);
                    await this.loadTasks();
                    console.log('删除后任务数量:', this.tasks.length);
                } else {
                    console.warn('任务列表状态异常，重新初始化');
                    this.tasks = [];
                    await this.loadTasks();
                }
                // loadTasks() 已经包含了 updateStats() 和 updateCategoryCounts() 的调用
                // 不需要再调用 renderCategories()，否则会导致数据不准确
            } else {
                Utils.showToast('删除失败: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('删除任务失败:', error);
            Utils.showToast('删除失败', 'error');
            
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
    
    // 更新分类任务数量
    async updateCategoryCounts() {
        if (window.categoryManager) {
            // 获取当前筛选条件下的所有任务（不分页）
            const response = await pywebview.api.get_todos(
                1,  // page
                999999,  // page_size - 设置一个足够大的值以获取所有任务
//                this.currentFilter === 'all' ? null : this.currentFilter,
//                this.statusFilter === 'all' ? null : this.statusFilter,
//                this.priorityFilter === 'all' ? null : this.priorityFilter,
//                this.dueDateFilter === 'all' ? null : this.dueDateFilter,
                null,  // 分类
                null,  // 状态
                null,  // 优先级
                null,  // 逾期
                null,  // year
                null,  // month
                this.searchQuery || null,
                this.customDateFilter || null
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
        
        // 如果没有任务，隐藏分页
        if (this.totalTasks === 0) {
            pagination.style.display = 'none';
            return;
        }
        
        pagination.style.display = 'flex';
        
        // 更新显示信息
        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.totalTasks);
        showingEl.textContent = `显示 ${start}-${end} 共 ${this.totalTasks} 条`;
        
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
        await this.loadTasks();
    }
    
    // 更新统计信息
    async updateStats() {
        try {
            // 更新日期范围显示
            this.updateStatsDateRange();

            // 从后端获取所有任务的统计数据
            const response = await pywebview.api.get_stats(this.statsDimension);

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
                dateRangeText = '全部时间';
                break;
            case 'year':
                dateRangeText = `${year}年`;
                break;
            case 'month':
                dateRangeText = `${year}年 ${month}月`;
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
                    dateRangeText = `${mondayMonth}月${mondayDay}日 - ${sundayDay}日`;
                } else {
                    dateRangeText = `${mondayMonth}月${mondayDay}日 - ${sundayMonth}月${sundayDay}日`;
                }
                break;
            case 'day':
                dateRangeText = `${year}年 ${month}月 ${day}日`;
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
            const response = await pywebview.api.get_all_tags();
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
                + 标签
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
                    const response = await pywebview.api.delete_tag(tagId);
                    if (response.success) {
                        Utils.showToast('标签删除成功', 'success');
                        // 从已选标签中移除
                        const index = this.selectedTags.indexOf(tagId);
                        if (index !== -1) {
                            this.selectedTags.splice(index, 1);
                        }
                        // 重新加载标签
                        await this.loadTagsSelector();
                    } else {
                        Utils.showToast('删除失败: ' + response.error, 'error');
                    }
                } catch (error) {
                    console.error('删除标签失败:', error);
                    Utils.showToast('删除失败', 'error');
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
            Utils.showToast('请输入标签名', 'warning');
            return;
        }

        // 检查标签是否已存在
        if (this.availableTags.some(tag => tag.name === tagName)) {
            Utils.showToast('标签已存在', 'warning');
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

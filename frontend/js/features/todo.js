// 任务管理模块
//
// 列表渲染、无限下拉、周期规则、搜索 chips 等子模块见 js/features/todo/ 目录。
// 列定义常量挂在 ColumnsController 上，周期规则提示文案挂在 RecurrenceController 上，
// 因此 js/features/todo/columns.js 与 recurrence.js 须先于本文件加载。

// 标签相关常量（TAG_INPUT_PATTERN 等）与 TagManager 均定义在 js/features/tag.js，
// 该文件必须在本文件之前引入。

class TodoManager {
    constructor() {
        this.instances = [];
        this.tasks = [];
        this.currentFilter = 'all';
        // 结构化查询对象：{ tags: [{id?, name}], keywords: [...], parent: {id?, name?} | null }
        this.searchQuery = null;
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
            selectedTitle: '', // 已选父任务的标题（供保存后回写搜索框的父任务查询）
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
        this.listLoadToken = 0; // 列表加载令牌：loadTasks 时自增，用于丢弃过期的下拉加载结果
        this.autoFillTimer = null; // 自动填充定时器（内容不足一屏时补加载）
        this.autoFillCount = 0; // 连续自动填充次数
        this.maxAutoFill = 3; // 单次最多连续自动填充页数，避免首屏一次性拉完全部数据
        this._scrollFrameId = null; // 滚动事件节流用的 rAF 句柄
        this._globalCloseHandlerBound = false; // 全局关闭侧滑菜单的监听是否已绑定
        this._completingTasks = new Set(); // 正在播放完成/重开动效的任务 id，用于忽略重复点击
        this._pendingHighlightTaskId = null; // 保存后需要在列表中定位并高亮的任务 id
        // 标签的数据与两个视图（左侧标签模块、弹窗标签选择器）全部由 TagManager 承载，
        // 这里只保留列表筛选态（chips）与两者之间的联动回调
        this.tagManager = window.tagManager;
        // 搜索标签 chips：{ type: 'tag'|'text', value, tagId?, color? }
        this.searchChips = [];
        this._chipEls = new WeakMap(); // chip 对象 → 其 DOM 元素，用于增删时做增量更新
        this._searchDebounceTimer = null;
        // 任务弹窗打开时的筛选快照：{ categoryId, tagIds, hasCategoryFilter, hasTagFilter }
        // categoryId/tagIds 为表单初始值（新建时为列表筛选值，编辑时为任务原值），
        // hasCategoryFilter/hasTagFilter 标记弹窗打开时列表是否已存在对应筛选
        this.taskFilterSnapshot = null;
        // 分类 id → 名称缓存：渲染任务 HTML 时同步取用，避免"先渲染占位再异步回填"
        this.categoryMap = new Map();
        // 子任务搜索建议下拉（输入 ">" 触发）
        this._subtaskSuggestTimer = null;
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
        // 当前子任务搜索对应的父任务（存在同名任务时用于精确传递父任务ID）
        this.subtaskParent = { id: null, title: null };
        // 编辑弹窗中父任务的异步回显状态：
        // _parentEditToken   递增令牌，用于丢弃上一次编辑迟到的回显结果，避免写脏当前表单
        // _parentInitPromise 回显 Promise，保存前需等待它结束，否则会把"尚未回显"误判为"用户移除了父任务"
        // _parentPrefillDone 回显是否成功完成；未完成时跳过父子关联变更，避免误删已有父子关联
        this._parentEditToken = 0;
        this._parentInitPromise = null;
        this._parentPrefillDone = false;
        // 任务列表当前显示的列（列 key 数组）
        this.visibleColumns = ColumnsController.COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key);
        // 列表任务对应的父任务缓存：{ 子任务ID: { id, title } | null }
        this.parentTaskMap = {};
        // 日期范围缓存
        this.currentDateRange = null;
        // 统计数据更新防抖
        this._statsDebounceTimer = null;
        this._pendingFromZero = false;
        this._statsTagDebounceTimer = null;
        this._tagPendingFromZero = false;
        // DOM 元素缓存与统一管理
        this.cacheDomRefs();
        // 无限下拉（小屏幕模式）：状态仍由本实例持有，实现见 InfiniteScrollController
        this.infiniteScroll = new InfiniteScrollController(this);
        // 周期性任务规则：实现见 RecurrenceController
        this.recurrence = new RecurrenceController(this);
        // 显示列配置：实现见 ColumnsController
        this.columns = new ColumnsController(this);
        // 搜索 chips / 结构化查询 / 子任务联想：实现见 SearchController
        this.search = new SearchController(this);
        // 列表渲染与任务行 HTML 构造：实现见 TaskRenderController
        this.renderer = new TaskRenderController(this);
        // 分页（大屏幕模式）：实现见 PaginationController
        this.paginationControl = new PaginationController(this);
        // 任务定位（高亮 / 反查页码 / 离场动画）：实现见 TaskLocateController
        this.locator = new TaskLocateController(this);
        // 行内滑动交互（小屏幕）：实现见 RowInteractionsController
        this.rowInteractions = new RowInteractionsController(this);
        // 任务操作（完成/删除/动效/分类计数）：实现见 TaskActionsController
        this.actions = new TaskActionsController(this);
        // 任务表单（新建/编辑/提交/父任务选择器）：实现见 TaskFormController
        this.form = new TaskFormController(this);
        // 附件管理（表单中的附件选择/展示/移除、详情中的附件展示）
        this.attachmentManager = new AttachmentManager(this);
        // 设置日期组件：单次任务截止日期 / 周期性任务结束日期共用同一套日历
        this.pikaday = this.createDatePicker(this.datePicker);
        this.recurrenceEndPikaday = this.createDatePicker(this.recurrenceEndDate, {
            onChange: () => this.recurrence.clearPreview()
        });

        this.configureTagManager();
    }

    // 统一的日期选择器：返回一个绑定在指定输入框上的日历实例。
    // 输入框是只读文本框（配合自定义日历弹出），避免 `<input type="date">`
    // 在各浏览器下的原生默认外观与其它输入框不一致。
    createDatePicker(field, { onChange } = {}) {
        if (!field) return null;
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        return new Pikaday({
            field,
            format: 'YYYY-MM-DD',
            showDaysInNextAndPreviousMonths: true,
            firstDay: 1,
            toString: (date) => formatDate(date),
            i18n: {
                previousMonth: 'Prev',
                nextMonth: 'Next',
                months: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
                weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            },
            onSelect: (selectedDate) => {
                if (!selectedDate) return;
                field.value = formatDate(selectedDate);
                onChange?.();
            }
        });
    }

    // 注入 TagManager 的联动回调：保持 TodoManager → TagManager 的单向依赖，
    // 标签模块只通过回调驱动"筛选 chips 变更 / 任务列表刷新"
    configureTagManager() {
        this.tagManager.configure({
            // 左侧标签模块的选中态数据源：列表筛选中的标签 id
            getFilterTagIds: () => this.search.getTagFilterIds(),
            // 点击左侧标签：切换对应的标签 chip
            onToggleFilterTag: (tagId) => this.search.toggleTagChip(tagId),
            // 标签重命名：同步筛选 chip 的显示文本，返回该标签是否正处于筛选中
            onTagRenamed: (tagId, newName) => {
                let chipRenamed = false;
                this.searchChips.forEach(chip => {
                    if (chip.type === 'tag' && chip.tagId === tagId) {
                        chip.value = newName;
                        chipRenamed = true;
                    }
                });
                if (chipRenamed) this.search.renderChips();
                return chipRenamed;
            },
            // 标签删除：移除对应筛选 chip 并重新搜索
            onTagDeleted: (tagId) => {
                if (this.search.removeChipByTagId(tagId)) this.search.syncQuery(0);
            },
            // 标签数据变化：刷新任务列表；resyncSearch 为真时连搜索条件一起重算
            onTagsChanged: ({ resyncSearch } = {}) => {
                if (resyncSearch) this.search.syncQuery(0);
                else this.loadTasks();
            }
        });
    }
    
    // 初始化
    async init() {
        this.bindEvents();

        // 读取任务列表显示列配置（本地缓存先兜底，随后以数据库为准）
        await this.loadColumnConfig();

        // 设置默认筛选为"全部"
        this.currentFilter = 'all';
        
        // 初始化搜索清空按钮状态
        this.updateSearchClearButton();
        
        await this.loadTasks();
        
        // 初始化无限下拉功能
        this.infiniteScroll.init();

        // 初始化标签管理模块
        await this.tagManager.loadModule(true);
    }

    // 统一缓存所有 DOM 节点
    cacheDomRefs() {
        const dom = {
            tasksList: 'tasks-list',
            pagination: 'pagination',
            tasksContainer: 'tasks-view',
            firstBtn: 'pagination-first',
            prevBtn: 'pagination-prev',
            nextBtn: 'pagination-next',
            lastBtn: 'pagination-last',
            pageSizeSelect: 'page-size-select',
            dropdown: 'subtask-suggestions',
            searchInput: 'search-input',
            searchTagWrapper: 'search-tag-wrapper',
            searchClearBtn: 'search-clear-btn',
            recurringOptions: 'recurring-options',
            // 时间设置：单次任务 / 周期性任务（并列）
            scheduleModeOnce: 'schedule-mode-once',
            scheduleModeRecurring: 'schedule-mode-recurring',
            recurrenceCount: 'recurrence-count',
            recurrenceType: 'recurrence-type',
            recurrenceHabitHint: 'recurrence-habit-hint',
            // 周期配置：模式切换
            recurrenceModeNormal: 'recurrence-mode-normal',
            recurrenceModeCron: 'recurrence-mode-cron',
            recurrenceNormalPanel: 'recurrence-normal-panel',
            recurrenceCronPanel: 'recurrence-cron-panel',
            // 每天
            dailyModeGroup: 'daily-mode-group',
            dailyModeTimes: 'daily-mode-times',
            dailyModeInterval: 'daily-mode-interval',
            dailyIntervalGroup: 'daily-interval-group',
            dailyIntervalStart: 'daily-interval-start',
            dailyIntervalEnd: 'daily-interval-end',
            dailyIntervalMinutes: 'daily-interval-minutes',
            // 每周 / 每月 / 每年
            weeklyGroup: 'weekly-group',
            weeklyDays: 'weekly-days',
            monthlyGroup: 'monthly-group',
            monthlyDays: 'monthly-days',
            yearlyGroup: 'yearly-group',
            yearlyMonth: 'yearly-month',
            yearlyDay: 'yearly-day',
            // 提醒时间点
            recurrenceTimesGroup: 'recurrence-times-group',
            recurrenceTimes: 'recurrence-times',
            recurrenceAddTime: 'recurrence-add-time',
            // Cron
            recurrenceCron: 'recurrence-cron',
            // 结束条件与预览
            recurrenceEndType: 'recurrence-end-type',
            recurrenceEndDate: 'recurrence-end-date',
            clearRecurrenceEndDateBtn: 'clear-recurrence-end-date',
            recurrenceEndDateGroup: 'recurrence-end-date-group',
            recurrenceCountGroup: 'recurrence-count-group',
            recurrencePreviewBtn: 'recurrence-preview-btn',
            recurrencePreview: 'recurrence-preview',
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
            // 任务列表显示列配置弹窗
            columnConfigModal: 'task-columns-modal',
            columnConfigTitle: 'task-columns-title',
            columnConfigDesc: 'task-columns-desc',
            columnConfigList: 'task-columns-list',
            columnConfigCloseBtn: 'task-columns-close',
            columnConfigResetBtn: 'task-columns-reset',
            columnConfigCancelBtn: 'task-columns-cancel',
            columnConfigSaveBtn: 'task-columns-save',
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
        this.search.initInput();

        this.searchBtn?.addEventListener('click', () => {
            // 若输入框中是完整的 #标签，先提交为 chip
            this.search.commitInputAsChipIfTag();
            this.search.syncQuery(0);
        });

        // 清空搜索按钮
        this.searchClearBtn?.addEventListener('click', () => this.search.clear());

        // 筛选器
        this.priorityFilterSelect?.addEventListener('change', (e) => this.onFilterChange('priorityFilter', e.target.value));
        this.statusFilterSelect?.addEventListener('change', (e) => this.onFilterChange('statusFilter', e.target.value));
        this.dueDateFilterSelect?.addEventListener('change', (e) => this.onFilterChange('dueDateFilter', e.target.value));

        // 添加任务按钮
        this.addTaskBtn?.addEventListener('click', () => this.form.showAddModal());
        this.addTaskFab?.addEventListener('click', () => this.form.showAddModal());

        // 任务表单
        this.taskForm?.addEventListener('submit', (e) => this.form.submit(e));

        // 模态框关闭按钮
        this.taskModalClose?.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));
        this.taskCancelBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-modal'));

        // 更多选项展开/收起按钮
        this.moreOptionsToggle?.addEventListener('click', () => this.toggleMoreOptions());

        // 时间设置：单次任务 / 周期性任务切换
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.recurrence.updateScheduleMode());
        });

        // 周期配置：模式 / 周期 / 提醒方式 / 结束方式切换
        document.querySelectorAll('input[name="recurrence-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.recurrence.updatePanels());
        });
        document.querySelectorAll('input[name="daily-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.recurrence.updatePanels());
        });
        this.recurrenceType?.addEventListener('change', () => this.recurrence.updatePanels());
        this.recurrenceEndType?.addEventListener('change', () => this.recurrence.updatePanels());
        this.recurrenceAddTime?.addEventListener('click', () => this.recurrence.addTimeChip());
        this.recurrencePreviewBtn?.addEventListener('click', () => this.recurrence.preview());

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
        this.clearRecurrenceEndDateBtn?.addEventListener('click', () => {
            this.recurrenceEndDate.value = '';
            this.recurrenceEndPikaday?.setDate?.(null);
            this.recurrence.clearPreview();
        });

        // 绑定分页相关的监听事件
        this.firstBtn?.addEventListener('click', () => this.paginationControl.goToPage(1));
        this.prevBtn?.addEventListener('click', () => this.paginationControl.goToPage(this.currentPage - 1));
        this.nextBtn?.addEventListener('click', () => this.paginationControl.goToPage(this.currentPage + 1));
        this.lastBtn?.addEventListener('click', () => this.paginationControl.goToPage(this.totalPages));
        this.pageSizeSelect?.addEventListener('change', (e) => this.paginationControl.changePageSize(e.target.value));

        // 任务列表显示列配置
        this.columns.bindEvents();

        // 语言切换后刷新列表（表头与列内容文案跟随语言变化），
        // 并重建周期性任务的星期 / 日期选择器文案（保留已选值）
        window.languageManager?.addObserver?.(() => {
            this.renderer.renderTasks();
            this.recurrence.initPickers();
            // 「截止日期 / 起始日期」标签随模式切换，语言变化后需要重新渲染
            this.recurrence.updateScheduleMode();
        });
    }

    // ============ 任务列表显示列配置 ============
    // 实现见 js/features/todo/columns.js，统一通过 this.columns 调用。
    // 仅 loadColumnConfig 保留为对外入口（main.js 数据热重载时调用）。

    // 读取列配置：数据库为唯一来源，localStorage 仅用于首屏兜底
    loadColumnConfig() {
        return this.columns.loadConfig();
    }


    // 批量加载当前列表任务的父任务（供"关联父项任务"列使用）
    async loadParentTaskMap() {
        const ids = this.tasks
            .filter(task => task && task.id && !(task.id in this.parentTaskMap))
            .map(task => task.id);
        if (ids.length === 0) return;

        await Api.relations.parentsMap({
            apiArgs: [ids],
            successCheck: (result) => !!result && !!result.data,
            onSuccess: (response) => {
                const map = response.data || {};
                ids.forEach(id => { this.parentTaskMap[id] = map[id] || null; });
            },
            onError: () => ids.forEach(id => { this.parentTaskMap[id] = null; })
        });
    }

    // 打开列表中点击的附件
    openListAttachment(taskId, attachmentId) {
        const task = this.tasks.find(t => t.id === taskId);
        const attachment = task && (task.attachments || []).find(a => a.id === attachmentId);
        if (attachment) this.attachmentManager?.openAttachment(attachment);
    }

    // 通用筛选器处理
    async onFilterChange(filterType, value) {
        this[filterType] = value;
        this.currentPage = 1;
        this.customDateFilter = null;
        this.infiniteScroll.reset();
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

        // 默认回到「单次任务」
        if (this.scheduleModeOnce) this.scheduleModeOnce.checked = true;
        this.recurringOptions.style.display = 'none';
        this.datePicker.required = false;
        this.timeInput.required = false;

        this.recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
        this.recurrence.reset();
    }

    // ============ 周期性任务规则配置 ============
    // 实现见 js/features/todo/recurrence.js，统一通过 this.recurrence 调用，不再设门面。

    // 展开"更多选项"（用于让自动填充的父任务等字段对用户可见）
    expandMoreOptions() {
        this.moreOptionsContent.style.display = 'block';
        this.moreOptionsToggle.classList.add('expanded');
        const toggleIcon = this.moreOptionsToggle.querySelector('.toggle-icon');
        if (toggleIcon) toggleIcon.textContent = '-';
    }

    // 为编辑模式添加周期性任务提示
    // 添加输入值变化监听
    addInputValueListeners() {
        const setError = (valid, msg) => {
            Object.assign(this.datetimeError.style, { display: valid ? 'none' : 'block' });
            this.datetimeError.textContent = valid ? '' : msg;
            const color = valid ? '' : 'var(--danger-color)';
            this.datePicker.style.borderColor = color;
            this.timeInput.style.borderColor = color;
        };

        const validate = () => {
            // 周期性任务没有日期时间输入，提醒时间由规则决定，无需校验
            if (this.recurrence.getScheduleMode() === 'recurring') {
                setError(true, '');
                return;
            }
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
                await Api.system.calendarPermission({ successCheck: () => true });
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

    // 构建任务列表查询参数。
    buildListQuery(page) {
        const categoryIdArg = this.currentFilter === 'all' ? null : this.currentFilter;
        const statusArg = this.statusFilter === 'all' ? null : this.statusFilter;
        const priorityArg = this.priorityFilter === 'all' ? null : this.priorityFilter;
        const dueDateArg = this.dueDateFilter === 'all' ? null : this.dueDateFilter;

        return {
            apiArgs: [
                page,
                this.pageSize,
                categoryIdArg,
                statusArg,
                priorityArg,
                dueDateArg,
                null,  // year
                null,  // month
                this.searchQuery || null,
                this.customDateFilter || null
            ]
        };
    }

    // 加载任务
    async loadTasks(fromZero = false) {
        // 递增令牌：使仍在飞行中的"加载更多"请求结果失效，避免旧数据追加到新列表
        this.listLoadToken++;
        this.autoFillCount = 0; // 重新加载后允许再次自动填充
        Utils.setLoading(true, '加载任务...');
        const { apiArgs } = this.buildListQuery(this.currentPage);
        await Api.tasks.list({
            apiArgs: apiArgs,
            onSuccess: (response) => {
                this.tasks = response.data.tasks;
                this.totalTasks = response.data.total;
                this.totalPages = response.data.total_pages;
                // 任务数据已更新，父任务缓存需重新拉取，避免展示过期的关联关系
                this.parentTaskMap = {};
                if (window.innerWidth > 480) {
                    // 大屏幕(大于480px)：使用表格分页模式，每页10条
                    this.renderer.renderTasks();
                    this.paginationControl.render();
                    // 隐藏无限下拉相关
                    this.infiniteScroll.hideLoadingMore();
                    this.infiniteScroll.hideNoMoreTasks();
                } else {
                    // 小屏幕：使用无限下拉模式
                    this.renderer.renderTasks();
                    this.infiniteScroll.init();
                }

                this.updateStats(fromZero);
                this.actions.updateCategoryCounts(fromZero);

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

    // ===== 列表渲染 / 任务定位 / 行内交互 =====
    // 实现见 js/features/todo/task-render.js、task-locate.js、row-interactions.js，
    // 统一通过 this.renderer / this.locator / this.rowInteractions 调用。
    // 仅保留两个对外入口：revealTask（后端智能输入回调）、refresh（App.refreshData 通用刷新契约）。

    // 外部入口（快捷键 / 智能输入窗口）新建任务后由后端回调：刷新并定位新任务
    revealTask(taskId) {
        return this.locator.revealTask(taskId);
    }

    // 供 App.refreshData() 统一调用（主窗口重新可见时同步任务列表）
    refresh() {
        return this.locator.refresh();
    }

    // 保证分类名称缓存可用（渲染任务 HTML 之前调用）。
    // 侧边栏 CategoryManager 在初始化及每次分类增删改时都会重新拉取全量分类，
    // 其 categories 可直接作为缓存源，避免每次渲染都额外请求一次接口。
    async ensureCategoryMap() {
        const cached = Array.isArray(window.categoryManager?.categories)
            ? window.categoryManager.categories
            : null;
        if (cached && cached.length > 0) {
            this.cacheCategories(cached);
            return;
        }
        if (this.categoryMap.size > 0) return;

        await Api.categories.list({
            onSuccess: (response) => this.cacheCategories(response.data || [])
        });
    }

    // 同步用侧边栏缓存刷新名称（下拉追加时不能 await，否则会打乱新节点与"到底"提示的插入顺序）
    syncCategoryMap() {
        const cached = Array.isArray(window.categoryManager?.categories)
            ? window.categoryManager.categories
            : null;
        if (cached && cached.length > 0) this.cacheCategories(cached);
    }

    cacheCategories(categories) {
        this.categoryMap = new Map(categories.map(cat => [String(cat.id), cat.name]));
    }

    // 取分类名称：拿不到时回退为"未知分类"，不再输出"加载中"占位
    getCategoryName(categoryId) {
        return this.categoryMap.get(String(categoryId)) ||
            window.languageManager.getText('unknownCategory', '未知分类');
    }
    
    // ===== 任务操作：实现见 js/features/todo/task-actions.js =====
    // 统一通过 this.actions 调用；仅 deleteTask 保留为对外入口（timeline.js 调用）。

    // 删除任务
    deleteTask(taskId) {
        return this.actions.deleteTask(taskId);
    }

    // ===== 任务表单：实现见 js/features/todo/task-form.js =====
    // 统一通过 this.form 调用，不再设门面。

    // 查看任务详情
    async viewTaskDetails(taskId) {
        let task = this.tasks.find(t => t.id === taskId);

        // 如果当前页任务中不存在该任务，再查询数据库
        if (!task) {
            await Api.tasks.get({
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

        await Api.relations.parent({
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

        await Api.relations.children({
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

        // 分类名称直接写进详情 HTML，避免依赖弹窗弹出后再异步回填
        await this.ensureCategoryMap();

        const categoryName = task.categoryId ? this.getCategoryName(task.categoryId) : '';
        const detailContent = `
            <div style="padding: 20px;">
                <div style="margin-bottom: 20px;">
                    <h3 style="font-size: 20px; color: var(--text-primary); margin-bottom: 10px;">
                        ${Utils.escapeHtml(task.title)}
                        ${task.isRecurring ? `<span class="recurring-badge">${window.languageManager.getText('recurrenceType', '周期性')}</span>` : ''}
                        ${task.parentTaskId ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                    </h3>
                    <p class="task-detail-description">${task.description
                        ? Utils.escapeHtml(task.description.replace(/\r\n/g, '\n'))
                        : window.languageManager.getText('noTaskDescription', '无描述')}</p>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('taskStatus', '状态')}</strong>
                        <span style="padding: 6px 12px; border-radius: 8px; font-size: 14px; font-weight: 500;
                              ${task.completed ? 'background-color: var(--success-color); color: var(--on-success);' : 'background-color: var(--priority-medium); color: var(--on-priority-medium);'}">
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
                            ${task.categoryId ? `📁 ${Utils.escapeHtml(categoryName)}` : window.languageManager.getText('uncategorized', '无分类')}
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

    // ===== 分页：实现见 js/features/todo/pagination.js =====
    // 统一通过 this.paginationControl 调用，不再设门面。

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

            Api.stats.summary({
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

    // ===== 标签筛选状态访问（对标签模块与统计模块的统一出口） =====
    // 实现见 js/features/todo/search.js，统一通过 this.search 调用。
    // 仅保留三个对外入口：getTagFilterNames（stats.js 读取当前标签筛选）、
    // clearSearchChips / updateSearchClearButton（main.js 数据热重载）。

    // 列表筛选中的标签名称（供统计等模块展示当前标签筛选）
    getTagFilterNames() {
        return this.search.getTagFilterNames();
    }

    // 清空全部搜索 chips（不触发重新加载，由调用方决定何时 loadTasks）
    clearSearchChips() {
        return this.search.clearChips();
    }

    // 更新搜索清空按钮状态
    updateSearchClearButton() {
        return this.search.updateClearButton();
    }

    // 统计视图处于前台时，让统计按当前筛选（分类 + 左侧点选的标签 chips）刷新。
    // 仅刷新统计数据，不改变统计视图已选的时间范围/周期。
    _syncStatsFilterIfVisible() {
        const cm = window.calendarManager;
        if (cm && cm.currentView === 'stats' && window.statsManager) {
            window.statsManager.reloadStatsIfVisible();
        }
    }

    // 判断是否为移动端或小屏幕
    isMobileDevice() {
        return window.innerWidth <= 480;
    }

    // ===== 无限下拉：实现见 js/features/todo/infinite-scroll.js =====
    // 统一通过 this.infiniteScroll 调用；仅 resetInfiniteScroll 保留为对外入口
    // （main.js / category.js / calendar.js 在筛选变化后重置下拉状态）。

    // 重置无限下拉状态（仅重置状态，加载由调用方负责，避免重复请求）
    resetInfiniteScroll() {
        this.infiniteScroll.reset();
    }

    // 处理窗口大小变化
    handleResize() {
        const isLargeScreen = window.innerWidth > 480;

        if (isLargeScreen) {
            // 切换到大屏幕：使用分页模式，每页10条
            logger.info('Switching to large screen mode');

            // 设置列表为表格布局
            this.tasksList.style.display = 'table';

            // 移除无限下拉（同时清理加载提示与待执行的自动填充）
            this.infiniteScroll.removeScrollListener();
            this.infiniteScroll.clearAutoFillTimer();
            this.infiniteScroll.hideLoadingMore();
            this.infiniteScroll.hideNoMoreTasks();

            // 显示分页
            this.pagination.style.display = 'flex';

            // 如果当前页不是第一页，重置到第一页
            if (this.currentPage > 1) {
                this.currentPage = 1;
                this.loadTasks();
            } else {
                this.renderer.renderTasks();
                this.paginationControl.render();
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
                this.renderer.renderTasks();
            }

            // 隐藏分页
            this.pagination.style.display = 'none';

            // 初始化无限下拉
            this.infiniteScroll.init();
        }
    }

}

// 创建全局实例
window.todoManager = new TodoManager();

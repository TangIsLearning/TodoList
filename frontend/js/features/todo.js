// 任务管理模块
//
// 列定义与周期规则兜底文案已移至 js/features/todo/constants.js（须先加载）。
// 列表渲染、无限下拉、周期规则、搜索 chips 等子模块见 js/features/todo/ 目录。

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
        this.visibleColumns = TASK_LIST_COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key);
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
            onChange: () => this.clearRecurrencePreview()
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
            getFilterTagIds: () => this.getTagFilterIds(),
            // 点击左侧标签：切换对应的标签 chip
            onToggleFilterTag: (tagId) => this.toggleTagChip(tagId),
            // 标签重命名：同步筛选 chip 的显示文本，返回该标签是否正处于筛选中
            onTagRenamed: (tagId, newName) => {
                let chipRenamed = false;
                this.searchChips.forEach(chip => {
                    if (chip.type === 'tag' && chip.tagId === tagId) {
                        chip.value = newName;
                        chipRenamed = true;
                    }
                });
                if (chipRenamed) this.renderSearchChips();
                return chipRenamed;
            },
            // 标签删除：移除对应筛选 chip 并重新搜索
            onTagDeleted: (tagId) => {
                if (this.removeSearchChipByTagId(tagId)) this.syncSearchQuery(0);
            },
            // 标签数据变化：刷新任务列表；resyncSearch 为真时连搜索条件一起重算
            onTagsChanged: ({ resyncSearch } = {}) => {
                if (resyncSearch) this.syncSearchQuery(0);
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
        this.initInfiniteScroll();

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

        // 时间设置：单次任务 / 周期性任务切换
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.updateScheduleMode());
        });

        // 周期配置：模式 / 周期 / 提醒方式 / 结束方式切换
        document.querySelectorAll('input[name="recurrence-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.updateRecurrencePanels());
        });
        document.querySelectorAll('input[name="daily-mode"]').forEach((radio) => {
            radio.addEventListener('change', () => this.updateRecurrencePanels());
        });
        this.recurrenceType?.addEventListener('change', () => this.updateRecurrencePanels());
        this.recurrenceEndType?.addEventListener('change', () => this.updateRecurrencePanels());
        this.recurrenceAddTime?.addEventListener('click', () => this.addRecurrenceTimeChip());
        this.recurrencePreviewBtn?.addEventListener('click', () => this.previewRecurrence());

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
            this.clearRecurrencePreview();
        });

        // 绑定分页相关的监听事件
        this.firstBtn?.addEventListener('click', () => this.goToPage(1));
        this.prevBtn?.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        this.nextBtn?.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        this.lastBtn?.addEventListener('click', () => this.goToPage(this.totalPages));
        this.pageSizeSelect?.addEventListener('change', (e) => this.changePageSize(e.target.value));

        // 任务列表显示列配置
        this.bindColumnConfigEvents();

        // 语言切换后刷新列表（表头与列内容文案跟随语言变化），
        // 并重建周期性任务的星期 / 日期选择器文案（保留已选值）
        window.languageManager?.addObserver?.(() => {
            this.renderTasks();
            this.initRecurrencePickers();
            // 「截止日期 / 起始日期」标签随模式切换，语言变化后需要重新渲染
            this.updateScheduleMode();
        });
    }

    // ============ 任务列表显示列配置 ============
    // 实现见 js/features/todo/columns.js；以下为对外保留的门面方法

    // 当前显示的列
    getVisibleColumns() {
        return this.columns.getVisibleColumns();
    }

    // 判断指定列是否显示
    isColumnVisible(key) {
        return this.columns.isColumnVisible(key);
    }

    // 依据当前显示的列计算列宽与表格最小宽度
    getColumnLayout() {
        return this.columns.getColumnLayout();
    }

    // 读取列配置：数据库为唯一来源，localStorage 仅用于首屏兜底
    loadColumnConfig() {
        return this.columns.loadConfig();
    }

    // 绑定列配置相关事件
    bindColumnConfigEvents() {
        this.columns.bindEvents();
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

        // 默认回到「单次任务」
        if (this.scheduleModeOnce) this.scheduleModeOnce.checked = true;
        this.recurringOptions.style.display = 'none';
        this.datePicker.required = false;
        this.timeInput.required = false;

        this.recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
        this.resetRecurrenceConfig();
    }

    // ============ 周期性任务规则配置 ============
    // 实现见 js/features/todo/recurrence.js；以下为对外保留的门面方法

    // 重置周期规则的全部控件到默认状态
    resetRecurrenceConfig() {
        this.recurrence.reset();
    }

    // 构建星期 / 每月日期 / 每年月日的选项（语言切换时重建，默认保留已选值）
    initRecurrencePickers({ clear = false } = {}) {
        this.recurrence.initPickers({ clear });
    }

    // 新增一个提醒时间点输入项
    addRecurrenceTimeChip(value = '') {
        this.recurrence.addTimeChip(value);
    }

    // 按当前模式 / 周期显示对应的配置项
    updateRecurrencePanels() {
        this.recurrence.updatePanels();
    }

    // 收集当前表单上的周期规则
    collectRecurrenceRule() {
        return this.recurrence.collectRule();
    }

    // 校验周期规则，返回错误文案的 i18n key（通过时返回 null）
    validateRecurrenceRule(rule) {
        return this.recurrence.validateRule(rule);
    }

    clearRecurrencePreview() {
        this.recurrence.clearPreview();
    }

    // 预览周期规则接下来会产生的提醒时间
    previewRecurrence() {
        return this.recurrence.preview();
    }

    // 为编辑模式添加周期性任务提示
    addRecurringEditNotice() {
        this.recurrence.addEditNotice();
    }

    // 移除编辑模式提示
    removeRecurringEditNotice() {
        this.recurrence.removeEditNotice();
    }

    // 当前时间设置模式：once（单次带截止时间） / recurring（周期性任务）
    getScheduleMode() {
        return this.recurrence.getScheduleMode();
    }

    // 周期起始日期：规则里已包含完整周期配置，默认从今天开始，无需用户填写
    getTodayISO() {
        return this.recurrence.getTodayISO();
    }

    // 切换「单次任务 / 周期性任务」：两者并列互斥，切换后只展示对应配置
    updateScheduleMode() {
        this.recurrence.updateScheduleMode();
    }

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
            if (this.getScheduleMode() === 'recurring') {
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
                    this.renderTasks();
                    this.renderPagination();
                    // 隐藏无限下拉相关
                    this.hideLoadingMore();
                    this.hideNoMoreTasks();
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

    // ===== 列表渲染：实现见 js/features/todo/task-render.js =====
    // 以下为对外保留的门面方法

    // 渲染任务列表
    async renderTasks() {
        return this.renderer.renderTasks();
    }

    // 创建单个任务元素的 HTML（无限下拉追加时也需要）
    createTaskElement(task) {
        return this.renderer.createTaskElement(task);
    }

    // ===== 任务定位：实现见 js/features/todo/task-locate.js =====
    // 以下为对外保留的门面方法

    // 定位并高亮刚保存（新建/编辑）的任务
    highlightPendingTask() {
        this.locator.highlightPending();
    }

    // 外部入口（快捷键 / 智能输入窗口）新建任务后由后端回调：刷新并定位新任务
    revealTask(taskId) {
        return this.locator.revealTask(taskId);
    }

    // 查询指定任务在当前筛选条件下的页码
    findTaskPage(taskId) {
        return this.locator.findTaskPage(taskId);
    }

    // 供 App.refreshData() 统一调用（主窗口重新可见时同步任务列表）
    refresh() {
        return this.locator.refresh();
    }

    // 删除前播放任务离场动画
    animateTaskRemoval(taskId) {
        return this.locator.animateRemoval(taskId);
    }

    // ===== 行内交互：实现见 js/features/todo/row-interactions.js =====

    // 绑定任务事件（root 用于限定作用域，无限下拉追加时只处理新增节点）
    bindTaskEvents(root = document) {
        return this.rowInteractions.bindEvents(root);
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
    // 以下为对外保留的门面方法

    // 切换任务状态
    toggleTask(taskId) {
        return this.actions.toggleTask(taskId);
    }

    // 查找任务在列表中的复选框与所在行
    getTaskToggleTarget(taskId) {
        return this.actions.getTaskToggleTarget(taskId);
    }

    // 删除任务
    deleteTask(taskId) {
        return this.actions.deleteTask(taskId);
    }

    // 更新分类任务数量
    updateCategoryCounts(fromZero = false) {
        return this.actions.updateCategoryCounts(fromZero);
    }

    // ===== 任务表单：实现见 js/features/todo/task-form.js =====
    // 以下为对外保留的门面方法

    // 显示添加任务模态框
    showAddTaskModal() {
        this.form.showAddModal();
    }

    // 编辑任务
    editTask(taskId) {
        return this.form.editTask(taskId);
    }

    // 处理任务表单提交
    handleTaskSubmit(e) {
        return this.form.submit(e);
    }

    // 加载父任务列表（父任务选择器下拉用）
    loadParentTasks(isNewSearch = false) {
        return this.form.loadParentTasks(isNewSearch);
    }

    // 初始化父任务选择器
    initParentTaskCombobox() {
        this.form.initCombobox();
    }

    // 加载子任务数量并更新显示
    loadSubtaskCounts(scope = document) {
        return this.form.loadSubtaskCounts(scope);
    }

    // 绑定子任务数量徽章点击事件
    bindSubtaskCountEvents(scope = document) {
        this.form.bindSubtaskCountEvents(scope);
    }

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
    // 以下为对外保留的门面方法

    // 渲染分页组件
    renderPagination() {
        this.paginationControl.render();
    }

    // 跳转到指定页
    goToPage(page) {
        return this.paginationControl.goToPage(page);
    }

    // 更改每页显示数量
    changePageSize(pageSize) {
        return this.paginationControl.changePageSize(pageSize);
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
    // 实现见 js/features/todo/search.js；以下为对外保留的门面方法

    // 列表筛选中的标签 id（尚无 id 的名称型 chip 不在其中）
    getTagFilterIds() {
        return this.search.getTagFilterIds();
    }

    // 列表筛选中的标签名称（供统计等模块展示当前标签筛选）
    getTagFilterNames() {
        return this.search.getTagFilterNames();
    }

    // 清空全部搜索 chips（不触发重新加载，由调用方决定何时 loadTasks）
    clearSearchChips() {
        return this.search.clearChips();
    }

    // 初始化搜索标签输入框
    initSearchTagInput() {
        this.search.initInput();
    }

    // 添加一个搜索 chip
    addSearchChip(chip) {
        return this.search.addChip(chip);
    }

    // 全量重建所有 chips（用于标签重命名、批量替换筛选等场景）
    renderSearchChips() {
        this.search.renderChips();
    }

    // 若输入框内容是完整的 #标签，提交为 chip（用于搜索按钮点击）
    commitInputAsChipIfTag() {
        this.search.commitInputAsChipIfTag();
    }

    // 按 tagId 移除 chip（用于标签模块取消选择）
    removeSearchChipByTagId(tagId) {
        return this.search.removeChipByTagId(tagId);
    }

    // 切换左侧标签的 chip 选择状态
    toggleTagChip(tagId) {
        this.search.toggleTagChip(tagId);
    }

    // 将 chips + 输入框文本转换为结构化查询对象
    buildSearchQuery() {
        return this.search.buildQuery();
    }

    // 同步 searchQuery、清空按钮、标签模块选中态，并触发搜索
    syncSearchQuery(delay = 0) {
        this.search.syncQuery(delay);
    }

    // 更新搜索清空按钮状态
    updateSearchClearButton() {
        this.search.updateClearButton();
    }

    // 清空搜索
    clearSearch() {
        return this.search.clear();
    }

    // 搜索框当前是否处于"按父任务查子任务"模式且已确定到具体父任务
    getSubtaskParentFilter() {
        return this.search.getParentFilter();
    }

    // 记录当前子任务搜索对应的父任务
    setSubtaskParent(id, title) {
        this.search.setParent(id, title);
    }

    // 隐藏子任务建议下拉
    hideSubtaskSuggestions() {
        this.search.hideSuggestions();
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
    // 以下为对外保留的门面方法，签名不变，供 todo.js 内部与 main.js 调用

    initInfiniteScroll() {
        this.infiniteScroll.init();
    }

    loadMoreTasks() {
        return this.infiniteScroll.loadMoreTasks();
    }

    hideLoadingMore() {
        this.infiniteScroll.hideLoadingMore();
    }

    hideNoMoreTasks() {
        this.infiniteScroll.hideNoMoreTasks();
    }

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

}

// 创建全局实例
window.todoManager = new TodoManager();

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

    // 定位并高亮刚保存（新建/编辑）的任务，便于确认结果落在了哪里
    highlightPendingTask() {
        const taskId = this._pendingHighlightTaskId;
        if (taskId === null || taskId === undefined) return;
        this._pendingHighlightTaskId = null;

        const row = this.tasksList.querySelector(
            `.task-item[data-task-id="${taskId}"], .small-screen-task-item[data-task-id="${taskId}"]`
        );
        if (!row) return; // 该任务可能已被当前筛选条件过滤掉

        row.scrollIntoView({
            block: 'center',
            behavior: Utils.prefersReducedMotion() ? 'auto' : 'smooth'
        });

        if (Utils.prefersReducedMotion()) return;
        row.classList.add('task-highlight');
        const clear = () => row.classList.remove('task-highlight');
        row.addEventListener('animationend', clear, { once: true });
        // 兜底：动画事件丢失时也要清掉高亮类（时长需大于 --anim-duration-emphasis）
        setTimeout(clear, 900);
    }

    // 外部入口（快捷键 / 智能输入窗口）新建任务后由后端回调：
    // 自动刷新列表并定位高亮新任务，用户无需手动刷新即可看到结果
    async revealTask(taskId) {
        if (!taskId) {
            await this.loadTasks(true);
            return;
        }

        // loadTasks() 结束后 renderTasks() 会消费该 id 并滚动高亮
        this._pendingHighlightTaskId = taskId;
        await this.loadTasks(true);

        // 新任务可能落在其它分页（排序按截止时间/优先级，不一定在第一页）
        const isVisible = () => this.tasks.some(task => task.id === taskId);
        if (!isVisible() && window.innerWidth > 480) {
            const targetPage = await this.findTaskPage(taskId);
            if (targetPage && targetPage !== this.currentPage) {
                this.currentPage = targetPage;
                this._pendingHighlightTaskId = taskId;
                await this.loadTasks(true);
            }
        }

        // 仍不可见：被当前筛选条件排除，明确告知任务已创建
        if (!isVisible()) {
            Utils.showToast(
                window.languageManager.getText('taskCreatedButFiltered', '任务已创建，但不在当前筛选结果中'),
                'info'
            );
        }

        if (window.timelineManager) window.timelineManager.renderTimeline();
        // 触发云端同步上传，保持与前端新建任务一致
        Api.tasks.triggerUpload({ successCheck: () => true });
        this.tagManager.loadModule(true);
    }

    // 查询指定任务在当前筛选条件下的页码，被筛选条件排除时返回 null
    async findTaskPage(taskId) {
        let page = null;
        await Api.tasks.page({
            apiArgs: [
                taskId,
                this.pageSize,
                this.currentFilter === 'all' ? null : this.currentFilter,
                this.statusFilter === 'all' ? null : this.statusFilter,
                this.priorityFilter === 'all' ? null : this.priorityFilter,
                this.dueDateFilter === 'all' ? null : this.dueDateFilter,
                null,  // year
                null,  // month
                this.searchQuery || null,
                this.customDateFilter || null
            ],
            successCheck: (result) => !!result && result.success !== false,
            onSuccess: (response) => { page = response?.data ?? null; }
        });
        return page;
    }

    // 供 App.refreshData() 统一调用（主窗口重新可见时同步任务列表）
    async refresh() {
        await this.loadTasks();
    }

    // 删除前播放任务离场动画，避免任务从列表中瞬间消失
    async animateTaskRemoval(taskId) {
        if (Utils.prefersReducedMotion()) return;

        const { row } = this.getTaskToggleTarget(taskId);
        if (!row) return;

        row.classList.add('is-removing');
        await Utils.wait(280);
    }
    
    // 绑定任务事件（root 用于限定作用域，无限下拉追加时只处理新增节点）
    async bindTaskEvents(root = document) {
        const scope = root || document;
        const isFullBind = scope === document;

        // 复选框点击
        scope.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.toggleTask(taskId);
            };
        });

        // 查看详情按钮(仅大屏幕)
        scope.querySelectorAll('.btn.view').forEach(btn => {
            btn.onclick = (e) => {
                const taskId = e.target.dataset.taskId;
                this.viewTaskDetails(taskId);
            };
        });

        // 全量绑定时先重置所有小屏幕任务项的样式，并解绑旧事件
        const itemsToBind = isFullBind
            ? scope.querySelectorAll('.small-screen-task-item')
            : [];

        Array.from(itemsToBind).forEach(item => {
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

        // 全量绑定时清空实例数组（增量绑定时保留已打开项的引用）
        if (isFullBind) this.instances = [];

        // 重新绑定（增量绑定时只包含新增节点）
        Array.from(scope.querySelectorAll('.small-screen-task-item')).forEach(item => {
            const content = item.querySelector('.task-header');
            if (!content) return;

            const actions = item.querySelector('.task-actions');

            // 操作区宽度以实际渲染宽度为准（样式见 media.css 小屏幕下的 .task-actions），
            // 避免硬编码值与样式不一致导致滑动距离和操作区错位
            const getActionsWidth = () => {
                const width = actions ? actions.offsetWidth : 0;
                return width > 0 ? width : 80;
            };

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

                    const actionsWidth = getActionsWidth();
                    let newLeft = state.currentLeft + deltaX;

                    // 边界限制
                    if (newLeft > 0) newLeft = 0;
                    if (newLeft < -actionsWidth) newLeft = -actionsWidth;

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

                const actionsWidth = getActionsWidth();

                // 判断是否打开
                if (state.currentX < -actionsWidth / 2) {
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
                    content.style.left = -actionsWidth + 'px';

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

        // 全局点击关闭（也要支持触摸）：只需绑定一次，避免无限下拉时重复叠加 document 监听
        if (!this._globalCloseHandlerBound) {
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
            this._globalCloseHandlerBound = true;
        }

        await this.loadSubtaskCounts(scope);

        // 绑定子任务数量徽章点击事件
        this.bindSubtaskCountEvents(scope);

        // 添加CSS样式防止移动端默认行为（只注入一次）
        if (!document.getElementById('small-screen-task-style')) {
            const style = document.createElement('style');
            style.id = 'small-screen-task-style';
            style.textContent = `
            .small-screen-task-item {
                user-select: none;
                -webkit-user-select: none;
            }
            /* 注意：不要再给 .task-header 加 will-change: transform。
               它会被提升为独立合成层，合成层的绘制边界按设备像素对齐，
               而外层操作区仍按精确的小数坐标绘制，于是部分任务项（高度取整后不凑巧的那些）
               会在卡片下边沿露出约 1px 的操作按钮颜色。
               这里滑动用的是 left（布局属性），will-change: transform 本来也不会带来任何性能收益。 */
        `;
            document.head.appendChild(style);
        }

        // 编辑按钮
        scope.querySelectorAll('.btn.edit').forEach(btn => {
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
        scope.querySelectorAll('.btn.delete').forEach(btn => {
            btn.onclick = async (e) => {
                const taskId = e.target.dataset.taskId;
                await this.deleteTask(taskId);
            };
        });
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
    
    // 切换任务状态
    async toggleTask(taskId) {
        // 获取当前任务状态
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        // 动效播放期间忽略重复点击，避免动画叠加、状态错乱
        if (this._completingTasks.has(taskId)) return;

        const { checkbox } = this.getTaskToggleTarget(taskId);
        const willComplete = !task.completed;
        // 等待后端响应期间给复选框一个呼吸提示，点击后即时反馈
        checkbox?.classList.add('is-checking');

        // 如果是要完成任务，检查是否有未完成的子任务
        if (willComplete) {
            let hasUnCompletedChildren = false;
            await Api.relations.children({
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
                checkbox?.classList.remove('is-checking');
                Utils.showToast(window.languageManager.getText('cannotCompleteWithUncompletedChildren',
                    '该任务存在未完成的子任务，请先完成所有子任务'), 'warning');
                return;
            }
        }

        await Api.tasks.toggle({
            apiArgs: [taskId],
            onSuccess: async (response) => {
                const completed = !!response.data.completed;
                // 更新本地数据
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    task.completed = completed;
                    task.updatedAt = response.data.updatedAt;
                }
                checkbox?.classList.remove('is-checking');

                // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                Utils.showToast(completed ?
                    window.languageManager.getText('taskCompleted', '任务已完成') :
                    window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                // 触发云端同步上传
                Api.tasks.triggerUpload({ successCheck: (response) => true });

                // 先播放完成/重开动效，动画结束后再刷新列表，避免突兀的状态跳变
                await this.playToggleAnimation(taskId, completed);
                this.loadTasks(true);
            },
            onError: (error) => {
                checkbox?.classList.remove('is-checking');
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            }
        });
    }

    // 查找任务在列表中的复选框与所在行（大屏表格行 / 小屏卡片）
    getTaskToggleTarget(taskId) {
        const id = String(taskId);
        const checkbox = Array.from(document.querySelectorAll('.task-checkbox'))
            .find(el => el.dataset.taskId === id) || null;
        const row = checkbox ? checkbox.closest('.task-item, .small-screen-task-item') : null;
        return { checkbox, row };
    }

    // 状态变化后，该任务是否会从当前筛选的列表中移除
    willLeaveCurrentList(completed) {
        if (completed) {
            // 除"全部/已完成"外，其余筛选只包含未完成任务，完成后会移出列表
            return this.statusFilter !== 'all' && this.statusFilter !== 'completed';
        }
        // 重新开启后只会在"已完成"筛选下移出列表
        return this.statusFilter === 'completed';
    }

    // 播放任务完成/重开动效：勾选弹跳 → 删除线扫过 → 高亮闪烁 →（必要时）离场
    async playToggleAnimation(taskId, completed) {
        if (Utils.prefersReducedMotion()) return;

        const { checkbox, row } = this.getTaskToggleTarget(taskId);
        // 列表已重绘、找不到对应节点时直接刷新，不空等动画时间
        if (!checkbox && !row) return;

        const title = row ? row.querySelector('.task-title') : null;

        this._completingTasks.add(taskId);
        try {
            row?.classList.toggle('completed', completed);
            row?.classList.add(completed ? 'complete-flash' : 'reopen-flash');
            checkbox?.classList.toggle('checked', completed);
            checkbox?.classList.add('check-pop');

            if (completed && title) {
                // 按实际文字宽度绘制删除线，避免划线超出标题
                const textWidth = this.measureTitleTextWidth(title);
                if (textWidth > 0) title.style.setProperty('--strike-w', `${textWidth}px`);
                title.classList.add('strike-sweep');
            }

            if (completed && checkbox) {
                Utils.burstConfetti(checkbox);
                Utils.popBubble(checkbox, '✓ ' + window.languageManager.getText('statusCompleted', '已完成'));
            }

            // 勾选弹跳 + 删除线扫过 + 高亮闪烁
            await Utils.wait(400);

            // 任务会移出当前列表时，先播放离场动画再刷新
            if (row && this.willLeaveCurrentList(completed)) {
                row.classList.add('is-leaving');
                await Utils.wait(280);
            }
        } finally {
            // 列表随后会整体重绘，这里清理临时类以避免动画类残留
            row?.classList.remove('complete-flash', 'reopen-flash', 'is-leaving');
            checkbox?.classList.remove('check-pop', 'is-checking');
            title?.classList.remove('strike-sweep');
            this._completingTasks.delete(taskId);
        }
    }

    // 量取标题首段纯文字的渲染宽度（标题节点内还包含周期/子任务等徽标）
    measureTitleTextWidth(titleEl) {
        const textNode = Array.from(titleEl.childNodes)
            .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!textNode) return 0;

        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, textNode.textContent.length);
        const width = range.getBoundingClientRect().width;
        range.detach?.();
        // 标题过长被省略号截断时，划线宽度不超过可见区域
        return Math.min(width, titleEl.clientWidth);
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

        // 搜索框正处于"按父任务查子任务"时，新建任务默认挂到该父任务下
        const subtaskParentFilter = this.getSubtaskParentFilter();

        // 记录打开弹窗时的列表筛选快照（分类 + 标签 + 父任务），提交后据此决定是否同步或清除筛选
        const currentCategory = this.currentFilter && this.currentFilter !== 'all' ? this.currentFilter : '';
        const currentTagIds = this.getTagFilterIds();
        // 新建模式下表单初始值即列表筛选值，因此"是否已筛选"与初始值一致
        this.taskFilterSnapshot = {
            categoryId: currentCategory,
            tagIds: currentTagIds,
            parentTaskId: subtaskParentFilter ? subtaskParentFilter.id : null,
            hasCategoryFilter: !!currentCategory,
            hasTagFilter: currentTagIds.length > 0,
            hasParentFilter: !!subtaskParentFilter
        };
        // 新建模式没有异步回显：父任务在下面同步预填，清理编辑模式遗留的回显状态
        this._parentEditToken++;
        this._parentInitPromise = null;
        this._parentPrefillDone = true;

        // 已选标签继承当前标签筛选（弹窗新建的临时标签在打开时统一丢弃）
        this.tagManager.beginForm(currentTagIds);

        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载分类选项并设置默认选中
        this.loadCategoryOptions(currentCategory);

        // 重置并初始化父任务选择器
        this.parentTaskState.editingTaskId = '';
        this.resetParentTaskCombobox();
        this.initParentTaskCombobox();

        // 搜索框存在父任务查询时，把该父任务预填到表单，新建的任务直接成为其子任务
        if (subtaskParentFilter) {
            this.selectParentTask({ id: subtaskParentFilter.id, title: subtaskParentFilter.title });
            // 展开更多选项，让自动填充的父任务对用户可见
            this.expandMoreOptions();
        }

        // 加载标签选择器
        this.tagManager.loadSelector();

        // 重置附件
        this.attachmentManager?.reset();

        Utils.ModalManager.show('task-modal');
    }
    
    // 初始化父任务选择器（只在首次打开时绑定，避免每次打开弹窗重复叠加监听器）
    initParentTaskCombobox() {
        if (this._parentComboboxBound) return;
        this._parentComboboxBound = true;

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
        
        // 点击其他地方关闭（按下与抬起都发生在下拉框之外才算，避免拖选文本时误关闭）
        let pressOutside = false;
        const markPressOrigin = (e) => {
            pressOutside = !this.parentTaskCombobox.contains(e.target);
        };
        document.addEventListener('pointerdown', markPressOrigin);
        document.addEventListener('mousedown', markPressOrigin);
        document.addEventListener('click', (e) => {
            const shouldClose = pressOutside && !this.parentTaskCombobox.contains(e.target);
            pressOutside = false;
            if (shouldClose) {
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
        await Api.tasks.list({
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
        this.parentTaskState.selectedTitle = task.title || '';
        this.taskParentDropdown.style.display = 'none';
        this.parentTaskState.isOpen = false;
    }
    
    // 重置父任务选择器
    resetParentTaskCombobox() {
        const results = document.querySelector('.combobox-results');
        
        this.taskParentInput.value = '';
        this.taskParent.value = '';
        this.parentTaskState.selectedId = '';
        this.parentTaskState.selectedTitle = '';
        this.parentTaskState.searchQuery = '';
        this.parentTaskState.currentPage = 1;
        this.parentTaskState.hasMore = false;
        
        if (results) results.innerHTML = '';
    }
    
    // 初始化父任务选择器（编辑模式）
    async initParentTaskForEdit(taskId) {
        // 每次打开编辑弹窗都递增令牌：上一次编辑的回显若晚于本次到达会被直接丢弃，
        // 否则旧任务的父任务会被写进当前表单，保存后把关联改到错误的父任务上
        const token = ++this._parentEditToken;
        this._parentPrefillDone = false;

        // 重置并初始化选择器
        this.parentTaskState.editingTaskId = taskId;
        this.resetParentTaskCombobox();
        this.initParentTaskCombobox();
        
        // 获取当前任务的父任务
        await Api.relations.parent({
            apiArgs: [taskId],
            onSuccess: (response) => {
                if (token !== this._parentEditToken) return;
                const parent = response.data;
                if (parent) {
                    this.taskParent.value = parent.id;
                    this.taskParentInput.value = parent.title;
                    this.parentTaskState.selectedId = parent.id;
                    this.parentTaskState.selectedTitle = parent.title || '';
                }
                // 回填任务原本关联的父任务，供保存后判断是否需要同步搜索框的父任务查询
                if (this.taskFilterSnapshot) {
                    this.taskFilterSnapshot.parentTaskId = parent ? parent.id : null;
                }
                this._parentPrefillDone = true;
            }
        });
    }
    
    // 加载子任务数量并更新显示（scope 用于限定作用域，默认全文档）
    async loadSubtaskCounts(scope = document) {
        const root = scope || document;
        // 同样先取快照：scope 可能是游离容器，
        // 节点在 await 期间就已被搬进文档，回调里再用 root 查询会查不到
        const subtaskCountEls = Array.from(root.querySelectorAll('.subtask-count'));
        if (subtaskCountEls.length === 0) return;

        const elByTaskId = new Map(subtaskCountEls.map(el => [el.dataset.taskId, el]));
        const taskIds = Array.from(elByTaskId.keys());

        // 并发请求，避免逐条 await 导致列表越大等待越久
        await Promise.all(taskIds.map(taskId => Api.relations.children({
            apiArgs: [taskId],
            onSuccess: (response) => {
                const children = response.data;
                if (children && children.length > 0) {
                    const countEl = elByTaskId.get(taskId);
                    if (countEl) {
                        const countSpan = countEl.querySelector('.count');
                        if (countSpan) countSpan.textContent = children.length;
                        countEl.style.display = 'inline';
                    }
                }
            }
        })));
    }
    
    // 绑定子任务数量徽章点击事件
    bindSubtaskCountEvents(scope = document) {
        const root = scope || document;
        root.querySelectorAll('.subtask-count').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                
                const count = el.querySelector('.count');
                const countValue = parseInt(count?.textContent || '0');
                
                if (countValue > 0) {
                    const taskTitle = el.dataset.taskTitle;
                    const taskId = el.dataset.taskId;
                    if (taskTitle) {
                        // 进入子任务搜索模式：填充 ">父任务名"
                        // 已有的标签 chips 会保留，与父任务条件在后端按 AND 组合
                        this.setSubtaskParent(taskId, taskTitle);
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

        // 设置已选标签（弹窗新建的临时标签在打开时统一丢弃）
        this.tagManager.beginForm(task.tags ? task.tags.map(t => t.id) : []);

        // 记录打开弹窗时的任务原分类/原标签与列表筛选状态，提交后据此决定是否同步筛选
        const filterCategoryId = this.currentFilter && this.currentFilter !== 'all' ? this.currentFilter : '';
        const filterTagIds = this.getTagFilterIds();
        this.taskFilterSnapshot = {
            categoryId: task.categoryId || '',
            tagIds: this.tagManager.getFormSelectedTagIds(),
            // 普通父子关联不在任务字段上（parentTaskId 只标记周期任务实例），
            // 这里先留空，由 initParentTaskForEdit 异步回填任务原本关联的父任务
            parentTaskId: null,
            hasCategoryFilter: !!filterCategoryId,
            hasTagFilter: filterTagIds.length > 0,
            // 编辑模式下以搜索框是否处于父任务查询为准，与任务自身是否有父任务无关
            hasParentFilter: !!this.getSubtaskParentFilter()
        };

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
        // 保存 Promise：提交前需等待父任务回显完成，避免误判为"用户移除了父任务"
        this._parentInitPromise = this.initParentTaskForEdit(task.id);
        
        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载标签选择器
        this.tagManager.loadSelector();

        // 加载已有附件
        this.attachmentManager?.loadFromTask(task);

        Utils.ModalManager.show('task-modal');
    }
    
    // 禁用周期模式切换（编辑模式下不允许把任务改成周期性任务）
    disableRecurringOptions() {
        // 固定为「单次任务」
        if (this.scheduleModeOnce) this.scheduleModeOnce.checked = true;
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.disabled = true;
        });
        document.getElementById('schedule-mode-switch')?.classList.add('is-disabled');

        // 隐藏周期性选项区域
        this.recurringOptions.style.display = 'none';
        this.datePicker.required = false;
        this.timeInput.required = false;
        this.resetRecurrenceConfig();
        this.updateScheduleMode();
    }
    
    // 启用周期模式切换（新建任务模式下允许）
    enableRecurringOptions() {
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.disabled = false;
        });
        document.getElementById('schedule-mode-switch')?.classList.remove('is-disabled');
        if (this.scheduleModeOnce) this.scheduleModeOnce.checked = true;

        // 确保周期性选项区域是隐藏的（默认状态）
        this.recurringOptions.style.display = 'none';
        this.resetRecurrenceConfig();
        this.updateScheduleMode();
    }
    
    // 加载分类选项
    async loadCategoryOptions(selectedId = '') {
        await Api.categories.list({
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

        // 周期性任务不再要求填写起始日期，默认从今天开始；提醒时间点由周期规则决定
        const isRecurringTask = !isEdit && this.getScheduleMode() === 'recurring';

        if (!isRecurringTask) {
            const dateTimeValidation = BusinessUtils.DateTimeValidator.validateDateTime(dateStr, timeStr);
            if (!dateTimeValidation.valid) {
                Utils.showToast(dateTimeValidation.message, 'warning');
                return;
            }
        }

        let isoDateStr = null;
        if (dateStr && timeStr) isoDateStr = `${dateStr}T${timeStr}`;
        else if (dateStr) isoDateStr = dateStr;
        if (isRecurringTask) isoDateStr = this.getTodayISO();

        // 编辑模式下父任务由 initParentTaskForEdit 异步回显，必须先等它结束再取值：
        // 否则"尚未回显"会被当成"用户移除了父任务"，保存时误删已有父子关联，
        // 表现就是修改子任务后，按父任务搜索再也查不到它。
        if (isEdit && this._parentInitPromise) {
            await this._parentInitPromise.catch(() => {});
        }

        const parentTaskId = this.taskParent.value || null;

        const taskData = {
            title: this.taskTitle.value.trim(),
            description: this.taskDescription.value.trim(),
            priority: this.taskPrioritySelect.value,
            categoryId: this.taskCategorySelect.value || null,
            dueDate: isoDateStr || null,
            tags: this.tagManager.getSelectedTagNames(),
            attachments: this.attachmentManager ? this.attachmentManager.getAttachments() : []
        };
        
        // 编辑模式下强制清除周期性任务相关数据
        if (!isEdit) {
            // 只有在新建模式下才允许设置周期性任务
            taskData.isRecurring = isRecurringTask;
            if (isRecurringTask) {
                const rule = this.collectRecurrenceRule();
                const errorKey = this.validateRecurrenceRule(rule);
                if (errorKey) {
                    Utils.showToast(window.languageManager.getText(errorKey, RECURRENCE_ERROR_MESSAGES[errorKey]), 'warning');
                    return;
                }
                taskData.recurrenceRule = rule;
                // 兼容旧字段：供列表展示与历史数据读取
                taskData.recurrenceType = rule.mode === 'cron' ? 'cron' : rule.freq;
                taskData.recurrenceCount = rule.endType === 'count' ? rule.count : null;
            } else {
                taskData.recurrenceRule = null;
                taskData.recurrenceType = null;
                taskData.recurrenceCount = null;
            }
        } else {
            // 编辑模式下确保不会提交周期性任务数据
            taskData.isRecurring = false;
            taskData.recurrenceType = null;
            taskData.recurrenceCount = null;
            taskData.recurrenceRule = null;
        }
        
        if (!taskData.title) {
            Utils.showToast(window.languageManager.getText('errorTitleRequired', '请输入任务标题'), 'warning');
            return;
        }

        let saveTask;
        let apiArgs;
        if (isEdit) {
            saveTask = Api.tasks.update;
            apiArgs = [editingId, taskData];
        } else {
            saveTask = taskData.isRecurring ? Api.tasks.addRecurring : Api.tasks.add;
            apiArgs = [taskData];
        }

        await saveTask({
            apiArgs: apiArgs,
            onSuccess: async (response) => {
                const message = isEdit ? window.languageManager.getText('taskUpdated', '任务更新成功') :
                    window.languageManager.getText('taskCreated', '任务创建成功');

                const taskId = isEdit ? editingId : response.data.id;

                // 后端保存后返回的标签带真实 id（新建的标签也已落库），用于同步列表筛选；
                // 周期性任务返回的是任务数组，取首个任务的标签即可（各实例标签一致）
                const savedTask = Array.isArray(response.data) ? response.data[0] : response.data;
                const savedTags = Array.isArray(savedTask && savedTask.tags) ? savedTask.tags : null;

                // 处理父任务关联
                try {
                    if (isEdit) {
                        if (!this._parentPrefillDone) {
                            // 父任务回显失败时无法判断用户是否改动过父任务，保持关联不变，
                            // 避免把"没取到原父任务"当成"用户移除了父任务"而误删关联
                            logger.warn('父任务回显未完成，跳过本次父子关联变更');
                        } else {
                            // 先读取当前父任务
                            let currentParentId = null;
                            await Api.relations.parent({
                                apiArgs: [taskId],
                                onSuccess: (res) => {
                                    currentParentId = res.data ? res.data.id : null;
                                }
                            });

                            // 仅在父任务确实发生变化时才更新关联，且由后端在同一事务内完成：
                            // 拆成"先删后加"两次调用时，中途失败会让子任务彻底丢失父任务，
                            // 表现为按父任务搜索查不到该子任务
                            if (currentParentId !== parentTaskId) {
                                await Api.relations.setParent({
                                    apiArgs: [taskId, parentTaskId],
                                    successCheck: () => true,
                                    onError: () => Utils.showToast(window.languageManager.getText('updateParentRelationFailed', '更新父任务关联失败'), 'warning')
                                });
                            }
                        }
                    } else if (parentTaskId) {
                        // 新建模式下直接添加关联
                        await Api.relations.add({
                            apiArgs: [taskId, parentTaskId],
                            successCheck: () => true,
                            onError: () => Utils.showToast(window.languageManager.getText('addParentRelationFailed', '添加父任务关联失败'), 'warning')
                        });
                    }
                } catch (error) {
                    Utils.showToast(window.languageManager.getText('updateParentRelationFailed', '更新父任务关联失败'), 'warning');
                }

                Utils.showToast(message, 'success');
                Utils.ModalManager.hide('task-modal');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (this.isMobileDevice()) this.resetInfiniteScroll(); // 重置无限下拉状态

                // 按表单中最终选择的分类/标签同步列表筛选
                const tagsModuleRefreshed = await this.syncFiltersAfterSave(
                    this.taskFilterSnapshot, taskData.categoryId, savedTags
                );
                this.taskFilterSnapshot = null;
                // 标签已随任务落库，清掉弹窗内的临时标签，避免与后端返回的真实标签重复
                this.tagManager.clearPending();

                // 列表刷新后定位并高亮这条任务
                this._pendingHighlightTaskId = taskId;
                this.loadTasks(true);
                window.timelineManager.renderTimeline();

                // loadTasks() 内部已经调用了 updateCategoryCounts()，不需要再调用 renderCategories()
                // renderCategories() 会重新获取所有任务（默认只取前10条），导致数据不准确

                // 触发云端同步上传
                Api.tasks.triggerUpload({ successCheck: (response) => true });
                if (!tagsModuleRefreshed) this.tagManager.loadModule(true);
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });
    }

    // 任务保存（新建/更新）完成后，按表单中用户最终选择的分类/标签同步列表筛选：
    // - 分类：分类被修改时，若原本存在分类筛选则跟随新分类，改为"未分类"则重置为全部（清除分类筛选）；
    //         原本不存在分类筛选时不做任何筛选调整
    // - 标签：标签被修改时，若原本存在标签筛选则改为筛选用户新选的标签，未选任何标签则清除标签筛选；
    //         原本不存在标签筛选时不做任何筛选调整。
    //         savedTags 为后端保存后返回的标签（含真实 id，新建标签也能直接拿到 id），
    //         传 null 表示调用方拿不到返回结构，此时不调整标签筛选项（保持现状，避免误清）。
    // - 父任务：父任务被修改时，若搜索框本身处于"按父任务查子任务"，则改为查询新的父任务；
    //         移除父任务则清空搜索框的父任务查询；搜索框没有父任务查询时不联动。
    // 返回值：是否已刷新过左侧标签模块
    async syncFiltersAfterSave(snapshot, categoryId, savedTags) {
        if (!snapshot) return false;
        let tagsModuleRefreshed = false;
        let filterChanged = false;

        // ===== 分类筛选 =====
        const chosenCategoryId = categoryId || '';
        if (chosenCategoryId !== snapshot.categoryId && snapshot.hasCategoryFilter) {
            // 选择"未分类"时清除分类筛选
            const nextFilter = chosenCategoryId || 'all';
            this.currentFilter = nextFilter;
            if (window.categoryManager) {
                window.categoryManager.currentCategory = nextFilter;
                window.categoryManager.setActiveCategory(nextFilter);
            }
            filterChanged = true;
        }

        // ===== 标签筛选 =====
        const presetTagIds = snapshot.tagIds || [];
        const chosenTagIds = this.tagManager.getFormSelectedTagIds();
        const isSameTags = chosenTagIds.length === presetTagIds.length &&
            chosenTagIds.every(id => presetTagIds.includes(id));

        if (!isSameTags && snapshot.hasTagFilter && Array.isArray(savedTags)) {
            // 直接用后端返回的标签（含真实 id）重建筛选，不再按名称反查，
            // 避免后端归一化/同名标签导致 chip 错配或丢失
            const chosenTagChips = savedTags
                .filter(tag => tag && tag.name)
                .map(tag => ({ type: 'tag', value: tag.name, tagId: tag.id || null, color: tag.color }));

            // 保留非标签类型的搜索 chip（如文本搜索），仅替换标签筛选部分
            this.searchChips = this.searchChips.filter(chip => chip.type !== 'tag').concat(chosenTagChips);
            this.renderSearchChips();

            // 表单中可能包含新建的标签，刷新左侧标签模块以纳入新标签与新计数；
            // 此时 chips 已更新，模块渲染会直接带上正确的选中态
            await this.tagManager.loadModule(true);
            tagsModuleRefreshed = true;
            filterChanged = true;
        }

        // ===== 父任务（子任务搜索）筛选 =====
        // chosenParentId 为表单中最终选择的父任务；搜索框本身没有父任务查询时不联动
        const chosenParentId = this.taskParent.value || null;
        if (snapshot.hasParentFilter && chosenParentId !== snapshot.parentTaskId) {
            this.hideSubtaskSuggestions();
            if (chosenParentId) {
                // 改为其他父任务：搜索框同步为新的父任务查询
                const parentTitle = (this.parentTaskState.selectedTitle || '').trim() ||
                    (this.taskParentInput.value || '').trim();
                this.setSubtaskParent(chosenParentId, parentTitle || null);
                this.searchInput.value = parentTitle ? `>${parentTitle}` : '';
            } else {
                // 移除父任务：同步移除搜索框的父任务查询
                this.setSubtaskParent(null, null);
                this.searchInput.value = '';
            }
            filterChanged = true;
        }

        if (filterChanged) {
            // 重新计算提交给后端的查询对象
            this.searchQuery = this.buildSearchQuery();
            this.updateSearchClearButton();
            // 筛选条件已变化，回到第一页重新加载
            this.currentPage = 1;
            this.resetInfiniteScroll();
        }

        return tagsModuleRefreshed;
    }
    
    // 删除任务
    async deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // 检查是否有子任务
        let checkChildrenFailed = false;
        await Api.relations.children({
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
        // 先播放离场动画，再真正删除
        await this.animateTaskRemoval(taskId);

        Utils.setLoading(true, '删除中...');
        await Api.tasks.remove({
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
                Api.tasks.triggerUpload({ successCheck: (response) => true });
                this.tagManager.loadModule(true);
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
            await Api.tasks.list({
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

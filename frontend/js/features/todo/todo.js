// 任务管理模块（核心）
//
// 本文件保留 TodoManager 的核心职责：状态、初始化、列表加载/渲染、任务完成切换。
// 其余功能以 mixin 方式拆分在同目录文件中（Object.assign(TodoManager.prototype, ...)）：
//   todo.columns.js       列表显示列配置
//   todo.recurrence.js    周期性任务规则编辑器
//   todo.modals.js        任务新建/编辑/详情/删除弹窗
//   todo.parentPicker.js  父任务选择器
//   todo.gesture.js       任务行事件与移动端侧滑/拖拽手势
//   todo.search.js        搜索 chips 与子任务搜索建议
//   todo.scroll.js        分页与无限滚动
// 本文件必须先于上述文件加载（实例化在本文件末尾，mixin 方法在 init 调用前已挂载）。

// 任务列表可配置的显示列
// fixedWidth：固定像素宽度列（内容长度可预期，不随窗口变宽而变宽）
// minWidth：弹性列（任务名称）的最小像素宽度，弹性列会占据表格剩余宽度
const TASK_LIST_COLUMN_DEFS = [
    { key: 'name', i18nKey: 'taskHeaderName', fallback: '任务名称', defaultVisible: true, locked: true, minWidth: 420 },
    { key: 'priority', i18nKey: 'taskHeaderPriority', fallback: '优先级', defaultVisible: true, fixedWidth: 100 },
    { key: 'dueDate', i18nKey: 'taskHeaderDueDate', fallback: '到期时间', defaultVisible: true, fixedWidth: 185 },
    { key: 'tags', i18nKey: 'taskHeaderTag', fallback: '标签', defaultVisible: true, fixedWidth: 145 },
    { key: 'category', i18nKey: 'taskHeaderCategory', fallback: '所属分类', defaultVisible: false, fixedWidth: 160 },
    { key: 'parentTask', i18nKey: 'taskHeaderParentTask', fallback: '关联父项任务', defaultVisible: false, fixedWidth: 170 },
    { key: 'attachments', i18nKey: 'taskHeaderAttachments', fallback: '任务附件', defaultVisible: false, fixedWidth: 130 },
    { key: 'createdAt', i18nKey: 'taskHeaderCreatedAt', fallback: '创建时间', defaultVisible: false, fixedWidth: 170 },
    { key: 'updatedAt', i18nKey: 'taskHeaderUpdatedAt', fallback: '更新时间', defaultVisible: false, fixedWidth: 170 }
];
// 操作列固定展示且不参与配置；内部是固定数量的按钮，使用固定像素宽度避免列变窄后换行变形
const TASK_LIST_ACTION_COLUMN = { key: 'actions', i18nKey: 'taskHeaderAction', fallback: '操作', fixedWidth: 150 };
// 任务名称列的最小像素宽度（同时保证不小于其他列中最宽一列的 2 倍）
const TASK_LIST_NAME_MIN_WIDTH = 420;
// 表格最小宽度（列较多时自动增大，保证列内容可读）
const TASK_LIST_MIN_WIDTH = 1060;
// 列配置本地缓存键（数据库为唯一来源，本地仅作首屏兜底）
const TASK_LIST_COLUMNS_CACHE_KEY = 'todolist_task_list_columns';

// 周期性任务规则校验失败的兜底文案（i18n key → 中文默认值）
const RECURRENCE_ERROR_MESSAGES = {
    errorRecurrenceTypeRequired: '请选择重复周期',
    errorRecurrenceCronRequired: '请输入 Cron 表达式',
    errorRecurrenceTimesRequired: '请至少添加一个提醒时间点',
    errorRecurrenceWeekdaysRequired: '请至少选择一个星期',
    errorRecurrenceMonthDaysRequired: '请至少选择一个日期',
    errorRecurrenceYearlyRequired: '请选择有效的月份和日期',
    errorRecurrenceIntervalRequired: '请填写完整的时间段',
    errorRecurrenceIntervalOrder: '时间段结束时间需晚于开始时间',
    errorRecurrenceIntervalMinutes: '间隔分钟需在 1-1440 之间',
    errorRecurrenceCountRequired: '请输入有效的循环次数',
    errorRecurrenceEndDateRequired: '请选择有效的结束日期',
    errorRecurrenceTimesLimit: '提醒时间点数量已达上限',
};

// 标签相关常量（TAG_INPUT_PATTERN 等）与 TagManager 均定义在 js/features/tag.js，
// 该文件必须在本文件之前引入。


class TodoManager {
    constructor() {
        this.instances = [];
        this.tasks = [];
        this.currentFilter = 'all';
        // 结构化查询对象：
        // { tags: [{id?, name}], keywords: [...], parent: {id?, name?} | null, dueDate: 'YYYY-MM-DD' | null }
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
        // 任务列表是否已完成首帧渲染：首帧没有旧内容可言，不播淡出/淡入动画避免启动闪动
        this._listRenderedOnce = false;
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
        // DOM 元素缓存与统一管理
        this.cacheDomRefs();
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
    // trigger 非空时由它触发弹出（如搜索栏的 📅 按钮），输入框可以是不参与布局的隐藏框。
    createDatePicker(field, { onChange, trigger } = {}) {
        if (!field) return null;
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        return new Pikaday({
            field,
            trigger,
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
            // 若输入框中是完整的 #标签 / @截止日期，先提交为 chip
            this.commitInputAsChip();
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

    // 批量加载当前列表任务的父任务（供"关联父项任务"列使用）
    async loadParentTaskMap() {
        const ids = this.tasks
            .filter(task => task && task.id && !(task.id in this.parentTaskMap))
            .map(task => task.id);
        if (ids.length === 0) return;

        await Utils.apiCall({
            apiMethod: 'get_parents_map',
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

    // 构建列表筛选条件对象（键名与后端 TaskFilter 一致）。
    // 分页查询（get_todos）与定位查询（get_task_page）共用这一份条件，
    // 避免两处各自维护一串位置参数、新增筛选维度时改漏其中一处。
    buildListFilter() {
        return {
            categoryId: this.currentFilter === 'all' ? null : this.currentFilter,
            status: this.statusFilter === 'all' ? null : this.statusFilter,
            priority: this.priorityFilter === 'all' ? null : this.priorityFilter,
            dueDateFilter: this.dueDateFilter === 'all' ? null : this.dueDateFilter,
            searchQuery: this.searchQuery || null,
            dueDate: this.customDateFilter || null
        };
    }

    // 筛选条件签名：用于区分"这一轮取数是因为筛选变了"还是"只是数据变了/翻页了"。
    // 直接复用 buildListFilter 的归一化结果（'all' 已折算成 null）；
    // 分页位置不属于筛选，不计入，因此翻页不会触发广播。
    _filterSignature() {
        return JSON.stringify(this.buildListFilter());
    }

    // 仅在筛选条件真的发生变化时才广播筛选变化。
    // 增删改这类数据变更同样会走 loadTasks，但它们属于 notifyDataChanged 的范畴；
    // 若不加以区分地再广播一次，处于前台的视图会在同一次操作里被要求取数两遍。
    _notifyFilterChangedIfChanged() {
        const signature = this._filterSignature();
        if (signature === this._lastFilterSignature) return;
        this._lastFilterSignature = signature;
        window.App?.notifyFilterChanged();
    }

    // 构建任务列表查询参数：[筛选条件, 页码, 每页数量]
    buildListQuery(page) {
        return {
            apiMethod: 'get_todos',
            apiArgs: [this.buildListFilter(), page, this.pageSize]
        };
    }

    // 加载任务
    async loadTasks(fromZero = false) {
        // 递增令牌：使仍在飞行中的"加载更多"请求结果失效，避免旧数据追加到新列表
        this.listLoadToken++;
        this.autoFillCount = 0; // 重新加载后允许再次自动填充
        Utils.setLoading(true, '加载任务...');
        const { apiMethod, apiArgs } = this.buildListQuery(this.currentPage);
        await Utils.apiCall({
            apiMethod: apiMethod,
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

                // 分类计数与顶部统计条口径均为全局，与列表筛选无关，
                // 已各自收敛到 category / stats 模块，由 App.notifyDataChanged 在数据变更时刷新

                // 同步分类筛选状态
                if (window.categoryManager) window.categoryManager.setActiveCategory(this.currentFilter);

                // 筛选条件若发生变化，交由通知中心广播；由各视图自行判断是否处于前台
                // 并决定是否取数，这里不点名任何具体视图（翻页与纯数据变更不会触发）
                this._notifyFilterChangedIfChanged();
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('loadingTaskFailed', '加载任务失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });

    }
    
    // 渲染任务列表
    async renderTasks() {
        // 首帧没有"旧内容"可以淡出，也不该再淡入：否则会看到列表由半透明亮起（表现为启动闪一下）。
        // 之后的刷新（筛选 / 翻页 / 保存）才走淡出→淡入，避免内容瞬间跳变。
        const isFirstPaint = !this._listRenderedOnce;
        this._listRenderedOnce = true;

        // 列表内容变化（筛选/翻页/保存等）时先淡出，数据就绪后再淡入，避免内容瞬间跳变
        if (!isFirstPaint && !Utils.prefersReducedMotion()) this.tasksList.classList.add('list-refreshing');

        if (this.tasks.length === 0) {
            this.tasksList.style.setProperty('display', 'none', 'important');
            this.emptyState.style.display = 'block';
            // 隐藏分页
            this.pagination.style.display = 'none';
            this.finishListRefresh(isFirstPaint);
            return;
        }

        // 根据屏幕尺寸设置display样式 (大于480px使用表格布局)
        const isLargeScreen = window.innerWidth > 480;
        this.tasksList.style.display = isLargeScreen ? 'table' : 'flex';
        this.emptyState.style.display = 'none';

        // 生成HTML
        let html = '';

        // 大屏幕添加表头（列由用户配置决定）
        if (isLargeScreen) {
            // 展示"关联父项任务"列时需要父任务信息，统一批量查询避免逐条请求
            if (this.isColumnVisible('parentTask')) await this.loadParentTaskMap();

            const layout = this.getColumnLayout();
            this.tasksList.style.minWidth = `${layout.minWidth}px`;

            const configTip = Utils.escapeHtml(window.languageManager.getText('columnConfigTip', '配置列表查看列'));
            // 操作列表头：文案与设置图标置于弹性容器中，中英文文案变长时图标也不会被挤出列外
            const headerCells = layout.columns.map(col => `
                <div class="tasks-header-cell" data-column="${col.key}" style="width: ${col.width};">
                    ${col.key === 'actions' ? `
                    <span class="tasks-header-actions">
                        <span class="tasks-header-label" title="${Utils.escapeHtml(col.label)}">${Utils.escapeHtml(col.label)}</span>
                        <button type="button" id="task-columns-setting-btn" class="btn btn--colorless column-config-btn"
                                title="${configTip}">⚙️</button>
                    </span>` : Utils.escapeHtml(col.label)}
                </div>
            `).join('');

            html += `
                <div class="tasks-header">
                    <div class="tasks-header-row">
                        ${headerCells}
                    </div>
                </div>
            `;
        } else {
            this.tasksList.style.minWidth = '';
        }

        // 分类名称必须在拼 HTML 之前就绪：名称会被直接写进 HTML，
        // 不再依赖"渲染占位符 + 渲染后异步回填"，也就不会出现永远停在占位状态的任务
        await this.ensureCategoryMap();

        html += this.tasks.map(task => this.createTaskElement(task)).join('');
        this.tasksList.innerHTML = html;

        // 绑定任务事件
        await this.bindTaskEvents();

        // 取消淡出并播放入场淡入（首帧不播放，列表直接就位）
        this.finishListRefresh(isFirstPaint);
        // 新建/编辑保存后定位并高亮对应任务
        this.highlightPendingTask();
    }

    // 列表刷新收尾：取消淡出态并重新播放淡入动画
    // skipAnimation：首帧没有旧内容可言，跳过动画直接就位，避免启动时列表由半透明亮起
    finishListRefresh(skipAnimation = false) {
        if (skipAnimation || Utils.prefersReducedMotion()) return;

        this.tasksList.classList.remove('list-refreshing');
        // 先移除再强制重排，保证每次刷新都能重新播放动画
        this.tasksList.classList.remove('list-enter');
        void this.tasksList.offsetWidth;
        this.tasksList.classList.add('list-enter');
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

        // 新建/编辑任务属于数据变更，交由通知中心广播：
        // 时间轴等视图会在各自前台时自行重建（此前这里只点名了时间轴，
        // 漏掉了左侧分类计数与顶部统计条）
        window.App?.notifyDataChanged();
        this.tagManager.loadModule(true);
    }

    // 查询指定任务在当前筛选条件下的页码，被筛选条件排除时返回 null
    async findTaskPage(taskId) {
        let page = null;
        await Utils.apiCall({
            apiMethod: 'get_task_page',
            apiArgs: [taskId, this.buildListFilter(), this.pageSize],
            successCheck: (result) => !!result && result.success !== false,
            onSuccess: (response) => { page = response?.data ?? null; }
        });
        return page;
    }

    // 供 App.refreshData() 统一调用（主窗口重新可见时同步任务列表）
    async refresh() {
        // 按当前视图刷新：只有列表视图展示这份分页数据，时间轴与统计各自独立取数，
        // 日历走 get_calendar_tasks，停在其它视图时这一笔更没必要。
        // 切回列表 / 日历时 switchView 会各自重新取数，因此不存在数据陈旧。
        const view = window.viewManager?.currentView;
        if (view && view !== 'list') return;
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
    
    // 任务名称右侧的"复制任务"图标：点击后带全部信息打开新建弹窗，用于快捷创建同类任务。
    // 周期性任务（含周期实例）不支持复制，因为周期信息无法在新任务上重建
    createTaskCopyButton(task) {
        if (task.isRecurring || task.parentTaskId) return '';

        const tip = Utils.escapeHtml(window.languageManager.getText('taskCopyTip', '复制任务'));
        return `<button type="button" class="task-copy-btn" data-task-id="${task.id}" title="${tip}">📄</button>`;
    }

    // 创建任务元素
    createTaskElement(task) {
        const priorityInfo = Utils.getPriorityInfo(task.priority);
        // 只有未完成的任务才检查是否逾期
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);
        const isLargeScreen = window.innerWidth > 480;

        // 小屏卡片中时间徽标的悬浮文案（大屏表格列由 createTimestampCell 处理）
        const createdTimeLabel = Utils.escapeHtml(window.languageManager.getText('taskCreateTime', '创建时间'));
        const updatedTimeLabel = Utils.escapeHtml(window.languageManager.getText('taskUpdateTime', '更新时间'));

        // 操作按钮的悬浮文案（编辑按钮的提示会在 gesture 模块按任务类型修正为"周期性任务不支持编辑"）
        const viewTip = Utils.escapeHtml(window.languageManager.getText('taskViewTip', '查看'));
        const editTip = Utils.escapeHtml(window.languageManager.getText('normalTaskEditTip', '编辑'));
        const deleteTip = Utils.escapeHtml(window.languageManager.getText('taskDeleteTip', '删除'));

        // 渲染标签
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = task.tags.map(tag =>
                `<span class="task-tag" style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                </span>`
            ).join('');
        }

        // 大屏幕表格式布局（按用户配置的列渲染）
        if (isLargeScreen) {
            const cellCtx = { priorityInfo, isOverdue, tagsHtml };
            const cells = this.getVisibleColumns()
                .map(key => this.createTaskCell(task, key, cellCtx))
                .join('');

            return `
                <div class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}">
                    ${cells}
                    <div class="task-actions" data-column="actions">
                        <button class="btn view" data-task-id="${task.id}"
                                title="${viewTip}">👁️</button>
                        <button class="btn edit" data-task-id="${task.id}"
                                title="${editTip}">✏️</button>
                        <button class="btn delete" data-task-id="${task.id}"
                                title="${deleteTip}">🗑️</button>
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
                            <span class="task-title-text">${Utils.escapeHtml(task.title)}</span>
                            ${task.isRecurring ? `<span class="recurring-badge">${window.languageManager.getText('recurrenceType', '周期性')}</span>` : ''}
                            ${task.parentTaskId ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                            <span class="subtask-count" data-task-id="${task.id}" data-task-title="${Utils.escapeHtml(task.title)}" style="display: none; cursor: pointer;">📋 <span class="count">0</span></span>
                            ${this.createTaskCopyButton(task)}
                        </h3>
                        <p class="task-description">${task.description ? Utils.escapeHtml(task.description) : ''}</p>
                        <div class="task-meta">
                            <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                                ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                            </span>
                            ${task.categoryId ? `
                                <span class="task-category" data-category-id="${task.categoryId}"
                                      title="${Utils.escapeHtml(this.getCategoryName(task.categoryId))}">
                                    📁 ${Utils.escapeHtml(this.getCategoryName(task.categoryId))}
                                </span>
                            ` : ''}
                            ${tagsHtml ? `<div class="task-tags">${tagsHtml}</div>` : ''}
                            ${task.dueDate ? `
                                <span class="task-due-date ${isOverdue ? 'overdue' : ''}"
                                      title="截止时间">
                                    📅 ${Utils.formatDate(task.dueDate)}
                                </span>
                            ` : ''}
                            ${this.isColumnVisible('createdAt') && task.createdAt ? `
                                <span class="task-datetime" title="${createdTimeLabel}">
                                    🕒 ${Utils.formatDate(task.createdAt)}
                                </span>
                            ` : ''}
                            ${this.isColumnVisible('updatedAt') && task.updatedAt ? `
                                <span class="task-datetime" title="${updatedTimeLabel}">
                                    🕒 ${Utils.formatDate(task.updatedAt)}
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="btn view" data-task-id="${task.id}"
                                title="${viewTip}">👁️</button>
                    <button class="btn edit" data-task-id="${task.id}"
                            title="${editTip}">✏️</button>
                    <button class="btn delete" data-task-id="${task.id}"
                            title="${deleteTip}">🗑️</button>
                </div>
            </div>
        `;
    }

    // 按列 key 生成任务行中的单元格（大屏幕表格布局）
    createTaskCell(task, key, ctx) {
        const { priorityInfo, isOverdue, tagsHtml } = ctx;
        const empty = '<span class="task-cell-empty">-</span>';

        switch (key) {
            case 'name':
                return `
                    <div class="task-header" data-column="name">
                        <div class="task-header-content">
                            <div class="task-checkbox ${task.completed ? 'checked' : ''}"
                                 data-task-id="${task.id}"></div>
                            <div class="task-content">
                                <h3 class="task-title" title="${task.title}">
                                    <span class="task-title-text">${Utils.escapeHtml(task.title)}</span>
                                    ${(task.parentTaskId || task.isRecurring) ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                                    <span class="subtask-count" data-task-id="${task.id}" data-task-title="${Utils.escapeHtml(task.title)}" style="display: none; cursor: pointer;">📋 <span class="count">0</span></span>
                                    ${this.createTaskCopyButton(task)}
                                </h3>
                            </div>
                        </div>
                        <p class="task-description" style="display: none;">${task.description ? Utils.escapeHtml(task.description) : ''}</p>
                    </div>
                `;
            case 'priority':
                return `
                    <div class="task-cell is-nowrap" data-column="priority">
                        <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                            ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                        </span>
                    </div>
                `;
            case 'dueDate':
                return `
                    <div class="task-cell is-nowrap" data-column="dueDate">
                        ${task.dueDate ? `
                            <span class="task-due-date ${isOverdue ? 'overdue' : ''}" title="截止时间">
                                📅 ${Utils.formatDate(task.dueDate)}
                            </span>
                        ` : empty}
                    </div>
                `;
            case 'tags':
                return `
                    <div class="task-cell" data-column="tags">
                        ${tagsHtml || empty}
                    </div>
                `;
            case 'category':
                return `
                    <div class="task-cell" data-column="category">
                        ${task.categoryId ? `
                            <span class="task-category" data-category-id="${task.categoryId}"
                                  title="${Utils.escapeHtml(this.getCategoryName(task.categoryId))}">
                                📁 ${Utils.escapeHtml(this.getCategoryName(task.categoryId))}
                            </span>
                        ` : empty}
                    </div>
                `;
            case 'parentTask':
                return `
                    <div class="task-cell" data-column="parentTask">
                        ${this.createParentTaskContent(task)}
                    </div>
                `;
            case 'attachments':
                return `
                    <div class="task-cell is-nowrap" data-column="attachments">
                        ${this.createAttachmentsContent(task)}
                    </div>
                `;
            case 'createdAt':
                return this.createTimestampCell('createdAt', task.createdAt);
            case 'updatedAt':
                return this.createTimestampCell('updatedAt', task.updatedAt);
            default:
                return '';
        }
    }

    // "创建时间" / "更新时间"列内容：精确到分钟，悬浮提示说明该列含义
    createTimestampCell(columnKey, value) {
        const isCreated = columnKey === 'createdAt';
        const label = Utils.escapeHtml(window.languageManager.getText(
            isCreated ? 'taskCreateTime' : 'taskUpdateTime',
            isCreated ? '创建时间' : '更新时间'
        ));
        return `
            <div class="task-cell is-nowrap" data-column="${columnKey}">
                ${value ? `
                    <span class="task-datetime" title="${label}">🕒 ${Utils.formatDate(value)}</span>
                ` : '<span class="task-cell-empty">-</span>'}
            </div>
        `;
    }

    // "关联父项任务"列内容
    createParentTaskContent(task) {
        const parent = this.parentTaskMap[task.id];
        if (!parent) return '<span class="task-cell-empty">-</span>';

        return `
            <span class="task-parent-link" data-task-id="${parent.id}"
                  title="${Utils.escapeHtml(parent.title)}">🔗 ${Utils.escapeHtml(parent.title)}</span>
        `;
    }

    // "任务附件"列内容：固定只渲染一行，避免多行撑高行高导致列表变形
    createAttachmentsContent(task) {
        const attachments = task.attachments || [];
        if (attachments.length === 0) return '<span class="task-cell-empty">-</span>';

        const first = attachments[0];
        const icon = this.attachmentManager
            ? this.attachmentManager._itemIcon(first)
            : (first.type === 'link' ? '🔗' : '📎');
        // 多余附件以“+N”计数展示，完整名称通过 title 悬浮查看
        const more = attachments.length > 1
            ? `<span class="task-attachment-more" title="${Utils.escapeHtml(attachments.slice(1).map(a => a.name).join('\n'))}">+${attachments.length - 1}</span>`
            : '';

        return `
            <div class="task-attachment-list">
                <span class="task-attachment-chip" data-task-id="${task.id}" data-attachment-id="${first.id}"
                      title="${Utils.escapeHtml(first.name)}">${icon} ${Utils.escapeHtml(first.name)}</span>
                ${more}
            </div>
        `;
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

        await Utils.apiCall({
            apiMethod: 'get_categories',
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
                checkbox?.classList.remove('is-checking');
                Utils.showToast(window.languageManager.getText('cannotCompleteWithUncompletedChildren',
                    '该任务存在未完成的子任务，请先完成所有子任务'), 'warning');
                return;
            }
        }

        await Utils.apiCall({
            apiMethod: 'toggle_todo',
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

                Utils.showToast(completed ?
                    window.languageManager.getText('taskCompleted', '任务已完成') :
                    window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                // 先播放完成/重开动效，动画结束后再刷新列表，避免突兀的状态跳变
                await this.playToggleAnimation(taskId, completed);
                this.loadTasks(true);
                // 完成状态变化会改变"未完成任务数"，同步刷新分类计数与顶部统计条
                window.App?.notifyDataChanged({ fromZero: true });
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
        // 标题文字包在 .task-title-text 内（右侧紧跟复制图标），取该节点的文本子节点
        const host = titleEl.querySelector('.task-title-text') || titleEl;
        const textNode = Array.from(host.childNodes)
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

    // 加载子任务数量并更新显示（scope 用于限定作用域，默认全文档）
    async loadSubtaskCounts(scope = document) {
        const root = scope || document;
        // 同样先取快照：scope 可能是游离容器，
        // 节点在 await 期间就已被搬进文档，回调里再用 root 查询会查不到。
        // 允许直接传入快照数组（bindTaskEvents 在绑定前已取好）
        const subtaskCountEls = Array.isArray(root)
            ? root
            : Array.from(root.querySelectorAll('.subtask-count'));
        if (subtaskCountEls.length === 0) return;

        const elByTaskId = new Map(subtaskCountEls.map(el => [el.dataset.taskId, el]));
        const taskIds = Array.from(elByTaskId.keys());

        // 并发请求，避免逐条 await 导致列表越大等待越久
        await Promise.all(taskIds.map(taskId => Utils.apiCall({
            apiMethod: 'get_children',
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
        // 支持直接传入快照数组，避免游离容器被搬空后查不到节点
        const subtaskCountEls = Array.isArray(root)
            ? root
            : Array.from(root.querySelectorAll('.subtask-count'));

        subtaskCountEls.forEach(el => {
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

    // 判断是否为移动端或小屏幕
    isMobileDevice() {
        return window.innerWidth <= 480;
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
            this.removeScrollListener();
            this.clearAutoFillTimer();
            this.hideLoadingMore();
            this.hideNoMoreTasks();

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
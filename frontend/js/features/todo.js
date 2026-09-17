// 任务管理模块

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
    { key: 'attachments', i18nKey: 'taskHeaderAttachments', fallback: '任务附件', defaultVisible: false, fixedWidth: 130 }
];
// 操作列固定展示且不参与配置；内部是固定数量的按钮，使用固定像素宽度避免列变窄后换行变形
const TASK_LIST_ACTION_COLUMN = { key: 'actions', i18nKey: 'taskHeaderAction', fallback: '操作', fixedWidth: 150 };
// 任务名称列的最小像素宽度（同时保证不小于其他列中最宽一列的 2 倍）
const TASK_LIST_NAME_MIN_WIDTH = 420;
// 表格最小宽度（列较多时自动增大，保证列内容可读）
const TASK_LIST_MIN_WIDTH = 1060;
// 列配置本地缓存键（数据库为唯一来源，本地仅作首屏兜底）
const TASK_LIST_COLUMNS_CACHE_KEY = 'todolist_task_list_columns';

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
        // 子任务搜索建议下拉（输入 ">" 触发）
        this._subtaskSuggestTimer = null;
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
        // 当前子任务搜索对应的父任务（存在同名任务时用于精确传递父任务ID）
        this.subtaskParent = { id: null, title: null };
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

        this.configureTagManager();
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

        // 绑定分页相关的监听事件
        this.firstBtn?.addEventListener('click', () => this.goToPage(1));
        this.prevBtn?.addEventListener('click', () => this.goToPage(this.currentPage - 1));
        this.nextBtn?.addEventListener('click', () => this.goToPage(this.currentPage + 1));
        this.lastBtn?.addEventListener('click', () => this.goToPage(this.totalPages));
        this.pageSizeSelect?.addEventListener('change', (e) => this.changePageSize(e.target.value));

        // 任务列表显示列配置
        this.bindColumnConfigEvents();

        // 语言切换后刷新列表（表头与列内容文案跟随语言变化）
        window.languageManager?.addObserver?.(() => this.renderTasks());
    }

    // ============ 任务列表显示列配置 ============

    // 获取列定义
    getColumnDef(key) {
        return TASK_LIST_COLUMN_DEFS.find(c => c.key === key);
    }

    // 规范化列配置：过滤非法列，并保证必选列始终存在
    normalizeColumns(keys) {
        const source = Array.isArray(keys) ? keys : [];
        const valid = TASK_LIST_COLUMN_DEFS.filter(c => source.includes(c.key)).map(c => c.key);
        TASK_LIST_COLUMN_DEFS.filter(c => c.locked).forEach(c => {
            if (!valid.includes(c.key)) valid.unshift(c.key);
        });
        return valid;
    }

    // 当前显示的列（按定义顺序排列，结果按配置数组引用缓存，避免逐行重复计算）
    getVisibleColumns() {
        if (!this._visibleColumnsCache || this._visibleColumnsCacheSource !== this.visibleColumns) {
            this._visibleColumnsCache = this.normalizeColumns(this.visibleColumns);
            this._visibleColumnsCacheSource = this.visibleColumns;
        }
        return this._visibleColumnsCache;
    }

    // 判断指定列是否显示
    isColumnVisible(key) {
        return this.getVisibleColumns().includes(key);
    }

    // 依据当前显示的列计算列宽与表格最小宽度
    // - 除任务名称外的列均为固定像素宽度，列数变化时不会被压缩（避免内容换行变形）
    // - 任务名称作为唯一弹性列占据剩余宽度，窗口越宽名称列越宽，并至少为最宽固定列的 2 倍
    getColumnLayout() {
        const columns = this.getVisibleColumns()
            .map(key => this.getColumnDef(key))
            .filter(Boolean)
            .concat([TASK_LIST_ACTION_COLUMN]);

        const fixedTotal = columns.reduce((sum, c) => sum + (c.fixedWidth || 0), 0);
        const maxFixed = columns.reduce((max, c) => Math.max(max, c.fixedWidth || 0), 0);
        const flexWeight = columns.reduce((sum, c) => sum + (c.fixedWidth ? 0 : (c.minWidth || TASK_LIST_NAME_MIN_WIDTH)), 0) || 1;

        // 表格最小宽度：固定列总和 + 任务名称列最小宽度
        const minWidth = Math.max(
            TASK_LIST_MIN_WIDTH,
            fixedTotal + Math.max(TASK_LIST_NAME_MIN_WIDTH, maxFixed * 2)
        );

        return {
            minWidth,
            columns: columns.map(c => ({
                key: c.key,
                label: window.languageManager.getText(c.i18nKey, c.fallback),
                width: c.fixedWidth
                    ? `${c.fixedWidth}px`
                    : `calc((100% - ${fixedTotal}px) * ${((c.minWidth || TASK_LIST_NAME_MIN_WIDTH) / flexWeight).toFixed(5)})`
            }))
        };
    }

    // 读取列配置：数据库为唯一来源，localStorage 仅用于首屏兜底
    async loadColumnConfig() {
        this.applyCachedColumnConfig();
        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['task_list_columns'],
            successCheck: (result) => !!result && !!result.data,
            onSuccess: (response) => {
                const keys = response.data.task_list_columns;
                if (Array.isArray(keys)) this.visibleColumns = this.normalizeColumns(keys);
            }
        });
    }

    // 应用本地缓存的列配置
    applyCachedColumnConfig() {
        try {
            const cached = localStorage.getItem(TASK_LIST_COLUMNS_CACHE_KEY);
            if (!cached) return;
            const keys = JSON.parse(cached);
            if (Array.isArray(keys)) this.visibleColumns = this.normalizeColumns(keys);
        } catch (e) {
            logger.warn('解析任务列表列配置缓存失败:', e);
        }
    }

    // 绑定列配置相关事件
    bindColumnConfigEvents() {
        // 列表内容会整体重绘，操作栏/父任务/附件均使用事件委托
        this.tasksList?.addEventListener('click', (e) => {
            const configBtn = e.target.closest('#task-columns-setting-btn');
            if (configBtn) {
                e.preventDefault();
                e.stopPropagation();
                this.openColumnConfigModal();
                return;
            }

            const parentLink = e.target.closest('.task-parent-link[data-task-id]');
            if (parentLink) {
                e.stopPropagation();
                this.viewTaskDetails(parentLink.dataset.taskId);
                return;
            }

            const attachmentChip = e.target.closest('.task-attachment-chip[data-attachment-id]');
            if (attachmentChip) {
                e.stopPropagation();
                this.openListAttachment(attachmentChip.dataset.taskId, attachmentChip.dataset.attachmentId);
            }
        });

        this.columnConfigCloseBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        this.columnConfigCancelBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        this.columnConfigResetBtn?.addEventListener('click', () => this.resetColumnConfigForm());
        this.columnConfigSaveBtn?.addEventListener('click', () => this.saveColumnConfigFromForm());
    }

    // 打开列配置弹窗
    openColumnConfigModal() {
        this.updateColumnConfigText();
        this.renderColumnConfigForm();
        Utils.ModalManager.show('task-columns-modal');
    }

    // 刷新列配置弹窗中的静态文案（跟随语言切换）
    updateColumnConfigText() {
        if (this.columnConfigTitle) {
            this.columnConfigTitle.textContent = window.languageManager.getText('columnConfigTitle', '配置显示列');
        }
        if (this.columnConfigDesc) {
            this.columnConfigDesc.textContent = window.languageManager.getText('columnConfigDesc', '勾选需要在任务列表中展示的列');
        }
    }

    // 渲染列勾选列表
    renderColumnConfigForm(checkedKeys = null) {
        if (!this.columnConfigList) return;

        const selected = checkedKeys || this.getVisibleColumns();
        const lockedText = Utils.escapeHtml(window.languageManager.getText('columnConfigLocked', '必选'));

        this.columnConfigList.innerHTML = TASK_LIST_COLUMN_DEFS.map(def => {
            const checked = !!def.locked || selected.includes(def.key);
            const label = Utils.escapeHtml(window.languageManager.getText(def.i18nKey, def.fallback));
            return `
                <label class="column-config-item${def.locked ? ' locked' : ''}">
                    <input type="checkbox" class="column-config-checkbox" value="${def.key}"
                           ${checked ? 'checked' : ''} ${def.locked ? 'disabled' : ''}>
                    <span class="column-config-name">${label}</span>
                    ${def.locked ? `<span class="column-config-tag">${lockedText}</span>` : ''}
                </label>
            `;
        }).join('');
    }

    // 恢复默认列配置（仅重置勾选，需点击保存生效）
    resetColumnConfigForm() {
        this.renderColumnConfigForm(TASK_LIST_COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key));
    }

    // 从表单中读取勾选结果并保存
    async saveColumnConfigFromForm() {
        const keys = Array.from(this.columnConfigList?.querySelectorAll('.column-config-checkbox') || [])
            .filter(box => box.checked)
            .map(box => box.value);
        await this.saveColumnConfig(keys);
    }

    // 保存列配置并刷新列表
    async saveColumnConfig(keys) {
        const normalized = this.normalizeColumns(keys);
        if (normalized.length === 0) {
            Utils.showToast(window.languageManager.getText('columnConfigMinTip', '至少需要保留一列'), 'warning');
            return;
        }

        this.visibleColumns = normalized;
        localStorage.setItem(TASK_LIST_COLUMNS_CACHE_KEY, JSON.stringify(normalized));
        Utils.ModalManager.hide('task-columns-modal');

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['task_list_columns', normalized],
            onSuccess: () => Utils.showToast(window.languageManager.getText('columnConfigSaved', '显示列配置已保存'), 'success'),
            onError: () => Utils.showToast(window.languageManager.getText('columnConfigSaveFailed', '显示列配置保存失败'), 'error')
        });

        await this.renderTasks();
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

        // 重置周期性任务选项
        this.isRecurringCheckbox.checked = false;
        this.recurringOptions.style.display = 'none';

        // 重置循环次数的必填状态
        this.recurrenceCount.required = false;
        this.recurrenceCount.value = '';
        this.recurrenceCount.placeholder = window.languageManager.getText('recurrenceCountRequired', '循环次数不能为空');
        this.recurrenceType.value = '';
    }
    
    // 展开"更多选项"（用于让自动填充的父任务等字段对用户可见）
    expandMoreOptions() {
        this.moreOptionsContent.style.display = 'block';
        this.moreOptionsToggle.classList.add('expanded');
        const toggleIcon = this.moreOptionsToggle.querySelector('.toggle-icon');
        if (toggleIcon) toggleIcon.textContent = '-';
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
        this.datePicker.style.borderColor = hasError ? 'var(--danger-color)' : '';
        this.timeInput.style.borderColor = hasError ? 'var(--danger-color)' : '';
    }
    
    // 添加输入值变化监听
    addInputValueListeners() {
        const setError = (valid, msg) => {
            Object.assign(this.datetimeError.style, { display: valid ? 'none' : 'block' });
            this.datetimeError.textContent = valid ? '' : msg;
            const color = valid ? '' : 'var(--danger-color)';
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

    // 构建任务列表查询参数。
    buildListQuery(page) {
        const categoryIdArg = this.currentFilter === 'all' ? null : this.currentFilter;
        const statusArg = this.statusFilter === 'all' ? null : this.statusFilter;
        const priorityArg = this.priorityFilter === 'all' ? null : this.priorityFilter;
        const dueDateArg = this.dueDateFilter === 'all' ? null : this.dueDateFilter;

        return {
            apiMethod: 'get_todos',
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

        // 列表内容变化（筛选/翻页/保存等）时先淡出，数据就绪后再淡入，避免内容瞬间跳变
        if (!Utils.prefersReducedMotion()) this.tasksList.classList.add('list-refreshing');

        if (this.tasks.length === 0) {
            this.tasksList.style.setProperty('display', 'none', 'important');
            this.emptyState.style.display = 'block';
            // 隐藏分页
            this.pagination.style.display = 'none';
            this.finishListRefresh();
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

        html += this.tasks.map(task => this.createTaskElement(task)).join('');
        this.tasksList.innerHTML = html;

        // 绑定任务事件
        await this.bindTaskEvents();

        // 取消淡出并播放入场淡入
        this.finishListRefresh();
        // 新建/编辑保存后定位并高亮对应任务
        this.highlightPendingTask();
    }

    // 列表刷新收尾：取消淡出态并重新播放淡入动画
    finishListRefresh() {
        if (Utils.prefersReducedMotion()) return;

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

    // 删除前播放任务离场动画，避免任务从列表中瞬间消失
    async animateTaskRemoval(taskId) {
        if (Utils.prefersReducedMotion()) return;

        const { row } = this.getTaskToggleTarget(taskId);
        if (!row) return;

        row.classList.add('is-removing');
        await Utils.wait(280);
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
                                    ${Utils.escapeHtml(task.title)}
                                    ${(task.parentTaskId || task.isRecurring) ? `<span class="recurring-badge">${window.languageManager.getText('recurringTask', '周期任务')}</span>` : ''}
                                    <span class="subtask-count" data-task-id="${task.id}" data-task-title="${Utils.escapeHtml(task.title)}" style="display: none; cursor: pointer;">📋 <span class="count">0</span></span>
                                </h3>
                            </div>
                        </div>
                        <p class="task-description" style="display: none;">${task.description ? Utils.escapeHtml(task.description) : ''}</p>
                    </div>
                `;
            case 'priority':
                return `
                    <div class="task-cell task-meta" data-column="priority">
                        <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                            ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                        </span>
                    </div>
                `;
            case 'dueDate':
                return `
                    <div class="task-cell task-due-date-cell" data-column="dueDate">
                        ${task.dueDate ? `
                            <span class="task-due-date ${isOverdue ? 'overdue' : ''}" title="截止时间">
                                📅 ${Utils.formatDate(task.dueDate)}
                            </span>
                        ` : empty}
                    </div>
                `;
            case 'tags':
                return `
                    <div class="task-cell task-tags" data-column="tags">
                        ${tagsHtml || empty}
                    </div>
                `;
            case 'category':
                return `
                    <div class="task-cell task-category-cell" data-column="category">
                        ${task.categoryId ? `
                            <span class="task-category" data-category-id="${task.categoryId}">
                                📁 加载中...
                            </span>
                        ` : empty}
                    </div>
                `;
            case 'parentTask':
                return `
                    <div class="task-cell task-parent-cell" data-column="parentTask">
                        ${this.createParentTaskContent(task)}
                    </div>
                `;
            case 'attachments':
                return `
                    <div class="task-cell task-attachment-cell" data-column="attachments">
                        ${this.createAttachmentsContent(task)}
                    </div>
                `;
            default:
                return '';
        }
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
            .task-header {
                will-change: transform; /* 优化性能 */
            }
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

        // 加载分类名称
        await this.loadCategoryNames(scope);
    }
    
    // 加载分类名称
    async loadCategoryNames(scope = document) {
        const root = scope || document;
        await Utils.apiCall({
            apiMethod: 'get_categories',
            onSuccess: (response) => {
                const categories = response.data;
                const categoryMap = {};

                categories.forEach(cat => {
                    categoryMap[cat.id] = cat.name;
                });

                root.querySelectorAll('.task-category').forEach(el => {
                    const categoryId = el.dataset.categoryId;
                    const categoryName = categoryMap[categoryId] || '未知分类';
                    el.textContent = `📁 ${categoryName}`;
                    // 列宽有限时以省略号截断，用 title 保证完整名称可见
                    el.title = categoryName;
                });
            }
        });
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

                // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                Utils.showToast(completed ?
                    window.languageManager.getText('taskCompleted', '任务已完成') :
                    window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                // 触发云端同步上传
                Utils.apiCall({apiMethod: 'trigger_upload_on_change', successCheck: (response) => true});

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
                    this.parentTaskState.selectedTitle = parent.title || '';
                }
                // 回填任务原本关联的父任务，供保存后判断是否需要同步搜索框的父任务查询
                if (this.taskFilterSnapshot) {
                    this.taskFilterSnapshot.parentTaskId = parent ? parent.id : null;
                }
            }
        });
    }
    
    // 加载子任务数量并更新显示（scope 用于限定作用域，默认全文档）
    async loadSubtaskCounts(scope = document) {
        const root = scope || document;
        const subtaskCountEls = root.querySelectorAll('.subtask-count');
        if (subtaskCountEls.length === 0) return;
        
        const taskIds = Array.from(subtaskCountEls).map(el => el.dataset.taskId);

        // 并发请求，避免逐条 await 导致列表越大等待越久
        await Promise.all(taskIds.map(taskId => Utils.apiCall({
            apiMethod: 'get_children',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const children = response.data;
                if (children && children.length > 0) {
                    const countEl = root.querySelector(`.subtask-count[data-task-id="${taskId}"]`);
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
        this.initParentTaskForEdit(task.id);
        
        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载标签选择器
        this.tagManager.loadSelector();

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
            tags: this.tagManager.getSelectedTagNames(),
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
                        // 先读取当前父任务
                        let currentParentId = null;
                        await Utils.apiCall({
                            apiMethod: 'get_parent',
                            apiArgs: [taskId],
                            onSuccess: (res) => {
                                currentParentId = res.data ? res.data.id : null;
                            }
                        });

                        // 仅在父任务确实发生变化时才更新关联，且顺序执行：
                        // 先解除旧关联，再建立新关联（并发执行会因先增后删而丢失新关联）
                        if (currentParentId !== parentTaskId) {
                            if (currentParentId) {
                                await Utils.apiCall({
                                    apiMethod: 'remove_task_relation',
                                    apiArgs: [taskId],
                                    successCheck: () => true
                                });
                            }
                            if (parentTaskId) {
                                await Utils.apiCall({
                                    apiMethod: 'add_task_relation',
                                    apiArgs: [taskId, parentTaskId],
                                    successCheck: () => true,
                                    onError: () => Utils.showToast(window.languageManager.getText('addParentRelationFailed', '添加父任务关联失败'), 'warning')
                                });
                            }
                        }
                    } else if (parentTaskId) {
                        // 新建模式下直接添加关联
                        await Utils.apiCall({
                            apiMethod: 'add_task_relation',
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
                Utils.apiCall({apiMethod: 'trigger_upload_on_change', successCheck: (response) => true});
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
        // 先播放离场动画，再真正删除
        await this.animateTaskRemoval(taskId);

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

    // ===== 标签筛选状态访问（对标签模块与统计模块的统一出口） =====

    // 列表筛选中的标签 chips（含仅按名称匹配、尚无 id 的 chip）
    getTagFilterChips() {
        return this.searchChips.filter(chip => chip.type === 'tag' && chip.value);
    }

    // 列表筛选中的标签 id（尚无 id 的名称型 chip 不在其中）
    getTagFilterIds() {
        return this.getTagFilterChips()
            .filter(chip => chip.tagId)
            .map(chip => chip.tagId);
    }

    // 列表筛选中的标签名称（供统计等模块展示当前标签筛选）
    getTagFilterNames() {
        return this.getTagFilterChips().map(chip => chip.value);
    }

    // 清空全部搜索 chips 并同步视图（左侧标签选中态 + 清空按钮显隐）。
    // 只负责视图与状态，不触发重新加载，由调用方决定何时 loadTasks。
    clearSearchChips() {
        if (this.searchChips.length === 0) {
            this.tagManager.refreshSelection();
            return false;
        }
        this.searchChips = [];
        this.renderSearchChips();
        this.tagManager.refreshSelection();
        this.updateSearchClearButton();
        return true;
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
                // 仍以 ">" 开头但文本已被改写时，之前选中的父任务精确ID不再可信，
                // 清除后自动回退为按名称解析
                if (this.subtaskParent.title
                    && this.searchInput.value.trim() !== `>${this.subtaskParent.title}`) {
                    this.setSubtaskParent(null, null);
                }
                this.scheduleSubtaskSuggestions(250);
            } else {
                // 退出 ">" 子任务搜索模式，清除记录的父任务
                this.setSubtaskParent(null, null);
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
        const tagPattern = TAG_INPUT_PATTERN;

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
                    this.selectSubtaskSuggestion(item.title, item.id);
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
        if (TAG_INPUT_PATTERN.test(val)) {
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
        this._chipEls.set(chip, el);
        return el;
    }

    // 全量重建所有 chips（插入到输入框之前）
    // 仅用于批量替换（如保存任务后整体重建标签筛选、外部模块清空筛选）；
    // 单个 chip 的增删走 addSearchChip / removeSearchChip 的增量路径，避免整排重绘
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
            const match = this.tagManager.getTags().find(t => t.name.toLowerCase() === chip.value.toLowerCase());
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
        // 增量插入单个 chip，不重建整排
        this.searchTagWrapper.insertBefore(this.createChipElement(chip), this.searchInput);
        return true;
    }

    // 移除指定索引的 chip
    removeSearchChip(index) {
        if (index < 0 || index >= this.searchChips.length) return false;
        const [chip] = this.searchChips.splice(index, 1);
        // 增量移除对应 DOM，不重建整排
        const el = this._chipEls.get(chip);
        if (el) {
            el.remove();
            this._chipEls.delete(chip);
        }
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
        const tag = this.tagManager.getTags().find(t => t.id === tagId);
        if (!tag) return;
        const existing = this.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (existing !== -1) {
            this.removeSearchChip(existing);
        } else {
            this.addSearchChip({ type: 'tag', value: tag.name, tagId: tag.id, color: tag.color });
        }
        this.syncSearchQuery(0);
    }

    // 将 chips + 输入框文本转换为后端 query 解析层支持的结构化查询对象。
    // 三种搜索语义在这里一次性确定，后端不再需要猜测字符串格式：
    //   tags     - 标签 chips（有 tagId 时带精确 id，否则按名称匹配）
    //   keywords - 文本 chips + 输入框文本
    //   parent   - 输入以 ">" 开头时，查询该父任务的直接子任务
    buildSearchQuery() {
        const inputText = this.searchInput ? this.searchInput.value.trim() : '';
        const isParentMode = this.isSubtaskSuggestMode(inputText);

        const tags = this.getTagFilterChips()
            .map(chip => (chip.tagId
                ? { id: chip.tagId, name: chip.value }
                : { name: chip.value }));

        // 单独的 "#" 是快捷筛选"含标签任务"，不参与普通文本匹配
        const isAnyTag = inputText === '#';

        // 父任务模式下，输入框文本已被父任务消费，不再作为普通关键词
        const keywords = this.searchChips
            .filter(chip => chip.type !== 'tag' && chip.value)
            .map(chip => chip.value);
        if (!isParentMode && !isAnyTag && inputText) keywords.push(inputText);

        let parent = null;
        if (isParentMode) {
            const name = inputText.substring(1).trim();
            if (name) {
                parent = { id: this.subtaskParent.id || null, name };
            }
        }

        return { tags, keywords, parent, anyTag: isAnyTag };
    }

    // 同步 searchQuery、清空按钮、标签模块选中态，并触发搜索
    syncSearchQuery(delay = 0) {
        this.searchQuery = this.buildSearchQuery();
        this.updateSearchClearButton();
        this.tagManager.refreshSelection();
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
    // 判断当前是否处于子任务建议模式：输入以 ">" 开头且后面有内容。
    // 标签 chips 允许与父任务条件并存（后端按 AND 组合），因此不再要求 chips 为空。
    isSubtaskSuggestMode(value) {
        const v = (value || '').trim();
        return v.startsWith('>') && v.length > 1;
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
            item.addEventListener('click', () => this.selectSubtaskSuggestion(task.title, task.id));

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

    // 搜索框当前是否处于"按父任务查子任务"模式，且已确定到具体的父任务。
    // 返回 { id, title }；仅输入 ">" 但未选中具体父任务（无 id），或文本已被改写时返回 null。
    getSubtaskParentFilter() {
        const inputText = this.searchInput ? this.searchInput.value.trim() : '';
        if (!this.isSubtaskSuggestMode(inputText)) return null;
        if (!this.subtaskParent.id) return null;
        if (this.subtaskParent.title && inputText !== `>${this.subtaskParent.title}`) return null;
        return {
            id: this.subtaskParent.id,
            title: this.subtaskParent.title || inputText.substring(1).trim()
        };
    }

    // 记录当前子任务搜索对应的父任务（id 用于精确查询，title 用于校验搜索文本是否被改写）
    setSubtaskParent(id, title) {
        this.subtaskParent = {
            id: id || null,
            title: (title || '').trim() || null
        };
    }

    // 选中某条建议：填充 ">+精确标题" 并触发现有子任务搜索流程
    // id 为父任务精确ID，用于避免同名任务导致按标题解析到错误的父任务
    selectSubtaskSuggestion(title, id = null) {
        this.setSubtaskParent(id, title);
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


    // 清空搜索
    async clearSearch() {
        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        this.hideSubtaskSuggestions();
        this.setSubtaskParent(null, null);
        this.searchChips = [];
        this.renderSearchChips();
        this.searchInput.value = '';
        this.searchQuery = null;
        this.currentPage = 1;
        this.customDateFilter = null;
        this.resetInfiniteScroll(); // 重置无限下拉状态
        this.tagManager.refreshSelection();
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
        this.removeScrollListener();
        this.clearAutoFillTimer();

        // 只在移动端启用无限下拉
        if (!this.isMobileDevice() || !this.tasksContainer) return;

        // 添加滚动监听器（rAF 节流，避免每个滚动事件都做布局计算）
        this.scrollListener = () => {
            // 用户主动滚动：重置连续自动填充计数
            this.autoFillCount = 0;

            if (this.isLoadingMore || !this.hasMoreTasks) return;
            if (this._scrollFrameId !== null) return;

            this._scrollFrameId = window.requestAnimationFrame(() => {
                this._scrollFrameId = null;
                if (this.isLoadingMore || !this.hasMoreTasks) return;

                const container = this.tasksContainer;
                if (!container) return;

                const scrollPosition = container.scrollTop + container.clientHeight;
                const scrollHeight = container.scrollHeight;

                // 当滚动位置距离底部小于阈值时，加载更多
                if (scrollPosition >= scrollHeight - this.scrollThreshold) this.loadMoreTasks();
            });
        };

        this.tasksContainer.addEventListener('scroll', this.scrollListener, { passive: true });
        logger.info('Infinite scroll listener attached');

        // 检查是否需要自动加载更多（内容不足以滚动时）
        this.scheduleAutoFillCheck();
    }

    // 移除滚动监听器
    removeScrollListener() {
        if (this.scrollListener && this.tasksContainer) {
            this.tasksContainer.removeEventListener('scroll', this.scrollListener);
        }
        this.scrollListener = null;

        if (this._scrollFrameId !== null) {
            window.cancelAnimationFrame(this._scrollFrameId);
            this._scrollFrameId = null;
        }
    }

    // 清除自动填充定时器
    clearAutoFillTimer() {
        if (this.autoFillTimer) {
            clearTimeout(this.autoFillTimer);
            this.autoFillTimer = null;
        }
    }

    // 延迟检查是否需要自动加载更多
    scheduleAutoFillCheck() {
        this.clearAutoFillTimer();
        this.autoFillTimer = setTimeout(() => {
            this.autoFillTimer = null;
            this.checkAndLoadMoreIfNeeded();
        }, 100);
    }

    // 检查是否需要自动加载更多任务
    checkAndLoadMoreIfNeeded() {
        if (!this.isMobileDevice() || this.isLoadingMore || !this.hasMoreTasks) return;

        const container = this.tasksContainer;
        if (!container) return;

        // 列表为空（或已隐藏）时不再自动补加载，避免空列表触发无意义的请求
        if (!Array.isArray(this.tasks) || this.tasks.length === 0) return;

        // 连续自动填充达到上限时暂停，等用户滚动时再继续，避免一次性拉完全部数据
        if (this.autoFillCount >= this.maxAutoFill) return;

        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        logger.info('Checking if need to load more - scrollHeight:', scrollHeight, 'clientHeight:', clientHeight, 'currentPage:', this.currentPage, 'totalPages:', this.totalPages);

        // 如果内容高度小于等于容器高度，说明所有任务都在可视范围内，需要加载更多
        // 同时确保还有更多页面可加载
        if (scrollHeight <= clientHeight && this.currentPage < this.totalPages) {
            logger.info('Content fits in viewport, auto-loading more tasks');
            this.autoFillCount++;
            this.loadMoreTasks().then(() => {
                // 加载完成后再次检查,直到内容超过容器高度
                if (this.isMobileDevice()) this.scheduleAutoFillCheck();
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
        const token = this.listLoadToken; // 记录当前令牌，用于判断结果是否仍然有效
        const { apiMethod, apiArgs } = this.buildListQuery(nextPage);
        await Utils.apiCall({
            apiMethod: apiMethod,
            apiArgs: apiArgs,
            onSuccess: (response) => {
                // 期间发生了重新加载（搜索/筛选/删除等），丢弃本次结果，避免脏数据混入新列表
                if (token !== this.listLoadToken) {
                    logger.info('Discard stale load-more result, page:', nextPage);
                    return;
                }

                // 用后端最新分页信息刷新总数，避免并发增删后分页信息过期
                if (typeof response.data.total === 'number') this.totalTasks = response.data.total;
                if (typeof response.data.total_pages === 'number') this.totalPages = response.data.total_pages;

                const newTasks = response.data.tasks || [];
                if (newTasks.length > 0) {
                    // 将新任务追加到现有任务列表
                    this.tasks = [...this.tasks, ...newTasks];
                    this.currentPage = nextPage;
                    // 渲染新增的任务
                    this.appendTasks(newTasks);
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
                this.hideLoadingMore();
            }
        });
    }

    // 追加任务到列表
    appendTasks(newTasks) {
        if (!this.tasksList || !Array.isArray(newTasks) || newTasks.length === 0) return;

        // 生成新任务的HTML（先在游离容器中构建，便于只给新增节点绑定事件）
        const temp = document.createElement('div');
        temp.innerHTML = newTasks.map(task => this.createTaskElement(task)).join('');

        // 绑定新增任务的事件（作用域限定为新增节点，已渲染任务不会被重复绑定）
        this.bindTaskEvents(temp);

        // 插入到"加载中"指示器之前，保证指示器始终位于列表末尾
        const anchor = this.getLoadingMoreEl();
        while (temp.firstChild) {
            if (anchor) this.tasksList.insertBefore(temp.firstChild, anchor);
            else this.tasksList.appendChild(temp.firstChild);
        }
    }

    // 获取"加载更多"指示器（动态创建，需要实时查询）
    getLoadingMoreEl() {
        if (!this.tasksList) return null;
        return this.tasksList.querySelector('#loading-more');
    }

    // 获取"已经到底了"提示（动态创建，需要实时查询）
    getNoMoreTasksEl() {
        if (!this.tasksList) return null;
        return this.tasksList.querySelector('#no-more-tasks');
    }

    // 显示"加载更多"指示器
    showLoadingMore() {
        if (!this.tasksList) return;
        this.hideLoadingMore();

        const loadingMoreDiv = document.createElement('div');
        loadingMoreDiv.id = 'loading-more';
        loadingMoreDiv.className = 'loading-more';
        loadingMoreDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        `;
        this.tasksList.appendChild(loadingMoreDiv);
    }

    // 隐藏"加载更多"指示器
    hideLoadingMore() {
        this.getLoadingMoreEl()?.remove();
    }

    // 显示"已经到底了"提示
    showNoMoreTasks() {
        if (!this.tasksList) return;
        // 已存在则不重复添加
        if (this.getNoMoreTasksEl()) return;
        // 到底时应移除加载指示器
        this.hideLoadingMore();

        const noMoreDiv = document.createElement('div');
        noMoreDiv.id = 'no-more-tasks';
        noMoreDiv.className = 'no-more-tasks';
        noMoreDiv.innerHTML = `
            <span class="no-more-text">- 已经到底了 -</span>
        `;
        this.tasksList.appendChild(noMoreDiv);
    }

    // 隐藏"已经到底了"提示
    hideNoMoreTasks() {
        this.getNoMoreTasksEl()?.remove();
    }

    // 重置无限下拉状态（仅重置状态，加载由调用方负责，避免重复请求）
    resetInfiniteScroll() {
        // 使飞行中的"加载更多"结果失效
        this.listLoadToken++;
        this.isLoadingMore = false;
        this.hasMoreTasks = true;
        this.currentPage = 1;
        this.autoFillCount = 0;
        this.clearAutoFillTimer();
        this.hideNoMoreTasks();
        this.hideLoadingMore();
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

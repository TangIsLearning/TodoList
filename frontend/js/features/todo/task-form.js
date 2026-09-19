/**
 * 任务表单控制器
 *
 * 从 TodoManager 中抽出：新建/编辑弹窗的填充与提交、父任务选择器、
 * 周期选项启停、分类下拉、子任务计数徽章，以及保存后的筛选同步。
 *
 * 编辑态字段（_parentEditToken / _parentInitPromise / _parentPrefillDone /
 * taskFilterSnapshot）跨越 showAddTaskModal、editTask、initParentTaskForEdit、
 * handleTaskSubmit 四方读写。这些字段仍由 TodoManager 持有，本控制器通过
 * ctx 读写——访问的是同一个对象引用，语义与拆分前完全一致。
 *
 * 依赖的 TodoManager 成员：
 *   状态：tasks / currentFilter / currentPage / taskFilterSnapshot /
 *        _parentEditToken / _parentInitPromise / _parentPrefillDone /
 *        _parentComboboxBound / _pendingHighlightTaskId / parentTaskState /
 *        searchChips / tagManager / attachmentManager
 *   DOM：modalTitle / taskForm / taskTitle / taskDescription / taskPrioritySelect /
 *        taskCategorySelect / datePicker / timeInput / taskParent / taskParentInput /
 *        taskParentDropdown / parentTaskCombobox / loadMoreParentTask /
 *        recurringOptions / scheduleModeOnce / moreOptionsContent / moreOptionsToggle
 *   方法：resetMoreOptions / expandMoreOptions / addInputValueListeners /
 *        isMobileDevice / loadTasks
 *   其它控制器：ctx.recurrence（reset / updateScheduleMode / getScheduleMode /
 *        getTodayISO / collectRule / addEditNotice / removeEditNotice /
 *        validateAndReport）、ctx.search（getTagFilterIds / getParentFilter /
 *        setParent / syncQuery / renderChips / hideSuggestions / buildQuery /
 *        updateClearButton）、ctx.infiniteScroll.reset
 */
class TaskFormController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 显示添加任务模态框
    showAddModal() {
        const ctx = this.ctx;
        ctx.modalTitle.textContent = '新建任务';
        ctx.taskForm.reset();
        ctx.taskForm.dataset.editingId = '';

        // 重置更多选项状态
        ctx.resetMoreOptions();

        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();

        // 移除编辑模式提示（如果存在）
        ctx.recurrence.removeEditNotice();

        // 截止日期默认为空，不设置默认值
        ctx.timeInput.value = '';

        // 搜索框正处于"按父任务查子任务"时，新建任务默认挂到该父任务下
        const subtaskParentFilter = ctx.search.getParentFilter();

        // 记录打开弹窗时的列表筛选快照（分类 + 标签 + 父任务），提交后据此决定是否同步或清除筛选
        const currentCategory = ctx.currentFilter && ctx.currentFilter !== 'all' ? ctx.currentFilter : '';
        const currentTagIds = ctx.search.getTagFilterIds();
        // 新建模式下表单初始值即列表筛选值，因此"是否已筛选"与初始值一致
        ctx.taskFilterSnapshot = {
            categoryId: currentCategory,
            tagIds: currentTagIds,
            parentTaskId: subtaskParentFilter ? subtaskParentFilter.id : null,
            hasCategoryFilter: !!currentCategory,
            hasTagFilter: currentTagIds.length > 0,
            hasParentFilter: !!subtaskParentFilter
        };
        // 新建模式没有异步回显：父任务在下面同步预填，清理编辑模式遗留的回显状态
        ctx._parentEditToken++;
        ctx._parentInitPromise = null;
        ctx._parentPrefillDone = true;

        // 已选标签继承当前标签筛选（弹窗新建的临时标签在打开时统一丢弃）
        ctx.tagManager.beginForm(currentTagIds);

        // 添加输入值变化监听
        ctx.addInputValueListeners();

        // 加载分类选项并设置默认选中
        this.loadCategoryOptions(currentCategory);

        // 重置并初始化父任务选择器
        ctx.parentTaskState.editingTaskId = '';
        this.resetCombobox();
        this.initCombobox();

        // 搜索框存在父任务查询时，把该父任务预填到表单，新建的任务直接成为其子任务
        if (subtaskParentFilter) {
            this.selectParentTask({ id: subtaskParentFilter.id, title: subtaskParentFilter.title });
            // 展开更多选项，让自动填充的父任务对用户可见
            ctx.expandMoreOptions();
        }

        // 加载标签选择器
        ctx.tagManager.loadSelector();

        // 重置附件
        if (ctx.attachmentManager) ctx.attachmentManager.reset();

        Utils.ModalManager.show('task-modal');
    }

    // 初始化父任务选择器（只在首次打开时绑定，避免每次打开弹窗重复叠加监听器）
    initCombobox() {
        const ctx = this.ctx;
        if (ctx._parentComboboxBound) return;
        ctx._parentComboboxBound = true;

        // 点击输入框打开下拉
        ctx.taskParentInput.addEventListener('focus', async () => {
            ctx.parentTaskState.isOpen = true;
            ctx.taskParentDropdown.style.display = 'block';

            // 如果没有内容，加载初始数据
            const results = ctx.taskParentDropdown.querySelector('.combobox-results');
            if (results.children.length === 0 && !ctx.parentTaskState.isLoading) await this.loadParentTasks(false);
        });

        // 输入搜索
        let searchTimeout;
        ctx.taskParentInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();

            // 如果输入框为空，清空父任务选择
            if (query === '') {
                ctx.taskParent.value = '';
                ctx.parentTaskState.selectedId = '';
            }

            searchTimeout = setTimeout(async () => {
                if (query !== ctx.parentTaskState.searchQuery) {
                    ctx.parentTaskState.searchQuery = query;
                    ctx.parentTaskState.currentPage = 1;
                    await this.loadParentTasks(true);
                }
            }, 300);
        });

        // 点击其他地方关闭（按下与抬起都发生在下拉框之外才算，避免拖选文本时误关闭）
        let pressOutside = false;
        const markPressOrigin = (e) => {
            pressOutside = !ctx.parentTaskCombobox.contains(e.target);
        };
        document.addEventListener('pointerdown', markPressOrigin);
        document.addEventListener('mousedown', markPressOrigin);
        document.addEventListener('click', (e) => {
            const shouldClose = pressOutside && !ctx.parentTaskCombobox.contains(e.target);
            pressOutside = false;
            if (shouldClose) {
                ctx.taskParentDropdown.style.display = 'none';
                ctx.parentTaskState.isOpen = false;
            }
        });

        // 加载更多
        ctx.loadMoreParentTask.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.loadParentTasks(false);
        });
    }

    // 加载父任务列表
    async loadParentTasks(isNewSearch = false) {
        const ctx = this.ctx;
        const results = ctx.taskParentDropdown.querySelector('.combobox-results');
        const loading = ctx.taskParentDropdown.querySelector('.combobox-loading');
        const loadMore = ctx.taskParentDropdown.querySelector('.combobox-load-more');
        const empty = ctx.taskParentDropdown.querySelector('.combobox-empty');

        if (ctx.parentTaskState.isLoading) return;
        ctx.parentTaskState.isLoading = true;

        loading.style.display = 'block';
        empty.style.display = 'none';

        const searchQuery = ctx.parentTaskState.searchQuery;
        const page = ctx.parentTaskState.currentPage;
        const pageSize = ctx.parentTaskState.pageSize;
        await Api.tasks.list({
            apiArgs: [page, pageSize, null, 'uncompleted', null, null, null, null, searchQuery || null],
            onSuccess: (response) => {
                let tasks = response.data.tasks.filter(t => !t.isRecurring && !t.parentTaskId);

                // 排除当前编辑的任务
                if (ctx.parentTaskState.editingTaskId) {
                    tasks = tasks.filter(t => t.id !== ctx.parentTaskState.editingTaskId);
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
                    ctx.parentTaskState.hasMore = loadedCount < total;

                    loadMore.style.display = ctx.parentTaskState.hasMore ? 'block' : 'none';
                    empty.style.display = 'none';
                } else if (results.children.length === 0) {
                    empty.style.display = 'block';
                    loadMore.style.display = 'none';
                }
            },
            onFinally: () => {
                ctx.parentTaskState.isLoading = false;
                ctx.parentTaskState.currentPage++;
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
        const ctx = this.ctx;
        ctx.taskParentInput.value = task.title;
        ctx.taskParent.value = task.id;
        ctx.parentTaskState.selectedId = task.id;
        ctx.parentTaskState.selectedTitle = task.title || '';
        ctx.taskParentDropdown.style.display = 'none';
        ctx.parentTaskState.isOpen = false;
    }

    // 重置父任务选择器
    resetCombobox() {
        const ctx = this.ctx;
        const results = document.querySelector('.combobox-results');

        ctx.taskParentInput.value = '';
        ctx.taskParent.value = '';
        ctx.parentTaskState.selectedId = '';
        ctx.parentTaskState.selectedTitle = '';
        ctx.parentTaskState.searchQuery = '';
        ctx.parentTaskState.currentPage = 1;
        ctx.parentTaskState.hasMore = false;

        if (results) results.innerHTML = '';
    }

    // 初始化父任务选择器（编辑模式）
    async initParentForEdit(taskId) {
        const ctx = this.ctx;
        // 每次打开编辑弹窗都递增令牌：上一次编辑的回显若晚于本次到达会被直接丢弃，
        // 否则旧任务的父任务会被写进当前表单，保存后把关联改到错误的父任务上
        const token = ++ctx._parentEditToken;
        ctx._parentPrefillDone = false;

        // 重置并初始化选择器
        ctx.parentTaskState.editingTaskId = taskId;
        this.resetCombobox();
        this.initCombobox();

        // 获取当前任务的父任务
        await Api.relations.parent({
            apiArgs: [taskId],
            onSuccess: (response) => {
                if (token !== ctx._parentEditToken) return;
                const parent = response.data;
                if (parent) {
                    ctx.taskParent.value = parent.id;
                    ctx.taskParentInput.value = parent.title;
                    ctx.parentTaskState.selectedId = parent.id;
                    ctx.parentTaskState.selectedTitle = parent.title || '';
                }
                // 回填任务原本关联的父任务，供保存后判断是否需要同步搜索框的父任务查询
                if (ctx.taskFilterSnapshot) {
                    ctx.taskFilterSnapshot.parentTaskId = parent ? parent.id : null;
                }
                ctx._parentPrefillDone = true;
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
        const ctx = this.ctx;
        const root = scope || document;
        root.querySelectorAll('.subtask-count').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();

                const count = el.querySelector('.count');
                const countValue = parseInt(count ? count.textContent : '0', 10);

                if (countValue > 0) {
                    const taskTitle = el.dataset.taskTitle;
                    const taskId = el.dataset.taskId;
                    if (taskTitle) {
                        // 进入子任务搜索模式：填充 ">父任务名"
                        // 已有的标签 chips 会保留，与父任务条件在后端按 AND 组合
                        ctx.search.setParent(taskId, taskTitle);
                        ctx.searchInput.value = `>${taskTitle}`;
                        ctx.search.syncQuery(0);
                    }
                }
            });
        });
    }

    // 编辑任务
    editTask(taskId) {
        const ctx = this.ctx;
        const task = ctx.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 如果是周期性任务，禁用编辑
        if (task.isRecurring || task.parentTaskId) {
            Utils.showToast(window.languageManager.getText('periodicTaskEditFailed', '周期性任务不支持编辑，请删除后重新创建'), 'warning');
            return;
        }

        ctx.modalTitle.textContent = '编辑任务';
        ctx.taskForm.dataset.editingId = taskId;

        // 重置更多选项状态
        ctx.resetMoreOptions();

        // 启用周期性任务选项（新建任务模式下允许）
        this.enableRecurringOptions();

        // 移除编辑模式提示（如果存在）
        ctx.recurrence.removeEditNotice();

        // 填充表单
        ctx.taskTitle.value = task.title;
        ctx.taskDescription.value = task.description || '';
        ctx.taskPrioritySelect.value = task.priority;

        // 设置已选标签（弹窗新建的临时标签在打开时统一丢弃）
        ctx.tagManager.beginForm(task.tags ? task.tags.map(t => t.id) : []);

        // 记录打开弹窗时的任务原分类/原标签与列表筛选状态，提交后据此决定是否同步筛选
        const filterCategoryId = ctx.currentFilter && ctx.currentFilter !== 'all' ? ctx.currentFilter : '';
        const filterTagIds = ctx.search.getTagFilterIds();
        ctx.taskFilterSnapshot = {
            categoryId: task.categoryId || '',
            tagIds: ctx.tagManager.getFormSelectedTagIds(),
            // 普通父子关联不在任务字段上（parentTaskId 只标记周期任务实例），
            // 这里先留空，由 initParentForEdit 异步回填任务原本关联的父任务
            parentTaskId: null,
            hasCategoryFilter: !!filterCategoryId,
            hasTagFilter: filterTagIds.length > 0,
            // 编辑模式下以搜索框是否处于父任务查询为准，与任务自身是否有父任务无关
            hasParentFilter: !!ctx.search.getParentFilter()
        };

        // 如果有截止日期，自动展开更多选项
        if (task.dueDate) {
            const [datePart, timePart] = task.dueDate.split('T');
            ctx.datePicker.value = datePart;
            ctx.timeInput.value = timePart;

            // 自动展开更多选项
            ctx.moreOptionsContent.style.display = 'block';
            ctx.moreOptionsToggle.classList.add('expanded');
            const toggleIcon = ctx.moreOptionsToggle.querySelector('.toggle-icon');
            if (toggleIcon) toggleIcon.textContent = '-';
        }

        // 禁用周期性任务选项（编辑模式下不允许转换为周期性任务）
        this.disableRecurringOptions();

        // 添加编辑模式提示
        ctx.recurrence.addEditNotice();

        // 加载分类选项
        this.loadCategoryOptions(task.categoryId);

        // 初始化父任务选择器（编辑模式需要先获取已选的父任务）
        // 保存 Promise：提交前需等待父任务回显完成，避免误判为"用户移除了父任务"
        ctx._parentInitPromise = this.initParentForEdit(task.id);

        // 添加输入值变化监听
        ctx.addInputValueListeners();

        // 加载标签选择器
        ctx.tagManager.loadSelector();

        // 加载已有附件
        if (ctx.attachmentManager) ctx.attachmentManager.loadFromTask(task);

        Utils.ModalManager.show('task-modal');
    }

    // 禁用周期模式切换（编辑模式下不允许把任务改成周期性任务）
    disableRecurringOptions() {
        const ctx = this.ctx;
        // 固定为「单次任务」
        if (ctx.scheduleModeOnce) ctx.scheduleModeOnce.checked = true;
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.disabled = true;
        });
        const switchEl = document.getElementById('schedule-mode-switch');
        if (switchEl) switchEl.classList.add('is-disabled');

        // 隐藏周期性选项区域
        ctx.recurringOptions.style.display = 'none';
        ctx.datePicker.required = false;
        ctx.timeInput.required = false;
        ctx.recurrence.reset();
        ctx.recurrence.updateScheduleMode();
    }

    // 启用周期模式切换（新建任务模式下允许）
    enableRecurringOptions() {
        const ctx = this.ctx;
        document.querySelectorAll('input[name="schedule-mode"]').forEach((radio) => {
            radio.disabled = false;
        });
        const switchEl = document.getElementById('schedule-mode-switch');
        if (switchEl) switchEl.classList.remove('is-disabled');
        if (ctx.scheduleModeOnce) ctx.scheduleModeOnce.checked = true;

        // 确保周期性选项区域是隐藏的（默认状态）
        ctx.recurringOptions.style.display = 'none';
        ctx.recurrence.reset();
        ctx.recurrence.updateScheduleMode();
    }

    // 加载分类选项
    async loadCategoryOptions(selectedId = '') {
        const ctx = this.ctx;
        await Api.categories.list({
            onSuccess: (response) => {
                const categories = response.data;
                ctx.taskCategorySelect.innerHTML = `<option value="">${window.languageManager.getText('uncategorized', '未分类')}</option>`;
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    option.selected = cat.id === selectedId;
                    ctx.taskCategorySelect.appendChild(option);
                });
            }
        });
    }

    // 处理任务表单提交
    async submit(e) {
        const ctx = this.ctx;
        e.preventDefault();

        const taskForm = e.target;
        const editingId = taskForm.dataset.editingId;
        const isEdit = editingId && editingId !== '';

        const dateStr = ctx.datePicker.value || null;
        const timeStr = ctx.timeInput.value || null;

        // 周期性任务不再要求填写起始日期，默认从今天开始；提醒时间点由周期规则决定
        const isRecurringTask = !isEdit && ctx.recurrence.getScheduleMode() === 'recurring';

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
        if (isRecurringTask) isoDateStr = ctx.recurrence.getTodayISO();

        // 编辑模式下父任务由 initParentForEdit 异步回显，必须先等它结束再取值：
        // 否则"尚未回显"会被当成"用户移除了父任务"，保存时误删已有父子关联，
        // 表现就是修改子任务后，按父任务搜索再也查不到它。
        if (isEdit && ctx._parentInitPromise) {
            await ctx._parentInitPromise.catch(() => {});
        }

        const parentTaskId = ctx.taskParent.value || null;

        const taskData = {
            title: ctx.taskTitle.value.trim(),
            description: ctx.taskDescription.value.trim(),
            priority: ctx.taskPrioritySelect.value,
            categoryId: ctx.taskCategorySelect.value || null,
            dueDate: isoDateStr || null,
            tags: ctx.tagManager.getSelectedTagNames(),
            attachments: ctx.attachmentManager ? ctx.attachmentManager.getAttachments() : []
        };

        // 编辑模式下强制清除周期性任务相关数据
        if (!isEdit) {
            // 只有在新建模式下才允许设置周期性任务
            taskData.isRecurring = isRecurringTask;
            if (isRecurringTask) {
                const rule = ctx.recurrence.collectRule();
                if (!ctx.recurrence.validateAndReport(rule)) return;
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
                        if (!ctx._parentPrefillDone) {
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
                if (ctx.isMobileDevice()) ctx.infiniteScroll.reset(); // 重置无限下拉状态

                // 按表单中最终选择的分类/标签同步列表筛选
                const tagsModuleRefreshed = await this.syncFiltersAfterSave(
                    ctx.taskFilterSnapshot, taskData.categoryId, savedTags
                );
                ctx.taskFilterSnapshot = null;
                // 标签已随任务落库，清掉弹窗内的临时标签，避免与后端返回的真实标签重复
                ctx.tagManager.clearPending();

                // 列表刷新后定位并高亮这条任务
                ctx._pendingHighlightTaskId = taskId;
                ctx.loadTasks(true);
                if (window.timelineManager) window.timelineManager.renderTimeline();

                // loadTasks() 内部已经调用了 updateCategoryCounts()，不需要再调用 renderCategories()
                // renderCategories() 会重新获取所有任务（默认只取前10条），导致数据不准确

                // 触发云端同步上传
                Api.tasks.triggerUpload({ successCheck: (response) => true });
                if (!tagsModuleRefreshed) ctx.tagManager.loadModule(true);
            },
            onError: () => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
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
        const ctx = this.ctx;
        if (!snapshot) return false;
        let tagsModuleRefreshed = false;
        let filterChanged = false;

        // ===== 分类筛选 =====
        const chosenCategoryId = categoryId || '';
        if (chosenCategoryId !== snapshot.categoryId && snapshot.hasCategoryFilter) {
            // 选择"未分类"时清除分类筛选
            const nextFilter = chosenCategoryId || 'all';
            ctx.currentFilter = nextFilter;
            if (window.categoryManager) {
                window.categoryManager.currentCategory = nextFilter;
                window.categoryManager.setActiveCategory(nextFilter);
            }
            filterChanged = true;
        }

        // ===== 标签筛选 =====
        const presetTagIds = snapshot.tagIds || [];
        const chosenTagIds = ctx.tagManager.getFormSelectedTagIds();
        const isSameTags = chosenTagIds.length === presetTagIds.length &&
            chosenTagIds.every(id => presetTagIds.includes(id));

        if (!isSameTags && snapshot.hasTagFilter && Array.isArray(savedTags)) {
            // 直接用后端返回的标签（含真实 id）重建筛选，不再按名称反查，
            // 避免后端归一化/同名标签导致 chip 错配或丢失
            const chosenTagChips = savedTags
                .filter(tag => tag && tag.name)
                .map(tag => ({ type: 'tag', value: tag.name, tagId: tag.id || null, color: tag.color }));

            // 保留非标签类型的搜索 chip（如文本搜索），仅替换标签筛选部分
            ctx.searchChips = ctx.searchChips.filter(chip => chip.type !== 'tag').concat(chosenTagChips);
            ctx.search.renderChips();

            // 表单中可能包含新建的标签，刷新左侧标签模块以纳入新标签与新计数；
            // 此时 chips 已更新，模块渲染会直接带上正确的选中态
            await ctx.tagManager.loadModule(true);
            tagsModuleRefreshed = true;
            filterChanged = true;
        }

        // ===== 父任务（子任务搜索）筛选 =====
        // chosenParentId 为表单中最终选择的父任务；搜索框本身没有父任务查询时不联动
        const chosenParentId = ctx.taskParent.value || null;
        if (snapshot.hasParentFilter && chosenParentId !== snapshot.parentTaskId) {
            ctx.search.hideSuggestions();
            if (chosenParentId) {
                // 改为其他父任务：搜索框同步为新的父任务查询
                const parentTitle = (ctx.parentTaskState.selectedTitle || '').trim() ||
                    (ctx.taskParentInput.value || '').trim();
                ctx.search.setParent(chosenParentId, parentTitle || null);
                ctx.searchInput.value = parentTitle ? `>${parentTitle}` : '';
            } else {
                // 移除父任务：同步移除搜索框的父任务查询
                ctx.search.setParent(null, null);
                ctx.searchInput.value = '';
            }
            filterChanged = true;
        }

        if (filterChanged) {
            // 重新计算提交给后端的查询对象
            ctx.searchQuery = ctx.search.buildQuery();
            ctx.search.updateClearButton();
            // 筛选条件已变化，回到第一页重新加载
            ctx.currentPage = 1;
            ctx.infiniteScroll.reset();
        }

        return tagsModuleRefreshed;
    }
}

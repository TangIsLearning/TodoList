/**
 * 任务管理 - 任务新建/编辑/详情/删除弹窗（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
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
            // 仅在真正选择了截止日期时申请，做到"用到才申请"；无日期无需惊动用户
            if (this.datePicker.value && this.isMobileDevice?.()) {
                await this.ensureCalendarPermission();
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
    },

    // 确保已获得系统日历权限；缺失时后端会弹出系统授权框
    // 每次都以后端实时状态为准：用户可能随时在系统设置里撤销授权，前端缓存会失真
    async ensureCalendarPermission() {
        let status = { granted: true, requested: false };
        await Utils.apiCall({
            apiMethod: 'check_calendar_permission',
            onSuccess: (result) => {
                if (result?.data) status = result.data;
            }
        });

        if (status.granted) return true;

        // requested 为 true 表示系统授权弹窗已弹出，弹窗本身就是引导，无需重复提示
        if (!status.requested) {
            Utils.showToast(
                window.languageManager?.getText(
                    'calendarPermissionRequired',
                    '未获得日历权限，请在系统设置中开启后，到期提醒才能写入系统日历'
                ),
                'warning'
            );
        }
        return false;
    },

    // 任务模态框标题：新建 / 复制 / 编辑 由打开时的模式决定，模式记录在实例上以便切语言后重设
    setTaskModalMode(mode) {
        this._taskModalMode = mode;
        this.refreshTaskModalTitle();
    },

    // 按当前模式重设任务模态框标题（切换语言时由 languageManager 调用）
    refreshTaskModalTitle() {
        if (!this.modalTitle) return;

        const modeKeys = { new: 'newTask', copy: 'copyTask', edit: 'editTask' };
        const fallbacks = { new: '新建任务', copy: '复制任务', edit: '编辑任务' };
        const mode = this._taskModalMode || 'new';

        this.modalTitle.textContent = window.languageManager.getText(
            modeKeys[mode] || modeKeys.new,
            fallbacks[mode] || fallbacks.new
        );
    },

    // 显示添加任务模态框
    // sourceTask 非空时进入"复制任务"模式：表单预填源任务的全部信息，保存后生成一条新的独立任务
    async showAddTaskModal({ sourceTask = null } = {}) {
        this.setTaskModalMode(sourceTask ? 'copy' : 'new');
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

        // 复制任务：沿用源任务的父任务；普通新建：搜索框正处于"按父任务查子任务"时挂到该父任务下
        const sourceParent = sourceTask ? await this.getParentOfTask(sourceTask.id) : null;
        const subtaskParentFilter = sourceTask ? null : this.getSubtaskParentFilter();
        const parentPrefill = sourceTask ? sourceParent : subtaskParentFilter;

        // 记录打开弹窗时的列表筛选快照（分类 + 标签 + 父任务），提交后据此决定是否同步或清除筛选
        const currentCategory = sourceTask
            ? (sourceTask.categoryId || '')
            : (this.currentFilter && this.currentFilter !== 'all' ? this.currentFilter : '');
        const currentTagIds = sourceTask
            ? (sourceTask.tags || []).map(tag => tag.id)
            : this.getTagFilterIds();
        // 新建模式下表单初始值即列表筛选值，因此"是否已筛选"与初始值一致
        this.taskFilterSnapshot = {
            categoryId: currentCategory,
            tagIds: currentTagIds,
            parentTaskId: parentPrefill ? parentPrefill.id : null,
            hasCategoryFilter: !!currentCategory,
            hasTagFilter: currentTagIds.length > 0,
            // 搜索框是否正处于"按父任务查子任务"，与任务自身有没有父任务无关
            hasParentFilter: !!subtaskParentFilter
        };
        // 新建模式没有异步回显：父任务在下面同步预填，清理编辑模式遗留的回显状态
        this._parentEditToken++;
        this._parentInitPromise = null;
        this._parentPrefillDone = true;

        // 已选标签继承当前标签筛选（弹窗新建的临时标签在打开时统一丢弃）
        this.tagManager.beginForm(currentTagIds);

        // 复制任务：用源任务的信息预填表单（放在日期/时间监听绑定之前，清空按钮状态才与初始值一致）
        if (sourceTask) this.fillFormFromSourceTask(sourceTask);

        // 添加输入值变化监听
        this.addInputValueListeners();

        // 加载分类选项并设置默认选中（await：等分类下拉重建完成，避免后续取到旧选项）
        await this.loadCategoryOptions(currentCategory);

        // 重置并初始化父任务选择器
        this.parentTaskState.editingTaskId = '';
        this.resetParentTaskCombobox();
        this.initParentTaskCombobox();

        // 把父任务预填到表单，新建的任务直接成为其子任务
        if (parentPrefill) {
            this.selectParentTask({ id: parentPrefill.id, title: parentPrefill.title });
            // 展开更多选项，让自动填充的父任务对用户可见
            this.expandMoreOptions();
        }

        // 加载标签选择器
        this.tagManager.loadSelector();

        // 附件：复制任务时按源任务重建（后端各自生成副本），普通新建则清空
        if (sourceTask) this.attachmentManager?.loadCopyFromTask(sourceTask);
        else this.attachmentManager?.reset();

        Utils.ModalManager.show('task-modal');
    },

    // 复制任务：把源任务的信息填进表单，用户确认后保存即为一条新任务
    fillFormFromSourceTask(task) {
        this.taskTitle.value = task.title || '';
        this.taskDescription.value = task.description || '';
        if (task.priority) this.taskPrioritySelect.value = task.priority;

        if (task.dueDate) {
            const [datePart, timePart] = task.dueDate.split('T');
            this.datePicker.value = datePart || '';
            // 时间输入框只认 HH:MM，历史数据可能带秒，这里截断到分钟
            this.timeInput.value = (timePart || '').slice(0, 5);
            // 展开更多选项，让复制过来的截止时间对用户可见
            this.expandMoreOptions();
        }
    },

    // 查询任务的父任务（复制任务时用于沿用同一父任务）
    async getParentOfTask(taskId) {
        let parent = null;
        await Utils.apiCall({
            apiMethod: 'get_parent',
            apiArgs: [taskId],
            onSuccess: (response) => { parent = response.data || null; }
        });
        return parent;
    },

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
        await Utils.apiCall({
            apiMethod: 'get_parent',
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
    },

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
    },

    // 复制任务：读取源任务的完整信息后打开新建弹窗，用户确认即可保存为一条新任务
    async copyTask(taskId) {
        let task = this.tasks.find(t => t.id === taskId);

        // 列表里没有该任务时回源到数据库取一次
        if (!task) {
            await Utils.apiCall({
                apiMethod: 'get_todo',
                apiArgs: [taskId],
                onSuccess: (response) => { task = response.data; }
            });
        }
        if (!task) return;

        // 周期性任务（含周期实例）无法在新任务上重建周期，禁止复制
        if (task.isRecurring || task.parentTaskId) {
            Utils.showToast(
                window.languageManager.getText('periodicTaskCopyFailed', '周期性任务不支持复制'),
                'warning'
            );
            return;
        }

        await this.showAddTaskModal({ sourceTask: task });
        Utils.showToast(
            window.languageManager.getText('taskCopied', '已复制任务信息，确认后即可保存为新任务'),
            'success'
        );
    },

    // 编辑任务
    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 如果是周期性任务，禁用编辑
        if (task.isRecurring || task.parentTaskId) {
            Utils.showToast(window.languageManager.getText('periodicTaskEditFailed', '周期性任务不支持编辑，请删除后重新创建'), 'warning');
            return;
        }
        
        this.setTaskModalMode('edit');
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
    },

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
    },
    
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
    },
    
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
    },
    
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
                        if (!this._parentPrefillDone) {
                            // 父任务回显失败时无法判断用户是否改动过父任务，保持关联不变，
                            // 避免把"没取到原父任务"当成"用户移除了父任务"而误删关联
                            logger.warn('父任务回显未完成，跳过本次父子关联变更');
                        } else {
                            // 先读取当前父任务
                            let currentParentId = null;
                            await Utils.apiCall({
                                apiMethod: 'get_parent',
                                apiArgs: [taskId],
                                onSuccess: (res) => {
                                    currentParentId = res.data ? res.data.id : null;
                                }
                            });

                            // 仅在父任务确实发生变化时才更新关联，且由后端在同一事务内完成：
                            // 拆成"先删后加"两次调用时，中途失败会让子任务彻底丢失父任务，
                            // 表现为按父任务搜索查不到该子任务
                            if (currentParentId !== parentTaskId) {
                                await Utils.apiCall({
                                    apiMethod: 'set_task_parent',
                                    apiArgs: [taskId, parentTaskId],
                                    successCheck: () => true,
                                    onError: () => Utils.showToast(window.languageManager.getText('updateParentRelationFailed', '更新父任务关联失败'), 'warning')
                                });
                            }
                        }
                    } else if (parentTaskId) {
                        // 新建模式下直接建立关联（与编辑模式同一个接口：
                        // 传非空 parentTaskId 即设置，传 null 即解除）
                        await Utils.apiCall({
                            apiMethod: 'set_task_parent',
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
    },

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
    },
    
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
    },
    
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
    },
    
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
    },
});
/**
 * 任务渲染控制器：列表整体渲染与任务行 HTML 构造。
 * 只读操作（不修改任务数据），仅通过 ctx 读取状态与其它控制器的结果。
 *
 * 依赖的 TodoManager 成员：
 *   状态：tasks / tasksList / emptyState / pagination / parentTaskMap / attachmentManager
 *   方法：loadParentTaskMap / ensureCategoryMap / getCategoryName
 *   其它控制器：ctx.columns.getVisibleColumns / getColumnLayout / isColumnVisible /
 *        ctx.rowInteractions.bindEvents / ctx.locator.highlightPending
 */
class TaskRenderController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    async renderTasks() {
        const ctx = this.ctx;
        if (window.calendarManager) window.calendarManager.updateTasks(ctx.tasks);

        // 列表内容变化（筛选/翻页/保存等）时先淡出，数据就绪后再淡入，避免内容瞬间跳变
        if (!Utils.prefersReducedMotion()) ctx.tasksList.classList.add('list-refreshing');

        if (ctx.tasks.length === 0) {
            ctx.tasksList.style.setProperty('display', 'none', 'important');
            ctx.emptyState.style.display = 'block';
            ctx.pagination.style.display = 'none';
            this.finishListRefresh();
            return;
        }

        // 根据屏幕尺寸设置display样式 (大于480px使用表格布局)
        const isLargeScreen = window.innerWidth > 480;
        ctx.tasksList.style.display = isLargeScreen ? 'table' : 'flex';
        ctx.emptyState.style.display = 'none';

        let html = '';

        // 大屏幕添加表头（列由用户配置决定）
        if (isLargeScreen) {
            // 展示"关联父项任务"列时需要父任务信息，统一批量查询避免逐条请求
            if (ctx.columns.isColumnVisible('parentTask')) await ctx.loadParentTaskMap();

            const layout = ctx.columns.getColumnLayout();
            ctx.tasksList.style.minWidth = `${layout.minWidth}px`;

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
            ctx.tasksList.style.minWidth = '';
        }

        // 分类名称必须在拼 HTML 之前就绪：名称会被直接写进 HTML，
        // 不再依赖"渲染占位符 + 渲染后异步回填"，也就不会出现永远停在占位状态的任务
        await ctx.ensureCategoryMap();

        html += ctx.tasks.map(task => this.createTaskElement(task)).join('');
        ctx.tasksList.innerHTML = html;

        await ctx.rowInteractions.bindEvents();
        this.finishListRefresh();
        // 新建/编辑保存后定位并高亮对应任务
        ctx.locator.highlightPending();
    }

    finishListRefresh() {
        const ctx = this.ctx;
        if (Utils.prefersReducedMotion()) return;

        ctx.tasksList.classList.remove('list-refreshing');
        // 先移除再强制重排，保证每次刷新都能重新播放动画
        ctx.tasksList.classList.remove('list-enter');
        void ctx.tasksList.offsetWidth;
        ctx.tasksList.classList.add('list-enter');
    }

    createTaskElement(task) {
        const ctx = this.ctx;
        const priorityInfo = Utils.getPriorityInfo(task.priority);
        // 只有未完成的任务才检查是否逾期
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);
        const isLargeScreen = window.innerWidth > 480;

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
            const cells = ctx.columns.getVisibleColumns()
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
                        <p class="task-description">${task.description ? Utils.escapeHtml(task.description) : ''}</p>
                        <div class="task-meta">
                            <span class="task-priority ${task.priority}" title="优先级: ${priorityInfo.label}">
                                ${priorityInfo.icon} ${window.languageManager.getText(task.priority, task.priority)}
                            </span>
                            ${task.categoryId ? `
                                <span class="task-category" data-category-id="${task.categoryId}"
                                      title="${Utils.escapeHtml(ctx.getCategoryName(task.categoryId))}">
                                    📁 ${Utils.escapeHtml(ctx.getCategoryName(task.categoryId))}
                                </span>
                            ` : ''}
                            ${tagsHtml ? `<div class="task-tags">${tagsHtml}</div>` : ''}
                            ${task.dueDate ? `
                                <span class="task-due-date ${isOverdue ? 'overdue' : ''}"
                                      title="截止时间">
                                    📅 ${Utils.formatDate(task.dueDate)}
                                </span>
                            ` : ''}
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
                                  title="${Utils.escapeHtml(this.ctx.getCategoryName(task.categoryId))}">
                                📁 ${Utils.escapeHtml(this.ctx.getCategoryName(task.categoryId))}
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
            default:
                return '';
        }
    }

    // "关联父项任务"列内容
    createParentTaskContent(task) {
        const parent = this.ctx.parentTaskMap[task.id];
        if (!parent) return '<span class="task-cell-empty">-</span>';

        return `
            <span class="task-parent-link" data-task-id="${parent.id}"
                  title="${Utils.escapeHtml(parent.title)}">🔗 ${Utils.escapeHtml(parent.title)}</span>
        `;
    }

    // "任务附件"列内容：固定只渲染一行，避免多行撑高行高导致列表变形
    createAttachmentsContent(task) {
        const am = this.ctx.attachmentManager;
        const attachments = task.attachments || [];
        if (attachments.length === 0) return '<span class="task-cell-empty">-</span>';

        const first = attachments[0];
        const icon = am
            ? am._itemIcon(first)
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
}

/**
 * 任务详情控制器
 *
 * 负责"任务详情"弹窗：取数（任务本体 / 父任务 / 子任务）、详情 HTML 拼装、
 * 以及弹窗内关联任务跳转与附件点击的事件绑定；同时承载列表中附件 chip 的打开。
 *
 * 从 todo.js 的 viewTaskDetails（约 170 行的单体方法）拆出：原方法把取数、
 * 拼装、事件绑定混在一起，且详情 HTML 与列表渲染逻辑共用 todo.js，
 * 职责边界模糊。现在详情只依赖 ctx 的任务数据与分类缓存，不反向修改列表状态。
 *
 * 依赖的 TodoManager 成员：
 *   状态：tasks / attachmentManager
 *   方法：ensureCategoryMap / getCategoryName
 */

class TaskDetailController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 打开列表中点击的附件
    openListAttachment(taskId, attachmentId) {
        const ctx = this.ctx;
        const task = ctx.tasks.find(t => t.id === taskId);
        const attachment = task && (task.attachments || []).find(a => a.id === attachmentId);
        if (attachment) ctx.attachmentManager?.openAttachment(attachment);
    }

    // 查看任务详情：当前页没有该任务时回落到接口查询
    async viewTaskDetails(taskId) {
        const ctx = this.ctx;
        let task = ctx.tasks.find(t => t.id === taskId);

        if (!task) {
            await Api.tasks.get({
                apiArgs: [taskId],
                onSuccess: (response) => task = response.data
            });
        }
        if (!task) return;

        const [parentInfo, childrenInfo] = await Promise.all([
            this.fetchParentInfo(taskId),
            this.fetchChildrenInfo(taskId)
        ]);

        // 分类名称直接写进详情 HTML，避免依赖弹窗弹出后再异步回填
        await ctx.ensureCategoryMap();

        const detailContent = this.buildDetailContent(task, {
            parentInfo,
            childrenInfo,
            tagsHtml: this.buildTagsHtml(task),
            attachmentsInfo: ctx.attachmentManager ? ctx.attachmentManager.buildDetailHtml(task) : ''
        });

        Utils.confirmDialog(detailContent, null, null, '任务详情', 'view-modal');

        this.bindRelatedTaskLinks();
        // 绑定附件点击事件（图片预览 / 文件打开 / 链接跳转）
        ctx.attachmentManager?.bindDetailEvents(task);
    }

    // 标签区 HTML：无标签时展示占位文案
    buildTagsHtml(task) {
        if (!task.tags || task.tags.length === 0) {
            return `<span style="color: var(--text-secondary);">${window.languageManager.getText('noTaskTags', '无标签')}</span>`;
        }
        return task.tags.map(tag =>
            `<span class="task-tag" style="background-color: ${tag.color}; border: 1px solid ${tag.color};">
                #${Utils.escapeHtml(tag.name)}
            </span>`
        ).join('');
    }

    // 父任务区块 HTML（无父任务时为空串）
    async fetchParentInfo(taskId) {
        let html = '';
        await Api.relations.parent({
            apiArgs: [taskId],
            onSuccess: (response) => {
                const parent = response.data;
                if (!parent) return;
                html = `
                    <div>
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('parentTask', '父任务')}</strong>
                        <span style="color: var(--primary-color); font-size: 14px; cursor: pointer;" class="link-text" data-task-id="${parent.id}">
                            🔗 ${Utils.escapeHtml(parent.title)}
                        </span>
                    </div>
                `;
            }
        });
        return html;
    }

    // 子任务区块 HTML（无子任务时为空串）
    async fetchChildrenInfo(taskId) {
        let html = '';
        await Api.relations.children({
            apiArgs: [taskId],
            onSuccess: (response) => {
                const children = response.data;
                if (!children || children.length === 0) return;
                const childrenHtml = children.map(child =>
                    `<span style="display: block; color: var(--primary-color); font-size: 14px; cursor: pointer; margin-bottom: 4px;" class="link-text" data-task-id="${child.id}">
                        📋 ${Utils.escapeHtml(child.title)} ${child.completed ? '✓' : ''}
                    </span>`
                ).join('');
                html = `
                    <div style="grid-column: 1 / -1;">
                        <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">${window.languageManager.getText('subTasks', '子任务')} (${children.length})</strong>
                        <div>${childrenHtml}</div>
                    </div>
                `;
            }
        });
        return html;
    }

    // 拼装详情弹窗的完整 HTML
    buildDetailContent(task, { parentInfo, childrenInfo, tagsHtml, attachmentsInfo }) {
        const ctx = this.ctx;
        const priorityInfo = Utils.getPriorityInfo(task.priority);
        const isOverdue = !task.completed && task.dueDate && Utils.isOverdue(task.dueDate);
        const categoryName = task.categoryId ? ctx.getCategoryName(task.categoryId) : '';

        return `
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
    }

    // 绑定关联任务点击事件：点击父任务 / 子任务时跳转查看其详情
    bindRelatedTaskLinks() {
        const controller = this;
        document.querySelectorAll('.link-text[data-task-id]').forEach(el => {
            el.onclick = (e) => {
                const targetTaskId = e.currentTarget.dataset.taskId;
                Utils.ModalManager.hide('view-modal');
                controller.viewTaskDetails(targetTaskId);
            };
        });
    }
}

/**
 * 任务操作控制器
 *
 * 从 TodoManager 中抽出：任务完成/重开（含动效）、删除（含周期性任务确认）、
 * 分类计数刷新，以及动效所需的 DOM 测量辅助。
 *
 * 依赖的 TodoManager 成员：
 *   状态：tasks / statusFilter / currentPage / _completingTasks / tagManager
 *   方法：loadTasks / isMobileDevice
 *   其它控制器：ctx.locator.animateRemoval / ctx.infiniteScroll.reset
 */
class TaskActionsController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 切换任务状态
    async toggleTask(taskId) {
        const ctx = this.ctx;
        // 获取当前任务状态
        const task = ctx.tasks.find(t => t.id === taskId);
        if (!task) return;
        // 动效播放期间忽略重复点击，避免动画叠加、状态错乱
        if (ctx._completingTasks.has(taskId)) return;

        const { checkbox } = this.getTaskToggleTarget(taskId);
        const willComplete = !task.completed;
        // 等待后端响应期间给复选框一个呼吸提示，点击后即时反馈
        if (checkbox) checkbox.classList.add('is-checking');

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
                if (checkbox) checkbox.classList.remove('is-checking');
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
                const target = ctx.tasks.find(t => t.id === taskId);
                if (target) {
                    target.completed = completed;
                    target.updatedAt = response.data.updatedAt;
                }
                if (checkbox) checkbox.classList.remove('is-checking');

                // 不需要调用 renderCategories()，updateCategoryCounts() 已经更新了分类统计
                Utils.showToast(completed ?
                    window.languageManager.getText('taskCompleted', '任务已完成') :
                    window.languageManager.getText('taskReopened', '任务已重新开启'), 'success');

                // 触发云端同步上传
                Api.tasks.triggerUpload({ successCheck: (response) => true });

                // 先播放完成/重开动效，动画结束后再刷新列表，避免突兀的状态跳变
                await this.playToggleAnimation(taskId, completed);
                ctx.loadTasks(true);
            },
            onError: () => {
                if (checkbox) checkbox.classList.remove('is-checking');
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
        const ctx = this.ctx;
        if (completed) {
            // 除"全部/已完成"外，其余筛选只包含未完成任务，完成后会移出列表
            return ctx.statusFilter !== 'all' && ctx.statusFilter !== 'completed';
        }
        // 重新开启后只会在"已完成"筛选下移出列表
        return ctx.statusFilter === 'completed';
    }

    // 播放任务完成/重开动效：勾选弹跳 → 删除线扫过 → 高亮闪烁 →（必要时）离场
    async playToggleAnimation(taskId, completed) {
        const ctx = this.ctx;
        if (Utils.prefersReducedMotion()) return;

        const { checkbox, row } = this.getTaskToggleTarget(taskId);
        // 列表已重绘、找不到对应节点时直接刷新，不空等动画时间
        if (!checkbox && !row) return;

        const title = row ? row.querySelector('.task-title') : null;

        ctx._completingTasks.add(taskId);
        try {
            if (row) row.classList.toggle('completed', completed);
            if (row) row.classList.add(completed ? 'complete-flash' : 'reopen-flash');
            if (checkbox) checkbox.classList.toggle('checked', completed);
            if (checkbox) checkbox.classList.add('check-pop');

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
            if (row) row.classList.remove('complete-flash', 'reopen-flash', 'is-leaving');
            if (checkbox) checkbox.classList.remove('check-pop', 'is-checking');
            if (title) title.classList.remove('strike-sweep');
            ctx._completingTasks.delete(taskId);
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
        if (typeof range.detach === 'function') range.detach();
        // 标题过长被省略号截断时，划线宽度不超过可见区域
        return Math.min(width, titleEl.clientWidth);
    }

    // 删除任务
    async deleteTask(taskId) {
        const task = this.ctx.tasks.find(t => t.id === taskId);
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
        const ctx = this.ctx;
        // 先播放离场动画，再真正删除
        await ctx.locator.animateRemoval(taskId);

        Utils.setLoading(true, '删除中...');
        await Api.tasks.remove({
            apiArgs: [taskId, deleteAll],
            onSuccess: (response) => {
                const message = deleteAll ?
                    window.languageManager.getText('periodicTaskDeleted', '整个周期任务删除成功') :
                    window.languageManager.getText('taskDeleted', '任务删除成功');
                Utils.showToast(message, 'success');

                // 移动端调整：如果当前页不是第一页，重置到第一页
                if (ctx.isMobileDevice()) {
                    ctx.infiniteScroll.reset(); // 重置无限下拉状态
                } else {
                    // 安全检查：确保任务列表存在
                    if (Array.isArray(ctx.tasks)) {
                        // 如果删除任务后，页面任务数量为空且有前置页，渲染前置页数据
                        if (ctx.tasks.length === 0 && ctx.currentPage > 1) {
                            ctx.currentPage = ctx.currentPage - 1;
                        }
                    } else {
                        logger.warning('任务列表状态异常，重新初始化');
                        ctx.tasks = [];
                    }
                }
                if (window.timelineManager) window.timelineManager.renderTimeline();
                // loadTasks() 已经包含了 updateStats() 和 updateCategoryCounts() 的调用
                // 不需要再调用 renderCategories()，否则会导致数据不准确

                // 触发云端同步上传
                Api.tasks.triggerUpload({ successCheck: (response) => true });
                ctx.tagManager.loadModule(true);
            },
            onError: () => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            },
            onFinally: () => {
                Utils.setLoading(false);
                // 重新加载任务以确保数据一致性
                ctx.loadTasks(true);
            }
        });
    }

    // 更新分类任务数量：当前保持分类数量更新变化不受搜索条件影响，因而设置大部分入参为null
    async updateCategoryCounts(fromZero = false) {
        const ctx = this.ctx;
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
                onError: () => {
                    // 如果获取失败，使用当前页的任务
                    window.categoryManager.updateCategoryCounts(ctx.tasks, fromZero);
                }
            });
        }
    }
}

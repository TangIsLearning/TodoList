/**
 * 任务定位控制器：保存后定位高亮、外部创建后自动定位、按筛选反查页码、
 * 列表刷新、删除离场动画。
 *
 * 依赖的 TodoManager 成员：
 *   状态：_pendingHighlightTaskId / tasks / currentPage / pageSize / currentFilter /
 *        statusFilter / priorityFilter / dueDateFilter / searchQuery /
 *        customDateFilter / tagManager
 *   DOM：tasksList；方法：loadTasks
 *   其它控制器：ctx.actions.getTaskToggleTarget
 */
class TaskLocateController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 定位并高亮刚保存（新建/编辑）的任务，便于确认结果落在了哪里
    highlightPending() {
        const ctx = this.ctx;
        const taskId = ctx._pendingHighlightTaskId;
        if (taskId === null || taskId === undefined) return;
        ctx._pendingHighlightTaskId = null;

        const row = ctx.tasksList.querySelector(
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
        const ctx = this.ctx;
        if (!taskId) {
            await ctx.loadTasks(true);
            return;
        }

        // loadTasks() 结束后 renderTasks() 会消费该 id 并滚动高亮
        ctx._pendingHighlightTaskId = taskId;
        await ctx.loadTasks(true);

        // 新任务可能落在其它分页（排序按截止时间/优先级，不一定在第一页）
        const isVisible = () => ctx.tasks.some(task => task.id === taskId);
        if (!isVisible() && window.innerWidth > 480) {
            const targetPage = await this.findTaskPage(taskId);
            if (targetPage && targetPage !== ctx.currentPage) {
                ctx.currentPage = targetPage;
                ctx._pendingHighlightTaskId = taskId;
                await ctx.loadTasks(true);
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
        ctx.tagManager.loadModule(true);
    }

    // 查询指定任务在当前筛选条件下的页码，被筛选条件排除时返回 null
    async findTaskPage(taskId) {
        const ctx = this.ctx;
        let page = null;
        await Api.tasks.page({
            apiArgs: [
                taskId,
                ctx.pageSize,
                ctx.currentFilter === 'all' ? null : ctx.currentFilter,
                ctx.statusFilter === 'all' ? null : ctx.statusFilter,
                ctx.priorityFilter === 'all' ? null : ctx.priorityFilter,
                ctx.dueDateFilter === 'all' ? null : ctx.dueDateFilter,
                null,  // year
                null,  // month
                ctx.searchQuery || null,
                ctx.customDateFilter || null
            ],
            successCheck: (result) => !!result && result.success !== false,
            onSuccess: (response) => { page = response && response.data !== undefined ? response.data : null; }
        });
        return page;
    }

    // 供 App.refreshData() 统一调用（主窗口重新可见时同步任务列表）
    refresh() {
        return this.ctx.loadTasks();
    }

    // 删除前播放任务离场动画，避免任务从列表中瞬间消失
    async animateRemoval(taskId) {
        if (Utils.prefersReducedMotion()) return;

        const { row } = this.ctx.actions.getTaskToggleTarget(taskId);
        if (!row) return;

        row.classList.add('is-removing');
        await Utils.wait(280);
    }
}

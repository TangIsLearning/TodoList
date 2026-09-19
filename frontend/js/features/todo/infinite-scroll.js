/**
 * 无限下拉控制器（小屏幕分页模式）。
 * 状态仍由 TodoManager 持有（tasks / currentPage / hasMoreTasks / listLoadToken …），
 * 本控制器只负责实现，通过 ctx 读写状态。
 *
 * 依赖的 TodoManager 成员：
 *   状态：tasksContainer / tasksList / tasks / currentPage / totalPages /
 *        totalTasks / hasMoreTasks / isLoadingMore / scrollListener /
 *        scrollThreshold / listLoadToken / autoFillTimer / autoFillCount /
 *        maxAutoFill / _scrollFrameId
 *   方法：isMobileDevice / buildListQuery / syncCategoryMap
 *   其它控制器：ctx.renderer.createTaskElement / ctx.rowInteractions.bindEvents
 */
class InfiniteScrollController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    init() {
        const ctx = this.ctx;
        this.removeScrollListener();
        this.clearAutoFillTimer();

        if (!ctx.isMobileDevice() || !ctx.tasksContainer) return;

        // 滚动监听用 rAF 节流，避免每个滚动事件都做布局计算
        ctx.scrollListener = () => {
            // 用户主动滚动：重置连续自动填充计数
            ctx.autoFillCount = 0;

            if (ctx.isLoadingMore || !ctx.hasMoreTasks) return;
            if (ctx._scrollFrameId !== null) return;

            ctx._scrollFrameId = window.requestAnimationFrame(() => {
                ctx._scrollFrameId = null;
                if (ctx.isLoadingMore || !ctx.hasMoreTasks) return;

                const container = ctx.tasksContainer;
                if (!container) return;

                const scrollPosition = container.scrollTop + container.clientHeight;
                const scrollHeight = container.scrollHeight;

                if (scrollPosition >= scrollHeight - ctx.scrollThreshold) this.loadMoreTasks();
            });
        };

        ctx.tasksContainer.addEventListener('scroll', ctx.scrollListener, { passive: true });
        logger.info('Infinite scroll listener attached');

        // 内容不足以滚动时也需要补加载
        this.scheduleAutoFillCheck();
    }

    removeScrollListener() {
        const ctx = this.ctx;
        if (ctx.scrollListener && ctx.tasksContainer) {
            ctx.tasksContainer.removeEventListener('scroll', ctx.scrollListener);
        }
        ctx.scrollListener = null;

        if (ctx._scrollFrameId !== null) {
            window.cancelAnimationFrame(ctx._scrollFrameId);
            ctx._scrollFrameId = null;
        }
    }

    clearAutoFillTimer() {
        const ctx = this.ctx;
        if (ctx.autoFillTimer) {
            clearTimeout(ctx.autoFillTimer);
            ctx.autoFillTimer = null;
        }
    }

    scheduleAutoFillCheck() {
        const ctx = this.ctx;
        this.clearAutoFillTimer();
        ctx.autoFillTimer = setTimeout(() => {
            ctx.autoFillTimer = null;
            this.checkAndLoadMoreIfNeeded();
        }, 100);
    }

    checkAndLoadMoreIfNeeded() {
        const ctx = this.ctx;
        if (!ctx.isMobileDevice() || ctx.isLoadingMore || !ctx.hasMoreTasks) return;

        const container = ctx.tasksContainer;
        if (!container) return;

        // 列表为空（或已隐藏）时不再自动补加载，避免空列表触发无意义的请求
        if (!Array.isArray(ctx.tasks) || ctx.tasks.length === 0) return;

        // 连续自动填充达到上限时暂停，等用户滚动时再继续，避免一次性拉完全部数据
        if (ctx.autoFillCount >= ctx.maxAutoFill) return;

        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;

        logger.info('Checking if need to load more - scrollHeight:', scrollHeight,
            'clientHeight:', clientHeight, 'currentPage:', ctx.currentPage, 'totalPages:', ctx.totalPages);

        // 内容高度不超过容器高度（所有任务都在可视区内）且还有下一页时继续加载
        if (scrollHeight <= clientHeight && ctx.currentPage < ctx.totalPages) {
            logger.info('Content fits in viewport, auto-loading more tasks');
            ctx.autoFillCount++;
            this.loadMoreTasks().then(() => {
                // 递归补加载，直到内容超过容器高度
                if (ctx.isMobileDevice()) this.scheduleAutoFillCheck();
            });
        }
    }

    async loadMoreTasks() {
        const ctx = this.ctx;
        if (ctx.isLoadingMore || !ctx.hasMoreTasks) return;

        if (ctx.currentPage >= ctx.totalPages) {
            ctx.hasMoreTasks = false;
            this.showNoMoreTasks();
            return;
        }

        ctx.isLoadingMore = true;
        this.showLoadingMore();
        const nextPage = ctx.currentPage + 1;
        const token = ctx.listLoadToken; // 用于判断本次结果返回时是否仍然有效
        const { apiArgs } = ctx.buildListQuery(nextPage);
        await Api.tasks.list({
            apiArgs: apiArgs,
            onSuccess: (response) => {
                // 期间发生了重新加载（搜索/筛选/删除等），丢弃本次结果，避免脏数据混入新列表
                if (token !== ctx.listLoadToken) {
                    logger.info('Discard stale load-more result, page:', nextPage);
                    return;
                }

                // 用后端最新分页信息刷新总数，避免并发增删后分页信息过期
                if (typeof response.data.total === 'number') ctx.totalTasks = response.data.total;
                if (typeof response.data.total_pages === 'number') ctx.totalPages = response.data.total_pages;

                const newTasks = response.data.tasks || [];
                if (newTasks.length > 0) {
                    ctx.tasks = [...ctx.tasks, ...newTasks];
                    ctx.currentPage = nextPage;
                    this.appendTasks(newTasks);
                    ctx.hasMoreTasks = ctx.currentPage < ctx.totalPages;
                    if (!ctx.hasMoreTasks) this.showNoMoreTasks();
                } else {
                    ctx.hasMoreTasks = false;
                    this.showNoMoreTasks();
                }
            },
            onError: () => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            },
            onFinally: () => {
                ctx.isLoadingMore = false;
                this.hideLoadingMore();
            }
        });
    }

    appendTasks(newTasks) {
        const ctx = this.ctx;
        if (!ctx.tasksList || !Array.isArray(newTasks) || newTasks.length === 0) return;

        // 同步刷新分类缓存后拼 HTML，名称随节点一起生成，无需再回填空转的占位符
        ctx.syncCategoryMap();

        // 先在游离容器中构建，便于只给新增节点绑定事件
        const temp = document.createElement('div');
        temp.innerHTML = newTasks.map(task => ctx.renderer.createTaskElement(task)).join('');

        ctx.rowInteractions.bindEvents(temp);

        // 插入到"加载中"指示器之前，保证指示器始终位于列表末尾
        const anchor = this.getLoadingMoreEl();
        while (temp.firstChild) {
            if (anchor) ctx.tasksList.insertBefore(temp.firstChild, anchor);
            else ctx.tasksList.appendChild(temp.firstChild);
        }
    }

    // 指示器是动态创建的，需要实时查询
    getLoadingMoreEl() {
        if (!this.ctx.tasksList) return null;
        return this.ctx.tasksList.querySelector('#loading-more');
    }

    getNoMoreTasksEl() {
        if (!this.ctx.tasksList) return null;
        return this.ctx.tasksList.querySelector('#no-more-tasks');
    }

    showLoadingMore() {
        const ctx = this.ctx;
        if (!ctx.tasksList) return;
        this.hideLoadingMore();

        const loadingMoreDiv = document.createElement('div');
        loadingMoreDiv.id = 'loading-more';
        loadingMoreDiv.className = 'loading-more';
        loadingMoreDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        `;
        ctx.tasksList.appendChild(loadingMoreDiv);
    }

    hideLoadingMore() {
        const el = this.getLoadingMoreEl();
        if (el) el.remove();
    }

    showNoMoreTasks() {
        const ctx = this.ctx;
        if (!ctx.tasksList) return;
        if (this.getNoMoreTasksEl()) return;
        this.hideLoadingMore();

        const noMoreDiv = document.createElement('div');
        noMoreDiv.id = 'no-more-tasks';
        noMoreDiv.className = 'no-more-tasks';
        noMoreDiv.innerHTML = `
            <span class="no-more-text">- 已经到底了 -</span>
        `;
        ctx.tasksList.appendChild(noMoreDiv);
    }

    hideNoMoreTasks() {
        const el = this.getNoMoreTasksEl();
        if (el) el.remove();
    }

    // 只重置状态，加载由调用方负责，避免重复请求
    reset() {
        const ctx = this.ctx;
        ctx.listLoadToken++; // 使飞行中的"加载更多"结果失效
        ctx.isLoadingMore = false;
        ctx.hasMoreTasks = true;
        ctx.currentPage = 1;
        ctx.autoFillCount = 0;
        this.clearAutoFillTimer();
        this.hideNoMoreTasks();
        this.hideLoadingMore();
    }
}

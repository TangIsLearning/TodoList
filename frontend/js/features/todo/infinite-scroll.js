/**
 * 无限下拉控制器（小屏幕分页模式）
 *
 * 从 TodoManager 中抽出。之所以是"控制器 + ctx"而非独立模块：
 * 这些方法读写的是同一个列表状态（tasks / currentPage / totalPages /
 * listLoadToken / isLoadingMore ...），若改成独立模块 + 消息通信，
 * 需要一次性把状态所有权也搬走，风险过高。
 * 因此保留 TodoManager 持有状态，本控制器只负责实现，通过 ctx 访问状态。
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

    // 初始化无限下拉功能
    init() {
        const ctx = this.ctx;

        // 移除已存在的监听器
        this.removeScrollListener();
        this.clearAutoFillTimer();

        // 只在移动端启用无限下拉
        if (!ctx.isMobileDevice() || !ctx.tasksContainer) return;

        // 添加滚动监听器（rAF 节流，避免每个滚动事件都做布局计算）
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

                // 当滚动位置距离底部小于阈值时，加载更多
                if (scrollPosition >= scrollHeight - ctx.scrollThreshold) this.loadMoreTasks();
            });
        };

        ctx.tasksContainer.addEventListener('scroll', ctx.scrollListener, { passive: true });
        logger.info('Infinite scroll listener attached');

        // 检查是否需要自动加载更多（内容不足以滚动时）
        this.scheduleAutoFillCheck();
    }

    // 移除滚动监听器
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

    // 清除自动填充定时器
    clearAutoFillTimer() {
        const ctx = this.ctx;
        if (ctx.autoFillTimer) {
            clearTimeout(ctx.autoFillTimer);
            ctx.autoFillTimer = null;
        }
    }

    // 延迟检查是否需要自动加载更多
    scheduleAutoFillCheck() {
        const ctx = this.ctx;
        this.clearAutoFillTimer();
        ctx.autoFillTimer = setTimeout(() => {
            ctx.autoFillTimer = null;
            this.checkAndLoadMoreIfNeeded();
        }, 100);
    }

    // 检查是否需要自动加载更多任务
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

        // 如果内容高度小于等于容器高度，说明所有任务都在可视范围内，需要加载更多
        // 同时确保还有更多页面可加载
        if (scrollHeight <= clientHeight && ctx.currentPage < ctx.totalPages) {
            logger.info('Content fits in viewport, auto-loading more tasks');
            ctx.autoFillCount++;
            this.loadMoreTasks().then(() => {
                // 加载完成后再次检查,直到内容超过容器高度
                if (ctx.isMobileDevice()) this.scheduleAutoFillCheck();
            });
        }
    }

    // 加载更多任务（无限下拉）
    async loadMoreTasks() {
        const ctx = this.ctx;
        if (ctx.isLoadingMore || !ctx.hasMoreTasks) return;

        // 如果已经是最后一页，不再加载
        if (ctx.currentPage >= ctx.totalPages) {
            ctx.hasMoreTasks = false;
            this.showNoMoreTasks();
            return;
        }

        ctx.isLoadingMore = true;
        this.showLoadingMore();
        const nextPage = ctx.currentPage + 1;
        const token = ctx.listLoadToken; // 记录当前令牌，用于判断结果是否仍然有效
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
                    // 将新任务追加到现有任务列表
                    ctx.tasks = [...ctx.tasks, ...newTasks];
                    ctx.currentPage = nextPage;
                    // 渲染新增的任务
                    this.appendTasks(newTasks);
                    // 检查是否还有更多任务
                    ctx.hasMoreTasks = ctx.currentPage < ctx.totalPages;
                    // 如果是最后一页，显示到底提示
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

    // 追加任务到列表
    appendTasks(newTasks) {
        const ctx = this.ctx;
        if (!ctx.tasksList || !Array.isArray(newTasks) || newTasks.length === 0) return;

        // 同步刷新分类缓存后拼 HTML，名称随节点一起生成，无需再回填空转的占位符
        ctx.syncCategoryMap();

        // 生成新任务的HTML（先在游离容器中构建，便于只给新增节点绑定事件）
        const temp = document.createElement('div');
        temp.innerHTML = newTasks.map(task => ctx.renderer.createTaskElement(task)).join('');

        // 绑定新增任务的事件（作用域限定为新增节点，已渲染任务不会被重复绑定）
        ctx.rowInteractions.bindEvents(temp);

        // 插入到"加载中"指示器之前，保证指示器始终位于列表末尾
        const anchor = this.getLoadingMoreEl();
        while (temp.firstChild) {
            if (anchor) ctx.tasksList.insertBefore(temp.firstChild, anchor);
            else ctx.tasksList.appendChild(temp.firstChild);
        }
    }

    // 获取"加载更多"指示器（动态创建，需要实时查询）
    getLoadingMoreEl() {
        if (!this.ctx.tasksList) return null;
        return this.ctx.tasksList.querySelector('#loading-more');
    }

    // 获取"已经到底了"提示（动态创建，需要实时查询）
    getNoMoreTasksEl() {
        if (!this.ctx.tasksList) return null;
        return this.ctx.tasksList.querySelector('#no-more-tasks');
    }

    // 显示"加载更多"指示器
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

    // 隐藏"加载更多"指示器
    hideLoadingMore() {
        const el = this.getLoadingMoreEl();
        if (el) el.remove();
    }

    // 显示"已经到底了"提示
    showNoMoreTasks() {
        const ctx = this.ctx;
        if (!ctx.tasksList) return;
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
        ctx.tasksList.appendChild(noMoreDiv);
    }

    // 隐藏"已经到底了"提示
    hideNoMoreTasks() {
        const el = this.getNoMoreTasksEl();
        if (el) el.remove();
    }

    // 重置无限下拉状态（仅重置状态，加载由调用方负责，避免重复请求）
    reset() {
        const ctx = this.ctx;
        // 使飞行中的"加载更多"结果失效
        ctx.listLoadToken++;
        ctx.isLoadingMore = false;
        ctx.hasMoreTasks = true;
        ctx.currentPage = 1;
        ctx.autoFillCount = 0;
        this.clearAutoFillTimer();
        this.hideNoMoreTasks();
        this.hideLoadingMore();
    }
}

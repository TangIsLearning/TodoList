/**
 * 任务管理 - 分页与无限滚动（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
    // 渲染分页组件
    renderPagination() {
        // 仅列表视图显示分页；日历/时间轴/统计等视图加载任务后隐藏，避免分页错位显示
        if (window.viewManager && window.viewManager.currentView !== 'list') {
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
    },

    // 跳转到指定页
    async goToPage(page) {
        if (page < 1 || page > this.totalPages || page === this.currentPage) return;

        this.currentPage = page;
        await this.loadTasks();
        
        // 滚动到任务列表顶部
        this.tasksContainer.scrollTop = 0;
    },

    // 更改每页显示数量
    async changePageSize(pageSize) {
        if (pageSize === this.pageSize) return;
        
        this.pageSize = parseInt(pageSize);
        this.currentPage = 1; // 重置到第一页
        this.resetInfiniteScroll(); // 重置无限下拉状态
        await this.loadTasks();
    },

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
    },

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
    },

    // 清除自动填充定时器
    clearAutoFillTimer() {
        if (this.autoFillTimer) {
            clearTimeout(this.autoFillTimer);
            this.autoFillTimer = null;
        }
    },

    // 延迟检查是否需要自动加载更多
    scheduleAutoFillCheck() {
        this.clearAutoFillTimer();
        this.autoFillTimer = setTimeout(() => {
            this.autoFillTimer = null;
            this.checkAndLoadMoreIfNeeded();
        }, 100);
    },

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
    },

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
    },

    // 追加任务到列表
    appendTasks(newTasks) {
        if (!this.tasksList || !Array.isArray(newTasks) || newTasks.length === 0) return;

        // 同步刷新分类缓存后拼 HTML，名称随节点一起生成，无需再回填空转的占位符
        this.syncCategoryMap();

        // 生成新任务的HTML（先在游离容器中构建，便于只给新增节点绑定事件）
        const temp = document.createElement('div');
        temp.innerHTML = newTasks.map(task => this.createTaskElement(task)).join('');

        // 绑定新增任务的事件（作用域限定为新增节点，已渲染任务不会被重复绑定）
        // 注意：不 await —— 下面的搬移必须在同步流程内完成，
        // 否则 bindTaskEvents 内部 await 之后再用 temp 查询会查不到节点（它只做同步快照，故不受影响）
        this.bindTaskEvents(temp);

        // 插入到"加载中"指示器之前，保证指示器始终位于列表末尾
        const anchor = this.getLoadingMoreEl();
        while (temp.firstChild) {
            if (anchor) this.tasksList.insertBefore(temp.firstChild, anchor);
            else this.tasksList.appendChild(temp.firstChild);
        }
    },

    // 获取"加载更多"指示器（动态创建，需要实时查询）
    getLoadingMoreEl() {
        if (!this.tasksList) return null;
        return this.tasksList.querySelector('#loading-more');
    },

    // 获取"已经到底了"提示（动态创建，需要实时查询）
    getNoMoreTasksEl() {
        if (!this.tasksList) return null;
        return this.tasksList.querySelector('#no-more-tasks');
    },

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
    },

    // 隐藏"加载更多"指示器
    hideLoadingMore() {
        this.getLoadingMoreEl()?.remove();
    },

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
    },

    // 隐藏"已经到底了"提示
    hideNoMoreTasks() {
        this.getNoMoreTasksEl()?.remove();
    },

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
    },
});
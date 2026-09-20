// 分类管理模块

class CategoryManager {
    constructor() {
        this.categories = [];
        this.currentCategory = 'all';
        this.defaultShowCategories = 3; // 默认只展示4个分类项，超出则隐藏
        this._statsDebounceTimer = null;
        this._pendingFromZero = false;
        // 最近一次分类计数结果，供 renderCategories 复用，避免每次重渲染都拉一次全量任务
        this._lastCounts = null;
    }
    
    // 初始化
    async init() {
        await this.loadCategories();
        this.bindEvents();
        this.renderCategories();
        
        // 设置初始筛选状态为"全部"
        this.setActiveCategory('all');
    }
    
    // 绑定事件
    bindEvents() {
        // 添加分类按钮
        const showMoreCategories = document.getElementById('categories-more');
        if (showMoreCategories) {
            showMoreCategories.addEventListener('click', () => {
                if (this.categories.length <= this.defaultShowCategories) return;
                let isShowMore = showMoreCategories.classList.contains('selected');
                if (isShowMore) {
                    showMoreCategories.classList.remove('selected');
                } else {
                    showMoreCategories.classList.add('selected');
                }
                this.renderCategories(false, !isShowMore);
            });
        }

        // 添加分类按钮
        const addCategoryBtn = document.getElementById('add-category-btn');
        addCategoryBtn?.addEventListener('click', () => this.showAddCategoryModal());

        // 分类表单
        const categoryForm = document.getElementById('category-form');
        categoryForm?.addEventListener('submit', (e) => this.handleCategorySubmit(e));

        // 模态框关闭按钮
        const modalClose = document.getElementById('category-modal-close');
        const cancelBtn = document.getElementById('category-cancel-btn');
        modalClose?.addEventListener('click', () => Utils.ModalManager.hide('category-modal'));
        cancelBtn?.addEventListener('click', () => Utils.ModalManager.hide('category-modal'));

        // 颜色预设按钮
        document.querySelectorAll('.color-presets button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                document.getElementById('category-color').value = color;
            });
        });
        
        // 分类筛选、编辑和删除
        document.addEventListener('click', (e) => {
            // 删除分类按钮
            if (e.target.closest('.category-delete-btn')) {
                e.stopPropagation();
                const deleteBtn = e.target.closest('.category-delete-btn');
                const categoryId = deleteBtn.dataset.categoryId;
                logger.info('Delete button clicked for category:', categoryId);
                this.deleteCategory(categoryId);
                return;
            }
            
            // 编辑分类按钮
            if (e.target.closest('.category-edit-btn')) {
                e.stopPropagation();
                const editBtn = e.target.closest('.category-edit-btn');
                const categoryId = editBtn.dataset.categoryId;
                logger.info('Edit button clicked for category:', categoryId);
                this.editCategory(categoryId);
                return;
            }
            
            // 分类筛选 - 确保不是点击按钮时触发
            if (e.target.closest('.category-item-btn') && !e.target.closest('.category-edit-btn') && !e.target.closest('.category-delete-btn')) {
                const categoryItem = e.target.closest('.category-item-btn');
                const categoryId = categoryItem.dataset.category;
                this.filterByCategory(categoryId);
            }
        });
        
        // 删除按钮悬停事件 - 隐藏数字
        document.addEventListener('mouseover', (e) => {
            if (e.target.closest('.category-delete-btn')) {
                const wrapper = e.target.closest('.category-item-wrapper');
                const countElement = wrapper.querySelector('.category-count');
                if (countElement) {
                    countElement.style.opacity = '0';
                    countElement.style.visibility = 'hidden';
                }
            }
        });
        
        document.addEventListener('mouseout', (e) => {
            if (e.target.closest('.category-delete-btn')) {
                const wrapper = e.target.closest('.category-item-wrapper');
                const countElement = wrapper.querySelector('.category-count');
                if (countElement) {
                    countElement.style.opacity = '1';
                    countElement.style.visibility = 'visible';
                }
            }
        });
    }
    
    // 加载分类
    async loadCategories() {
        await Utils.apiCall({
            apiMethod: 'get_categories',
            onSuccess: (response) => this.categories = response.data,
            onError: (error) => Utils.showToast(window.languageManager.getText('loadCategoriesFailed', '加载分类失败'), 'error')
        });
    }
    
    // 渲染分类列表
    // fetchCounts=false：计数不在这里取，交由调用方（App.notifyDataChanged → refreshCounts）
    // 统一驱动，避免同一轮刷新里取两遍。fallbackCounts 为纯粹的占位显示值，
    // 只在缓存已失效时用来避免闪 0，不会被写回缓存。
    async renderCategories(defaultFiltered = true, isShowMore=false, fetchCounts=true, fallbackCounts=null) {
        const categoryList = document.getElementById('category-list');
        if (!categoryList) return;
        
        // 加载任务数量统计：优先复用最近一次结果（由 refreshCounts / 上一次渲染维护），
        // 展开/收起分类这类纯 UI 重渲染无需再拉一次全量任务；
        // 缓存为空（首次渲染，或分类增删改后主动失效）时才真正取数，并回填缓存
        let taskCounts = this._lastCounts || fallbackCounts;
        if (!taskCounts && fetchCounts) {
            taskCounts = await this.getTaskCounts(defaultFiltered);
            this._lastCounts = taskCounts;
        }
        
        // 生成HTML
        const categoriesHtml = this.generateCategoriesHtml(taskCounts || {}, isShowMore);
        categoryList.innerHTML = categoriesHtml;

        // 当分类项小于默认值时，展开更多按钮样式设置为禁用状态
        const showMoreCategories = document.getElementById('categories-more');
        if (this.categories.length <= this.defaultShowCategories) {
            showMoreCategories.disabled = true;
            showMoreCategories.style.pointerEvents = 'auto';
            showMoreCategories.style.cursor = 'not-allowed';
            showMoreCategories.classList.remove('selected');
        } else {
            showMoreCategories.disabled = false;
            showMoreCategories.style.pointerEvents = 'auto';
            showMoreCategories.style.cursor = 'pointer';
        }
        
        // 设置当前分类的激活状态
        this.setActiveCategory(this.currentCategory);
    }
    
    // 分类集合发生变化（新建 / 编辑 / 删除）后的完整刷新。
    // 必须串行：先等最新分类数据回来，再重建列表。
    // 之前 loadCategories() 与 renderCategories() 都是"发完就不管"，渲染跑在取数前面，
    // 用的是旧 categories —— 删掉的分类会被重新渲染回页面，新建的也不会出现。
    async refreshAfterCategoryChange() {
        // 保留"更多"的展开状态，避免刷新后列表被莫名收起
        const showMoreBtn = document.getElementById('categories-more');
        const isShowMore = !!showMoreBtn?.classList.contains('selected');

        this._lastCounts = null;       // 分类集合变了，旧的计数缓存失效，必须重新取数
        await this.loadCategories();
        await this.renderCategories(true, isShowMore); // 缓存已清空 → 重新拉全量未完成并重算计数
    }

    // 生成分类HTML
    generateCategoriesHtml(taskCounts, isShowMore=false) {
        let html = `
            <button class="btn btn--colorless btn--width-100 category-item-btn" data-category="all">
                <span class="category-item-with-color">
                    <span class="category-color-indicator" style="background-color: var(--primary-color);"></span>
                    <span id="allCategories">${window.languageManager.getText('allCategories', '全部')}</span>
                </span>
                <span class="category-count">${taskCounts.all || 0}</span>
            </button>
        `;
        
        this.categories.forEach((category, index) => {
            if (!isShowMore && index >= this.defaultShowCategories) return;
            const count = taskCounts[category.id] || 0;
            html += `
                <div class="category-item-wrapper" data-category-id="${category.id}">
                    <button class="btn btn--colorless btn--width-100 category-item-btn" data-category="${category.id}">
                        <span class="category-item-with-color">
                            <span class="category-color-indicator" style="background-color: ${category.color};"></span>
                            <span>${Utils.escapeHtml(category.name)}</span>
                        </span>
                        <span class="category-count">${count}</span>
                    </button>
                    <button class="btn btn--colorless category-edit-btn" data-category-id="${category.id}" title="编辑分类">
                        ✏️
                    </button>
                    <button class="btn btn--colorless category-delete-btn" data-category-id="${category.id}" title="删除分类">
                        🗑️
                    </button>
                </div>
            `;
        });
        
        return html;
    }
    
    // 获取任务数量统计
    async getTaskCounts(defaultFiltered = true, filteredTasks = null) {
        // defaultFiltered 仅为兼容调用方保留，不再影响取数口径
        const data = filteredTasks
            ? this._countsFromTasks(filteredTasks)
            : await this._fetchCountsData();

        return this._normalizeCounts(data);
    }

    // 取分类计数：直接问后端要聚合结果（一次 GROUP BY），不再拉全量任务自行遍历
    async _fetchCountsData() {
        let data = null;
        await Utils.apiCall({
            apiMethod: 'get_category_task_counts',
            onSuccess: (response) => data = response.data,
            onError: () => {
                // 聚合接口不可用时退回列表当前数据本地统计，口径仍为"未完成"
                const fallback = window.todoManager?.tasks;
                if (fallback && fallback.length) data = this._countsFromTasks(fallback);
            }
        });
        return data;
    }

    // 后端聚合结果 → 渲染所需的扁平结构 { all, [categoryId]: n }
    _normalizeCounts(data) {
        const counts = { all: (data && data.all) || 0 };
        const byCategory = (data && data.counts) || {};
        Object.keys(byCategory).forEach(id => {
            counts[id] = byCategory[id];
        });
        return counts;
    }

    // 本地兜底换算：与后端同一口径（未完成任务），结构也与聚合接口保持一致
    _countsFromTasks(tasks) {
        const counts = {};
        let all = 0;
        (tasks || []).forEach(task => {
            if (task.completed) return;
            all += 1;
            if (task.categoryId) {
                counts[task.categoryId] = (counts[task.categoryId] || 0) + 1;
            }
        });
        return { all, counts };
    }
    
    // 按分类筛选
    async filterByCategory(categoryId) {
        this.currentCategory = categoryId;
        this.setActiveCategory(categoryId);
        
        // 通知TodoManager进行筛选
        if (window.todoManager) {
            window.todoManager.currentFilter = categoryId;
            window.todoManager.currentPage = 1; // 重置到第一页
            window.todoManager.customDateFilter = null; // 清除自定义日期筛选
            window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
            await window.todoManager.loadTasks();
        }
    }
    
    // 设置激活的分类
    setActiveCategory(categoryId) {
        document.querySelectorAll('.category-item-btn').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeItem = document.querySelector(`[data-category="${categoryId}"]`);
        if (activeItem) activeItem.classList.add('active');
    }
    
    // 显示添加分类模态框
    showAddCategoryModal() {
        const categoryForm = document.getElementById('category-form');
        const modalTitle = document.getElementById('category-modal-title');
        
        categoryForm.reset();
        categoryForm.dataset.editingId = '';
        modalTitle.textContent = window.languageManager.getText('newCategory', '新建分类');

        // 设置默认颜色：优先取当前主题的强调色，使新建分类默认与主题协调；
        // 主题配色模块未就绪时退回内置色板
        const colors = (window.AccentThemeManager && AccentThemeManager.getAccentHexPalette())
            || ['#007bff', '#28a745', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        document.getElementById('category-color').value = randomColor;
        
        Utils.ModalManager.show('category-modal');
    }
    
    // 处理分类表单提交
    async handleCategorySubmit(e) {
        e.preventDefault();
        
        const categoryForm = e.target;
        const editingId = categoryForm.dataset.editingId;
        const isEdit = editingId && editingId !== '';
        
        const categoryData = {
            name: document.getElementById('category-name').value.trim(),
            color: document.getElementById('category-color').value
        };
        
        if (!categoryData.name) {
            Utils.showToast(window.languageManager.getText('errorCategoryNameRequired', '请输入分类名称'), 'warning');
            return;
        }
        
        // 检查重名
        const isDuplicate = this.categories.some(cat => 
            cat.id !== editingId && cat.name === categoryData.name
        );
        
        if (isDuplicate) {
            Utils.showToast(window.languageManager.getText('errorCategoryExisted', '分类名称已存在'), 'warning');
            return;
        }

        let apiMethod;
        let apiArgs = [];
        if (isEdit) {
            apiMethod = 'update_category';
            apiArgs = [editingId, categoryData];
        } else {
            apiMethod = 'add_category';
            apiArgs = [categoryData];
        }
        Utils.setLoading(true, isEdit ? '更新中...' : '创建中...');
        await Utils.apiCall({
            apiMethod: apiMethod,
            apiArgs: apiArgs,
            onSuccess: async (response) => {
                Utils.showToast(isEdit ?
                    window.languageManager.getText('categoryUpdated', '分类更新成功') :
                    window.languageManager.getText('categoryCreated', '分类创建成功'), 'success');
                Utils.ModalManager.hide('category-modal');

                // 串行刷新：拿最新分类 → 重算计数 → 重建列表
                await this.refreshAfterCategoryChange();

                // 重新加载任务列表以更新分类信息
                window.todoManager?.loadTasks();
                // 左侧计数已由 refreshAfterCategoryChange 重算，这里只补刷顶部统计条
                window.App?.notifyDataChanged({ skipCategoryCounts: true });
                // 云端同步已由后端写操作 API 上的 @auto_sync 统一触发，前端无需再手工调用
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });
    }
    
    // 编辑分类
    async editCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        // 显示编辑对话框
        this.showEditCategoryModal(category);
    }
    
    showEditCategoryModal(category) {
        const modal = document.getElementById('category-modal');
        const modalTitle = document.getElementById('category-modal-title');
        const form = document.getElementById('category-form');
        
        if (!modal || !modalTitle || !form) return;
        
        modalTitle.textContent = window.languageManager.getText('editCategory', '编辑分类');
        document.getElementById('category-name').value = category.name;
        document.getElementById('category-color').value = category.color;
        
        // 修改表单提交行为为编辑模式
        form.dataset.editingId = category.id;
        
        Utils.ModalManager.show('category-modal');
    }
    
    async deleteCategory(categoryId) {
        const category = this.categories.find(c => c.id === categoryId);
        if (!category) return;
        
        // 检查是否有任务使用此分类
        const taskCount = await this.getCategoryTaskCount(categoryId);
        const message = taskCount > 0 
            ? `分类"${category.name}"下有 ${taskCount} 个任务，删除后这些任务将变为无分类。\n确定要删除吗？`
            : `确定要删除分类"${category.name}"吗？`;
        
        Utils.confirmDialog(message, async () => {
            Utils.setLoading(true, '删除中...');
            Utils.apiCall({
                apiMethod: 'delete_category',
                apiArgs: [categoryId],
                onSuccess: async (response) => {
                    Utils.showToast(window.languageManager.getText('categoryDeleted', '分类删除成功'), 'success');

                    // 如果当前选中的是被删除的分类，切回"全部"（内部已重新加载列表）；
                    // 否则当前筛选不受影响，下面再补刷一次
                    const switchedToAll = this.currentCategory === categoryId;
                    if (switchedToAll) {
                        await this.filterByCategory('all');
                    }

                    // 串行刷新：拿最新分类 → 重算计数 → 重建列表
                    await this.refreshAfterCategoryChange();

                    // 重新加载任务列表
                    if (!switchedToAll) window.todoManager?.loadTasks();
                    // 左侧计数已由 refreshAfterCategoryChange 重算，这里只补刷顶部统计条
                    window.App?.notifyDataChanged({ skipCategoryCounts: true });
                    // 云端同步已由后端写操作 API 上的 @auto_sync 统一触发，前端无需再手工调用
                },
                onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
                onFinally: () => Utils.setLoading(false)
            });
        });
    }
    
    // 获取分类下的任务数量（删除分类确认弹窗用）
    async getCategoryTaskCount(categoryId) {
        // 删除分类会让该分类下所有任务（含已完成）变为无分类，
        // 所以这里取"全部任务数"而不是"未完成任务数"，与弹窗提示的语义一致。
        const data = await this._fetchCountsData();
        return (data && data.totals && data.totals[categoryId]) || 0;
    }
    
    // 获取分类信息
    getCategoryById(categoryId) {
        return this.categories.find(c => c.id === categoryId);
    }
    
    // 获取分类名称
    getCategoryName(categoryId) {
        const category = this.getCategoryById(categoryId);
        return category ? category.name : '未知分类';
    }
    
    // 获取分类颜色
    getCategoryColor(categoryId) {
        const category = this.getCategoryById(categoryId);
        return category ? category.color : 'var(--primary-color)';
    }
    
    // 左侧分类计数：口径固定为"未完成任务数"，与列表当前筛选无关。
    // 取数走后端聚合接口 get_category_task_counts（一次 GROUP BY，只回传计数），
    // 由数据变更驱动（window.App.notifyDataChanged），不再挂在任务列表的每次加载上：
    // 翻页/搜索/切视图都不会再触发计数取数，更不会拉全量任务。
    async refreshCounts(fromZero = false) {
        // 取数与兜底都收敛在 _fetchCountsData，这里只负责把结果交给渲染
        this.updateCategoryCounts(await this._fetchCountsData(), fromZero);
    }

    // 更新分类任务数量（只负责渲染，数据来自聚合接口或调用方传入的同构计数）
    updateCategoryCounts(countsData = null, fromZero = false) {
        if (fromZero) this._pendingFromZero = true;

        if (this._statsDebounceTimer) {
            clearTimeout(this._statsDebounceTimer);
        }

        this._statsDebounceTimer = setTimeout(() => {
            const shouldFromZero = this._pendingFromZero;
            this._pendingFromZero = false;
            this._statsDebounceTimer = null;

            const taskCounts = this._normalizeCounts(countsData);
            this._lastCounts = taskCounts;

            // 更新"全部"分类的数量 - 口径固定为未完成任务总数
            const allCountEl = document.querySelector('[data-category="all"] .category-count');
            if (allCountEl) {
                const allCount = taskCounts.all || 0;
                Utils.animateNumber(allCountEl, allCount, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
            }

            // 更新各个分类的数量
            this.categories.forEach(category => {
                const count = taskCounts[category.id] || 0;
                const countEl = document.querySelector(`[data-category="${category.id}"] .category-count`);
                if (countEl) {
                    Utils.animateNumber(countEl, count, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                }
            });
        }, 200);
    }
    
    // 重新加载数据（切库 / 导入 / 页面重新可见等"数据可能整体换了一批"的场景）
    async refresh() {
        // 计数不在这里取：两个调用方（App.refreshData / App.reloadAfterDataReplaced）
        // 之后都会走 notifyDataChanged → refreshCounts，这里再取一次等于同一轮刷新取两遍。
        // 所以缓存立即失效，上一次的计数只作为占位显示值沿用（避免先闪 0），
        // 等 refreshCounts 取到新值后再由动画覆盖；万一后续 notifyDataChanged 没跑到，
        // 缓存为空也会让下一次渲染重新取数，不会把过期值一直当缓存用。
        const staleCounts = this._lastCounts;
        this._lastCounts = null;
        await this.loadCategories();
        await this.renderCategories(false, false, false, staleCounts);
    }
}

// 创建全局实例
window.categoryManager = new CategoryManager();
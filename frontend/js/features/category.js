// 分类管理模块

class CategoryManager {
    constructor() {
        this.categories = [];
        this.currentCategory = 'all';
        this.defaultShowCategories = 3; // 默认只展示4个分类项，超出则隐藏
        this._statsDebounceTimer = null;
        this._pendingFromZero = false;
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
    async renderCategories(defaultFiltered = true, isShowMore=false) {
        const categoryList = document.getElementById('category-list');
        if (!categoryList) return;
        
        // 加载任务数量统计
        const taskCounts = await this.getTaskCounts(defaultFiltered);
        
        // 生成HTML
        const categoriesHtml = this.generateCategoriesHtml(taskCounts, isShowMore);
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
        const counts = { all: 0 };
        let tasks = [];

        // 如果外部已传入筛选后的任务，直接使用，无需调 API
        if (filteredTasks) {
            tasks = filteredTasks;
        } else {
            // 根据 defaultFiltered 决定 API 参数（保持原有逻辑）
            const apiArgs = defaultFiltered
                ? []
                : [1, 999999, null, 'uncompleted', null, null, null, null, null, null];

            // 调用公共方法，自动处理加载检查、错误日志和成功/失败回调
            await Utils.apiCall({
                apiMethod: 'get_todos',
                apiArgs: apiArgs,
                onSuccess: (response) => tasks = response.data.tasks
            });
        }

        // ---- 统计逻辑 ----
        counts.all = tasks.length;
        tasks.forEach(task => {
            if (task.categoryId) {
                counts[task.categoryId] = (counts[task.categoryId] || 0) + 1;
            }
        });

        return counts;
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
        modalTitle.textContent = '新建分类';
        
        // 设置默认颜色
        const colors = ['#007bff', '#28a745', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14'];
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
            onSuccess: (response) => {
                Utils.showToast(isEdit ?
                    window.languageManager.getText('categoryUpdated', '分类更新成功') :
                    window.languageManager.getText('categoryCreated', '分类创建成功'), 'success');
                Utils.ModalManager.hide('category-modal');

                this.loadCategories();
                this.renderCategories();

                // 重新加载任务列表以更新分类信息
                window.todoManager?.loadTasks();
                // 触发云端同步上传
                window.todoManager?.triggerCloudUpload();
            },
            onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
            onFinally: () => Utils.setLoading(false)
        });
    }
    
    // 删除分类
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
        
        modalTitle.textContent = '编辑分类';
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
                onSuccess: (response) => {
                    Utils.showToast(window.languageManager.getText('categoryDeleted', '分类删除成功'), 'success');

                    // 如果当前选中的是被删除的分类，切换到"全部"
                    if (this.currentCategory === categoryId) {
                        this.filterByCategory('all');
                    }

                    this.loadCategories();
                    this.renderCategories();

                    // 重新加载任务列表
                    window.todoManager?.loadTasks();
                    // 触发云端同步上传
                    window.todoManager?.triggerCloudUpload();
                },
                onError: (error) => Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error'),
                onFinally: () => Utils.setLoading(false)
            });
        });
    }
    
    // 获取分类下的任务数量
    async getCategoryTaskCount(categoryId) {
        let count = 0;
        await Utils.apiCall({
            apiMethod: 'get_todos',
            onSuccess: (response) => count = response.data.tasks.filter(task => task.categoryId === categoryId).length
        });
        return count;
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
        return category ? category.color : '#007bff';
    }
    
    // 更新分类任务数量
    async updateCategoryCounts(filteredTasks = null, fromZero = false) {
        if (fromZero) this._pendingFromZero = true;

        if (this._statsDebounceTimer) {
            clearTimeout(this._statsDebounceTimer);
        }

        this._statsDebounceTimer = setTimeout(async () => {
            const shouldFromZero = this._pendingFromZero;
            this._pendingFromZero = false;
            this._statsDebounceTimer = null;

            const taskCounts = await this.getTaskCounts(true, filteredTasks);

            // 更新"全部"分类的数量 - 如果有筛选任务则显示筛选后的数量，否则显示总数量
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
    
    // 重新加载数据
    async refresh() {
        await this.loadCategories();
        await this.renderCategories(false);
    }
}

// 创建全局实例
window.categoryManager = new CategoryManager();
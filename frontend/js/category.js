// 分类管理模块

class CategoryManager {
    constructor() {
        this.categories = [];
        this.currentCategory = 'all';
    }
    
    // 初始化
    async init() {
        this.bindEvents();
        await this.loadCategories();
        this.renderCategories();
        
        // 设置初始筛选状态为"全部"
        this.setActiveCategory('all');
    }
    
    // 绑定事件
    bindEvents() {
        // 添加分类按钮
        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) {
            addCategoryBtn.addEventListener('click', () => this.showAddCategoryModal());
        }
        
        // 分类表单
        const categoryForm = document.getElementById('category-form');
        if (categoryForm) {
            categoryForm.addEventListener('submit', (e) => this.handleCategorySubmit(e));
        }
        
        // 模态框关闭按钮
        const modalClose = document.getElementById('category-modal-close');
        const cancelBtn = document.getElementById('category-cancel-btn');
        
        if (modalClose) {
            modalClose.addEventListener('click', () => Utils.ModalManager.hide('category-modal'));
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => Utils.ModalManager.hide('category-modal'));
        }
        
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
                console.log('Delete button clicked for category:', categoryId);
                this.deleteCategory(categoryId);
                return;
            }
            
            // 编辑分类按钮
            if (e.target.closest('.category-edit-btn')) {
                e.stopPropagation();
                const editBtn = e.target.closest('.category-edit-btn');
                const categoryId = editBtn.dataset.categoryId;
                console.log('Edit button clicked for category:', categoryId);
                this.editCategory(categoryId);
                return;
            }
            
            // 分类筛选 - 确保不是点击按钮时触发
            if (e.target.closest('.category-item') && !e.target.closest('.category-edit-btn') && !e.target.closest('.category-delete-btn')) {
                const categoryItem = e.target.closest('.category-item');
                const categoryId = categoryItem.dataset.category;
                console.log('Category clicked:', categoryId); // 调试日志
                console.log('Category element:', categoryItem); // 调试日志
                console.log('Target element:', e.target); // 调试日志
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
        try {
            let response;
            let useCache = false;
            
            try {
                // 优先查询数据库
                response = await pywebview.api.get_categories();
            } catch (error) {
                console.warn('数据库查询分类失败，尝试使用缓存:', error);
                // 数据库查询失败，尝试使用缓存
                const cachedCategories = window.DataCache.get('categories');
                
                if (cachedCategories) {
                    console.log('使用缓存的分类数据');
                    response = cachedCategories;
                    useCache = true;
                } else {
                    this.categories = [];
                    Utils.showToast('加载分类失败', 'error');
                    return;
                }
            }
            
            if (response.success) {
                this.categories = response.categories;
                
                // 缓存分类数据
                if (!useCache) {
                    window.DataCache.set('categories', response);
                }
                
                if (useCache) {
                    Utils.showToast('使用缓存分类数据，网络连接可能异常', 'warning');
                }
            } else {
                Utils.showToast('加载分类失败: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('加载分类失败:', error);
            Utils.showToast('加载分类失败', 'error');
        }
    }
    
    // 渲染分类列表
    async renderCategories() {
        const categoryList = document.getElementById('category-list');
        if (!categoryList) return;
        
        // 加载任务数量统计
        const taskCounts = await this.getTaskCounts();
        
        // 生成HTML
        const categoriesHtml = this.generateCategoriesHtml(taskCounts);
        categoryList.innerHTML = categoriesHtml;
        
        // 设置当前分类的激活状态
        this.setActiveCategory(this.currentCategory);
    }
    
    // 生成分类HTML
    generateCategoriesHtml(taskCounts) {
        let html = `
            <button class="category-item" data-category="all">
                <span class="category-item-with-color">
                    <span class="category-color-indicator" style="background-color: var(--primary-color);"></span>
                    <span>📋 全部</span>
                </span>
                <span class="category-count">${taskCounts.all || 0}</span>
            </button>
        `;
        
        this.categories.forEach(category => {
            const count = taskCounts[category.id] || 0;
            html += `
                <div class="category-item-wrapper" data-category-id="${category.id}">
                    <button class="category-item" data-category="${category.id}">
                        <span class="category-item-with-color">
                            <span class="category-color-indicator" style="background-color: ${category.color};"></span>
                            <span>${Utils.escapeHtml(category.name)}</span>
                        </span>
                        <span class="category-count">${count}</span>
                    </button>
                    <button class="category-edit-btn" data-category-id="${category.id}" title="编辑分类">
                        ✏️
                    </button>
                    <button class="category-delete-btn" data-category-id="${category.id}" title="删除分类">
                        🗑️
                    </button>
                </div>
            `;
        });
        
        return html;
    }
    
    // 获取任务数量统计
    async getTaskCounts(filteredTasks = null) {
        const counts = { all: 0 };
        
        try {
            // 如果没有传入筛选后的任务，则获取所有任务
            let tasks;
            if (filteredTasks) {
                tasks = filteredTasks;
            } else {
                const response = await pywebview.api.get_todos();
                if (response.success) {
                    tasks = response.tasks;
                } else {
                    return counts;
                }
            }
            
            counts.all = tasks.length;
            
            tasks.forEach(task => {
                if (task.categoryId) {
                    counts[task.categoryId] = (counts[task.categoryId] || 0) + 1;
                }
            });
        } catch (error) {
            console.error('获取任务统计失败:', error);
        }
        
        return counts;
    }
    
    // 按分类筛选
    async filterByCategory(categoryId) {
        console.log('Filtering by category:', categoryId); // 调试日志
        this.currentCategory = categoryId;
        this.setActiveCategory(categoryId);
        
        // 通知TodoManager进行筛选
        if (window.todoManager) {
            console.log('Notifying TodoManager to filter by:', categoryId); // 调试日志
            console.log('Current tasks before filter:', window.todoManager.tasks.length); // 调试日志
            window.todoManager.currentFilter = categoryId;
            window.todoManager.currentPage = 1; // 重置到第一页
            window.todoManager.customDateFilter = null; // 清除自定义日期筛选
            window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
            await window.todoManager.loadTasks();
            console.log('Filter completed'); // 调试日志
        } else {
            console.log('TodoManager not available'); // 调试日志
        }
    }
    
    // 设置激活的分类
    setActiveCategory(categoryId) {
        console.log('Setting active category:', categoryId); // 调试日志
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeItem = document.querySelector(`[data-category="${categoryId}"]`);
        console.log('Found active item:', activeItem); // 调试日志
        if (activeItem) {
            activeItem.classList.add('active');
            console.log('Active class added'); // 调试日志
        } else {
            console.log('Active item not found for category:', categoryId); // 调试日志
        }
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
            Utils.showToast('请输入分类名称', 'warning');
            return;
        }
        
        // 检查重名
        const isDuplicate = this.categories.some(cat => 
            cat.id !== editingId && cat.name === categoryData.name
        );
        
        if (isDuplicate) {
            Utils.showToast('分类名称已存在', 'warning');
            return;
        }
        
        try {
            Utils.setLoading(true, isEdit ? '更新中...' : '创建中...');
            
            let response;
            if (isEdit) {
                response = await pywebview.api.update_category(editingId, categoryData);
            } else {
                response = await pywebview.api.add_category(categoryData);
            }
            
            if (response.success) {
                Utils.showToast(isEdit ? '分类更新成功' : '分类创建成功', 'success');
                Utils.ModalManager.hide('category-modal');
                
                // 清除缓存，因为数据已更新
                window.DataCache.remove('categories');
                
                await this.loadCategories();
                await this.renderCategories();
                
                // 重新加载任务列表以更新分类信息
                if (window.todoManager) {
                    await window.todoManager.loadTasks();
                }
            } else {
                Utils.showToast((isEdit ? '更新' : '创建') + '失败: ' + response.error, 'error');
            }
        } catch (error) {
            console.error('保存分类失败:', error);
            Utils.showToast('保存失败', 'error');
        } finally {
            Utils.setLoading(false);
        }
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
            try {
                Utils.setLoading(true, '删除中...');
                
                const response = await pywebview.api.delete_category(categoryId);
                if (response.success) {
                    Utils.showToast('分类删除成功', 'success');
                    
                    // 清除缓存，因为数据已更新
                    window.DataCache.remove('categories');
                    
                    // 如果当前选中的是被删除的分类，切换到"全部"
                    if (this.currentCategory === categoryId) {
                        this.filterByCategory('all');
                    }
                    
                    await this.loadCategories();
                    await this.renderCategories();
                    
                    // 重新加载任务列表
                    if (window.todoManager) {
                        await window.todoManager.loadTasks();
                    }
                } else {
                    Utils.showToast('删除失败: ' + response.error, 'error');
                }
            } catch (error) {
                console.error('删除分类失败:', error);
                Utils.showToast('删除失败', 'error');
            } finally {
                Utils.setLoading(false);
            }
        });
    }
    
    // 获取分类下的任务数量
    async getCategoryTaskCount(categoryId) {
        try {
            const response = await pywebview.api.get_todos();
            if (response.success) {
                return response.tasks.filter(task => task.categoryId === categoryId).length;
            }
        } catch (error) {
            console.error('获取分类任务数量失败:', error);
        }
        return 0;
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
    async updateCategoryCounts(filteredTasks = null) {
        const taskCounts = await this.getTaskCounts(filteredTasks);
        
        // 更新"全部"分类的数量 - 如果有筛选任务则显示筛选后的数量，否则显示总数量
        const allCountEl = document.querySelector('[data-category="all"] .category-count');
        if (allCountEl) {
            allCountEl.textContent = taskCounts.all || 0;
        }
        
        // 更新各个分类的数量
        this.categories.forEach(category => {
            const count = taskCounts[category.id] || 0;
            const countEl = document.querySelector(`[data-category="${category.id}"] .category-count`);
            if (countEl) {
                countEl.textContent = count;
            }
        });
    }
    
    // 重新加载数据
    async refresh() {
        await this.loadCategories();
        await this.renderCategories();
    }
}

// 创建全局实例
window.categoryManager = new CategoryManager();
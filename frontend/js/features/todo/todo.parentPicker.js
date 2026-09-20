/**
 * 任务管理 - 父任务选择器（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
    // 初始化父任务选择器（只在首次打开时绑定，避免每次打开弹窗重复叠加监听器）
    initParentTaskCombobox() {
        if (this._parentComboboxBound) return;
        this._parentComboboxBound = true;

        // 点击输入框打开下拉
        this.taskParentInput.addEventListener('focus', async (e) => {
            this.parentTaskState.isOpen = true;
            this.taskParentDropdown.style.display = 'block';
            
            // 如果没有内容，加载初始数据
            const results = this.taskParentDropdown.querySelector('.combobox-results');
            if (results.children.length === 0 && !this.parentTaskState.isLoading) await this.loadParentTasks(false);
        });
        
        // 输入搜索
        let searchTimeout;
        this.taskParentInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            // 如果输入框为空，清空父任务选择
            if (query === '') {
                this.taskParent.value = '';
                this.parentTaskState.selectedId = '';
            }
            
            searchTimeout = setTimeout(async () => {
                if (query !== this.parentTaskState.searchQuery) {
                    this.parentTaskState.searchQuery = query;
                    this.parentTaskState.currentPage = 1;
                    await this.loadParentTasks(true);
                }
            }, 300);
        });
        
        // 点击其他地方关闭（按下与抬起都发生在下拉框之外才算，避免拖选文本时误关闭）
        let pressOutside = false;
        const markPressOrigin = (e) => {
            pressOutside = !this.parentTaskCombobox.contains(e.target);
        };
        document.addEventListener('pointerdown', markPressOrigin);
        document.addEventListener('mousedown', markPressOrigin);
        document.addEventListener('click', (e) => {
            const shouldClose = pressOutside && !this.parentTaskCombobox.contains(e.target);
            pressOutside = false;
            if (shouldClose) {
                this.taskParentDropdown.style.display = 'none';
                this.parentTaskState.isOpen = false;
            }
        });
        
        // 加载更多
        this.loadMoreParentTask.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.loadParentTasks(false);
        });
    },
    
    // 加载父任务列表
    async loadParentTasks(isNewSearch = false) {
        const results = this.taskParentDropdown.querySelector('.combobox-results');
        const loading = this.taskParentDropdown.querySelector('.combobox-loading');
        const loadMore = this.taskParentDropdown.querySelector('.combobox-load-more');
        const empty = this.taskParentDropdown.querySelector('.combobox-empty');
        
        if (this.parentTaskState.isLoading) return;
        this.parentTaskState.isLoading = true;
        
        loading.style.display = 'block';
        empty.style.display = 'none';

        const searchQuery = this.parentTaskState.searchQuery;
        const page = this.parentTaskState.currentPage;
        const pageSize = this.parentTaskState.pageSize;
        await Utils.apiCall({
            apiMethod: 'get_todos',
            apiArgs: [{ status: 'uncompleted', searchQuery: searchQuery || null }, page, pageSize],
            onSuccess: (response) => {
                let tasks = response.data.tasks.filter(t => !t.isRecurring && !t.parentTaskId);

                // 排除当前编辑的任务
                if (this.parentTaskState.editingTaskId) {
                    tasks = tasks.filter(t => t.id !== this.parentTaskState.editingTaskId);
                }

                if (isNewSearch) results.innerHTML = '';

                // 渲染任务列表
                if (tasks.length > 0) {
                    tasks.forEach(task => {
                        const item = this.createParentTaskItem(task);
                        results.appendChild(item);
                    });

                    // 使用后端返回的分页信息判断是否有更多
                    const total = response.data.total || 0;
                    const loadedCount = page * pageSize;
                    this.parentTaskState.hasMore = loadedCount < total;

                    loadMore.style.display = this.parentTaskState.hasMore ? 'block' : 'none';
                    empty.style.display = 'none';
                } else if (results.children.length === 0) {
                    empty.style.display = 'block';
                    loadMore.style.display = 'none';
                }
            },
            onFinally: () => {
                this.parentTaskState.isLoading = false;
                this.parentTaskState.currentPage++;
                loading.style.display = 'none';
            }
        });
    },
    
    // 创建父任务列表项
    createParentTaskItem(task) {
        const item = document.createElement('div');
        item.className = 'combobox-item';
        item.dataset.taskId = task.id;
        item.dataset.taskTitle = task.title;
        
        // 显示任务标题和状态
        item.innerHTML = `
            <span class="task-title ${task.completed ? 'completed' : ''}">${Utils.escapeHtml(task.title)}</span>
        `;
        
        item.addEventListener('click', () => this.selectParentTask(task));
        
        return item;
    },
    
    // 选择父任务
    selectParentTask(task) {
        this.taskParentInput.value = task.title;
        this.taskParent.value = task.id;
        this.parentTaskState.selectedId = task.id;
        this.parentTaskState.selectedTitle = task.title || '';
        this.taskParentDropdown.style.display = 'none';
        this.parentTaskState.isOpen = false;
    },
    
    // 重置父任务选择器
    resetParentTaskCombobox() {
        const results = document.querySelector('.combobox-results');
        
        this.taskParentInput.value = '';
        this.taskParent.value = '';
        this.parentTaskState.selectedId = '';
        this.parentTaskState.selectedTitle = '';
        this.parentTaskState.searchQuery = '';
        this.parentTaskState.currentPage = 1;
        this.parentTaskState.hasMore = false;
        
        if (results) results.innerHTML = '';
    },

    // 加载父任务选项（编辑模式）
    async loadParentTaskOptionsForEdit(taskId) {
        let parentId = '';
        await Utils.apiCall({
            apiMethod: 'get_parent',
            apiArgs: [taskId],
            onSuccess: (response) => {
                const parent = response.data;
                if (parent) {
                    parentId = parent.id
                }
            }
        });
        await this.loadParentTaskOptions(parentId);
    },
});
/**
 * 设置中心 - 任务导出弹窗（mixin）
 * 依赖：settings/settings.js（SettingsUIManager 类）
 */

Object.assign(SettingsUIManager.prototype, {

    // ==================== 导出任务相关方法 ====================

    async openExportModal() {
        // 打开导出模态框
        const modal = document.getElementById('export-modal');
        if (modal) {
            modal.classList.remove('is-closing');
            modal.style.display = 'flex';
            modal.classList.add('show');

            // 初始化导出选项
            await this.initExportOptions();
        }
    },

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        if (modal) {
            Utils.closeModalWithAnimation(modal, () => {
                modal.style.display = 'none';
                modal.classList.remove('show');
            });
        }
    },

    async initExportOptions() {
        // 初始化导出选项（分类、年份、标签）
        try {
            // 获取分类列表
            await Utils.apiCall({
                apiMethod: 'get_categories',
                onSuccess: (response) => this.updateExportCategories(response.data)
            });

            // 获取标签列表
            await Utils.apiCall({
                apiMethod: 'get_all_tags',
                onSuccess: (response) => this.updateExportTags(response.data)
            });

            // 获取所有任务以提取年份
            await Utils.apiCall({
                apiMethod: 'get_todos',
                apiArgs: [null, 1, 10000],
                onSuccess: (response) => this.updateExportYears(response.data.tasks)
            });

            // 绑定导出模态框事件
            this.bindExportModalEvents();
        } catch (error) {
            logger.error('初始化导出选项失败:', error);
            Utils.showToast('初始化导出选项失败', 'error');
        }
    },

    updateExportCategories(categories) {
        const select = document.getElementById('export-category');
        if (!select) return;

        // 保留"全部分类"选项
        select.innerHTML = '<option value="all">全部分类</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            select.appendChild(option);
        });
    },

    updateExportTags(tags) {
        const container = document.getElementById('export-tags-container');
        if (!container) return;

        container.innerHTML = '';
        if (!tags || tags.length === 0) {
            container.innerHTML = '<span style="color: var(--text-secondary); font-size: 12px;">暂无标签</span>';
            return;
        }

        tags.forEach(tag => {
            const item = document.createElement('label');
            item.className = 'tag-checkbox-item';
            item.innerHTML = `
                <input type="checkbox" value="${tag.id}" data-tag-id="${tag.id}">
                <span>${Utils.escapeHtml(tag.name)}</span>
            `;
            container.appendChild(item);
        });
    },

    updateExportYears(tasks) {
        const select = document.getElementById('export-year');
        if (!select) return;

        // 提取所有年份
        const years = new Set();
        tasks.forEach(task => {
            if (task.dueDate) {
                const year = new Date(task.dueDate).getFullYear();
                if (year) years.add(year);
            }
        });

        // 按降序排列
        const sortedYears = Array.from(years).sort((a, b) => b - a);

        // 保留"全部年份"选项
        select.innerHTML = '<option value="">全部年份</option>';
        sortedYears.forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year + '年';
            select.appendChild(option);
        });
    },

    bindExportModalEvents() {
        const closeBtn = document.getElementById('export-modal-close');
        const cancelBtn = document.getElementById('export-cancel-btn');
        const confirmBtn = document.getElementById('export-confirm-btn');
        if (closeBtn) closeBtn.onclick = () => this.closeExportModal();
        if (cancelBtn) cancelBtn.onclick = () => this.closeExportModal();
        if (confirmBtn) confirmBtn.onclick = () => this.executeExport();
    },

    async executeExport() {
        // 获取筛选条件
        const priority = document.getElementById('export-priority')?.value || 'all';
        const status = document.getElementById('export-status')?.value || 'all';
        const year = document.getElementById('export-year')?.value || null;
        const month = document.getElementById('export-month')?.value || null;
        const categoryId = document.getElementById('export-category')?.value || 'all';

        // 获取选中的标签
        const tagCheckboxes = document.querySelectorAll('#export-tags-container input[type="checkbox"]:checked');
        const tagIds = Array.from(tagCheckboxes).map(cb => cb.value);
        await Utils.apiCall({
            apiMethod: 'export_tasks_excel',
            apiArgs: [
                priority,
                status,
                year ? parseInt(year) : null,
                month ? parseInt(month) : null,
                categoryId === 'all' ? null : categoryId,
                tagIds.length > 0 ? tagIds : null
            ],
            onSuccess: (response) => {
                Utils.showToast(response.message, 'success');
            },
            onError: (error) => {
                if (error?.code === 'CANCELLED') return; // 用户取消保存，不提示
                Utils.showToast('导出任务失败: ' + error.message, 'error');
            },
            onFinally: () => this.closeExportModal()
        });
    }
});

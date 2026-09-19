/**
 * 任务管理 - 列表显示列配置（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
    // ============ 任务列表显示列配置 ============

    // 获取列定义
    getColumnDef(key) {
        return TASK_LIST_COLUMN_DEFS.find(c => c.key === key);
    },

    // 规范化列配置：过滤非法列，并保证必选列始终存在
    normalizeColumns(keys) {
        const source = Array.isArray(keys) ? keys : [];
        const valid = TASK_LIST_COLUMN_DEFS.filter(c => source.includes(c.key)).map(c => c.key);
        TASK_LIST_COLUMN_DEFS.filter(c => c.locked).forEach(c => {
            if (!valid.includes(c.key)) valid.unshift(c.key);
        });
        return valid;
    },

    // 当前显示的列（按定义顺序排列，结果按配置数组引用缓存，避免逐行重复计算）
    getVisibleColumns() {
        if (!this._visibleColumnsCache || this._visibleColumnsCacheSource !== this.visibleColumns) {
            this._visibleColumnsCache = this.normalizeColumns(this.visibleColumns);
            this._visibleColumnsCacheSource = this.visibleColumns;
        }
        return this._visibleColumnsCache;
    },

    // 判断指定列是否显示
    isColumnVisible(key) {
        return this.getVisibleColumns().includes(key);
    },

    // 依据当前显示的列计算列宽与表格最小宽度
    // - 除任务名称外的列均为固定像素宽度，列数变化时不会被压缩（避免内容换行变形）
    // - 任务名称作为唯一弹性列占据剩余宽度，窗口越宽名称列越宽，并至少为最宽固定列的 2 倍
    getColumnLayout() {
        const columns = this.getVisibleColumns()
            .map(key => this.getColumnDef(key))
            .filter(Boolean)
            .concat([TASK_LIST_ACTION_COLUMN]);

        const fixedTotal = columns.reduce((sum, c) => sum + (c.fixedWidth || 0), 0);
        const maxFixed = columns.reduce((max, c) => Math.max(max, c.fixedWidth || 0), 0);
        const flexWeight = columns.reduce((sum, c) => sum + (c.fixedWidth ? 0 : (c.minWidth || TASK_LIST_NAME_MIN_WIDTH)), 0) || 1;

        // 表格最小宽度：固定列总和 + 任务名称列最小宽度
        const minWidth = Math.max(
            TASK_LIST_MIN_WIDTH,
            fixedTotal + Math.max(TASK_LIST_NAME_MIN_WIDTH, maxFixed * 2)
        );

        return {
            minWidth,
            columns: columns.map(c => ({
                key: c.key,
                label: window.languageManager.getText(c.i18nKey, c.fallback),
                width: c.fixedWidth
                    ? `${c.fixedWidth}px`
                    : `calc((100% - ${fixedTotal}px) * ${((c.minWidth || TASK_LIST_NAME_MIN_WIDTH) / flexWeight).toFixed(5)})`
            }))
        };
    },

    // 读取列配置：数据库为唯一来源，localStorage 仅用于首屏兜底
    async loadColumnConfig() {
        this.applyCachedColumnConfig();
        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['task_list_columns'],
            successCheck: (result) => !!result && !!result.data,
            onSuccess: (response) => {
                const keys = response.data.task_list_columns;
                if (Array.isArray(keys)) this.visibleColumns = this.normalizeColumns(keys);
            }
        });
    },

    // 应用本地缓存的列配置
    applyCachedColumnConfig() {
        try {
            const cached = localStorage.getItem(TASK_LIST_COLUMNS_CACHE_KEY);
            if (!cached) return;
            const keys = JSON.parse(cached);
            if (Array.isArray(keys)) this.visibleColumns = this.normalizeColumns(keys);
        } catch (e) {
            logger.warn('解析任务列表列配置缓存失败:', e);
        }
    },

    // 绑定列配置相关事件
    bindColumnConfigEvents() {
        // 列表内容会整体重绘，操作栏/父任务/附件均使用事件委托
        this.tasksList?.addEventListener('click', (e) => {
            const configBtn = e.target.closest('#task-columns-setting-btn');
            if (configBtn) {
                e.preventDefault();
                e.stopPropagation();
                this.openColumnConfigModal();
                return;
            }

            const parentLink = e.target.closest('.task-parent-link[data-task-id]');
            if (parentLink) {
                e.stopPropagation();
                this.viewTaskDetails(parentLink.dataset.taskId);
                return;
            }

            const attachmentChip = e.target.closest('.task-attachment-chip[data-attachment-id]');
            if (attachmentChip) {
                e.stopPropagation();
                this.openListAttachment(attachmentChip.dataset.taskId, attachmentChip.dataset.attachmentId);
            }
        });

        this.columnConfigCloseBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        this.columnConfigCancelBtn?.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        this.columnConfigResetBtn?.addEventListener('click', () => this.resetColumnConfigForm());
        this.columnConfigSaveBtn?.addEventListener('click', () => this.saveColumnConfigFromForm());
    },

    // 打开列配置弹窗
    openColumnConfigModal() {
        this.updateColumnConfigText();
        this.renderColumnConfigForm();
        Utils.ModalManager.show('task-columns-modal');
    },

    // 刷新列配置弹窗中的静态文案（跟随语言切换）
    updateColumnConfigText() {
        if (this.columnConfigTitle) {
            this.columnConfigTitle.textContent = window.languageManager.getText('columnConfigTitle', '配置显示列');
        }
        if (this.columnConfigDesc) {
            this.columnConfigDesc.textContent = window.languageManager.getText('columnConfigDesc', '勾选需要在任务列表中展示的列');
        }
    },

    // 渲染列勾选列表
    renderColumnConfigForm(checkedKeys = null) {
        if (!this.columnConfigList) return;

        const selected = checkedKeys || this.getVisibleColumns();
        const lockedText = Utils.escapeHtml(window.languageManager.getText('columnConfigLocked', '必选'));

        this.columnConfigList.innerHTML = TASK_LIST_COLUMN_DEFS.map(def => {
            const checked = !!def.locked || selected.includes(def.key);
            const label = Utils.escapeHtml(window.languageManager.getText(def.i18nKey, def.fallback));
            return `
                <label class="column-config-item${def.locked ? ' locked' : ''}">
                    <input type="checkbox" class="column-config-checkbox" value="${def.key}"
                           ${checked ? 'checked' : ''} ${def.locked ? 'disabled' : ''}>
                    <span class="column-config-name">${label}</span>
                    ${def.locked ? `<span class="column-config-tag">${lockedText}</span>` : ''}
                </label>
            `;
        }).join('');
    },

    // 恢复默认列配置（仅重置勾选，需点击保存生效）
    resetColumnConfigForm() {
        this.renderColumnConfigForm(TASK_LIST_COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key));
    },

    // 从表单中读取勾选结果并保存
    async saveColumnConfigFromForm() {
        const keys = Array.from(this.columnConfigList?.querySelectorAll('.column-config-checkbox') || [])
            .filter(box => box.checked)
            .map(box => box.value);
        await this.saveColumnConfig(keys);
    },

    // 保存列配置并刷新列表
    async saveColumnConfig(keys) {
        const normalized = this.normalizeColumns(keys);
        if (normalized.length === 0) {
            Utils.showToast(window.languageManager.getText('columnConfigMinTip', '至少需要保留一列'), 'warning');
            return;
        }

        this.visibleColumns = normalized;
        localStorage.setItem(TASK_LIST_COLUMNS_CACHE_KEY, JSON.stringify(normalized));
        Utils.ModalManager.hide('task-columns-modal');

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['task_list_columns', normalized],
            onSuccess: () => Utils.showToast(window.languageManager.getText('columnConfigSaved', '显示列配置已保存'), 'success'),
            onError: () => Utils.showToast(window.languageManager.getText('columnConfigSaveFailed', '显示列配置保存失败'), 'error')
        });

        await this.renderTasks();
    },
});
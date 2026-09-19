/**
 * 任务列表显示列配置控制器
 *
 * 从 TodoManager 中抽出：列定义查询、配置规范化、列宽布局计算、
 * 列配置弹窗（打开 / 勾选渲染 / 保存 / 重置）与配置读写。
 *
 * 依赖的 TodoManager 成员：
 *   状态：visibleColumns / _visibleColumnsCache / _visibleColumnsCacheSource
 *   DOM：tasksList / columnConfigCloseBtn / columnConfigCancelBtn /
 *        columnConfigResetBtn / columnConfigSaveBtn / columnConfigTitle /
 *        columnConfigDesc / columnConfigList
 *   其它控制器：ctx.renderer.renderTasks / ctx.detail.viewTaskDetails /
 *        ctx.detail.openListAttachment
 */
class ColumnsController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 获取列定义
    getColumnDef(key) {
        return ColumnsController.COLUMN_DEFS.find(c => c.key === key);
    }

    // 规范化列配置：过滤非法列，并保证必选列始终存在
    normalizeColumns(keys) {
        const source = Array.isArray(keys) ? keys : [];
        const valid = ColumnsController.COLUMN_DEFS.filter(c => source.includes(c.key)).map(c => c.key);
        ColumnsController.COLUMN_DEFS.filter(c => c.locked).forEach(c => {
            if (!valid.includes(c.key)) valid.unshift(c.key);
        });
        return valid;
    }

    // 当前显示的列（按定义顺序排列，结果按配置数组引用缓存，避免逐行重复计算）
    getVisibleColumns() {
        const ctx = this.ctx;
        if (!ctx._visibleColumnsCache || ctx._visibleColumnsCacheSource !== ctx.visibleColumns) {
            ctx._visibleColumnsCache = this.normalizeColumns(ctx.visibleColumns);
            ctx._visibleColumnsCacheSource = ctx.visibleColumns;
        }
        return ctx._visibleColumnsCache;
    }

    // 判断指定列是否显示
    isColumnVisible(key) {
        return this.getVisibleColumns().includes(key);
    }

    // 依据当前显示的列计算列宽与表格最小宽度
    // - 除任务名称外的列均为固定像素宽度，列数变化时不会被压缩（避免内容换行变形）
    // - 任务名称作为唯一弹性列占据剩余宽度，窗口越宽名称列越宽，并至少为最宽固定列的 2 倍
    getColumnLayout() {
        const columns = this.getVisibleColumns()
            .map(key => this.getColumnDef(key))
            .filter(Boolean)
            .concat([ColumnsController.ACTION_COLUMN]);

        const fixedTotal = columns.reduce((sum, c) => sum + (c.fixedWidth || 0), 0);
        const maxFixed = columns.reduce((max, c) => Math.max(max, c.fixedWidth || 0), 0);
        const flexWeight = columns.reduce(
            (sum, c) => sum + (c.fixedWidth ? 0 : (c.minWidth || ColumnsController.NAME_MIN_WIDTH)), 0) || 1;

        // 表格最小宽度：固定列总和 + 任务名称列最小宽度
        const minWidth = Math.max(
            ColumnsController.MIN_WIDTH,
            fixedTotal + Math.max(ColumnsController.NAME_MIN_WIDTH, maxFixed * 2)
        );

        return {
            minWidth,
            columns: columns.map(c => ({
                key: c.key,
                label: window.languageManager.getText(c.i18nKey, c.fallback),
                width: c.fixedWidth
                    ? `${c.fixedWidth}px`
                    : `calc((100% - ${fixedTotal}px) * ${((c.minWidth || ColumnsController.NAME_MIN_WIDTH) / flexWeight).toFixed(5)})`
            }))
        };
    }

    // 读取列配置：数据库为唯一来源，localStorage 仅用于首屏兜底
    async loadConfig() {
        const ctx = this.ctx;
        this.applyCachedConfig();
        await Api.config.get({
            apiArgs: ['task_list_columns'],
            successCheck: (result) => !!result && !!result.data,
            onSuccess: (response) => {
                const keys = response.data.task_list_columns;
                if (Array.isArray(keys)) ctx.visibleColumns = this.normalizeColumns(keys);
            }
        });
    }

    // 应用本地缓存的列配置
    applyCachedConfig() {
        const ctx = this.ctx;
        try {
            const cached = localStorage.getItem(ColumnsController.CACHE_KEY);
            if (!cached) return;
            const keys = JSON.parse(cached);
            if (Array.isArray(keys)) ctx.visibleColumns = this.normalizeColumns(keys);
        } catch (e) {
            logger.warn('解析任务列表列配置缓存失败:', e);
        }
    }

    // 绑定列配置相关事件
    bindEvents() {
        const ctx = this.ctx;
        // 列表内容会整体重绘，操作栏/父任务/附件均使用事件委托
        if (ctx.tasksList) {
            ctx.tasksList.addEventListener('click', (e) => {
                const configBtn = e.target.closest('#task-columns-setting-btn');
                if (configBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                    return;
                }

                const parentLink = e.target.closest('.task-parent-link[data-task-id]');
                if (parentLink) {
                    e.stopPropagation();
                    ctx.detail.viewTaskDetails(parentLink.dataset.taskId);
                    return;
                }

                const attachmentChip = e.target.closest('.task-attachment-chip[data-attachment-id]');
                if (attachmentChip) {
                    e.stopPropagation();
                    ctx.detail.openListAttachment(attachmentChip.dataset.taskId, attachmentChip.dataset.attachmentId);
                }
            });
        }

        if (ctx.columnConfigCloseBtn) {
            ctx.columnConfigCloseBtn.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        }
        if (ctx.columnConfigCancelBtn) {
            ctx.columnConfigCancelBtn.addEventListener('click', () => Utils.ModalManager.hide('task-columns-modal'));
        }
        if (ctx.columnConfigResetBtn) {
            ctx.columnConfigResetBtn.addEventListener('click', () => this.resetForm());
        }
        if (ctx.columnConfigSaveBtn) {
            ctx.columnConfigSaveBtn.addEventListener('click', () => this.saveFromForm());
        }
    }

    // 打开列配置弹窗
    openModal() {
        this.updateText();
        this.renderForm();
        Utils.ModalManager.show('task-columns-modal');
    }

    // 刷新列配置弹窗中的静态文案（跟随语言切换）
    updateText() {
        const ctx = this.ctx;
        if (ctx.columnConfigTitle) {
            ctx.columnConfigTitle.textContent = window.languageManager.getText('columnConfigTitle', '配置显示列');
        }
        if (ctx.columnConfigDesc) {
            ctx.columnConfigDesc.textContent = window.languageManager.getText('columnConfigDesc', '勾选需要在任务列表中展示的列');
        }
    }

    // 渲染列勾选列表
    renderForm(checkedKeys = null) {
        const ctx = this.ctx;
        if (!ctx.columnConfigList) return;

        const selected = checkedKeys || this.getVisibleColumns();
        const lockedText = Utils.escapeHtml(window.languageManager.getText('columnConfigLocked', '必选'));

        ctx.columnConfigList.innerHTML = ColumnsController.COLUMN_DEFS.map(def => {
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
    }

    // 恢复默认列配置（仅重置勾选，需点击保存生效）
    resetForm() {
        this.renderForm(ColumnsController.COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key));
    }

    // 从表单中读取勾选结果并保存
    async saveFromForm() {
        const boxes = this.ctx.columnConfigList
            ? this.ctx.columnConfigList.querySelectorAll('.column-config-checkbox') : [];
        const keys = Array.from(boxes)
            .filter(box => box.checked)
            .map(box => box.value);
        await this.save(keys);
    }

    // 保存列配置并刷新列表
    async save(keys) {
        const ctx = this.ctx;
        const normalized = this.normalizeColumns(keys);
        if (normalized.length === 0) {
            Utils.showToast(window.languageManager.getText('columnConfigMinTip', '至少需要保留一列'), 'warning');
            return;
        }

        ctx.visibleColumns = normalized;
        localStorage.setItem(ColumnsController.CACHE_KEY, JSON.stringify(normalized));
        Utils.ModalManager.hide('task-columns-modal');

        await Api.config.set({
            apiArgs: ['task_list_columns', normalized],
            onSuccess: () => Utils.showToast(window.languageManager.getText('columnConfigSaved', '显示列配置已保存'), 'success'),
            onError: () => Utils.showToast(window.languageManager.getText('columnConfigSaveFailed', '显示列配置保存失败'), 'error')
        });

        await ctx.renderer.renderTasks();
    }
}

// ===== 列配置相关常量 =====
// 采用类上赋值而非 static 字段，兼容较老的 WebView；todo.js 通过
// ColumnsController.COLUMN_DEFS 取默认列（本文件须先于 todo.js 加载）。

// 任务列表可配置的显示列
// fixedWidth：固定像素宽度列（内容长度可预期，不随窗口变宽而变宽）
// minWidth：弹性列（任务名称）的最小像素宽度，弹性列会占据表格剩余宽度
ColumnsController.COLUMN_DEFS = [
    { key: 'name', i18nKey: 'taskHeaderName', fallback: '任务名称', defaultVisible: true, locked: true, minWidth: 420 },
    { key: 'priority', i18nKey: 'taskHeaderPriority', fallback: '优先级', defaultVisible: true, fixedWidth: 100 },
    { key: 'dueDate', i18nKey: 'taskHeaderDueDate', fallback: '到期时间', defaultVisible: true, fixedWidth: 185 },
    { key: 'tags', i18nKey: 'taskHeaderTag', fallback: '标签', defaultVisible: true, fixedWidth: 145 },
    { key: 'category', i18nKey: 'taskHeaderCategory', fallback: '所属分类', defaultVisible: false, fixedWidth: 160 },
    { key: 'parentTask', i18nKey: 'taskHeaderParentTask', fallback: '关联父项任务', defaultVisible: false, fixedWidth: 170 },
    { key: 'attachments', i18nKey: 'taskHeaderAttachments', fallback: '任务附件', defaultVisible: false, fixedWidth: 130 }
];
// 操作列固定展示且不参与配置；内部是固定数量的按钮，使用固定像素宽度避免列变窄后换行变形
ColumnsController.ACTION_COLUMN = { key: 'actions', i18nKey: 'taskHeaderAction', fallback: '操作', fixedWidth: 150 };
// 任务名称列的最小像素宽度（同时保证不小于其他列中最宽一列的 2 倍）
ColumnsController.NAME_MIN_WIDTH = 420;
// 表格最小宽度（列较多时自动增大，保证列内容可读）
ColumnsController.MIN_WIDTH = 1060;
// 列配置本地缓存键（数据库为唯一来源，本地仅作首屏兜底）
ColumnsController.CACHE_KEY = 'todolist_task_list_columns';

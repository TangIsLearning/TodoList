/**
 * 设置中心 - 主题配色编辑器（mixin）
 * 依赖：settings/settings.js（SettingsUIManager 类）、theme-colors.js（AccentThemeManager）
 */

// 主题配色预设：只覆盖 5 个语义色，优先级色由 AccentThemeManager 按联动规则派生
const THEME_COLOR_PRESETS = [
    { name: '默认蓝', colors: { primary: '#007bff', success: '#28a745', warning: '#ffc107', danger: '#dc3545', info: '#17a2b8' } },
    { name: '青竹绿', colors: { primary: '#2f9e44', success: '#37b24d', warning: '#f59f00', danger: '#e03131', info: '#0ca678' } },
    { name: '深海紫', colors: { primary: '#7048e8', success: '#12b886', warning: '#f08c00', danger: '#e8590c', info: '#4c6ef5' } },
    { name: '暖橙', colors: { primary: '#f76707', success: '#2f9e44', warning: '#f59f00', danger: '#e03131', info: '#1c7ed6' } },
    { name: '玫红', colors: { primary: '#d6336c', success: '#2f9e44', warning: '#f59f00', danger: '#e03131', info: '#15aabf' } },
    { name: '石墨灰', colors: { primary: '#495057', success: '#2b8a3e', warning: '#e67700', danger: '#c92a2a', info: '#1971c2' } }
];

Object.assign(SettingsUIManager.prototype, {

    initThemeColorEditor() {
        // 设置中心的入口行
        this.themeModeEntry = document.getElementById('theme-mode-btn');
        this.themeModeValue = document.getElementById('theme-mode-value');

        // 二级弹窗
        this.themeModal = document.getElementById('theme-modal');
        this.themeModalClose = document.getElementById('theme-modal-close');

        this.themeModeGroup = document.getElementById('theme-mode-group');
        this.themeColorEditor = document.getElementById('theme-color-editor');
        this.themeColorList = document.getElementById('theme-color-list');
        this.themePresetList = document.getElementById('theme-preset-list');
        this.themeModeTabs = document.getElementById('theme-mode-tabs');
        this.themeLinkPriority = document.getElementById('theme-link-priority');
        this.themeColorsReset = document.getElementById('theme-colors-reset');
        this.themeColorsSave = document.getElementById('theme-colors-save');

        // 编辑中的草稿配置（未点保存前不落库）
        this.themeDraft = null;
        // 当前正在编辑的基底：light | dark
        this.themeEditMode = 'light';
    },

    bindThemeColorEvents() {
        // 设置中心入口：打开主题配置二级弹窗
        this.themeModeEntry?.addEventListener('click', () => this.openThemeModal());

        // 关闭 / 遮罩：直接关闭所有弹窗，不做逐层关闭
        // （ESC 由下面 bindEvents 中的全局 ESC 监听统一处理）
        this.themeModalClose?.addEventListener('click', () => this.closeAllModals());
        Utils.bindBackdropClose(this.themeModal, () => this.closeAllModals());

        // 主题模式三选一（该控件在锁定态外，始终可点击）
        this.themeModeGroup?.addEventListener('click', (e) => {
            const option = e.target.closest('.theme-mode-option');
            if (option) this.handleThemeModeChange(option.dataset.themeMode);
        });

        // 模式由 ThemeManager 统一切换后，这里只需同步编辑区可用状态
        document.addEventListener('theme-mode-changed', () => this.syncThemeEditorState());

        if (!this.themeColorList) return;

        // 颜色选择器与十六进制文本框统一走一个处理函数，保证两者同步
        this.themeColorList.addEventListener('input', (e) => this.handleThemeColorInput(e));
        this.themeColorList.addEventListener('change', (e) => this.handleThemeColorInput(e));

        this.themePresetList?.addEventListener('click', (e) => {
            const swatch = e.target.closest('.theme-preset-swatch');
            if (swatch) this.applyThemePreset(Number(swatch.dataset.presetIndex));
        });

        // 切换编辑基底（浅色/深色）会同时切换预览用的 data-theme
        this.themeModeTabs?.addEventListener('click', (e) => {
            const tab = e.target.closest('.theme-mode-tab');
            if (!tab || !this.themeDraft) return;
            this.themeEditMode = tab.dataset.themeMode === 'dark' ? 'dark' : 'light';
            this.themeDraft.baseTheme = this.themeEditMode;
            this.updateThemeModeTabs();
            this.renderThemeColorRows();
            this.previewThemeColors();
        });

        this.themeLinkPriority?.addEventListener('change', () => {
            if (!this.themeDraft) return;
            this.themeDraft.linkPriority = this.themeLinkPriority.checked;
            this.renderThemeColorRows();
            this.previewThemeColors();
        });

        this.themeColorsReset?.addEventListener('click', () => this.resetThemeColors());
        this.themeColorsSave?.addEventListener('click', () => this.saveThemeColors());
    },

    isThemeModalOpen() {
        return !!this.themeModal && this.themeModal.style.display === 'flex';
    },

    isSettingsModalOpen() {
        return !!this.modal
            && this.modal.classList.contains('show')
            // 退场动画期间视为已关闭，避免重复触发关闭流程
            && !this.modal.classList.contains('is-closing')
            && this.modal.style.display !== 'none';
    },

    /**
     * 关闭设置中心（带退场动画），动画结束后执行 done。
     * 不走 ModalManager.hide()，避免其中的表单重置把已填配置清空。
     */
    hideSettingsModal(done) {
        const modal = this.modal;
        const finish = typeof done === 'function' ? done : () => {};
        if (!modal) {
            finish();
            return;
        }
        Utils.closeModalWithAnimation(modal, () => {
            modal.classList.remove('show');
            modal.style.display = 'none';
            finish();
        });
    },

    /**
     * 打开主题配置二级弹窗：先关闭设置中心，动画结束后再打开二级弹窗，
     * 保证同一时刻只展示一个弹窗（避免两层遮罩叠加）。
     */
    openThemeModal() {
        if (!this.themeModal) return;

        const open = () => {
            this.loadThemeColorEditor();
            this.themeModal.classList.remove('is-closing');
            this.themeModal.classList.add('show');
            this.themeModal.style.display = 'flex';
        };

        if (!this.isSettingsModalOpen()) {
            open();
            return;
        }

        this.hideSettingsModal(open);
    },

    /**
     * 一次性关闭所有已打开的弹窗（包括设置中心）
     * 不做"逐层出栈"式关闭，保存/关闭二级弹窗时调用
     */
    closeAllModals() {
        // 未保存的主题配色预览需要回滚
        window.AccentThemeManager?.cancelPreview();
        // 确认对话框有自己的回调清理流程，跳过它避免监听器残留
        Utils.ModalManager.hideAll({ except: '#confirm-dialog' });
    },

    /** 打开设置中心时按已保存配置重建编辑器 */
    loadThemeColorEditor() {
        this.syncThemeEditorState();
        if (!this.themeColorList || !window.AccentThemeManager) return;

        this.themeDraft = AccentThemeManager.getConfig();
        // 编辑基底以配置中的 baseTheme 为准（自定义模式下它同时决定 data-theme）
        this.themeEditMode = this.themeDraft.baseTheme;
        this.updateThemeModeTabs();
        this.renderThemePresets();
        this.renderThemeColorRows();

        if (this.themeLinkPriority) {
            this.themeLinkPriority.checked = this.themeDraft.linkPriority !== false;
        }
    },

    /** 同步"自定义配色"编辑区可用状态与入口行的当前模式文案 */
    syncThemeEditorState() {
        const manager = BusinessUtils.ThemeManager;
        const editable = manager.isCustomMode();

        if (this.themeColorEditor) {
            this.themeColorEditor.classList.toggle('is-locked', !editable);
            // inert 可一并屏蔽点击与键盘焦点；不支持该属性时降级为 CSS 的 pointer-events
            if ('inert' in this.themeColorEditor) this.themeColorEditor.inert = !editable;
        }

        // 底部按钮不在锁定容器内，需单独禁用：
        // 否则非自定义模式下点"保存配色"会写入并应用配色，导致当前模式失效
        [this.themeColorsSave, this.themeColorsReset].forEach((btn) => {
            if (btn) btn.disabled = !editable;
        });

        if (this.themeModeValue) {
            this.themeModeValue.textContent = this.getThemeModeLabel(manager.normalizeMode(manager.mode));
        }
    },

    getThemeModeLabel(mode) {
        const labels = {
            default: ['settingsThemeModeDefault', '默认模式'],
            dark: ['settingsThemeModeDark', '深色模式'],
            custom: ['settingsThemeModeCustom', '自定义模式']
        };
        const entry = labels[mode] || labels.default;
        return this.t(entry[0], entry[1]);
    },

    /** 切换主题模式：默认 / 深色 / 自定义 */
    async handleThemeModeChange(mode) {
        const manager = BusinessUtils.ThemeManager;
        if (manager.normalizeMode(mode) === manager.mode) return;

        await manager.setMode(mode);
        this.syncThemeEditorState();
        if (manager.isCustomMode()) this.loadThemeColorEditor();

        Utils.showToast(
            `${this.t('settingsThemeModeSwitched', '主题已切换为')}${this.getThemeModeLabel(manager.mode)}`,
            'success');
    },

    updateThemeModeTabs() {
        this.themeModeTabs?.querySelectorAll('.theme-mode-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.themeMode === this.themeEditMode);
        });
    },

    renderThemePresets() {
        if (!this.themePresetList) return;
        this.themePresetList.innerHTML = THEME_COLOR_PRESETS.map((preset, index) => `
            <button type="button" class="theme-preset-swatch" data-preset-index="${index}"
                    title="${preset.name}" style="background-color: ${preset.colors.primary};"></button>
        `).join('');
    },

    renderThemeColorRows() {
        if (!this.themeColorList || !this.themeDraft) return;

        const palette = this.themeDraft[this.themeEditMode];
        const linkPriority = this.themeDraft.linkPriority !== false;

        this.themeColorList.innerHTML = AccentThemeManager.TOKENS.map((token) => {
            // 联动开启时，优先级色由语义色派生，禁止单独编辑
            const locked = linkPriority && !!token.linked;
            const hex = palette[token.key];
            return `
                <div class="theme-color-row ${locked ? 'is-disabled' : ''}" data-token="${token.key}">
                    <span class="theme-color-row__name">${this.getThemeTokenLabel(token)}</span>
                    <span class="theme-color-row__hint" data-role="hint"></span>
                    <input type="color" class="theme-color-row__input" value="${hex}"
                           ${locked ? 'disabled' : ''} aria-label="${token.label}">
                    <input type="text" class="theme-color-row__hex" value="${hex}" maxlength="7"
                           spellcheck="false" ${locked ? 'disabled' : ''} aria-label="${token.label}">
                </div>`;
        }).join('');

        // 统一刷新对比度提示
        AccentThemeManager.TOKENS.forEach((token) => {
            const row = this.themeColorList.querySelector(`.theme-color-row[data-token="${token.key}"]`);
            if (row) this.updateThemeColorRowHint(row, palette[token.key]);
        });
    },

    getThemeTokenLabel(token) {
        const key = `themeColor${token.key.charAt(0).toUpperCase()}${token.key.slice(1)}`;
        return this.t(key, token.label);
    },

    handleThemeColorInput(event) {
        const target = event.target;
        const row = target.closest('.theme-color-row');
        if (!row || !this.themeDraft) return;

        const hexInput = row.querySelector('.theme-color-row__hex');
        const colorInput = row.querySelector('.theme-color-row__input');
        const { ColorUtils } = AccentThemeManager;
        let hex = null;

        if (target === colorInput) {
            hex = ColorUtils.normalizeHex(colorInput.value);
        } else if (target === hexInput) {
            hex = ColorUtils.normalizeHex(hexInput.value);
            // 输入过程中的半成品不做标红，只要最终非法就提示
            hexInput.classList.toggle('is-invalid', !hex && hexInput.value.trim() !== '');
        } else {
            return;
        }
        if (!hex) return;

        colorInput.value = hex;
        hexInput.value = hex;
        hexInput.classList.remove('is-invalid');

        this.themeDraft[this.themeEditMode][row.dataset.token] = hex;
        this.updateThemeColorRowHint(row, hex);
        this.previewThemeColors();
    },

    /** 对比度不足时给出提示（前景色已由 --on-* 自动切换） */
    updateThemeColorRowHint(row, hex) {
        const hint = row.querySelector('[data-role="hint"]');
        if (!hint) return;
        const { ColorUtils } = AccentThemeManager;
        const foreground = ColorUtils.pickReadableText(hex);
        const ratio = ColorUtils.contrastRatio(
            ColorUtils.hexToRgb(hex),
            ColorUtils.hexToRgb(foreground)
        );
        hint.textContent = ratio < 4.5
            ? this.t('settingsThemeContrastHint', '对比度偏低，文字自动加深')
            : '';
    },

    applyThemePreset(index) {
        const preset = THEME_COLOR_PRESETS[index];
        if (!preset || !this.themeDraft) return;
        Object.assign(this.themeDraft[this.themeEditMode], preset.colors);
        this.renderThemeColorRows();
        this.previewThemeColors();
    },

    /** 实时预览：只改样式，不落库 */
    previewThemeColors() {
        if (!this.themeDraft || !window.AccentThemeManager) return;
        AccentThemeManager.preview(this.themeDraft);
    },

    /** 保存配色到后端，成功后才写入本地缓存（避免"界面已变但未持久化"） */
    async saveThemeColors() {
        if (!this.themeDraft || !window.AccentThemeManager) return;

        if (this.themeColorList?.querySelector('.theme-color-row__hex.is-invalid')) {
            Utils.showToast(this.t('settingsThemeInvalid', '存在非法颜色值（应为 #RRGGBB）'), 'error');
            return;
        }

        await this.persistThemeColors(this.themeDraft);
    },

    async resetThemeColors() {
        if (!window.AccentThemeManager) return;

        const defaults = AccentThemeManager.getDefaultConfig();
        this.themeDraft = defaults;
        this.themeEditMode = 'light';
        if (this.themeLinkPriority) this.themeLinkPriority.checked = true;
        this.updateThemeModeTabs();
        this.renderThemeColorRows();
        // 点击即预览出厂配色，保存失败时由 persist 回滚
        AccentThemeManager.preview(defaults);

        await this.persistThemeColors(defaults);
    },

    async persistThemeColors(config) {
        // 仅自定义模式允许保存配色；其它模式下保存会导致强调色被意外应用
        if (!BusinessUtils.ThemeManager.isCustomMode()) return;

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['custom_accent_colors', config],
            onSuccess: () => {
                this.themeDraft = AccentThemeManager.apply(config);
                Utils.showToast(this.t('settingsThemeSaved', '配色已保存'), 'success');
                // 保存成功后直接关闭所有弹窗
                this.closeAllModals();
            },
            onError: (error) => {
                // 保存失败：回滚预览，保持界面与持久化状态一致
                AccentThemeManager.cancelPreview();
                this.themeDraft = AccentThemeManager.getConfig();
                this.loadThemeColorEditor();
                Utils.showToast(
                    `${this.t('settingsFailed', '设置失败')}: ${error.message}`, 'error');
            }
        });
    }
});

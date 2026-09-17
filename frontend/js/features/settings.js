/**
 * 设置中心管理模块
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

class SettingsUIManager {
    constructor() {
        this.isInitialized = false;
        this.onTop = false;
        
        // DOM元素
        this.modal = null;
        this.closeBtn = null;
        this.settingsBtn = null;
        this.windowTopToggle = null;
        this.dataShareBtn = null;
        this.dataSyncBtn = null;
        this.exportTasksBtn = null;

        // WebDAV相关元素
        this.webdavEnableToggle = null;
        this.webdavConfigPanel = null;
        this.webdavSyncType = null;
        this.webdavUrlInput = null;
        this.webdavUsernameInput = null;
        this.webdavPasswordInput = null;
        this.webdavRemotePathInput = null;
        this.webdavFirstSyncModeSelect = null;
        this.webdavTestBtn = null;
        this.webdavSaveBtn = null;
        this.webdavStatusDiv = null;

        // 开机自启动相关元素
        this.autoStartToggle = null;

        // 状态变量
        this.currentButtonKey = null;  // 当前按钮设置的组合键
        this.smartKeyShow = null;           // 快捷按键
        this.smartKeyApply = null;           // 快捷按键应用
        this.shortcutToggle = null;          // 快捷操作开关

        // 组合键记录（用于监听时记录完整的组合键）
        this.currentModifiers = {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false
        };

        // 延迟初始化
        setTimeout(() => this.init(), 100);
    }
    
    async init() {
        try {
            // 获取DOM元素
            this.initDOM();
            
            // 绑定事件
            this.bindEvents();
            
            // 恢复用户设置
            await this.restoreSettings();
            
            this.isInitialized = true;
        } catch (error) {
            logger.error('Failed to initialize SettingsUIManager:', error);
        }
    }
    
    initDOM() {
        this.modal = document.getElementById('settings-modal');
        this.closeBtn = document.getElementById('settings-close');
        this.settingsBtn = document.getElementById('settings-btn');
        this.windowTopToggle = document.getElementById('window-top-toggle');
        this.dataShareBtn = document.getElementById('data-share-btn');
        this.dataSyncBtn = document.getElementById('data-sync-btn');
        this.exportTasksBtn = document.getElementById('export-tasks-btn');

        // 数据目录配置元素
        this.dataDirBtn = document.getElementById('data-dir-btn');
        this.applyDirBtn = document.getElementById('apply-dir-btn');
        
        // WebDAV配置元素
        this.webdavEnableToggle = document.getElementById('webdav-enable-toggle');
        this.webdavConfigPanel = document.getElementById('webdav-config-panel');
        this.webdavSyncType = document.getElementById('webdav-sync-type-selector');
        this.webdavUrlInput = document.getElementById('webdav-url');
        this.webdavUsernameInput = document.getElementById('webdav-username');
        this.webdavPasswordInput = document.getElementById('webdav-password');
        this.webdavRemotePathInput = document.getElementById('webdav-remote-path');
        this.webdavFirstSyncModeSelect = document.getElementById('webdav-first-sync-mode');
        this.webdavTestBtn = document.getElementById('webdav-test-btn');
        this.webdavSaveBtn = document.getElementById('webdav-save-btn');
        this.webdavStatusDiv = document.getElementById('webdav-status');
        
        // 开机自启动元素
        this.autoStartToggle = document.getElementById('auto-start-toggle');

        // 快捷按键元素
        this.smartKeyShow = document.getElementById('smart-key-show');
        this.smartKeyApply = document.getElementById('smart-key-apply');
        this.shortcutToggle = document.getElementById('shortcut-toggle');

        // ⬇️ 【Mac 适配核心 】：允许该元素接收键盘焦点，并去掉点击时的蓝色外框
        if (this.smartKeyShow) {
            this.smartKeyShow.setAttribute('tabindex', '0');
            this.smartKeyShow.style.outline = 'none';
        }

        this.smartKeyShow.textContent = localStorage.getItem('todolist_shortcut') || this.smartKeyShow.textContent;
        this.currentButtonKey = this.smartKeyShow.textContent;

        // 主题配色编辑器元素
        this.initThemeColorEditor();
    }

    /* ==================== 主题配色编辑器 ==================== */

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
    }

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
    }

    isThemeModalOpen() {
        return !!this.themeModal && this.themeModal.style.display === 'flex';
    }

    isSettingsModalOpen() {
        return !!this.modal
            && this.modal.classList.contains('show')
            // 退场动画期间视为已关闭，避免重复触发关闭流程
            && !this.modal.classList.contains('is-closing')
            && this.modal.style.display !== 'none';
    }

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
    }

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
    }

    /**
     * 一次性关闭所有已打开的弹窗（包括设置中心）
     * 不做"逐层出栈"式关闭，保存/关闭二级弹窗时调用
     */
    closeAllModals() {
        // 未保存的主题配色预览需要回滚
        window.AccentThemeManager?.cancelPreview();
        // 确认对话框有自己的回调清理流程，跳过它避免监听器残留
        Utils.ModalManager.hideAll({ except: '#confirm-dialog' });
    }

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
    }

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
    }

    getThemeModeLabel(mode) {
        const labels = {
            default: ['settingsThemeModeDefault', '默认模式'],
            dark: ['settingsThemeModeDark', '深色模式'],
            custom: ['settingsThemeModeCustom', '自定义模式']
        };
        const entry = labels[mode] || labels.default;
        return this.t(entry[0], entry[1]);
    }

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
    }

    updateThemeModeTabs() {
        this.themeModeTabs?.querySelectorAll('.theme-mode-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.themeMode === this.themeEditMode);
        });
    }

    renderThemePresets() {
        if (!this.themePresetList) return;
        this.themePresetList.innerHTML = THEME_COLOR_PRESETS.map((preset, index) => `
            <button type="button" class="theme-preset-swatch" data-preset-index="${index}"
                    title="${preset.name}" style="background-color: ${preset.colors.primary};"></button>
        `).join('');
    }

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
    }

    getThemeTokenLabel(token) {
        const key = `themeColor${token.key.charAt(0).toUpperCase()}${token.key.slice(1)}`;
        return this.t(key, token.label);
    }

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
    }

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
    }

    applyThemePreset(index) {
        const preset = THEME_COLOR_PRESETS[index];
        if (!preset || !this.themeDraft) return;
        Object.assign(this.themeDraft[this.themeEditMode], preset.colors);
        this.renderThemeColorRows();
        this.previewThemeColors();
    }

    /** 实时预览：只改样式，不落库 */
    previewThemeColors() {
        if (!this.themeDraft || !window.AccentThemeManager) return;
        AccentThemeManager.preview(this.themeDraft);
    }

    /** 保存配色到后端，成功后才写入本地缓存（避免"界面已变但未持久化"） */
    async saveThemeColors() {
        if (!this.themeDraft || !window.AccentThemeManager) return;

        if (this.themeColorList?.querySelector('.theme-color-row__hex.is-invalid')) {
            Utils.showToast(this.t('settingsThemeInvalid', '存在非法颜色值（应为 #RRGGBB）'), 'error');
            return;
        }

        await this.persistThemeColors(this.themeDraft);
    }

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
    }

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

    /** 统一的文案读取（带中文兜底） */
    t(key, fallback) {
        if (window.languageManager) return window.languageManager.getText(key, fallback);
        return fallback;
    }
    
    bindEvents() {
        // 打开设置中心
        this.settingsBtn?.addEventListener('click', () => this.openModal());

        // 关闭设置中心
        this.closeBtn?.addEventListener('click', () => this.closeModal());

        // 点击模态框外部关闭（仅在遮罩层本身按下并抬起时触发，避免拖选文本误关闭）
        Utils.bindBackdropClose(this.modal, () => this.closeModal());

        // 窗口置顶开关
        this.windowTopToggle?.addEventListener('change', () => this.toggleWindowOnTop());

        // 语言切换
        const languageToggle = document.getElementById('language-toggle');
        languageToggle?.addEventListener('change', (e) => this.handleLanguageToggle(e));

        // 数据共享按钮
        this.dataShareBtn?.addEventListener('click', () => this.openDataTransfer('share'));

        // 数据同步按钮
        this.dataSyncBtn?.addEventListener('click', () => this.openDataSync());

        // 导出任务按钮
        this.exportTasksBtn?.addEventListener('click', () => this.openExportModal());

        // 数据文件配置事件绑定
        this.dataDirBtn?.addEventListener('click', () => this.browseFile());
        this.applyDirBtn?.addEventListener('click', () => this.applyDataFile());
        this.dataDirBtn?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.applyDataDirectory();
        });

        // WebDAV事件绑定
        this.handleSyncTypeChange();
        this.webdavEnableToggle?.addEventListener('change', () => this.toggleWebDAV());
        this.webdavSyncType?.addEventListener('change', () => this.handleSyncTypeChange());
        this.webdavTestBtn?.addEventListener('click', () => this.testWebDAVConnection());
        this.webdavSaveBtn?.addEventListener('click', () => this.saveWebDAVConfig());

        // 开机自启动事件绑定
        this.autoStartToggle?.addEventListener('change', () => this.toggleAutoStart());

        // ESC键关闭：设置中心或其二级弹窗任一处于打开状态，都一次性关闭全部
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.modal) return;
            if (this.modal.style.display === 'flex' || this.isThemeModalOpen()) this.closeModal();
        });

        // 绑定快捷按键事件
        if (this.smartKeyShow) {
            // ⬇️ 【Mac 适配核心 】：点击时必须强制呼叫 .focus() 夺取系统键盘流
            this.smartKeyShow.addEventListener('click', (e) => this.smartKeyShow.focus());
            // 绑定具体的按键监听（确保使用我们在第一轮修改过的、适配了 Mac 的最新逻辑）
            this.smartKeyShow.addEventListener('keydown', (e) => this.handleKeyDown(e));
            this.smartKeyShow.addEventListener('keyup', (e) => this.handleKeyUp(e));
        }
        this.smartKeyApply?.addEventListener('click', async () => {
            this.currentButtonKey = this.smartKeyShow.textContent;
            this.resetModifiers();
            await Utils.apiCall({
                apiMethod: 'set_config',
                apiArgs: ['shortcut', this.currentButtonKey.toString()],
                onSuccess: (response) => {
                    localStorage.setItem('todolist_shortcut', this.currentButtonKey);
                    Utils.showToast(`${window.languageManager.getText('settingsShortcutAs', '已设置为')}: ${this.currentButtonKey},
                        ${window.languageManager.getText('settingsShortcutNeedRestart', '请重启应用后尝试')}`, 'success');
                },
            });
        });

        // 快捷操作开关事件绑定
        this.shortcutToggle?.addEventListener('change', () => this.toggleShortcut());

        // 主题配色编辑器事件绑定
        this.bindThemeColorEvents();
    }
    
    async openModal() {
        if (this.modal) {
            // 上一次关闭动画可能尚未结束，重新打开时先清掉退场状态
            this.modal.classList.remove('is-closing');
            this.modal.style.display = 'flex';
            this.modal.classList.add('show');
            
            // 更新当前状态
            await this.updateCurrentState();
            
            // 更新数据文件配置
            this.updateDataFileConfig();
        }
    }
    
    closeModal() {
        if (!this.modal) return;
        // 关闭时恢复快捷按键显示，并一次性关闭所有弹窗
        this.smartKeyShow.textContent = this.currentButtonKey;
        this.closeAllModals();
    }
    
    async updateCurrentState() {
        // 更新窗口置顶状态
        await this.updateWindowOnTopState();
        
        // 同步主题模式选择器（模式由 ThemeManager 统一持有，这里只刷新展示）
        BusinessUtils.ThemeManager.updateToggleButton(
            BusinessUtils.ThemeManager.normalizeMode(BusinessUtils.ThemeManager.mode));

        
        // 更新语言状态
        this.updateLanguageSwitchState();
        
        // 更新开机启动状态
        this.updateAutoStartState();

        // 更新快捷键配置
        this.updateShortcutToggleState();
        this.updateShortcutConfig();

        // 更新主题配色编辑器
        this.loadThemeColorEditor();
    }

    // 更新语言状态
    updateLanguageSwitchState() {
        const currentLanguage = window.languageManager ? window.languageManager.getCurrentLanguage() : 'zh';
        const languageToggle = document.getElementById('language-toggle');
        
        if (languageToggle) {
            const isChecked = currentLanguage === 'en';
            languageToggle.checked = isChecked;
            
            // 更新指示器文本和样式
            const languageText = isChecked ? 'En' : '中';
            this.updateLanguageIndicator(languageText, isChecked);
        }
    }
    
    async toggleWindowOnTop() {
        if (this.windowTopToggle) {
            this.onTop = this.windowTopToggle.checked;
            
            // 显示提示消息
            Utils.showToast(this.onTop ?
                window.languageManager.getText('windowOnTopSet', '窗口已设置置顶') :
                window.languageManager.getText('windowOnTopUnset', '窗口已取消置顶'), 'success');
            
            // 保存设置
            await this.saveSettings();
        }
    }
    
    // 处理语言切换开关
    async handleLanguageToggle(event) {
        const isChecked = event.target.checked;
        const language = isChecked ? 'en' : 'zh';
        const languageText = isChecked ? 'En' : '中';
        
        // 更新指示器文本和样式
        this.updateLanguageIndicator(languageText, isChecked);
        
        // 设置语言
        await this.setLanguage(language);
    }
    
    // 更新语言指示器
    updateLanguageIndicator(text, isChecked) {
        const indicator = document.getElementById('language-indicator');
        const switchElement = document.querySelector('.language-switch');
        
        if (indicator) indicator.textContent = text;

        if (switchElement) {
            if (isChecked) {
                switchElement.classList.add('checked');
            } else {
                switchElement.classList.remove('checked');
            }
        }
    }
    
    // 设置语言
    async setLanguage(language) {
        if (!window.languageManager) {
            logger.error('LanguageManager not initialized');
            return;
        }
        
        try {
            const success = await window.languageManager.switchLanguage(language);
            if (success) {
                const langName = language === 'zh' ? '中文' : 'English';
                Utils.showToast(`${window.languageManager.getText('languageSwitchTo', '已切换到')}${langName}`, 'success');
                
                // 更新设置中心的语言文本
                this.updateSettingsLanguage();
            } else {
                // 切换失败时回滚开关与指示器，避免界面状态与真实语言不一致
                this.updateLanguageSwitchState();
                Utils.showToast(window.languageManager.getText('languageSwitchFailed', '语言切换失败'), 'error');
            }
        } catch (error) {
            logger.error('设置语言失败:', error);
            this.updateLanguageSwitchState();
            Utils.showToast(window.languageManager.getText('languageSwitchFailed', '语言切换失败'), 'error');
        }
    }
    
    // 切换开机启动状态
    async toggleAutoStart() {
        if (!this.autoStartToggle) return;

        const enabled = this.autoStartToggle.checked;

        this.autoStartToggle.disabled = true;
        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['auto_start', enabled],
            onSuccess: (response) => {
                localStorage.setItem('todolist_auto_start', enabled.toString());
                Utils.showToast(enabled ?
                    window.languageManager.getText('settingsAutoStartEnabled','开机启动已启用') :
                    window.languageManager.getText('settingsAutoStartDisabled', '开机启动已禁用'), 'success');
            },
            onError: (error) => {
                this.autoStartToggle.checked = !enabled;
                Utils.showToast(`${window.languageManager.getText('settingsFailed', '设置失败')}: ${error.message}`, 'error');
            },
            onFinally: () => this.autoStartToggle.disabled = false
        });
    }
    
    // 更新设置中心的语言文本
    updateSettingsLanguage() {
        if (!window.languageManager) return;

        const lang = window.languageManager.getText;
        const langCode = window.languageManager.getCurrentLanguage();
        
        // 更新设置标题
        const settingsTitle = document.querySelector('#settings-modal h2');
        if (settingsTitle) settingsTitle.textContent = window.languageManager.getText('settings', '设置');

        // 更新各部分标题，以及所有带 data-lang-key 标记的元素
        // （新增设置项只需加标记，无需再改这里的位置映射）
        document.querySelectorAll('#settings-modal [data-lang-key], #theme-modal [data-lang-key]')
            .forEach((el) => {
                el.textContent = window.languageManager.getText(el.dataset.langKey, el.textContent);
            });

        // 主题配色的令牌名称与入口行模式文案由 JS 渲染，需按新语言重建
        this.renderThemeColorRows();
        this.syncThemeEditorState();
        
        // 更新窗口置顶标签
        const windowTopCheckbox = document.getElementById('window-top-toggle');
        const windowTopSettingItem = windowTopCheckbox.closest('.setting-item');
        const windowTopLabel = windowTopSettingItem.querySelector('.setting-text');
        if (windowTopLabel) windowTopLabel.textContent = window.languageManager.getText('settingsWindowTop', '窗口置顶');

        // 更新主题标签
        const themeModeItem = document.querySelector('.theme-mode-item .setting-text');
        if (themeModeItem) themeModeItem.textContent = window.languageManager.getText('settingsThemeMode', '主题模式');

        // 语言切换标签
        const languageCheckbox = document.getElementById('language-toggle');
        const languageSettingItem = languageCheckbox.closest('.setting-item');
        const languageLabel = languageSettingItem.querySelector('.setting-text');
        if (languageLabel) languageLabel.textContent = window.languageManager.getText('language', '语言切换');

        // 开机启动标签
        const autoStartCheckbox = document.getElementById('auto-start-toggle');
        const autoStartSettingItem = autoStartCheckbox.closest('.setting-item');
        const autoStartLabel = autoStartSettingItem.querySelector('.setting-text');
        if (autoStartLabel) autoStartLabel.textContent = window.languageManager.getText('settingsAutoStart', '开机启动');

        // 快捷键标签
        const shortcutSettingConfig = document.querySelector('.shortcut');
        const shortcutLabel = shortcutSettingConfig.querySelector('.data-label');
        if (shortcutLabel) shortcutLabel.textContent = window.languageManager.getText('settingsShortcut', '快捷操作');

        // 更新数据存储标签
        const dataStorageSettingConfig = document.querySelector('.data-storage');
        const dataStorageLabel = dataStorageSettingConfig.querySelector('.data-label');
        if (dataStorageLabel) dataStorageLabel.textContent = window.languageManager.getText('dataStoragePath', '存储路径');

        // 更新应用标签
        const applyLabels = document.querySelectorAll('.setting-config-btn');
        applyLabels.forEach((element, index) => {
            element.textContent = window.languageManager.getText('settingsApply', '应用');
        });

        // 更新数据管理标签
        const dataShareSettingItem = document.getElementById('data-share-btn');
        const dataShareLabel = dataShareSettingItem.querySelector('.setting-text');
        if (dataShareLabel) dataShareLabel.textContent = window.languageManager.getText('settingsDataShare', '共享数据');

        const dataSyncSettingItem = document.getElementById('data-sync-btn');
        const dataSyncLabel = dataSyncSettingItem.querySelector('.setting-text');
        if (dataSyncLabel) dataSyncLabel.textContent = window.languageManager.getText('settingsDataSync', '同步数据');
    }
    
    // 更新开机启动状态
    async updateAutoStartState() {
        if (!this.autoStartToggle) return;

        let autoStart = localStorage.getItem('todolist_auto_start');
        if (autoStart) {
            this.autoStartToggle.checked = autoStart === 'true';
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['auto_start'],
            onSuccess: (response) => {
                this.autoStartToggle.checked = response.data.auto_start;
                localStorage.setItem('todolist_auto_start', response.data.auto_start.toString());
            },
            onError: (error) => {
                this.autoStartToggle.checked = false;
                Utils.showToast(window.languageManager.getText('settingsAutoStartWarning', '当前平台不支持开机启动功能'), 'warning');
            }
        });
    }

    // 更新窗口置顶状态
    async updateWindowOnTopState() {
        if (!this.windowTopToggle) return;

        // 以数据库设置为唯一来源，localStorage 仅作缓存（接口失败时兜底），
        // 避免 localStorage 残留的旧值覆盖真实设置，出现"界面显示未置顶、窗口实际置顶"的假象
        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['window_on_top'],
            onSuccess: (response) => {
                const onTop = response.data.window_on_top === true;
                this.windowTopToggle.checked = onTop;
                this.onTop = onTop;
                localStorage.setItem('todolist_windowOnTop', onTop.toString());
            },
            onError: (error) => {
                const cached = localStorage.getItem('todolist_windowOnTop') === 'true';
                this.windowTopToggle.checked = cached;
                this.onTop = cached;
            }
        });
    }

    // 更新快捷键配置
    async updateShortcutConfig() {
        if (!this.smartKeyShow) return;

        let shortcut = localStorage.getItem('todolist_shortcut');
        if (shortcut) {
            this.smartKeyShow.textContent = shortcut;
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['shortcut'],
            onSuccess: (response) => {
                localStorage.setItem('todolist_shortcut', response.data.shortcut);
                this.smartKeyShow.textContent = response.data.shortcut;
            },
            onError: (error) => {
                this.smartKeyShow.textContent = '<ctrl>+<space>';
            }
        });
    }

    // 更新快捷操作开关状态
    async updateShortcutToggleState() {
        if (!this.shortcutToggle) return;

        let enabled = localStorage.getItem('todolist_shortcut_enabled');
        if (!enabled) {
            await Utils.apiCall({
                apiMethod: 'get_config',
                apiArgs: ['shortcut_enabled'],
                onSuccess: (response) => {
                    enabled = response.data.shortcut_enabled.toString();
                    localStorage.setItem('todolist_shortcut_enabled', enabled);
                }
            });
        }
        const isEnabled = enabled === 'true';
        this.shortcutToggle.checked = isEnabled;
        this.setShortcutEditable(isEnabled);
    }

    // 设置快捷操作配置是否可编辑
    setShortcutEditable(enabled) {
        if (this.smartKeyShow) {
            this.smartKeyShow.disabled = !enabled;
            this.smartKeyShow.style.opacity = enabled ? '' : '0.5';
        }
        if (this.smartKeyApply) {
            this.smartKeyApply.disabled = !enabled;
            this.smartKeyApply.style.opacity = enabled ? '' : '0.5';
        }
    }

    // 切换快捷操作开关
    async toggleShortcut() {
        if (!this.shortcutToggle) return;

        const enabled = this.shortcutToggle.checked;

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['shortcut_enabled', enabled],
            onSuccess: (response) => {
                localStorage.setItem('todolist_shortcut_enabled', enabled.toString());
                this.setShortcutEditable(enabled);
                Utils.showToast(enabled ?
                    `${window.languageManager.getText('settingsShortcutEnabled', '快捷操作已启用')}, ${window.languageManager.getText('settingsShortcutNeedRestart', '请重启应用后尝试')}` :
                    `${window.languageManager.getText('settingsShortcutDisabled', '快捷操作已禁用')}, ${window.languageManager.getText('settingsShortcutNeedRestart', '请重启应用后尝试')}`,
                    'success');
            },
            onError: (error) => {
                this.setShortcutEditable(!enabled);
                Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
            }
        });
    }

    //  处理数据管理按钮点击: mode = 'share' | 'receive'
    openDataTransfer(mode) {
        // 关闭设置中心
        this.closeModal();
        
        // 打开数据传输模态框
        if (window.dataTransfer && window.dataTransfer.isInitialized) {
            // 延迟打开，确保设置中心完全关闭
            setTimeout(() => {
                try {
                    window.dataTransfer.openModal();
                    if (mode === 'share') {
                        window.dataTransfer.switchMode('share');
                    } else if (mode === 'receive') {
                        window.dataTransfer.switchMode('receive');
                    }
                } catch (error) {
                    logger.error('打开数据传输模态框失败:', error);
                    Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                }
            }, 100);
        } else {
            logger.error('数据传输功能未初始化:', error);
            Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
        }
    }

    //  处理数据管理按钮点击
    openDataSync() {
        // 关闭设置中心
        this.closeModal();

        // 延迟打开数据同步模态框，确保设置中心完全关闭
        const modal = document.getElementById('data-sync-modal');
        setTimeout(() => {
            if (modal) {
                modal.classList.remove('is-closing');
                modal.style.display = 'flex';
                this.updateWebDAVConfig();
            } else {
                Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            }
        }, 100);

        // 添加关闭按钮点击事件（用 onclick 赋值，避免重复打开时监听器叠加）
        const closeBtn = document.getElementById('data-sync-close');
        if (closeBtn) closeBtn.onclick = () => this.closeDataSyncModal();

        // 点击模态框外部关闭
        Utils.bindBackdropClose(modal, () => this.closeDataSyncModal());
    }

    // 关闭数据同步弹窗（带退场动画）
    closeDataSyncModal() {
        const modal = document.getElementById('data-sync-modal');
        if (!modal) return;

        Utils.closeModalWithAnimation(modal, () => {
            modal.style.display = 'none';
            modal.classList.remove('show');
        });
    }
    
    async restoreSettings() {
        try {
            // 恢复窗口置顶状态（以数据库为准，接口内部会同步 localStorage 缓存）
            await this.updateWindowOnTopState();
            
            // 恢复主题设置
            await BusinessUtils.ThemeManager.init();
        } catch (error) {
            logger.error('Failed to restore settings:', error);
        }
    }
    
    // ==================== 数据目录配置方法 ====================
    
    async updateDataFileConfig() {
        // 更新数据文件配置显示
        await Utils.apiCall({
            apiMethod: 'get_data_file_config',
            onSuccess: (response) => {
                if (this.dataDirBtn) {
                    this.dataDirBtn.textContent = response.data;
                    this.dataDirBtn.title = response.data;
                }
            },
            onError: (error) => {
                Utils.showToast('获取配置时发生错误', 'error');
            }
        });
    }
    
    async browseFile() {
        // 浏览选择目录
        this.setDirectoryButtonsDisabled(true);
        await Utils.apiCall({
            apiMethod: 'select_directory_dialog',
            onSuccess: (response) => {
                const selectedPath = response.data;
                if (selectedPath && this.dataDirBtn) {
                    this.dataDirBtn.textContent = selectedPath;
                    this.dataDirBtn.title = selectedPath;
                    Utils.showToast(`已选择目录: ${selectedPath}`, 'success');

                    // 自动聚焦到应用按钮，方便用户快速操作
                    setTimeout(() => {
                        if (this.applyDirBtn) {
                            this.applyDirBtn.focus();
                        }
                    }, 300);
                }
            },
            onError: (error) => {
                Utils.showToast('浏览目录时发生错误: ' + error.message, 'error');
            },
            onFinally: () => this.setDirectoryButtonsDisabled(false)
        });
    }
    
    async applyDataFile() {
        // 应用新的数据文件配置
        if (!this.dataDirBtn || !this.dataDirBtn.textContent.trim()) {
            Utils.showToast('请输入数据文件路径', 'warning');
            return;
        }

        const newFile = this.dataDirBtn.textContent.trim();

        // 显示加载状态
        this.setDirectoryButtonsDisabled(true);
        Utils.showToast('正在验证文件...', 'warning');

        // 验证文件路径
        let isValidateFailed = false;
        await Utils.apiCall({
            apiMethod: 'validate_data_file',
            successCheck: (response) => !response.success,
            apiArgs: [newFile],
            onSuccess: (response) => {
                isValidateFailed = true;
                Utils.showToast(response.error, 'error');
            },
        });
        if (isValidateFailed) {
            this.setDirectoryButtonsDisabled(false);
            return;
        }

        // 确认提示
        this.closeModal();
        Utils.confirmDialog(
            window.languageManager.getText('settingsStorageWarning', '注意：这将影响所有数据的读写操作，当前数据会被移动到新文件。建议先备份重要数据。是否继续？'),
            async () => {
                await Utils.apiCall({
                    apiMethod: 'set_data_file_config',
                    apiArgs: [newFile],
                    onSuccess: (response) => {
                        this.updateDataFileConfig();
                        setTimeout(() => {
                            location.reload();
                            localStorage.clear();
                        }, 1000);
                    },
                    onError: (error) => {
                        Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
                    },
                    onFinally: () => this.setDirectoryButtonsDisabled(false)
                });
            }
        );
    }
    
    setDirectoryButtonsDisabled(disabled) {
        // 设置目录配置按钮的禁用状态
        const buttons = [this.applyDirBtn, this.dataDirBtn];
        buttons.forEach(btn => {
            if (btn) btn.disabled = disabled;
        });
        
        // 更新输入框状态
        if (this.dataDirBtn) this.dataDirBtn.disabled = disabled;
    }
    
    async saveSettings() {
        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['window_on_top', this.onTop.toString()],
            onSuccess: (response) => localStorage.setItem('todolist_windowOnTop', this.onTop.toString())
        });
    }

    // ==================== WebDAV相关方法 ====================
    async updateWebDAVConfig() {
        // 更新WebDAV配置显示
        await Utils.apiCall({
            apiMethod: 'get_webdav_config',
            onSuccess: (response) => {
                const config = response.data;
                if (config) {
                    this.webdavEnableToggle.checked = config.enabled || false;
                    this.webdavSyncType.value = config.sync_type;
                    this.webdavUrlInput.value = config.url;
                    this.webdavUsernameInput.value = config.username || '';
                    this.webdavPasswordInput.value = config.password || '';
                    this.webdavRemotePathInput.value = config.remote_path || '';
                    this.webdavFirstSyncModeSelect.value = config.first_sync_mode || 'remote_overwrite';
                    this.toggleWebDAVPanel();
                    this.handleSyncTypeChange();
                }
            }
        });
    }

    handleSyncTypeChange() {
        // 处理同步类型切换
        if (this.webdavSyncType.value === 'jianguoyun') {
            this.webdavUrlInput.value = 'https://dav.jianguoyun.com/dav';
            this.webdavUrlInput.disabled = true;
        } else {
            this.webdavUrlInput.disabled = false;
        }
    }

    async toggleWebDAV() {
        // 切换WebDAV启用状态
        const isEnabled = this.webdavEnableToggle.checked;
        this.toggleWebDAVPanel();

        // 如果禁用，直接保存配置
        if (!isEnabled) await this.saveWebDAVConfig();
    }

    toggleWebDAVPanel() {
        // 切换WebDAV配置面板显示
        const isEnabled = this.webdavEnableToggle.checked;
        if (this.webdavConfigPanel) this.webdavConfigPanel.style.display = isEnabled ? 'block' : 'none';
    }

    async testWebDAVConnection() {
        // 测试WebDAV连接
        // 获取当前输入的配置
        const url = this.webdavUrlInput.value.trim();
        const username = this.webdavUsernameInput.value.trim();
        const password = this.webdavPasswordInput.value;
        const remotePath = this.webdavRemotePathInput.value;

        if (!url || !username || !password || !remotePath) {
            Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
            return;
        }
        await Utils.apiCall({
            apiMethod: 'test_webdav_connection',
            apiArgs: [url, username, password, remotePath],
            onSuccess: (response) => {
                this.showWebDAVStatus(`✅ ${window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！')}`, 'success');
                Utils.showToast(window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！'), 'success');
            },
            onError: (error) => {
                this.showWebDAVStatus(`❌ ${window.languageManager.getText('settingsConnectionFailed', '连接失败')}：${error.message}`, 'error');
                Utils.showToast(window.languageManager.getText('settingsConnectionFailed', '连接失败'), 'error');
            }
        });
    }

    async saveWebDAVConfig() {
        // 保存WebDAV配置
        const config = {
            enabled: this.webdavEnableToggle.checked,
            sync_type: this.webdavSyncType.value.trim(),
            url: this.webdavUrlInput.value.trim(),
            username: this.webdavUsernameInput.value.trim(),
            password: this.webdavPasswordInput.value,
            remote_path : this.webdavRemotePathInput.value,
            auto_sync: true,
            first_sync_mode: this.webdavFirstSyncModeSelect.value
        };

        // 验证启用时必需的字段
        if (config.enabled) {
            if (!config.url || !config.username || !config.password || !config.remote_path) {
                Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
                return;
            }
        }

        const overwriteMsg = config.first_sync_mode === 'local_overwrite' ? 'settingsSyncModeLocalWarning' : 'settingsSyncModeRemoteWarning';
        const warningMsg = config.enabled ? overwriteMsg : 'settingsSyncCloseWarning';

        const modal = document.getElementById('data-sync-modal');
        modal.style.display = 'none';
        modal.classList.remove('show');
        // 确认提示
        Utils.confirmDialog(
            window.languageManager.getText(warningMsg),
            async () => {
                await Utils.apiCall({
                    apiMethod: 'set_webdav_config',
                    apiArgs: [config],
                    onSuccess: (response) => {
                        Utils.showToast(window.languageManager.getText('settingsSaveSuccess', '保存成功'), 'success');
                        // 如果是开启同步功能，则额外进行一次数据同步
                        if (config.enabled) {
                            // 根据首次同步模式执行不同的操作: 本地覆盖远程-上传本地数据到云端 or 远程覆盖本地-从云端下载数据
                            Utils.apiCall({
                                apiMethod: config.first_sync_mode === 'local_overwrite' ? 'sync_to_cloud' : 'sync_from_cloud',
                                apiArgs: config.first_sync_mode === 'local_overwrite' ? [] : [true],
                            });
                            setTimeout(() => {
                                location.reload();
                                localStorage.clear();
                            }, 1000);
                        }
                    },
                    onError: (error) => {
                        Utils.showToast(`${window.languageManager.getText('settingsFailed', '设置失败')}: ${error.message}`, 'error');
                    }
                });
            }
        );
    }

    showWebDAVStatus(message, type) {
        // 显示WebDAV状态信息
        if (this.webdavStatusDiv) {
            this.webdavStatusDiv.textContent = message;
            this.webdavStatusDiv.className = `webdav-status ${type}`;
            this.webdavStatusDiv.style.display = 'block';
        }
    }

    // ==================== 快捷按键相关方法 ====================
    // 获取按键显示名称
    getKeyDisplayName(key) {
        const keyMap = {
            ' ': '<space>',
            'Space': '<space>',
            'Enter': '<enter>',
            'Backspace': '<backspace>',
            'Tab': '<tab>',
            'Escape': '<esc>',
            'ArrowUp': '<↑>',
            'ArrowDown': '<↓>',
            'ArrowLeft': '<←>',
            'ArrowRight': '<→>',
            'Minus': '-',
            'Equal': '='
        };
        if (keyMap[key]) return keyMap[key];
        return key.toLowerCase();
    }

    // 获取当前按下的所有修饰键
    getActiveModifiers() {
        const modifiers = [];
        if (this.currentModifiers?.ctrl) modifiers.push('<ctrl>');
        if (this.currentModifiers?.alt) modifiers.push('<alt>');
        if (this.currentModifiers?.shift) modifiers.push('<shift>');
        if (this.currentModifiers?.meta) modifiers.push('<win>');
        return modifiers;
    }

    // 格式化组合键显示
    formatComboKey(mainKey) {
        const modifiers = this.getActiveModifiers();
        const mainDisplay = this.getKeyDisplayName(mainKey);

        if (modifiers.length === 0) return mainDisplay;
        return [...modifiers, mainDisplay].join('+');
    }

    // 重置修饰键状态
    resetModifiers() {
        this.currentModifiers = {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false
        };
    }

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
    }

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        if (modal) {
            Utils.closeModalWithAnimation(modal, () => {
                modal.style.display = 'none';
                modal.classList.remove('show');
            });
        }
    }

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
                apiArgs: [1, 10000, null, null, null, null, null, null, null, null],
                onSuccess: (response) => this.updateExportYears(response.data.tasks)
            });

            // 绑定导出模态框事件
            this.bindExportModalEvents();
        } catch (error) {
            logger.error('初始化导出选项失败:', error);
            Utils.showToast('初始化导出选项失败', 'error');
        }
    }

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
    }

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
    }

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
    }

    bindExportModalEvents() {
        const closeBtn = document.getElementById('export-modal-close');
        const cancelBtn = document.getElementById('export-cancel-btn');
        const confirmBtn = document.getElementById('export-confirm-btn');
        if (closeBtn) closeBtn.onclick = () => this.closeExportModal();
        if (cancelBtn) cancelBtn.onclick = () => this.closeExportModal();
        if (confirmBtn) confirmBtn.onclick = () => this.executeExport();
    }

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
                Utils.showToast('导出任务失败: ' + error.message, 'error');
            },
            onFinally: () => this.closeExportModal()
        });
    }

    // 处理按键按下
    handleKeyDown(e) {
        // 1. 同步修饰键状态
        this.currentModifiers.ctrl = e.ctrlKey;
        this.currentModifiers.alt = e.altKey;
        this.currentModifiers.shift = e.shiftKey;
        this.currentModifiers.meta = e.metaKey;

        const key = e.key;
        e.preventDefault();

        // 如果是单纯的修饰键本身，不作为主键录入
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

        // 2. 【Mac 修复核心】：如果是字母或数字键，使用 e.code 提取干净的物理键名
        let mainKey = key;
        if (e.code && e.code.startsWith('Key')) {
            // 例如 "KeyA" 截取后变成 "a"
            mainKey = e.code.replace('Key', '').toLowerCase();
        } else if (e.code && e.code.startsWith('Digit')) {
            // 例如 "Digit1" 截取后变成 "1"
            mainKey = e.code.replace('Digit', '');
        }

        // 3. 获取组合键名称并显示
        let comboName = this.formatComboKey(mainKey);
        this.smartKeyShow.textContent = comboName;
    }

    // 处理按键释放
    handleKeyUp(e) {
    // 同步最新的修饰键状态
        this.currentModifiers.ctrl = e.ctrlKey;
        this.currentModifiers.alt = e.altKey;
        this.currentModifiers.shift = e.shiftKey;
        this.currentModifiers.meta = e.metaKey;
    }
}

// 全局实例
let settingsManager = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保所有脚本都加载完成
    setTimeout(() => {
        if (!settingsManager) settingsManager = new SettingsUIManager();
    }, 500);
});

// window加载后再次尝试
window.addEventListener('load', () => {
    if (!settingsManager) settingsManager = new SettingsUIManager();
});

// 导出到全局
window.settingsManager = settingsManager;
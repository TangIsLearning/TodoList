/**
 * 设置中心管理模块（核心）
 *
 * 本文件只保留设置弹窗骨架与通用开关（语言/置顶/自启），
 * 其余子功能以 mixin 方式拆分在同目录下：
 *   settings.theme.js    主题配色编辑器
 *   settings.storage.js  存储目录迁移
 *   settings.webdav.js   WebDAV 配置
 *   settings.export.js   任务导出弹窗
 *   settings.shortcut.js 快捷键录制
 *
 * 注意：子功能文件通过 Object.assign(SettingsUIManager.prototype, ...) 挂载方法，
 * 必须先加载本文件；init() 内部有 100ms 延迟，子文件的方法在 init 执行前必然已挂载。
 */

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

                // 设置中心文案由 language.views.js 的 updateSettings 在 switchLanguage 过程中统一刷新，
                // 此处无需重复刷新
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
            logger.error('数据传输功能未初始化');
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

    async saveSettings() {
        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['window_on_top', this.onTop.toString()],
            onSuccess: (response) => localStorage.setItem('todolist_windowOnTop', this.onTop.toString())
        });
    }

    /** 统一的文案读取（带中文兜底） */
    t(key, fallback) {
        if (window.languageManager) return window.languageManager.getText(key, fallback);
        return fallback;
    }
}

// 全局实例：脚本位于 body 末尾，DOM 已就绪；init 内部仍有 100ms 延迟，
// 保证同目录 mixin 文件（随后加载）的方法在 init 执行前挂载到原型上
const settingsManager = new SettingsUIManager();
window.settingsManager = settingsManager;

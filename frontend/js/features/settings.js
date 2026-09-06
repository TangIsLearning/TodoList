/**
 * 设置中心管理模块
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
        this.themeDarkToggle = document.getElementById('theme-dark-toggle');
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
    }
    
    bindEvents() {
        // 打开设置中心
        this.settingsBtn?.addEventListener('click', () => this.openModal());

        // 关闭设置中心
        this.closeBtn?.addEventListener('click', () => this.closeModal());

        // 点击模态框外部关闭
        this.modal?.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });

        // 窗口置顶开关
        this.windowTopToggle?.addEventListener('change', () => this.toggleWindowOnTop());

        this.themeDarkToggle?.addEventListener('change', () => this.toggleThemeDark());

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

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal && this.modal.style.display === 'flex') this.closeModal();
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
    }
    
    async openModal() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.modal.classList.add('show');
            
            // 更新当前状态
            await this.updateCurrentState();
            
            // 更新数据文件配置
            this.updateDataFileConfig();
        }
    }
    
    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
            this.modal.classList.remove('show');
            this.smartKeyShow.textContent = this.currentButtonKey;
        }
    }
    
    async updateCurrentState() {
        // 更新窗口置顶状态
        this.updateWindowOnTopState();
        
        // 更新主题选择
        await BusinessUtils.ThemeManager.init();
        
        // 更新语言状态
        this.updateLanguageSwitchState();
        
        // 更新开机启动状态
        this.updateAutoStartState();

        // 更新快捷键配置
        this.updateShortcutToggleState();
        this.updateShortcutConfig();
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
    
    async toggleThemeDark() {
        // 立即更新UI
        let theme = 'light';
        if (this.themeDarkToggle) {
            theme = this.themeDarkToggle.checked ? 'dark' : 'light';
        }

        // 更新主题切换按钮
        BusinessUtils.ThemeManager.updateToggleButton(theme);

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['theme', theme],
            onSuccess: (response) => {
                localStorage.setItem('todolist_theme', theme);
                Utils.showToast(`${theme === 'dark' ?
                    window.languageManager.getText('darkModeSwitched', '已切换到深色主题') :
                    window.languageManager.getText('LightModeSwitched', '已切换到浅色主题')}`, 'success');
            }
        });
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
                Utils.showToast(window.languageManager.getText('languageSwitchFailed', '语言切换失败'), 'error');
            }
        } catch (error) {
            logger.error('设置语言失败:', error);
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

        // 更新各部分标题
        const sectionTitles = document.querySelectorAll('.setting-section h3');
        const titleKeys = ['settingsWindow', 'settingsData'];
        sectionTitles.forEach((title, index) => {
            if (titleKeys[index]) title.textContent = window.languageManager.getText(titleKeys[index], title.textContent);
        });
        
        // 更新窗口置顶标签
        const windowTopCheckbox = document.getElementById('window-top-toggle');
        const windowTopSettingItem = windowTopCheckbox.closest('.setting-item');
        const windowTopLabel = windowTopSettingItem.querySelector('.setting-text');
        if (windowTopLabel) windowTopLabel.textContent = window.languageManager.getText('settingsWindowTop', '窗口置顶');

        // 更新主题标签
        const darkModeCheckbox = document.getElementById('theme-dark-toggle');
        const darkModeSettingItem = darkModeCheckbox.closest('.setting-item');
        const themeLabel = darkModeSettingItem.querySelector('.setting-text');
        if (themeLabel) themeLabel.textContent = window.languageManager.getText('settingsDarkTheme', '深色模式');

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

        let onTop = localStorage.getItem('todolist_windowOnTop');
        if (onTop) {
            this.windowTopToggle.checked = onTop === 'true';
            this.onTop = this.windowTopToggle.checked;
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['window_on_top'],
            onSuccess: (response) => {
                this.windowTopToggle.checked = response.data.window_on_top;
                this.onTop = this.windowTopToggle.checked;
            },
            onError: (error) => {
                this.windowTopToggle.checked = false;
                this.onTop = this.windowTopToggle.checked;
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
                modal.style.display = 'flex';
                this.updateWebDAVConfig();
            } else {
                Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            }
        }, 100);

        // 添加关闭按钮点击事件
        const closeBtn = document.getElementById('data-sync-close');
        closeBtn?.addEventListener('click', () => {
            modal.style.display = 'none';
            modal.classList.remove('show');
        });

        // 点击模态框外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                modal.classList.remove('show');
            }
        });
    }
    
    async restoreSettings() {
        try {
            // 恢复窗口置顶状态
            this.onTop = localStorage.getItem('todolist_windowOnTop') === 'true';
            
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
        // 浏览选择文件
        this.setDirectoryButtonsDisabled(true);
        await Utils.apiCall({
            apiMethod: 'select_file_dialog',
            onSuccess: (response) => {
                const selectedPath = response.data;
                if (selectedPath && this.dataDirBtn) {
                    this.dataDirBtn.textContent = selectedPath;
                    this.dataDirBtn.title = selectedPath;
                    Utils.showToast(`已选择文件: ${selectedPath}`, 'success');

                    // 自动聚焦到应用按钮，方便用户快速操作
                    setTimeout(() => {
                        if (this.applyDirBtn) {
                            this.applyDirBtn.focus();
                        }
                    }, 300);
                }
            },
            onError: (error) => {
                Utils.showToast('浏览文件时发生错误: ' + error.message, 'error');
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
            modal.style.display = 'flex';
            modal.classList.add('show');

            // 初始化导出选项
            await this.initExportOptions();
        }
    }

    closeExportModal() {
        const modal = document.getElementById('export-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
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
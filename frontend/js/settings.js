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

        // WebDAV相关元素
        this.webdavEnableToggle = null;
        this.webdavConfigPanel = null;
        this.webdavUsernameInput = null;
        this.webdavPasswordInput = null;
        this.webdavRemotePathInput = null;
        this.webdavFirstSyncModeSelect = null;
        this.webdavTestBtn = null;
        this.webdavSaveBtn = null;
        this.webdavStatusDiv = null;

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
            console.log('SettingsUIManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize SettingsUIManager:', error);
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

        // 数据目录配置元素
        this.dataDirBtn = document.getElementById('data-dir-btn');
        this.applyDirBtn = document.getElementById('apply-dir-btn');
        
        // WebDAV配置元素
        this.webdavEnableToggle = document.getElementById('webdav-enable-toggle');
        this.webdavConfigPanel = document.getElementById('webdav-config-panel');
        this.webdavUsernameInput = document.getElementById('webdav-username');
        this.webdavPasswordInput = document.getElementById('webdav-password');
        this.webdavRemotePathInput = document.getElementById('webdav-remote-path');
        this.webdavFirstSyncModeSelect = document.getElementById('webdav-first-sync-mode');
        this.webdavTestBtn = document.getElementById('webdav-test-btn');
        this.webdavSaveBtn = document.getElementById('webdav-save-btn');
        this.webdavStatusDiv = document.getElementById('webdav-status');
    }
    
    bindEvents() {
        // 打开设置中心
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => this.openModal());
        }
        
        // 关闭设置中心
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        // 点击模态框外部关闭
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });
        }
        
        // 窗口置顶开关
        if (this.windowTopToggle) {
            this.windowTopToggle.addEventListener('change', () => this.toggleWindowOnTop());
        }

        if (this.themeDarkToggle) {
            this.themeDarkToggle.addEventListener('change', () => this.toggleThemeDark());
        }
        
        // 语言切换
        const languageToggle = document.getElementById('language-toggle');
        if (languageToggle) {
            languageToggle.addEventListener('change', (e) => this.handleLanguageToggle(e));
        }
        
        // 数据共享按钮
        if (this.dataShareBtn) {
            this.dataShareBtn.addEventListener('click', () => this.openDataTransfer('share'));
        }

        // 数据同步按钮
        if (this.dataSyncBtn) {
            this.dataSyncBtn.addEventListener('click', () => this.openDataSync());
        }
        
        // 数据文件配置事件绑定
        if (this.dataDirBtn) {
            this.dataDirBtn.addEventListener('click', () => this.browseFile());
        }
        
        if (this.applyDirBtn) {
            this.applyDirBtn.addEventListener('click', () => this.applyDataFile());
        }
        
        if (this.dataDirBtn) {
            this.dataDirBtn.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.applyDataDirectory();
                }
            });
        }
        
        // WebDAV事件绑定
        if (this.webdavEnableToggle) {
            this.webdavEnableToggle.addEventListener('change', () => this.toggleWebDAV());
        }
        
        if (this.webdavTestBtn) {
            this.webdavTestBtn.addEventListener('click', () => this.testWebDAVConnection());
        }
        
        if (this.webdavSaveBtn) {
            this.webdavSaveBtn.addEventListener('click', () => this.saveWebDAVConfig());
        }
        
        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal && this.modal.style.display === 'flex') {
                this.closeModal();
            }
        });
    }
    
    openModal() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.modal.classList.add('show');
            
            // 更新当前状态
            this.updateCurrentState();
            
            // 更新数据文件配置
            this.updateDataFileConfig();
        }
    }
    
    closeModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
            this.modal.classList.remove('show');
        }
    }
    
    updateCurrentState() {
        // 更新窗口置顶状态
        if (this.windowTopToggle) {
            this.windowTopToggle.checked = this.onTop;
        }
        
        // 更新主题选择
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        if (this.themeDarkToggle) {
            this.themeDarkToggle.checked = currentTheme === 'dark';
        }
        
        // 更新语言状态
        this.updateLanguageSwitchState();
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
        document.documentElement.setAttribute('data-theme', theme);
        
        // 更新主题切换按钮
        BusinessUtils.ThemeManager.updateToggleButton(theme);
        
        // 异步保存到 localStorage
        try {
            localStorage.setItem('todolist_theme', theme);
            Utils.showToast(`${theme === 'dark' ?
                window.languageManager.getText('darkModeSwitched', '已切换到深色主题') :
                window.languageManager.getText('LightModeSwitched', '已切换到浅色主题')}`, 'success');
        } catch (error) {
            console.error('保存主题失败:', error);
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
        
        if (indicator) {
            indicator.textContent = text;
        }
        
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
            console.error('LanguageManager not initialized');
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
            console.error('设置语言失败:', error);
            Utils.showToast(window.languageManager.getText('languageSwitchFailed', '语言切换失败'), 'error');
        }
    }
    
    // 更新设置中心的语言文本
    updateSettingsLanguage() {
        if (!window.languageManager) {
            return;
        }
        
        const lang = window.languageManager.getText;
        const langCode = window.languageManager.getCurrentLanguage();
        
        // 更新设置标题
        const settingsTitle = document.querySelector('#settings-modal h2');
        if (settingsTitle) {
            settingsTitle.textContent = window.languageManager.getText('settings', '设置');
        }
        
        // 更新各部分标题
        const sectionTitles = document.querySelectorAll('.setting-section h3');
        const titleKeys = ['settingsWindow', 'settingsData'];
        sectionTitles.forEach((title, index) => {
            if (titleKeys[index]) {
                title.textContent = window.languageManager.getText(titleKeys[index], title.textContent);
            }
        });
        
        // 更新窗口置顶标签
        const windowTopCheckbox = document.getElementById('window-top-toggle');
        const windowTopSettingItem = windowTopCheckbox.closest('.setting-item');
        const windowTopLabel = windowTopSettingItem.querySelector('.setting-text');
        if (windowTopLabel) {
            windowTopLabel.textContent = window.languageManager.getText('settingsWindowTop', '窗口置顶');
        }
        
        // 更新主题标签
        const darkModeCheckbox = document.getElementById('theme-dark-toggle');
        const darkModeSettingItem = darkModeCheckbox.closest('.setting-item');
        const themeLabel = darkModeSettingItem.querySelector('.setting-text');
        if (themeLabel) {
            themeLabel.textContent = window.languageManager.getText('settingsDarkTheme', '深色模式');
        }

        // 语言切换标签
        const languageCheckbox = document.getElementById('language-toggle');
        const languageSettingItem = languageCheckbox.closest('.setting-item');
        const languageLabel = languageSettingItem.querySelector('.setting-text');
        if (languageLabel) {
            languageLabel.textContent = window.languageManager.getText('language', '中英文切换');
        }

        // 更新数据存储标签
        const dataStorageLabel = document.querySelector('.data-label');
        if (dataStorageLabel) {
            dataStorageLabel.textContent = window.languageManager.getText('dataStoragePath', '存储路径');
        }
        const dataStorageApplyLabel = document.querySelector('.apply-dir-btn');
        if (dataStorageApplyLabel) {
            dataStorageApplyLabel.textContent = window.languageManager.getText('dataStorageApply', '应用');
        }

        // 更新数据管理标签
        const dataShareSettingItem = document.getElementById('data-share-btn');
        const dataShareLabel = dataShareSettingItem.querySelector('.setting-text');
        if (dataShareLabel) {
            dataShareLabel.textContent = window.languageManager.getText('settingsDataShare', '共享数据');
        }

        const dataSyncSettingItem = document.getElementById('data-sync-btn');
        const dataSyncLabel = dataSyncSettingItem.querySelector('.setting-text');
        if (dataSyncLabel) {
            dataSyncLabel.textContent = window.languageManager.getText('settingsDataSync', '同步数据');
        }
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
                    console.error('打开数据传输模态框失败:', error);
                    Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                }
            }, 100);
        } else {
            console.error('数据传输功能未初始化:', error);
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
            console.log('打开模态框');
            if (modal) {
                modal.style.display = 'flex';
                this.updateWebDAVConfig();
            } else {
                console.log('模态框未找到！');
                Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            }
        }, 100);

        // 添加关闭按钮点击事件
        const closeBtn = document.getElementById('data-sync-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
                modal.classList.remove('show');
            });
        }

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
            
            // 恢复主题设置（由主题管理器处理）
            const savedTheme = localStorage.getItem('todolist_theme') || 'light';
            document.documentElement.setAttribute('data-theme', savedTheme);
            BusinessUtils.ThemeManager.updateToggleButton(savedTheme);
            
            console.log('Settings restored successfully');
        } catch (error) {
            console.error('Failed to restore settings:', error);
        }
    }
    
    // ==================== 数据目录配置方法 ====================
    
    async updateDataFileConfig() {
        // 更新数据文件配置显示
        try {
            if (!window.pywebview || !window.pywebview.api) {
                Utils.showToast(window.languageManager.getText('retry', '发生未知异常，请稍后重试！'), 'error');
                return;
            }
            
            const result = await window.pywebview.api.get_data_file_config();
            
            if (result.success) {
                if (this.dataDirBtn) {
                    this.dataDirBtn.textContent = result.current_file;
                }
            } else {
                Utils.showToast('获取配置失败: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('更新数据文件配置失败:', error);
            Utils.showToast('获取配置时发生错误', 'error');
        }
    }
    
    async browseFile() {
        // 浏览选择文件
        try {
            if (!window.pywebview || !window.pywebview.api) {
                Utils.showToast(window.languageManager.getText('retry', '发生未知异常，请稍后重试！'), 'error');
                return;
            }
            
            // 显示加载状态
            this.setDirectoryButtonsDisabled(true);
            Utils.showToast('正在打开文件选择对话框...', 'warning');
            
            // 调用pywebview的文件选择对话框
            const result = await window.pywebview.api.select_file_dialog();
            
            if (result && result.success && result.selected_path) {
                // 将选择的文件路径填入输入框
                if (this.dataDirBtn) {
                    this.dataDirBtn.textContent = result.selected_path;
                    Utils.showToast(`已选择文件: ${result.selected_path}`, 'success');

                    // 自动聚焦到应用按钮，方便用户快速操作
                    setTimeout(() => {
                        if (this.applyDirBtn) {
                            this.applyDirBtn.focus();
                        }
                    }, 300);
                }
            } else if (result && !result.success) {
                const errorMsg = result.error || '用户取消了操作';
                Utils.showToast(`文件选择失败: ${errorMsg}`, 'error');
                if (!errorMsg.includes('取消')) {
                    Utils.showToast('文件选择失败: ' + errorMsg, 'error');
                }
            }
            
        } catch (error) {
            console.error('浏览文件失败:', error);
            Utils.showToast('浏览文件时发生错误: ' + error.message, 'error');
        } finally {
            this.setDirectoryButtonsDisabled(false);
        }
    }
    
    async applyDataFile() {
        // 应用新的数据文件配置
        try {
            if (!this.dataDirBtn || !this.dataDirBtn.textContent.trim()) {
                Utils.showToast('请输入数据文件路径', 'warning');
                return;
            }
            
            const newFile = this.dataDirBtn.textContent.trim();
            
            // 显示加载状态
            this.setDirectoryButtonsDisabled(true);
            Utils.showToast('正在验证文件...', 'warning');
            
            // 验证文件路径
            const validationResult = await window.pywebview.api.validate_data_file(newFile);
            
            if (!validationResult.success) {
                Utils.showToast(validationResult.error, 'error');
                this.setDirectoryButtonsDisabled(false);
                return;
            }

            // 确认提示
            this.closeModal();
            Utils.confirmDialog(
                window.languageManager.getText('settingsStorageWarning', '注意：这将影响所有数据的读写操作，当前数据会被移动到新文件。建议先备份重要数据。是否继续？'),
                async () => {
                    try {
                        const result = await window.pywebview.api.set_data_file_config(newFile);
                        if (result.success) {
                            // 更新显示
                            await this.updateDataFileConfig();

                            this.refreshData();
                        } else {
                            Utils.showToast(`${window.languageManager.getText('settingsFailed', '设置失败')}: ${response.error}`, 'error');
                        }
                    } catch (error) {
                        console.error('应用数据文件配置失败:', error);
                        Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
                    }
                }
            );
        } catch (error) {
            console.error('应用数据文件配置失败:', error);
            Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
        } finally {
            this.setDirectoryButtonsDisabled(false);
        }
    }

    async refreshData() {
        // 重新加载任务列表
        if (window.todoManager) {
            await window.todoManager.loadTasks();
        }
        if (window.categoryManager) {
            await window.categoryManager.loadCategories();
            await window.categoryManager.renderCategories(false);
        }

        // 显示成功提示
        Utils.showToast(window.languageManager.getText('refreshDataSuccess', '刷新数据成功'), 'success');
    }
    
    setDirectoryButtonsDisabled(disabled) {
        // 设置目录配置按钮的禁用状态
        const buttons = [this.applyDirBtn, this.dataDirBtn];
        buttons.forEach(btn => {
            if (btn) {
            btn.disabled = disabled;
            }
        });
        
        // 更新输入框状态
        if (this.dataDirBtn) {
            this.dataDirBtn.disabled = disabled;
        }
    }
    
    async saveSettings() {
        try {
            // 保存窗口置顶状态
            localStorage.setItem('todolist_windowOnTop', this.onTop.toString());
            
            // 主题设置由主题管理器保存
            
            console.log('Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    // ==================== WebDAV相关方法 ====================
    async updateWebDAVConfig() {
        // 更新WebDAV配置显示
        try {
            if (!window.pywebview || !window.pywebview.api) {
                return;
            }

            const result = await window.pywebview.api.get_webdav_config();

            if (result.success && result.config) {
                const config = result.config;

                console.log('WebDAV config:', config);

                // 更新开关状态
                if (this.webdavEnableToggle) {
                    this.webdavEnableToggle.checked = config.enabled || false;
                    this.toggleWebDAVPanel();
                }

                // 更新输入框
                if (this.webdavUsernameInput) {
                    this.webdavUsernameInput.value = config.username || '';
                }

                if (this.webdavPasswordInput) {
                    this.webdavPasswordInput.value = config.password || '';
                }

                if (this.webdavRemotePathInput) {
                    this.webdavRemotePathInput.value = config.remote_path || '';
                }

                if (this.webdavFirstSyncModeSelect) {
                    this.webdavFirstSyncModeSelect.value = config.first_sync_mode || 'remote_overwrite';
                }
            }
        } catch (error) {
            console.error('更新WebDAV配置失败:', error);
        }
    }

    async toggleWebDAV() {
        // 切换WebDAV启用状态
        const isEnabled = this.webdavEnableToggle.checked;
        this.toggleWebDAVPanel();

        // 如果禁用，直接保存配置
        if (!isEnabled) {
            await this.saveWebDAVConfig();
        }
    }

    toggleWebDAVPanel() {
        // 切换WebDAV配置面板显示
        const isEnabled = this.webdavEnableToggle.checked;
        if (this.webdavConfigPanel) {
            this.webdavConfigPanel.style.display = isEnabled ? 'block' : 'none';
        }
    }

    async testWebDAVConnection() {
        // 测试WebDAV连接
        try {
            if (!window.pywebview || !window.pywebview.api) {
                Utils.showToast(window.languageManager.getText('retry', '发生未知异常，请稍后重试！'), 'error');
                return;
            }

            // 获取当前输入的配置
            const username = this.webdavUsernameInput.value.trim();
            const password = this.webdavPasswordInput.value;
            const remotePath = this.webdavRemotePathInput.value;

            if (!username || !password || !remotePath) {
                Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
                return;
            }

            // 调用测试API
            const result = await window.pywebview.api.test_webdav_connection(username, password, remotePath);

            if (result.success) {
                this.showWebDAVStatus(`✅ ${window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！')}`, 'success');
                Utils.showToast(window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！'), 'success');
            } else {
                this.showWebDAVStatus(`❌ ${window.languageManager.getText('settingsConnectionFailed', '连接失败')}：${result.error}`, 'error');
                Utils.showToast(`${window.languageManager.getText('settingsConnectionFailed', '连接失败')}: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('测试WebDAV连接失败:', error);
            this.showWebDAVStatus(`❌ ${window.languageManager.getText('settingsConnectionFailed', '连接失败')}：${error.message}`, 'error');
            Utils.showToast(window.languageManager.getText('settingsConnectionFailed', '连接失败'), 'error');
        }
    }

    async saveWebDAVConfig() {
        // 保存WebDAV配置
        try {
            if (!window.pywebview || !window.pywebview.api) {
                Utils.showToast(window.languageManager.getText('retry', '发生未知异常，请稍后重试！'), 'error');
                return;
            }

            const config = {
                enabled: this.webdavEnableToggle.checked,
                username: this.webdavUsernameInput.value.trim(),
                password: this.webdavPasswordInput.value,
                remote_path : this.webdavRemotePathInput.value,
                auto_sync: true,
                first_sync_mode: this.webdavFirstSyncModeSelect.value
            };

            // 验证启用时必需的字段
            if (config.enabled) {
                if (!config.username || !config.password || !config.remote_path) {
                    Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
                    return;
                }
            }

            // 强制同步
            const modal = document.getElementById('data-sync-modal');
            modal.style.display = 'none';
            modal.classList.remove('show');
            // 确认提示
            Utils.confirmDialog(
                config.first_sync_mode === 'local_overwrite' ?
                window.languageManager.getText('settingsSyncModeLocalWarning', '注意：当前操作将直接触发一次本地数据强制覆盖远程文件数据。建议先备份重要数据。是否继续？') :
                window.languageManager.getText('settingsSyncModeRemoteWarning', '注意：当前操作将直接触发一次远程数据强制覆盖本地文件数据。建议先备份重要数据。是否继续？'),
                async () => {
                    try {
                        // 保存配置
                        const result = await window.pywebview.api.set_webdav_config(config);

                        if (result.success) {
                            Utils.showToast(window.languageManager.getText('settingsSaveSuccess', '保存成功'), 'success');

                            // 根据首次同步模式执行不同的操作
                            if (config.first_sync_mode === 'local_overwrite') {
                                // 本地覆盖远程：上传本地数据到云端
                                await window.pywebview.api.sync_to_cloud();
                            } else {
                                // 远程覆盖本地：从云端下载数据
                                await window.pywebview.api.sync_from_cloud(true);
                            }

                            this.showWebDAVStatus(window.languageManager.getText('settingsSaveSuccess', '保存成功'), 'success');

                            this.refreshData();
                        } else {
                            Utils.showToast(`${window.languageManager.getText('settingsFailed', '设置失败')}: ${response.error}`, 'error');
                            this.showWebDAVStatus(`${window.languageManager.getText('settingsFailed', '设置失败')}：${result.error}`, 'error');
                        }
                    } catch (error) {
                        console.error('应用配置失败:', error);
                        Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
                    }
                }
            );
        } catch (error) {
            console.error('保存WebDAV配置失败:', error);
            Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
            this.showWebDAVStatus(`${window.languageManager.getText('settingsFailed', '设置失败')}：${error.message}`, 'error');
        }
    }

    showWebDAVStatus(message, type) {
        // 显示WebDAV状态信息
        if (this.webdavStatusDiv) {
            this.webdavStatusDiv.textContent = message;
            this.webdavStatusDiv.className = `webdav-status ${type}`;
            this.webdavStatusDiv.style.display = 'block';
        }
    }
}

// 全局实例
let settingsManager = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded - 创建SettingsUIManager实例');
    
    // 延迟初始化，确保所有脚本都加载完成
    setTimeout(() => {
        if (!settingsManager) {
            settingsManager = new SettingsUIManager();
            console.log('SettingsUIManager实例创建成功');
        }
    }, 500);
});

// window加载后再次尝试
window.addEventListener('load', () => {
    console.log('window.load - 检查SettingsUIManager实例');
    
    if (!settingsManager) {
        settingsManager = new SettingsUIManager();
        console.log('SettingsUIManager实例（window.load）创建成功');
    }
});

// 导出到全局
window.settingsManager = settingsManager;
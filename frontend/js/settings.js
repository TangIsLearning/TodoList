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
        this.themeLight = null;
        this.themeDark = null;
        this.dataShareBtn = null;
        this.dataReceiveBtn = null;
        this.languageZh = null;
        this.languageEn = null;
        
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
        this.themeLight = document.getElementById('theme-light');
        this.themeDark = document.getElementById('theme-dark');
        this.dataShareBtn = document.getElementById('data-share-btn');
        this.dataReceiveBtn = document.getElementById('data-receive-btn');
        this.languageZh = document.getElementById('language-zh');
        this.languageEn = document.getElementById('language-en');
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
        
        // 主题切换
        if (this.themeLight) {
            this.themeLight.addEventListener('change', () => this.setTheme('light'));
        }
        if (this.themeDark) {
            this.themeDark.addEventListener('change', () => this.setTheme('dark'));
        }
        
        // 语言切换
        if (this.languageZh) {
            this.languageZh.addEventListener('change', () => this.setLanguage('zh'));
        }
        if (this.languageEn) {
            this.languageEn.addEventListener('change', () => this.setLanguage('en'));
        }
        
        // 数据共享按钮
        if (this.dataShareBtn) {
            this.dataShareBtn.addEventListener('click', () => this.openDataTransfer('share'));
        }
        
        // 数据接收按钮
        if (this.dataReceiveBtn) {
            this.dataReceiveBtn.addEventListener('click', () => this.openDataTransfer('receive'));
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
            
            // 更新语言选择器的状态
            this.updateLanguageSelector();
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
        if (this.themeLight && this.themeDark) {
            this.themeLight.checked = currentTheme === 'light';
            this.themeDark.checked = currentTheme === 'dark';
        }
    }
    
    // 更新语言选择器状态
    updateLanguageSelector() {
        const currentLanguage = window.languageManager ? window.languageManager.getCurrentLanguage() : 'zh';
        if (this.languageZh && this.languageEn) {
            this.languageZh.checked = currentLanguage === 'zh';
            this.languageEn.checked = currentLanguage === 'en';
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
    
    async setTheme(theme) {
        // 立即更新UI
        document.documentElement.setAttribute('data-theme', theme);
        
        // 更新主题切换按钮
        BusinessUtils.ThemeManager.updateToggleButton(theme);
        
        // 异步保存到三层存储
        try {
            await Storage.storage.save('theme', theme);
            Utils.showToast(`${theme === 'dark' ?
                window.languageManager.getText('darkModeSwitched', '已切换到深色主题') :
                window.languageManager.getText('LightModeSwitched', '已切换到浅色主题')}`, 'success');
        } catch (error) {
            console.error('保存主题失败:', error);
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
        const titleKeys = ['settingsWindow', 'settingsTheme', 'settingsData', 'language'];
        sectionTitles.forEach((title, index) => {
            if (titleKeys[index]) {
                title.textContent = window.languageManager.getText(titleKeys[index], title.textContent);
            }
        });
        
        // 更新窗口置顶标签
        const windowTopLabel = document.querySelector('.setting-item .setting-text');
        if (windowTopLabel) {
            windowTopLabel.textContent = window.languageManager.getText('settingsWindowTop', '窗口置顶');
        }
        
        // 更新主题标签
        const themeLabels = document.querySelectorAll('.theme-label');
        if (themeLabels.length >= 2) {
            themeLabels[0].textContent = window.languageManager.getText('settingsLightTheme', '浅色模式');
            themeLabels[1].textContent = window.languageManager.getText('settingsDarkTheme', '深色模式');
        }
        
        // 更新数据管理标签
        const dataLabels = document.querySelectorAll('.data-label');
        if (dataLabels.length >= 2) {
            dataLabels[0].textContent = window.languageManager.getText('settingsDataShare', '共享数据');
            dataLabels[1].textContent = window.languageManager.getText('settingsDataReceive', '接收数据');
        }
    }
    
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
    
    async restoreSettings() {
        try {
            // 恢复窗口置顶状态
            const savedOnTop = await Storage.storage.load('windowOnTop', false);
            this.onTop = savedOnTop;
            
            // 恢复主题设置（由主题管理器处理）
            const savedTheme = await Storage.storage.load('theme', 'light');
            document.documentElement.setAttribute('data-theme', savedTheme);
            BusinessUtils.ThemeManager.updateToggleButton(savedTheme);
            
            console.log('Settings restored successfully');
        } catch (error) {
            console.error('Failed to restore settings:', error);
        }
    }
    
    async saveSettings() {
        try {
            // 保存窗口置顶状态
            await Storage.storage.save('windowOnTop', this.onTop);
            
            // 主题设置由主题管理器保存
            
            console.log('Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    
    // 获取当前设置状态
    getCurrentSettings() {
        return {
            windowOnTop: this.onTop,
            theme: document.documentElement.getAttribute('data-theme') || 'light',
            language: window.languageManager ? window.languageManager.getCurrentLanguage() : 'zh',
            timestamp: new Date().toISOString()
        };
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
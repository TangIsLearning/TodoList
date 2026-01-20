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
    
    async toggleWindowOnTop() {
        if (this.windowTopToggle) {
            this.onTop = this.windowTopToggle.checked;
            
            // 显示提示消息
            Utils.showToast(this.onTop ? '窗口已设置置顶' : '窗口已取消置顶', 'success');
            
            // 保存设置
            await this.saveSettings();
        }
    }
    
    async setTheme(theme) {
        // 立即更新UI
        document.documentElement.setAttribute('data-theme', theme);
        
        // 更新主题切换按钮
        Utils.ThemeManager.updateToggleButton(theme);
        
        // 异步保存到三层存储
        try {
            await Storage.storage.save('theme', theme);
            Utils.showToast(`已切换到${theme === 'dark' ? '深色' : '浅色'}主题`, 'success');
        } catch (error) {
            console.error('保存主题失败:', error);
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
                    Utils.showToast('数据传输功能异常，请刷新页面重试', 'error');
                }
            }, 100);
        } else {
            Utils.showToast('数据传输功能未初始化，请刷新页面重试', 'error');
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
            Utils.ThemeManager.updateToggleButton(savedTheme);
            
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
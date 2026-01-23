// 主应用程序入口

class App {
    constructor() {
        this.isInitialized = false;
        this.modules = [];
    }
    
    // 初始化应用
    async init() {
        try {
            logger.info('Initializing TodoList App...', 'App');
            
            // 检查环境
            if (!this.checkEnvironment()) {
                return;
            }
            
            // 初始化主题
            BusinessUtils.ThemeManager.init();
            
            // 绑定全局事件
            this.bindGlobalEvents();
            
            // 初始化模块
            await this.initModules();
            
            // 设置初始状态
            this.setupInitialState();
            
            this.isInitialized = true;
            logger.info('TodoList App initialized successfully', 'App');
            
            // 隐藏加载状态
            Utils.setLoading(false);
            
        } catch (error) {
            logger.error(`Failed to initialize app: ${error}`, 'App');
            console.error('Failed to initialize app:', error);
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            Utils.setLoading(false);
        }
    }
    
    // 检查环境
    checkEnvironment() {
        // 检查必要的DOM元素
        const requiredElements = [
            'tasks-list',
            'empty-state',
            'loading'
        ];
        
        const missingElements = requiredElements.filter(id => !document.getElementById(id));
        
        if (missingElements.length > 0) {
            console.error('Missing required elements:', missingElements);
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            return false;
        }
        
        return true;
    }
    
    // 绑定全局事件
    bindGlobalEvents() {
        // 设置中心按钮
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                if (window.settingsManager) {
                    window.settingsManager.openModal();
                }
            });
        }

        // 移动端菜单按钮
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                this.toggleMobileSidebar();
            });
        }
        
        // 遮罩层点击关闭侧边栏
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => {
                this.closeMobileSidebar();
            });
        }
        
        // 窗口大小变化
        window.addEventListener('resize', Utils.debounce(() => {
            this.handleResize();
        }, 250));
        
        // 页面可见性变化
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });
        
        // 错误处理
        window.addEventListener('error', (e) => {
            console.error('Global error:', e.error);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            console.error('Unhandled promise rejection:', e.reason);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
    }
    
    // 处理窗口大小变化
    handleResize() {
        // 如果是移动设备，可能需要调整布局
        if (window.innerWidth < 768) {
            document.body.classList.add('mobile');
        } else {
            document.body.classList.remove('mobile');
        }
    }
    
    // 处理页面可见性变化
    handleVisibilityChange() {
        if (document.hidden) {
            // 页面隐藏时暂停一些操作
            console.log('Page hidden');
        } else {
            // 页面显示时刷新数据
            console.log('Page visible');
            if (this.isInitialized) {
                this.refreshData();
            }
        }
    }
    
    // 初始化模块
    async initModules() {
        const modules = [
            { name: 'CategoryManager', instance: window.categoryManager },
            { name: 'TodoManager', instance: window.todoManager },
            { name: 'CalendarManager', instance: window.calendarManager }
        ];
        
        for (const module of modules) {
            try {
                if (module.instance) {
                    console.log(`Initializing ${module.name}...`);
                    await module.instance.init();
                    this.modules.push(module);
                    console.log(`${module.name} initialized`);
                }
            } catch (error) {
                console.error(`Failed to initialize ${module.name}:`, error);
                Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            }
        }
    }
    
    // 设置初始状态
    setupInitialState() {
        // 恢复用户设置
        this.restoreUserSettings();
        
        // 设置初始焦点
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    }
    
    // 恢复用户设置
    async restoreUserSettings() {
        try {
            // 使用新的三层存储异步读取
            const theme = await Storage.storage.load('theme', 'light');

            // 应用主题设置
            if (theme) {
                document.documentElement.setAttribute('data-theme', theme);
                BusinessUtils.ThemeManager.updateToggleButton(theme);
            }

            console.log('User settings restored');
        } catch (error) {
            console.error('Failed to restore user settings:', error);
        }
    }
    
    // 刷新所有数据
    async refreshData() {
        try {
            Utils.setLoading(true, '刷新数据...');
            
            // 并行刷新所有模块数据
            const refreshPromises = this.modules.map(module => {
                if (module.instance && typeof module.instance.refresh === 'function') {
                    return module.instance.refresh();
                }
                return Promise.resolve();
            });
            
            await Promise.all(refreshPromises);
            
            console.log('All data refreshed');
            
        } catch (error) {
            console.error('Failed to refresh data:', error);
            Utils.showToast(window.languageManager.getText('refreshDataFailed', '刷新数据失败'), 'error');
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 获取应用状态
    getAppState() {
        return {
            isInitialized: this.isInitialized,
            modules: this.modules.map(m => m.name),
            theme: document.documentElement.getAttribute('data-theme') || 'light',
            timestamp: new Date().toISOString()
        };
    }
    
    // 重置应用状态
    async reset() {
        try {
            // 重置筛选器
            if (window.todoManager) {
                window.todoManager.currentFilter = 'all';
                window.todoManager.searchQuery = '';
                window.todoManager.priorityFilter = 'all';
                window.todoManager.statusFilter = 'all';
                
                // 重置搜索框
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.value = '';
                }
                
                // 重置筛选器
                const priorityFilter = document.getElementById('priority-filter');
                const statusFilter = document.getElementById('status-filter');
                if (priorityFilter) priorityFilter.value = 'all';
                if (statusFilter) statusFilter.value = 'all';
            }
            
            // 重置分类选择
            if (window.categoryManager) {
                window.categoryManager.filterByCategory('all');
            }
            
            // 刷新数据
            await this.refreshData();
            
            Utils.showToast(window.languageManager.getText('resetStateSuccess', '应用状态已重置'), 'success');
            
        } catch (error) {
            console.error('Failed to reset app:', error);
            Utils.showToast(window.languageManager.getText('resetStateFailed', '重置失败'), 'error');
        }
    }
    
    // 切换移动端侧边栏
    toggleMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        if (sidebar && overlay) {
            const isOpen = sidebar.classList.contains('open');
            
            if (isOpen) {
                this.closeMobileSidebar();
            } else {
                sidebar.classList.add('open');
                overlay.classList.add('show');
            }
        }
    }
    
    // 关闭移动端侧边栏
    closeMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        }
    }
}

// 创建应用实例
const app = new App();

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    // 显示加载状态
    Utils.setLoading(true, '初始化应用...');
    
    // 延迟初始化，确保所有资源加载完成
    setTimeout(() => {
        app.init();
    }, 100);
});

// 导出到全局
window.App = app;

// 添加调试信息到控制台
console.log('TodoList App loaded. Debug mode:', window.location.hostname === 'localhost');
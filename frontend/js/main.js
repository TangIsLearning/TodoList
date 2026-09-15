// 主应用程序入口

class App {
    constructor() {
        this.isInitialized = false;
        this.modules = [];
    }
    
    // 初始化应用
    async init() {
        try {
            // 检查环境
            if (!this.checkEnvironment()) return;

            // 初始化主题
            await BusinessUtils.ThemeManager.init();
            
            // 绑定全局事件
            this.bindGlobalEvents();
            
            // 初始化模块
            await this.initModules();
            
            // 设置初始焦点
            const searchInput = document.getElementById('search-input');
            if (searchInput) setTimeout(() => searchInput.focus(), 100);

            this.isInitialized = true;
            logger.info('TodoList App initialized successfully');
        } catch (error) {
            logger.error(`Failed to initialize app: ${error}`);
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
        } finally {
            // 隐藏加载状态
            Utils.setLoading(false);
            
            // 隐藏骨架屏
            const skeletonScreen = document.getElementById('skeleton-screen');
            if (skeletonScreen) skeletonScreen.style.display = 'none';
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
            logger.error('Missing required elements:', missingElements);
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            return false;
        }
        
        return true;
    }
    
    // 绑定全局事件
    bindGlobalEvents() {
        // 设置中心按钮
        const settingsBtn = document.getElementById('settings-btn');
        settingsBtn?.addEventListener('click', () => window.settingsManager?.openModal());

        // 移动端菜单按钮
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        mobileMenuBtn?.addEventListener('click', () => this.toggleMobileSidebar());

        // 遮罩层点击关闭侧边栏
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        sidebarOverlay?.addEventListener('click', () => this.closeMobileSidebar());

        // 窗口大小变化：立即处理保证蒙版及时关闭，同时防抖执行后续逻辑
        this.debouncedResize = Utils.debounce(() => this.handleResize(), 250);
        window.addEventListener('resize', () => {
            this.handleResize();
            this.debouncedResize();
        });

        // 监听断点变化，窗口拉大后自动关闭小屏蒙版
        this.bindBreakpointListeners();
        
        // 页面可见性变化
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        // 联系作者按钮事件
        const contactAuthorBtn = document.getElementById('contact-author-btn');
        contactAuthorBtn?.addEventListener('click', () => this.showContactAuthorModal());

        // 小屏幕更多菜单按钮事件
        const moreMenuBtn = document.getElementById('more-menu-btn');
        const moreMenuModal = document.getElementById('more-menu-modal');
        const moreMenuClose = document.getElementById('more-menu-close');
        
        moreMenuBtn?.addEventListener('click', () => this.showMoreMenu());

        // 点击遮罩层关闭
        moreMenuModal?.addEventListener('click', (e) => {
            if (e.target === moreMenuModal) this.hideMoreMenu();
        });

        moreMenuClose?.addEventListener('click', () => this.hideMoreMenu());

        // 更多菜单项点击事件
        const moreMenuLinks = document.querySelectorAll('.more-menu-link');
        moreMenuLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const action = link.dataset.action;
                await this.handleMoreMenuAction(e, action, link.dataset.view);
                this.hideMoreMenu();
            });
        });
        
        // 二维码弹窗关闭事件
        const qrCodeCloseBtn = document.getElementById('qr-code-close');
        const qrCodeModal = document.getElementById('qr-code-modal');
        qrCodeCloseBtn?.addEventListener('click', () => this.hideContactAuthorModal());

        // 点击遮罩层关闭
        qrCodeModal?.addEventListener('click', (e) => {
            if (e.target === qrCodeModal) this.hideContactAuthorModal();
        });

        // 站外链接点击跳转事件
        const externalLinks = document.querySelectorAll('.external-link');
        externalLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault(); // 阻止链接在 WebView 内打开
                var url = e.target.href;
                // 调用 Python 后端的 open_in_browser 方法
                Utils.apiCall({
                    apiMethod: 'open_in_browser',
                    apiArgs: [url],
                    successCheck: (response) => true
                });
            });
        })

        // 错误处理
        window.addEventListener('error', (e) => {
            logger.error('Global error:', e.error);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            logger.error('Unhandled promise rejection:', e.reason);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
    }
    
    // 处理窗口大小变化
    handleResize() {
        // 如果是移动设备，可能需要调整布局
        if (window.innerWidth < 768) {
            document.body.classList.add('mobile');
            // 更多菜单按钮仅在 <=480px 展示，超出后蒙版需同步关闭
            if (window.innerWidth > 480) this.hideMoreMenu();
        } else {
            document.body.classList.remove('mobile');
            // 拉升为大屏时，自动关闭小屏更多菜单蒙版与侧边栏蒙版
            this.hideMoreMenu();
            this.closeMobileSidebar();
        }
    }

    // 监听媒体查询断点变化，离开小屏时自动关闭蒙版
    bindBreakpointListeners() {
        const breakpoints = [
            // 更多菜单按钮的展示断点（见 media.css max-width: 480px）
            {
                query: '(max-width: 480px)',
                onChange: (matches) => {
                    if (!matches) this.hideMoreMenu();
                }
            },
            // 侧边栏/移动端布局断点
            {
                query: '(max-width: 768px)',
                onChange: (matches) => {
                    if (!matches) {
                        this.hideMoreMenu();
                        this.closeMobileSidebar();
                    }
                }
            }
        ];

        breakpoints.forEach(({ query, onChange }) => {
            const mediaQueryList = window.matchMedia(query);
            const handler = (event) => onChange(event.matches);
            if (typeof mediaQueryList.addEventListener === 'function') {
                mediaQueryList.addEventListener('change', handler);
            } else if (typeof mediaQueryList.addListener === 'function') {
                mediaQueryList.addListener(handler); // 兼容旧版浏览器内核
            }
        });
    }
    
    // 处理页面可见性变化
    handleVisibilityChange() {
        if (!document.hidden && this.isInitialized) this.refreshData(); // 页面显示时刷新数据
    }
    
    // 初始化模块
    async initModules() {
        const modules = [
            { name: 'CategoryManager', instance: window.categoryManager },
            { name: 'TodoManager', instance: window.todoManager },
            { name: 'CalendarManager', instance: window.calendarManager },
            { name: 'TimelineManager', instance: window.timelineManager },
            { name: 'StatsManager', instance: window.statsManager }
        ];

        // 先等待 pywebview 加载完成
        const isLoaded = await Utils.loadPywebviewApi();

        if (!isLoaded) {
           Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
           throw new Error('pywebview加载失败！');
        }
        
        for (const module of modules) {
            try {
                if (module.instance) {
                    await module.instance.init();
                    this.modules.push(module);
                }
            } catch (error) {
                logger.error(`Failed to initialize ${module.name}:`, error);
                Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
            }
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
        } catch (error) {
            logger.error('Failed to refresh data:', error);
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
                // 清空搜索标签 chips 并同步左侧标签选中态
                if (window.todoManager) {
                    window.todoManager.searchChips = [];
                    window.todoManager.renderSearchChips();
                    window.todoManager.refreshTagModuleSelection();
                }

                // 重置筛选器
                const priorityFilter = document.getElementById('priority-filter');
                const statusFilter = document.getElementById('status-filter');
                if (priorityFilter) priorityFilter.value = 'all';
                if (statusFilter) statusFilter.value = 'all';
            }
            
            // 重置分类选择
            window.categoryManager?.filterByCategory('all');

            // 刷新数据
            this.refreshData();
            
            Utils.showToast(window.languageManager.getText('resetStateSuccess', '应用状态已重置'), 'success');
            
        } catch (error) {
            logger.error('Failed to reset app:', error);
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
    
    // 显示联系作者弹窗
    showContactAuthorModal() {
        const modal = document.getElementById('qr-code-modal');
        if (modal) {
            modal.classList.add('show');
            // 防止背景滚动
            document.body.style.overflow = 'hidden';
        }
    }
    
    // 隐藏联系作者弹窗
    hideContactAuthorModal() {
        const modal = document.getElementById('qr-code-modal');
        if (modal) {
            modal.classList.remove('show');
            // 恢复背景滚动
            document.body.style.overflow = '';
        }
    }
    
    // 显示更多菜单
    showMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            modal.classList.add('show');
            // 防止背景滚动
            document.body.style.overflow = 'hidden';
        }
    }
    
    // 隐藏更多菜单
    hideMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            modal.classList.remove('show');
            // 恢复背景滚动（若仍有其他弹窗打开则保持锁定）
            this.restoreBodyOverflow();
        }
    }

    // 在没有其他弹窗/蒙版打开时恢复背景滚动
    restoreBodyOverflow() {
        const stillOpen = document.querySelector(
            '.modal.show, #qr-code-modal.show, #more-menu-modal.show'
        );
        if (!stillOpen) document.body.style.overflow = '';
    }
    
    // 处理更多菜单动作
    async handleMoreMenuAction(event, action, view) {
        switch (action) {
            case 'switch-view':
                await this.switchView(view);
                break;
            case 'calendar-view':
                // 兼容旧的“切换日历视图”动作
                await this.switchView('calendar');
                break;
            case 'filter-uncompleted':
                await this.filterTasks('uncompleted', 'all', '', '已筛选未完成任务');
                break;
            case 'filter-overdue':
                await this.filterTasks('overdue', 'all', '', '已筛选已逾期任务');
                break;
            case 'filter-all':
                await this.filterTasks('all', 'all', '', '已显示所有任务');
                break;
            case 'filter-today':
                await this.filterTasks('all', 'today', '', '已筛选今天任务');
                break;
            case 'filter-tag':
                await this.filterTasks('all', 'all', '#', '已筛选含标签任务');
                break;
            case 'filter-prev-month':
                if (window.calendarManager) window.calendarManager.previousMonth();
                break;
            case 'filter-next-month':
                if (window.calendarManager) window.calendarManager.nextMonth();
                break;
            default:
                logger.warn(`Unknown action: ${action}`);
        }
    }
    
    // 切换视图（小屏更多菜单、顶部下拉框共用）
    async switchView(viewName) {
        if (window.calendarManager) {
            await window.calendarManager.switchView(viewName);
            Utils.showToast(window.languageManager?.getText('viewSwitched', '视图已切换'), 'success');
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    // 切换视图（事件入口，兼容旧调用）
    async toggleView(event) {
        if (window.calendarManager) {
            await window.calendarManager.toggleView(event);
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    //  筛选任务
    async filterTasks(statusValue, dueDateValue, tagValue, toastMsg) {
        if (window.todoManager) {
            // 快捷筛选会重置搜索标签 chips，避免残留 chip 与新筛选条件冲突
            if (window.todoManager) {
                window.todoManager.searchChips = [];
                window.todoManager.renderSearchChips();
                window.todoManager.refreshTagModuleSelection();
            }

            window.todoManager.statusFilter = statusValue;
            window.todoManager.dueDateFilter = dueDateValue;
            window.todoManager.searchQuery = tagValue;
            window.todoManager.priorityFilter = 'all';
            window.todoManager.currentPage = 1;
            window.todoManager.customDateFilter = null; // 清除自定义日期筛选
            window.todoManager.resetInfiniteScroll(); // 重置无限下拉状态
            await window.todoManager.loadTasks();

            // 触发筛选更新
            Utils.showToast(toastMsg, 'success');

            // 刷新UI
            const statusFilter = document.getElementById('status-filter');
            const dueDateFilter = document.getElementById('due-date-filter');
            const searchInput = document.getElementById('search-input');
            if (statusFilter) statusFilter.value = statusValue;
            if (dueDateFilter) dueDateFilter.value = dueDateValue;
            if (searchInput) searchInput.value = tagValue;
        }
    }
}

// 创建应用实例
const app = new App();

// 页面加载完成后初始化应用：延迟初始化，确保所有资源加载完成
document.addEventListener('DOMContentLoaded', () => setTimeout((() => app.init()), 100));

// 导出到全局
window.App = app;
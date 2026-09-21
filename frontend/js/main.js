// 启动完成后这段时间内，忽略"窗口可见"触发的全量刷新：
// 窗口首次显示时 document.hidden 会由 true 变 false 并触发可见性回调，
// 但此刻数据刚由初始化流程取完，再刷一遍只会让列表重播入场动画（表现为启动闪一下）
const VISIBILITY_REFRESH_GRACE_MS = 2000;

class App {
    constructor() {
        this.isInitialized = false;
        // 初始化完成时刻，用于在可见性回调里识别"刚启动就触发"的那一次
        this._initializedAt = 0;
        this.modules = [];
    }
    
    async init() {
        try {
            if (!this.checkEnvironment()) return;

            await BusinessUtils.ThemeManager.init();
            
            this.bindGlobalEvents();
            
            await this.initModules();
            
            const searchInput = document.getElementById('search-input');
            if (searchInput) setTimeout(() => searchInput.focus(), 100);

            this.isInitialized = true;
            this._initializedAt = Date.now();
            logger.info('TodoList App initialized successfully');
        } catch (error) {
            logger.error(`Failed to initialize app: ${error}`);
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
        } finally {
            Utils.setLoading(false);
            
            const skeletonScreen = document.getElementById('skeleton-screen');
            if (skeletonScreen) skeletonScreen.style.display = 'none';
        }
    }
    
    checkEnvironment() {
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
    
    bindGlobalEvents() {
        // 设置中心按钮的点击事件由 settings/settings.js 的 bindEvents 自行绑定，此处不再重复绑定

        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        mobileMenuBtn?.addEventListener('click', () => this.toggleMobileSidebar());

        const sidebarOverlay = document.getElementById('sidebar-overlay');
        sidebarOverlay?.addEventListener('click', () => this.closeMobileSidebar());

        // 窗口大小变化：立即处理保证蒙版及时关闭，同时防抖执行后续逻辑
        this.debouncedResize = Utils.debounce(() => this.handleResize(), 250);
        window.addEventListener('resize', () => {
            this.handleResize();
            this.debouncedResize();
        });

        this.bindBreakpointListeners();
        
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        const contactAuthorBtn = document.getElementById('contact-author-btn');
        contactAuthorBtn?.addEventListener('click', () => this.showContactAuthorModal());

        const moreMenuBtn = document.getElementById('more-menu-btn');
        const moreMenuModal = document.getElementById('more-menu-modal');
        const moreMenuClose = document.getElementById('more-menu-close');
        
        moreMenuBtn?.addEventListener('click', () => this.showMoreMenu());

        // 按下与抬起都发生在遮罩层才算点击，避免拖选文本导致误关闭
        Utils.bindBackdropClose(moreMenuModal, () => this.hideMoreMenu());

        moreMenuClose?.addEventListener('click', () => this.hideMoreMenu());

        const moreMenuLinks = document.querySelectorAll('.more-menu-link');
        moreMenuLinks.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const action = link.dataset.action;
                await this.handleMoreMenuAction(e, action, link.dataset.view);
                this.hideMoreMenu();
            });
        });
        
        const qrCodeCloseBtn = document.getElementById('qr-code-close');
        const qrCodeModal = document.getElementById('qr-code-modal');
        qrCodeCloseBtn?.addEventListener('click', () => this.hideContactAuthorModal());

        Utils.bindBackdropClose(qrCodeModal, () => this.hideContactAuthorModal());

        const externalLinks = document.querySelectorAll('.external-link');
        externalLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault(); // 阻止链接在 WebView 内打开
                var url = e.target.href;
                Utils.apiCall({
                    apiMethod: 'open_in_browser',
                    apiArgs: [url],
                    successCheck: (response) => true
                });
            });
        })

        window.addEventListener('error', (e) => {
            logger.error('Global error:', e.error);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            logger.error('Unhandled promise rejection:', e.reason);
            Utils.showToast(window.languageManager.getText('unknownErrorOccurred', '发生了未知错误'), 'error');
        });
    }
    
    handleResize() {
        if (window.innerWidth < 768) {
            document.body.classList.add('mobile');
            // 更多菜单按钮仅在 <=480px 展示，超出后蒙版需同步关闭
            if (window.innerWidth > 480) this.hideMoreMenu();
        } else {
            document.body.classList.remove('mobile');
            this.hideMoreMenu();
            this.closeMobileSidebar();
        }
    }

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
    
    handleVisibilityChange() {
        if (document.hidden || !this.isInitialized) return;
        // 只忽略启动瞬间这一次，之后用户切回窗口仍照常刷新
        if (Date.now() - this._initializedAt < VISIBILITY_REFRESH_GRACE_MS) {
            logger.debug('忽略启动瞬间的可见性刷新：数据已是最新');
            return;
        }
        this.refreshData();
    }
    
    async initModules() {
        const modules = [
            { name: 'ViewManager', instance: window.viewManager },
            { name: 'ViewFilter', instance: window.viewFilter },
            { name: 'CategoryManager', instance: window.categoryManager },
            { name: 'TodoManager', instance: window.todoManager },
            { name: 'CalendarManager', instance: window.calendarManager },
            { name: 'TimelineManager', instance: window.timelineManager },
            { name: 'StatsManager', instance: window.statsManager }
        ];

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
    
    async refreshData() {
        try {
            Utils.setLoading(true, '刷新数据...');
            
            // 并行刷新各模块的常驻基础数据，不包含视图取数。
            const refreshPromises = this.modules.map(module => {
                if (module.instance && typeof module.instance.refresh === 'function') {
                    return module.instance.refresh();
                }
                return Promise.resolve();
            });
            
            await Promise.all(refreshPromises);

            // 各模块的 refresh() 只管基础数据，前台视图与常驻计数由这次通知补上
            this.notifyDataChanged();
        } catch (error) {
            logger.error('Failed to refresh data:', error);
            Utils.showToast(window.languageManager.getText('refreshDataFailed', '刷新数据失败'), 'error');
        } finally {
            Utils.setLoading(false);
        }
    }
    
    // 本地数据被整体替换后（切换存储目录 / 导入导出数据）原地热重载，
    // 取代 location.reload，避免 WebView 重建页面导致的整体白闪
    async reloadAfterDataReplaced() {
        const todo = window.todoManager;

        // 1. 清理内存中与旧库相关的数据，避免旧筛选条件/旧搜索 chip 命中不存在的数据
        if (todo) {
            window.viewFilter.clearDataScopedFilters();
            todo.resetForNewResult();
            todo.tagManager?.clearPending?.();
        }

        // 2. 重建分类列表（上一步已把分类切回"全部"）
        if (window.categoryManager) {
            await window.categoryManager.refresh();
        }

        // 3. 列配置与标签均落在数据库中，需按新库重新读取
        if (todo) {
            await todo.loadColumnConfig();
            await todo.tagManager?.loadModule(true);
        }

        // 4. 前台视图（含列表）与常驻数据一并重建。
        this.notifyDataChanged({ fromZero: true });
    }

    // 数据发生变更（增删改、完成状态切换、分类变更、切库/导入、页面重新可见）后统一通知。
    notifyDataChanged({ fromZero = false, skipList = false } = {}) {
        // 常驻元素（分类计数 / 顶部统计条）：数据变更即刷新，不随视图走
        window.categoryManager?.refreshCounts(fromZero);
        window.statsManager?.refreshOverviewBar(fromZero);
        // 前台视图的一次重建交给路由按当前视图挑入口
        window.refreshRouter?.refreshIfVisible({ skipList });
    }

    getAppState() {
        return {
            isInitialized: this.isInitialized,
            modules: this.modules.map(m => m.name),
            theme: document.documentElement.getAttribute('data-theme') || 'light',
            timestamp: new Date().toISOString()
        };
    }
    
    async reset() {
        try {
            // 条件与控件都归 ViewFilter 管，这里不再逐项改字段
            window.viewFilter.resetFilters();
            
            window.categoryManager?.filterByCategory('all');

            this.refreshData();
            
            Utils.showToast(window.languageManager.getText('resetStateSuccess', '应用状态已重置'), 'success');
            
        } catch (error) {
            logger.error('Failed to reset app:', error);
            Utils.showToast(window.languageManager.getText('resetStateFailed', '重置失败'), 'error');
        }
    }
    
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
    
    closeMobileSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
        }
    }
    
    showContactAuthorModal() {
        const modal = document.getElementById('qr-code-modal');
        if (modal) {
            modal.classList.remove('is-closing');
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }
    
    hideContactAuthorModal() {
        const modal = document.getElementById('qr-code-modal');
        if (modal) {
            Utils.closeModalWithAnimation(modal, () => {
                modal.classList.remove('show');
                document.body.style.overflow = '';
            });
        }
    }
    
    showMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            modal.classList.remove('is-closing');
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }
    
    hideMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            Utils.closeModalWithAnimation(modal, () => {
                modal.classList.remove('show');
                this.restoreBodyOverflow();
            });
        }
    }

    // 没有其他弹窗/蒙版打开时才恢复背景滚动
    restoreBodyOverflow() {
        const stillOpen = document.querySelector(
            '.modal.show, #qr-code-modal.show, #more-menu-modal.show'
        );
        if (!stillOpen) document.body.style.overflow = '';
    }
    
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
    
    // 实际切换由 ViewManager 执行，这里只保留门面与提示
    async switchView(viewName) {
        if (window.viewManager) {
            await window.viewManager.switchView(viewName);
            Utils.showToast(window.languageManager?.getText('viewSwitched', '视图已切换'), 'success');
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    // 兼容旧调用
    async toggleView(event) {
        if (window.viewManager) {
            await window.viewManager.toggleView(event);
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    // 条件改写与控件回写都归 ViewFilter，这里只做命令分发与结果提示
    async filterTasks(statusValue, dueDateValue, tagValue, toastMsg) {
        await window.viewFilter.applyQuickFilter({
            status: statusValue,
            dueDateFilter: dueDateValue,
            tag: tagValue
        });
        Utils.showToast(toastMsg, 'success');
    }
}

const app = new App();

// 延迟一拍初始化，确保所有资源加载完成
document.addEventListener('DOMContentLoaded', () => setTimeout((() => app.init()), 100));

window.App = app;

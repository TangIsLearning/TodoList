// 启动完成后这段时间内，忽略"窗口可见"触发的全量刷新：
// 窗口首次显示时 document.hidden 会由 true 变 false 并触发可见性回调，
// 但此刻数据刚由初始化流程取完，再刷一遍只会让列表重播入场动画（表现为启动闪一下）
const VISIBILITY_REFRESH_GRACE_MS = 2000;

// 主应用程序入口

class App {
    constructor() {
        this.isInitialized = false;
        // 初始化完成时刻，用于在可见性回调里识别"刚启动就触发"的那一次
        this._initializedAt = 0;
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
            this._initializedAt = Date.now();
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
        // 设置中心按钮的点击事件由 settings/settings.js 的 bindEvents 自行绑定，此处不再重复绑定

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

        // 点击遮罩层关闭（按下与抬起都发生在遮罩层才算点击，避免拖选文本导致误关闭）
        Utils.bindBackdropClose(moreMenuModal, () => this.hideMoreMenu());

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
        Utils.bindBackdropClose(qrCodeModal, () => this.hideContactAuthorModal());

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
        if (document.hidden || !this.isInitialized) return;
        // 窗口首次显示时 document.hidden 会由 true 变 false 并触发本回调，但此刻数据
        // 刚由初始化流程取完，再全量刷新一次只会让列表重播一遍入场动画（表现为启动闪一下）。
        // 只忽略启动瞬间这一次，之后用户切换窗口回来仍照常刷新。
        if (Date.now() - this._initializedAt < VISIBILITY_REFRESH_GRACE_MS) {
            logger.debug('忽略启动瞬间的可见性刷新：数据已是最新');
            return;
        }
        this.refreshData(); // 页面显示时刷新数据
    }
    
    // 初始化模块
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
            
            // 并行刷新各模块的常驻基础数据，不包含视图取数。
            const refreshPromises = this.modules.map(module => {
                if (module.instance && typeof module.instance.refresh === 'function') {
                    return module.instance.refresh();
                }
                return Promise.resolve();
            });
            
            await Promise.all(refreshPromises);

            // 常驻数据（左侧分类计数 / 顶部统计条）不随视图切换重建，这里单独刷新
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

        // 2. 分类列表重新拉取并回到"全部"
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
        // 左侧分类计数：口径固定为全局未完成任务数，与当前视图/筛选无关，数据变更即重取。
        // 分类模块只重建列表项（categoryManager.refresh），取数一律收敛在这里，
        // 避免同一轮刷新里取两遍。
        window.categoryManager?.refreshCounts(fromZero);
        // 顶部统计条数据刷新
        window.statsManager?.refreshOverviewBar(fromZero);
        // 前台视图的一次重建交由刷新路由统一下发：由路由按当前视图挑对应的重建入口。
        window.refreshRouter?.refreshIfVisible({ skipList });
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
            // 重置筛选器：条件与全局筛选栏控件都归 ViewFilter，这里不再逐项改字段
            window.viewFilter.resetFilters();
            
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
            modal.classList.remove('is-closing');
            modal.classList.add('show');
            // 防止背景滚动
            document.body.style.overflow = 'hidden';
        }
    }
    
    // 隐藏联系作者弹窗
    hideContactAuthorModal() {
        const modal = document.getElementById('qr-code-modal');
        if (modal) {
            // 先播放退场动画，动画结束后再真正隐藏
            Utils.closeModalWithAnimation(modal, () => {
                modal.classList.remove('show');
                // 恢复背景滚动
                document.body.style.overflow = '';
            });
        }
    }
    
    // 显示更多菜单
    showMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            modal.classList.remove('is-closing');
            modal.classList.add('show');
            // 防止背景滚动
            document.body.style.overflow = 'hidden';
        }
    }
    
    // 隐藏更多菜单
    hideMoreMenu() {
        const modal = document.getElementById('more-menu-modal');
        if (modal) {
            // 先播放退场动画，动画结束后再真正隐藏
            Utils.closeModalWithAnimation(modal, () => {
                modal.classList.remove('show');
                // 恢复背景滚动（若仍有其他弹窗打开则保持锁定）
                this.restoreBodyOverflow();
            });
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
    // 实际切换由 ViewManager 执行，这里只保留 App 门面与提示
    async switchView(viewName) {
        if (window.viewManager) {
            await window.viewManager.switchView(viewName);
            Utils.showToast(window.languageManager?.getText('viewSwitched', '视图已切换'), 'success');
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    // 切换视图（事件入口，兼容旧调用）
    async toggleView(event) {
        if (window.viewManager) {
            await window.viewManager.toggleView(event);
        } else {
            Utils.showToast('切换视图不可用', 'error');
        }
    }

    //  筛选任务（顶部快捷筛选：状态 / 日期 / 标签）
    //  条件改写、结构化查询构建、控件回写都是共享筛选条件自身的事，归 ViewFilter；
    //  这里只做命令分发与结果提示
    async filterTasks(statusValue, dueDateValue, tagValue, toastMsg) {
        await window.viewFilter.applyQuickFilter({
            status: statusValue,
            dueDateFilter: dueDateValue,
            tag: tagValue
        });
        Utils.showToast(toastMsg, 'success');
    }
}

// 创建应用实例
const app = new App();

// 页面加载完成后初始化应用：延迟初始化，确保所有资源加载完成
document.addEventListener('DOMContentLoaded', () => setTimeout((() => app.init()), 100));

// 导出到全局
window.App = app;
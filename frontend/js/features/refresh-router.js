// 刷新路由：登记"各视图在前台时如何重建内容"，由数据/筛选变更统一分发。
// 调用方只声明"数据变了"即可——此前每处通知都手工列举一遍视图，既不完整也不一致
//（漏过统计视图，切库后也漏过日历）。
//
// 边界：
// - revealTask 需同步拿到取数结果，走不了"广播—分发"这条异步链，故自己取数并用 skipList
//   声明路由这次别取；除此之外都不该再显式调 loadTasks。
// - 首次进入视图的取数归 ViewManager.switchView，路由只管"数据变了且视图已在前台"。
// - 常驻元素（分类计数 / 顶部统计条）在所有视图下都可见，登记反而会退化成"只在对应视图
//   前台时才刷"（顶部统计条曾因此在列表视图下完全不更新）。

class RefreshRouter {
    constructor() {
        // handler 只负责取数并重绘，不判断自己是否在前台
        this._handlers = new Map();
    }

    // 同一视图重复登记以最后一次为准
    register(viewName, handler) {
        if (!viewName || typeof handler !== 'function') return;
        this._handlers.set(viewName, handler);
    }

    // 只分发给前台视图；不在前台的不预取，下次 switchView 进入时会自行取数
    async refreshIfVisible({ skipList = false } = {}) {
        const view = window.viewManager?.currentView;
        if (!view) return;
        if (skipList && view === 'list') return;
        const handler = this._handlers.get(view);
        if (!handler) return;
        await handler();
    }
}

window.refreshRouter = new RefreshRouter();

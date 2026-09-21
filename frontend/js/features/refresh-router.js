// 刷新路由：登记"各视图在前台时如何重建内容"，由数据/筛选变更统一分发。
//
// 这段取舍此前散落在 App.notifyDataChanged / notifyFilterChanged / reloadAfterDataReplaced
// 三处，每处都要手工列举一遍可能需要刷新的视图。列举既不完整也不一致：
// - 切库/导入后只重建了时间轴，日历与统计留在后台不重建，要等下次进视图才更新；
// - 数据变更（完成任务、增删改）的广播里漏了统计视图面板，只重算了顶部统计条；
// - 新增视图时要在三处同时补，漏一处就只在部分路径下生效。
//
// 收敛后，调用方只需声明"数据变了"或"筛选变了"，不必知道有哪几个视图、谁在前台。
//
// 三条边界：
// - 列表同样登记在内。唯一例外是 revealTask 拿到任务 id 的那一段（快捷键/智能输入新建
//   任务后要判断任务是否落在当前筛选内、必要时跳到所在页并高亮），它必须同步拿到取数
//   结果才能继续，走不了"广播—分发"这条异步链。这类调用方自己取数，并用
//   notifyDataChanged({ skipList: true }) 声明路由这次不必再取，两者不重叠。
//   除此之外的数据变更路径都不该再显式调 loadTasks。
// - 视图首次进入时的取数仍由 ViewManager.switchView 负责，与本路由不重叠：
//   路由只处理"数据/筛选变了，而视图已经在前台"这一种情况。
// - 常驻元素（左侧分类计数 / 顶部统计条）不登记在这里。它们在所有视图下都可见，数据
//   变更时一律要更新，登记进来会退化成"只在对应视图前台时才刷"——顶部统计条曾因此
//   在列表视图下完全不更新。这类由 notifyDataChanged 直接点名。

class RefreshRouter {
    constructor() {
        // 视图名 -> 重建函数。handler 只负责取数并重绘，不判断自己是否在前台
        this._handlers = new Map();
    }

    // 登记视图的重建入口，同一视图重复登记以最后一次为准
    register(viewName, handler) {
        if (!viewName || typeof handler !== 'function') return;
        this._handlers.set(viewName, handler);
    }

    // 只对当前前台视图分发。不在前台的视图不预取：下次 switchView 进入时会自行取数。
    // 刻意做成 async，便于调用方在内容到达后再执行后续动作。
    //
    // skipList 供要自己同步取列表的调用方（见文件头）声明"路由这次别取"，避免重复。
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

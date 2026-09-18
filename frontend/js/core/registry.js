/**
 * 应用命名空间与模块注册表
 *
 * 背景与约束：
 *   本项目前端由 pywebview 通过 window.load_url(frontend_path) 直接加载（见 backend/start.py），
 *   页面运行在 file:// 协议下，浏览器会以 CORS 策略拦截 ES Module（Origin 'null'），
 *   因此无法使用 import/export 做模块化。此处用轻量注册表达成模块化的核心目标：
 *     1. 单一命名空间 TodoApp，收敛原本散落在 window 上的全局变量；
 *     2. 模块显式声明它依赖的其它模块 / 全局契约；
 *     3. 启动时统一校验，把"加载顺序错了才在运行时静默崩溃"变成"启动时明确报错"。
 *
 * 兼容性说明：
 *   backend/start.py 的 evaluate_js 依赖 window.todoManager / window.categoryManager 等全局名，
 *   因此各模块注册后仍需保留 window.xxx 别名，本注册表不做强制隔离。
 */
(function (global) {
    'use strict';

    const TodoApp = {
        version: '0.1.0',
        /** 基础能力层：api / dom / date 等 */
        core: {},
        /** 业务模块：todo / category / tag ... */
        features: {},
        /** 注册元信息：name -> { name, category, requires, registeredAt } */
        _meta: {}
    };

    /**
     * 按点号路径读取命名空间内的值
     * @param {string} path 形如 'core.api' / 'features.todo'
     */
    function getByPath(path) {
        if (!path) return undefined;
        return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), TodoApp);
    }

    /**
     * 解析一个依赖名：先查 TodoApp 命名空间，再回退到 window 全局契约
     * @param {string} name 'core.api' | 'features.todo' | 'Utils' | 'languageManager'
     */
    function resolve(name) {
        if (!name) return undefined;
        const inNamespace = getByPath(name);
        if (inNamespace !== undefined) return inNamespace;

        // 兼容直接写分类名的场景，如 requires: ['features.tag']
        const keys = String(name).split('.');
        if (keys.length > 1) {
            const byCategory = getByPath(keys.slice(1).join('.'));
            if (byCategory !== undefined) return byCategory;
        }
        return global[name];
    }

    /**
     * 注册模块
     * @param {Object} options
     * @param {string} options.name 模块名，如 'todo'
     * @param {*} options.instance 模块实例（类实例或对象）
     * @param {string} [options.category] 'core' | 'features'，默认 'features'
     * @param {string[]} [options.requires] 依赖名列表，元素为命名空间路径或 window 上的全局名
     * @param {boolean} [options.exposeGlobal] 是否同时挂到 window[name]，默认 false
     */
    function register(options) {
        const opts = options || {};
        const name = opts.name;
        if (!name) throw new Error('[TodoApp] register 缺少模块名');

        const category = opts.category || 'features';
        const bucket = TodoApp[category];
        if (!bucket) throw new Error(`[TodoApp] 未知的模块分类: ${category}`);

        bucket[name] = opts.instance;
        TodoApp._meta[name] = {
            name: name,
            category: category,
            requires: opts.requires || [],
            registeredAt: new Date()
        };

        if (opts.exposeGlobal) global[name] = opts.instance;
        return opts.instance;
    }

    /**
     * 取已注册模块（不回退 window）
     * @param {string} path 形如 'features.todo'，也可直接写 'todo'
     */
    function get(path) {
        const direct = getByPath(path);
        if (direct !== undefined) return direct;
        return getByPath(`features.${path}`) || getByPath(`core.${path}`);
    }

    /**
     * 校验所有已注册模块的依赖是否满足
     * @returns {{ok: boolean, missing: Array<{module: string, requires: string[]}>}}
     */
    function verify() {
        const missing = [];
        Object.keys(TodoApp._meta).forEach((name) => {
            const meta = TodoApp._meta[name];
            const unmet = meta.requires.filter((dep) => resolve(dep) === undefined || resolve(dep) === null);
            if (unmet.length > 0) missing.push({ module: name, requires: unmet });
        });
        return { ok: missing.length === 0, missing: missing };
    }

    /**
     * 校验并在不满足时抛出可读错误（供启动阶段使用）
     */
    function verifyOrThrow() {
        const result = verify();
        if (result.ok) return true;
        const detail = result.missing
            .map((item) => `  - ${item.module} 缺少依赖: ${item.requires.join(', ')}`)
            .join('\n');
        throw new Error(`[TodoApp] 模块依赖校验失败：\n${detail}`);
    }

    /**
     * 校验一组全局契约是否存在（用于模块初始化前的快速自检）
     * @param {string[]} names window 上的全局名
     */
    function requireGlobals(names) {
        const missing = (names || []).filter((name) => global[name] === undefined || global[name] === null);
        if (missing.length > 0) {
            throw new Error(`[TodoApp] 缺少必需的全局依赖: ${missing.join(', ')}`);
        }
        return true;
    }

    TodoApp.register = register;
    TodoApp.get = get;
    TodoApp.resolve = resolve;
    TodoApp.verify = verify;
    TodoApp.verifyOrThrow = verifyOrThrow;
    TodoApp.requireGlobals = requireGlobals;

    global.TodoApp = TodoApp;
})(window);

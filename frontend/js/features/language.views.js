/**
 * 语言管理器 - 各业务界面的 DOM 文案刷新（mixin）
 * 依赖：language.js（LanguageManager 类）
 *
 * 说明：静态文案统一由 HTML 上的 data-i18n 标注 + language.js 的 applyStaticTranslations 刷新，
 * 本文件只保留无法静态标注的部分（JS 动态渲染、按运行时状态拼接的文案）。
 * 迁移进度：设置中心（含主题配色 / 数据传输 / 数据同步）、模态框、主界面骨架（侧边栏 / 顶部栏 /
 * 空状态 / 分页选项与按钮 / 时间轴与统计视图工具栏）、筛选器与小屏更多菜单、日历星期表头、
 * 日期选择器 i18n 已完成迁移。
 * 仍留在 JS 的均为动态渲染或按运行时状态拼接的内容（任务列表、搜索 chips、分页数值等）。
 */

Object.assign(LanguageManager.prototype, {

    // 更新页面标题
    updatePageTitle(lang) {
        document.title = lang.appTitle;
    },

    // 更新主界面文本
    updateMainInterface(lang) {
        // 重建搜索 chips：截止时间 chip 的"截止/Due"前缀需要跟随语言
        if (window.todoManager?.searchChips?.length > 0) {
            window.todoManager.renderSearchChips();
        }

        // 搜索清空按钮提示会随当前可分层的搜索条件变化，交回搜索模块按当前语言重算
        if (window.todoManager?.updateSearchClearButton) {
            window.todoManager.updateSearchClearButton();
        }

        // 任务列表由 JS 渲染（表头列名、优先级徽章、操作按钮提示都在渲染时按当前语言生成），
        // 切换语言后必须重渲染一次，否则已渲染的列表仍是旧语言。
        // 用 renderTasks 而非 loadTasks：只是换个语言，不需要重新请求数据
        window.todoManager?.renderTasks?.();

        // 分页信息（"显示 x-y 共 z 条"）的数值来自当前分页状态，交回分页模块按新语言重算
        this.updatePagination();

        // 标签末尾的展开更多/更少标识跟随语言刷新
        window.tagManager?.renderMoreIndicator();
    },

    // 更新分页文本
    // 每页条数选项已静态标注；这里只需让分页模块按当前状态重算"显示 x-y 共 z 条"。
    // 不能从 DOM 文本反推数值：不同语言的语序与单位不同，正则会解析失败或取错数字。
    updatePagination() {
        window.todoManager?.renderPagination?.();
    },

    // 更新模态框文本
    updateModals(lang) {
        // 任务模态框标题：新建 / 编辑 / 复制 由打开弹窗时按模式写入，
        // 切语言时委托任务模块按当前模式重设，避免用标题文本反推模式（英文下"编辑"匹配不到）
        window.todoManager?.refreshTaskModalTitle?.();

        // 分类模态框标题：新建 / 编辑由表单上的 editingId 决定
        const categoryModalTitle = document.getElementById('category-modal-title');
        const categoryForm = document.getElementById('category-form');
        if (categoryModalTitle && categoryForm) {
            categoryModalTitle.textContent = categoryForm.dataset.editingId
                ? lang.editCategory
                : lang.newCategory;
        }

        // 确认对话框标题：调用方传入了自定义标题时不覆盖，仅默认标题跟随语言
        const confirmTitle = document.querySelector('#confirm-dialog h2');
        if (confirmTitle?.dataset.i18nKey === 'confirm') {
            confirmTitle.textContent = lang.confirm;
        }
    },

    // 更新设置中心设置
    updateSettings() {
        // 主题配色令牌名称与入口行模式文案由 JS 动态渲染，
        // settingsManager 已初始化时委托其按新语言重建（未初始化时跳过，打开弹窗时会重建）
        window.settingsManager?.renderThemeColorRows?.();
        window.settingsManager?.syncThemeEditorState?.();
    },

    // 更新日期选择器
    // 月份 / 星期名称整份放在语言包里，新增语言时无需改动这里
    updateDatePicker(lang) {
        const pikaday = window.todoManager?.pikaday;
        if (!pikaday) return;

        const fallback = {
            previousMonth: '上个月',
            nextMonth: '下个月',
            months: ['一月', '二月', '三月', '四月', '五月', '六月',
                '七月', '八月', '九月', '十月', '十一月', '十二月'],
            weekdays: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
            weekdaysShort: ['日', '一', '二', '三', '四', '五', '六']
        };

        pikaday._o.i18n = {
            previousMonth: lang.calendarPrevMonth || fallback.previousMonth,
            nextMonth: lang.calendarNextMonth || fallback.nextMonth,
            months: lang.calendarMonths || fallback.months,
            weekdays: lang.calendarWeekdaysFull || fallback.weekdays,
            weekdaysShort: lang.calendarWeekdaysShort || fallback.weekdaysShort
        };

        // 重新渲染日期选择器（实例可能已被销毁，失败不应影响语言切换结果）
        try {
            pikaday.draw();
        } catch (error) {
            logger.warning('重绘日期选择器失败:', error);
        }
    }
});

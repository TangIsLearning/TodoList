// 语言管理器 mixin：各业务界面的 DOM 文案刷新（依赖 language.js）。
// 静态文案由 HTML 的 data-i18n + applyStaticTranslations 处理，这里只留 JS 动态渲染
// 或按运行时状态拼接的部分。

Object.assign(LanguageManager.prototype, {

    updatePageTitle(lang) {
        document.title = lang.appTitle;
    },

    updateMainInterface(lang) {
        // 截止时间 chip 的"截止/Due"前缀跟随语言，需重建
        if (window.viewFilter?.searchChips?.length > 0) {
            window.viewFilter.renderSearchChips();
        }

        // 清空按钮提示随当前搜索条件变化，交回搜索模块按新语言重算
        window.viewFilter?.updateSearchClearButton?.();

        // 列表由 JS 渲染，切语言后需重渲染；用 renderTasks 而非 loadTasks，不必重新请求数据
        window.todoManager?.renderTasks?.();

        this.updatePagination();

        window.tagManager?.renderMoreIndicator();
    },

    // 不能从 DOM 文本反推数值：各语言语序与单位不同，正则会取错数字
    updatePagination() {
        window.todoManager?.renderPagination?.();
    },

    updateModals(lang) {
        // 按当前模式重设标题，避免用标题文本反推模式（英文下"编辑"匹配不到）
        window.todoManager?.refreshTaskModalTitle?.();

        const categoryModalTitle = document.getElementById('category-modal-title');
        const categoryForm = document.getElementById('category-form');
        if (categoryModalTitle && categoryForm) {
            categoryModalTitle.textContent = categoryForm.dataset.editingId
                ? lang.editCategory
                : lang.newCategory;
        }

        // 调用方传入的自定义标题不覆盖，仅默认标题跟随语言
        const confirmTitle = document.querySelector('#confirm-dialog h2');
        if (confirmTitle?.dataset.i18nKey === 'confirm') {
            confirmTitle.textContent = lang.confirm;
        }
    },

    updateSettings() {
        // 令牌名与入口行模式由 JS 渲染；settingsManager 未初始化时跳过，打开弹窗时会重建
        window.settingsManager?.renderThemeColorRows?.();
        window.settingsManager?.syncThemeEditorState?.();
    },

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

        // 实例可能已销毁，失败不应影响语言切换结果
        try {
            pikaday.draw();
        } catch (error) {
            logger.warning('重绘日期选择器失败:', error);
        }
    }
});

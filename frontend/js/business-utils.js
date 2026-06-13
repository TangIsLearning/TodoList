// 截止时间校验函数集合
const DateTimeValidator = {
    // 校验截止时间的有效性（不能早于当前时间）
    validateDueDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) {
            return { valid: true, message: '' }; // 如果不全选，由另一个校验处理
        }

        const dueDate = new Date(`${dateStr}T${timeStr}`);
        const now = new Date();

        // 检查是否早于当前时间
        if (dueDate < now) {
            return {
                valid: false,
                message: window.languageManager.getText('errorInvalidDateTime', '截止时间不能早于当前时间')
            };
        }

        return { valid: true, message: '' };
    },

    // 校验日期和时间的完整性（要么都选，要么都不选）
    validateDateTimeCompleteness(dateStr, timeStr) {
        const hasDate = !!dateStr && dateStr.trim() !== '';
        const hasTime = !!timeStr && timeStr.trim() !== '';

        // 如果一个选择了，另一个没选择，则报错
        if (hasDate !== hasTime) {
            return {
                valid: false,
                message: window.languageManager.getText('errorDateTimeIncomplete', '日期和时间选择不完整')
            };
        }

        return { valid: true, message: '' };
    },

    // 综合校验
    validateDateTime(dateStr, timeStr) {
        // 先校验完整性
        const completenessResult = this.validateDateTimeCompleteness(dateStr, timeStr);
        if (!completenessResult.valid) {
            return completenessResult;
        }

        // 再校验有效性
        return this.validateDueDateTime(dateStr, timeStr);
    }
};

// 主题管理
const ThemeManager = {
    async init() {
        let theme = localStorage.getItem('todolist_theme');
        if (theme) {
            this.updateToggleButton(theme);
            return;
        }

        try {
            if (!window.pywebview || !window.pywebview.api) {
                return;
            }

            const result = await window.pywebview.api.get_theme_config();

            if (result.success) {
                theme = result.config;
                localStorage.setItem('todolist_theme', theme);
                this.updateToggleButton(theme);
            }
        } catch (error) {
            console.error('获取主题信息失败:', error);
            this.updateToggleButton('light');
        }
    },

    updateToggleButton(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        const themeDarkToggle = document.getElementById('theme-dark-toggle');
        if (themeDarkToggle) {
            themeDarkToggle.checked = theme === 'dark';
        }
    }
};

// 导出工具函数到全局
window.BusinessUtils = {
    DateTimeValidator,
    ThemeManager
};
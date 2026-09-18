// 截止时间校验函数集合
const DateTimeValidator = {
    // 校验截止时间的有效性（不能早于当前时间）
    validateDueDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) return { valid: true, message: '' }; // 如果不全选，由另一个校验处理

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
        if (!completenessResult.valid) return completenessResult;

        // 再校验有效性
        return this.validateDueDateTime(dateStr, timeStr);
    }
};

// 主题管理
// 三种互斥模式：
//   default —— 默认模式：内置浅色基底 + 出厂强调色
//   dark    —— 深色模式：内置深色基底 + 出厂强调色
//   custom  —— 自定义模式：由用户在设置中心定义的强调色（基底见配置的 baseTheme）
const ThemeManager = {
    STORAGE_KEY: 'todolist_theme',
    MODES: { DEFAULT: 'default', DARK: 'dark', CUSTOM: 'custom' },

    /** 归一化模式值，兼容历史数据（'light' → 'default'） */
    normalizeMode(value) {
        if (value === this.MODES.DARK) return this.MODES.DARK;
        if (value === this.MODES.CUSTOM) return this.MODES.CUSTOM;
        return this.MODES.DEFAULT;
    },

    isDarkMode() {
        return this.mode === this.MODES.DARK;
    },

    isCustomMode() {
        return this.mode === this.MODES.CUSTOM;
    },

    async init() {
        // 本地缓存优先（<head> 已按同样规则恢复过，此处只做对齐）
        let mode = localStorage.getItem(this.STORAGE_KEY);
        if (mode) {
            this.setMode(mode, { persist: false });
        } else {
            await Api.config.get({
                apiArgs: ['theme'],
                onSuccess: (response) => this.setMode(response.data.theme, { persist: false }),
                onError: () => this.setMode(this.MODES.DEFAULT, { persist: false })
            });
        }

        // 自定义强调色：仅自定义模式下才生效；其它模式只同步缓存
        if (window.AccentThemeManager) {
            await AccentThemeManager.reconcile();
        }
    },

    /**
     * 切换主题模式
     * @param {string} mode 'default' | 'dark' | 'custom'
     * @param {Object} [options] persist=false 时只改本地、不写后端
     */
    async setMode(mode, options = {}) {
        const normalized = this.normalizeMode(mode);
        this.mode = normalized;
        try {
            localStorage.setItem(this.STORAGE_KEY, normalized);
        } catch (error) {
            /* 隐私模式等场景下写缓存失败不影响功能 */
        }

        if (window.AccentThemeManager) {
            if (normalized === this.MODES.CUSTOM) {
                // 自定义配色同时决定基底（baseTheme）
                AccentThemeManager.setActive(true);
            } else {
                AccentThemeManager.setActive(false);
                document.documentElement.setAttribute(
                    'data-theme', normalized === this.MODES.DARK ? 'dark' : 'light');
            }
        } else {
            document.documentElement.setAttribute(
                'data-theme', normalized === this.MODES.DARK ? 'dark' : 'light');
        }

        this.updateToggleButton(normalized);

        if (options.persist !== false) {
            await Api.config.set({ apiArgs: ['theme', normalized] });
        }
    },

    updateToggleButton(mode) {
        // 兼容可能存在的独立主题切换按钮
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) toggleBtn.textContent = mode === this.MODES.DARK ? '☀️' : '🌙';

        // 设置中心的模式选择器
        document.querySelectorAll('#theme-mode-group .theme-mode-option').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.themeMode === mode);
        });

        // 供设置中心同步"自定义配色"编辑区的可用状态
        document.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode } }));
    }
};

// 导出工具函数到全局
window.BusinessUtils = {
    DateTimeValidator,
    ThemeManager
};
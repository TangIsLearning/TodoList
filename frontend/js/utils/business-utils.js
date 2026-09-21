// 截止时间校验函数集合
const DateTimeValidator = {
    validateDueDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) return { valid: true, message: '' }; // 不全选时由另一个校验处理

        const dueDate = new Date(`${dateStr}T${timeStr}`);
        const now = new Date();

        if (dueDate < now) {
            return {
                valid: false,
                message: window.languageManager.getText('errorInvalidDateTime', '截止时间不能早于当前时间')
            };
        }

        return { valid: true, message: '' };
    },

    validateDateTimeCompleteness(dateStr, timeStr) {
        const hasDate = !!dateStr && dateStr.trim() !== '';
        const hasTime = !!timeStr && timeStr.trim() !== '';

        if (hasDate !== hasTime) {
            return {
                valid: false,
                message: window.languageManager.getText('errorDateTimeIncomplete', '日期和时间选择不完整')
            };
        }

        return { valid: true, message: '' };
    },

    validateDateTime(dateStr, timeStr) {
        const completenessResult = this.validateDateTimeCompleteness(dateStr, timeStr);
        if (!completenessResult.valid) return completenessResult;

        return this.validateDueDateTime(dateStr, timeStr);
    }
};

// 三种互斥模式：default（内置浅色基底）/ dark（内置深色基底）/ custom（用户自定义，
// 基底见配置的 baseTheme）
const ThemeManager = {
    STORAGE_KEY: 'todolist_theme',
    MODES: { DEFAULT: 'default', DARK: 'dark', CUSTOM: 'custom' },

    // 归一化模式值，兼容历史数据（'light' → 'default'）
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
            await Utils.apiCall({
                apiMethod: 'get_config',
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

    // persist=false 时只改本地、不写后端
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
            await Utils.apiCall({
                apiMethod: 'set_config',
                apiArgs: ['theme', normalized]
            });
        }
    },

    updateToggleButton(mode) {
        // 兼容可能存在的独立主题切换按钮
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) toggleBtn.textContent = mode === this.MODES.DARK ? '☀️' : '🌙';

        document.querySelectorAll('#theme-mode-group .theme-mode-option').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.themeMode === mode);
        });

        // 供设置中心同步"自定义配色"编辑区的可用状态
        document.dispatchEvent(new CustomEvent('theme-mode-changed', { detail: { mode } }));
    }
};

window.BusinessUtils = {
    DateTimeValidator,
    ThemeManager
};

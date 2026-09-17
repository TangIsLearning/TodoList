/**
 * 主题配色模块（自定义强调色）
 * ----------------------------------------------------------------------------
 * 职责：
 *   1. ColorUtils           —— 颜色计算（hex/rgb、相对亮度、对比度、明暗调整）
 *   2. AccentThemeManager   —— 强调色令牌的归一化、派生、注入、缓存与持久化
 *
 * 设计要点：
 *   - 只接管"强调层"令牌（primary/success/warning/danger/info + 4 个优先级色）；
 *     背景/文字/边框等结构层仍由明暗模式（dark-mode.css）负责，避免对比度失控。
 *   - 派生令牌（--*-rgb / --on-* / --primary-hover / --focus-ring）全部由本模块
 *     用 JS 计算，不依赖 color-mix()，以兼容不同平台 WebView 内核。
 *   - 注入方式：动态 upsert <style id="accent-theme">，浅色与深色两套配置
 *     一次性写入，因此切换基底无需重新注入。
 *   - 只在"自定义模式"下生效：其它模式调用 setActive(false) 直接移除注入样式，
 *     回到 global.css 的出厂强调色（模式判定见 business-utils.js 的 ThemeManager）。
 *   - 首屏防闪：本文件在 <head> 中同步加载并调用 restoreFromCache()，
 *     先确定基底 data-theme，再按模式决定是否注入用户配色，保证第一帧即最终外观。
 *
 * 注意：本文件在 <head> 中加载，早于 logger.js，故不依赖 logger。
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'todolist_accent_colors';
    const STYLE_ID = 'accent-theme';
    const CONFIG_VERSION = 1;

    /** 主题模式存储键：与 js/utils/business-utils.js 的 ThemeManager 共用 */
    const THEME_MODE_KEY = 'todolist_theme';
    const MODE_DEFAULT = 'default';
    const MODE_DARK = 'dark';
    const MODE_CUSTOM = 'custom';

    /* ==================== 一、颜色计算工具 ==================== */

    const HEX6 = /^#?([0-9a-fA-F]{6})$/;
    const HEX3 = /^#?([0-9a-fA-F]{3})$/;

    function clamp255(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    const ColorUtils = {
        /**
         * 归一化颜色值为 #rrggbb 小写形式；非法输入返回 null
         * @param {string} value 形如 #007bff / 007BFF / #0af
         * @returns {string|null}
         */
        normalizeHex(value) {
            if (typeof value !== 'string') return null;
            const input = value.trim().toLowerCase();
            let matched = input.match(HEX6);
            if (matched) return '#' + matched[1];
            matched = input.match(HEX3);
            if (matched) {
                const [r, g, b] = matched[1].split('');
                return '#' + r + r + g + g + b + b;
            }
            return null;
        },

        isValidHex(value) {
            return this.normalizeHex(value) !== null;
        },

        /** '#007bff' -> { r: 0, g: 123, b: 255 } */
        hexToRgb(value) {
            const hex = this.normalizeHex(value);
            if (!hex) return null;
            return {
                r: parseInt(hex.slice(1, 3), 16),
                g: parseInt(hex.slice(3, 5), 16),
                b: parseInt(hex.slice(5, 7), 16)
            };
        },

        /** '#007bff' -> '0, 123, 255'（写入 --xxx-rgb 令牌） */
        hexToRgbTuple(value) {
            const rgb = this.hexToRgb(value);
            return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : null;
        },

        /** { r, g, b } + alpha -> 'rgba(...)' / 'rgb(...)' */
        rgbToCss(rgb, alpha = 1) {
            if (!rgb) return null;
            if (alpha >= 1) return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        },

        /** WCAG 相对亮度 */
        relativeLuminance(rgb) {
            if (!rgb) return 0;
            const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((channel) => {
                const s = channel / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        },

        /** WCAG 对比度（1 ~ 21） */
        contrastRatio(rgbA, rgbB) {
            if (!rgbA || !rgbB) return 1;
            const la = this.relativeLuminance(rgbA);
            const lb = this.relativeLuminance(rgbB);
            const lighter = Math.max(la, lb);
            const darker = Math.min(la, lb);
            return (lighter + 0.05) / (darker + 0.05);
        },

        /**
         * 在有色底上选一个可读的前景色（用于 --on-* 令牌）
         * @param {string} bgHex 背景色
         * @param {string} darkText 深色候选
         * @param {string} lightText 浅色候选
         */
        pickReadableText(bgHex, darkText = '#212529', lightText = '#ffffff') {
            const bg = this.hexToRgb(bgHex);
            const dark = this.hexToRgb(darkText);
            const light = this.hexToRgb(lightText);
            if (!bg) return lightText;
            return this.contrastRatio(bg, dark) >= this.contrastRatio(bg, light) ? darkText : lightText;
        },

        /** 变暗：各通道乘以 (1 - ratio) */
        darken(value, ratio = 0.2) {
            const rgb = this.hexToRgb(value);
            if (!rgb) return value;
            const factor = 1 - ratio;
            return this._toHex({
                r: clamp255(rgb.r * factor),
                g: clamp255(rgb.g * factor),
                b: clamp255(rgb.b * factor)
            });
        },

        /** 变亮：各通道向 255 靠拢 */
        lighten(value, ratio = 0.2) {
            const rgb = this.hexToRgb(value);
            if (!rgb) return value;
            return this._toHex({
                r: clamp255(rgb.r + (255 - rgb.r) * ratio),
                g: clamp255(rgb.g + (255 - rgb.g) * ratio),
                b: clamp255(rgb.b + (255 - rgb.b) * ratio)
            });
        },

        _toHex(rgb) {
            const part = (n) => n.toString(16).padStart(2, '0');
            return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
        }
    };

    /* ==================== 二、令牌定义 ==================== */

    /**
     * 可被用户自定义的强调色令牌
     * - linked   : 优先级联动开启时，该令牌由语义色派生，不可单独编辑
     * - semantic : 派生来源的语义色；缺省则使用固定的中性灰
     */
    const TOKENS = [
        { key: 'primary', label: '主体颜色', cssVar: '--primary-color', rgbVar: '--primary-rgb', onVar: '--on-primary' },
        { key: 'success', label: '成功颜色', cssVar: '--success-color', rgbVar: '--success-rgb', onVar: '--on-success' },
        { key: 'warning', label: '警告颜色', cssVar: '--warning-color', rgbVar: '--warning-rgb', onVar: '--on-warning' },
        { key: 'danger', label: '危险颜色', cssVar: '--danger-color', rgbVar: '--danger-rgb', onVar: '--on-danger' },
        { key: 'info', label: '信息颜色', cssVar: '--info-color', rgbVar: '--info-rgb', onVar: '--on-info' },
        { key: 'priorityHigh', label: '高优先级', cssVar: '--priority-high', onVar: '--on-priority-high', semantic: 'danger', linked: true },
        { key: 'priorityMedium', label: '中优先级', cssVar: '--priority-medium', onVar: '--on-priority-medium', semantic: 'warning', linked: true },
        { key: 'priorityLow', label: '低优先级', cssVar: '--priority-low', onVar: '--on-priority-low', semantic: 'success', linked: true },
        { key: 'priorityNone', label: '无优先级', cssVar: '--priority-none', onVar: '--on-priority-none', linked: true }
    ];

    /** 优先级"无"联动时使用的中性灰（结构色，不在可自定义范围内） */
    const NEUTRAL_PRIORITY_NONE = '#6c757d';

    /** 出厂配色：浅色与深色保持一致，避免默认外观发生变化 */
    const DEFAULT_PALETTE = {
        primary: '#007bff',
        success: '#28a745',
        warning: '#ffc107',
        danger: '#dc3545',
        info: '#17a2b8',
        priorityHigh: '#dc3545',
        priorityMedium: '#ffc107',
        priorityLow: '#28a745',
        priorityNone: NEUTRAL_PRIORITY_NONE
    };

    /* ==================== 三、配置归一化与派生 ==================== */

    function pickPalette(source, mode) {
        const modeSource = source && typeof source[mode] === 'object' && source[mode] ? source[mode] : {};
        const palette = {};
        TOKENS.forEach((token) => {
            palette[token.key] = ColorUtils.normalizeHex(modeSource[token.key]) || DEFAULT_PALETTE[token.key];
        });
        return palette;
    }

    /**
     * 把任意外部输入（后端/缓存/UI）整理成合法配置，非法值一律回退出厂值
     */
    function normalizeConfig(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            version: CONFIG_VERSION,
            // 默认联动，与出厂行为一致
            linkPriority: source.linkPriority !== false,
            // 自定义模式所依赖的基底主题：决定 --bg-* / --text-* 等结构色
            baseTheme: source.baseTheme === 'dark' ? 'dark' : 'light',
            light: pickPalette(source, 'light'),
            dark: pickPalette(source, 'dark')
        };
    }

    /**
     * 解析某一模式下最终生效的配色（含优先级联动）
     */
    function resolvePalette(config, mode) {
        const palette = Object.assign({}, DEFAULT_PALETTE, config[mode] || {});
        if (config.linkPriority !== false) {
            TOKENS.forEach((token) => {
                if (!token.linked) return;
                palette[token.key] = token.semantic
                    ? palette[token.semantic]
                    : NEUTRAL_PRIORITY_NONE;
            });
        }
        return palette;
    }

    /* ==================== 四、CSS 生成与注入 ==================== */

    function buildCssBlock(selector, palette) {
        const lines = [];

        TOKENS.forEach((token) => {
            const hex = palette[token.key];
            lines.push(`    ${token.cssVar}: ${hex};`);
            if (token.rgbVar) {
                lines.push(`    ${token.rgbVar}: ${ColorUtils.hexToRgbTuple(hex)};`);
            }
            lines.push(`    ${token.onVar}: ${ColorUtils.pickReadableText(hex)};`);
        });

        // 派生令牌
        const primaryRgb = ColorUtils.hexToRgb(palette.primary);
        // darken 0.30 时 #007bff -> #0056b3，与出厂值一致
        lines.push(`    --primary-hover: ${ColorUtils.darken(palette.primary, 0.3)};`);
        lines.push(`    --focus-ring: rgba(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}, 0.25);`);

        return `${selector} {\n${lines.join('\n')}\n}`;
    }

    function buildCss(config) {
        return [
            '/* 由 AccentThemeManager 注入（js/utils/theme-colors.js），请勿手改；出厂值见 css/global.css */',
            buildCssBlock(':root', resolvePalette(config, 'light')),
            buildCssBlock('[data-theme="dark"]', resolvePalette(config, 'dark'))
        ].join('\n\n');
    }

    function inject(css) {
        let styleEl = document.getElementById(STYLE_ID);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(styleEl);
        }
        styleEl.textContent = css;
    }

    /** 移除注入样式，回到 global.css 的出厂强调色 */
    function removeStyle() {
        const styleEl = document.getElementById(STYLE_ID);
        if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }

    /** 读取当前主题模式（'default' | 'dark' | 'custom'），兼容历史的 'light' */
    function readStoredMode() {
        let raw = null;
        try {
            raw = global.localStorage.getItem(THEME_MODE_KEY);
        } catch (error) {
            raw = null;
        }
        if (raw === MODE_DARK || raw === MODE_CUSTOM) return raw;
        return MODE_DEFAULT;
    }

    /* ==================== 五、本地缓存 ==================== */

    function readCache() {
        try {
            const raw = global.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return normalizeConfig(JSON.parse(raw));
        } catch (error) {
            return null;
        }
    }

    function writeCache(config) {
        try {
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        } catch (error) {
            /* 隐私模式等场景下写缓存失败不影响功能 */
        }
    }

    function currentMode() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    /* ==================== 六、对外接口 ==================== */

    const AccentThemeManager = {
        STORAGE_KEY,
        STYLE_ID,
        TOKENS,
        DEFAULT_PALETTE,
        ColorUtils,
        MODES: { DEFAULT: MODE_DEFAULT, DARK: MODE_DARK, CUSTOM: MODE_CUSTOM },

        /** 出厂配置（深拷贝） */
        getDefaultConfig() {
            return normalizeConfig(null);
        },

        normalizeConfig,

        /** 当前生效配置（本地缓存优先，无缓存则为出厂配置） */
        getConfig() {
            return readCache() || normalizeConfig(null);
        },

        /** 指定基底下的最终配色（已处理优先级联动） */
        getPalette(mode) {
            return resolvePalette(this.getConfig(), mode || currentMode());
        },

        /** 当前基底 5 个语义色的 hex 数组（供分类默认色等场景使用） */
        getAccentHexPalette() {
            const palette = this.getPalette(currentMode());
            return [palette.primary, palette.success, palette.danger, palette.warning, palette.info];
        },

        /** 当前是否已应用自定义配色 */
        isActive() {
            return !!this._active;
        },

        /**
         * 首屏同步恢复（在 <head> 内联脚本中调用，避免深浅色/配色闪变）：
         * 先按主题模式确定基底 data-theme，仅"自定义模式"才注入用户配色。
         * @returns {boolean} 是否应用了自定义配色
         */
        restoreFromCache() {
            const mode = readStoredMode();
            if (mode !== MODE_CUSTOM) {
                document.documentElement.setAttribute(
                    'data-theme', mode === MODE_DARK ? 'dark' : 'light');
                return false;
            }

            const config = readCache() || normalizeConfig(null);
            this._active = true;
            document.documentElement.setAttribute('data-theme', config.baseTheme);
            inject(buildCss(config));
            return true;
        },

        /**
         * 开关自定义配色
         * - true  → 注入样式，并按配置的 baseTheme 设置 data-theme
         * - false → 移除注入样式；基底 data-theme 交由 ThemeManager 决定
         */
        setActive(active) {
            this._active = !!active;
            this._snapshot = null;

            if (!this._active) {
                removeStyle();
                return;
            }

            const config = this.getConfig();
            inject(buildCss(config));
            document.documentElement.setAttribute('data-theme', config.baseTheme);
        },

        /**
         * 应用配置并写入本地缓存（持久化成功后才调用），同时结束预览态。
         * 非自定义模式下只更新缓存、不注入样式，
         * 避免"默认/深色模式"里保存配色后强调色被意外改掉。
         */
        apply(rawConfig) {
            const config = normalizeConfig(rawConfig);
            writeCache(config);
            this._snapshot = null;

            if (this._active) {
                inject(buildCss(config));
                document.documentElement.setAttribute('data-theme', config.baseTheme);
            }
            return config;
        },

        /** 实时预览：只改样式，不落缓存，可用 cancelPreview 回滚 */
        preview(rawConfig) {
            if (!this._active) return;
            if (!this._snapshot) this._snapshot = this.getConfig();

            const config = normalizeConfig(rawConfig);
            inject(buildCss(config));
            document.documentElement.setAttribute('data-theme', config.baseTheme);
        },

        /** 放弃预览，回到上次保存的配色 */
        cancelPreview() {
            this._snapshot = null;
            if (!this._active) return;

            const config = this.getConfig();
            inject(buildCss(config));
            document.documentElement.setAttribute('data-theme', config.baseTheme);
        },

        /**
         * 启动期与后端配置对齐。
         * 仅"自定义模式"下才注入；其它模式只刷新缓存，待切换到自定义模式再生效。
         * 后端无配置时保留本地缓存，避免多设备/清库场景下配色闪回默认值。
         */
        async reconcile() {
            if (!global.Utils || typeof global.Utils.apiCall !== 'function') return;
            await global.Utils.apiCall({
                apiMethod: 'get_config',
                apiArgs: ['custom_accent_colors'],
                onSuccess: (response) => {
                    const remote = response && response.data ? response.data.custom_accent_colors : null;
                    if (!remote) return;

                    const normalized = normalizeConfig(remote);
                    const cached = readCache();
                    if (cached && JSON.stringify(cached) === JSON.stringify(normalized)) return;

                    if (this._active) {
                        this.apply(normalized);
                    } else {
                        writeCache(normalized);
                    }
                }
            });
        }
    };

    global.AccentThemeManager = AccentThemeManager;
})(window);

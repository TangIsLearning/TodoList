/**
 * 语言管理器（核心）
 * 负责：语言设置的加载/保存/切换、翻译查询、观察者通知
 *
 * 各业务界面的 DOM 文案刷新在同目录 language.views.js 中以 mixin 方式挂载，
 * 本文件必须先加载；init 经 waitForLanguagesConfig 异步触发，视图方法在调用前必然已挂载。
 */

class LanguageManager {
    constructor() {
        this.currentLanguage;
        this.isInitialized = false;
        this.observers = []; // 观察者列表，用于通知界面更新
        this.retryCount = 0;
        this.initPromise = null;    // 初始化承诺，避免构造与 DOMContentLoaded 重复初始化
        this.switchingPromise = null; // 切换中的承诺，避免快速连点造成并发切换

        // 等待语言配置文件加载完成后再初始化
        this.waitForLanguagesConfig().then(() => this.init());
    }

    // 初始化（幂等，避免并发重复执行）
    init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.doInit().catch((error) => {
            logger.error('Failed to initialize LanguageManager:', error);
            // 使用默认语言
            this.currentLanguage = this.currentLanguage || 'zh';
        });

        return this.initPromise;
    }

    // 初始化
    async doInit() {
        try {
            // 从存储中恢复语言设置
            await this.initLanguageSetting();

            // 应用当前语言设置
            await this.applyLanguage(this.currentLanguage);

            this.isInitialized = true;
        } catch (error) {
            logger.error('Failed to initialize LanguageManager:', error);
            // 使用默认语言
            this.currentLanguage = 'zh';
        }
    }

    // 恢复语言设置
    async initLanguageSetting() {
        let language = localStorage.getItem('todolist_language');
        if (language) {
            this.currentLanguage = language;
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['language'],
            onSuccess: (response) => {
                const savedLanguage = response.data.language;
                localStorage.setItem('todolist_language', savedLanguage);
                this.currentLanguage = savedLanguage;
            },
            onError: (error) => {
                this.currentLanguage = 'zh';
            }
        });
    }

    // 保存语言设置（后端写入失败会抛出，交由调用方判定为切换失败）
    async saveLanguageSetting(language) {
        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['language', language],
            throwOnError: true,
            onSuccess: (response) => {
                // 写入本地缓存，保证下次启动能立即恢复用户选择
                localStorage.setItem('todolist_language', language);
            }
        });
    }

    // 切换语言
    switchLanguage(language) {
        // 串行化切换请求，避免快速连点导致并发写入与界面错乱
        if (this.switchingPromise) {
            return this.switchingPromise.then(() => this.switchLanguage(language));
        }

        this.switchingPromise = this.doSwitchLanguage(language).finally(() => {
            this.switchingPromise = null;
        });

        return this.switchingPromise;
    }

    // 切换语言实现
    async doSwitchLanguage(language) {
        if (!window.Languages || !window.Languages[language]) {
            logger.error('Language not supported:', language);
            return false;
        }

        if (this.currentLanguage === language) {
            return true; // 已经是目标语言
        }

        try {
            // 保存设置（持久化失败才是真正的切换失败）
            await this.saveLanguageSetting(language);
        } catch (error) {
            logger.error('Failed to switch language:', error);
            return false;
        }

        // 持久化成功即视为切换成功，后续界面刷新异常不应回滚语言
        this.currentLanguage = language;

        try {
            // 应用语言设置
            await this.applyLanguage(language);
        } catch (error) {
            logger.error('Failed to apply language to UI, keeping language setting:', error);
        }

        // 通知观察者
        this.notifyObservers();

        // 持久化已生效，界面也已按新语言刷新，判定为成功
        return true;
    }

    // 等待语言配置文件加载完成
    async waitForLanguagesConfig() {
        return new Promise((resolve) => {
            const checkConfig = () => {
                if (window.Languages && window.Languages.zh && window.Languages.en) {
                    resolve();
                } else {
                    setTimeout(checkConfig, 100);
                }
            };
            checkConfig();
        });
    }

    // 静态文案批量刷新：按 HTML 上的 data-i18n 标注一次性替换，无需逐个取标签
    // data-i18n="key"                     -> 写入 textContent
    // data-i18n-attr="title|placeholder"  -> 写入指定属性
    // data-i18n-prefix / data-i18n-suffix -> emoji、必填星号等固定前后缀（留在 HTML，不由 JS 拼串）
    applyStaticTranslations(lang) {
        document.querySelectorAll('[data-i18n]').forEach((element) => {
            const key = element.dataset.i18n;
            const text = lang[key];

            // 语言包缺失时保留原有文案并告警，便于及时发现漏翻译
            if (text === undefined || text === null) {
                logger.warning('Missing i18n key:', key);
                return;
            }

            const value = `${element.dataset.i18nPrefix || ''}${text}${element.dataset.i18nSuffix || ''}`;
            const attr = element.dataset.i18nAttr;

            if (attr) {
                element.setAttribute(attr, value);
            } else {
                element.textContent = value;
            }
        });
    }

    // 应用语言设置到界面
    async applyLanguage(language) {
        // 检查语言配置是否可用
        if (!window.Languages || !window.Languages.zh || !window.Languages.en) {
            logger.warning('Languages config not fully loaded yet, waiting...');
            // 等待配置加载完成
            await this.waitForLanguagesConfig();
        }

        // 重置重试计数器
        this.retryCount = 0;

        if (!window.Languages[language]) {
            logger.warning('Language not available:', language, 'falling back to zh');
            // 如果请求的语言不可用，回退到中文
            language = 'zh';

            // 再次检查中文是否可用
            if (!window.Languages[language]) {
                logger.error('Fallback language zh also not available');
                return;
            }
        }

        const lang = window.Languages[language];

        // 更新HTML lang属性
        document.documentElement.lang = language;

        // 各区块独立刷新：任一区块因 DOM 未就绪而失败时，不影响其余区块继续刷新
        // （update* 方法定义于 language.views.js）
        const steps = [
            ['静态文案', () => this.applyStaticTranslations(lang)],
            ['页面标题', () => this.updatePageTitle(lang)],
            ['主界面', () => this.updateMainInterface(lang)],
            ['模态框', () => this.updateModals(lang)],
            ['设置中心', () => this.updateSettings(lang)],
            ['日期选择器', () => this.updateDatePicker(lang)]
        ];

        for (const [name, step] of steps) {
            try {
                step();
            } catch (error) {
                logger.warning(`更新${name}文本失败（已跳过该区块）:`, error);
            }
        }
    }

    // 获取翻译文本
    getText(key, defaultValue = '') {
        if (!window.Languages || !window.Languages[this.currentLanguage]) return defaultValue;

        // 支持嵌套键，如 'statsTimeDimension.all'
        const keys = key.split('.');
        let value = window.Languages[this.currentLanguage];

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }

        return value || defaultValue;
    }

    // 添加观察者
    addObserver(observer) {
        if (typeof observer === 'function') this.observers.push(observer);
    }

    // 移除观察者
    removeObserver(observer) {
        const index = this.observers.indexOf(observer);
        if (index > -1) this.observers.splice(index, 1);
    }

    // 通知观察者
    notifyObservers() {
        this.observers.forEach(observer => {
            try {
                observer(this.currentLanguage);
            } catch (error) {
                logger.error('Observer error:', error);
            }
        });
    }

    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLanguage;
    }

    // 获取支持的语言列表
    getSupportedLanguages() {
        return window.Languages ? Object.keys(window.Languages) : ['zh'];
    }

    // 获取语言显示名称
    getLanguageDisplayName(languageCode) {
        const lang = window.Languages && window.Languages[languageCode];
        return lang ? lang[`language${languageCode === 'zh' ? 'Chinese' : 'English'}`] : languageCode;
    }
}

// 创建全局实例
window.languageManager = new LanguageManager();

// 简化的翻译函数（用于动态文本）
window.t = function(key, defaultValue = '') {
    return window.languageManager ? window.languageManager.getText(key, defaultValue) : defaultValue;
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保语言配置文件已加载
    setTimeout(() => {
        if (window.languageManager && !window.languageManager.isInitialized) {
            window.languageManager.init();
        }
    }, 500);
});

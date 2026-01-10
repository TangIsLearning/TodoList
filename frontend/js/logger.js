/**
 * 日志记录工具
 * 将前端日志传递到后端进行记录
 */

class Logger {
    constructor() {
        this.enabled = true;
        this.level = 'info'; // debug, info, warning, error
        this.checkPyWebViewAvailable();
    }

    /**
     * 检查pywebview是否可用
     */
    checkPyWebViewAvailable() {
        this.isPyWebViewAvailable = typeof window.pywebview !== 'undefined' && window.pywebview.api;
    }

    /**
     * 发送日志到后端
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    async sendToBackend(level, message, source = 'frontend') {
        if (!this.enabled) return;

        // 检查是否在pywebview环境中
        if (this.isPyWebViewAvailable) {
            try {
                await window.pywebview.api.log(level, message, source);
            } catch (error) {
                // 如果后端日志记录失败，仍然使用console
                console.error(`Failed to send log to backend: ${error}`);
                console.log(`[${level.toUpperCase()}] [${source}] ${message}`);
            }
        } else {
            // 非pywebview环境，只使用console
            console.log(`[${level.toUpperCase()}] [${source}] ${message}`);
        }
    }

    /**
     * 记录调试信息
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    debug(message, source = 'frontend') {
        if (this.level === 'debug') {
            this.sendToBackend('debug', message, source);
            console.debug(`[DEBUG] [${source}] ${message}`);
        }
    }

    /**
     * 记录信息
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    info(message, source = 'frontend') {
        this.sendToBackend('info', message, source);
        console.info(`[INFO] [${source}] ${message}`);
    }

    /**
     * 记录警告
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    warning(message, source = 'frontend') {
        this.sendToBackend('warning', message, source);
        console.warn(`[WARNING] [${source}] ${message}`);
    }

    /**
     * 记录错误
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    error(message, source = 'frontend') {
        this.sendToBackend('error', message, source);
        console.error(`[ERROR] [${source}] ${message}`);
    }

    /**
     * 记录严重错误
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    critical(message, source = 'frontend') {
        this.sendToBackend('critical', message, source);
        console.error(`[CRITICAL] [${source}] ${message}`);
    }

    /**
     * 设置日志级别
     * @param {string} level - 日志级别
     */
    setLevel(level) {
        this.level = level;
    }

    /**
     * 启用或禁用日志
     * @param {boolean} enabled - 是否启用
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

// 创建全局日志实例
const logger = new Logger();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
} else {
    window.Logger = logger;
}

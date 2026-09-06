/**
 * 日志记录工具
 * 将前端日志传递到后端进行记录
 */

class Logger {
    constructor() {
        this.level = 'info'; // debug, info, warning, error
    }

    // 获取调用者的文件路径和行号（返回 "file:line:column"）
    getCallerLocation() {
        const stack = new Error().stack;
        if (!stack) return 'unknown';

        const lines = stack.split('\n');
        // 浏览器堆栈格式示例：
        // 0: "Error"
        // 1: "    at Logger.getCallerLocation (http://.../logger.js:13:23)"
        // 2: "    at Logger.sendToBackend (http://.../logger.js:52:31)"
        // 3: "    at Logger.info (http://.../logger.js:81:14)"
        // 4: "    at App.init (http://.../main.js:35:20)"   ← 这是真正的调用者

        // 跳过前两行（Error 和 getCallerLocation 自身），从第3行开始寻找第一个不属于工具内部的行
        // 工具内部的特征：包含 "logger.info"、"logger.error"、"getCallerLocation" 等
        const internalKeywords = ['getCallerLocation', 'logger.info', 'logger.error'];

        for (let i = 4; i < lines.length; i++) {
            const line = lines[i];
            // 如果当前行不包含任何内部关键词，则认为是调用者
            if (!internalKeywords.some(keyword => line.includes(keyword))) {
                // 提取 "file:line:column"
                const match = line.match(/\((.*):(\d+):(\d+)\)/) ||  // Chrome/Firefox 格式
                              line.match(/at (.*):(\d+):(\d+)/);    // 部分旧格式
                if (match) {
                    const fullPath = match[1];   // 例如 "http://127.0.0.1:38648/js/main.js"
                    const lineNum = match[2];
                    const colNum = match[3];
                    // 提取纯文件名（最后一个 '/' 之后的内容）
                    const fileName = fullPath.split('/').pop() || fullPath;
                    return `${fileName}:${lineNum}:${colNum}`; // 文件名:行号:列号
                }
                // 如果没有匹配到括号，可能格式不同，返回纯文本
                return line.trim();
            }
        }
        return 'unknown';
    }

    /**
     * 发送日志到后端
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {string} source - 日志来源
     */
    async sendToBackend(level, message, source = 'frontend') {
        if (!window.pywebview || !window.pywebview.api) return;
        const location = this.getCallerLocation();
        const fullMessage = `[${location}] ${message}`;
        try {
            await window.pywebview.api.log(level, fullMessage, source);
        } catch (error) {
            // 如果后端日志记录失败，仍然使用console
            console.error(`Failed to send log to backend: ${error}`);
            console.log(`[${level.toUpperCase()}] [${source}] ${fullMessage}`);
        }
    }

    /**
     * 记录调试信息
     * @param {string} args - 日志消息
     */
    debug(...args) {
        if (this.level === 'debug') {
            const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
            this.sendToBackend('debug', message, source);
            console.debug(`[DEBUG] [${source}] ${message}`);
        }
    }

    /**
     * 记录信息
     * @param {string} args - 日志消息
     */
    info(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('info', message);
        console.info(`[INFO] ${message}`);
    }

    /**
     * 记录警告
     * @param {string} args - 日志消息
     */
    warning(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('warning', message);
        console.warn(`[WARNING] ${message}`);
    }

    /**
     * 记录错误
     * @param {string} args - 日志消息
     */
    error(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('error', message);
        console.error(`[ERROR] ${message}`);
    }

    /**
     * 记录严重错误
     * @param {string} args - 日志消息
     */
    critical(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('critical', message);
        console.error(`[CRITICAL] ${message}`);
    }

    /**
     * 设置日志级别
     * @param {string} level - 日志级别
     */
    setLevel(level) {
        this.level = level;
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

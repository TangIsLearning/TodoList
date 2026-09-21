// 日志工具：前端日志经 pywebview 转发到后端记录

class Logger {
    constructor() {
        this.level = 'info'; // debug, info, warning, error
    }

    // 解析调用者位置，返回 "file:line:column"
    getCallerLocation() {
        const stack = new Error().stack;
        if (!stack) return 'unknown';

        const lines = stack.split('\n');
        // 前几帧是 Error 与 logger 自身，跳过后再按关键词排除工具内部帧
        const internalKeywords = ['getCallerLocation', 'logger.info', 'logger.error'];

        for (let i = 4; i < lines.length; i++) {
            const line = lines[i];
            if (!internalKeywords.some(keyword => line.includes(keyword))) {
                // Chrome/Firefox 为 (file:line:col)，旧格式无括号
                const match = line.match(/\((.*):(\d+):(\d+)\)/) || line.match(/at (.*):(\d+):(\d+)/);
                if (match) {
                    const fileName = match[1].split('/').pop() || match[1];
                    return `${fileName}:${match[2]}:${match[3]}`;
                }
                return line.trim();
            }
        }
        return 'unknown';
    }

    async sendToBackend(level, message, source = 'frontend') {
        if (!window.pywebview || !window.pywebview.api) return;
        const location = this.getCallerLocation();
        const fullMessage = `[${location}] ${message}`;
        try {
            await window.pywebview.api.log(level, fullMessage, source);
        } catch (error) {
            // 后端不可用时退回 console
            console.error(`Failed to send log to backend: ${error}`);
            console.log(`[${level.toUpperCase()}] [${source}] ${fullMessage}`);
        }
    }

    debug(...args) {
        if (this.level === 'debug') {
            const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
            this.sendToBackend('debug', message, source);
            console.debug(`[DEBUG] [${source}] ${message}`);
        }
    }

    info(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('info', message);
        console.info(`[INFO] ${message}`);
    }

    warning(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('warning', message);
        console.warn(`[WARNING] ${message}`);
    }

    error(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('error', message);
        console.error(`[ERROR] ${message}`);
    }

    critical(...args) {
        const message = args
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
            .join(' ');
        this.sendToBackend('critical', message);
        console.error(`[CRITICAL] ${message}`);
    }

    setLevel(level) {
        this.level = level;
    }
}

const logger = new Logger();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
} else {
    window.Logger = logger;
}

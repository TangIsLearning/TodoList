// 平台检测与 pywebview 后端桥接：所有后端调用的唯一入口

// 检测设备系统
function detectOS() {
    const platform = navigator.platform || '';
    if (platform.includes('Win')) return 'Windows';
    if (platform.includes('Mac')) return 'macOS';
    if (platform.includes('Linux')) return 'Linux';

    // 降级方案：使用 userAgent
    const ua = navigator.userAgent;
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('Win')) return 'Windows';
    if (ua.includes('Mac')) return 'macOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Unknown';
}

// 加载pywebview的api
async function loadPywebviewApi(maxRetries = 20, interval = 300) {
    for (let i = 0; i < maxRetries; i++) {
        if (typeof window.pywebview !== 'undefined' && window.pywebview.api) return true; // pywebview 已加载完成

        if (i < maxRetries - 1) {
            logger.info(`等待 pywebview 加载... (${i + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }
    }
    logger.error('pywebview 加载超时');
    return false; // 超时未加载
}

// 取后端失败响应里的可读文案
// error_response 一定会带 error 字段，但桥接异常或旧版后端可能不带；
// 此时若直接 JSON.stringify(undefined) 会拼出 "Error: undefined"，日志里无从排查
function resolveApiErrorMessage(result) {
    const raw = result?.error;
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (raw && typeof raw === 'object') return JSON.stringify(raw);
    return result?.code ? `后端返回失败（${result.code}）` : '后端返回失败，未提供错误信息';
}

async function apiCall({
    apiMethod,
    apiArgs = [],
    onSuccess,
    onError = null,
    onFinally = null,
    throwOnError = false,          // 是否在错误后继续抛出
    successCheck = (result) => result.success !== false  // 自定义成功判断
}) {
    try {
        // 先等待 pywebview 加载完成
        const isLoaded = await loadPywebviewApi();
        if (!isLoaded) throw new Error('后端请求调用失败！');
        const result = await window.pywebview.api[apiMethod](...apiArgs);
        // 使用自定义判断函数，默认可兼容无 success 字段的情况
        if (successCheck(result)) {
            if (typeof onSuccess === 'function') onSuccess(result);
        } else {
            // 透传后端错误码（VALIDATION_ERROR / NOT_FOUND / CANCELLED ...），
            // 让上层可以按类型分支，而不是去匹配错误文案
            const apiError = new Error(resolveApiErrorMessage(result));
            apiError.code = result?.code;
            throw apiError;
        }
    } catch (error) {
        if (error?.code === 'CANCELLED') {
            // 用户取消不是故障：降级为 info，免得排障时被这些噪声淹没
            logger.info(`API '${apiMethod}' 已由用户取消`);
        } else {
            logger.error(`API '${apiMethod}' error: '${error}'`);
        }
        if (typeof onError === 'function') onError(error);
        if (throwOnError) throw error; // 允许上层继续处理
    } finally {
        if (typeof onFinally === 'function') onFinally();
    }
}

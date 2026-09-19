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
            throw new Error(`${JSON.stringify(result?.error)}`);
        }
    } catch (error) {
        logger.error(`API '${apiMethod}' error: '${error}'`);
        if (typeof onError === 'function') onError(error);
        if (throwOnError) throw error; // 允许上层继续处理
    } finally {
        if (typeof onFinally === 'function') onFinally();
    }
}

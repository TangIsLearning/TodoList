// 通用小工具 + window.Utils 全局导出
//
// 本目录文件分工：
//   dom-utils.js        Toast / Loading / 模态框 / 确认对话框
//   bridge.js           平台检测与 pywebview 后端桥接（apiCall）
//   animation-utils.js  数字动画、彩纸、气泡、动画偏好
//   utils.js（本文件）  日期/ID/防抖节流/校验等杂项，并统一导出 window.Utils
//
// 注意：window.Utils 汇总了上述所有文件的函数，本文件必须最后加载。

function formatDate(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();

    // 只比较日期部分，忽略时间
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffTime = dateOnly - nowOnly;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function isEmpty(value) {
    return value === null || value === undefined || value === '';
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

function getPriorityInfo(priority) {
    const priorityMap = {
        high: { label: '高', color: 'var(--priority-high)', icon: '🔴' },
        medium: { label: '中', color: 'var(--priority-medium)', icon: '🟡' },
        low: { label: '低', color: 'var(--priority-low)', icon: '🟢' },
        none: { label: '无', color: 'var(--priority-none)', icon: '⚪' }
    };

    return priorityMap[priority] || priorityMap.none;
}

function isOverdue(dueDate) {
    if (!dueDate) return false;

    const taskDate = new Date(dueDate);
    const now = new Date();

    return taskDate < now;
}

window.Utils = {
    formatDate,
    generateId,
    debounce,
    throttle,
    showToast,
    setLoading,
    escapeHtml,
    isEmpty,
    isValidEmail,
    isValidUrl,
    getPriorityInfo,
    isOverdue,
    ModalManager,
    bindBackdropClose,
    confirmDialog,
    detectOS,
    loadPywebviewApi,
    apiCall,
    animateNumber,
    prefersReducedMotion,
    wait,
    burstConfetti,
    popBubble,
    closeModalWithAnimation,
    beginRefresh,
    endRefresh,
    playAnimation,
    setLoadingDelay
};

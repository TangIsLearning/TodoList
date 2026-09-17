// 工具函数库

// 格式化日期
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

// 生成唯一ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 防抖函数
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

// 节流函数
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

// 显示提示信息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 3秒后自动移除
    setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
    
    // 点击关闭
    toast.addEventListener('click', () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
}

// 显示/隐藏加载状态
function setLoading(isLoading, message = '加载中...') {
    const loadingEl = document.getElementById('loading');
    if (isLoading) {
        loadingEl.querySelector('p').textContent = message;
        loadingEl.style.display = 'flex';
    } else {
        loadingEl.style.display = 'none';
    }
}

// 转义HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 检查是否为空
function isEmpty(value) {
    return value === null || value === undefined || value === '';
}

// 验证邮箱格式
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// 验证URL格式
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

// 获取优先级显示信息
function getPriorityInfo(priority) {
    const priorityMap = {
        high: { label: '高', color: 'var(--priority-high)', icon: '🔴' },
        medium: { label: '中', color: 'var(--priority-medium)', icon: '🟡' },
        low: { label: '低', color: 'var(--priority-low)', icon: '🟢' },
        none: { label: '无', color: 'var(--priority-none)', icon: '⚪' }
    };
    
    return priorityMap[priority] || priorityMap.none;
}

// 检查任务是否过期
function isOverdue(dueDate) {
    if (!dueDate) return false;
    
    const taskDate = new Date(dueDate);
    const now = new Date();

    return taskDate < now;
}

/**
 * 统一的“点击遮罩层关闭弹窗”绑定。
 *
 * 不能直接用 click 事件 + `e.target === overlay` 判断，原因：
 * 当鼠标在遮罩层内部的输入框按下、拖拽选中文字后在遮罩层（弹窗面板之外）松开时，
 * click 事件的 target 会被派发到 mousedown 与 mouseup 目标的公共祖先，
 * 恰好就是遮罩层元素本身，于是被误判为“点击空白处”而关闭弹窗。
 * 鼠标拖选标题/描述文本时极易触发该场景。
 *
 * 解决：只有当“按下”和“抬起”都发生在遮罩层本身（真正的点空白）时才关闭。
 * 同时每个元素只绑定一次，避免重复打开弹窗导致监听器堆积。
 */
const _backdropClosers = new WeakMap();

function bindBackdropClose(overlay, closeFn) {
    if (!overlay || typeof closeFn !== 'function' || _backdropClosers.has(overlay)) return;

    let pressStartedOnOverlay = false;

    const onPointerDown = (e) => {
        pressStartedOnOverlay = (e.target === overlay);
    };

    const onClick = (e) => {
        const shouldClose = pressStartedOnOverlay && e.target === overlay;
        pressStartedOnOverlay = false;
        if (shouldClose) closeFn();
    };

    // pointerdown 覆盖鼠标/触摸，mousedown 作为不支持 Pointer Events 的内核兜底
    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('mousedown', onPointerDown);
    overlay.addEventListener('click', onClick);

    _backdropClosers.set(overlay, { onPointerDown, onClick });
}

/**
 * 确认对话框（#confirm-dialog）是全局共用的同一个 DOM 节点，
 * 每次 open 都会重新给「确认/取消/关闭」按钮绑定回调，
 * 若上一次弹窗未经按钮关闭就被复用（例如详情弹窗里点击关联任务再次打开详情），
 * 旧回调仍挂在按钮上，点击时会连同历史回调一起触发。
 * 因此这里记录上一次的清理函数与关闭回调，重复打开时先清理，遮罩关闭时调用当前的关闭回调。
 */
let _confirmDialogCleanup = null;
let _confirmDialogClose = null;
// 记录本次附加的自定义 class（如详情弹窗的 view-modal），下次打开时移除，避免样式串到别的弹窗
let _confirmDialogClass = null;

// 与 isMobileDevice() 保持一致：> 480 视为大屏幕
function isLargeScreen() {
    return window.innerWidth > 480;
}

// 模态框管理
const ModalManager = {
    _boundModals: new WeakSet(),

    show(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        this._bindOnce(modal, modalId);

        modal.classList.add('show');
        modal.style.display = 'flex';

        // 聚焦第一个输入框
        const firstInput = modal.querySelector('input, textarea, select');
        if (firstInput) setTimeout(() => firstInput.focus(), 100);
    },

    // 每个弹窗只在首次打开时绑定遮罩关闭与 ESC 监听，避免监听器重复叠加
    _bindOnce(modal, modalId) {
        if (!modal || this._boundModals.has(modal)) return;
        this._boundModals.add(modal);

        bindBackdropClose(modal, () => this.hide(modalId));

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            // 仅处理处于打开状态的弹窗
            if (!modal.classList.contains('show') || modal.style.display === 'none') return;
            this.hide(modalId);
        });
    },

    hide(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.remove('show');
        modal.style.display = 'none';

        // 清空表单
        const form = modal.querySelector('form');
        if (form) form.reset();
    },
    
    hideAll() {
        document.querySelectorAll('.modal.show').forEach(modal => {
            modal.classList.remove('show');
            modal.style.display = 'none';
        });
    }
};

// 确认对话框
function confirmDialog(message, callback, onCancel = null, title = null, className = '') {
    const messageEl = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    const closeBtn = document.getElementById('confirm-close');
    const modalTitle = document.querySelector('#confirm-dialog h2');

    // 复用同一个对话框 DOM：先清理上一次未关闭弹窗遗留的回调，避免历史回调被重复触发
    if (_confirmDialogCleanup) _confirmDialogCleanup();

    // 设置标题（如果提供）
    if (title && modalTitle) {
        modalTitle.textContent = title;
    } else if (modalTitle) {
        modalTitle.textContent = '确认操作'; // 默认标题
    }
    
    // 设置消息（支持HTML内容）
    if (typeof message === 'string' && message.includes('<')) {
        // 如果消息包含HTML，确保父元素可以容纳块级元素
        messageEl.style.display = 'block';
        messageEl.innerHTML = message;
        
        // 确保单选按钮可以点击
        setTimeout(() => {
            const radios = messageEl.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                radio.addEventListener('change', (e) => logger.info('单选框选择改变:', e.target.value));
            });
            
            // 为选项添加点击事件
            const options = messageEl.querySelectorAll('.recurring-delete-option');
            options.forEach(option => {
                option.addEventListener('click', () => {
                    const radio = option.querySelector('input[type="radio"]');
                    if (radio) {
                        radio.checked = true;
                        logger.info('通过点击选中:', radio.value);
                    }
                });
            });
        }, 100);
    } else {
        messageEl.textContent = message;
    }

    // 如果存在设置侧边栏弹窗，则关闭侧边栏
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebar.classList.contains('open');
    if (isOpen && sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }
    
    // 显示模态框
    const confirmModal = document.getElementById('confirm-dialog');
    confirmModal.classList.add('show');
    if (_confirmDialogClass) confirmModal.classList.remove(_confirmDialogClass);
    if (className != '') confirmModal.classList.add(className);
    _confirmDialogClass = className || null;
    confirmModal.style.display = 'flex';
    
    // 绑定事件
    const handleConfirm = () => {
        confirmModal.classList.remove('show');
        confirmModal.style.display = 'none';
        if (callback) callback();
        cleanup();
    };
    
    const handleCancel = () => {
        confirmModal.classList.remove('show');
        confirmModal.style.display = 'none';
        if (onCancel) onCancel();
        cleanup();
    };
    
    const cleanup = () => {
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        if (closeBtn) closeBtn.removeEventListener('click', handleCancel);
        document.removeEventListener('keydown', handleEscape);
        _confirmDialogCleanup = null;
        _confirmDialogClose = null;
    };

    okBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    // 右上角关闭按钮，效果等同取消
    if (closeBtn) closeBtn.addEventListener('click', handleCancel);

    // 点击弹窗外部区域关闭（bindBackdropClose 内部保证只绑定一次，回调走当前的关闭逻辑）
    bindBackdropClose(confirmModal, () => {
        if (!isLargeScreen()) return; // 小屏幕弹窗接近全屏，遮罩区域极小，不做关闭
        if (_confirmDialogClose) _confirmDialogClose();
    });
    _confirmDialogClose = handleCancel;
    _confirmDialogCleanup = cleanup;
    
    // ESC键取消
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            confirmModal.classList.remove('show');
            confirmModal.style.display = 'none';
            cleanup();
        }
    };
    document.addEventListener('keydown', handleEscape);
}

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

const animationStateMap = new Map();

function animateNumber(element, targetValue, options = {}) {
    if (!element) return;

    const {
        duration = 600,
        prefix = '',
        suffix = '',
        decimals = 0,
        easing = 'easeOutCubic',
        fromZero = false
    } = options;

    const state = animationStateMap.get(element);
    if (state && state.rafId) {
        cancelAnimationFrame(state.rafId);
    }

    let fromValue;
    if (fromZero) {
        fromValue = 0;
    } else {
        const currentText = element.textContent || '0';
        fromValue = parseFloat(currentText.replace(/[^0-9.\-]/g, '')) || 0;
    }
    const toValue = targetValue;

    if (fromValue === toValue) {
        element.textContent = prefix + formatNumber(toValue, decimals) + suffix;
        return;
    }

    const startTime = performance.now();
    
    const easeFunctions = {
        easeOutCubic: t => 1 - Math.pow(1 - t, 3),
        easeOutQuad: t => 1 - (1 - t) * (1 - t),
        easeOutBack: t => {
            const c1 = 1.70158;
            const c3 = c1 + 1;
            return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        }
    };

    const easeFn = easeFunctions[easing] || easeFunctions.easeOutCubic;

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeFn(progress);

        const currentValue = fromValue + (toValue - fromValue) * easedProgress;
        element.textContent = prefix + formatNumber(currentValue, decimals) + suffix;

        if (progress < 1) {
            const rafId = requestAnimationFrame(animate);
            animationStateMap.set(element, { rafId });
        } else {
            element.textContent = prefix + formatNumber(toValue, decimals) + suffix;
            animationStateMap.delete(element);
        }
    }

    const rafId = requestAnimationFrame(animate);
    animationStateMap.set(element, { rafId });
}

function formatNumber(value, decimals) {
    if (decimals > 0) {
        return Number(value).toFixed(decimals);
    }
    return Math.round(value).toString();
}

// 导出工具函数到全局
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
    animateNumber
};
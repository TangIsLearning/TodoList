// DOM 工具：Toast 提示、全局 Loading、模态框体系、确认对话框
// 依赖：animation-utils.js 中的 prefersReducedMotion / playAnimation（调用时解析，加载顺序不受限）

// 提示信息堆叠容器（懒创建）：多条提示纵向排列，避免互相覆盖
function getToastStack() {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    return stack;
}

// 当前仍在展示（未处于退场动画中）的提示
function getActiveToasts(stack) {
    return stack.querySelectorAll('.toast:not(.toast-leaving)');
}

// 关闭单条提示：先播放退场动画，动画结束后再移除，后续提示平滑上移
function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-leaving')) return;

    toast.classList.add('toast-leaving');
    const remove = () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    };
    toast.addEventListener('animationend', remove, { once: true });
    // 兜底：动画事件丢失（如页面切到后台）时仍要移除
    setTimeout(remove, TOAST_LEAVE_DURATION + 150);
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');

    const stack = getToastStack();
    // 最多同时展示 4 条，超出时先让最早的一条退场
    let active = getActiveToasts(stack);
    while (active.length >= 4) {
        dismissToast(active[0]);
        active = getActiveToasts(stack);
    }
    stack.appendChild(toast);

    const timer = setTimeout(() => dismissToast(toast), 3000);

    toast.addEventListener('click', () => {
        clearTimeout(timer);
        dismissToast(toast);
    });
}

// 加载遮罩显示延迟：短时间内完成的本地操作不闪遮罩（淡出时长由 CSS 控制）
const LOADING_SHOW_DELAY = 150;
let _loadingShowTimer = null;
// 临时覆盖延迟（如视图切换期间放宽到 400ms，避免黑遮罩一闪而过），传 null 恢复默认
let _loadingDelayOverride = null;

function setLoadingDelay(ms) {
    _loadingDelayOverride = (ms === null || ms === undefined) ? null : ms;
}

function setLoading(isLoading, message = '加载中...') {
    const loadingEl = document.getElementById('loading');
    if (!loadingEl) return;

    clearTimeout(_loadingShowTimer);

    if (isLoading) {
        loadingEl.querySelector('p').textContent = message;
        // 已经在展示中：只更新文案，不重新计时
        if (loadingEl.classList.contains('loading-visible')) return;
        const delay = _loadingDelayOverride !== null
            ? _loadingDelayOverride
            : LOADING_SHOW_DELAY;
        // 延迟展示，避免快速完成的本地操作闪一下遮罩
        _loadingShowTimer = setTimeout(() => {
            loadingEl.classList.add('loading-visible');
        }, prefersReducedMotion() ? 0 : delay);
    } else {
        // 移除可见类即触发淡出（visibility 与 opacity 过渡由 CSS 处理）
        loadingEl.classList.remove('loading-visible');
    }
}

// 容器内容切换：标记"刷新中"（淡出），用于异步取数期间
function beginRefresh(container) {
    if (!container || prefersReducedMotion()) return;
    container.classList.add('is-refreshing');
}

// 容器内容切换收尾：取消淡出并播放淡入
function endRefresh(container) {
    if (!container || prefersReducedMotion()) return;
    container.classList.remove('is-refreshing');
    // 兜底时间需覆盖子元素分段入场的延迟（如统计面板分区依次淡入）
    playAnimation(container, 'is-enter', 900);
}

// 在元素上播放一次性动画：先移除同名类并强制重排，保证可重复触发
function playAnimation(el, className, fallbackMs = 600) {
    if (!el || !className || prefersReducedMotion()) return;

    el.classList.remove(className);
    void el.offsetWidth; // 强制重排以重启动画
    el.classList.add(className);

    let finished = false;
    // 只认元素自身的动画：子元素的动画结束会冒泡上来，不能据此提前清理
    const onEnd = (e) => {
        if (e.target === el) finish();
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        el.removeEventListener('animationend', onEnd);
        el.classList.remove(className);
    };

    el.addEventListener('animationend', onEnd);
    // 兜底：动画事件丢失时也要清掉类，避免影响下一次播放
    setTimeout(finish, fallbackMs);
}

// 以下时长需与 animations.css 中的时长变量保持一致：
// 弹窗退场 --anim-duration-fast，提示退场 --anim-duration-base
const MODAL_CLOSE_DURATION = 200;
const TOAST_LEAVE_DURATION = 280;

// 带退场动画地关闭弹窗：动画结束后执行 finish（隐藏、清表单等收尾逻辑）
function closeModalWithAnimation(modal, finish) {
    const done = typeof finish === 'function' ? finish : () => {};
    if (!modal || !modal.classList) return;
    // 已经隐藏（内联 display 或 CSS 规则）：无需播放退场动画，直接收尾
    if (modal.style.display === 'none' || getComputedStyle(modal).display === 'none') {
        done();
        return;
    }
    // 正在关闭中：由第一次调用负责收尾，忽略重复触发（遮罩点击 + ESC 等）
    if (modal.classList.contains('is-closing')) return;

    if (prefersReducedMotion()) { done(); return; }

    modal.classList.add('is-closing');

    let finished = false;
    const complete = () => {
        if (finished) return;
        finished = true;
        modal.removeEventListener('animationend', onAnimationEnd);
        modal.classList.remove('is-closing');
        done();
    };
    // 只认弹窗自身（遮罩层）的动画，避免子元素入场动画误触发收尾
    const onAnimationEnd = (e) => {
        if (e.target === modal) complete();
    };

    modal.addEventListener('animationend', onAnimationEnd);
    // 兜底：动画事件丢失时仍然关闭，避免弹窗卡在屏幕上
    setTimeout(complete, MODAL_CLOSE_DURATION + 60);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 不能用 click + e.target === overlay 判断：在遮罩内输入框按下、拖选文字后在遮罩上松开时，
// click 的 target 会派发到 mousedown/mouseup 的公共祖先（即遮罩本身），被误判为点空白。
// 故只在按下与抬起都发生在遮罩上时才关闭；每个元素只绑一次，避免监听器堆积。
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

// 确认对话框是全局共用的同一节点，每次 open 都重新绑回调；上次弹窗未经按钮关闭就被复用时
// 旧回调仍挂在同一按钮上，故记录上次的清理函数与关闭回调，重复打开时先清理。
let _confirmDialogCleanup = null;
let _confirmDialogClose = null;
// 记录本次附加的自定义 class（如详情弹窗的 view-modal），下次打开时移除，避免样式串到别的弹窗
let _confirmDialogClass = null;

// 与 isMobileDevice() 保持一致：> 480 视为大屏幕
function isLargeScreen() {
    return window.innerWidth > 480;
}

const ModalManager = {
    _boundModals: new WeakSet(),

    show(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        this._bindOnce(modal, modalId);

        // 上一次关闭动画可能尚未结束，重新打开时先清掉退场状态
        modal.classList.remove('is-closing');
        modal.classList.add('show');
        modal.style.display = 'flex';

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

        // 清空表单（与隐藏解耦，避免退场动画期间重新打开后又被重置）
        const form = modal.querySelector('form');
        if (form) form.reset();

        closeModalWithAnimation(modal, () => {
            modal.classList.remove('show');
            modal.style.display = 'none';
        });
    },

    // 一次性关闭所有已打开弹窗（同时退场）。confirm 等自带回调清理流程的弹窗用 except 跳过
    hideAll(options = {}) {
        const except = options.except ? document.querySelector(options.except) : null;
        document.querySelectorAll('.modal.show').forEach(modal => {
            if (except && modal === except) return;
            closeModalWithAnimation(modal, () => {
                modal.classList.remove('show');
                modal.style.display = 'none';
            });
        });
    }
};

function confirmDialog(message, callback, onCancel = null, title = null, className = '') {
    const messageEl = document.getElementById('confirm-message');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    const closeBtn = document.getElementById('confirm-close');
    const modalTitle = document.querySelector('#confirm-dialog h2');

    // 复用同一个对话框 DOM：先清理上一次未关闭弹窗遗留的回调，避免历史回调被重复触发
    if (_confirmDialogCleanup) _confirmDialogCleanup();

    // 默认标题打 i18n 标记以便切语言时跟随刷新；调用方传入的自定义标题不覆盖
    if (modalTitle) {
        if (title) {
            modalTitle.textContent = title;
            delete modalTitle.dataset.i18nKey;
        } else {
            modalTitle.textContent = window.languageManager.getText('confirm', '确认操作');
            modalTitle.dataset.i18nKey = 'confirm';
        }
    }

    if (typeof message === 'string' && message.includes('<')) {
        // 如果消息包含HTML，确保父元素可以容纳块级元素
        messageEl.style.display = 'block';
        messageEl.innerHTML = message;

        setTimeout(() => {
            const radios = messageEl.querySelectorAll('input[type="radio"]');
            radios.forEach(radio => {
                radio.addEventListener('change', (e) => logger.info('单选框选择改变:', e.target.value));
            });

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

    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebar.classList.contains('open');
    if (isOpen && sidebar && overlay) {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    const confirmModal = document.getElementById('confirm-dialog');
    confirmModal.classList.remove('is-closing');
    confirmModal.classList.add('show');
    if (_confirmDialogClass) confirmModal.classList.remove(_confirmDialogClass);
    if (className != '') confirmModal.classList.add(className);
    _confirmDialogClass = className || null;
    confirmModal.style.display = 'flex';

    const closeConfirmModal = () => {
        closeModalWithAnimation(confirmModal, () => {
            confirmModal.classList.remove('show');
            confirmModal.style.display = 'none';
        });
    };

    const handleConfirm = () => {
        closeConfirmModal();
        if (callback) callback();
        cleanup();
    };

    const handleCancel = () => {
        closeConfirmModal();
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
    if (closeBtn) closeBtn.addEventListener('click', handleCancel);

    // 点击弹窗外部区域关闭（bindBackdropClose 内部保证只绑定一次，回调走当前的关闭逻辑）
    bindBackdropClose(confirmModal, () => {
        if (!isLargeScreen()) return; // 小屏幕弹窗接近全屏，遮罩区域极小，不做关闭
        if (_confirmDialogClose) _confirmDialogClose();
    });
    _confirmDialogClose = handleCancel;
    _confirmDialogCleanup = cleanup;

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeConfirmModal();
            cleanup();
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// 统一的日期选择器：返回一个绑定在指定输入框上的日历实例。
function createDatePicker(field, { onChange, trigger } = {}) {
    if (!field) return null;
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    return new Pikaday({
        field,
        trigger,
        format: 'YYYY-MM-DD',
        showDaysInNextAndPreviousMonths: true,
        firstDay: 1,
        toString: (date) => formatDate(date),
        i18n: {
            previousMonth: 'Prev',
            nextMonth: 'Next',
            months: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
            weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        },
        onSelect: (selectedDate) => {
            if (!selectedDate) return;
            field.value = formatDate(selectedDate);
            onChange?.();
        }
    });
}

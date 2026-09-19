// 动画与特效工具：数字滚动动画、彩纸粒子、气泡文案、动画偏好检测

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

// 是否开启了"减弱动态效果"（系统无障碍设置）
function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 等待指定毫秒（动画编排用）
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 在指定元素位置迸发彩纸粒子（用于完成任务等正向反馈）
// 取自主题令牌，随自定义强调色一同变化
const CONFETTI_COLORS = [
    'var(--success-color)',
    'var(--primary-color)',
    'var(--info-color)',
    'var(--warning-color)',
    'var(--danger-color)',
    'var(--secondary-color)'
];
function burstConfetti(anchorEl, options = {}) {
    if (!anchorEl || prefersReducedMotion()) return;

    const rect = anchorEl.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const count = options.count || 14;
    // 粒子扩散半径随屏幕尺寸自适应，小屏幕收敛一些避免溢出
    const radius = Math.max(40, Math.min(90, rect.width * 3));

    for (let i = 0; i < count; i++) {
        const piece = document.createElement('i');
        piece.className = 'confetti-piece';
        const angle = (-90 + (i / count) * 260 + Math.random() * 24) * (Math.PI / 180);
        const distance = radius * (0.55 + Math.random() * 0.65);
        const size = 5 + Math.random() * 5;

        piece.style.left = `${originX}px`;
        piece.style.top = `${originY}px`;
        piece.style.width = `${size}px`;
        piece.style.height = `${size * (0.5 + Math.random())}px`;
        piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
        piece.style.setProperty('--dy', `${Math.sin(angle) * distance + 22}px`);
        piece.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 720)}deg`);
        piece.style.setProperty('--delay', `${Math.round(Math.random() * 60)}ms`);

        document.body.appendChild(piece);
        piece.addEventListener('animationend', () => piece.remove());
    }
}

// 在指定元素上方冒出一个短暂的气泡文案（如"已完成"）
function popBubble(anchorEl, text) {
    if (!anchorEl || !text || prefersReducedMotion()) return;

    const rect = anchorEl.getBoundingClientRect();
    const bubble = document.createElement('span');
    bubble.className = 'complete-bubble';
    bubble.textContent = text;
    bubble.style.left = `${rect.left + rect.width / 2}px`;
    bubble.style.top = `${rect.top}px`;

    document.body.appendChild(bubble);
    bubble.addEventListener('animationend', () => bubble.remove());
}

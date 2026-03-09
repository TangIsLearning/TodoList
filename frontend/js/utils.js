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
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
    
    // 点击关闭
    toast.addEventListener('click', () => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
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
    
    // 只比较日期部分，忽略时间
    const taskDateOnly = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return taskDateOnly < nowDateOnly;
}

// 模态框管理
const ModalManager = {
    show(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            modal.style.display = 'flex';
            
            // 聚焦第一个输入框
            const firstInput = modal.querySelector('input, textarea, select');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
            
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hide(modalId);
                }
            });
            
            // ESC键关闭
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    this.hide(modalId);
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }
    },
    
    hide(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
            
            // 清空表单
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
            }
        }
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
    const modalTitle = document.querySelector('#confirm-dialog h2');
    
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
                radio.addEventListener('change', (e) => {
                    console.log('单选框选择改变:', e.target.value);
                });
            });
            
            // 为选项添加点击事件
            const options = messageEl.querySelectorAll('.recurring-delete-option');
            options.forEach(option => {
                option.addEventListener('click', () => {
                    const radio = option.querySelector('input[type="radio"]');
                    if (radio) {
                        radio.checked = true;
                        console.log('通过点击选中:', radio.value);
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
    if (className != '') confirmModal.classList.add(className);
    confirmModal.style.display = 'flex';
    
    // 绑定事件
    const handleConfirm = () => {
        confirmModal.classList.remove('show');
        confirmModal.style.display = 'none';
        if (callback) {
            callback();
        }
        cleanup();
    };
    
    const handleCancel = () => {
        confirmModal.classList.remove('show');
        confirmModal.style.display = 'none';
        if (onCancel) {
            onCancel();
        }
        cleanup();
    };
    
    const cleanup = () => {
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
    };
    
    okBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    
    // ESC键取消
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            confirmModal.classList.remove('show');
            confirmModal.style.display = 'none';
            cleanup();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
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
    confirmDialog
};
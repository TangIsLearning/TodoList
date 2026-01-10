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
    
    const formatted = date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    if (diffDays === 0) {
        return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
        return `明天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === -1) {
        return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays > 0 && diffDays <= 7) {
        return `${diffDays}天后 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 0) {
        return `已过期 ${formatted}`;
    }
    
    return formatted;
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

// 截止时间校验函数集合
const DateTimeValidator = {
    // 校验截止时间的有效性（不能早于当前时间）
    validateDueDateTime(dateStr, timeStr) {
        if (!dateStr || !timeStr) {
            return { valid: true, message: '' }; // 如果不全选，由另一个校验处理
        }
        
        const dueDate = new Date(`${dateStr}T${timeStr}`);
        const now = new Date();

        // 检查是否早于当前时间
        if (dueDate < now) {
            return { 
                valid: false, 
                message: '截止时间不能早于当前时间'
            };
        }
        
        return { valid: true, message: '' };
    },
    
    // 校验日期和时间的完整性（要么都选，要么都不选）
    validateDateTimeCompleteness(dateStr, timeStr) {
        const hasDate = !!dateStr && dateStr.trim() !== '';
        const hasTime = !!timeStr && timeStr.trim() !== '';
        
        // 如果一个选择了，另一个没选择，则报错
        if (hasDate !== hasTime) {
            return {
                valid: false,
                message: hasDate ? '选择了日期必须同时选择时间' : '选择了时间必须同时选择日期'
            };
        }
        
        return { valid: true, message: '' };
    },
    
    // 综合校验
    validateDateTime(dateStr, timeStr) {
        // 先校验完整性
        const completenessResult = this.validateDateTimeCompleteness(dateStr, timeStr);
        if (!completenessResult.valid) {
            return completenessResult;
        }
        
        // 再校验有效性
        return this.validateDueDateTime(dateStr, timeStr);
    }
};

// 主题管理
const ThemeManager = {
    init() {
        // 异步加载主题设置
        Storage.storage.load('theme', 'light').then(savedTheme => {
            document.documentElement.setAttribute('data-theme', savedTheme);
            this.updateToggleButton(savedTheme);
        });
    },

    toggle() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        // 立即更新 UI
        document.documentElement.setAttribute('data-theme', newTheme);
        this.updateToggleButton(newTheme);

        // 异步保存到三层存储
        Storage.storage.save('theme', newTheme).then(() => {
            showToast(`已切换到${newTheme === 'dark' ? '深色' : '浅色'}主题`, 'success');
        }).catch(error => {
            console.error('保存主题失败:', error);
        });
    },

    updateToggleButton(theme) {
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }
};

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
function confirmDialog(message, callback, onCancel = null, title = null) {
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
    
    // 显示模态框
    const confirmModal = document.getElementById('confirm-dialog');
    confirmModal.classList.add('show');
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

// 复制到剪贴板
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('已复制到剪贴板', 'success');
        return true;
    } catch (err) {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
        return false;
    }
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
    DateTimeValidator,
    ThemeManager,
    ModalManager,
    confirmDialog,
    copyToClipboard
};
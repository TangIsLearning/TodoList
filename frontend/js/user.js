// UserManager - 管理当前用户状态、账号选择页、用户卡片、模态框
class UserManager {
    constructor() {
        this.currentUser = null;
        this.currentToken = null;
        this.heartbeatTimer = null;
    }

    // ===== 初始化流程 =====

    async init() {
        const r = await window.userApi.getCurrent();
        if (r && r.success && r.user) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this._enterMainView();
        } else {
            this._showAccountSelector();
        }
    }

    _enterMainView() {
        const sel = document.getElementById('account-selector-view');
        if (sel) sel.style.display = 'none';
        const main = document.getElementById('main-view');
        if (main) main.style.display = 'block';
        this._renderUserCard();
        this._initUserCardInteraction();
        this._startHeartbeat();
        window.dispatchEvent(new CustomEvent('user-changed', { detail: this.currentUser }));
    }

    async _showAccountSelector() {
        const sel = document.getElementById('account-selector-view');
        const main = document.getElementById('main-view');
        if (main) main.style.display = 'none';
        if (sel) sel.style.display = 'block';
        // 隐藏用户卡片
        const card = document.getElementById('user-card');
        if (card) card.style.display = 'none';
        await this._renderAccountList();
    }

    async _renderAccountList() {
        const r = await window.userApi.list();
        const list = document.getElementById('account-list');
        if (!list) return;
        if (!r.users || r.users.length === 0) {
            list.innerHTML = '<p class="account-empty-hint">还没有账号，点击下方按钮创建</p>';
            return;
        }
        list.innerHTML = r.users.map(u => `
            <div class="account-item" data-user-id="${u.id}">
                <div class="account-avatar-small" style="background: ${this._gradient(u.avatarColor)}">
                    ${this._initial(u.displayName)}
                </div>
                <div class="account-info">
                    <div class="account-name">${this._escape(u.displayName)}</div>
                    <div class="account-meta">${this._escape(u.unit || '')}${u.department ? ' · ' + this._escape(u.department) : ''}</div>
                </div>
            </div>
        `).join('');
        list.querySelectorAll('.account-item').forEach(el => {
            el.addEventListener('click', () => this.switchUser(el.dataset.userId));
        });
    }

    async switchUser(userId) {
        const r = await window.userApi.switchUser(userId);
        if (r.success) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this._enterMainView();
        } else {
            alert('切换失败: ' + (r.error || '未知错误'));
        }
    }

    async logout() {
        await window.userApi.logout();
        this.currentUser = null;
        this.currentToken = null;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this._showAccountSelector();
    }

    // ===== 用户卡片渲染 =====

    _renderUserCard() {
        const u = this.currentUser;
        if (!u) return;
        const card = document.getElementById('user-card');
        if (!card) return;
        card.style.display = 'flex';
        const avatar = document.getElementById('user-card-avatar');
        if (avatar) avatar.style.background = this._gradient(u.avatarColor);
        const initial = document.getElementById('user-card-initial');
        if (initial) initial.textContent = this._initial(u.displayName);
        const name = document.getElementById('user-card-name');
        if (name) name.textContent = u.displayName;
        const role = document.getElementById('user-card-role');
        if (role) role.textContent = u.role || '';
        const meta = document.getElementById('user-card-meta');
        if (meta) meta.textContent = (u.unit || '') + (u.department ? ' · ' + u.department : '');
        // 在线指示灯
        const online = document.getElementById('user-card-online');
        if (online) {
            online.classList.remove('online');
            if (u.lastActiveAt) {
                const last = new Date(u.lastActiveAt).getTime();
                const mins = (Date.now() - last) / 60000;
                if (mins < 5) online.classList.add('online');
            }
        }
    }

    _initUserCardInteraction() {
        const card = document.getElementById('user-card');
        const menu = document.getElementById('user-menu');
        if (!card || !menu) return;
        card.onclick = (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', () => { menu.style.display = 'none'; });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') menu.style.display = 'none';
        });
        menu.querySelectorAll('.user-menu-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                menu.style.display = 'none';
                this._handleUserMenuAction(item.dataset.action);
            };
        });
    }

    _handleUserMenuAction(action) {
        if (action === 'profile') {
            this.openProfileModal();
        } else if (action === 'switch') {
            this._showAccountSelector();
        } else if (action === 'groups') {
            // C 阶段：打开协作组管理模态框
            if (window.groupManager && window.GroupUIBindings) {
                window.GroupUIBindings.openManager();
            } else {
                // 兜底：原生弹窗
                const modal = document.getElementById('group-manager-modal');
                if (modal) modal.classList.add('active');
            }
        } else if (action === 'logout') {
            if (confirm('确定要退出登录吗？')) {
                this.logout();
            }
        }
    }

    // ===== 创建账号模态框 =====

    openCreateAccountModal() {
        const m = document.getElementById('create-account-modal');
        if (m) m.style.display = 'flex';
        const nameInput = document.getElementById('ca-display-name');
        if (nameInput) nameInput.focus();
    }

    closeCreateAccountModal() {
        const m = document.getElementById('create-account-modal');
        if (m) m.style.display = 'none';
        ['ca-display-name', 'ca-unit', 'ca-department', 'ca-role'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const err = document.getElementById('ca-error');
        if (err) err.style.display = 'none';
        // 重置颜色选择
        document.querySelectorAll('#ca-color-picker .color-dot').forEach((d, i) => {
            d.classList.toggle('selected', i === 0);
        });
    }

    async submitCreateAccount() {
        const dn = (document.getElementById('ca-display-name').value || '').trim();
        if (!dn) {
            this._showFormError('ca-error', '请输入用户名');
            return;
        }
        const colorEl = document.querySelector('#ca-color-picker .color-dot.selected');
        const avatarColor = colorEl ? colorEl.dataset.color : '#4f46e5';
        const r = await window.userApi.create({
            displayName: dn,
            unit: (document.getElementById('ca-unit').value || '').trim() || null,
            department: (document.getElementById('ca-department').value || '').trim() || null,
            role: (document.getElementById('ca-role').value || '').trim() || null,
            avatarColor
        });
        if (r.success) {
            this.currentUser = r.user;
            this.currentToken = r.token;
            this.closeCreateAccountModal();
            this._enterMainView();
        } else {
            this._showFormError('ca-error', r.error || '创建失败');
        }
    }

    // ===== 个人设置模态框 =====

    openProfileModal() {
        const u = this.currentUser;
        if (!u) return;
        document.getElementById('pr-display-name').value = u.displayName;
        document.getElementById('pr-unit').value = u.unit || '';
        document.getElementById('pr-department').value = u.department || '';
        document.getElementById('pr-role').value = u.role || '';
        document.querySelectorAll('#pr-color-picker .color-dot').forEach(dot => {
            dot.classList.toggle('selected', dot.dataset.color === u.avatarColor);
        });
        const err = document.getElementById('pr-error');
        if (err) err.style.display = 'none';
        const m = document.getElementById('profile-modal');
        if (m) m.style.display = 'flex';
    }

    closeProfileModal() {
        const m = document.getElementById('profile-modal');
        if (m) m.style.display = 'none';
    }

    async saveProfile() {
        const u = this.currentUser;
        if (!u) return;
        const colorEl = document.querySelector('#pr-color-picker .color-dot.selected');
        const avatarColor = colorEl ? colorEl.dataset.color : u.avatarColor;
        const r = await window.userApi.update(u.id, {
            displayName: (document.getElementById('pr-display-name').value || '').trim(),
            unit: (document.getElementById('pr-unit').value || '').trim(),
            department: (document.getElementById('pr-department').value || '').trim(),
            role: (document.getElementById('pr-role').value || '').trim(),
            avatarColor
        });
        if (r.success) {
            this.currentUser = r.user;
            this._renderUserCard();
            this.closeProfileModal();
        } else {
            this._showFormError('pr-error', r.error || '保存失败');
        }
    }

    async deleteCurrentAccount() {
        const u = this.currentUser;
        if (!u) return;
        if (!confirm(`确定要删除账号"${u.displayName}"吗？此操作不可撤销（关联任务的责任人将置空）。`)) return;
        const r = await window.userApi.delete(u.id);
        if (r.success) {
            this.closeProfileModal();
            await this.logout();
        } else {
            alert(r.error || '删除失败');
        }
    }

    // ===== 通用辅助 =====

    _initial(name) {
        return (name || '?').trim().charAt(0).toUpperCase();
    }

    _gradient(hex) {
        return `linear-gradient(135deg, ${hex}, ${this._darken(hex)})`;
    }

    _darken(hex) {
        try {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`;
        } catch (e) {
            return hex;
        }
    }

    _escape(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }

    _showFormError(elId, msg) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
    }

    _startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            window.userApi.heartbeat();
        }, 60000);
    }

    // ===== 初始化各模态框/页面事件绑定 =====

    initUI() {
        // 颜色选择器通用
        const wireColorPicker = (pickerId) => {
            const picker = document.getElementById(pickerId);
            if (!picker) return;
            picker.querySelectorAll('.color-dot').forEach(dot => {
                dot.onclick = () => {
                    picker.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
                    dot.classList.add('selected');
                };
            });
        };
        wireColorPicker('ca-color-picker');
        wireColorPicker('pr-color-picker');

        // 关闭按钮
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.onclick = () => {
                const target = btn.getAttribute('data-close');
                if (target === 'create-account-modal') this.closeCreateAccountModal();
                else if (target === 'profile-modal') this.closeProfileModal();
                else {
                    const el = document.getElementById(target);
                    if (el) el.style.display = 'none';
                }
            };
        });

        // 创建按钮
        const createBtn = document.getElementById('btn-create-account');
        if (createBtn) createBtn.onclick = () => this.openCreateAccountModal();
        const submitCreate = document.getElementById('ca-submit');
        if (submitCreate) submitCreate.onclick = () => this.submitCreateAccount();

        // 个人设置
        const saveProfileBtn = document.getElementById('pr-save');
        if (saveProfileBtn) saveProfileBtn.onclick = () => this.saveProfile();
        const deleteBtn = document.getElementById('pr-delete');
        if (deleteBtn) deleteBtn.onclick = () => this.deleteCurrentAccount();
    }
}

window.userManager = new UserManager();

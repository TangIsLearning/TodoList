// C 阶段：协作组管理（前端缓存 + UI 状态）
// 依赖：window.groupApi / window.userManager / window.toast（可选）

(function() {
    'use strict';

    class GroupManager {
        constructor() {
            this.groups = [];
            this.membersCache = new Map();
            this.currentGroupId = null;
            this._listeners = new Set();
        }

        on(event, fn) {
            this._listeners.add(fn);
            return () => this._listeners.delete(fn);
        }

        _emit(event, data) {
            for (const fn of this._listeners) {
                try { fn(event, data); } catch (e) { /* 忽略单点错误 */ }
            }
        }

        async refresh() {
            const r = await window.groupApi.list();
            if (r && r.success) {
                this.groups = r.groups || [];
                this._emit('changed', this.groups);
            }
            return this.groups;
        }

        getById(id) {
            return this.groups.find(g => g.id === id) || null;
        }

        getByCode(code) {
            return this.groups.find(g => g.joinCode === code) || null;
        }

        isOwner(group) {
            const me = window.userManager && window.userManager.currentUser;
            return !!(me && group && group.createdBy === me.id);
        }

        async create(params) {
            const r = await window.groupApi.create(params);
            if (r && r.success) {
                await this.refresh();
                this._emit('created', r.group);
            }
            return r;
        }

        async join(joinCode, shareOptions) {
            const r = await window.groupApi.join({ joinCode, ...(shareOptions || {}) });
            if (r && r.success) {
                await this.refresh();
                this._emit('joined', r.group);
            }
            return r;
        }

        async leave(groupId) {
            const r = await window.groupApi.leave(groupId);
            if (r && r.success) {
                this.groups = this.groups.filter(g => g.id !== groupId);
                this.membersCache.delete(groupId);
                this._emit('left', groupId);
            }
            return r;
        }

        async disband(groupId) {
            const r = await window.groupApi.disband(groupId);
            if (r && r.success) {
                this.groups = this.groups.filter(g => g.id !== groupId);
                this.membersCache.delete(groupId);
                this._emit('disbanded', groupId);
            }
            return r;
        }

        async resetCode(groupId) {
            const r = await window.groupApi.resetCode(groupId);
            if (r && r.success) {
                const g = this.getById(groupId);
                if (g) g.joinCode = r.joinCode;
                this._emit('codeReset', { groupId, joinCode: r.joinCode });
            }
            return r;
        }

        async loadMembers(groupId) {
            const r = await window.groupApi.members(groupId);
            if (r && r.success) {
                this.membersCache.set(groupId, r.members || []);
            }
            return (r && r.success) ? (r.members || []) : [];
        }

        getMembersCached(groupId) {
            return this.membersCache.get(groupId) || [];
        }

        async kick(groupId, userId) {
            const r = await window.groupApi.kick(groupId, userId);
            if (r && r.success) {
                this.membersCache.delete(groupId);
                this._emit('kicked', { groupId, userId });
            }
            return r;
        }

        async setShare(groupId, shareData) {
            const r = await window.groupApi.setShare({ groupId, ...shareData });
            if (r && r.success) {
                this.membersCache.delete(groupId);
            }
            return r;
        }
    }

    window.groupManager = new GroupManager();

    // ===== UI 绑定：连接按钮、模态框与 groupManager =====
    class GroupUIBindings {
        constructor() {
            this.modal = document.getElementById('group-manager-modal');
            this.createModal = document.getElementById('group-create-modal');
            this.joinModal = document.getElementById('group-join-modal');
            this.listArea = document.getElementById('group-list-area');
            this.selectedIcon = '👥';
            this.selectedColor = '#4f46e5';
            this._bindCloseButtons();
            this._bindActionButtons();
            this._bindGroupManagerEvents();
        }

        _bindCloseButtons() {
            document.querySelectorAll('[data-close]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.close;
                    const el = document.getElementById(id);
                    if (el) {
                        if (el.classList.contains('drawer')) {
                            el.classList.remove('open');
                        } else {
                            el.classList.remove('active');
                        }
                    }
                });
            });
        }

        _bindActionButtons() {
            const createBtn = document.getElementById('group-create-btn');
            if (createBtn) createBtn.addEventListener('click', () => this.openCreateModal());
            const joinBtn = document.getElementById('group-join-btn');
            if (joinBtn) joinBtn.addEventListener('click', () => this.openJoinModal());

            const gcSubmit = document.getElementById('gc-submit');
            if (gcSubmit) gcSubmit.addEventListener('click', () => this.submitCreate());
            const gjSubmit = document.getElementById('gj-submit');
            if (gjSubmit) gjSubmit.addEventListener('click', () => this.submitJoin());

            const openMgr = document.getElementById('open-group-manager');
            if (openMgr) openMgr.addEventListener('click', () => this.openManager());
            const openChat = document.getElementById('open-chat-drawer');
            if (openChat) openChat.addEventListener('click', () => this.openChatDrawer());

            const sendBtn = document.getElementById('chat-send-btn');
            if (sendBtn) sendBtn.addEventListener('click', () => this.sendChat());
        }

        _bindGroupManagerEvents() {
            if (!window.groupManager) return;
            window.groupManager.on('changed', () => this.renderList());
            window.groupManager.on('created', () => this.renderList());
            window.groupManager.on('joined', () => this.renderList());
            window.groupManager.on('left', () => this.renderList());
            window.groupManager.on('disbanded', () => this.renderList());
        }

        async openManager() {
            if (this.modal) this.modal.classList.add('active');
            await window.groupManager.refresh();
            await this.renderList();
        }

        async renderList() {
            if (!this.listArea) return;
            const groups = window.groupManager.groups || [];
            if (groups.length === 0) {
                this.listArea.innerHTML = '<p class="empty-tip">还没有协作组，点击下方按钮创建或加入</p>';
                return;
            }
            this.listArea.innerHTML = groups.map(g => {
                const isOwner = window.groupManager.isOwner(g);
                return `
                    <div class="group-card" data-group-id="${g.id}">
                        <div class="group-icon" style="color:${g.color || '#4f46e5'}">${g.icon || '👥'}</div>
                        <div class="group-info">
                            <div class="group-name">${this._escapeHtml(g.name)}</div>
                            <div class="group-code">${g.joinCode} · ${g.memberCount || 1} 人</div>
                        </div>
                        <div class="group-actions-mini">
                            ${isOwner
                                ? `<button data-action="reset-code" data-gid="${g.id}">重置码</button>
                                   <button class="danger" data-action="disband" data-gid="${g.id}">解散</button>`
                                : `<button data-action="leave" data-gid="${g.id}">退出</button>`}
                        </div>
                    </div>
                `;
            }).join('');

            this.listArea.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', () => this._handleCardAction(btn));
            });
        }

        async _handleCardAction(btn) {
            const action = btn.dataset.action;
            const gid = btn.dataset.gid;
            if (action === 'disband') {
                if (!confirm('确定解散该协作组？此操作不可撤销')) return;
                const r = await window.groupManager.disband(gid);
                if (r && r.success) {
                    if (window.Utils && window.Utils.showToast) {
                        window.Utils.showToast('协作组已解散', 'success');
                    }
                }
            } else if (action === 'leave') {
                if (!confirm('确定退出该协作组？')) return;
                await window.groupManager.leave(gid);
            } else if (action === 'reset-code') {
                const r = await window.groupManager.resetCode(gid);
                if (r && r.success) {
                    alert(`新连接码：${r.joinCode}`);
                    await this.renderList();
                }
            }
        }

        openCreateModal() {
            if (!this.createModal) return;
            const errEl = document.getElementById('gc-error');
            if (errEl) errEl.style.display = 'none';
            const nameEl = document.getElementById('gc-name');
            if (nameEl) nameEl.value = '';
            const descEl = document.getElementById('gc-description');
            if (descEl) descEl.value = '';
            this.selectedIcon = '👥';
            this.selectedColor = '#4f46e5';
            this._renderIconPicker();
            this._renderColorPicker();
            this.createModal.classList.add('active');
        }

        _renderIconPicker() {
            const icons = ['👥', '🏠', '💼', '🎯', '🚀', '⚙️', '📚', '🎨', '🔬', '🏆'];
            const picker = document.getElementById('gc-icon-picker');
            if (!picker) return;
            picker.innerHTML = icons.map(ic => `
                <span class="icon-dot ${ic === this.selectedIcon ? 'selected' : ''}"
                      data-icon="${ic}">${ic}</span>
            `).join('');
            picker.querySelectorAll('.icon-dot').forEach(el => {
                el.addEventListener('click', () => {
                    this.selectedIcon = el.dataset.icon;
                    this._renderIconPicker();
                });
            });
        }

        _renderColorPicker() {
            const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
            const picker = document.getElementById('gc-color-picker');
            if (!picker) return;
            picker.innerHTML = colors.map(c => `
                <span class="color-dot ${c === this.selectedColor ? 'selected' : ''}"
                      data-color="${c}" style="background:${c}"></span>
            `).join('');
            picker.querySelectorAll('.color-dot').forEach(el => {
                el.addEventListener('click', () => {
                    this.selectedColor = el.dataset.color;
                    this._renderColorPicker();
                });
            });
        }

        async submitCreate() {
            const name = (document.getElementById('gc-name') || {}).value || '';
            const desc = (document.getElementById('gc-description') || {}).value || '';
            const errEl = document.getElementById('gc-error');
            if (!name.trim()) {
                if (errEl) { errEl.textContent = '组名不能为空'; errEl.style.display = 'block'; }
                return;
            }
            const r = await window.groupManager.create({
                name: name.trim(),
                description: desc.trim() || null,
                icon: this.selectedIcon,
                color: this.selectedColor,
            });
            if (r && r.success) {
                this.createModal.classList.remove('active');
                if (window.Utils && window.Utils.showToast) {
                    window.Utils.showToast(`协作组已创建，连接码：${r.group.joinCode}`, 'success');
                }
            } else {
                if (errEl) { errEl.textContent = (r && r.error) || '创建失败'; errEl.style.display = 'block'; }
            }
        }

        openJoinModal() {
            if (!this.joinModal) return;
            const errEl = document.getElementById('gj-error');
            if (errEl) errEl.style.display = 'none';
            const code = document.getElementById('gj-code');
            if (code) code.value = '';
            this.joinModal.classList.add('active');
        }

        async submitJoin() {
            const code = ((document.getElementById('gj-code') || {}).value || '').toUpperCase();
            const errEl = document.getElementById('gj-error');
            if (!code.trim()) {
                if (errEl) { errEl.textContent = '请输入连接码'; errEl.style.display = 'block'; }
                return;
            }
            const shareTasks = (document.getElementById('gj-share-tasks') || {}).checked;
            const shareCategories = (document.getElementById('gj-share-categories') || {}).checked;
            const shareHistory = (document.getElementById('gj-share-history') || {}).checked;
            const r = await window.groupManager.join(code, {
                shareTasks, shareCategories, shareHistory, shareGroupTasks: true,
            });
            if (r && r.success) {
                this.joinModal.classList.remove('active');
                if (window.Utils && window.Utils.showToast) {
                    window.Utils.showToast('已加入协作组', 'success');
                }
            } else {
                if (errEl) { errEl.textContent = (r && r.error) || '加入失败'; errEl.style.display = 'block'; }
            }
        }

        async openChatDrawer() {
            const drawer = document.getElementById('chat-drawer');
            if (!drawer) return;
            drawer.classList.add('open');
            // 填充协作组下拉
            const sel = document.getElementById('chat-group-select');
            if (sel) {
                const groups = window.groupManager ? window.groupManager.groups : [];
                sel.innerHTML = groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
                if (groups.length > 0 && !sel.value && window.chatManager) {
                    await window.chatManager.loadMessages(groups[0].id);
                }
            }
        }

        async sendChat() {
            const input = document.getElementById('chat-input');
            if (!input || !input.value.trim() || !window.chatManager) return;
            const content = input.value.trim();
            input.value = '';
            const r = await window.chatManager.send(content);
            if (r && r.success) {
                this._appendMessage(r.message);
            }
        }

        _appendMessage(m) {
            const wrap = document.getElementById('chat-messages');
            if (!wrap) return;
            const isSelf = window.chatManager && window.chatManager.isSelf(m);
            const div = document.createElement('div');
            div.className = 'chat-message' + (isSelf ? ' self' : '');
            const time = (m.createdAt || '').substring(11, 16);
            div.innerHTML = `
                <div class="chat-content">${this._escapeHtml(m.content || '')}</div>
                <div class="chat-meta">${m.senderId ? m.senderId.substring(0, 6) : ''} · ${time}</div>
            `;
            wrap.appendChild(div);
            wrap.scrollTop = wrap.scrollHeight;
        }

        _escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }
    }

    window.GroupUIBindings = GroupUIBindings;
    document.addEventListener('DOMContentLoaded', () => {
        window._groupUIBindings = new GroupUIBindings();
    });
})();

// 任务协作 + 审计日志前端模块
// - 加载本地账号列表用于"责任人 / 协作人"下拉与 chip
// - 渲染任务表单中的责任人下拉与协作人 chip
// - 渲染任务详情模态框的协作人 + 审计日志标签页

(function() {
    'use strict';

    const COLLAB_DEFAULT_COLOR = '#64748b';

    // 缓存本机用户（避免每次打开表单都重新拉取）
    let _localUsersCache = null;
    let _localUsersCacheTime = 0;
    const CACHE_TTL = 30 * 1000; // 30s

    function _gradient(hex) {
        return `linear-gradient(135deg, ${hex}, ${_darken(hex)})`;
    }
    function _darken(hex) {
        try {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`;
        } catch (e) { return hex; }
    }
    function _initial(name) {
        return ((name || '?').trim().charAt(0) || '?').toUpperCase();
    }
    function _escape(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }
    function _fmtTime(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (e) { return ''; }
    }

    // 读取本机用户
    async function loadLocalUsers(force = false) {
        const now = Date.now();
        if (!force && _localUsersCache && (now - _localUsersCacheTime) < CACHE_TTL) {
            return _localUsersCache;
        }
        try {
            const r = await window.userApi.list();
            if (r && r.success && Array.isArray(r.users)) {
                _localUsersCache = r.users;
            } else {
                _localUsersCache = [];
            }
        } catch (e) {
            _localUsersCache = [];
        }
        _localUsersCacheTime = now;
        return _localUsersCache;
    }

    // 把任意可能的用户 ID 转换为展示用 user 对象
    // 优先匹配本机用户表，找不到则用 ID 占位
    function _resolveUser(userId, localUsers) {
        if (!userId) return null;
        const u = (localUsers || []).find(x => x.id === userId);
        if (u) return u;
        return { id: userId, displayName: '已删除用户', avatarColor: COLLAB_DEFAULT_COLOR };
    }

    // 渲染小型用户 chip（用于任务详情）
    function renderUserChip(user) {
        if (!user) return '<span class="collab-empty">未指定</span>';
        const color = user.avatarColor || COLLAB_DEFAULT_COLOR;
        return `<span class="collab-user-chip" title="${_escape(user.displayName)}">
            <span class="collab-user-avatar" style="background:${_gradient(color)}">${_escape(_initial(user.displayName))}</span>
            <span>${_escape(user.displayName)}</span>
        </span>`;
    }

    // 渲染任务表单的"责任人"下拉
    async function renderOwnerSelect(selectedId) {
        const select = document.getElementById('task-owner');
        if (!select) return;
        const users = await loadLocalUsers();
        const current = window.userManager && window.userManager.currentUser;
        const defaultVal = selectedId || (current ? current.id : '');
        let html = '<option value="">（默认 = 当前账号）</option>';
        for (const u of users) {
            const sel = u.id === defaultVal ? ' selected' : '';
            html += `<option value="${_escape(u.id)}"${sel}>${_escape(u.displayName)}${u.unit ? ' · ' + _escape(u.unit) : ''}</option>`;
        }
        select.innerHTML = html;
    }

    // 渲染任务表单的"协作人" chip
    async function renderCooperatorChips(selectedIds) {
        const wrap = document.getElementById('task-cooperators');
        if (!wrap) return;
        const users = await loadLocalUsers();
        const sel = new Set(selectedIds || []);
        if (users.length === 0) {
            wrap.innerHTML = '<span class="collab-empty" style="font-size:12px;">本机暂无其他用户</span>';
            return;
        }
        wrap.innerHTML = users.map(u => {
            const isSel = sel.has(u.id);
            const color = u.avatarColor || COLLAB_DEFAULT_COLOR;
            return `<span class="collaborator-chip ${isSel ? 'selected' : ''}" data-user-id="${_escape(u.id)}">
                <span class="collaborator-chip-avatar" style="background:${_gradient(color)}">${_escape(_initial(u.displayName))}</span>
                <span>${_escape(u.displayName)}</span>
            </span>`;
        }).join('');
        wrap.querySelectorAll('.collaborator-chip').forEach(chip => {
            chip.onclick = () => chip.classList.toggle('selected');
        });
    }

    // 收集任务表单中的协作人数据
    function collectCollaboratorData() {
        const ownerEl = document.getElementById('task-owner');
        const ownerUserId = ownerEl ? (ownerEl.value || null) : null;
        const chips = document.querySelectorAll('#task-cooperators .collaborator-chip.selected');
        const cooperatorUserIds = Array.from(chips).map(c => c.dataset.userId);
        return { ownerUserId, cooperatorUserIds };
    }

    // 渲染任务详情模态框
    async function renderTaskDetail(task) {
        const users = await loadLocalUsers();
        // 基本信息
        const titleEl = document.getElementById('task-detail-title');
        if (titleEl) titleEl.textContent = task.title || '任务详情';
        const metaEl = document.getElementById('task-detail-meta');
        if (metaEl) {
            const badges = [];
            badges.push(`<span class="badge">${task.completed ? '✅ 已完成' : '⬜ 未完成'}</span>`);
            if (task.priority && task.priority !== 'none') {
                const map = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' };
                badges.push(`<span class="badge priority-${task.priority}">${map[task.priority] || task.priority}</span>`);
            }
            if (task.dueDate) badges.push(`<span class="badge">📅 ${_escape(_fmtTime(task.dueDate))}</span>`);
            metaEl.innerHTML = badges.join(' ');
        }
        const descEl = document.getElementById('task-detail-description');
        if (descEl) descEl.textContent = task.description || '';
        const tagsEl = document.getElementById('task-detail-tags');
        if (tagsEl) {
            const tags = task.tags || [];
            tagsEl.innerHTML = tags.length
                ? tags.map(t => `<span class="tag-chip">#${_escape(t.name || t)}</span>`).join(' ')
                : '';
        }

        // 协作
        const ownerUser = _resolveUser(task.ownerUserId, users);
        const coopIds = task.cooperatorUserIds || [];
        const coopUsers = coopIds.map(id => _resolveUser(id, users));
        const ownerEl = document.getElementById('task-detail-owner');
        if (ownerEl) ownerEl.innerHTML = renderUserChip(ownerUser);
        const coopEl = document.getElementById('task-detail-cooperators');
        if (coopEl) {
            coopEl.innerHTML = coopUsers.length
                ? coopUsers.map(renderUserChip).join('')
                : '<span class="collab-empty">无</span>';
        }

        // 审计日志
        const infoPanel = document.getElementById('task-detail-info-panel');
        if (infoPanel) {
            const lines = [];
            if (task.createdAt) lines.push(`<div>创建时间：${_escape(_fmtTime(task.createdAt))}</div>`);
            if (task.updatedAt) lines.push(`<div>更新时间：${_escape(_fmtTime(task.updatedAt))}</div>`);
            lines.push(`<div>任务 ID：<code>${_escape(task.id)}</code></div>`);
            infoPanel.innerHTML = lines.join('');
        }
        await loadAuditLog(task.id, users);

        // 标签页切换
        document.querySelectorAll('#task-detail-modal .tab-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#task-detail-modal .tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('#task-detail-modal .tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const panel = document.querySelector(`#task-detail-modal .tab-panel[data-panel="${btn.dataset.tab}"]`);
                if (panel) panel.classList.add('active');
            };
        });
    }

    // 加载审计日志
    async function loadAuditLog(taskId, users) {
        const list = document.getElementById('task-audit-list');
        if (!list) return;
        list.innerHTML = '<p class="audit-empty">加载中...</p>';
        try {
            const r = await window.userApi.getTaskAuditLog(taskId);
            if (!r || !r.success || !r.logs || r.logs.length === 0) {
                list.innerHTML = '<p class="audit-empty">暂无审计日志</p>';
                return;
            }
            // 后端返回格式：[{ id, action, field, oldValue, newValue, userName, createdAt, userId }]
            list.innerHTML = r.logs.map(log => {
                const actionMap = {
                    create: { label: '创建', cls: 'audit-create' },
                    update: { label: '更新', cls: 'audit-update' },
                    delete: { label: '删除', cls: 'audit-delete' },
                };
                const m = actionMap[log.action] || { label: log.action || '操作', cls: '' };
                const user = log.userId
                    ? (users.find(u => u.id === log.userId) || { displayName: log.userName, avatarColor: COLLAB_DEFAULT_COLOR })
                    : { displayName: log.userName || '系统', avatarColor: COLLAB_DEFAULT_COLOR };
                const color = user.avatarColor || COLLAB_DEFAULT_COLOR;
                let body = '';
                if (log.action === 'update' && log.field) {
                    body = `<div class="audit-body">字段 <b>${_escape(log.field)}</b>：<s>${_escape(log.oldValue == null ? '∅' : String(log.oldValue))}</s> → <b>${_escape(log.newValue == null ? '∅' : String(log.newValue))}</b></div>`;
                } else if (log.action === 'create') {
                    body = `<div class="audit-body">创建任务</div>`;
                } else if (log.action === 'delete') {
                    body = `<div class="audit-body">删除任务</div>`;
                } else {
                    body = `<div class="audit-body">${_escape(log.field || '')}</div>`;
                }
                return `<div class="audit-item ${m.cls}">
                    <div class="audit-item-head">
                        <span class="audit-user">
                            <span class="audit-user-avatar" style="background:${_gradient(color)}">${_escape(_initial(user.displayName))}</span>
                            <span>${_escape(user.displayName)}</span>
                            <span style="color: var(--text-muted); font-weight: normal;">· ${m.label}</span>
                        </span>
                        <span class="audit-time">${_escape(_fmtTime(log.createdAt))}</span>
                    </div>
                    ${body}
                </div>`;
            }).join('');
        } catch (e) {
            list.innerHTML = '<p class="audit-empty">加载失败</p>';
        }
    }

    // 打开任务详情模态框
    async function openTaskDetail(task) {
        const m = document.getElementById('task-detail-modal');
        if (!m) return;
        m.dataset.taskId = task.id;
        m.style.display = 'flex';
        await renderTaskDetail(task);
        // "编辑"按钮
        const editBtn = document.getElementById('task-detail-edit');
        if (editBtn) {
            editBtn.onclick = () => {
                if (window.todoManager && typeof window.todoManager.openEditModal === 'function') {
                    window.todoManager.openEditModal(task.id);
                } else if (window.todoManager && typeof window.todoManager.editTask === 'function') {
                    window.todoManager.editTask(task.id);
                }
            };
        }
    }

    function closeTaskDetail() {
        const m = document.getElementById('task-detail-modal');
        if (m) m.style.display = 'none';
    }

    // 关闭按钮绑定
    function bindModalButtons() {
        const closeIds = ['task-detail-close', 'task-detail-cancel'];
        closeIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.onclick = closeTaskDetail;
        });
    }

    window.taskCollab = {
        loadLocalUsers,
        renderOwnerSelect,
        renderCooperatorChips,
        collectCollaboratorData,
        renderTaskDetail,
        openTaskDetail,
        closeTaskDetail,
        bindModalButtons,
    };
})();

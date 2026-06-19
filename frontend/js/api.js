// userApi 桥接层：统一封装 user/auth/audit 相关 pywebview 调用
// 用法：await window.userApi.list() / .getCurrent() / ...

(function() {
    'use strict';

    // 等待 pywebview.api 就绪的小工具
    function _api() {
        if (!window.pywebview || !window.pywebview.api) {
            return null;
        }
        return window.pywebview.api;
    }

    window.userApi = {
        getCurrent: () => {
            const a = _api();
            return a ? a.auth_get_current_user() : Promise.resolve({ success: true, user: null, token: null });
        },

        create: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.auth_create_user(
                data.displayName,
                data.unit || null,
                data.department || null,
                data.role || null,
                data.avatarColor || '#4f46e5'
            );
        },

        switchUser: (userId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.auth_switch_user(userId);
        },

        update: (userId, data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.auth_update_user(
                userId,
                data.displayName,
                data.unit === '' ? null : (data.unit !== undefined ? data.unit : undefined),
                data.department === '' ? null : (data.department !== undefined ? data.department : undefined),
                data.role === '' ? null : (data.role !== undefined ? data.role : undefined),
                data.avatarColor
            );
        },

        delete: (userId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.auth_delete_user(userId);
        },

        logout: () => {
            const a = _api();
            if (!a) return Promise.resolve({ success: true });
            return a.auth_logout();
        },

        heartbeat: () => {
            const a = _api();
            if (!a) return Promise.resolve({ success: true });
            return a.auth_heartbeat();
        },

        list: () => {
            const a = _api();
            if (!a) return Promise.resolve({ success: true, users: [] });
            return a.auth_list_local_users();
        },

        search: (q) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: true, users: [] });
            return a.user_search(q);
        },

        getTaskAuditLog: (taskId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: true, logs: [] });
            return a.task_get_audit_log(taskId);
        }
    };
})();

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

    // ===== B 阶段：分类 API =====
    window.categoryApi = {
        list: () => {
            const a = _api();
            return a ? a.category_list() : Promise.resolve({ success: false, error: 'API 未就绪' });
        },
        create: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_create(
                data.name,
                data.parentId || null,
                data.icon || '📁',
                data.color || '#4f46e5',
                data.sortOrder != null ? data.sortOrder : null
            );
        },
        update: (categoryId, data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_update(
                categoryId,
                data.name != null ? data.name : null,
                data.icon != null ? data.icon : null,
                data.color != null ? data.color : null,
                data.sortOrder != null ? data.sortOrder : null
            );
        },
        move: (categoryId, newParentId, newSortOrder) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_move(categoryId, newParentId, newSortOrder != null ? newSortOrder : null);
        },
        delete: (categoryId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_delete(categoryId);
        },
        getPath: (categoryId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_get_path(categoryId);
        },
        getDescendants: (categoryId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_get_descendants(categoryId);
        },
        taskCount: (categoryId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_task_count(categoryId);
        },
        addToTask: (taskId, categoryId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.category_add_to_task(taskId, categoryId);
        }
    };

    // ===== C 阶段：协作组 / 消息 / 同步 API =====

    window.groupApi = {
        list: () => {
            const a = _api();
            return a ? a.group_list() : Promise.resolve({ success: false, error: 'API 未就绪' });
        },
        create: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_create(
                data.name,
                data.icon || '👥',
                data.color || '#4f46e5',
                data.description || null,
                data.isHidden ? 1 : 0
            );
        },
        join: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_join(
                data.joinCode,
                data.shareTasks ? 1 : 0,
                data.shareCategories ? 1 : 0,
                data.shareGroupTasks === false ? 0 : 1,
                data.shareHistory ? 1 : 0
            );
        },
        leave: (groupId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_leave(groupId);
        },
        disband: (groupId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_disband(groupId);
        },
        resetCode: (groupId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_reset_code(groupId);
        },
        members: (groupId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_members(groupId);
        },
        kick: (groupId, userId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_kick(groupId, userId);
        },
        setShare: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.group_set_share(
                data.groupId,
                data.shareTasks != null ? (data.shareTasks ? 1 : 0) : null,
                data.shareCategories != null ? (data.shareCategories ? 1 : 0) : null,
                data.shareGroupTasks != null ? (data.shareGroupTasks ? 1 : 0) : null,
                data.shareHistory != null ? (data.shareHistory ? 1 : 0) : null
            );
        }
    };

    window.messageApi = {
        list: (groupId, limit, before) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.message_list(groupId, limit || 50, before || null);
        },
        send: (data) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.message_send(
                data.groupId,
                data.content || null,
                data.msgType || 'text',
                data.attachmentIds || null,
                data.replyToId || null
            );
        },
        markRead: (messageId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.message_mark_read(messageId);
        },
        delete: (messageId) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.message_delete(messageId);
        }
    };

    window.syncApi = {
        status: () => {
            const a = _api();
            return a ? a.sync_status() : Promise.resolve({ success: false, error: 'API 未就绪' });
        },
        log: (limit) => {
            const a = _api();
            if (!a) return Promise.resolve({ success: false, error: 'API 未就绪' });
            return a.sync_log(limit || 50);
        }
    };
})();

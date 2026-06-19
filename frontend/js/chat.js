// C 阶段：消息面板（消息缓存 + 发送 + 未读统计）
// 依赖：window.messageApi / window.groupManager

(function() {
    'use strict';

    class ChatManager {
        constructor() {
            this.currentGroupId = null;
            this.messages = [];
            this.unreadByGroup = new Map();
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

        async loadMessages(groupId, limit = 50) {
            const r = await window.messageApi.list(groupId, limit, null);
            if (r && r.success) {
                this.currentGroupId = groupId;
                this.messages = r.messages || [];
                this.unreadByGroup.set(groupId, 0);
                this._emit('loaded', { groupId, messages: this.messages });
            }
            return this.messages;
        }

        async send(content, msgType = 'text', attachmentIds = null, replyToId = null) {
            if (!this.currentGroupId) {
                return { success: false, error: 'NO_GROUP' };
            }
            const r = await window.messageApi.send({
                groupId: this.currentGroupId,
                content, msgType, attachmentIds, replyToId,
            });
            if (r && r.success) {
                this.messages.push(r.message);
                this._emit('sent', r.message);
            }
            return r;
        }

        async markRead(messageId) {
            const r = await window.messageApi.markRead(messageId);
            if (r && r.success) {
                this._emit('read', messageId);
            }
            return r;
        }

        async deleteMessage(messageId) {
            const r = await window.messageApi.delete(messageId);
            if (r && r.success) {
                this.messages = this.messages.filter(m => m.id !== messageId);
                this._emit('deleted', messageId);
            }
            return r;
        }

        incrementUnread(groupId) {
            const cur = this.unreadByGroup.get(groupId) || 0;
            this.unreadByGroup.set(groupId, cur + 1);
            this._emit('unreadChanged', this.getTotalUnread());
        }

        getTotalUnread() {
            let total = 0;
            for (const v of this.unreadByGroup.values()) total += v;
            return total;
        }

        isSelf(message) {
            const me = window.userManager && window.userManager.currentUser;
            return !!(me && message && message.senderId === me.id);
        }
    }

    window.chatManager = new ChatManager();
})();

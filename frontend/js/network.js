// C 阶段：前端网络状态机（包装后端 DiscoveryService / PeerServer）
// D 阶段：订阅 syncStatusManager 的 networkUpdated 事件，渲染对端节点
// 真实网络启动在 Python 端，前端只追踪显示状态

(function() {
    'use strict';

    const STATES = {
        DISABLED: 'disabled',
        STARTING: 'starting',
        RUNNING: 'running',
        ERROR: 'error',
    };

    // 状态排序：online > syncing > offline，未知排最后
    const STATUS_ORDER = { online: 0, syncing: 1, offline: 2 };

    class NetworkManager {
        constructor() {
            this.enabled = false;
            this.status = STATES.DISABLED;
            this.peers = [];   // [{ nodeId, userName, status, lastSyncAt, lastSeen, address }]
            this._listeners = new Set();
            this._syncUnsub = null;
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

        async start() {
            if (this.status === STATES.RUNNING) return;
            this.status = STATES.STARTING;
            this._emit('status', this.status);
            try {
                this.enabled = true;
                this.status = STATES.RUNNING;
                if (window.syncStatusManager) {
                    window.syncStatusManager.startPolling();
                    // D 阶段：订阅远端节点变化
                    if (this._syncUnsub) this._syncUnsub();
                    this._syncUnsub = window.syncStatusManager.on(
                        'networkUpdated',
                        ({ peers }) => this._onNetworkUpdated(peers || []),
                    );
                }
                this._emit('status', this.status);
            } catch (e) {
                this.status = STATES.ERROR;
                this._emit('status', this.status);
                console.error('NetworkManager start failed:', e);
            }
        }

        async stop() {
            this.enabled = false;
            this.status = STATES.DISABLED;
            this.peers = [];
            if (this._syncUnsub) {
                this._syncUnsub();
                this._syncUnsub = null;
            }
            if (window.syncStatusManager) {
                window.syncStatusManager.stopPolling();
            }
            this._emit('status', this.status);
            this.renderPeers();
        }

        _onNetworkUpdated(peers) {
            this.updatePeers(peers);
            this.renderPeers();
            this._emit('peersUpdated', this.peers);
        }

        /**
         * 把 syncStatusManager 拉到的对端列表合并到本地 peers。
         * 规则：按 nodeId 合并；新增则 push；存在则更新 status/lastSeen/lastSyncAt/address/userName。
         * 不主动删除（让后端控制生命周期，poll 间隔内短暂消失也保留）。
         */
        updatePeers(remotePeers) {
            const byId = new Map(this.peers.map(p => [p.nodeId, p]));
            for (const rp of remotePeers) {
                if (!rp || !rp.nodeId) continue;
                const existing = byId.get(rp.nodeId);
                if (existing) {
                    Object.assign(existing, {
                        userName: rp.userName ?? existing.userName,
                        status: rp.status ?? existing.status,
                        lastSeen: rp.lastSeen ?? existing.lastSeen,
                        lastSyncAt: rp.lastSyncAt ?? existing.lastSyncAt,
                        address: rp.address ?? existing.address,
                    });
                } else {
                    byId.set(rp.nodeId, { ...rp });
                }
            }
            this.peers = Array.from(byId.values()).sort(
                (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
            );
        }

        getPeerBadge(status) {
            // 🟢 在线 / 🟡 同步中 / ⚫ 离线
            if (status === 'online') return '🟢';
            if (status === 'syncing') return '🟡';
            return '⚫';
        }

        getOnlinePeers() { return this.peers.filter(p => p.status === 'online'); }
        getOfflinePeers() { return this.peers.filter(p => p.status === 'offline'); }

        renderPeers() {
            const root = document.getElementById('network-peers-list');
            if (!root) return;
            if (this.peers.length === 0) {
                root.innerHTML = '';
                root.setAttribute('data-empty', '1');
                return;
            }
            root.removeAttribute('data-empty');
            const html = this.peers.map(p => {
                const badge = this.getPeerBadge(p.status);
                const name = (p.userName || p.nodeId || '?').replace(/[<>&"]/g, c =>
                    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
                const lastSync = p.lastSyncAt
                    ? `<span class="network-peer-last">同步于 ${formatRelativeTime(p.lastSyncAt)}</span>`
                    : '';
                return `<span class="network-peer-chip" data-status="${escapeAttr(p.status || 'offline')}" title="${escapeAttr(p.nodeId)} · ${escapeAttr(p.address || '')}">${badge} ${name}${lastSync}</span>`;
            }).join('');
            root.innerHTML = html;
        }

        // 保留旧 API（向后兼容 D 阶段以前的 addPeer/removePeer）
        addPeer(peerId, info) {
            const existing = this.peers.find(p => p.nodeId === peerId);
            if (existing) {
                Object.assign(existing, info || {});
            } else {
                this.peers.push({ nodeId: peerId, status: 'online', ...(info || {}) });
            }
            this.renderPeers();
            this._emit('peerAdded', this.peers.find(p => p.nodeId === peerId));
        }

        removePeer(peerId) {
            this.peers = this.peers.filter(p => p.nodeId !== peerId);
            this.renderPeers();
            this._emit('peerRemoved', peerId);
        }
    }

    function escapeAttr(s) {
        return String(s).replace(/[<>&"]/g, c =>
            ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
    }

    function formatRelativeTime(iso) {
        try {
            const t = new Date(iso).getTime();
            if (Number.isNaN(t)) return iso;
            const diff = Math.max(0, Date.now() - t);
            const s = Math.floor(diff / 1000);
            if (s < 60) return `${s}s 前`;
            const m = Math.floor(s / 60);
            if (m < 60) return `${m}m 前`;
            const h = Math.floor(m / 60);
            if (h < 24) return `${h}h 前`;
            return new Date(t).toLocaleString();
        } catch (e) { return iso; }
    }

    window.networkManager = new NetworkManager();
    // 暴露状态常量供其他模块使用
    window.NetworkStates = STATES;
})();

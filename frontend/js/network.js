// C 阶段：前端网络状态机（包装后端 DiscoveryService / PeerServer）
// 真实网络启动在 Python 端，前端只追踪显示状态

(function() {
    'use strict';

    const STATES = {
        DISABLED: 'disabled',
        STARTING: 'starting',
        RUNNING: 'running',
        ERROR: 'error',
    };

    class NetworkManager {
        constructor() {
            this.enabled = false;
            this.status = STATES.DISABLED;
            this.peers = [];
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

        async start() {
            if (this.status === STATES.RUNNING) return;
            this.status = STATES.STARTING;
            this._emit('status', this.status);
            try {
                this.enabled = true;
                this.status = STATES.RUNNING;
                if (window.syncStatusManager) {
                    window.syncStatusManager.startPolling();
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
            if (window.syncStatusManager) {
                window.syncStatusManager.stopPolling();
            }
            this._emit('status', this.status);
        }

        addPeer(peerId, info) {
            if (!this.peers.find(p => p.id === peerId)) {
                this.peers.push({ id: peerId, ...info });
                this._emit('peerAdded', this.peers[this.peers.length - 1]);
            }
        }

        removePeer(peerId) {
            this.peers = this.peers.filter(p => p.id !== peerId);
            this._emit('peerRemoved', peerId);
        }
    }

    window.networkManager = new NetworkManager();
    // 暴露状态常量供其他模块使用
    window.NetworkStates = STATES;
})();

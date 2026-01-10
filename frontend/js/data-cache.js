// 数据缓存管理器
// 使用内存 Map 作为主要存储，localStorage 作为持久化备份
// 优先查询数据库，失败时降级到缓存

class DataCache {
    constructor() {
        // 内存缓存（主存储）
        this.cache = new Map();
        
        // localStorage 键前缀
        this.prefix = 'todolist_cache_';
        
        // localStorage 是否可用
        this.isLocalStorageAvailable = this.checkLocalStorage();
        
        // 缓存版本（用于检测缓存过期）
        this.version = '1.0';
        
        // 初始化时从 localStorage 加载缓存
        this.loadFromStorage();
    }
    
    // 检测 localStorage 是否可用
    checkLocalStorage() {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            console.warn('localStorage 不可用，仅使用内存缓存');
            return false;
        }
    }
    
    // 从 localStorage 加载缓存
    loadFromStorage() {
        if (!this.isLocalStorageAvailable) {
            return;
        }
        
        try {
            // 加载版本信息
            const storedVersion = localStorage.getItem(this.prefix + 'version');
            if (storedVersion !== this.version) {
                console.log('缓存版本不匹配，清除旧缓存');
                this.clear();
                return;
            }
            
            // 加载缓存元数据
            const metadataStr = localStorage.getItem(this.prefix + 'metadata');
            if (!metadataStr) {
                return;
            }
            
            const metadata = JSON.parse(metadataStr);
            
            // 恢复缓存数据
            Object.entries(metadata).forEach(([key, info]) => {
                const dataStr = localStorage.getItem(this.prefix + key);
                if (dataStr) {
                    try {
                        const data = JSON.parse(dataStr);
                        this.cache.set(key, {
                            data: data,
                            timestamp: info.timestamp
                        });
                        console.log(`缓存加载: ${key}`);
                    } catch (e) {
                        console.warn(`缓存加载失败: ${key}`, e);
                    }
                }
            });
        } catch (e) {
            console.warn('从 localStorage 加载缓存失败:', e);
        }
    }
    
    // 保存缓存到 localStorage
    saveToStorage(key) {
        if (!this.isLocalStorageAvailable) {
            return;
        }
        
        try {
            const item = this.cache.get(key);
            if (!item) {
                return;
            }
            
            // 保存数据
            localStorage.setItem(this.prefix + key, JSON.stringify(item.data));
            
            // 更新元数据
            this.updateMetadata(key, item.timestamp);
            
            // 保存版本
            localStorage.setItem(this.prefix + 'version', this.version);
            
        } catch (e) {
            console.warn(`保存缓存到 localStorage 失败: ${key}`, e);
        }
    }
    
    // 更新缓存元数据
    updateMetadata(key, timestamp) {
        try {
            const metadataStr = localStorage.getItem(this.prefix + 'metadata');
            const metadata = metadataStr ? JSON.parse(metadataStr) : {};
            metadata[key] = { timestamp };
            localStorage.setItem(this.prefix + 'metadata', JSON.stringify(metadata));
        } catch (e) {
            console.warn('更新缓存元数据失败:', e);
        }
    }
    
    // 设置缓存（同步操作）
    set(key, data) {
        const timestamp = Date.now();
        this.cache.set(key, {
            data: data,
            timestamp: timestamp
        });
        
        // 异步保存到 localStorage
        setTimeout(() => this.saveToStorage(key), 0);
        
        console.log(`缓存设置: ${key}`);
        return true;
    }
    
    // 获取缓存（同步操作）
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            return null;
        }
        
        return item.data;
    }
    
    // 获取带时间戳的缓存
    getWithTimestamp(key) {
        return this.cache.get(key) || null;
    }
    
    // 检查缓存是否存在
    has(key) {
        return this.cache.has(key);
    }
    
    // 删除缓存
    remove(key) {
        const deleted = this.cache.delete(key);
        
        // 从 localStorage 删除
        if (this.isLocalStorageAvailable) {
            try {
                localStorage.removeItem(this.prefix + key);
                
                // 更新元数据
                const metadataStr = localStorage.getItem(this.prefix + 'metadata');
                if (metadataStr) {
                    const metadata = JSON.parse(metadataStr);
                    delete metadata[key];
                    localStorage.setItem(this.prefix + 'metadata', JSON.stringify(metadata));
                }
            } catch (e) {
                console.warn(`从 localStorage 删除缓存失败: ${key}`, e);
            }
        }
        
        if (deleted) {
            console.log(`缓存删除: ${key}`);
        }
        
        return deleted;
    }
    
    // 清除所有缓存
    clear() {
        this.cache.clear();
        
        // 清除 localStorage 中的缓存
        if (this.isLocalStorageAvailable) {
            try {
                // 清除所有带前缀的项
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(this.prefix)) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(key => localStorage.removeItem(key));
                
                console.log('缓存已全部清除');
            } catch (e) {
                console.warn('清除 localStorage 缓存失败:', e);
            }
        }
        
        return true;
    }
    
    // 获取缓存信息
    getCacheInfo() {
        const info = {
            keys: Array.from(this.cache.keys()),
            count: this.cache.size,
            version: this.version,
            localStorageAvailable: this.isLocalStorageAvailable
        };
        
        // 添加每个缓存的时间戳
        this.cache.forEach((value, key) => {
            info[`${key}_timestamp`] = value.timestamp;
        });
        
        return info;
    }
    
    // 获取缓存大小（估算）
    getSize() {
        let size = 0;
        this.cache.forEach((value, key) => {
            size += JSON.stringify(value.data).length;
            size += key.length;
        });
        
        return {
            bytes: size,
            kb: (size / 1024).toFixed(2),
            mb: (size / 1024 / 1024).toFixed(4)
        };
    }
    
    // 导出缓存数据（用于调试）
    export() {
        const data = {};
        this.cache.forEach((value, key) => {
            data[key] = {
                data: value.data,
                timestamp: value.timestamp
            };
        });
        return data;
    }
}

// 创建全局实例
const dataCache = new DataCache();

// 导出到全局
window.DataCache = {
    // 基本操作
    set: (key, data) => dataCache.set(key, data),
    get: (key) => dataCache.get(key),
    getWithTimestamp: (key) => dataCache.getWithTimestamp(key),
    has: (key) => dataCache.has(key),
    remove: (key) => dataCache.remove(key),
    clear: () => dataCache.clear(),
    
    // 工具方法
    getCacheInfo: () => dataCache.getCacheInfo(),
    getSize: () => dataCache.getSize(),
    export: () => dataCache.export(),
    
    // 直接访问实例（高级用法）
    instance: dataCache
};

console.log('DataCache 已初始化');

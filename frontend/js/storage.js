// 三层存储管理：内存 + 数据库 + 配置文件
// 层级优先级：内存 > 数据库 > 配置文件

class StorageManager {
    constructor() {
        this.prefix = 'todolist_';
        this.memoryCache = new Map(); // 内存缓存
        this.isLocalStorageAvailable = this.checkLocalStorage();
    }

    // 检测 localStorage 是否可用
    checkLocalStorage() {
        try {
            const testKey = '__test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            return true;
        } catch (e) {
            console.warn('localStorage 不可用，将使用内存存储');
            return false;
        }
    }

    // 读取数据（优先内存，降级到数据库，最后配置文件）
    async load(key, defaultValue = null) {
        // 1. 优先读取内存缓存
        if (this.memoryCache.has(key)) {
            return this.memoryCache.get(key);
        }

        // 2. 尝试读取 localStorage（如果可用）
        if (this.isLocalStorageAvailable) {
            try {
                const serializedData = localStorage.getItem(this.prefix + key);
                if (serializedData !== null) {
                    const value = JSON.parse(serializedData);
                    this.memoryCache.set(key, value); // 更新内存缓存
                    return value;
                }
            } catch (error) {
                console.warn('localStorage 读取失败:', error);
            }
        }

        // 3. 尝试读取数据库（通过 pywebview API）
        if (window && window.pywebview && window.pywebview.api) {
            try {
                const result = await window.pywebview.api.get_setting(key);
                if (result.success && result.value !== null) {
                    this.memoryCache.set(key, result.value); // 更新内存缓存
                    return result.value;
                }
            } catch (error) {
                console.warn('数据库读取失败:', error);
            }
        }

        // 4. 读取配置文件作为默认值
        try {
            const response = await fetch('config/default_config.json');
            if (response.ok) {
                const config = await response.json();
                if (config[key] !== undefined) {
                    return config[key];
                }
            }
        } catch (error) {
            console.warn('配置文件读取失败:', error);
        }

        return defaultValue;
    }

    // 保存数据（更新内存和数据库）
    async save(key, value) {
        // 1. 立即更新内存缓存
        this.memoryCache.set(key, value);

        // 2. 尝试写入 localStorage（如果可用）
        if (this.isLocalStorageAvailable) {
            try {
                localStorage.setItem(this.prefix + key, JSON.stringify(value));
            } catch (error) {
                console.warn('localStorage 写入失败:', error);
            }
        }

        // 3. 异步写入数据库（不阻塞主流程）
        if (pywebview && pywebview.api) {
            pywebview.api.set_setting(key, value).catch(error => {
                console.warn('数据库写入失败:', error);
            });
        }

        return true;
    }

    // 删除数据
    async remove(key) {
        this.memoryCache.delete(key);

        if (this.isLocalStorageAvailable) {
            try {
                localStorage.removeItem(this.prefix + key);
            } catch (error) {
                console.warn('localStorage 删除失败:', error);
            }
        }

        if (pywebview && pywebview.api) {
            pywebview.api.delete_setting(key).catch(error => {
                console.warn('数据库删除失败:', error);
            });
        }

        return true;
    }
}

// 用户设置管理
class SettingsManager extends StorageManager {
    constructor() {
        super();
        this.settingsKey = 'user_settings';
    }

    // 获取所有设置（同步版本，返回内存缓存或默认值）
    getAllSettings() {
        return this.memoryCache.has(this.settingsKey)
            ? this.memoryCache.get(this.settingsKey)
            : {};
    }

    // 获取单个设置（同步版本）
    getSetting(key, defaultValue = null) {
        const settings = this.getAllSettings();
        return settings[key] !== undefined ? settings[key] : defaultValue;
    }

    // 设置单个设置（异步更新内存和数据库）
    async setSetting(key, value) {
        const settings = this.getAllSettings();
        settings[key] = value;
        await this.save(this.settingsKey, settings);
        return true;
    }

    // 保存所有设置
    async saveAllSettings(settings) {
        await this.save(this.settingsKey, settings);
        return true;
    }
}

// 创建全局实例
const storage = new StorageManager();
const settings = new SettingsManager();

// 导出到全局
window.Storage = {
    storage,
    settings
};
// 缓存功能测试工具
// 可以在浏览器控制台中运行此脚本测试缓存功能

const CacheTest = {
    // 打印缓存信息
    printCacheInfo() {
        console.log('=== 缓存信息 ===');
        const info = window.DataCache.getCacheInfo();
        console.log('缓存键:', info.keys);
        console.log('缓存数量:', info.count);
        console.log('版本:', info.version);
        console.log('localStorage 可用:', info.localStorageAvailable);
        
        // 打印时间戳
        info.keys.forEach(key => {
            const item = window.DataCache.getWithTimestamp(key);
            if (item) {
                const date = new Date(item.timestamp);
                console.log(`${key}: 缓存于 ${date.toLocaleString()}`);
            }
        });
        
        // 打印缓存大小
        const size = window.DataCache.getSize();
        console.log('缓存大小:', `${size.kb} KB`);
        
        return info;
    },
    
    // 导出完整缓存数据
    exportCache() {
        console.log('=== 导出缓存数据 ===');
        const data = window.DataCache.export();
        console.log(JSON.stringify(data, null, 2));
        return data;
    },
    
    // 清除所有缓存
    clearAllCache() {
        console.log('清除所有缓存...');
        window.DataCache.clear();
        console.log('缓存已清除');
    },
    
    // 清除特定缓存
    clearCache(key) {
        console.log(`清除缓存: ${key}...`);
        window.DataCache.remove(key);
        console.log(`缓存 ${key} 已清除`);
    },
    
    // 测试缓存读写
    testCache() {
        console.log('=== 开始缓存测试 ===');
        
        // 测试写入
        console.log('1. 测试写入缓存...');
        window.DataCache.set('test_key', { data: 'test_value', timestamp: Date.now() });
        console.log('✓ 写入成功');
        
        // 测试读取
        console.log('2. 测试读取缓存...');
        const value = window.DataCache.get('test_key');
        console.log('读取到的值:', value);
        if (value && value.data === 'test_value') {
            console.log('✓ 读取成功');
        } else {
            console.log('✗ 读取失败');
        }
        
        // 测试删除
        console.log('3. 测试删除缓存...');
        window.DataCache.remove('test_key');
        const deletedValue = window.DataCache.get('test_key');
        if (!deletedValue) {
            console.log('✓ 删除成功');
        } else {
            console.log('✗ 删除失败');
        }
        
        console.log('=== 测试完成 ===');
    },
    
    // 监控缓存操作
    enableDebugMode() {
        console.log('启用缓存调试模式...');
        const originalSet = window.DataCache.set;
        const originalGet = window.DataCache.get;
        const originalRemove = window.DataCache.remove;
        
        window.DataCache.set = function(key, data) {
            console.log(`[缓存写入] ${key}:`, data);
            return originalSet.call(this, key, data);
        };
        
        window.DataCache.get = function(key) {
            const value = originalGet.call(this, key);
            console.log(`[缓存读取] ${key}:`, value ? '命中' : '未命中');
            return value;
        };
        
        window.DataCache.remove = function(key) {
            console.log(`[缓存删除] ${key}`);
            return originalRemove.call(this, key);
        };
        
        console.log('✓ 调试模式已启用');
    },
    
    // 禁用调试模式
    disableDebugMode() {
        console.log('禁用缓存调试模式...');
        // 重新加载页面以恢复原始方法
        console.log('请刷新页面以禁用调试模式');
    }
};

// 导出到全局
window.CacheTest = CacheTest;

console.log('缓存测试工具已加载。可用的方法:');
console.log('- CacheTest.printCacheInfo()    打印缓存信息');
console.log('- CacheTest.exportCache()       导出缓存数据');
console.log('- CacheTest.clearAllCache()     清除所有缓存');
console.log('- CacheTest.clearCache(key)     清除特定缓存');
console.log('- CacheTest.testCache()         测试缓存功能');
console.log('- CacheTest.enableDebugMode()   启用调试模式');

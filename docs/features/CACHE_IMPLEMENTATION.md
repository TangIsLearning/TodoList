# 数据缓存功能实现文档

## 概述

为提高应用启动速度，本应用实现了数据缓存功能。缓存系统采用三层存储策略：
1. **内存缓存（Map结构）**：主要存储，读写速度最快
2. **localStorage 持久化**：作为内存缓存的备份，在应用重启后恢复数据
3. **降级机制**：当 localStorage 不可用时，仅使用内存缓存

## 缓存的数据类型

### 1. 任务列表缓存
- **缓存键**: `tasks`
- **缓存内容**: 完整的任务列表数据（包含总数、总页数等）
- **缓存时机**: 首次加载且处于"全部"视图时（无筛选、无搜索）
- **清除时机**: 创建、编辑、删除任务或切换任务状态时

### 2. 分类列表缓存
- **缓存键**: `categories`
- **缓存内容**: 所有分类数据
- **缓存时机**: 首次加载分类时
- **清除时机**: 创建、编辑、删除分类时

## 缓存策略

### 读取策略（优先级从高到低）
1. **数据库查询**：优先查询后端数据库获取最新数据
2. **缓存降级**：数据库查询失败时，使用缓存数据
3. **空数据返回**：数据库和缓存都无数据时，返回空列表

### 写入策略
1. **内存优先**：数据先写入内存缓存（同步）
2. **持久化备份**：异步保存到 localStorage
3. **自动清理**：数据更新时自动清除相关缓存

## API 使用

### 基本操作

```javascript
// 设置缓存
window.DataCache.set('tasks', {
    tasks: [...],
    total: 100,
    total_pages: 10
});

// 获取缓存
const cachedData = window.DataCache.get('tasks');

// 检查缓存是否存在
if (window.DataCache.has('tasks')) {
    // 缓存存在
}

// 删除缓存
window.DataCache.remove('tasks');

// 清除所有缓存
window.DataCache.clear();
```

### 高级操作

```javascript
// 获取带时间戳的缓存
const item = window.DataCache.getWithTimestamp('tasks');
console.log('缓存时间:', new Date(item.timestamp));

// 获取缓存信息
const info = window.DataCache.getCacheInfo();
console.log('缓存键:', info.keys);
console.log('缓存数量:', info.count);

// 获取缓存大小
const size = window.DataCache.getSize();
console.log('缓存大小:', size.kb, 'KB');

// 导出缓存数据（用于调试）
const exportedData = window.DataCache.export();
```

## 调试工具

应用提供了 `CacheTest` 调试工具，可在浏览器控制台中使用：

```javascript
// 打印缓存信息
CacheTest.printCacheInfo();

// 导出完整缓存数据
CacheTest.exportCache();

// 清除所有缓存
CacheTest.clearAllCache();

// 清除特定缓存
CacheTest.clearCache('tasks');

// 测试缓存功能
CacheTest.testCache();

// 启用调试模式（监控所有缓存操作）
CacheTest.enableDebugMode();
```

## 实现细节

### 缓存版本控制
- 缓存系统包含版本号（`version: '1.0'`）
- 当检测到版本不匹配时，自动清除旧缓存

### localStorage 可用性检测
- 自动检测 localStorage 是否可用
- 如果不可用，仅使用内存缓存，不影响应用正常运行

### 内存管理
- 使用 Map 结构存储缓存，提供 O(1) 的读写性能
- 支持手动清除特定缓存或全部缓存

### 数据一致性
- 所有数据更新操作（增删改）都会清除相关缓存
- 下次加载数据时会重新缓存最新数据

## 优势

1. **快速启动**：应用启动时可以立即显示缓存的数据，无需等待数据库响应
2. **离线支持**：数据库不可用时，仍可查看缓存的历史数据
3. **数据新鲜**：数据更新时自动清除缓存，确保下次显示最新数据
4. **简单易用**：前端 JavaScript 直接调用 API，无需后端支持
5. **自动降级**：localStorage 不可用时自动降级到纯内存缓存

## 注意事项

1. 缓存数据仅在首次加载"全部"视图时缓存，筛选和搜索后的数据不缓存
2. 缓存数据不包含用户设置（主题等），用户设置由 StorageManager 管理
3. 建议定期清理缓存，避免占用过多内存
4. 生产环境中可以设置缓存过期时间（当前实现未包含）

## 未来改进方向

1. 添加缓存过期时间机制
2. 支持更细粒度的缓存控制（如按分类缓存）
3. 添加缓存统计和监控功能
4. 支持缓存预加载策略

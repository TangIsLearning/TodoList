# 周期性任务删除渲染异常修复

## 问题描述
点击删除周期性任务时，页面渲染异常，主要表现在：
1. 删除对话框无法正确显示选项
2. 选择删除选项后无法正确获取用户选择
3. 删除操作执行后页面可能出现渲染错误

## 问题原因分析

### 1. DOM结构问题
- `Utils.confirmDialog`原本使用`textContent`设置消息，导致HTML内容无法正确渲染
- 周期性删除选项的HTML结构被当作纯文本处理

### 2. 事件绑定问题
- 在对话框关闭时，DOM元素已被移除，无法获取用户选择的值
- 单选按钮的点击事件没有正确绑定

### 3. 数据同步问题
- 删除操作后任务列表可能出现不一致
- 缺少错误恢复机制

## 修复方案

### 1. 增强确认对话框功能
```javascript
// 修改前
messageEl.textContent = message;

// 修改后
if (typeof message === 'string' && message.includes('<')) {
    messageEl.innerHTML = message;
    // 添加事件监听器确保交互正常
} else {
    messageEl.textContent = message;
}
```

### 2. 改进参数支持
- `confirmDialog`方法现在支持HTML内容
- 添加了`onCancel`回调参数
- 支持自定义标题

### 3. 增强错误处理
```javascript
async performDelete(taskId, deleteAll) {
    try {
        // 删除操作
        const response = await window.pywebview.api.delete_todo(taskId, deleteAll);
        
        // 安全检查任务列表状态
        if (Array.isArray(this.tasks)) {
            await this.loadTasks();
        } else {
            this.tasks = [];
            await this.loadTasks();
        }
    } catch (error) {
        // 错误恢复机制
        try {
            await this.loadTasks();
        } catch (reloadError) {
            console.error('重新加载失败:', reloadError);
        }
    }
}
```

### 4. 优化交互体验
- 为删除选项添加点击事件
- 延迟绑定事件确保DOM准备就绪
- 添加详细的调试日志

## 修复的文件

### 1. `frontend/js/utils.js`
- 修改`confirmDialog`方法支持HTML内容
- 添加事件绑定确保交互正常
- 支持取消回调和自定义标题

### 2. `frontend/js/todo.js`
- 增强`showRecurringDeleteDialog`方法
- 改进`performDelete`方法的错误处理
- 添加调试信息和安全检查

## 测试场景

### ✅ 1. 周期性任务删除对话框显示
- 对话框正确显示HTML内容
- 删除选项可以正常选择
- 视觉样式正常显示

### ✅ 2. 删除选项交互
- 点击选项可以选中对应的单选按钮
- 选中状态正确反映
- 确认时能正确获取选择的值

### ✅ 3. 删除操作执行
- 单个删除正常工作
- 整个周期删除正常工作
- 删除后页面正确重新渲染

### ✅ 4. 错误处理
- 删除失败时显示错误信息
- 页面状态保持一致
- 有恢复机制确保数据同步

## 调试信息

修复后添加了详细的控制台日志：
```
显示周期性任务删除对话框: {task}
对话框内容已创建
confirmDialog已调用
确认删除回调被调用
找到的选中单选框: <input>
删除选项: single deleteAll: false
开始执行删除操作: {taskId, deleteAll}
删除API响应: {response}
删除前任务数量: X
删除后任务数量: Y
```

## 使用说明

1. **删除单个周期性任务**：
   - 点击删除按钮
   - 选择"仅删除此任务"
   - 点击确认

2. **删除整个周期**：
   - 点击删除按钮
   - 选择"删除整个周期"
   - 点击确认

3. **调试**：
   - 打开浏览器开发者工具
   - 查看控制台日志
   - 验证删除操作流程

所有修复都确保了向后兼容性，不会影响现有的普通任务删除功能。
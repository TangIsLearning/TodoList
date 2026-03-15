# 日志功能使用说明

## 概述

本项目已添加日志记录功能，支持前后端日志统一记录到文件。

## 日志位置

### Windows 打包应用
日志文件位于：`TodoList.exe所在目录/logs/`

### 开发环境
日志文件位于：`项目根目录/logs/`

## 日志文件

- `app.log` - 应用启动和关闭日志
- `backend.log` - 后端操作日志
- `frontend.log` - 前端操作日志

## 日志特性

1. **自动轮转**：单个日志文件最大 10MB，自动保留最近 5 个备份
2. **时间戳**：每条日志包含精确的时间戳
3. **日志级别**：支持 DEBUG, INFO, WARNING, ERROR, CRITICAL 五个级别
4. **双输出**：同时输出到文件和控制台

## 前端日志记录

前端可以通过 `Logger` 对象记录日志：

```javascript
// 记录信息
Logger.info('应用初始化完成', 'App');

// 记录警告
Logger.warning('数据库连接超时', 'Todo');

// 记录错误
Logger.error('保存任务失败: ' + error, 'Todo');
```

## 后端日志记录

后端代码已集成日志记录，示例：

```python
from backend.utils.logger import backend_logger, app_logger

# 记录应用日志
app_logger.info("应用启动成功")

# 记录后端日志
backend_logger.info("数据库连接成功")
backend_logger.error("操作失败")
```

## 使用示例

### 开发环境运行

```bash
python main.py
```

日志将输出到控制台并写入 `logs/app.log`, `logs/backend.log`, `logs/frontend.log`

### 打包应用

```bash
pyinstaller TodoList.spec
```

运行 `dist/TodoList/TodoList.exe`，日志将生成在 `dist/TodoList/logs/` 目录下

## 查看日志

### Windows
```cmd
type logs\app.log
```

### Linux/Mac
```bash
cat logs/app.log
```

### 实时查看日志
```bash
# Windows (PowerShell)
Get-Content logs\app.log -Wait

# Linux/Mac
tail -f logs/app.log
```

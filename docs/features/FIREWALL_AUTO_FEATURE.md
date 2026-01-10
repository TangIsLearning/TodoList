# P2P防火墙自动管理功能说明

## 功能概述

TodoList应用现在支持在桌面端（Windows系统）启动P2P共享时，**自动配置防火墙规则**，确保其他设备可以访问该端口。当停止共享时，自动删除防火墙规则，保持系统安全。

## 功能特性

### 1. 自动检测环境
- 自动识别操作系统（Windows/macOS/Linux）
- 仅在Windows系统上执行防火墙管理
- 非Windows系统跳过防火墙配置

### 2. 自动添加防火墙规则
- 启动P2P服务器时自动执行
- 添加TCP入站规则，开放指定端口（默认5353）
- 规则名称：`TodoList P2P Server`
- 适用配置文件：所有网络（专用、公用）

### 3. 自动删除防火墙规则
- 停止P2P服务器时自动执行
- 自动清理之前添加的防火墙规则
- 即使服务器启动失败也会清理防火墙规则

### 4. 权限检测
- 自动检测当前用户是否有管理员权限
- 无管理员权限时提供友好的提示信息
- 提供手动配置防火墙的指导

### 5. 异常处理
- 防火墙配置失败不影响服务器启动
- 提供详细的错误信息和日志
- 服务器启动失败时自动清理防火墙规则

## 技术实现

### 核心模块

#### 1. `backend/p2p/firewall_manager.py`
防火墙管理器类，负责添加和删除Windows防火墙规则。

**主要方法：**
- `is_rule_exists()`: 检查规则是否存在
- `add_rule()`: 添加防火墙规则
- `remove_rule()`: 删除防火墙规则
- `get_rule_info()`: 获取规则详细信息
- `is_admin()`: 检查管理员权限

#### 2. `backend/p2p/p2p_server.py`
P2P服务器类，集成防火墙管理功能。

**主要改进：**
- 构造函数添加`auto_manage_firewall`参数
- `start()`方法返回`(success, message)`元组
- 启动时自动调用`firewall_manager.add_rule()`
- `stop()`方法返回`(success, message)`元组
- 停止时自动调用`firewall_manager.remove_rule()`

## 使用示例

### 启动P2P共享（自动配置防火墙）
```python
from backend.p2p.p2p_server import P2PServer

# 创建服务器（默认启用防火墙自动管理）
server = P2PServer(port=5353, auto_manage_firewall=True)

# 设置数据回调
def data_callback():
    return {'test': 'data'}

server.set_data_request_callback(data_callback)

# 启动服务器（自动添加防火墙规则）
success, message = server.start(data_callback)
print(message)  # 输出：服务器启动成功（防火墙规则添加成功）
```

### 停止P2P共享（自动删除防火墙）
```python
# 停止服务器（自动删除防火墙规则）
success, message = server.stop()
print(message)  # 输出：服务器已停止（防火墙规则删除成功）
```

## 手动管理防火墙规则

### 查看规则
```powershell
netsh advfirewall firewall show rule name="TodoList P2P Server"
```

### 手动添加规则
```powershell
netsh advfirewall firewall add rule name="TodoList P2P Server" dir=in action=allow protocol=TCP localport=5353
```

### 手动删除规则
```powershell
netsh advfirewall firewall delete rule name="TodoList P2P Server"
```

## 权限要求

### Windows系统
- **推荐**: 以管理员身份运行应用
- **最低**: 普通用户（需要手动配置防火墙）

### 以管理员身份运行的方法

**方法1: 右键菜单**
1. 右键点击应用（`main.exe`或Python脚本）
2. 选择"以管理员身份运行"

**方法2: 命令行**
```powershell
# PowerShell
Start-Process python.exe -ArgumentList "main.py" -Verb RunAs
```

## 测试

运行测试脚本验证功能：
```bash
python test_firewall_auto.py
```

测试内容：
1. 防火墙管理器基本功能
2. P2P服务器自动防火墙管理
3. P2P服务器禁用防火墙管理
4. 防火墙规则清理

## 故障排查

### 问题1: 防火墙规则添加失败
**症状**: 显示"添加防火墙规则失败：访问被拒绝"

**原因**: 当前用户没有管理员权限

**解决方案**:
1. 以管理员身份运行应用
2. 或手动添加防火墙规则

### 问题2: 规则添加成功但仍无法连接
**检查项**:
1. 确认两台设备在同一网段
2. 确认服务器确实在运行
3. 检查是否有其他安全软件阻止

## 安全考虑

### 1. 最小权限原则
- 只开放必要的端口（5353）
- 只允许TCP协议
- 只在共享期间开放规则

### 2. 自动清理
- 停止共享时自动删除规则
- 服务器启动失败时自动清理
- 避免留下安全漏洞

## 相关文档

- `FIREWALL_CONFIG_GUIDE.md` - Windows防火墙配置详细指南
- `FIREWALL_QUICK_FIX.md` - 防火墙快速修复指南
- `test_firewall_auto.py` - 防火墙自动管理测试脚本

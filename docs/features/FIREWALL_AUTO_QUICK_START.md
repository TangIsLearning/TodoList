# P2P防火墙自动管理 - 快速开始

## 🎯 功能说明

当桌面端启动P2P数据共享时，应用会**自动配置Windows防火墙**，开放所需端口，确保其他设备可以访问。停止共享时，自动删除防火墙规则。

## ✅ 使用方法

### 方式1: 正常启动应用（推荐，自动UAC）

1. 正常启动TodoList应用
2. 点击"开始共享"启动P2P服务
3. 系统会弹出UAC提示框（如果需要管理员权限）
4. 点击"是"允许提升权限
5. 防火墙规则自动添加
6. 其他设备可以正常连接

**✨ 完全自动，只需点击"是"！**

### 方式2: 以管理员身份运行（完全自动）

1. 右键点击 TodoList 应用或 main.py
2. 选择 "以管理员身份运行"
3. 启动P2P共享，防火墙规则会自动添加（无需UAC提示）
4. 停止P2P共享，防火墙规则会自动删除

**✨ 最方便，完全自动！**

### 方式3: 使用批处理脚本（备用）

如果自动配置失败，使用批处理脚本：

**添加防火墙规则：**
1. 右键点击 `setup_firewall.bat`
2. 选择"以管理员身份运行"
3. 等待配置完成

**删除防火墙规则：**
1. 右键点击 `remove_firewall.bat`
2. 选择"以管理员身份运行"
3. 等待删除完成

### 方式4: 手动配置（高级用户）

**如果自动配置失败，手动执行以下命令：**

### PowerShell（管理员）
```powershell
netsh advfirewall firewall add rule name="TodoList P2P Server" dir=in action=allow protocol=TCP localport=5353
```

### 图形界面

1. Win + I → 网络和 Internet → Windows 安全中心
2. 防火墙和网络保护 → 允许应用通过防火墙
3. 更改设置 → 勾选 python.exe 或 TodoList.exe
4. 勾选 "专用" 和 "公用" → 确定

## 📝 验证配置

### 方法1: 检查防火墙规则
```powershell
netsh advfirewall firewall show rule name="TodoList P2P Server"
```

### 方法2: 实际测试
1. 桌面端启动P2P共享
2. 移动端扫描局域网设备
3. 应该能发现桌面端设备

## 🐛 故障排查

### 问题: 防火墙规则添加失败
**原因**: 没有管理员权限或UAC被拒绝
**解决**:
1. 点击UAC提示框中的"是"按钮
2. 或使用批处理脚本 `setup_firewall.bat`
3. 或以管理员身份运行应用

### 问题: 规则已添加但仍无法连接
**检查**:
1. 两台设备是否在同一网段（如192.168.125.x）
2. 服务器是否正常运行
3. 是否有其他安全软件阻止

### 问题: 停止共享后规则未删除
**解决**: 手动删除规则
```powershell
netsh advfirewall firewall delete rule name="TodoList P2P Server"
```

## 📚 更多信息

- 详细文档: `FIREWALL_AUTO_FEATURE.md`
- 配置指南: `FIREWALL_CONFIG_GUIDE.md`
- 权限问题修复: `FIREWALL_PERMISSION_FIX.md`
- 快速修复: `FIREWALL_QUICK_FIX.md`
- 测试脚本: `test_firewall_auto.py`

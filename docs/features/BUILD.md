# TodoList 应用打包指南

## 📦 打包说明

本指南说明如何将TodoList应用打包为独立的Windows可执行文件（.exe）。

## 🛠️ 打包前准备

### 1. 环境要求
- Python 3.8 或更高版本
- Windows 操作系统
- 管理员权限（用于安装包）

### 2. 安装依赖
```bash
pip install -r requirements.txt
```

## 🚀 一键打包

### 方法一：使用批处理脚本（推荐）
```bash
# 在scripts/build目录下双击运行或在命令行中执行
build.bat
```

### 方法二：使用Python脚本
```bash
python build.py
```

## 📁 打包结果

打包完成后，会在项目根目录生成以下文件：

```
TodoList/
├── dist/                    # 打包输出目录
│   ├── TodoList.exe         # 主程序
│   ├── start.bat           # 启动脚本
│   ├── _internal/          # 程序依赖文件
│   └── ...                # 其他资源文件
├── TodoList_Setup.zip      # 安装包（zip格式）
└── build.log               # 构建日志（如果存在）
```

## 🎯 部署说明

### 方法一：直接复制
1. 将整个 `dist` 文件夹复制到目标电脑
2. 双击 `TodoList.exe` 运行应用
3. 或使用 `start.bat` 脚本启动

### 方法二：安装包部署
1. 将 `TodoList_Setup.zip` 复制到目标电脑
2. 解压zip文件
3. 运行解压后的 `TodoList.exe`

## ⚙️ 配置说明

### 自定义图标
1. 准备一个 `.ico` 格式的图标文件
2. 将其命名为 `todo_icon.ico` 放在项目根目录
3. 重新运行打包脚本

### 修改版本信息
编辑 `version_info.txt` 文件：
- `FileVersion`: 文件版本
- `ProductVersion`: 产品版本
- `CompanyName`: 公司名称
- `FileDescription`: 文件描述

## 🔧 故障排除

### 常见问题

#### 1. 打包失败
- 检查Python环境是否正确
- 确保所有依赖已安装：`pip install pyinstaller pywebview`
- 查看错误日志，根据提示修复

#### 2. 运行时找不到文件
- 确保 `dist` 文件夹中的所有文件都完整复制
- 检查 `_internal` 文件夹是否存在
- 尝试使用 `start.bat` 启动

#### 3. 应用启动失败
- 检查目标系统是否缺少运行库
- 尝试以管理员权限运行
- 查看Windows事件查看器中的错误信息

#### 4. 界面显示异常
- 检查系统的Webview2运行时是否安装
- 下载并安装 Microsoft Edge Webview2

### 获取帮助
如果遇到其他问题，请检查：
1. 构建日志中的错误信息
2. Windows事件查看器
3. 系统是否安装了必要的运行时库

## 📋 依赖说明

### 核心依赖
- `pywebview`: 创建桌面应用窗口
- `pyinstaller`: 打包为可执行文件

### 系统要求
- Windows 10/11
- Microsoft Edge Webview2（通常已预装）
- 至少 100MB 可用磁盘空间

## 🔄 更新应用

当应用代码更新后：
1. 重新运行打包脚本
2. 用新的 `dist` 文件夹替换旧版本
3. 用户数据（数据库文件）会自动保留

## 📝 许可证

打包后的应用包含以下开源组件：
- Python
- PyWebView
- PyInstaller
- SQLite

请确保遵守相应的开源许可证。
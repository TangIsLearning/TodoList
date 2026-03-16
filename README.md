# TodoList 跨平台待办事项应用

一个功能完善的待办事项管理应用，支持桌面端和安卓移动端，帮助用户高效管理日常任务和项目。

## 📋 项目简介

TodoList是一款真正跨平台的待办事项管理应用，基于Python和Web技术开发，同时支持桌面端（Windows、macOS、Linux）和移动端，提供直观的用户界面和丰富的功能，帮助用户在不同设备上无缝管理个人任务。

## ✨ 核心功能

### 基础功能
- **任务管理**：创建、编辑、删除任务，标记完成/未完成
- **任务分类**：创建分类、为任务添加分类、按分类筛选
- **优先级管理**：高、中、低、无优先级设置
- **截止日期**：设置任务截止日期和提醒时间
- **搜索与筛选**：关键词搜索、按状态/日期/标签筛选
- **统计报表**：任务完成统计和分析
- **任务提醒**：通过系统通知和桌面图标提醒任务到期（目前仅支持桌面端）

### 高级功能
- **数据共享**：支持局域网内P2P数据共享和接收
- **响应式设计**：适配不同屏幕尺寸
- **深色/浅色主题**：保护眼睛，支持系统级主题切换
- **国际化功能**：支持快速切换语言，目前支持简体中文和英语
- **桌面端特色功能-窗口置顶**：支持窗口置顶功能
- **桌面端特色功能-开机自启动功能**：支持配置开机自启动
- **桌面端特色功能-数据自定义存储**：支持自定义配置数据文件存储路径
- **移动端特色功能-坚果云数据同步**：支持配置坚果云数据同步

### 支持平台
- **桌面端**：Windows、macOS、Linux
- **移动端**：Android、 iOS

*\*说明：理论上支持macOS、Linux和iOS，但是由于开发者无相关设备或环境，无法测试，请自行测试。*

## 🚀 快速开始

### 安装方法

#### 桌面端安装

**环境要求**：
- Python >= 3.10.9

**安装步骤**：
```bash
# 1. 克隆项目（如果从仓库）
git clone <repository-url>
cd TodoList

# 2. 安装Python依赖
pip install -r requirements.txt

# 3. 启动应用
python main.py

# 4. 打包应用生成exe(可选)
python build.py
```

*\*说明：build脚本使用默认图标，可以通过scripts/utils/create_icon.py生成自定义图标置于根目录即可自动打包到exe中。*

#### 安卓移动端安装

**方式一：使用预构建APK**
1. 从项目发布页面下载最新的APK文件
2. 在安卓设备上启用「未知来源」安装
3. 安装下载的APK文件
4. 打开应用开始使用

**方式二：手动构建APK**

**环境要求**：
- Python >= 3.10.9
- Buildozer
- Android SDK和NDK

**构建步骤**：
```bash
# 1. 安装Buildozer
pip install buildozer

# 2. 初始化Buildozer（如果尚未初始化）
buildozer init

# 3. 构建APK
buildozer android debug

# 4. 安装APK到设备
buildozer android deploy run
```

*\*说明：buildozer配置文件可以参考scripts/config/buildozer.spec。*

## 🔧 技术栈

- **前端**：HTML5 + CSS3 + JavaScript (ES6+)
- **桌面框架**：Python + PyWebView
- **后端**：Python 3.10.9+
- **数据库**：SQLite（本地存储）
- **构建工具**：Buildozer(用于构建安卓应用) + PyInstaller(用于桌面构建)

## 📁 项目结构

```
TodoList/
├── backend/           # 后端API和数据库操作
├── frontend/          # 前端界面和交互逻辑
├── data/             # 数据库文件
├── docs/             # 项目文档资料
├── scripts/          # 脚本归档
├── TodoList.spec     # PyInstaller配置文件（用于桌面构建）
├── build.py          # 桌面端应用构建脚本
├── main.py           # 桌面端应用启动脚本
├── requirements.txt  # 项目所需的依赖包
└── README.md         # 项目说明
```

*\*说明：启动项目核心仅需要backend目录、frontend目录和main.py即可。*

## 🛠️ 故障排除

### 桌面端常见问题

1. **应用无法启动**
   - 尝试: `python main.py`
   - 检查Python版本是否 >= 3.10.9
   - 确认依赖包已安装: `pip install pywebview`

2. **数据同步失败**
   - 确保设备在同一局域网
   - 检查防火墙设置
   - 确认目标设备已启动共享

3. **防火墙配置失败**
   - 以管理员身份运行应用
   - 或手动添加防火墙规则

4. **数据库错误**
   - 检查data目录是否存在且可写
   - 删除data/todo.db重新初始化

### 安卓移动端常见问题

1. **APK安装失败**
   - 确保已启用「未知来源」安装
   - 检查设备存储空间是否充足
   - 尝试下载最新版本的APK

2. **应用崩溃**
   - 清理应用缓存
   - 检查安卓系统版本是否兼容
   - 尝试重新安装应用

3. **数据同步失败**
   - 确保移动设备和桌面设备在同一局域网
   - 检查移动设备的网络权限
   - 确认桌面端已启动共享服务

4. **构建APK失败**
   - 确保安装了完整的Android SDK和NDK
   - 检查Buildozer配置文件
   - 尝试使用最新版本的Buildozer

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'Add some xxx'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 GPLv3 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系方式

如有问题或建议，请通过以下方式联系：
- 提交 Issue
- 邮件联系：tangstudy@foxmail.com
- 微信公众号留言：[微信公众号](/docs/wechat.jpg)
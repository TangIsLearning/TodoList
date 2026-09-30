# TodoList 跨平台待办事项应用

一个极简、无广告、无需登录的跨平台待办事项管理应用，参考 Microsoft Todo，数据默认存储在本地。支持桌面端与安卓移动端，帮助用户高效管理日常任务和项目。

## 📋 项目简介

TodoList是一款真正跨平台的待办事项管理应用，基于Python和Web技术开发，同时支持桌面端（Windows、macOS、Linux）和移动端，提供直观的用户界面和丰富的功能，帮助用户在不同设备上无缝管理个人任务。

## ✨ 核心功能

| 模块 | 说明 |
|---|---|
| 任务管理 | 新建、编辑、删除、查看、完成待办；支持标题、描述、优先级、截止时间与提醒 |
| 周期任务 | 支持每天/每周/每月/每年、多时间点、间隔提醒、按次数/结束日期/永不截止，并支持 cron 表达式 |
| 分类与标签 | 支持分类管理、标签管理、标签编辑；支持多标签、多关键词“或”搜索 |
| 子任务 | 支持嵌套子任务，任务旁显示「📋」标识，可快速展开查看 |
| 附件 | v1.2.0 新增，支持关联文件、文件夹和在线链接 |
| 快捷操作 | `Ctrl + Space` 快速新建；`#` 标签、`@` 截止时间、`*` 分类，支持 Tab 补全分类 |
| 视图管理 | 列表视图、日历视图、时间轴视图、统计视图；时间轴支持拖拽修改截止时间 |
| 数据与同步 | SQLite 本地存储、数据导出、局域网共享、WebDAV/坚果云同步、自定义存储路径 |
| 个性化 | 深色/浅色/自定义主题、中英文切换、窗口置顶、开机启动、快捷键配置、窗口自适应 |
| 平台支持 | 桌面端：Windows、macOS、Linux；移动端：Android、iOS（macOS/Linux/iOS 未充分测试） |

## 🚀 快速开始

### 桌面端安装

**环境要求**：
- Python = 3.10.9

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

### 安卓移动端安装

**方式一：使用预构建 APK**

1. 从项目发布页面下载最新 APK。
2. 在安卓设备上启用「未知来源」安装。
3. 安装并打开应用。

**方式二：手动构建 APK**

**环境要求**：Python = 3.10.9、Buildozer、Android SDK 和 NDK

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
- **后端**：Python 3.10.9
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

## 📄 许可证

本项目采用 GPLv3 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## ~~📞 联系方式~~ 本仓库已封板，不再提供维护工作
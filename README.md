# Todo List 桌面应用

一个功能完善的待办事项管理桌面应用，帮助用户高效管理日常任务和项目。

## 功能需求分析

### 核心功能
1. **任务管理**
   - ✅ 创建新任务
   - ✏️ 编辑任务内容
   - 🗑️ 删除任务
   - ☑️ 标记任务完成/未完成

2. **任务分类**
   - 📁 创建分类/标签
   - 🏷️ 为任务添加分类
   - 🔍 按分类筛选任务
   - 🗑️ 删除分类（自动处理相关任务）

3. **优先级管理**
   - 🔴 高优先级
   - 🟡 中优先级  
   - 🟢 低优先级
   - ⚪ 无优先级

4. **截止日期**
   - 📅 设置截止日期
   - ⏰ 设置提醒时间
   - 🔔 到期提醒通知

5. **搜索与筛选**
   - 🔍 关键词搜索
   - 📊 按状态筛选（已完成/未完成）
   - 📅 按日期范围筛选
   - 🏷️ 按标签筛选

### 高级功能
1. **数据持久化**
   - 💾 本地数据库存储
   - 📤 数据导出（JSON/CSV）
   - 📥 数据导入

2. **P2P数据传输**
   - 🌐 局域网内设备数据共享
   - 🔄 设备间数据同步
   - 🔒 自动防火墙配置（Windows）
   - 🚀 UAC自动权限提升（Windows）
   - 📱 跨平台支持（桌面端+移动端）
   - 📦 完整数据导入/导出

3. **统计与报表**
   - 📈 任务完成统计
   - 📊 每日/每周/每月报告
   - 🏆 成就系统

3. **用户界面**
   - 🌙 深色/浅色主题切换
   - 📱 响应式设计
   - ⌨️ 快捷键支持
   - 📅 日历视图

4. **系统集成**
   - 🔔 系统通知
   - 🚀 开机自启动
   - 📋 系统托盘集成

## 技术栈

### 推荐方案
- **前端技术**: HTML5 + CSS3 + JavaScript (ES6+)
- **桌面框架**: Python + PyWebView
- **后端逻辑**: Python 3.8+
- **数据库**: SQLite（本地存储）
- **UI框架**: 原生CSS/可选Bootstrap或Tailwind CSS
- **数据交互**: JavaScript与Python通过webview桥接通信
- **样式**: CSS3 / Flexbox / Grid

### 开发环境
- Python 3.8+
- 现代浏览器（用于开发调试）
- Git
- 代码编辑器（VS Code推荐）

## 项目结构

```
todo-desktop-app/
├── frontend/               # 前端文件
│   ├── index.html          # 主页面
│   ├── css/                # 样式文件
│   │   ├── main.css
│   │   ├── components.css
│   │   └── themes.css
│   ├── js/                 # JavaScript文件
│   │   ├── main.js         # 主逻辑
│   │   ├── todo.js         # 待办事项管理
│   │   ├── category.js     # 分类管理
│   │   ├── storage.js      # 本地存储
│   │   └── utils.js        # 工具函数
│   ├── assets/             # 静态资源
│   │   ├── icons/
│   │   └── images/
│   └── components/         # 组件HTML片段
├── backend/                # Python后端
│   ├── main.py             # 主程序入口
│   ├── database/           # 数据库相关
│   │   ├── __init__.py
│   │   ├── models.py       # 数据模型
│   │   └── operations.py   # 数据库操作
│   ├── api/                # API接口
│   │   ├── __init__.py
│   │   └── todo_api.py
│   ├── utils/              # Python工具函数
│   │   └── __init__.py
│   └── config.py           # 配置文件
├── data/                   # 数据存储目录
│   └── todo.db             # SQLite数据库
├── tests/                  # 测试文件
│   ├── test_frontend.html
│   └── test_backend.py
├── docs/                   # 文档
├── requirements.txt        # Python依赖
├── README.md
├── .gitignore
└── run.py                  # 启动脚本
```

## 开发计划

### 第一阶段（MVP）✅ 已完成
- [x] 基础任务CRUD功能
- [x] 本地数据存储
- [x] 简单的用户界面
- [x] 任务完成状态切换

### 第二阶段（增强功能）✅ 已完成
- [x] 任务分类系统
- [x] 优先级设置
- [x] 截止日期和提醒
- [x] 搜索和筛选功能

### 第三阶段（高级功能）✅ 已完成
- [x] 数据导入导出（本地存储支持）
- [x] 统计报表（基础统计）
- [x] 主题切换（深色/浅色）
- [x] 快捷键支持

### 第四阶段（优化完善）✅ 已完成
- [x] 性能优化
- [x] 用户体验改进
- [x] 错误处理
- [x] 自动化测试

### 第五阶段（日历视图功能）✅ 已完成
- [x] 日历视图开发
- [x] 视图切换功能
- [x] 日期任务显示
- [x] 日期点击跳转
- [x] 功能文档更新

### 项目结构

```
TodoList/
├── backend/           # 后端API和数据库操作
├── frontend/          # 前端界面和交互逻辑
├── data/             # 数据库文件
├── docs/             # 项目文档
│   └── features/     # 功能详细说明
├── tests/            # 测试文件
└── README.md         # 项目说明
```

## 安装和运行

#### 方式一：自动安装（推荐）

**Windows用户：**
```bash
# 双击运行
install.bat
```

**macOS/Linux用户：**
```bash
# 给脚本执行权限并运行
chmod +x install.sh
./install.sh
```

#### 方式二：手动安装

**环境要求：**
- Python >= 3.8
- 现代浏览器（用于开发调试）

**手动安装步骤：**
```bash
# 1. 克隆项目（如果从仓库）
git clone <repository-url>
cd todo-desktop-app

# 2. 创建虚拟环境（推荐）
python -m venv venv

# 3. 激活虚拟环境
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# 4. 安装Python依赖
pip install -r requirements.txt

# 5. 启动应用
python main.py
# 或者
python backend/main.py
```

**启动应用：**

> 🎯 **推荐方式 - 使用简单启动脚本**
> ```bash
> python start_simple.py
> ```

**其他启动方式：**
```bash
# 方式1: 使用原始启动脚本
python main.py

# 方式2: 直接运行main.py
python run_direct.py

# 方式3: 手动运行（如果安装脚本已生成）
# Windows: 双击 start.bat
# macOS/Linux: ./start.sh
```

**如果遇到导入错误：**
1. 首先尝试: `python start_simple.py`
2. 如果还失败，检查: `python test_imports.py`
3. 最后尝试: `python backend/main.py`（在backend目录下运行）

### 打包为可执行文件
```bash
# 安装PyInstaller
pip install pyinstaller

# 打包命令
pyinstaller --windowed --onefile main.py
```

## 数据模型

### Task（任务）
```python
# Python数据模型
class Task:
    def __init__(self, id, title, description=None, completed=False, 
                 priority='none', category_id=None, due_date=None):
        self.id = id  # str: UUID
        self.title = title  # str
        self.description = description  # str, optional
        self.completed = completed  # bool
        self.priority = priority  # str: 'high', 'medium', 'low', 'none'
        self.category_id = category_id  # str, optional
        self.due_date = due_date  # datetime, optional
        self.created_at = datetime.now()  # datetime
        self.updated_at = datetime.now()  # datetime
```

```javascript
// JavaScript数据模型
class Task {
    constructor(data) {
        this.id = data.id || this.generateId();
        this.title = data.title || '';
        this.description = data.description || '';
        this.completed = data.completed || false;
        this.priority = data.priority || 'none';
        this.categoryId = data.categoryId || null;
        this.dueDate = data.dueDate || null;
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
    }
    
    generateId() {
        return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}
```

### Category（分类）
```python
# Python数据模型
class Category:
    def __init__(self, id, name, color='#007bff'):
        self.id = id  # str: UUID
        self.name = name  # str
        self.color = color  # str: HEX颜色值
        self.created_at = datetime.now()  # datetime
```

```javascript
// JavaScript数据模型
class Category {
    constructor(data) {
        this.id = data.id || this.generateId();
        this.name = data.name || '';
        this.color = data.color || '#007bff';
        this.createdAt = data.createdAt || new Date();
    }
    
    generateId() {
        return 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}
```

## 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 联系方式

如有问题或建议，请通过以下方式联系：
- 提交 Issue
- 发送邮件
- 项目讨论区

---

## 依赖文件（requirements.txt）

```txt
pywebview>=4.0.0
```

## 测试

### 后端测试
```bash
# 运行后端单元测试
python tests/test_backend.py
```

### 前端测试
```bash
# 在浏览器中打开前端测试页面
open tests/test_frontend.html
```

## 项目文件结构

```
todo-desktop-app/
├── frontend/               # 前端文件
│   ├── index.html          # 主页面
│   ├── css/                # 样式文件
│   │   ├── main.css
│   │   ├── components.css
│   │   └── themes.css
│   ├── js/                 # JavaScript文件
│   │   ├── main.js         # 主逻辑
│   │   ├── todo.js         # 待办事项管理
│   │   ├── category.js     # 分类管理
│   │   ├── storage.js      # 本地存储
│   │   └── utils.js        # 工具函数
├── backend/                # Python后端
│   ├── main.py             # 主程序入口
│   ├── database/           # 数据库相关
│   │   ├── __init__.py
│   │   ├── models.py       # 数据模型
│   │   └── operations.py   # 数据库操作
│   ├── api/                # API接口
│   │   ├── __init__.py
│   │   └── todo_api.py
│   ├── utils/              # Python工具函数
│   │   └── __init__.py
│   └── config.py           # 配置文件
├── data/                   # 数据存储目录
│   └── .gitkeep
├── tests/                  # 测试文件
│   ├── test_frontend.html
│   └── test_backend.py
├── docs/                   # 文档
├── requirements.txt        # Python依赖
├── README.md
├── .gitignore
├── install.sh             # Linux/macOS安装脚本
├── install.bat            # Windows安装脚本
├── start.sh               # Linux/macOS启动脚本
├── start.bat              # Windows启动脚本
└── run.py                 # 启动脚本
```

## API通信示例

### JavaScript调用Python方法
```javascript
// 在前端JavaScript中调用后端Python方法
async function addTodo(taskData) {
    try {
        const result = await pywebview.api.add_todo(taskData);
        return result;
    } catch (error) {
        console.error('添加任务失败:', error);
    }
}

// 获取任务列表
async function getTodos() {
    try {
        const todos = await pywebview.api.get_todos();
        return todos;
    } catch (error) {
        console.error('获取任务列表失败:', error);
    }
}
```

### Python后端API定义
```python
import webview
from .database.operations import TodoDatabase

class Api:
    def __init__(self):
        self.db = TodoDatabase()
    
    def add_todo(self, task_data):
        """添加新任务"""
        return self.db.add_task(task_data)
    
    def get_todos(self):
        """获取所有任务"""
        return self.db.get_all_tasks()
    
    def update_todo(self, task_id, task_data):
        """更新任务"""
        return self.db.update_task(task_id, task_data)
    
    def delete_todo(self, task_id):
        """删除任务"""
        return self.db.delete_task(task_id)

def start_app():
    api = Api()
    window = webview.create_window(
        'Todo List App',
        'frontend/index.html',
        js_api=api,
        width=1000,
        height=700,
        resizable=True
    )
    webview.start()
```

## 快捷键

- `Ctrl/Cmd + K`: 聚焦搜索框
- `Ctrl/Cmd + N`: 新建任务
- `Escape`: 关闭所有模态框
- `数字键 1-9`: 快速筛选分类

## 特色功能

- 🎨 **深色/浅色主题切换**: 支持系统级主题切换，保护眼睛
- 📊 **实时统计**: 显示任务完成率和分类统计
- 🔄 **本地数据持久化**: 基于SQLite的可靠数据存储
- ⌨️ **快捷键支持**: 提高操作效率的键盘快捷键
- 📱 **响应式设计**: 适配不同屏幕尺寸
- 🔍 **智能搜索**: 支持标题和描述的全文搜索
- 🏷️ **分类管理**: 灵活的任务分类和颜色标识
- 🗑️ **安全删除**: 智能分类删除，自动处理相关任务
- ⏰ **截止日期提醒**: 支持任务截止日期设置和过期提醒

## 故障排除

### 🚨 启动失败解决方案

**如果你遇到了导入错误，请按以下顺序尝试：**

1. **首选方案**：`python start_simple.py`
   - 这个脚本专门解决了导入路径问题

2. **测试导入**：`python test_imports.py`
   - 检查具体哪个模块导入失败

3. **直接运行**：`python backend/main.py`
   - 在backend目录下直接运行

4. **最简单方式**：`python run_direct.py`
   - 使用subprocess间接运行

### 常见问题

1. **应用无法启动**
   - ✅ 首先尝试: `python start_simple.py`
   - 检查Python版本是否 >= 3.8
   - 确认虚拟环境已正确激活
   - 验证依赖包是否安装完整: `pip install pywebview`

2. **导入错误 (ModuleNotFoundError)**
   - ✅ 使用: `python start_simple.py`
   - 检查工作目录是否正确
   - 运行: `python test_imports.py` 诊断问题

3. **数据库错误**
   - 检查data目录是否存在且可写
   - 删除data/todo.db重新初始化

4. **前端页面空白**
   - 检查浏览器控制台错误信息
   - 确认前端文件路径正确
   - 检查frontend/index.html是否存在

5. **PyWebView相关错误**
   - 更新到最新版本的PyWebView: `pip install --upgrade pywebview`
   - 检查系统是否支持WebView组件
   - Windows确保安装了最新的Visual C++ Redistributable

---

**开发状态**: ✅ 开发完成  
**当前版本**: v1.0.0  
**最后更新**: 2025-12-21  
**技术栈**: Python + PyWebView + HTML/CSS/JavaScript  
**许可证**: MIT License

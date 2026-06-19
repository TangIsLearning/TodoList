# 多级分类系统（Multi-level Categories）设计

| 字段 | 值 |
|---|---|
| 日期 | 2026-06-19 |
| 子系统 | B（多级分类） |
| 状态 | 设计稿 · 待实施 |
| 前置 | A（用户系统）已就绪 |
| 后续 | C（局域网同步 + 协作组） |

## 1. 范围与目标

### 1.1 目标

将 TodoList 的"分类"从单级字符串升级为**最多 3 级树形结构**，支持：

- 树形管理（侧边栏手风琴 + 拖拽 + 按钮）
- 单任务归属多个分类
- 路径 + AND 筛选
- 任务卡片显示分类 chip（emoji + 颜色）
- 用户/协作组双维度隔离（B 阶段仅用户维度）
- 安全删除（有子级阻止；被引用任务自动清理）

### 1.2 明确排除（不在 B 范围）

- ❌ 协作组维度分类（owner_type='group'） → C 子系统
- ❌ P2P 分类同步 → C 子系统
- ❌ 分类导入/导出 → 不实现
- ❌ 分类模板/智能建议 → 不实现
- ❌ 跨用户分类共享 → 不实现

## 2. 关键设计决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 分类归属 | 按用户+协作组隔离 | 配合 A 的用户模型 |
| 任务关联 | 一任务可多分类 | 灵活表达"技术 + 业务"双标签 |
| 树深度 | 硬限制 3 级 | 简单可理解；3 级足够组织 |
| UI 布局 | 主界面左侧栏手风琴 | 常驻 + 可折叠 + 可拖拽 |
| 拖拽交互 | 4 种全支持 | 节点重组织 / 分类→任务 / 任务→分类 / 按钮后备 |
| 删除策略 | 安全删除 | 有子级阻止；被引用任务自动清理 |
| 筛选行为 | 路径 + AND | 选父级包含子级；多选须同时属于 |
| 视觉表达 | emoji + 8 预设色 | 轻量、易识别、跨平台 |

## 3. 架构概览

### 3.1 三层结构

**数据层**
- 扩展 `categories` 表（7 个新字段）
- 扩展 `tasks` 表（`category_ids` JSON 数组；旧 `category` 标记 deprecated）
- 启动时数据迁移

**业务层（`backend/`）**
- `database/models.py`：增 `Category` 模型
- `database/operations.py`：增 `CategoryManager`（CRUD + 树操作 + 深度校验 + 环检测 + 安全删除 + 拖拽原子事务）
- `api/todo_api.py`：增 8 个 category API；修改 `add_todo/update_todo` 接受 `category_ids`

**前端层（`frontend/`）**
- `js/category.js` 新模块：`CategoryManager`（状态 + 树操作 + 拖拽）
- `js/ui/sidebar.js` 新模块：手风琴侧边栏
- 改造 `index.html`：左侧栏增加分类树区
- `css/components.css`：手风琴 + 树节点 + 拖拽视觉
- 任务表单分类选择器：从单选下拉 → 树形多选面板
- 任务卡片：从分类字符串 → 分类 chip 列表

### 3.2 与其他子系统的边界

- **A → B**：`users.id` 作为 `owner_id`（A 已就绪）
- **B → C**：`owner_type='group'` 由 C 阶段填充；分类通过 P2P 同步（按 owner_id 过滤）

## 4. 数据模型

### 4.1 表 `categories`（扩展现有）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | 分类名称 |
| `parent_id` | TEXT | | 父分类 ID（顶级为 NULL） |
| `depth` | INTEGER | NOT NULL | 层级深度：0=根，1=二级，2=叶子 |
| `owner_type` | TEXT | NOT NULL DEFAULT 'user' | 'user' / 'group'（B 阶段仅 user） |
| `owner_id` | TEXT | NOT NULL | 归属 user_id / group_id |
| `icon` | TEXT | DEFAULT '📁' | emoji 字符 |
| `color` | TEXT | DEFAULT '#4f46e5' | 8 预设色之一（红橙黄绿青蓝紫灰） |
| `sort_order` | INTEGER | DEFAULT 0 | 兄弟节点排序（同父级内） |
| `is_deleted` | INTEGER | DEFAULT 0 | 软删除 |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |

**索引**：
- `INDEX(owner_type, owner_id, is_deleted)` — 当前用户的分类列表查询
- `INDEX(parent_id, sort_order)` — 同级兄弟节点排序

**唯一约束**：`UNIQUE(owner_type, owner_id, parent_id, name)` — 同父级下名称唯一

**外键**：`parent_id` → `categories.id`（软引用，避免删除时级联）

### 4.2 表 `tasks`（扩展）

新增字段：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `category_ids` | TEXT | | JSON 数组（`["id1","id2"]`）；空数组或 NULL 表示"未分类" |

**保留旧字段** `category`（TEXT，单值）→ 标记 deprecated。

**迁移策略**：
```python
# 启动时数据迁移
if 'category' in old_columns and 'category_ids' not in old_columns:
    cursor.execute('ALTER TABLE tasks ADD COLUMN category_ids TEXT')
    cursor.execute('UPDATE tasks SET category_ids = json_array(category) WHERE category IS NOT NULL')
    # 旧 column 保留，UI 不再使用
```

### 4.3 树操作算法

**深度校验**（创建/移动时）：
```python
def validate_depth(parent_id: str | None) -> int:
    """返回新节点 depth；超过 2 则抛错"""
    if parent_id is None:
        return 0
    parent = get_category(parent_id)
    if parent['depth'] >= 2:
        raise ValueError('DEPTH_EXCEEDED')  # parent 已是叶子
    return parent['depth'] + 1
```

**路径解析**（id → 完整路径字符串）：
```python
def get_category_path(cat_id: str) -> str:
    """返回 "研发 / 后端 / 性能优化" """
    cat = get_category(cat_id)
    parts = [cat['name']]
    while cat['parent_id']:
        cat = get_category(cat['parent_id'])
        parts.append(cat['name'])
    return ' / '.join(reversed(parts))
```

**子树收集**（id → 所有后代 id）：
```python
def get_descendant_ids(cat_id: str) -> list[str]:
    """返回该节点及所有后代 id（用于筛选）"""
    result = [cat_id]
    children = query("SELECT id FROM categories WHERE parent_id = ?", cat_id)
    for child in children:
        result.extend(get_descendant_ids(child['id']))
    return result
```

**筛选（路径 + AND）**：
```python
def filter_tasks_by_categories(task_list, selected_cat_ids: list[str]) -> list:
    if not selected_cat_ids:
        return task_list
    all_included_ids = set()
    for cid in selected_cat_ids:
        all_included_ids.update(get_descendant_ids(cid))
    return [t for t in task_list if any(
        cid in all_included_ids for cid in t['category_ids']
    )]
```

### 4.4 拖拽重组织（原子事务）

```python
def move_category(cat_id, new_parent_id, new_sort_order, current_user_id):
    with transaction():
        # 1. 校验深度
        new_depth = validate_depth(new_parent_id)
        # 2. 校验不形成环
        if new_parent_id and is_descendant(new_parent_id, cat_id):
            raise ValueError('WOULD_CREATE_CYCLE')
        # 3. 更新
        update(cat_id, parent_id=new_parent_id, depth=new_depth, sort_order=new_sort_order)
        # 4. 同步更新所有后代的 depth
        propagate_depth_change(cat_id, new_depth)
```

## 5. UI 流程

### 5.1 主布局（左侧栏 + 手风琴分类树）

```
┌─ 左栏 ─────────────┬─ 主任务列表 ──────────────────────┐
│  [≡ 全部任务]       │  🔍 搜索...                       │
│  [✓ 今天到期]       │  ────────────────────────────────  │
│  [⭐ 重要]          │  ☐ [⚡🔵研发 / 后端] 性能优化      │
│  ──────────────     │       4/15 14:00                  │
│  ▼ 📁 研发 (12)     │  ────────────────────────────────  │
│    ▸ ⚡ 后端 (5)    │  ☐ [📊🟠产品 / 调研] 用户访谈      │
│    ▸ 🎨 前端 (4)    │  ────────────────────────────────  │
│    ▸ 🧪 测试 (3)    │  ☐ [未分类] 阅读 RFC               │
│  ▸ 📁 产品 (8)      │                                    │
│  ▸ 📁 运营 (5)      │                                    │
│  + 新建分类         │                                    │
│                    │                                    │
│  [郭世锋 ▼]        │                                    │
└────────────────────┴────────────────────────────────────┘
```

**手风琴行为**：
- 默认所有父级折叠（只显示根级）
- 点击父级前 ▶/▼ 图标 → 展开/折叠该父级
- **可同时多个父级展开**
- 展开状态保存在前端 localStorage

**视觉**：
- 子级缩进 16px / 孙子级 32px
- 每个节点前显示 emoji 图标 + 颜色块
- 节点右侧显示"任务数"小角标
- 选中态：背景色加深 + 左边竖条强调

### 5.2 树节点右键菜单（按钮后备）

```
┌─ 操作 ─────────┐
│ + 新建子分类    │
│ ✎ 重命名        │
│ 🎨 修改图标/色  │
│ ↑↓ 排序        │
│ ⇄ 移动到...    │
│ ──────────     │
│ 🗑 删除         │
└────────────────┘
```

**"移动到..."** 弹出分类树选择面板（按钮后备）：

```
┌─ 移动分类到 ──────────────┐
│  选择目标父分类            │
│  ◉ 根（顶级）              │
│  ○ 研发                    │
│  ○ 研发 / 后端             │
│  ○ 研发 / 前端             │
│  ○ 产品                    │
│  ────────────────         │
│  提示：移动后该分类及子    │
│  分类深度将自动调整。      │
│  [取消]            [确定]  │
└────────────────────────────┘
```

### 5.3 拖拽交互

**5.3.1 拖拽分类重组织树**
- 拖到另一个分类节点上 0.5s → 该位置显示蓝色边框 + "成为子分类"提示
- 拖到根区域（侧边栏顶部空白）→ "成为顶级"提示
- 拖拽过程中实时校验：
  - 超过 3 级 → 红色边框 + "已达最大深度"提示，**拒绝放置**
  - 形成环（拖到自己后代上）→ 红色边框 + "无法移动到子分类下"提示，**拒绝放置**
- 放置成功 → 后端原子事务更新（parent_id, depth, sort_order）+ 树自动展开新位置

**5.3.2 拖拽分类到任务卡片**
- 拖到任务卡片上 → 卡片高亮 + "+" 提示
- 放置 → 后端将该分类 ID 添加到 `tasks.category_ids` 数组
- UI 任务卡片立即显示新 chip

**5.3.3 拖拽任务到分类**
- 拖到侧边栏分类节点上 → 节点高亮 + "添加分类"提示
- 放置 → 后端将该分类 ID 添加到任务的 `category_ids` 数组
- UI 任务卡片立即显示新 chip

### 5.4 任务表单分类选择器（树形多选面板）

在任务创建/编辑表单中，分类选择器从单选下拉改为**树形多选面板**：

```
┌─ 分类 (可多选) ─────────────────────┐
│  ▼ 研发                              │
│    ☑ ⚡ 后端                          │
│    ☐ 🎨 前端                          │
│    ☐ 🧪 测试                          │
│  ▸ 产品                              │
│  ▸ 运营                              │
│  ────────────────────────────────    │
│  已选：研发 / 后端                    │
│                              [清空]  │
└──────────────────────────────────────┘
```

**行为**：
- 多选 checkbox
- 显示已选路径（"/" 分隔）
- 父级不自动勾选子级（独立选项）
- 超过 3 级时该子节点不显示"+" 新建按钮
- **[清空] 按钮**：清空所有已选项 → 任务变"未分类"（category_ids=[]）
- "未分类"不在面板内多选 —— 而是在侧边栏的"未分类（N）"快捷入口中查看（5.6 节）

### 5.5 任务卡片分类 chip

```
┌──────────────────────────────────┐
│ ☐ [⚡🔵 后端] [📊🟠 调研] ...    │
│   性能优化 sprint                │
│   4/15 14:00 · 👤 郭世锋        │
└──────────────────────────────────┘
```

**chip 视觉**：
- 圆角矩形
- 背景色 = 分类的 color（浅色填充）
- 边框 = 分类的 color（深色边）
- 内容：emoji + 名称（叶子级显示简短名；悬停 tooltip 显示完整路径）
- 鼠标悬停 chip：显示完整路径（"研发 / 后端 / 性能优化"）

### 5.6 任务列表筛选（路径 + AND）

| 操作 | 行为 |
|---|---|
| 单击分类节点 | 选中该分类，任务列表过滤为"该分类及所有后代下的任务"；再次点击同一节点 → 取消选中 |
| Ctrl + 单击 | 多选（AND 关系）：任务须**同时**属于所有所选分类 |
| 多选时 | 节点间显示 "+" 连接符（"研发 + 后端"）；多选 >3 时提示"最多支持 3 个分类联合筛选" |
| 点击顶部"全部任务" | 清空所有分类筛选 |

**筛选状态指示**：
- 顶部显示"已选分类：研发 / 后端 + 性能优化" + 一键清空按钮
- 侧边栏选中节点加深背景

**任务"未分类"显示**：
- 任务列表底部或顶部有"未分类（N）"快捷入口

### 5.7 分类创建模态框

```
┌─ 新建分类 ──────────────────────────────┐
│ 名称 * [                              ]  │
│ 父分类   [研发 / 后端            ▼]      │
│ 图标     [📁  ▼] (emoji 选择器)         │
│ 颜色     [●  ●  ●  ●  ●  ●  ●  ●]      │
│ 排序     [3] (同级内顺序)                │
│                                          │
│ 提示：父分类为"研发/后端"时新分类为叶子  │
│                                          │
│  [取消]                          [保存]  │
└──────────────────────────────────────────┘
```

**emoji 选择器**：常用 emoji 网格（8×6 = 48 个） + 搜索框

**颜色选择器**：8 个预设色圆点（红/橙/黄/绿/青/蓝/紫/灰）

## 6. API 概要

### 6.1 分类 CRUD

| API | 入参 | 返回 |
|---|---|---|
| `category_list` | `{owner_type, owner_id}` | `{success, categories[]}` ——当前用户全部分类（按 sort_order） |
| `category_create` | `{name, parent_id?, icon, color, owner_type, owner_id}` | `{success, category}` |
| `category_update` | `category_id, {name?, icon?, color?, sort_order?}` | `{success, category}` ——改基础信息 |
| `category_move` | `category_id, {new_parent_id, new_sort_order}` | `{success, category}` ——拖拽重组织核心 API |
| `category_delete` | `category_id` | `{success, affected_task_count}` ——返回影响的任务数 |
| `category_get_path` | `category_id` | `{success, path}` ——如"研发 / 后端 / 性能优化" |
| `category_get_descendants` | `category_id` | `{success, ids[]}` ——子树收集，用于筛选 |
| `category_task_count` | `category_id` | `{success, count}` ——含所有后代的任务数 |

### 6.2 任务相关扩展

| API | 修改 |
|---|---|
| `add_todo` | 接受 `category_ids: string[]` 替代旧的 `category: string` |
| `update_todo` | 同上；传 `category_ids=[]` 表示"无分类" |
| `filter_tasks` | 接受 `category_ids: string[]`；后端做路径+AND 筛选（与前端等价） |

## 7. 错误处理

| 场景 | 返回 |
|---|---|
| 创建子级超过 3 级 | `{success:false, error:'DEPTH_EXCEEDED', message:'分类最多支持 3 级'}` |
| 同父级下重名 | `{success:false, error:'DUPLICATE_NAME', message:'同级已有同名分类'}` |
| 移动到自己的后代 | `{success:false, error:'WOULD_CREATE_CYCLE', message:'无法移动到子分类下'}` |
| 删除有子级 | `{success:false, error:'HAS_CHILDREN', message:'请先处理子分类'}` |
| 删除被引用 | 自动移除任务引用，成功返回 `{success:true, affected_task_count: N}` |
| 移动/删除失败 | 事务回滚，UI 提示"操作失败，已撤销" |

## 8. 测试策略

### 8.1 单元测试

- `backend/tests/test_category.py`：`CategoryManager` CRUD、树形查询、深度校验、环检测、软删除与引用清理、sort_order 调整

### 8.2 集成测试

- `backend/tests/test_category_api.py`：完整 API 路径（创建 → 移动 → 删除）、任务引用清理事务、路径 + AND 筛选（1000 任务压测）

### 8.3 前端测试（可选）

- `frontend/tests/category.test.js`：手风琴展开/折叠状态、树形多选面板、拖拽视觉反馈、chip 渲染

### 8.4 手动 UI 验证清单

- [ ] 创建根级 / 二级 / 叶子 三级分类树
- [ ] 试图创建第 4 级 → 失败提示
- [ ] 同父级下重名创建 → 失败
- [ ] 拖拽分类到另一个父级 → 树自动重排
- [ ] 拖拽分类到自己后代 → 失败
- [ ] 拖拽分类到任务卡片 → 任务获得新分类
- [ ] 拖拽任务到分类 → 任务获得该分类
- [ ] 任务表单多选分类 → 任务卡片显示多 chip
- [ ] 单击分类筛选 → 任务列表过滤为该分类及后代
- [ ] Ctrl + 单击多选 → 任务须同时属于所有所选
- [ ] 选 4 个分类 → 提示"最多 3 个"
- [ ] 删除有子级分类 → 失败
- [ ] 删除被引用分类 → 任务从该分类移除（其他保留）
- [ ] 按钮"移动到..."后备可用
- [ ] emoji + 颜色显示正确
- [ ] 展开状态 localStorage 持久化
- [ ] 数据迁移（已有旧 category 字段）正确

## 9. 验收清单

B 子系统实施完成的标准：

1. 侧边栏出现分类树区，**默认折叠**，可手风琴展开
2. 树节点显示 emoji + 颜色 + 任务数
3. 可创建最多 3 级分类（硬限制）
4. 拖拽重组织树（带深度校验、环检测）
5. 拖拽分类到任务 / 拖拽任务到分类 / 按钮后备（4 种交互全通）
6. 删除安全策略生效（有子级阻止；被引用任务自动清理）
7. 任务表单支持多分类选择（树形面板）
8. 任务卡片显示分类 chip（emoji + 色 + 路径 tooltip）
9. 路径 + AND 筛选生效（侧边栏多选 → 任务列表过滤）
10. emoji + 8 预设色选择器可用
11. 单元测试、集成测试全部通过
12. 旧 category 字段数据正确迁移到 category_ids
13. 现有所有功能（任务增删改、WebDAV 同步、提醒）完整无损

## 10. 后续衔接

### 10.1 B → C（局域网同步 + 协作组）

- C 阶段填充 `owner_type='group'` 维度
- 分类数据通过 P2P 同步（按 owner_id 过滤）
- 协作组任务可使用协作组分类
- 协作组的"分类管理"界面与用户维度复用同一套组件

### 10.2 明确不在 B 范围

- 协作组分类 → C
- P2P 同步 → C
- 分类导入/导出 → 不实现
- 分类模板/智能建议 → 不实现
- 跨用户共享 → 不实现

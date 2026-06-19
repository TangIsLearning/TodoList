# 用户系统（User System）设计

| 字段 | 值 |
|---|---|
| 日期 | 2026-06-19 |
| 子系统 | A（用户系统） |
| 状态 | 设计稿 · 待实施 |
| 依赖 | 无（A 是基础，后续 B/C 都依赖 A） |
| 后续 | B（多级分类）、C（局域网同步 + 协作组） |

## 1. 范围与目标

### 1.1 目标

从零引入"用户系统"，将 TodoList 从单用户本地应用升级为支持**多用户档案**的协作基础。完成后：

- 应用启动时支持**多账号选择/创建**
- 主界面左下角展示**当前登录用户**（头像 + 用户名·角色 / 单位·部门 + 在线指示灯）
- 任务模型扩展**主责/协办部门、责任人/协办人、审计日志**
- 所有任务操作产生**字段级审计流水**

### 1.2 明确排除（不在 A 范围）

- ❌ 协作组通信（P2P 消息、连接码、节点发现） → C 子系统
- ❌ 文件传输 → C 子系统
- ❌ 多级分类 → B 子系统
- ❌ 跨设备账号同步（云端账号） → 不实现
- ❌ 密码、加密、远程认证 → 不实现（极简无密码）

## 2. 关键设计决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 认证强度 | 极简无密码 | 桌面端本地应用，简化体验 |
| 用户档案 | display_name + unit + department + role（自我描述）+ 头像色 | 完全自由输入，无预置库 |
| 头像 | 默认首字母 + 渐变色（6 预设） | 轻量、同步无压力 |
| 用户名唯一性 | 仅协作组内唯一（按 unit+department+display_name 三元组） | 本机可建同名但部门不同的账号 |
| 数据隔离 | 个人数据 + 协作组数据并存 | 类似企业微信（个人 + 工作） |
| 角色字段 | 自我描述的文本标签 | 无系统级 admin 角色 |
| 首次启动 | 账号选择页 | 直观、避免误操作 |
| 任务扩展字段 | 个人 + 协作组任务都用 | 模型统一 |
| 审计粒度 | 字段级（旧值/新值） | 便于追踪具体变更 |
| 心跳频率 | 60 秒 | 在线状态精度足够 |
| 心跳超时 | 5 分钟无活动视为离线 | 平衡精度与网络开销 |

## 3. 架构概览

### 3.1 三层结构

**数据层（SQLite 扩展）**
- 新增 `users` 表
- 新增 `user_sessions` 表
- 扩展 `tasks` 表（5 个新字段）
- 新增 `task_audit_log` 表

**业务层（`backend/`）**
- `database/models.py`：增 `User` / `UserSession` / `TaskAuditLog` 模型类
- `database/operations.py`：增 `UserManager`（增删改查 + session 管理）；扩展 `TodoDatabase`（任务审计写入）
- `api/todo_api.py`：增 8 个 auth/user/profile 类 API
- 不实现协作组通信逻辑（留给 C）

**前端层（`frontend/`）**
- `js/user.js` 新模块：`UserManager` 类
- `js/profile.js` 新模块：个人设置模态框
- `index.html`：替换"联系作者"区域为用户卡片 DOM
- `css/components.css`：增加用户卡片样式

### 3.2 与其他子系统的边界

- **A 阶段**用户菜单中"协作组管理"点击 → 显示"功能开发中"占位
- **B 阶段**：分类管理在 A 的用户上下文中工作（多级分类树）
- **C 阶段**：协作组通信基于 A 的 user_id（消息发送者、文件上传者）

## 4. 数据模型

### 4.1 表 `users`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `display_name` | TEXT | NOT NULL | 用户名（昵称） |
| `unit` | TEXT | | 单位（可空） |
| `department` | TEXT | | 部门（可空） |
| `role` | TEXT | | 自我描述角色（可空） |
| `avatar_color` | TEXT | DEFAULT '#4f46e5' | 头像渐变色 |
| `created_at` | TEXT | NOT NULL | ISO 时间 |
| `last_active_at` | TEXT | | ISO 时间（在线状态依据） |
| `is_deleted` | INTEGER | DEFAULT 0 | 软删除 |

**唯一约束**：`UNIQUE(unit, department, display_name)` —— 协作组内三元组唯一；本机不同账号可同 display_name 但 unit+department 不同时可共存。

### 4.2 表 `user_sessions`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `token` | TEXT | PRIMARY KEY | 64 字符随机 token |
| `user_id` | TEXT | NOT NULL | → users.id |
| `created_at` | TEXT | NOT NULL | |
| `last_used_at` | TEXT | NOT NULL | 心跳更新 |

**机制**：应用启动时若 sessions 表有记录，自动恢复登录；多账号同时只能有一个活跃 session（保证"当前用户"语义清晰）。

### 4.3 表 `tasks`（扩展现有表）

新增字段：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `owning_dept_id` | TEXT | | 主责部门（字符串冗余） |
| `cooperating_dept_ids` | TEXT | | 协办部门（JSON 数组） |
| `owner_user_id` | TEXT | | 责任人 → users.id（可空） |
| `cooperator_user_ids` | TEXT | | 协办人（JSON 数组 → users.id） |
| `audit_enabled` | INTEGER | DEFAULT 1 | 是否记录该任务审计 |

### 4.4 表 `task_audit_log`

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `task_id` | TEXT | NOT NULL | → tasks.id |
| `user_id` | TEXT | NOT NULL | → users.id（变更人） |
| `action` | TEXT | NOT NULL | create / update / complete / delete / restore |
| `field` | TEXT | | 变更字段（update 时填） |
| `old_value` | TEXT | | |
| `new_value` | TEXT | | |
| `created_at` | TEXT | NOT NULL | ISO |

### 4.5 不预置的表

- ❌ `units` 表（用户自由输入）
- ❌ `departments` 表（同上）
- ❌ `roles` 表（同上，自我描述自由填）

### 4.6 迁移策略

通过 `database/operations.py` 的 `_migrate_database()` 增量添加：

```python
# 伪代码
new_user_columns = [
    ('owning_dept_id', 'TEXT'),
    ('cooperating_dept_ids', 'TEXT'),
    ('owner_user_id', 'TEXT'),
    ('cooperator_user_ids', 'TEXT'),
    ('audit_enabled', 'INTEGER DEFAULT 1'),
]
for col, defn in new_user_columns:
    if col not in existing_columns:
        cursor.execute(f'ALTER TABLE tasks ADD COLUMN {col} {defn}')

# 新建 users / user_sessions / task_audit_log 表（CREATE TABLE IF NOT EXISTS）
```

**存量数据**：
- 现有 `tasks` 记录：新字段均为 NULL，UI 隐藏扩展字段
- 现有 `categories` 不动（B 阶段处理）
- 现有 `settings` 不动

## 5. UI 流程

### 5.1 首次启动（无任何本地账号）

```
应用启动
  ↓
后端检查 users 表为空
  ↓
前端进入"账号选择页"（空状态）
  ↓
唯一按钮："+ 创建新账号"
  ↓
打开"创建账号"模态框
  ↓
填写：用户名 * / 单位 / 部门 / 角色 / 头像颜色（6 选 1）
  ↓
保存 → 后端创建 user + 自动创建 session
  ↓
进入主界面
```

### 5.2 已有本地账号

```
应用启动
  ↓
后端检查 user_sessions 有有效 token
  ↓
若有效 → 恢复登录，进入主界面
若无效或无 → 进入"账号选择页"
  ↓
账号选择页：列表展示 + "+ 创建新账号" 按钮
  ↓
点击列表项 → 切换到该用户（创建新 session）
点击 "+" → 打开创建模态框
```

### 5.3 主界面用户卡片交互

**视觉规范**：40px 头像（首字母 + 6 选 1 渐变色）+ 用户名（粗体）+ 角色（次色弱化）/ 单位·部门（小字）/ 右下角在线指示灯 / ▼ 展开箭头。

```
用户卡片
  ↓
点击 → 展开下拉菜单（向上弹出，4 项）
  ├─ 个人设置 → 打开个人设置模态框
  ├─ 切换账号 → 跳回账号选择页
  ├─ 协作组管理 → A 阶段显示"协作组功能开发中"提示
  └─ 退出登录 → 清空当前 session，跳回账号选择页
  ↓
点击卡片外区域 / 按 Esc → 收起菜单
```

### 5.4 个人设置模态框

- 字段：display_name、unit、department、role、avatar_color
- 校验：三元组唯一（修改后与其他用户冲突时阻止保存并提示）
- 删除账号：模态框底部"删除此账号"危险按钮（二次确认）
  - 删除时将该用户拥有的任务的 `owner_user_id` 置 NULL
  - 删除协作组任务中该用户的"协办人"ID 移除
  - 软删除（is_deleted=1），不级联删除审计日志
- 保存：乐观更新 UI，失败回滚

### 5.5 任务创建/编辑表单（扩展现有模态框）

在现有任务表单底部"更多选项"内**新增分组**"协作与责任"：

```
┌─ 主责部门   [输入框]
├─ 协办部门   [标签输入]
├─ 责任人     [下拉：当前可见用户列表]
├─ 协办人     [多选：当前可见用户列表]
└─ ☑ 启用审计日志
```

任务详情显示：

```
优先级 · 分类
主责: 研发部 | 责任人: 郭世锋
协办: 测试部, 产品部 | 协办人: 李明, 王芳
```

### 5.6 任务审计日志查看

任务详情模态框新增"审计日志"标签页：表格展示 `task_audit_log` 中该 task 的所有记录（按时间倒序）：

- 时间
- 操作人（头像+名）
- 动作
- 字段（变更前后值）

**操作人显示规则**：
- 若 `task_audit_log.user_id` 对应的用户仍存在（`is_deleted=0`）→ 显示该用户的当前档案
- 若该用户已被软删除 → 显示为"已删除用户"（灰色占位头像 + 该字样），保留审计历史完整

### 5.7 在线指示灯

- 🟢 绿点：本机 session 存在 + `last_active_at` 在 5 分钟内
- ⚫ 灰点：超过 5 分钟未活动
- 离线：无 session
- 心跳：前端每 60 秒调 `auth_heartbeat()` 更新 `last_active_at`

## 6. API 概要

### 6.1 账号管理

| API | 入参 | 返回 |
|---|---|---|
| `auth_get_current_user` | 无 | `{success, user \| null}` |
| `auth_create_user` | `{display_name, unit?, department?, role?, avatar_color?}` | `{success, user, token}` |
| `auth_switch_user` | `user_id` | `{success, user, token}` |
| `auth_update_user` | `user_id, data` | `{success, user}` |
| `auth_delete_user` | `user_id` | `{success}` |
| `auth_logout` | 无 | `{success}` |
| `auth_heartbeat` | 无 | `{success}` |
| `auth_list_local_users` | 无 | `{success, users[]}` ——返回字段：`id, display_name, unit, department, role, avatar_color, last_active_at`（按 last_active_at DESC），过滤 `is_deleted=0` |

### 6.2 任务审计

| API | 说明 |
|---|---|
| `task_get_audit_log(task_id)` | 任务详情用，返回该任务审计流水 |
| `add_todo / update_todo / delete_todo / toggle_todo` | **内部自动写入审计**（若 `audit_enabled=1`），需传 `current_user_id` |

### 6.3 用户查找

| API | 说明 |
|---|---|
| `user_search(query)` | 按 display_name/unit/department 模糊匹配本机用户 |

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 三元组重复 | 阻止保存，返回 `{success:false, error:'该用户名+单位+部门组合已存在'}` |
| session 失效 | API 返回 `{success:false, error:'SESSION_EXPIRED'}`，前端捕获后跳回账号选择页 |
| 删除最后一个账号 | 阻止，提示"至少保留一个账号" |
| 心跳失败 | UI 不报错，但绿点变灰 |
| 数据库迁移失败 | 启动时回滚 + 提示用户，旧数据不丢失 |
| tasks 旧数据无 user_id | 视为"系统/历史"任务，UI 显示"未知责任人" |

## 8. 测试策略

### 8.1 单元测试

- `backend/tests/test_user.py`：UserManager 增删改查、三元组唯一性、软删除、session 创建/查询/清理
- `backend/tests/test_task_audit.py`：增/改/删/完成 时自动写日志；`audit_enabled=0` 时不写
- `backend/tests/test_migration.py`：模拟旧 schema 启动，验证新字段添加成功

### 8.2 集成测试

- `backend/tests/test_auth_api.py`：完整 auth API 路径（创建 → 切换 → 更新 → 删除 → 注销）
- 任务 API 带 `current_user_id` 的审计日志写入

### 8.3 前端测试（可选）

- `frontend/tests/user.test.js`：UserManager 状态机、用户卡片渲染、菜单展开/收起

### 8.4 手动 UI 验证清单

- [ ] 首次启动空状态 → 创建第一个账号 → 进入主界面
- [ ] 重启应用 → 自动恢复登录
- [ ] 创建第二个同名账号（不同单位）→ 成功
- [ ] 创建同名同单位同部门 → 失败
- [ ] 用户菜单 4 项可点
- [ ] 个人设置改字段 → 卡片实时更新
- [ ] 切换账号 → 跳回选择页 → 选另一个 → 卡片更新
- [ ] 退出登录 → session 清空 → 重启后停在选择页
- [ ] 创建任务填协作字段 → 显示在卡片 → 审计日志有记录
- [ ] 5 分钟不活动 → 绿点变灰

## 9. 验收清单

A 子系统实施完成的标准：

1. 全新用户下载应用，第一次启动看到"账号选择页"空状态，能创建第一个账号
2. 同一台电脑可创建多个账号（用户名+单位+部门三元组互不冲突）
3. 关闭重开应用，自动恢复上次登录账号
4. 左下角"联系作者"按钮已被替换为用户卡片，显示当前用户头像、用户名、角色、单位·部门、在线指示灯
5. 点击用户卡片展开 4 项菜单（个人设置/切换账号/协作组管理占位/退出登录）
6. 任务创建/编辑表单可填主责部门、协办部门、责任人、协办人、是否启用审计
7. 任务详情可见"协作与责任"信息
8. 任务详情"审计日志"标签页可看到所有变更记录（含操作人头像）
9. 单元测试、集成测试全部通过
10. 现有任务、分类、设置、标签数据完整无损

## 10. 后续衔接

### 10.1 A → B（多级分类）

B 阶段开始时，A 已稳定：
- 任务归属"个人"还是"协作组"是 B 之前未明确的字段 → A 阶段后所有 `tasks` 都有 `owner_user_id`
- B 引入的"分类"仍可按 owner_user_id 归属；或新增 `category_owner_type`（个人/协作组）

### 10.2 A → C（局域网同步 + 协作组）

C 阶段开始时，A 已稳定：
- `users.id` 作为协作组消息/文件的发送者身份
- 用户档案（display_name + unit + department + avatar_color）通过 P2P 同步给协作组成员
- A 阶段保留的"协作组管理"占位由 C 填充

### 10.3 明确不在 A 范围

- 多级分类（树形）→ B
- P2P 节点发现 → C
- 协作组连接码 → C
- 聊天消息 → C
- 文件传输 → C
- 数据同步引擎 → C
- WebDAV 同步 → 已存在

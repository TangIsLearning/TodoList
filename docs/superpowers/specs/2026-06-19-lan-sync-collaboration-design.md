# 局域网同步与协作组（LAN Sync & Collaboration）设计

| 字段 | 值 |
|---|---|
| 日期 | 2026-06-19 |
| 子系统 | C（局域网同步 + 协作组） |
| 状态 | 设计稿 · 待实施 |
| 前置 | A（用户系统）、B（多级分类）已就绪 |
| 后续 | 无（v1 收官） |

## 1. 范围与目标

### 1.1 目标

将 TodoList 从单机应用升级为支持**局域网多用户协作**：

- 同子网内多用户基于**同一连接码**自动发现 + 加入协作组
- 任务 / 分类 / 消息 / 文件在协作组内实时同步
- 字段级冲突自动解决（最新时间戳胜出）
- 4 种通知方式（系统通知 / 未读计数 / 任务栏闪烁 / 静音时段）
- 完整 UI：协作组管理 / 消息面板 / 同步状态 / 任务视图切换

### 1.2 明确排除（不在 C 范围）

- ❌ 端到端加密（同子网可信，不实现）
- ❌ 跨子网同步（仅同子网）
- ❌ 公网同步（无 STUN/TURN/NAT 穿透）
- ❌ 消息已读隐私模式（v1 总是显示已读）
- ❌ 视频/语音通话
- ❌ 协作组公开市场（仅连接码私密加入）
- ❌ 消息编辑历史（v1 仅最新版本）
- ❌ 移动端/网页端

## 2. 关键设计决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 网络模式 | 完全 P2P（点对点） | 用户选择；无中心服务器依赖 |
| 发现范围 | 同子网 UDP 广播 | 简单可靠；适合家庭/办公同路由 |
| 连接码 | 6 位混合（A8B-3K9） | 21 亿组合，平衡可记性与不碰撞 |
| 消息保留 | 本地存储 + 全量同步 | 所有节点保存全量历史 |
| 文件传输 | 全量点对点传输 | 100MB 限制；哈希去重 |
| 冲突解决 | 静默合并（最新时间戳） | 体验丝滑；sync_log 留痕 |
| 通知 | 4 种全选 | 系统通知 / 未读计数 / 任务栏闪烁 / 静音时段 |
| 共享范围 | 4 项可勾选 | 个人任务 / 个人分类 / 协作组任务 / 消息历史 |
| 角色 | Owner / Member 二级 | 简单清晰；满足踢人/解散 |
| 创建组 | 必填名称+图标 / 选填描述 / 可重置码 / 公开/隐藏 | 完整但不复杂 |
| 任务归属 | group_id | 创建者离开任务仍在组里 |

## 3. 架构概览

### 3.1 四层结构

**网络层**（新增 `backend/network/`）
- `discovery.py`：UDP 广播监听 + 连接码过滤
- `peer.py`：TCP 长连接管理（点对点）
- `protocol.py`：消息编解码（JSON + 长度前缀）
- `sync_engine.py`：变更检测 + 推送 + 拉取
- 使用标准库 `socket` / `threading`（不引入新依赖）

**数据层**（SQLite 扩展）
- 新增 `groups` / `group_members` / `messages` / `attachments` / `sync_log` / `file_storage`
- 扩展 `tasks`：`group_id` / `synced_at` / `version`

**业务层**（`backend/`）
- `database/models.py`：增 6 个模型
- `database/operations.py`：增 `GroupManager` / `MessageManager` / `SyncManager`
- `api/todo_api.py`：增 ~15 个 group/message/sync API

**前端层**（`frontend/`）
- `js/network.js`：网络状态机
- `js/group.js`：协作组管理
- `js/chat.js`：消息面板
- `js/sync-status.js`：同步状态显示
- 改造 `index.html`：协作组入口 / 消息抽屉 / 同步状态条

### 3.2 整体数据流

```
本机变更 → SyncManager 标记 dirty
        ↓
实时（≤1s） / 兜底周期 5s 推送到所有已连接对端
        ↓
对端收到 → 校验连接码 + 签名 → 写入本地
        ↓
冲突 → 静默合并（最新时间戳）→ 写 sync_log
        ↓
前端订阅变更事件 → 实时更新 UI（任务 / 消息 / 成员列表）
```

## 4. 数据模型

### 4.1 表 `groups`（协作组档案）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | 协作组名称 |
| `icon` | TEXT | DEFAULT '👥' | emoji |
| `color` | TEXT | DEFAULT '#4f46e5' | 8 预设色 |
| `description` | TEXT | | 描述（可空） |
| `join_code` | TEXT | NOT NULL UNIQUE | 6 位混合连接码 |
| `created_by` | TEXT | NOT NULL | → users.id |
| `is_hidden` | INTEGER | DEFAULT 0 | 是否隐藏 |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |
| `is_deleted` | INTEGER | DEFAULT 0 | 软删除 |

**索引**：`INDEX(join_code)` 用于加入时查找

### 4.2 表 `group_members`（成员）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `group_id` | TEXT | NOT NULL | → groups.id |
| `user_id` | TEXT | NOT NULL | → users.id |
| `role` | TEXT | NOT NULL | 'owner' / 'member' |
| `share_tasks` | INTEGER | DEFAULT 0 | 共享我的个人任务给本组 |
| `share_categories` | INTEGER | DEFAULT 0 | 共享我的个人分类给本组 |
| `share_group_tasks` | INTEGER | DEFAULT 1 | 参与本组任务（默认开启） |
| `share_history` | INTEGER | DEFAULT 0 | 共享消息历史给新成员 |
| `joined_at` | TEXT | NOT NULL | |
| `last_seen_at` | TEXT | | 心跳更新 |

**唯一约束**：`UNIQUE(group_id, user_id)`

### 4.3 表 `messages`（聊天消息）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `group_id` | TEXT | NOT NULL | → groups.id |
| `sender_id` | TEXT | NOT NULL | → users.id |
| `content` | TEXT | | 文本内容（可空，仅附件时为空） |
| `msg_type` | TEXT | NOT NULL | 'text' / 'file' / 'image' / 'system' |
| `attachment_ids` | TEXT | | JSON 数组 → attachments.id |
| `reply_to_id` | TEXT | | 引用消息 id（可空） |
| `created_at` | TEXT | NOT NULL | |
| `updated_at` | TEXT | NOT NULL | |
| `is_deleted` | INTEGER | DEFAULT 0 | 软删除 |
| `read_by` | TEXT | | JSON 对象 `{user_id: read_at}` |

**索引**：`INDEX(group_id, created_at)` — 消息列表查询

### 4.4 表 `attachments`（文件元数据）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `message_id` | TEXT | | → messages.id（可空：上传中） |
| `file_hash` | TEXT | NOT NULL | SHA-256（去重） |
| `file_name` | TEXT | NOT NULL | 原始文件名 |
| `file_size` | INTEGER | NOT NULL | 字节 |
| `mime_type` | TEXT | | |
| `storage_path` | TEXT | NOT NULL | 本地存储相对路径 |
| `uploaded_by` | TEXT | NOT NULL | → users.id |
| `created_at` | TEXT | NOT NULL | |

**索引**：`INDEX(file_hash)` — 去重检查

### 4.5 表 `sync_log`（同步操作流水）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID |
| `entity_type` | TEXT | NOT NULL | 'task' / 'category' / 'message' / 'group' / 'attachment' |
| `entity_id` | TEXT | NOT NULL | |
| `operation` | TEXT | NOT NULL | 'push' / 'pull' / 'conflict' / 'reject' |
| `peer_id` | TEXT | | 远端节点标识 |
| `user_id` | TEXT | | 触发用户 |
| `has_conflict` | INTEGER | DEFAULT 0 | |
| `detail` | TEXT | | JSON（保留旧值/新值/原因） |
| `created_at` | TEXT | NOT NULL | |

### 4.6 表 `file_storage`（文件本地存储映射）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `file_hash` | TEXT | PRIMARY KEY | SHA-256 |
| `storage_path` | TEXT | NOT NULL | 相对 data/files/ 的路径 |
| `file_size` | INTEGER | NOT NULL | |
| `ref_count` | INTEGER | DEFAULT 1 | 引用计数（去重支持） |
| `created_at` | TEXT | NOT NULL | |

### 4.7 扩展表 `tasks`

| 新字段 | 类型 | 说明 |
|---|---|---|
| `group_id` | TEXT | → groups.id（NULL = 个人任务；非空 = 协作组任务） |
| `synced_at` | TEXT | 最近一次同步时间戳（用于冲突解决） |
| `version` | INTEGER | 乐观锁版本号（DEFAULT 1） |

### 4.8 迁移策略

```python
new_tables = ['groups', 'group_members', 'messages', 'attachments', 'sync_log', 'file_storage']
for table in new_tables:
    cursor.execute(f'CREATE TABLE IF NOT EXISTS {table} (...)')

# tasks 扩展
if 'group_id' not in existing_columns:
    cursor.execute('ALTER TABLE tasks ADD COLUMN group_id TEXT')
    cursor.execute('ALTER TABLE tasks ADD COLUMN synced_at TEXT')
    cursor.execute('ALTER TABLE tasks ADD COLUMN version INTEGER DEFAULT 1')
```

## 5. UI 流程

### 5.1 协作组管理入口

```
┌─ 协作组管理 ─────────────────────────┐
│  我的协作组                            │
│  ────────────                         │
│  👥 研发组  (5人)  [进入]  [设置]      │
│  👥 家庭    (3人)  [进入]  [设置]      │
│                                       │
│  + 创建协作组                          │
│  + 加入协作组（输入连接码）             │
│                                       │
│                       [关闭]          │
└───────────────────────────────────────┘
```

### 5.2 创建协作组

```
模态框：名称 * [          ]
       图标   [👥 ▼] (emoji 选择)
       颜色   [●  ●  ●  ●  ●  ●  ●  ●]
       描述   [                              ]
       可见性 ◉ 公开（广播携带组信息）
               ○ 隐藏（仅凭连接码加入）
[创建] → 后端生成 6 位连接码 → 展示给用户

┌─ 创建成功 ─────────────────────────────┐
│  协作组已创建                            │
│  你的连接码：[A8B-3K9]  [复制] [二维码]  │
│  分享给他人扫码或输入此码加入             │
│                              [我知道了]  │
└─────────────────────────────────────────┘
```

### 5.3 加入协作组

```
模态框：连接码 [      ] [查找]
  ↓
本机持续监听 UDP beacon，缓存同子网内所有节点
  ↓
查找：本机已缓存的 beacon 中是否有匹配 join_code
  ↓
命中 → 取首个匹配节点的 user_id 作为"创建者代理"展示
未命中 → 等待最多 5 秒（期间收到新 beacon 重新检查）
  ↓
展示创建者档案（"研发组" 由 👤 李明 创建）
  ↓
显示可共享范围（每项独立勾选）：
  ☑ 共享我的个人任务
  ☑ 共享我的个人分类
  ☑ 参与协作组任务（默认勾选）
  ☐ 共享消息历史
  ↓
[加入] → 双向建立 TCP 连接 → 双方本地写入 group_members
  ↓
提示"加入成功，已自动建立连接"
```

**加入失败处理**：
- 5 秒内未发现 → 提示"未发现该协作组，请检查连接码或网络"

**隐藏组的加入**：
- `is_hidden=1` 的协作组不携带 join_code 进广播
- 仍可由用户手动输入 join_code 触发查找（直接尝试 TCP 连接组内任一已知成员）
- 隐藏组的新成员需由现有成员主动分享连接码

### 5.4 消息面板（侧边抽屉）

主界面右上角增加 💬 图标，点击展开**右侧抽屉**（360px 宽）：

- 顶部：协作组切换下拉
- 中部：消息列表（按时间倒序）
  - 文本 / 表情 / 文件 / 图片 / @提及 / 引用回复
  - 已读状态（"3 人已读"）
  - 滚动加载历史
- 底部：输入框 + 📎 附件 + 😀 表情 + 发送

### 5.5 通知系统（4 种全选）

| 方式 | 触发 | 视觉 |
|---|---|---|
| 系统通知 | 收到新消息 / @我 / 新任务分配 | Windows toast，点击唤起主窗口 |
| 未读计数 | 任一协作组有新消息 | 💬 图标右上小红点 + 数字；窗口标题 `(3) TodoList` |
| 任务栏闪烁 | 收到新消息时窗口最小化 | 任务栏图标闪烁橙色 |
| 静音时段 | 设置中 22:00-08:00 免打扰 | 静音时段内不弹通知，只累计未读计数 |

### 5.6 同步状态显示

主界面顶部**同步状态条**（4 状态）：

| 状态 | 显示 |
|---|---|
| 未加入任何组 | `○ 未加入协作组` |
| 已加入但离线 | `⚠ 研发组 (离线) · 3 个待同步` |
| 同步中 | `⟳ 研发组 · 同步中...` |
| 已同步 | `● 研发组 (5人在线) · 全部已同步` |

点击展开详情面板：
- 在线成员列表（IP + 心跳时间）
- 最近 10 条同步操作（含冲突记录）

### 5.7 协作组设置（Owner 权限）

- 基本：名称 / 图标 / 颜色 / 描述 / 可见性
- 成员管理：踢人
- 安全：连接码 + 重置
- 危险操作：解散

Member 可见：只读基本 + 退出按钮

### 5.8 任务列表视图切换

```
[个人] [研发组▼] [所有协作组]
```

- 个人：仅显示 `group_id IS NULL` 任务
- 单个组：仅显示该组任务
- 所有协作组：合并显示所有组任务，**带组名前缀**："[研发组] 性能优化" "[家庭] 买牛奶"

### 5.9 离线处理

- 节点离线：本地变更写入 dirty queue
- 节点重连：自动批量推送 dirty 数据
- 重连成功提示："已与研发组重新连接，同步了 3 个变更"

**离线消息处理（v1 决策）**：
- 纯推送 + 拉取（对端离线时消息暂存到对方上线的 pull queue）
- 不引入第三方暂存

## 6. 网络协议

### 6.1 UDP 广播（节点发现）

- **端口**：`54721`
- **广播地址**：`255.255.255.255`
- **周期**：每 3 秒一次
- **载荷**（JSON）：
  ```json
  {
    "type": "discovery_beacon",
    "node_id": "uuid",
    "user_id": "uuid",
    "user_name": "郭世锋",
    "groups": [
      {"group_id": "uuid", "join_code": "A8B-3K9", "is_hidden": false}
    ],
    "tcp_port": 54722,
    "timestamp": "2026-06-19T14:23:00Z"
  }
  ```
- **接收方**：
  - 同子网内收到 beacon
  - 解析 `groups` 列表
  - 本机若有任一 `join_code` 匹配 → 发起 TCP 连接请求

### 6.2 TCP 长连接（点对点通信）

- **端口**：`54722`
- **协议**：JSON 消息 + 4 字节长度前缀
- **连接流程**：
  ```
  Client → Server: HELLO {node_id, user_id, group_id, signature}
  Server → Client: WELCOME {node_id, user_id, group_id, session_token}
  Client → Server: ACK
  → 长连接建立，传输业务消息
  ```
- **心跳**：每 30 秒一次 PING/PONG，3 次未响应视为离线
- **加密**：v1 阶段明文（同子网可信网络）；未来可选 TLS

### 6.3 消息类型

```python
# 同步类
SYNC_TASK_PUSH         # 推送任务变更
SYNC_TASK_PULL         # 拉取任务（带 since_timestamp）
SYNC_CATEGORY_PUSH
SYNC_CATEGORY_PULL
SYNC_USER_PROFILE_PUSH # 推送用户档案更新

# 协作组管理
GROUP_HELLO            # 加入后广播
GROUP_BYE              # 退出/解散

# 聊天
MSG_SEND               # 发送消息
MSG_READ_RECEIPT       # 已读回执

# 文件
FILE_UPLOAD_META       # 文件元数据
FILE_UPLOAD_CHUNK      # 文件分片（1MB / 片）
FILE_UPLOAD_COMPLETE   # 上传完成

# 控制
PING / PONG
ERROR
```

## 7. 同步机制

### 7.1 推送策略

- **实时推送**：本机任何变更 → 立即通知 SyncEngine → 通过 TCP 推给所有连接的对端
- **兜底周期**：每 5 秒检查 dirty queue，重试未送达的

### 7.2 拉取策略（新节点加入 / 重连）

```
1. 新节点建立 TCP 连接
2. 发送 SYNC_*_PULL {since_timestamp: 上次同步时间}
3. 对端查询该时间后的所有变更
4. 批量推送（每批 100 条）
5. 本机写入 + 更新 synced_at
```

### 7.3 消息 ID 去重

每条消息/任务/分类都带全局唯一 UUID（发送方生成）。接收方先去重再写入：

```python
if message.id in local_messages:
    return IGNORE  # 已存在
insert(message)
```

## 8. 冲突解决

**字段级最新时间戳胜出**：

```python
def apply_remote_change(remote_entity):
    local = get_local(remote_entity.id)
    if local is None:
        return INSERT(remote_entity)
    
    # 字段级比较
    for field in remote_entity.dirty_fields:
        local_ts = local.get_updated_at(field)
        remote_ts = remote_entity.get_updated_at(field)
        if remote_ts > local_ts:
            local[field] = remote_entity[field]
            log_sync(entity_id, 'conflict_resolved', 
                     detail={'field': field, 'old': local_ts, 'new': remote_ts})
    return UPDATE(local)
```

**特殊冲突**：
- 删除 vs 修改：若任一侧 `deleted_at` 非空且更晚 → 删除胜出
- 同字段同时间戳：保留两个版本并标记"分支"（极少见，可接受）

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| UDP 广播失败 | 静默重试，不影响主流程 |
| TCP 连接失败 | 重试 3 次（指数退避），失败后状态条变"离线" |
| 节点超过 5 秒未响应 | 标记离线，但不删除数据 |
| 推送失败 | 写入 dirty queue，下次连接重试 |
| 文件哈希校验失败 | 拒绝写入，标记损坏 |
| 连接码不匹配 | 拒绝连接（防未授权节点） |
| 100MB 文件超过 | API 拒绝，提示"文件过大" |
| 同步时数据冲突 | 静默合并 + sync_log 记录 |
| 节点退出协作组 | 主动广播 GROUP_BYE，其他节点清理连接 |

## 10. 测试策略

### 10.1 单元测试

- `backend/tests/test_group.py`：GroupManager CRUD、连接码生成唯一性
- `backend/tests/test_message.py`：消息增删改、已读状态
- `backend/tests/test_sync.py`：冲突解决算法、推送拉取逻辑、消息去重
- `backend/tests/test_discovery.py`：UDP 广播解析、连接码过滤
- `backend/tests/test_protocol.py`：消息编解码、长度前缀解析

### 10.2 集成测试

- `backend/tests/test_p2p.py`：双节点模拟（同一进程两个 socket）→ 完整发现 → 连接 → 同步 → 断开
- `backend/tests/test_conflict.py`：模拟两节点同时编辑同任务 → 验证最新时间戳胜出 + sync_log 记录
- `backend/tests/test_file_transfer.py`：大文件分片传输 + 完整性校验

### 10.3 手动 UI 验证清单（19 项）

- [ ] 创建协作组 → 显示 6 位连接码
- [ ] 重置连接码 → 旧码失效
- [ ] 第二台机器输入连接码 → 发现 + 加入
- [ ] 关闭某节点 → 状态条变"离线" + 显示待同步数
- [ ] 重连 → 自动同步离线期间的变更
- [ ] A 节点创建任务 → B 节点 1 秒内出现
- [ ] A 节点删除任务 → B 节点同步消失
- [ ] 两节点同时改同任务 → 静默合并 + 同步日志记录
- [ ] 发送文本消息 → 1 秒内出现在对端
- [ ] 上传 50MB 文件 → 对端下载 + 校验
- [ ] 上传 200MB 文件 → 拒绝
- [ ] @提及 → 触发系统通知
- [ ] 静音时段收到消息 → 不弹通知
- [ ] 消息已读 → 发送方看到"3 人已读"
- [ ] 引用回复 → 显示"回复 xxx"小卡片
- [ ] Owner 踢人 → 被踢者自动退出
- [ ] 解散协作组 → 所有成员收到通知
- [ ] 切换"隐藏"模式 → 广播不携带组信息
- [ ] 网络断开 → dirty queue 累积 → 重连批量推送

## 11. 验收清单

C 子系统实施完成的标准：

1. 创建协作组自动生成 6 位连接码
2. 同子网内输入连接码 5 秒内自动发现并加入
3. 离线 → 重连后自动同步所有变更
4. 任务增删改在多节点间实时同步（≤1 秒）
5. 冲突静默合并，sync_log 完整记录
6. 文本消息实时送达（≤1 秒）
7. 文件传输（≤100MB）成功 + 完整性校验
8. 4 种通知方式全部生效
9. 静音时段内不弹通知
10. Owner 踢人/解散/重置码生效
11. 同步状态条 4 态显示正确
12. 任务列表视图切换（个人/组/全部）正确
13. 单元测试、集成测试全部通过
14. 现有所有功能（A/B 阶段）完整无损

## 12. 后续衔接

C 是 v1 收官子系统。完成后系统支持：

- 多用户账号（A）
- 多级分类（B）
- 局域网协作组（C）

未来扩展方向（明确不在 v1）：
- 端到端加密
- 跨子网 / 公网同步
- 移动端 / 网页端
- 视频/语音通话
- AI 助手集成

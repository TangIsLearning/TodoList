# D 阶段：LAN 联调 & 稳定性 设计稿

> 日期：2026-06-19
> 承接：C 阶段（6 表 / 15 API / 网络协议 / 19 UI 验收 / 127 后端测试）
> 目标：把 C 阶段的"协议字段 + 管理器"对接成"真实可跑的双节点数据流"，并把异常路径全部覆盖

---

## 一、当前现状与差距

### C 阶段已完成
- 6 张表：groups / group_members / messages / attachments / sync_log / file_storage
- 15 个 API：group 8 个 + message 4 个 + sync 2 个 + 历史 1 个
- 协议常量：HELLO / WELCOME / PING / PONG / BYE / SYNC_TASK_PUSH/PULL / SYNC_CATEGORY_PUSH/PULL / SYNC_USER_PROFILE_PUSH / GROUP_HELLO/BYE / MSG_SEND / FILE_UPLOAD_*
- UDP 发现（DiscoveryService）+ TCP 长连接（PeerServer/PeerConnection）+ 协议编解码（encode/decode）
- 同步引擎 SyncEngine（实体级 LWW）
- 19 UI 验收 + 127 后端测试

### D 阶段要解决的 10 个缺口

| # | 缺口 | 风险 |
|---|---|---|
| G1 | `DiscoveryService` 与 `PeerServer` 互不联通，发现后没人主动 `connect_peer` | 真实场景下节点不会自动握手 |
| G2 | `_connected_peers = []` 是占位列表，缺节点生命周期 / 心跳状态 | UI 显示与真实情况脱节 |
| G3 | `SyncEngine` 仅 `apply_remote_change` 单向通路，缺"握手 / 拉取 / 广播"三类协议消息 | 多节点首次同步、增量同步、广播通知都不通 |
| G4 | 冲突解决只看 `updated_at` 字符串大小，缺 clock-skew 容忍 | 时钟不同步时 LWW 失效 |
| G5 | 缺"重连 → 增量同步"机制 | 短暂断网后变更丢失 |
| G6 | 协议版本未校验 | 老节点 / 新节点混跑可能误解消息 |
| G7 | 缺"双节点模拟器"测试脚手架 | 真实联调成本高，无法在 CI 跑 |
| G8 | `network.js` 是状态机占位，未消费 `sync_status` 的 `connectedPeers` | 前端无感知 |
| G9 | 缺"网络事件日志"（连接 / 断开 / 握手失败 / 协议错误） | 出问题无法定位 |
| G10 | 缺压力与稳定性用例（1000+ 任务批量同步 / 反复 join-leave / 抖动重连） | 边界场景未覆盖 |

---

## 二、D 阶段范围

### 在范围内（In Scope）

1. **节点注册表 NodeRegistry**：节点身份、心跳、上次同步时间、所属群组
2. **网络协调器 NetworkCoordinator**：把 Discovery → TCP 握手 → 同步引擎串起来
3. **同步协议扩展**：3 类新消息
   - `SYNC_HANDSHAKE`：建立 TCP 后交换 user_id、group_ids、last_sync_at
   - `SYNC_PULL_REQUEST / RESPONSE`：新节点 / 重连后拉取 since_timestamp 之后所有变更
   - `SYNC_BROADCAST`：本地变更后向所有 peer 推送
4. **冲突解决加固**：clock-skew 容忍（`abs(local - remote) < 1s` 视为同时，按节点 ID 字典序裁决）
5. **离线/在线/重连**：心跳超时 → 标记离线 → 重连后自动增量同步
6. **协议版本号**：在每条消息携带 `protocol_version`，不匹配 → 拒绝并打日志
7. **网络事件日志**：连接 / 断开 / 握手失败 / 协议错误 / 冲突 → 写 network_events 表
8. **双节点模拟器测试**：单进程内启动 2 个 NetworkCoordinator，跑完整 E2E 场景
9. **前端接入**：network.js 真正消费 `sync_status.connectedPeers` 渲染对端节点
10. **压力与稳定性用例**：5 个场景

### 不在范围内（Out of Scope）

- WebDAV 同步（D+ 阶段再做）
- 节点身份加密 / Token 鉴权（产品 P0 信任 join_code 即可）
- 移动端接入（D+ 阶段再做）
- 字段级合并（per-field LWW，仍是实体级 LWW）
- 自动更新 / 打包分发（D+ 阶段再做）

---

## 三、模块拆分

### 3.1 新增后端模块

| 文件 | 职责 | 行数估算 |
|---|---|---|
| `backend/network/node_registry.py` | 节点注册表：peer 增删 / 心跳 / 最后同步时间 / 所属群组 | 200 |
| `backend/network/network_coordinator.py` | 网络协调器：Discovery 回调 → connect_peer → 握手 → 同步调度 | 350 |
| `backend/network/sync_protocol.py` | 同步协议层：HANDSHAKE / PULL / BROADCAST 编解码、版本号校验 | 180 |
| `backend/network/network_events.py` | 网络事件表 + 写入器（SQLite 表 + dataclass） | 150 |
| `backend/tests/test_node_registry.py` | 节点注册表单测 | 120 |
| `backend/tests/test_sync_protocol.py` | 同步协议编解码 + 版本校验 | 150 |
| `backend/tests/test_two_node_e2e.py` | 双节点 E2E 联调（单进程双 coordinator） | 300 |
| `backend/tests/test_network_stability.py` | 压力与稳定性（5 场景） | 350 |
| `backend/tests/ui_verification_d_phase.py` | 12 项 D 阶段 UI 验收 | 200 |

合计：约 2000 行（含测试）

### 3.2 修改文件

| 文件 | 改动 |
|---|---|
| `backend/database/operations.py` | 新增 `network_events` 表 + `NetworkEventManager` |
| `backend/database/models.py` | 新增 `NetworkEvent` dataclass |
| `backend/network/protocol.py` | 新增 6 个协议常量 + `PROTOCOL_VERSION` |
| `backend/network/sync_engine.py` | 加重连增量同步方法 `sync_with_peer(peer, since)`、clock-skew 容忍 |
| `backend/api/todo_api.py` | 新增 8 个 API：节点列表 / 拉取请求 / 广播 / 重连 / 同步状态增强 / 事件日志 |
| `frontend/js/network.js` | 真正消费 `sync_status.connectedPeers`，渲染对端节点 |
| `frontend/js/sync-status.js` | 展示对端用户、握手状态、最近一次同步时间 |
| `frontend/css/components.css` | peer 卡片 / 同步中动画 / 冲突提示样式 |

### 3.3 新增数据库对象

```sql
-- 节点信息缓存（仅本机视角，来源是 UDP beacon + 握手响应）
CREATE TABLE network_nodes (
    id            TEXT PRIMARY KEY,    -- 远端节点 ID
    user_id       TEXT,
    user_name     TEXT,
    address       TEXT,                -- ip:port
    last_seen     TEXT,
    last_sync_at  TEXT,
    status        TEXT,                -- online / syncing / offline
    protocol_version TEXT
);

-- 网络事件日志（连接/断开/握手失败/协议错误/冲突）
CREATE TABLE network_events (
    id          TEXT PRIMARY KEY,
    type        TEXT,        -- peer_joined / peer_left / handshake_ok / handshake_fail / protocol_error / conflict
    peer_id     TEXT,
    user_id     TEXT,
    detail      TEXT,        -- JSON
    created_at  TEXT
);
```

### 3.4 新增 API（8 个）

| API | 方法 | 说明 |
|---|---|---|
| `network_list_peers` | GET | 返回当前在线/离线/同步中的 peer 列表 |
| `network_get_node` | GET | 返回本机节点信息（node_id / user / groups / tcp_port） |
| `network_start_coordinator` | POST | 启动 Discovery + PeerServer（带 sync engine） |
| `network_stop_coordinator` | POST | 停止 |
| `network_pull_from_peer` | POST | 强制从指定 peer 全量拉取 |
| `network_broadcast_change` | POST | 把本地 entity 推送至所有 peer |
| `network_resync` | POST | 触发对所有 peer 的增量重同步 |
| `network_event_log` | GET | 网络事件日志（分页） |

### 3.5 同步协议扩展

```python
# 新增协议常量
PROTOCOL_VERSION = '1.0.0'

SYNC_HANDSHAKE        = 'SYNC_HANDSHAKE'         # 节点交换身份+时间戳
SYNC_PULL_REQUEST     = 'SYNC_PULL_REQUEST'      # {entity_type, since}
SYNC_PULL_RESPONSE    = 'SYNC_PULL_RESPONSE'     # {entity_type, entities:[...]}
SYNC_BROADCAST        = 'SYNC_BROADCAST'         # {entity_type, entity}  本地变更
SYNC_RESYNC_REQUEST   = 'SYNC_RESYNC_REQUEST'    # {since} 全节点重连后用
SYNC_BYE              = 'SYNC_BYE'               # 主动断开
```

每条消息统一加 `protocol_version` 字段；接收方不匹配 → 返回 `ERROR` + 事件日志。

### 3.6 冲突解决加固

```python
# Clock-skew 容忍：时间差 < SKEW_TOLERANCE_SEC 视为同时
SKEW_TOLERANCE_SEC = 1.0

def resolve_with_skew(local_ts, remote_ts, local_id, remote_id):
    delta = abs(parse_ts(local_ts) - parse_ts(remote_ts))
    if delta < SKEW_TOLERANCE_SEC:
        # 字典序更大的胜出（稳定且无歧义）
        return remote if remote_id > local_id else local
    return remote if remote_ts > local_ts else local
```

### 3.7 网络协调器主流程

```
start():
  1. 生成 node_id
  2. 启动 PeerServer (54722)，on_connect → handle_inbound_peer
  3. 启动 DiscoveryService (54721)，on_beacon → handle_outbound_peer
  4. 把已加入的协作组 join_code 注入 beacon

handle_outbound_peer(beacon):
  - 检查 group_id 是否在本地已加入组中
  - 是 → connect_peer(beacon.address) → 触发 handle_inbound_peer
  - 否 → 忽略（隐藏组不在 beacon 中）

handle_inbound_peer(pc):
  - 发送 SYNC_HANDSHAKE {node_id, user_id, group_ids, protocol_version, last_sync_at}
  - 收到响应 → 写入 node_registry
  - 触发 sync_with_peer(pc, since=last_sync_at)

on_local_change(entity_type, entity):
  - 写入本地 db
  - 遍历 node_registry 中 online peers → SYNC_BROADCAST
```

### 3.8 重连与增量同步

```
on_peer_disconnect(peer):
  - node_registry.mark_offline(peer.id)
  - 写事件 network_left
  - 后台线程：每 10s 重试 connect_peer
  - 连接成功 → 发送 SYNC_HANDSHAKE，since=last_sync_at
  - 收到 SYNC_PULL_RESPONSE → 逐条 apply_remote_change
  - 更新 last_sync_at = now()
```

### 3.9 双节点模拟器

```python
# test_two_node_e2e.py
def test_full_双向同步():
    coord_a, coord_b = make_two_coordinators(port_a=15701, port_b=15702)
    # 1. 双方发现对方
    coord_a.start(); coord_b.start()
    # 2. A 创建任务
    coord_a.apply_local_change('task', t1)
    # 3. 等 1s，B 应自动收到广播并 apply
    wait_until(lambda: coord_b.db.get_task(t1.id) is not None, timeout=5)
    # 4. B 关闭，A 标记 B 离线
    coord_b.stop()
    # 5. A 修改任务
    coord_a.apply_local_change('task', t1_updated)
    # 6. B 重启
    coord_b.start()
    # 7. B 重连后应收到增量（last_sync_at 之后的变更）
    wait_until(lambda: coord_b.db.get_task(t1.id)['title'] == t1_updated.title, timeout=10)
```

---

## 四、UI 验收（12 项）

| # | 验收项 |
|---|---|
| 1 | 启动协调器后 5s 内收到至少 1 个 beacon |
| 2 | 在线节点列表正确显示对端用户名、IP、加入的协作组 |
| 3 | 节点状态徽章：🟢 在线 / 🟡 同步中 / ⚫ 离线 |
| 4 | 离线节点在 30s 内被识别（心跳超时） |
| 5 | 离线节点重新上线后 10s 内状态恢复为在线 |
| 6 | 任务变更后 5s 内对端 UI 出现（无手动刷新） |
| 7 | 双端同时编辑同一任务 → 提示"字段冲突：采用 A 的版本" |
| 8 | 同步日志面板显示"推送 / 拉取 / 冲突"条目 |
| 9 | 网络事件日志可按"握手失败 / 协议错误 / 冲突"筛选 |
| 10 | 协议版本不匹配的节点在事件日志中显示"协议拒绝" |
| 11 | 强制重同步按钮：点击后触发对所有 peer 的 RESYNC |
| 12 | 双节点模拟器测试 5 个场景 100% 通过 |

---

## 五、压力与稳定性用例（5 场景）

| 场景 | 验证目标 |
|---|---|
| S1 批量同步 | A 一次性创建 1000 个任务 → B 全部收到，无丢失 |
| S2 突发消息 | 1s 内 100 条消息广播 → 全部送达，无乱序 |
| S3 反复 join/leave | 同一 peer 在 10s 内 join→leave→join 10 次，状态最终稳定 |
| S4 网络抖动 | 周期性 connect→disconnect 50 次，最终一致性收敛 |
| S5 协议版本 | 旧版本节点发送 SYNC_TASK_PUSH → 收到 ERROR + 事件日志 |

---

## 六、执行顺序（8 个里程碑）

| 里程碑 | 内容 | 估时 | 依赖 |
|---|---|---|---|
| M1 | network_events 表 + NetworkEventManager | 0.5h | - |
| M2 | NodeRegistry 实现 + 单测 | 1h | M1 |
| M3 | 同步协议扩展（6 常量 + 版本校验）+ 单测 | 1.5h | M1 |
| M4 | SyncEngine 增量同步 + clock-skew 容忍 | 1.5h | M3 |
| M5 | NetworkCoordinator 整合 Discovery/PeerServer/SyncEngine | 2.5h | M2, M3, M4 |
| M6 | API 8 个 + 前端 network.js/sync-status.js 接入 | 1.5h | M5 |
| M7 | 双节点模拟器 E2E + 5 压力场景 | 2h | M5 |
| M8 | 12 项 UI 验收 + 完整回归 | 1h | M6, M7 |

合计：约 11.5 小时

---

## 七、风险与回退

| 风险 | 应对 |
|---|---|
| 协议版本不匹配导致旧节点崩溃 | 接收方发现版本不符 → 回 ERROR + 事件日志，不抛异常 |
| UDP 广播被路由器屏蔽 | Discovery 加 fallback：手动输入 IP 也能 connect_peer |
| 大量并发推送导致锁竞争 | SyncEngine 加全局锁；批量 apply 用事务 |
| 时钟漂移 | clock-skew 容忍 + 节点 ID 字典序裁决 |
| 隐藏组泄露 | beacon 中 is_hidden=true 的组不广播 join_code |
| 心跳超时误判 | HEARTBEAT_TIMEOUT=90s（3 次 × 30s），可通过 API 调整 |

---

## 八、退出条件（Definition of Done）

- [ ] 12 项 D 阶段 UI 验收 100% 通过
- [ ] 5 场景压力测试 100% 通过
- [ ] 后端总测试 ≥ 200（127 + 73 D 阶段新增）
- [ ] A/B/C 阶段 0 回退（127 旧测试 + 13 B UI + 19 C UI 全绿）
- [ ] 文档：本文 + D 阶段实施记录 + 协议字段表
- [ ] 双节点模拟器可在 CI 跑（无需真实双机）

---

## 九、附录：协议字段表

| type | 字段 |
|---|---|
| SYNC_HANDSHAKE | protocol_version, node_id, user_id, group_ids[], last_sync_at |
| SYNC_PULL_REQUEST | protocol_version, entity_type, since |
| SYNC_PULL_RESPONSE | protocol_version, entity_type, entities[] |
| SYNC_BROADCAST | protocol_version, entity_type, entity |
| SYNC_RESYNC_REQUEST | protocol_version, since |
| SYNC_BYE | protocol_version, reason |
| ERROR | protocol_version, code, message |

> 所有消息统一带 `protocol_version`；接收方不匹配 → `ERROR: PROTOCOL_MISMATCH`。

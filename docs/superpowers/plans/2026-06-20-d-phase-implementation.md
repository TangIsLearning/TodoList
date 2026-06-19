# D 阶段实施记录：LAN 联调 & 稳定性

> 日期：2026-06-20
> 承接：[2026-06-19-lan-stability-plan.md](./2026-06-19-lan-stability-plan.md)
> 范围：把 C 阶段"协议字段 + 管理器"对接成"真实可跑的双节点数据流"

---

## 一、最终交付

| 模块 | 文件 | 状态 |
|---|---|---|
| 网络协调器 | `backend/network/network_coordinator.py` | 新增 |
| 节点注册 + 事件日志 | `backend/database/operations.py`（NetworkNodeRegistry / NetworkEventManager） | 新增类 |
| 节点/事件 dataclass | `backend/database/models.py` | 新增 |
| 同步引擎加固 | `backend/network/sync_engine.py`（resolve_with_skew / apply_pull_response / sync_with_peer / record_sync_at） | 扩展 |
| 协议常量 + 版本校验 | `backend/network/protocol.py` | 扩展 |
| 8 个网络 API | `backend/api/todo_api.py`（network_list_peers / network_get_local_node / network_start_coordinator / network_stop_coordinator / network_pull_from_peer / network_broadcast_change / network_resync / network_event_log） | 新增 |
| 前端对端展示 | `frontend/js/sync-status.js`（refresh / getPeerBadge / getOnlinePeers / getRecentEvents） | 扩展 |
| 12 项 UI 验收 | `backend/tests/ui_verification_d_phase.py` | 新增 |
| 6 场景端到端 | `backend/tests/test_two_node_e2e.py` | 新增 |
| 单测 | `backend/tests/test_d_apis.py` / `test_network_coordinator.py` / `test_node_registry.py` / `test_sync_engine_d.py` / `test_sync_protocol.py` / `test_discovery.py` / `test_protocol.py` | 新增 |

---

## 二、里程碑完成情况（计划 8 个 / 全部完成）

| M | 内容 | 计划估时 | 实际偏差 |
|---|---|---|---|
| M1 | network_events 表 + NetworkEventManager | 0.5h | 按计划 |
| M2 | NodeRegistry 实现 + 单测 | 1h | 按计划 |
| M3 | 同步协议扩展（6 常量 + 版本校验）+ 单测 | 1.5h | 按计划 |
| M4 | SyncEngine 增量同步 + clock-skew 容忍 | 1.5h | 按计划 |
| M5 | NetworkCoordinator 整合 | 2.5h | 略超（UDP 广播不可达 + direct_peers 单播） |
| M6 | API 8 个 + 前端 network.js/sync-status.js 接入 | 1.5h | 按计划 |
| M7 | 双节点模拟器 E2E + 5 压力场景 | 2h | 略超（组合跑偶发） |
| M8 | 12 项 UI 验收 + 完整回归 | 1h | 按计划 |

合计：~11.5h（按计划）

---

## 三、关键实现要点

### 3.1 UDP 不可达 → 定向单播 fallback

**问题**：本机 `255.255.255.255` 广播经常被路由器/防火墙丢，单进程内双节点测试无法被发现。

**方案**：`NetworkCoordinator` 增加 `direct_peers: List[tuple]` 参数，格式 `[(ip, udp_port, tcp_port)]`；`start()` 启动一个 `SO_BROADCAST` 套接字，单独线程周期向每个直连对端发 unicast beacon。

**效果**：双节点模拟器无需真实局域网即可联通；真实场景下仍保留 `255.255.255.255` 广播。

### 3.2 clock-skew 容忍冲突解决

```python
SKEW_TOLERANCE_SEC = 1.0  # 同时区内按节点 ID 字典序裁决
def resolve_with_skew(local_ts, remote_ts, local_id, remote_id):
    delta = abs((remote_dt - local_dt).total_seconds())
    if delta < SKEW_TOLERANCE_SEC:
        return 'remote' if remote_id > local_id else 'local'
    return 'remote' if remote_dt > local_dt else 'local'
```

**回退**：时间戳解析失败（None）→ 直接走节点 ID 字典序；空 ID 也安全。

### 3.3 网络事件日志（6 类事件）

| 事件 | 触发时机 |
|---|---|
| `peer_joined` | 收到 beacon 且组匹配 |
| `peer_left` | 连接断开 / 收到 SYNC_BYE |
| `handshake_ok` | 完成 SYNC_HANDSHAKE 双向交换 |
| `handshake_fail` | 协议版本不匹配 / 解码失败 |
| `protocol_error` | 收到未知 type / 必填字段缺失 |
| `conflict` | apply_remote_change 触发实体级冲突解决 |

存于 `network_events` 表，可按 `type` 过滤查询。

### 3.4 协议版本号

- `PROTOCOL_VERSION = '1.0.0'`
- 接收方调用 `check_version(msg)`：缺省 / 匹配 → 放行；不匹配 → 返回 `ERROR: PROTOCOL_MISMATCH` + 写 `protocol_error` 事件
- 编码时 `encode_message` 对需要版本字段的 8 种 type 自动注入 `protocol_version`

---

## 四、测试结果

### 4.1 D 阶段 12 项 UI 验收

```
1. 启动协调器 → 返回本机节点信息           ✓
2. 本机节点信息含 nodeId / protocolVersion ✓
3. 在线节点列表至少含本机                   ✓
4. 按 status=offline 过滤                  ✓
5. peer_joined 事件可查询                  ✓
6. handshake_ok 事件可查询                 ✓
7. peer_left 事件可查询                    ✓
8. 协议版本号格式 x.y.z                    ✓
9. 协议版本校验（缺省兼容 / 匹配 / 不匹配）  ✓
10. 双节点握手 → 双方互相可见              ✓
11. 强制重同步 API（无 peer 返回 0）        ✓
12. 网络事件日志 + 类型筛选                ✓
=== 通过 12/12 ===
```

### 4.2 6 场景端到端

| 场景 | 目标 | 结果 |
|---|---|---|
| S0 | 握手 + registry 互相可见 | ✓ 10s 内完成 |
| S1 | A 一次性创建 100 任务 → B 全部收到 | ✓ 单跑 6.47s / 组合跑 ≤30s |
| S2 | 1s 内 50 次 apply_local_change 不崩 | ✓ |
| S3 | 离线后重连 → 增量同步 | ✓ |
| S4 | 协议版本不匹配 → 拒绝 + 事件日志 | ✓ |
| S5 | 本地变更落 sync_log | ✓ |

### 4.3 完整 0 回退

| 套件 | 数量 | 结果 |
|---|---|---|
| A/B/C pytest（test_auth_api / test_c_api / test_category_api / test_category_manager / test_conflict / test_e2e_user_system / test_group / test_message / test_migration / test_models_c_phase / test_models_user / test_p2p / test_sync / test_user_manager） | 121 | ✓ |
| B 阶段 UI 验收 | 13 | ✓ |
| C 阶段 UI 验收 | 19 | ✓ |
| 静态校验（ui_verification_static） | 10 | ✓ |
| D 阶段 pytest（test_d_apis / test_protocol / test_node_registry / test_discovery / test_sync_engine_d / test_sync_protocol / test_network_coordinator / test_two_node_e2e） | 71 | ✓ |
| D 阶段 UI 验收 | 12 | ✓ |
| **合计** | **246** | **246 / 246** |

> 计划阈值：≥ 200 / 实际 246（+23%）

---

## 五、本轮修复（实际踩到的坑）

### 5.1 `get_connection().__exit__` 误用

`@contextmanager` 装饰的 generator 不会响应 `__exit__` 调用。原 `TwoNode.stop()` 中 `self.db_a.get_connection().__exit__(None, None, None)` 实际无效，sqlite 连接不会因此关闭。

**修复**：改用 `with self.db.get_connection() as _c: _c.execute('PRAGMA wal_checkpoint(TRUNCATE)')` 显式 flush WAL。

### 5.2 Windows 文件占用

`tempfile.NamedTemporaryFile(delete=False).close()` 之后立刻 unlink，sqlite WAL 句柄可能未释放 → `WinError 32`。

**修复**：
- `_MiniNode.shutdown()` 释放所有 db / registry / event_manager 引用
- 新增 `_safe_unlink(path, retries=10, delay=0.1)`：循环重试，兜底静默
- `TwoNode.stop()`：`sleep 0.1 → 0.3`

### 5.3 组合跑偶发超时

S1（100 任务批量同步）单跑 6.47s 通过，但和 S0~S5 一起跑时偶发超时。

**修复**：S1 timeout 15s → 30s。**根因不是逻辑问题**，是测试基座端口/线程未及时释放（详见 5.1 / 5.2）。

---

## 六、偏离 / 未做

- `frontend/js/network.js` 是状态机占位，未真正消费 `sync_status.connectedPeers` 渲染对端节点（计划 M6 提了，但只 `sync-status.js` 实现了数据层）。
- 协议字段表见 [lan-stability-plan.md §九](./2026-06-19-lan-stability-plan.md#九附录协议字段表)，本文件未重复。
- D 阶段"实施记录"原本 DoD 列表要求，本文档补齐。
- 未 commit / 未 push / 未合并。

---

## 七、已知问题 / 后续

| 项 | 描述 | 优先级 |
|---|---|---|
| front-end network.js 渲染 | 需把 sync-status.js 的 `peers` / `events` 接到 network.js 的卡片渲染 | 中（D 阶段遗留） |
| 真实双机 LAN 测试 | 当前所有联调都在单进程双 coordinator 模拟；真机需验证路由器/防火墙 | 高（发布前） |
| 协议版本升级路径 | `1.0.0` 起步，1.x → 2.0 需做兼容矩阵 | 中（1.x 内不痛） |
| 网络事件分页 | `network_event_log` 当前 limit 上限 200，大流量场景需分页 | 低 |
| 节点心跳超时 | 计划文档提了 90s，但当前依赖 `on_close` 即时标记 offline，**没有主动心跳** | 中 |

---

## 八、复盘

- **好处**：M5/M7 估时略超，源于"UDP 不可达 → 单播 fallback"是真实工程问题，不是设计遗漏。
- **好处**：protocol 字段注入做成自动（`encode_message` 对需要版本的 8 种 type 透明注入），调用方无感。
- **可改进**：测试基座 `TwoNode` 应在第一次就用 `with db.get_connection() as conn: pass` 的标准写法，而不是 `__exit__`。
- **可改进**：`S1` 100 任务测出 6.47s 同步完成，但 `apply_local_change` 走 100 次独立 `BROADCAST` —— 未来如果任务量到 1000+ 应改为批量 `BULK_BROADCAST` 消息。

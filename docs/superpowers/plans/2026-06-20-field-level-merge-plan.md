# E 阶段：字段级合并 设计稿

> 日期：2026-06-20
> 承接：D 阶段（实体级 LWW + clock-skew 容忍 + 6 场景端到端）
> 目标：把"实体级 Last-Write-Wins"升级为"字段级 Last-Write-Wins"，双端同时编辑同一任务的不同字段不再互相覆盖

---

## 一、当前现状与差距

### D 阶段已完成（实体级 LWW）
- 单条任务同步：A 端改 `title`、B 端改 `priority` → A 先广播整条实体 → B 端 `apply_remote_change` 走 `resolve_conflict` 看到 B 的 `updated_at` 更新，B 端整条被 A 覆盖，**B 改的 `priority` 丢失**
- `resolve_conflict(local, remote)` 只看顶层 `updatedAt/updated_at`，无法识别"两边改了不同字段"
- 时钟偏移容忍 1s + 节点 ID 字典序裁决（已有）

### E 阶段要解决的 3 个缺口

| # | 缺口 | 风险 |
|---|---|---|
| H1 | 实体级 LWW 导致"双端不同字段"的修改被相互覆盖 | 用户最常见的工作模式：A 改优先级，B 改截止日期，结果只剩一边的修改 |
| H2 | 没有"字段变更历史"，无法做"哪个字段被谁改过"的可视化 | UI 缺少字段级审计 |
| H3 | 协议层只支持"整条实体"广播，无法增量携带"只改了哪几个字段" | 流量浪费，且无法区分"只改 title"和"改了所有字段" |

---

## 二、E 阶段范围

### 在范围内（In Scope）

1. **字段级时间戳**：每个字段独立记录 `updated_at` / `updated_by`（节点 ID），存于 `_field_timestamps` JSON 字段
2. **字段级冲突解决算法 `resolve_field_level(local, remote, skew_sec=1.0)`**：
   - 遍历 entity 的所有字段
   - 对每个字段比较本地/远端的 `_field_timestamps[field].updated_at`
   - 时间差 < skew_sec → 按 `updated_by` 字典序裁决
   - 否则取较新的一边
3. **协议扩展**：`SYNC_BROADCAST` 携带 `_changed_fields: ["title", "priority"]`，接收方只对变更字段做字段级合并，未变更字段保留本地值
4. **数据迁移**：D 阶段已上线的库 → 启动时把 `updated_at` 复制为所有字段的默认时间戳，保证向后兼容
5. **本地变更检测**：应用层 `update_task` 时，记录本次实际改动的字段列表
6. **前端 UI 增强**：
   - 任务详情显示"字段级最后修改者"徽章
   - "冲突详情"对话框：列出哪些字段来自 A、哪些来自 B、哪些被合并
7. **测试覆盖**：
   - 字段级单测：3 类时间戳组合（一边新 / 同时改 / 同时不同字段）
   - 端到端：A 改 title + B 改 priority → B 收到广播后字段级合并 → 两者并存
   - UI 验收：6 项

### 不在范围内（Out of Scope）

- 真正的 CRDT（OT/CRDT 算法）—— 仍是 LWW 思想，但粒度到字段
- 三路以上合并（>2 节点同时改同一字段）—— 收敛即可，不做手工裁决 UI
- 字段级撤销（per-field undo）—— 仍是整条任务撤销
- 历史快照 / 时间机器 —— 等 E+ 阶段
- 移动端字段级 UI —— 桌面端先做
- 字段类型感知（如 list / dict）—— 只做基本标量（str / int / float / bool / null）

---

## 三、模块拆分

### 3.1 新增后端模块

| 文件 | 职责 | 行数估算 |
|---|---|---|
| `backend/network/field_merge.py` | 字段级合并算法 + 字段时间戳读写 | 250 |
| `backend/tests/test_field_merge.py` | 字段级算法单测（8 类场景） | 200 |
| `backend/tests/test_field_merge_e2e.py` | 双端同时改不同字段端到端 | 250 |
| `backend/tests/ui_verification_e_phase.py` | 6 项 UI 验收 | 150 |
| `docs/superpowers/plans/2026-06-20-e-phase-implementation.md` | 实施记录 | 200 |

合计：约 1050 行（含测试）

### 3.2 修改文件

| 文件 | 改动 |
|---|---|
| `backend/database/operations.py` | `tasks` 表加 `_field_timestamps` JSON 字段；`update_task` 记录实际改动字段 |
| `backend/database/models.py` | `Task` dataclass 加 `_field_timestamps` 默认 `{}` |
| `backend/network/sync_engine.py` | `apply_remote_change` 改为 `merge_remote_entity`（字段级）；新增 `_changed_fields` 提取 |
| `backend/network/protocol.py` | `SYNC_BROADCAST` 字段增加 `_changed_fields` 列表（可选） |
| `backend/api/todo_api.py` | `task_get_field_history` API：返回字段级时间戳 + 修改者 |
| `frontend/js/todo.js` | `updateTask` 跟踪 `changedFields`；渲染"最后修改者"徽章 |
| `frontend/js/taskCollaboration.js` | 任务详情加"字段来源"标签（A / B / 本机） |
| `frontend/css/components.css` | 字段徽章样式 |

### 3.3 数据结构变化

```sql
-- tasks 表加列
ALTER TABLE tasks ADD COLUMN _field_timestamps TEXT;  -- JSON: {"title": {"at": "...", "by": "node-A"}, ...}
```

默认 `{}`；未填字段视为继承 entity 顶层 `updated_at`。

```python
@dataclass
class Task:
    # ... 原有字段 ...
    _field_timestamps: Dict[str, Dict[str, str]] = field(default_factory=dict)
    # {"title": {"at": "2026-06-20T10:00:00Z", "by": "node-A"},
    #  "priority": {"at": "2026-06-20T10:00:05Z", "by": "node-B"}}
```

### 3.4 新增 API（1 个）

| API | 方法 | 说明 |
|---|---|---|
| `task_get_field_history` | GET(task_id) | 返回字段级时间戳字典 + 修改者节点 ID |

### 3.5 字段级合并算法

```python
def resolve_field_level(
    local: dict, remote: dict,
    local_node_id: str, remote_node_id: str,
    skew_sec: float = 1.0,
) -> dict:
    """字段级 LWW：每个字段独立比较 updated_at。
    返回合并后的 entity（dict）。"""
    merged = dict(local)  # 基线
    local_ts = local.get('_field_timestamps', {})
    remote_ts = remote.get('_field_timestamps', {})

    # 远端声明的变更字段（可选；缺省 = 全字段）
    changed = remote.get('_changed_fields') or list(remote.keys())

    for field in changed:
        if field in ('_field_timestamps', '_changed_fields', 'id'):
            continue
        lf = local_ts.get(field, {'at': local.get('updated_at', ''), 'by': local_node_id})
        rf = remote_ts.get(field, {'at': remote.get('updated_at', ''), 'by': remote_node_id})

        ldt = _parse_ts(lf['at'])
        rdt = _parse_ts(rf['at'])
        winner = _pick_winner(lf, rf, ldt, rdt, skew_sec, local_node_id, remote_node_id)
        if winner == 'remote':
            merged[field] = remote[field]
            local_ts[field] = rf
        # else: 保留 local，不动 local_ts

    merged['_field_timestamps'] = local_ts
    return merged


def _pick_winner(lf, rf, ldt, rdt, skew_sec, lid, rid):
    """单字段 LWW 裁决：clock-skew 容忍 + 节点 ID 字典序。"""
    if ldt and rdt:
        if abs((rdt - ldt).total_seconds()) < skew_sec:
            return 'remote' if (rf.get('by') or rid) > (lf.get('by') or lid) else 'local'
        return 'remote' if rdt > ldt else 'local'
    return 'remote' if (rf.get('by') or rid) > (lf.get('by') or lid) else 'local'
```

### 3.6 协议扩展

```python
# SYNC_BROADCAST 消息
{
  "type": "SYNC_BROADCAST",
  "protocol_version": "1.0.0",
  "entity_type": "task",
  "entity": {
    "id": "t1",
    "title": "新标题",
    "_field_timestamps": {
      "title": {"at": "2026-06-20T10:00:00Z", "by": "node-A"},
      "_entity": {"at": "2026-06-20T10:00:00Z", "by": "node-A"}
    },
    "_changed_fields": ["title"]   # ← 本次实际改的字段
  }
}
```

D 阶段接收方忽略 `_changed_fields`（按"全字段"合并），向后兼容。

### 3.7 端到端场景（核心 4 个）

```
# 场景 1：A 改 title，B 改 priority → 合并后两者并存
A.local_change(task, {title: "新标题", _changed_fields: ["title"]})
B.local_change(task, {priority: "high", _changed_fields: ["priority"]})
wait → A.db.task.priority == "high", B.db.task.title == "新标题"

# 场景 2：A 和 B 同时改 title（时间差 < 1s）→ 字典序裁决
# 场景 3：A 改 title，B 改 title（时间差 > 1s）→ 较新者胜
# 场景 4：A 改全字段，B 改全字段 → 退化为实体级 LWW
```

---

## 四、UI 验收（6 项）

| # | 验收项 |
|---|---|
| 1 | A 改 title + B 改 priority → 双方都看到两个字段都生效 |
| 2 | 同时改同一字段（差 < 1s）→ 提示"已按节点 ID 裁决：采用 X" |
| 3 | 任务详情显示每个字段的"最后修改者"节点徽章 |
| 4 | `task_get_field_history` API 返回字段级时间戳字典 |
| 5 | 字段徽章鼠标悬停显示完整时间戳 + 节点 ID |
| 6 | D 阶段遗留的"network.js 渲染对端"同步完成（吸纳进 E 阶段） |

---

## 五、里程碑（5 个）

| 里程碑 | 内容 | 估时 | 依赖 |
|---|---|---|---|
| M1 | `_field_timestamps` 字段 + 数据迁移 + `update_task` 改动检测 | 1.5h | - |
| M2 | `field_merge.py` 字段级合并算法 + 8 类单测 | 1.5h | M1 |
| M3 | `sync_engine.py` 接入字段级合并 + 协议 `_changed_fields` 扩展 | 1.5h | M2 |
| M4 | 端到端 4 场景 + 6 项 UI 验收 + 完整 0 回退 | 1.5h | M3 |
| M5 | D 阶段遗留 network.js 渲染 + 实施记录 | 1h | M3 |

合计：约 7 小时

---

## 六、风险与回退

| 风险 | 应对 |
|---|---|
| 字段级合并与 D 阶段实体级 LWW 行为不一致 → 0 回退失败 | `resolve_with_skew` 保留作为兜底；新代码默认走 `resolve_field_level`，旧调用点显式传 `level='entity'` |
| `_field_timestamps` 体积膨胀（每字段 2 个字段：at / by） | 仅记录有过修改的字段；空字典占位约 2 字节 |
| 字段类型为 list / dict（非标量）时合并语义不明 | 文档明确"仅标量字段支持字段级合并；非标量退化为整体替换" |
| 协议升级老节点不识别 `_changed_fields` | 老节点按"全字段"合并（视为 D 阶段行为），无破坏 |

---

## 七、退出条件（Definition of Done）

- [ ] 6 项 E 阶段 UI 验收 100% 通过
- [ ] 4 场景端到端 100% 通过（含 3 类时间戳组合 + 字段级合并）
- [ ] 后端总测试 ≥ 280（246 旧 + 34 E 新增）
- [ ] A/B/C/D 阶段 0 回退
- [ ] 文档：本文 + E 阶段实施记录
- [ ] D 阶段遗留 network.js 渲染已并入并通过

---

## 八、附录：字段级合并示意

```
时间线：
T0  初始：title="A", priority="normal", _field_ts={}
T1  A 端改 title → title="A2", _field_ts.title={at:T1, by:A}
T2  B 端改 priority → priority="high", _field_ts.priority={at:T2, by:B}
T3  A 端广播 T1 的变更（_changed_fields=[title]）
    → B 端 apply_remote_change 走 resolve_field_level
    → 字段 title: 远端 T1 > 本地 T0 → 取远端
    → 字段 priority: 不在 _changed_fields → 保留本地
    → B.db: title="A2", priority="high"  ✓ 两者并存
T4  B 端广播 T2 的变更（_changed_fields=[priority]）
    → A 端 apply_remote_change
    → 字段 title: 不在 _changed_fields → 保留本地（已是 A2）
    → 字段 priority: 远端 T2 > 本地 T0 → 取远端
    → A.db: title="A2", priority="high"  ✓ 收敛
```

---

## 九、待确认问题

1. **字段级 vs CRDT**：E 阶段仅做 LWW（细粒度），不做真正的 CRDT。是否需要预留 CRDT 扩展点？
2. **删除字段 vs 标记删除**：D 阶段删除走实体级软删（`is_deleted`）。E 阶段"删除"是单字段动作还是整条动作？建议：仍是整条。
3. **字段级 UI 范围**：桌面端先做；移动端留到 E+ 阶段。是否同意？

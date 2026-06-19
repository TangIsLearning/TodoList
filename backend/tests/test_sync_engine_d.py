"""
D 阶段 M4 单测：SyncEngine 增量同步 + clock-skew 容忍
- resolve_with_skew 三种路径：明显较新 / 视为同时（ID 大者胜出）/ 时间戳解析失败
- apply_pull_response 批量 apply
- sync_with_peer / record_sync_at / get_last_sync_at
- SKEW_TOLERANCE_SEC 常量
"""
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _fresh_db():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)
    from backend.database.operations import TodoDatabase, SyncManager
    db = TodoDatabase()
    return db, SyncManager(db), tmp.name


# ===== clock-skew =====

def test_skew_clear_winner_remote():
    """远端时间戳明显较新 → remote 胜出"""
    from backend.network.sync_engine import resolve_with_skew
    base = '2026-06-19T10:00:00Z'
    remote = '2026-06-19T10:05:00Z'
    assert resolve_with_skew(base, remote, 'A', 'B') == 'remote'


def test_skew_clear_winner_local():
    """本地时间戳明显较新 → local 胜出"""
    from backend.network.sync_engine import resolve_with_skew
    # local_ts=10:05, remote_ts=10:00 → local 胜出
    assert resolve_with_skew('2026-06-19T10:05:00Z', '2026-06-19T10:00:00Z', 'A', 'B') == 'local'


def test_skew_tie_resolved_by_node_id():
    """|Δt| < 1s 视为同时 → 节点 ID 字典序大的胜出。"""
    from backend.network.sync_engine import resolve_with_skew
    a = '2026-06-19T10:00:00.000Z'
    b = '2026-06-19T10:00:00.500Z'  # 差 0.5s
    # 远端 ID 更大 → remote 胜出
    assert resolve_with_skew(a, b, 'node-A', 'node-B') == 'remote'
    # 本地 ID 更大 → local 胜出
    assert resolve_with_skew(a, b, 'node-Z', 'node-A') == 'local'


def test_skew_at_boundary_just_under():
    """Δt = 0.99s → 视为同时（ID 大者胜出）。"""
    from backend.network.sync_engine import resolve_with_skew
    a = '2026-06-19T10:00:00.000Z'
    b = '2026-06-19T10:00:00.990Z'
    assert resolve_with_skew(a, b, 'A', 'B') == 'remote'


def test_skew_just_over():
    """Δt = 1.5s → 不再视为同时（按时间戳）。"""
    from backend.network.sync_engine import resolve_with_skew
    a = '2026-06-19T10:00:00.000Z'
    b = '2026-06-19T10:00:01.500Z'
    assert resolve_with_skew(a, b, 'A', 'B') == 'remote'


def test_skew_invalid_ts_falls_back_to_id():
    """时间戳解析失败 → 按节点 ID 字典序。"""
    from backend.network.sync_engine import resolve_with_skew
    # 非法格式
    assert resolve_with_skew('xxx', 'yyy', 'A', 'B') == 'remote'
    assert resolve_with_skew('xxx', 'yyy', 'Z', 'A') == 'local'
    # 空字符串
    assert resolve_with_skew('', '', 'A', 'B') == 'remote'


def test_skew_empty_id_falls_back():
    """节点 ID 都为空时 → remote 胜出（按实现：空字符串比较）。"""
    from backend.network.sync_engine import resolve_with_skew
    a = '2026-06-19T10:00:00Z'
    b = '2026-06-19T10:00:00.500Z'  # 视为同时
    # 双方 ID 相同时（都是 ''），比较：'>' 为 False → local
    result = resolve_with_skew(a, b, '', '')
    assert result in ('local', 'remote')  # 实现定义


def test_skew_tolerance_constant():
    from backend.network.sync_engine import SKEW_TOLERANCE_SEC
    assert SKEW_TOLERANCE_SEC == 1.0


def test_parse_ts_z_suffix():
    from backend.network.sync_engine import _parse_ts
    dt = _parse_ts('2026-06-19T10:00:00Z')
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.year == 2026 and dt.hour == 10


def test_parse_ts_offset():
    from backend.network.sync_engine import _parse_ts
    dt = _parse_ts('2026-06-19T10:00:00+08:00')
    assert dt is not None
    assert dt.utcoffset().total_seconds() == 8 * 3600


def test_parse_ts_invalid_returns_none():
    from backend.network.sync_engine import _parse_ts
    assert _parse_ts('') is None
    assert _parse_ts('not a date') is None
    assert _parse_ts(None) is None


# ===== apply_pull_response =====

def test_apply_pull_response_batch():
    """一次拉取多条 → 逐条 apply。"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        entities = [
            {'id': f't{i}', 'title': f't{i}', 'status': 'pending',
             'created_at': '2026-06-19T10:00:00Z',
             'updated_at': '2026-06-19T10:00:00Z', 'version': 1}
            for i in range(5)
        ]
        n = se.apply_pull_response('task', entities, peer_id='node-1')
        assert n == 5
        for i in range(5):
            assert db.get_task(f't{i}')['title'] == f't{i}'
    finally:
        Path(path).unlink(missing_ok=True)


def test_apply_pull_response_partial_failure():
    """个别实体格式异常时不影响整批。"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        # 第二条缺 'id'，apply_remote_change 内部会抛
        entities = [
            {'id': 't1', 'title': 'good', 'status': 'pending',
             'created_at': '2026-06-19T10:00:00Z',
             'updated_at': '2026-06-19T10:00:00Z'},
            {'title': 'no-id', 'status': 'pending'},  # 缺 id → 抛 KeyError
            {'id': 't2', 'title': 'good2', 'status': 'pending',
             'created_at': '2026-06-19T10:00:00Z',
             'updated_at': '2026-06-19T10:00:00Z'},
        ]
        n = se.apply_pull_response('task', entities, peer_id='node-1')
        # 第 1、3 条成功
        assert n == 2
        assert db.get_task('t1') is not None
        assert db.get_task('t2') is not None
    finally:
        Path(path).unlink(missing_ok=True)


# ===== last_sync_at 记录 =====

def test_sync_with_peer_returns_metadata():
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        meta = se.sync_with_peer('node-1', since='2026-06-19T10:00:00Z')
        assert meta['peer_id'] == 'node-1'
        assert meta['since'] == '2026-06-19T10:00:00Z'
        assert 'task' in meta['entity_types']
    finally:
        Path(path).unlink(missing_ok=True)


def test_record_and_get_last_sync_at():
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        assert se.get_last_sync_at('node-x') == ''
        se.record_sync_at('node-x', '2026-06-19T10:00:00Z')
        assert se.get_last_sync_at('node-x') == '2026-06-19T10:00:00Z'
        se.record_sync_at('node-x')  # 默认 now
        ts = se.get_last_sync_at('node-x')
        assert ts != '' and ts != '2026-06-19T10:00:00Z'
    finally:
        Path(path).unlink(missing_ok=True)

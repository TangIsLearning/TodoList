import sys, tempfile
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


def test_resolve_conflict_remote_newer():
    """远程时间戳更新 → 接受远程值"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'old', 'updated_at': '2026-06-19T10:00:00Z', 'version': 1}
        remote = {'title': 'new', 'updated_at': '2026-06-19T10:01:00Z', 'version': 2}
        result = sm.resolve_conflict(local, remote, field='title')
        assert result['title'] == 'new'
        assert result['version'] == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_resolve_conflict_local_newer():
    """本地时间戳更新 → 保留本地值"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'new', 'updated_at': '2026-06-19T10:01:00Z'}
        remote = {'title': 'old', 'updated_at': '2026-06-19T10:00:00Z'}
        result = sm.resolve_conflict(local, remote, field='title')
        assert result['title'] == 'new'
    finally:
        Path(path).unlink(missing_ok=True)


def test_resolve_conflict_delete_vs_edit():
    """删除 vs 修改：删除时间晚 → 删除胜出"""
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'edit', 'updated_at': '2026-06-19T10:00:00Z', 'is_deleted': 0}
        remote = {'title': 'old', 'updated_at': '2026-06-19T10:01:00Z', 'is_deleted': 1}
        result = sm.resolve_conflict(local, remote)
        assert result['is_deleted'] == 1
    finally:
        Path(path).unlink(missing_ok=True)


def test_log_sync_operation():
    db, sm, path = _fresh_db()
    try:
        sm.log_sync(entity_type='task', entity_id='t1', operation='push',
                    peer_id='node2', user_id='u1', has_conflict=0)
        logs = sm.list_recent_sync_logs(limit=10)
        assert len(logs) == 1
        assert logs[0].entity_type == 'task' and logs[0].operation == 'push'
    finally:
        Path(path).unlink(missing_ok=True)


def test_sync_engine_apply_new_task():
    """远端推送新任务 → 本地写入"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        se = SyncEngine(db=db, sync_manager=sm)
        task = {
            'id': 't1', 'title': 'new', 'status': 'pending', 'priority': 'none',
            'created_at': '2026-06-19T10:00:00Z', 'updated_at': '2026-06-19T10:00:00Z',
            'version': 1,
        }
        se.apply_remote_change('task', task, peer_id='node2')
        assert db.get_task('t1')['title'] == 'new'
    finally:
        Path(path).unlink(missing_ok=True)


def test_sync_engine_apply_update_with_conflict():
    """远端更新 + 本地有时间戳更新更早 → 字段级合并"""
    db, sm, path = _fresh_db()
    try:
        from backend.network.sync_engine import SyncEngine
        # 本地任务
        db.add_task({'id': 't1', 'title': 'local', 'status': 'pending',
                     'created_at': '2026-06-19T10:00:00Z',
                     'updated_at': '2026-06-19T10:00:00Z'})
        se = SyncEngine(db=db, sync_manager=sm)
        remote = {'id': 't1', 'title': 'remote', 'status': 'pending',
                  'created_at': '2026-06-19T10:01:00Z',
                  'updated_at': '2026-06-19T10:01:00Z'}
        se.apply_remote_change('task', remote, peer_id='node2')
        # 远端更新，应采用
        assert db.get_task('t1')['title'] == 'remote'

        logs = sm.list_recent_sync_logs()
        assert any(l.entity_id == 't1' for l in logs)
    finally:
        Path(path).unlink(missing_ok=True)


def test_resolve_conflict_with_camelCase():
    """真实数据流：get_task 返回 camelCase 字段名，resolve_conflict 必须能识别

    复现 bug：A/B 阶段 get_task 返回的字段是 camelCase（updatedAt / createdAt），
    但 SyncManager.resolve_conflict 只看 snake_case（updated_at），导致
    LWW 比较退化为 '' > ''（永远 false），远端更新永远无法覆盖本地。
    """
    db, sm, path = _fresh_db()
    try:
        local = {'title': 'old', 'updatedAt': '2026-06-19T10:00:00Z', 'version': 1}
        remote = {'title': 'new', 'updatedAt': '2026-06-19T10:01:00Z', 'version': 2}
        result = sm.resolve_conflict(local, remote, field='title')
        assert result['title'] == 'new', \
            f"期望 'new'（远端 updatedAt 更新），实际 {result.get('title')!r}"
        assert result['version'] == 2
    finally:
        Path(path).unlink(missing_ok=True)


def test_update_task_accepts_custom_updated_at():
    """update_task 应接受调用方传入的 updated_at / updatedAt，不强制 datetime.now()

    复现 bug：update_task 始终把 updated_at 覆写为 datetime.now().isoformat()，
    导致调用方传的时间戳（sync 场景下远端的时间戳）丢失，
    数据库里的 updated_at 永远是"刚发生"——LWW 失效。
    """
    db, path = _fresh_db()[0], _fresh_db()[2]
    # 注意：上面 _fresh_db() 一次会建一个临时 db 句柄，再调用一次又新建一个；
    # 这里重新调用一次以拿到干净 db
    db, sm, path = _fresh_db()
    try:
        db.add_task({'id': 't1', 'title': 'initial', 'status': 'pending'})
        # 调用方指定一个"过去"的时间戳（模拟远端同步过来的旧时间戳）
        custom_ts = '2026-06-19T10:00:00Z'
        db.update_task('t1', {'title': 'updated', 'updated_at': custom_ts})
        task = db.get_task('t1')
        # 应保留调用方传入的时间戳，不强制改为 now()
        assert task['updatedAt'] == custom_ts, \
            f"期望 updatedAt={custom_ts}（调用方传入），实际 {task.get('updatedAt')!r}"

        # 同时验证 updatedAt 键名也支持
        custom_ts2 = '2026-06-19T09:00:00Z'
        db.update_task('t1', {'title': 'updated2', 'updatedAt': custom_ts2})
        task2 = db.get_task('t1')
        assert task2['updatedAt'] == custom_ts2, \
            f"期望 updatedAt={custom_ts2}（camelCase 调用方传入），实际 {task2.get('updatedAt')!r}"
    finally:
        Path(path).unlink(missing_ok=True)

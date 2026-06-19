import sys, time, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _two_node_setup():
    """模拟双节点：各自独立 db + SyncEngine"""
    paths = []
    dbs = []
    from backend.database import operations
    from backend.database.operations import TodoDatabase, SyncManager
    for i in range(2):
        tmp = tempfile.NamedTemporaryFile(suffix=f'_{i}.db', delete=False)
        tmp.close()
        paths.append(tmp.name)
    operations.get_app_data_file = lambda: Path(paths[0])
    db_a = TodoDatabase()
    sm_a = SyncManager(db_a)
    operations.get_app_data_file = lambda: Path(paths[1])
    db_b = TodoDatabase()
    sm_b = SyncManager(db_b)
    return (db_a, sm_a, db_b, sm_b, paths)


def test_e2e_task_entity_level_lww():
    """A 创建任务 → B 拉取 → A 修改（时间更晚）→ A 推到 B → B 终态 = A 的版本

    验证：实体级 last-write-wins 语义：A 的整体 updated_at 更晚，则 B 整任务被 A 覆盖。
    字段级合并是未来工作（需 schema 扩展 {key}_updated_at 列）。
    """
    db_a, sm_a, db_b, sm_b, paths = _two_node_setup()
    try:
        from backend.network.sync_engine import SyncEngine

        # A 创建任务
        task = {
            'id': 't1', 'title': 'A title', 'status': 'pending', 'priority': 'none',
            'created_at': '2026-06-19T10:00:00Z',
            'updated_at': '2026-06-19T10:00:00Z', 'version': 1,
        }
        db_a.add_task(task)

        # B 拉取
        se_b = SyncEngine(db=db_b, sync_manager=sm_b)
        se_b.apply_remote_change('task', task, peer_id='nodeA')

        # A 在更晚时间修改
        a_updated = dict(task)
        a_updated['title'] = 'A updated'
        a_updated['updated_at'] = '2026-06-19T10:01:00Z'
        db_a.update_task('t1', {'title': 'A updated', 'updated_at': '2026-06-19T10:01:00Z'})

        # 同步：构造 A 的远端 payload 带 snake_case updated_at
        # （注：get_task 返回的是 camelCase 字段，而 resolve_conflict 实体级 LWW 比较使用的是 snake_case updated_at）
        a_task = db_a.get_task('t1')
        a_remote = dict(a_task)
        a_remote['updated_at'] = '2026-06-19T10:01:00Z'  # A 的整体 updated_at 更晚
        se_b.apply_remote_change('task', a_remote, peer_id='nodeA')

        # B 终态：因 A 整体 updated_at 更晚，B 整任务被 A 覆盖
        final = db_b.get_task('t1')
        assert final['title'] == 'A updated'
        # sync_log 应有推送记录
        logs = sm_b.list_recent_sync_logs()
        assert any(l.entity_id == 't1' and l.operation == 'push' for l in logs)
    finally:
        for p in paths:
            Path(p).unlink(missing_ok=True)

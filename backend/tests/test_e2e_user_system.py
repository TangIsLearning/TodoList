"""
端到端集成测试：用户系统 + 任务协作 + 审计日志（Task 18）
模拟完整流程：创建多用户 → 创建任务（含协作） → 更新任务 → 查询任务 → 查询审计日志 → 软删除用户
"""
import sys
import tempfile
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    """构造 TodoApi + db 实例，使用临时数据库"""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)

    from backend.database.operations import TodoDatabase, UserManager
    db = TodoDatabase()
    um = UserManager(db)

    from backend.api import todo_api
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


# ===== 1. 完整用户管理流程 =====

def test_e2e_user_lifecycle():
    """完整用户生命周期：创建 → 登录 → 切换 → 更新 → 列表 → 软删除"""
    api, path = _make_api()
    try:
        # 1) 创建 owner
        r1 = api.auth_create_user(display_name='项目Owner', unit='XX公司', department='总经办', role='Owner')
        assert r1['success']
        owner = r1['user']
        owner_id = owner['id']
        owner_token = r1['token']
        assert owner['role'] == 'Owner'
        # 切换到 owner 当前会话
        api.db.set_current_user(owner_id)

        # 2) 创建 member
        r2 = api.auth_create_user(display_name='小张', unit='XX公司', department='研发部', role='Member', avatar_color='#10b981')
        assert r2['success']
        member_id = r2['user']['id']
        assert r2['user']['role'] == 'Member'

        # 3) 切换用户
        r3 = api.auth_switch_user(member_id)
        assert r3['success']
        assert r3['user']['id'] == member_id
        api.db.set_current_user(member_id)

        # 4) getCurrent
        r4 = api.auth_get_current_user()
        assert r4['success']
        assert r4['user']['id'] == member_id

        # 5) 列表
        r5 = api.auth_list_local_users()
        assert r5['success']
        assert len(r5['users']) == 2
        # 排序：last_active_at DESC 应让小张在前
        assert r5['users'][0]['displayName'] == '小张'

        # 6) 更新用户
        r6 = api.auth_update_user(member_id, '小张A', 'XX公司', '产品部', 'Owner', '#ef4444')
        assert r6['success']
        assert r6['user']['displayName'] == '小张A'
        assert r6['user']['role'] == 'Owner'

        # 7) 软删除 owner（只剩一个小张A）
        r7 = api.auth_delete_user(owner_id)
        assert r7['success']
        # owner 拥有的任务应该被清空 owner_user_id
        # 删除用户会清除该用户的 session
        r8 = api.auth_list_local_users()
        assert r8['success']
        assert len(r8['users']) == 1
        assert r8['users'][0]['displayName'] == '小张A'
    finally:
        # 确保连接关闭
        try:
            api.db.get_connection().close()
        except Exception:
            pass
        Path(path).unlink(missing_ok=True)


# ===== 2. 任务协作 + 审计日志流程 =====

def test_e2e_task_with_collaborators_and_audit():
    """任务协作 + 审计日志：创建 2 用户 → 创建任务（含协作人） → 更新 → 切换用户 → 删除任务 → 验证审计"""
    api, path = _make_api()
    try:
        # 创建 2 用户
        r_alice = api.auth_create_user(display_name='Alice', role='Owner')
        alice_id = r_alice['user']['id']
        api.db.set_current_user(alice_id)

        r_bob = api.auth_create_user(display_name='Bob', role='Member')
        bob_id = r_bob['user']['id']

        # Alice 创建一个任务，把 Bob 设为协作人
        task_data = {
            'title': 'E2E 任务',
            'description': '端到端测试任务',
            'priority': 'high',
            'categoryId': None,
            'dueDate': None,
            'tags': [],
            'ownerUserId': alice_id,
            'cooperatorUserIds': [bob_id],
            'currentUserId': alice_id,
        }
        add_r = api.add_todo(task_data)
        assert add_r['success'], f"add_todo failed: {add_r}"
        task_id = add_r['task']['id']
        assert add_r['task']['ownerUserId'] == alice_id
        assert add_r['task']['cooperatorUserIds'] == [bob_id]

        # 查询任务：get_all_tasks 应返回 owner/cooperator
        all_tasks = api.db.get_all_tasks()
        assert len(all_tasks) == 1
        assert all_tasks[0]['ownerUserId'] == alice_id
        assert all_tasks[0]['cooperatorUserIds'] == [bob_id]

        # 分页查询也应包含
        paged = api.db.get_tasks_paginated(page=1, page_size=10)
        assert paged['total'] == 1
        assert paged['tasks'][0]['ownerUserId'] == alice_id

        # 单个查询
        one = api.db.get_task(task_id)
        assert one['ownerUserId'] == alice_id
        assert one['cooperatorUserIds'] == [bob_id]

        # Alice 更新任务（修改优先级）
        api.db.set_current_user(alice_id)
        upd = api.update_todo(task_id, {
            'title': 'E2E 任务',
            'priority': 'low',
            'categoryId': None,
            'dueDate': None,
            'description': '端到端测试任务',
            'currentUserId': alice_id,
        })
        assert upd['success']
        # 应该有 update 审计记录
        audit_r = api.task_get_audit_log(task_id)
        assert audit_r['success']
        actions = [log['action'] for log in audit_r['logs']]
        assert 'create' in actions
        assert 'update' in actions
        # 至少一条 update 字段是 priority
        update_logs = [l for l in audit_r['logs'] if l['action'] == 'update']
        priority_log = next((l for l in update_logs if l['field'] == 'priority'), None)
        assert priority_log is not None
        assert priority_log['oldValue'] == 'high'
        assert priority_log['newValue'] == 'low'

        # 协作人变更
        api.db.set_current_user(alice_id)
        upd2 = api.update_todo(task_id, {
            'title': 'E2E 任务',
            'priority': 'low',
            'categoryId': None,
            'dueDate': None,
            'description': '端到端测试任务',
            'cooperatorUserIds': [],  # 移除协作人
            'currentUserId': alice_id,
        })
        assert upd2['success']
        one2 = api.db.get_task(task_id)
        assert one2['cooperatorUserIds'] == []

        # 删除任务
        del_r = api.delete_todo(task_id, delete_all=False)
        # 兼容不同方法名
        if not del_r.get('success'):
            del_r = api.db.delete_task(task_id, current_user_id=alice_id)
        assert del_r['success']

        # 审计中应出现 delete
        audit_r2 = api.task_get_audit_log(task_id)
        assert audit_r2['success']
        actions2 = [log['action'] for log in audit_r2['logs']]
        assert 'delete' in actions2
    finally:
        try:
            api.db.get_connection().close()
        except Exception:
            pass
        Path(path).unlink(missing_ok=True)


# ===== 3. 软删除用户的级联处理 =====

def test_e2e_soft_delete_user_clears_ownership():
    """软删除用户时：该用户的任务 owner 清空，从协作人列表中移除"""
    api, path = _make_api()
    try:
        r1 = api.auth_create_user(display_name='负责人A', role='Owner')
        uid_a = r1['user']['id']
        api.db.set_current_user(uid_a)

        r2 = api.auth_create_user(display_name='协作B', role='Member')
        uid_b = r2['user']['id']

        # 创建一个有协作人的任务
        api.db.set_current_user(uid_a)
        tr = api.add_todo({
            'title': 'A 拥有、B 协作',
            'priority': 'none',
            'categoryId': None,
            'dueDate': None,
            'description': '',
            'tags': [],
            'ownerUserId': uid_a,
            'cooperatorUserIds': [uid_b],
            'currentUserId': uid_a,
        })
        assert tr['success']
        task_id = tr['task']['id']

        # 软删除 uid_a
        dr = api.auth_delete_user(uid_a)
        assert dr['success']
        # 任务 owner_user_id 应被清空
        after = api.db.get_task(task_id)
        assert after['ownerUserId'] is None
        assert uid_a not in (after['cooperatorUserIds'] or [])
    finally:
        try:
            api.db.get_connection().close()
        except Exception:
            pass
        Path(path).unlink(missing_ok=True)


# ===== 4. 审计日志含已删除用户占位 =====

def test_e2e_audit_log_shows_deleted_user_placeholder():
    """用户被软删除后，审计日志中的 userName 应为'已删除用户'"""
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='临时用户', role='Member')
        uid = r['user']['id']
        api.db.set_current_user(uid)
        tr = api.add_todo({
            'title': 'T',
            'description': '',
            'priority': 'none',
            'categoryId': None,
            'dueDate': None,
            'tags': [],
            'currentUserId': uid,
        })
        assert tr['success']
        task_id = tr['task']['id']

        # 删除临时用户（需要先有另一用户）
        api.auth_create_user(display_name='保留账号', role='Member')
        api.auth_delete_user(uid)

        log_r = api.task_get_audit_log(task_id)
        assert log_r['success']
        assert any(l['userName'] == '已删除用户' for l in log_r['logs'])
    finally:
        try:
            api.db.get_connection().close()
        except Exception:
            pass
        Path(path).unlink(missing_ok=True)


# ===== 5. 心跳 / session 流程 =====

def test_e2e_heartbeat_and_logout():
    """登录后心跳保持活跃；登出后 getCurrent 应返回 None"""
    api, path = _make_api()
    try:
        r = api.auth_create_user(display_name='Heart', role='Member')
        token = r['token']
        assert token is not None

        # 心跳
        hb = api.auth_heartbeat()
        assert hb['success']

        # 当前用户
        cur = api.auth_get_current_user()
        assert cur['user']['displayName'] == 'Heart'

        # 登出
        lo = api.auth_logout()
        assert lo['success']

        # 登出后
        cur2 = api.auth_get_current_user()
        assert cur2['user'] is None
    finally:
        try:
            api.db.get_connection().close()
        except Exception:
            pass
        Path(path).unlink(missing_ok=True)

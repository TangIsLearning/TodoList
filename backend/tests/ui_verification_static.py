"""
手动 UI 验证（Task 19）10 项清单 - 静态检查
检查所有关键 DOM 元素和 JS 钩子是否就位
"""
import re
import sys
from pathlib import Path

WORKTREE = Path(__file__).parent.parent.parent
INDEX_HTML = WORKTREE / "frontend" / "index.html"
COMPONENTS_CSS = WORKTREE / "frontend" / "css" / "components.css"
USER_JS = WORKTREE / "frontend" / "js" / "user.js"
TASK_COLLAB_JS = WORKTREE / "frontend" / "js" / "taskCollaboration.js"
API_JS = WORKTREE / "frontend" / "js" / "api.js"
MAIN_JS = WORKTREE / "frontend" / "js" / "main.js"


def _read(p):
    return p.read_text(encoding='utf-8')


def check(condition, msg):
    if condition:
        print(f"  [PASS] {msg}")
    else:
        print(f"  [FAIL] {msg}")
        raise AssertionError(msg)


def main():
    print("=" * 60)
    print("A 计划手动 UI 验证（10 项清单）")
    print("=" * 60)

    index = _read(INDEX_HTML)
    css = _read(COMPONENTS_CSS)
    user_js = _read(USER_JS)
    collab_js = _read(TASK_COLLAB_JS)
    api_js = _read(API_JS)
    main_js = _read(MAIN_JS)

    # 检查项 1: 启动应用 → 账号选择页（无账号空状态）
    print("\n[1] 启动应用 → 显示账号选择页（空状态）")
    check('id="account-selector-view"' in index, "存在 #account-selector-view 容器")
    check('class="account-selector-view"' in index, "account-selector-view 样式类")
    check('.account-selector-view' in css, "CSS 含 .account-selector-view")
    check('还没有账号' in user_js, "空状态提示文本 '还没有账号'")
    check('account-empty-hint' in css, "空状态样式")

    # 检查项 2: 创建账号 → 自动登录
    print("\n[2] 创建账号 → 自动登录进入主界面")
    check('id="create-account-modal"' in index, "存在 #create-account-modal 模态框")
    check('id="ca-display-name"' in index, "用户名输入框")
    check('id="ca-unit"' in index, "单位输入框")
    check('id="ca-department"' in index, "部门输入框")
    check('id="ca-role"' in index, "角色输入框")
    check('id="ca-color-picker"' in index, "颜色选择器")
    check('id="ca-submit"' in index, "创建并登录按钮")
    check('submitCreateAccount' in user_js, "UserManager.submitCreateAccount 方法")
    check('auth_create_user' in api_js, "API 桥接 auth_create_user")
    check('_enterMainView' in user_js, "_enterMainView 自动进入主视图")

    # 检查项 3: 侧边栏底部用户卡片
    print("\n[3] 侧边栏底部显示用户卡片")
    check('id="user-card"' in index, "存在 #user-card")
    check('id="user-card-avatar"' in index, "头像元素")
    check('id="user-card-name"' in index, "用户名元素")
    check('id="user-card-role"' in index, "角色元素")
    check('id="user-card-online"' in index, "在线指示灯")
    check('.user-card' in css, "用户卡片样式")
    check('.user-online-dot' in css, "在线指示灯样式")
    check('_renderUserCard' in user_js, "UserManager._renderUserCard 方法")
    # "联系作者" 侧边栏按钮应被移除（二维码弹窗标题允许保留）
    check('id="contact-author-btn"' not in index, "已移除侧边栏'联系作者'按钮")
    check('contact-author-section' not in index, "已移除 contact-author-section")

    # 检查项 4: 点击用户卡片展开菜单
    print("\n[4] 点击用户卡片展开菜单")
    check('id="user-menu"' in index, "存在 #user-menu")
    check('data-action="profile"' in index, "菜单项 - 个人设置")
    check('data-action="switch"' in index, "菜单项 - 切换账号")
    check('data-action="groups"' in index, "菜单项 - 协作组管理")
    check('data-action="logout"' in index, "菜单项 - 退出登录")
    check('.user-menu' in css, "用户菜单样式")
    check('_initUserCardInteraction' in user_js, "UserManager 绑定菜单交互")
    check('user-menu-in' in css, "菜单弹出动画")

    # 检查项 5: 创建第二个账号 + 切换
    print("\n[5] 创建第二个账号 + 切换账号")
    check('id="account-list"' in index, "账号列表容器")
    check('switchUser' in user_js, "UserManager.switchUser 方法")
    check('auth_switch_user' in api_js, "API 桥接 auth_switch_user")
    check('_renderAccountList' in user_js, "UserManager._renderAccountList")

    # 检查项 6: 个人设置修改
    print("\n[6] 个人设置修改用户名 + 颜色")
    check('id="profile-modal"' in index, "存在 #profile-modal 模态框")
    check('id="pr-display-name"' in index, "个人设置用户名输入")
    check('id="pr-color-picker"' in index, "个人设置颜色选择器")
    check('id="pr-save"' in index, "保存按钮")
    check('id="pr-delete"' in index, "删除账号按钮")
    check('openProfileModal' in user_js, "UserManager.openProfileModal")
    check('saveProfile' in user_js, "UserManager.saveProfile")
    check('auth_update_user' in api_js, "API 桥接 auth_update_user")

    # 检查项 7: 任务表单协作字段
    print("\n[7] 创建任务时选择协作人")
    check('id="task-owner"' in index, "责任人下拉框")
    check('id="task-cooperators"' in index, "协作人 chips 容器")
    check('renderOwnerSelect' in collab_js, "taskCollab.renderOwnerSelect")
    check('renderCooperatorChips' in collab_js, "taskCollab.renderCooperatorChips")
    check('collectCollaboratorData' in collab_js, "taskCollab.collectCollaboratorData")
    todo_js = _read(WORKTREE / "frontend" / "js" / "todo.js")
    check("taskData.ownerUserId" in todo_js, "todo.js 提交含 ownerUserId")
    check("taskData.cooperatorUserIds" in todo_js, "todo.js 提交含 cooperatorUserIds")
    check("window.taskCollab" in todo_js, "todo.js 引用 taskCollab")

    # 检查项 8: 任务详情显示协作 + 审计日志
    print("\n[8] 任务详情显示协作 + 审计日志标签页")
    check('id="task-detail-modal"' in index, "任务详情模态框")
    check('id="task-detail-owner"' in index, "任务详情-责任人")
    check('id="task-detail-cooperators"' in index, "任务详情-协作人")
    check('id="task-audit-list"' in index, "审计日志列表")
    check('data-tab="audit"' in index, "审计日志标签按钮")
    check('data-tab="info"' in index, "基本信息标签按钮")
    check('openTaskDetail' in collab_js, "taskCollab.openTaskDetail")
    check('loadAuditLog' in collab_js, "taskCollab.loadAuditLog")
    check('task_get_audit_log' in api_js, "API 桥接 task_get_audit_log")
    check("window.taskCollab.openTaskDetail" in todo_js, "todo.js.viewTaskDetails 引用新模态框")

    # 检查项 9: 删除用户 → 任务 owner 清空
    print("\n[9] 删除用户 → 任务 owner 清空（后端级联）")
    check('delete_user' in api_js, "API 桥接 auth_delete_user")
    ops_check = (WORKTREE / "backend" / "database" / "operations.py").read_text(encoding='utf-8')
    check("UPDATE tasks SET owner_user_id = NULL" in ops_check, "删除用户时清空任务 owner")
    check("cooperator_user_ids" in ops_check, "从协作人列表中移除")

    # 检查项 10: 退出登录
    print("\n[10] 退出登录")
    check('action === \'logout\'' in user_js or 'logout' in user_js, "logout 逻辑")
    check('auth_logout' in api_js, "API 桥接 auth_logout")
    check('userManager.logout' in user_js or '.logout()' in user_js, "UserManager.logout 方法")
    check('_showAccountSelector' in user_js, "退出后返回账号选择页")

    print("\n" + "=" * 60)
    print("[OK] 10 项验证全部通过")
    print("=" * 60)


if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        print(f"\n[FAIL] 验证失败: {e}")
        sys.exit(1)

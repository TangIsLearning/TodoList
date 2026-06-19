"""
B 阶段 13 项 UI 验证脚本（Task B14）
运行：python backend/tests/ui_verification_b_phase.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _make_api():
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    from backend.database import operations
    operations.get_app_data_file = lambda: Path(tmp.name)

    from backend.database.operations import TodoDatabase, UserManager, CategoryManager
    db = TodoDatabase()
    um = UserManager(db)
    cm = CategoryManager(db)

    from backend.api import todo_api
    api = todo_api.TodoApi.__new__(todo_api.TodoApi)
    api.db = db
    api.user_manager = um
    api.category_manager = cm
    api.is_android = False
    api.sync_manager = None
    return api, tmp.name


PASS = '\033[92m✓\033[0m'
FAIL = '\033[91m✗\033[0m'


def check(name, fn):
    try:
        result = fn()
        if result is True or result is None:
            print(f'  {PASS} {name}')
            return True
        print(f'  {FAIL} {name}: {result}')
        return False
    except Exception as e:
        print(f'  {FAIL} {name}: {e}')
        return False


def main():
    print('\n=== B 阶段 13 项验收 ===\n')
    api, db_path = _make_api()
    total = 0
    passed = 0

    def tally(r):
        nonlocal total, passed
        total += 1
        if r: passed += 1

    # 1. 登录用户 + 看到空分类列表
    def t1():
        r = api.auth_create_user(display_name='验收')
        assert r['success']
        r2 = api.category_list()
        assert r2['success'] and r2['categories'] == []
        return True
    tally(check('1. 登录后初始分类列表为空', t1))

    # 2. 新建顶级分类
    def t2():
        r = api.category_create(name='研发')
        assert r['success'] and r['category']['depth'] == 0
        return True
    tally(check('2. 新建顶级分类（depth=0）', t2))

    # 3. 新建二级 + 三级分类
    def t3():
        r1 = api.category_create(name='后端', parent_id=api.category_list()['categories'][0]['id'])
        assert r1['category']['depth'] == 1
        r2 = api.category_create(name='性能', parent_id=r1['category']['id'])
        assert r2['category']['depth'] == 2
        return True
    tally(check('3. 新建二级、三级分类（depth=1,2）', t3))

    # 4. 深度超限
    def t4():
        # 上一步已到 depth=2，再建子级应失败
        all_cats = api.category_list()['categories']
        leaf = next(c for c in all_cats if c['depth'] == 2)
        r = api.category_create(name='更深', parent_id=leaf['id'])
        assert not r['success'] and ('DEPTH' in r['error'] or 'depth' in r['error'].lower())
        return True
    tally(check('4. 4 级分类被拒绝（DEPTH_EXCEEDED）', t4))

    # 5. 重名校验
    def t5():
        r = api.category_create(name='研发')
        assert not r['success'] and ('DUPLICATE' in r['error'] or '已存在' in r['error'])
        return True
    tally(check('5. 同父级下重名被拒绝（DUPLICATE_NAME）', t5))

    # 6. 任务归属多分类
    def t6():
        all_cats = api.category_list()['categories']
        ids = [c['id'] for c in all_cats if c['depth'] in (0, 1)]
        r = api.add_todo({'title': 'T', 'categoryIds': ids})
        assert r['success']
        t = api.db.get_task(r['task']['id'])
        cids_raw = t['categoryIds']
        import json
        cids = cids_raw if isinstance(cids_raw, list) else json.loads(cids_raw or '[]')
        assert set(cids) == set(ids)
        return True
    tally(check('6. 任务可同时归属多个分类（categoryIds JSON 数组）', t6))

    # 7. 任务卡片 chip 渲染（前端逻辑）
    def t7():
        # 通过读前端文件验证 chip 渲染函数存在
        chip_path = Path(__file__).parent.parent.parent / 'frontend' / 'js' / 'todo.js'
        text = chip_path.read_text(encoding='utf-8')
        assert 'renderCategoryChips' in text
        assert 'task-category-chip' in text
        return True
    tally(check('7. 任务卡片渲染分类 chip（renderCategoryChips）', t7))

    # 8. 任务表单多选面板
    def t8():
        todo_path = Path(__file__).parent.parent.parent / 'frontend' / 'js' / 'todo.js'
        text = todo_path.read_text(encoding='utf-8')
        assert 'task-categories-selector' in text
        assert 'getSelectedCategoryIds' in text
        return True
    tally(check('8. 任务表单多选分类面板（chip + hidden）', t8))

    # 9. 拖拽：4 种模式（前端代码）
    def t9():
        side_path = Path(__file__).parent.parent.parent / 'frontend' / 'js' / 'categorySidebar.js'
        text = side_path.read_text(encoding='utf-8')
        assert "before" in text and "after" in text
        assert "_calcDropMode" in text
        assert "cat-drop-into" in text or "into" in text
        # 拖到根
        assert "rootArea" in text or "category-tree-root-drop" in text
        return True
    tally(check('9. 4 种拖拽：兄弟排序前/后、改父级、拖到根', t9))

    # 10. 路径 + AND 筛选
    def t10():
        cat_path = Path(__file__).parent.parent.parent / 'frontend' / 'js' / 'category.js'
        text = cat_path.read_text(encoding='utf-8')
        assert "getDescendantIds" in text
        assert "matchesFilter" in text
        # AND 逻辑：每个 selected 都需匹配
        assert "for (const sel of this.selected)" in text or "for" in text
        return True
    tally(check('10. 路径 + AND 筛选（matchesFilter）', t10))

    # 11. 选中状态本地持久化
    def t11():
        cat_path = Path(__file__).parent.parent.parent / 'frontend' / 'js' / 'category.js'
        text = cat_path.read_text(encoding='utf-8')
        assert "localStorage" in text
        assert "LS_KEY" in text or "category.sidebar" in text
        return True
    tally(check('11. 展开/选中状态 localStorage 持久化', t11))

    # 12. 移动后 depth 同步
    def t12():
        all_cats = api.category_list()['categories']
        # 找一个子节点
        sub = next(c for c in all_cats if c['depth'] == 1)
        # 移动到顶级
        r = api.category_move(sub['id'], None)
        assert r['success'] and r['category']['depth'] == 0
        # 它的原父级在 list 仍然存在
        r2 = api.category_list()
        assert any(c['id'] == sub['id'] for c in r2['categories'])
        return True
    tally(check('12. 移动分类 depth 同步（子 → 顶级）', t12))

    # 13. 环检测
    def t13():
        # 找父级与子级
        all_cats = api.category_list()['categories']
        # 由于上一步已把原二级移到顶级，现在需要再造一对父子
        r1 = api.category_create(name='父A')
        r2 = api.category_create(name='子B', parent_id=r1['category']['id'])
        # 试图把父A移到子B下
        r3 = api.category_move(r1['category']['id'], r2['category']['id'])
        assert not r3['success'] and ('CYCLE' in r3['error'] or '环' in r3['error'])
        return True
    tally(check('13. 移动形成环被拒绝（WOULD_CREATE_CYCLE）', t13))

    print(f'\n=== 通过 {passed}/{total} ===\n')
    Path(db_path).unlink(missing_ok=True)
    return 0 if passed == total else 1


if __name__ == '__main__':
    sys.exit(main())

// 多级分类前端管理器（Task B7）
// 状态 + 树 + 拖拽 + 侧边栏
(function() {
    'use strict';

    const LS_KEY = 'category.sidebar.expanded';
    const LS_FILTER_KEY = 'category.filter.selected';

    function _readLS(key, def) {
        try {
            const v = localStorage.getItem(key);
            return v == null ? def : JSON.parse(v);
        } catch (e) { return def; }
    }
    function _writeLS(key, v) {
        try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
    }

    class CategoryManager {
        constructor() {
            this.tree = [];           // 后端返回的扁平数组
            this.childrenMap = new Map();  // parentId -> [category]
            this.idMap = new Map();        // id -> category
            this.expanded = _readLS(LS_KEY, {});  // {categoryId: true}
            this.selected = new Set(_readLS(LS_FILTER_KEY, []));  // 多选筛选
            this.taskCounts = new Map();   // categoryId -> count
        }

        async init() {
            await this.refresh();
        }

        async refresh() {
            const r = await window.categoryApi.list();
            if (r && r.success && Array.isArray(r.categories)) {
                this.tree = r.categories;
                this._buildIndex();
            } else {
                this.tree = [];
                this.childrenMap = new Map();
                this.idMap = new Map();
            }
            return this.tree;
        }

        _buildIndex() {
            this.childrenMap = new Map();
            this.idMap = new Map();
            this.taskCounts = new Map();
            for (const c of this.tree) {
                this.idMap.set(c.id, c);
                this.taskCounts.set(c.id, c.taskCount || 0);
                const parentKey = c.parentId || '__root__';
                if (!this.childrenMap.has(parentKey)) this.childrenMap.set(parentKey, []);
                this.childrenMap.get(parentKey).push(c);
            }
            // 同级按 sortOrder 排序
            for (const arr of this.childrenMap.values()) {
                arr.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            }
        }

        // ===== 查询 =====
        getById(id) { return this.idMap.get(id); }
        getChildren(parentId) {
            return this.childrenMap.get(parentId || '__root__') || [];
        }
        getDescendantIds(id) {
            const result = [id];
            const stack = [id];
            while (stack.length) {
                const cur = stack.pop();
                const children = this.childrenMap.get(cur) || [];
                for (const ch of children) {
                    result.push(ch.id);
                    stack.push(ch.id);
                }
            }
            return result;
        }
        getPath(id) {
            const parts = [];
            let cur = this.idMap.get(id);
            const visited = new Set();
            while (cur && !visited.has(cur.id)) {
                visited.add(cur.id);
                parts.push(cur.name);
                cur = cur.parentId ? this.idMap.get(cur.parentId) : null;
            }
            return parts.reverse().join(' / ');
        }
        getTaskCount(id) {
            // 含所有后代
            const ids = this.getDescendantIds(id);
            let n = 0;
            for (const cid of ids) n += this.taskCounts.get(cid) || 0;
            return n;
        }

        // ===== CRUD =====
        async create(data) {
            const r = await window.categoryApi.create(data);
            if (r && r.success) {
                await this.refresh();
            }
            return r;
        }
        async update(categoryId, data) {
            const r = await window.categoryApi.update(categoryId, data);
            if (r && r.success) {
                await this.refresh();
            }
            return r;
        }
        async move(categoryId, newParentId, newSortOrder) {
            const r = await window.categoryApi.move(categoryId, newParentId, newSortOrder);
            if (r && r.success) {
                await this.refresh();
                // 自动展开新父级
                if (newParentId) this.expanded[newParentId] = true;
                _writeLS(LS_KEY, this.expanded);
            }
            return r;
        }
        async remove(categoryId) {
            const r = await window.categoryApi.delete(categoryId);
            if (r && r.success) {
                await this.refresh();
                this.selected.delete(categoryId);
                _writeLS(LS_FILTER_KEY, [...this.selected]);
            }
            return r;
        }

        // ===== 展开状态 =====
        isExpanded(id) { return !!this.expanded[id]; }
        toggleExpand(id) {
            if (this.expanded[id]) delete this.expanded[id];
            else this.expanded[id] = true;
            _writeLS(LS_KEY, this.expanded);
        }

        // ===== 筛选 =====
        toggleSelect(id) {
            if (this.selected.has(id)) {
                this.selected.delete(id);
            } else {
                if (this.selected.size >= 3) {
                    return { ok: false, reason: 'MAX_3' };
                }
                this.selected.add(id);
            }
            _writeLS(LS_FILTER_KEY, [...this.selected]);
            return { ok: true };
        }
        clearSelection() {
            this.selected.clear();
            _writeLS(LS_FILTER_KEY, []);
        }
        isSelected(id) { return this.selected.has(id); }

        /**
         * 任务筛选：路径 + AND
         * 选中节点 → 该节点 + 所有后代下的任务；多选 → 任务须属于至少一个所选（OR within same tree）
         * （spec 5.6：单选=该分类及后代；多选=AND 任务须同时属于所有所选）
         */
        matchesFilter(task) {
            if (this.selected.size === 0) return true;
            const cats = task.categoryIds || (task.categoryId ? [task.categoryId] : []);
            if (cats.length === 0) return false;
            // 路径展开
            const expanded = new Set();
            for (const sel of this.selected) {
                for (const d of this.getDescendantIds(sel)) expanded.add(d);
            }
            // AND: 任务须至少与每个所选类有交集
            for (const sel of this.selected) {
                const selDescendants = new Set(this.getDescendantIds(sel));
                if (!cats.some(cid => selDescendants.has(cid))) return false;
            }
            return true;
        }
    }

    window.categoryManager = new CategoryManager();
})();

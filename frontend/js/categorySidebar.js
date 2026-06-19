// 分类侧边栏渲染器（Task B8）——手风琴 + 选中 + 拖拽 + 右键菜单 + 节点管理
(function() {
    'use strict';

    const COLOR_OPTIONS = [
        '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
        '#ef4444', '#ec4899', '#8b5cf6', '#64748b'
    ];
    const ICON_OPTIONS = [
        '📁', '⚡', '🎨', '🧪', '📊', '🔧', '📌', '⭐',
        '📚', '💡', '🎯', '🔍', '🏠', '🚀', '🌐', '💼'
    ];

    function _escape(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }

    // 树节点模板
    function renderNode(c, depth) {
        const hasChildren = (window.categoryManager.getChildren(c.id).length > 0);
        const isExpanded = window.categoryManager.isExpanded(c.id);
        const isSelected = window.categoryManager.isSelected(c.id);
        const taskCount = window.categoryManager.getTaskCount(c.id);
        const indent = depth * 16;

        return `
        <div class="cat-tree-node ${isSelected ? 'selected' : ''}"
             data-cat-id="${_escape(c.id)}"
             data-depth="${depth}"
             draggable="true"
             style="--indent: ${indent}px;">
            <div class="cat-node-row">
                <span class="cat-toggle ${hasChildren ? '' : 'no-children'} ${isExpanded ? 'expanded' : ''}" data-action="toggle">${hasChildren ? (isExpanded ? '▼' : '▶') : ''}</span>
                <span class="cat-node-icon" style="background:${c.color}">${_escape(c.icon || '📁')}</span>
                <span class="cat-node-name" data-action="select">${_escape(c.name)}</span>
                <span class="cat-node-count">${taskCount}</span>
                <span class="cat-node-menu-btn" data-action="menu" title="操作">⋮</span>
            </div>
            ${hasChildren && isExpanded ? '<div class="cat-children">' + renderChildren(c.id, depth + 1) + '</div>' : ''}
        </div>`;
    }
    function renderChildren(parentId, depth) {
        const children = window.categoryManager.getChildren(parentId);
        return children.map(c => renderNode(c, depth)).join('');
    }

    // 选中态摘要
    function renderSelectedBar() {
        const sel = [...window.categoryManager.selected].map(id => window.categoryManager.getById(id)).filter(Boolean);
        if (sel.length === 0) return '';
        const names = sel.map(c => c.name).join(' + ');
        return `
        <div class="cat-selected-bar">
            <span>已选分类：${_escape(names)}</span>
            <button class="cat-clear-btn" data-action="clear-filter">清空</button>
        </div>`;
    }

    // 整棵侧边栏
    function render() {
        const root = window.categoryManager.getChildren(null);
        if (root.length === 0) {
            return `
            <div class="cat-tree-empty">
                <p>暂无分类</p>
                <button class="cat-add-root-btn" data-action="add-root">+ 新建分类</button>
            </div>`;
        }
        return `<div class="cat-tree">${root.map(c => renderNode(c, 0)).join('')}</div>`;
    }

    // 绑定事件
    function bindEvents(container) {
        container.querySelectorAll('[data-action="toggle"]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const node = el.closest('.cat-tree-node');
                const id = node.dataset.catId;
                window.categoryManager.toggleExpand(id);
                renderTo(container);
            };
        });
        container.querySelectorAll('[data-action="select"]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const node = el.closest('.cat-tree-node');
                const id = node.dataset.catId;
                const r = window.categoryManager.toggleSelect(id);
                if (!r.ok && r.reason === 'MAX_3') {
                    if (window.Utils && Utils.showToast) Utils.showToast('最多支持 3 个分类联合筛选', 'warning');
                }
                renderTo(container);
                if (window.todoManager && typeof window.todoManager.applyFilters === 'function') {
                    window.todoManager.applyFilters();
                } else if (window.todoManager && typeof window.todoManager.refreshTasks === 'function') {
                    window.todoManager.refreshTasks();
                }
            };
        });
        container.querySelectorAll('[data-action="menu"]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const node = el.closest('.cat-tree-node');
                showContextMenu(node.dataset.catId, e.clientX, e.clientY);
            };
        });
        container.querySelectorAll('[data-action="add-root"]').forEach(el => {
            el.onclick = () => openEditor(null, null);
        });
        container.querySelectorAll('[data-action="clear-filter"]').forEach(el => {
            el.onclick = () => {
                window.categoryManager.clearSelection();
                renderTo(container);
                if (window.todoManager && typeof window.todoManager.applyFilters === 'function') {
                    window.todoManager.applyFilters();
                }
            };
        });
    }

    // 右键菜单
    let _ctxMenu = null;
    function showContextMenu(catId, x, y) {
        hideContextMenu();
        const cat = window.categoryManager.getById(catId);
        if (!cat) return;
        const hasChildren = window.categoryManager.getChildren(catId).length > 0;
        const canHaveChildren = cat.depth < 2;
        const menu = document.createElement('div');
        menu.className = 'cat-context-menu';
        menu.innerHTML = `
            <div class="ctx-item" data-act="add-child" ${canHaveChildren ? '' : 'disabled'}>+ 新建子分类</div>
            <div class="ctx-item" data-act="rename">✎ 重命名</div>
            <div class="ctx-item" data-act="edit-style">🎨 修改图标/色</div>
            <div class="ctx-item" data-act="move">⇄ 移动到...</div>
            <div class="ctx-divider"></div>
            <div class="ctx-item ctx-danger" data-act="delete" ${hasChildren ? 'disabled' : ''}>🗑 删除</div>
        `;
        document.body.appendChild(menu);
        menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 220) + 'px';
        menu.querySelectorAll('.ctx-item').forEach(it => {
            if (it.hasAttribute('disabled')) return;
            it.onclick = () => {
                hideContextMenu();
                const act = it.dataset.act;
                if (act === 'add-child') openEditor(null, catId);
                else if (act === 'rename') openEditor(catId, null, { name: cat.name });
                else if (act === 'edit-style') openEditor(catId, null, { icon: cat.icon, color: cat.color });
                else if (act === 'move') openMoveDialog(catId);
                else if (act === 'delete') confirmDelete(catId);
            };
        });
        _ctxMenu = menu;
        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
        }, 0);
    }
    function hideContextMenu() {
        if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
    }

    // 分类编辑模态框（新建/重命名/改样式）
    function openEditor(editId, parentId, preset) {
        const modal = document.getElementById('category-editor-modal');
        if (!modal) return;
        const title = modal.querySelector('.modal-header h2');
        title.textContent = editId ? '编辑分类' : '新建分类';

        const nameInput = modal.querySelector('#ce-name');
        const iconWrap = modal.querySelector('#ce-icon-picker');
        const colorWrap = modal.querySelector('#ce-color-picker');
        const parentSel = modal.querySelector('#ce-parent');
        const sortInput = modal.querySelector('#ce-sort');
        const hint = modal.querySelector('#ce-hint');
        const errEl = modal.querySelector('#ce-error');
        errEl.style.display = 'none';

        // 图标
        const currentIcon = (preset && preset.icon) || (editId ? window.categoryManager.getById(editId).icon : '📁');
        iconWrap.innerHTML = ICON_OPTIONS.map(ic =>
            `<span class="cat-icon-pick ${ic === currentIcon ? 'selected' : ''}" data-icon="${ic}">${ic}</span>`
        ).join('');
        iconWrap.querySelectorAll('.cat-icon-pick').forEach(el => {
            el.onclick = () => {
                iconWrap.querySelectorAll('.cat-icon-pick').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
            };
        });

        // 颜色
        const currentColor = (preset && preset.color) || (editId ? window.categoryManager.getById(editId).color : '#4f46e5');
        colorWrap.innerHTML = COLOR_OPTIONS.map(c =>
            `<span class="cat-color-dot ${c === currentColor ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`
        ).join('');
        colorWrap.querySelectorAll('.cat-color-dot').forEach(el => {
            el.onclick = () => {
                colorWrap.querySelectorAll('.cat-color-dot').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
            };
        });

        // 父分类
        const flat = window.categoryManager.tree;
        const opts = ['<option value="">(顶级)</option>'];
        for (const c of flat) {
            if (c.depth >= 2) continue; // 不能作为新分类的父
            if (editId && c.id === editId) continue;
            const sel = (parentId && c.id === parentId) || (!editId && !parentId && c.id === (preset && preset.parentId)) ? ' selected' : '';
            const prefix = '　'.repeat(c.depth);
            opts.push(`<option value="${_escape(c.id)}"${sel}>${prefix}${_escape(c.name)}</option>`);
        }
        parentSel.innerHTML = opts.join('');

        // 名称
        nameInput.value = (preset && preset.name) || (editId ? window.categoryManager.getById(editId).name : '');

        // 排序
        sortInput.value = (preset && preset.sortOrder) || (editId ? window.categoryManager.getById(editId).sortOrder : 0);

        // 父级提示
        const updateHint = () => {
            const pid = parentSel.value;
            if (pid) {
                const p = window.categoryManager.getById(pid);
                if (p && p.depth >= 2) {
                    hint.textContent = '父级为叶子时无法再新建子级';
                } else if (p) {
                    hint.textContent = `父级为"${p.name}"，新分类为 ${p.depth + 1} 级`;
                }
            } else {
                hint.textContent = '顶级分类（0 级）';
            }
        };
        parentSel.onchange = updateHint;
        updateHint();

        // 保存
        const saveBtn = modal.querySelector('#ce-save');
        saveBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) { errEl.textContent = '请输入分类名称'; errEl.style.display = 'block'; return; }
            const icon = iconWrap.querySelector('.cat-icon-pick.selected')?.dataset.icon || '📁';
            const color = colorWrap.querySelector('.cat-color-dot.selected')?.dataset.color || '#4f46e5';
            const sortOrder = parseInt(sortInput.value) || 0;
            const data = { name, icon, color, sortOrder };
            if (!editId) {
                const pid = parentSel.value || null;
                if (pid) data.parentId = pid;
                const r = await window.categoryManager.create(data);
                if (r && r.success) {
                    closeModal();
                    if (pid) {
                        window.categoryManager.expanded[pid] = true;
                        localStorage.setItem('category.sidebar.expanded', JSON.stringify(window.categoryManager.expanded));
                    }
                    renderTo(document.getElementById('category-tree-area'));
                } else {
                    errEl.textContent = (r && r.error) || '创建失败';
                    errEl.style.display = 'block';
                }
            } else {
                const r = await window.categoryManager.update(editId, data);
                if (r && r.success) {
                    closeModal();
                    renderTo(document.getElementById('category-tree-area'));
                } else {
                    errEl.textContent = (r && r.error) || '保存失败';
                    errEl.style.display = 'block';
                }
            }
        };

        // 删除按钮（仅编辑模式显示）
        const delBtn = modal.querySelector('#ce-delete');
        delBtn.style.display = editId ? '' : 'none';
        delBtn.onclick = () => { closeModal(); confirmDelete(editId); };

        modal.style.display = 'flex';
        const closeFn = () => closeModal();
        modal.querySelectorAll('[data-close="category-editor-modal"]').forEach(el => el.onclick = closeFn);
    }
    function closeModal() {
        const m = document.getElementById('category-editor-modal');
        if (m) m.style.display = 'none';
    }

    // 移动到... 对话框
    function openMoveDialog(catId) {
        const cat = window.categoryManager.getById(catId);
        if (!cat) return;
        const candidates = window.categoryManager.tree.filter(c => {
            if (c.id === catId) return false;
            if (c.depth >= 2) return false; // 不能作为新父
            // 排除自身后代
            const desc = new Set(window.categoryManager.getDescendantIds(catId));
            if (desc.has(c.id)) return false;
            return true;
        });
        // 渲染模态（用 alert 对话框简单实现）
        const choices = ['__root__', ...candidates.map(c => c.id)];
        const labels = ['(顶级)', ...candidates.map(c => '　'.repeat(c.depth) + c.name)];
        // 用一个简化的 prompt
        const lines = ['选择目标父分类（取消=不操作）：', '0: (顶级)'];
        for (let i = 0; i < candidates.length; i++) {
            lines.push(`${i + 1}: ${labels[i + 1]}`);
        }
        const input = prompt(lines.join('\n'), '0');
        if (input === null) return;
        const idx = parseInt(input) || 0;
        if (idx < 0 || idx >= choices.length) {
            alert('无效选项');
            return;
        }
        const newParentId = choices[idx] === '__root__' ? null : choices[idx];
        window.categoryManager.move(catId, newParentId).then(r => {
            if (r && r.success) {
                if (newParentId) {
                    window.categoryManager.expanded[newParentId] = true;
                    localStorage.setItem('category.sidebar.expanded', JSON.stringify(window.categoryManager.expanded));
                }
                renderTo(document.getElementById('category-tree-area'));
            } else if (r && r.error) {
                alert('移动失败：' + r.error);
            }
        });
    }

    // 删除确认
    function confirmDelete(catId) {
        const cat = window.categoryManager.getById(catId);
        if (!cat) return;
        const hasChildren = window.categoryManager.getChildren(catId).length > 0;
        if (hasChildren) {
            alert('请先处理子分类（不能删除有子级的分类）');
            return;
        }
        if (!confirm(`确定删除分类"${cat.name}"？引用此分类的任务将自动移除该分类。`)) return;
        window.categoryManager.remove(catId).then(r => {
            if (r && r.success) {
                renderTo(document.getElementById('category-tree-area'));
                if (window.Utils && Utils.showToast) Utils.showToast(`已删除，影响 ${r.affectedTaskCount || 0} 个任务`, 'success');
            } else if (r && r.error) {
                alert('删除失败：' + r.error);
            }
        });
    }

    // 拖拽支持（HTML5 drag & drop）—— 4 种模式：兄弟排序前 / 兄弟排序后 / 改父级 / 拖到根
    let _dragCatId = null;
    let _dropMode = null; // 'before' | 'after' | 'into' | 'root'

    function _calcDropMode(nodeEl, e) {
        // 顶 25% = before；中 50% = into；底 25% = after
        const rect = nodeEl.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const ratio = offsetY / rect.height;
        if (ratio < 0.25) return 'before';
        if (ratio > 0.75) return 'after';
        return 'into';
    }

    function _applyDropVisuals(nodeEl, mode) {
        // 重置
        nodeEl.classList.remove('cat-drop-before', 'cat-drop-after', 'cat-drop-into', 'cat-drop-reject');
        if (mode === 'before') nodeEl.classList.add('cat-drop-before');
        else if (mode === 'after') nodeEl.classList.add('cat-drop-after');
        else if (mode === 'into') nodeEl.classList.add('cat-drop-into');
        else if (mode === 'reject') nodeEl.classList.add('cat-drop-reject');
    }

    /**
     * 计算 sort_order：插入到 before 节点之前或 after 节点之后
     * 策略：取相邻兄弟 sortOrder 的中点；若需重新分桶则用整数 10 间隔
     */
    function _computeSortOrder(targetId, mode, draggedId) {
        const dragged = window.categoryManager.getById(draggedId);
        if (!dragged) return null;
        const target = window.categoryManager.getById(targetId);
        if (!target) return null;

        // before: 找到同父级、sortOrder < target.sortOrder 中最大者
        // after: 找到同父级、sortOrder > target.sortOrder 中最小者
        const siblings = window.categoryManager.getChildren(target.parentId)
            .filter(c => c.id !== draggedId)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        const targetOrder = target.sortOrder || 0;
        let prev = null, next = null;
        for (const s of siblings) {
            const so = s.sortOrder || 0;
            if (so < targetOrder && (!prev || so > (prev.sortOrder || 0))) prev = s;
            if (so > targetOrder && (!next || so < (next.sortOrder || 0))) next = s;
        }

        if (mode === 'before') {
            const p = prev ? (prev.sortOrder || 0) : (targetOrder - 10);
            const n = targetOrder;
            return (p + n) / 2;
        } else if (mode === 'after') {
            const p = targetOrder;
            const n = next ? (next.sortOrder || 0) : (targetOrder + 10);
            return (p + n) / 2;
        }
        return null;
    }

    function bindDragDrop(container) {
        container.querySelectorAll('.cat-tree-node').forEach(node => {
            node.addEventListener('dragstart', (e) => {
                _dragCatId = node.dataset.catId;
                _dropMode = null;
                e.dataTransfer.setData('text/plain', _dragCatId);
                e.dataTransfer.effectAllowed = 'move';
                node.classList.add('dragging');
            });
            node.addEventListener('dragend', () => {
                _dragCatId = null;
                _dropMode = null;
                node.classList.remove('dragging');
                container.querySelectorAll('.cat-drop-before, .cat-drop-after, .cat-drop-into, .cat-drop-reject, .cat-drop-target')
                    .forEach(x => x.classList.remove('cat-drop-before', 'cat-drop-after', 'cat-drop-into', 'cat-drop-reject', 'cat-drop-target'));
            });
            node.addEventListener('dragover', (e) => {
                if (!_dragCatId) return;
                e.preventDefault();
                const targetId = node.dataset.catId;
                if (targetId === _dragCatId) return;
                const target = window.categoryManager.getById(targetId);
                if (!target) return;
                // 拒绝：target 是 drag 的后代（任何模式都拒绝）
                const desc = new Set(window.categoryManager.getDescendantIds(_dragCatId));
                if (desc.has(targetId)) {
                    _dropMode = 'reject';
                    _applyDropVisuals(node, 'reject');
                    e.dataTransfer.dropEffect = 'none';
                    return;
                }
                const mode = _calcDropMode(node, e);
                // 'into' 模式需要 target 非叶子
                if (mode === 'into' && target.depth >= 2) {
                    // fallback 到 'after' 模式
                    _dropMode = 'after';
                } else {
                    _dropMode = mode;
                }
                _applyDropVisuals(node, _dropMode);
                e.dataTransfer.dropEffect = 'move';
            });
            node.addEventListener('dragleave', () => {
                node.classList.remove('cat-drop-before', 'cat-drop-after', 'cat-drop-into', 'cat-drop-reject');
            });
            node.addEventListener('drop', (e) => {
                e.preventDefault();
                const targetId = node.dataset.catId;
                if (!_dragCatId || _dragCatId === targetId) return;
                const target = window.categoryManager.getById(targetId);
                if (!target) return;
                // 拒绝环
                const desc = new Set(window.categoryManager.getDescendantIds(_dragCatId));
                if (desc.has(targetId)) {
                    if (window.Utils && Utils.showToast) Utils.showToast('无法移动到子分类下', 'warning');
                    return;
                }

                // 根据 _dropMode 决定行为
                const mode = _dropMode || 'into';
                if (mode === 'into') {
                    // 改父级：成为 target 的子
                    if (target.depth >= 2) {
                        if (window.Utils && Utils.showToast) Utils.showToast('目标父级已为叶子，无法再嵌套', 'warning');
                        return;
                    }
                    // sortOrder = 同级最大 + 1
                    const siblings = window.categoryManager.getChildren(targetId).filter(c => c.id !== _dragCatId);
                    const newSort = siblings.length ? Math.max(...siblings.map(s => s.sortOrder || 0)) + 1 : 0;
                    window.categoryManager.move(_dragCatId, targetId, newSort).then(r => {
                        if (r && r.success) {
                            window.categoryManager.expanded[targetId] = true;
                            localStorage.setItem('category.sidebar.expanded', JSON.stringify(window.categoryManager.expanded));
                            renderTo(container);
                        } else if (r && r.error) {
                            alert('移动失败：' + r.error);
                        }
                    });
                } else if (mode === 'before' || mode === 'after') {
                    // 兄弟排序：parent 不变（除非需要）; sortOrder 插值
                    const newSort = _computeSortOrder(targetId, mode, _dragCatId);
                    window.categoryManager.move(_dragCatId, target.parentId || null, newSort).then(r => {
                        if (r && r.success) {
                            if (target.parentId) {
                                window.categoryManager.expanded[target.parentId] = true;
                                localStorage.setItem('category.sidebar.expanded', JSON.stringify(window.categoryManager.expanded));
                            }
                            renderTo(container);
                        } else if (r && r.error) {
                            alert('移动失败：' + r.error);
                        }
                    });
                }
            });
        });

        // 拖到根区域 = 顶级
        const rootArea = document.getElementById('category-tree-root-drop');
        if (rootArea) {
            rootArea.addEventListener('dragover', (e) => {
                if (!_dragCatId) return;
                e.preventDefault();
                rootArea.classList.add('cat-drop-target');
                _dropMode = 'root';
            });
            rootArea.addEventListener('dragleave', () => {
                rootArea.classList.remove('cat-drop-target');
            });
            rootArea.addEventListener('drop', (e) => {
                e.preventDefault();
                rootArea.classList.remove('cat-drop-target');
                if (!_dragCatId) return;
                // 顶级：sortOrder = 顶级最大 + 1
                const top = window.categoryManager.getChildren(null).filter(c => c.id !== _dragCatId);
                const newSort = top.length ? Math.max(...top.map(s => s.sortOrder || 0)) + 1 : 0;
                window.categoryManager.move(_dragCatId, null, newSort).then(r => {
                    if (r && r.success) {
                        renderTo(container);
                    } else if (r && r.error) {
                        alert('移动失败：' + r.error);
                    }
                });
            });
        }
    }

    function renderTo(container) {
        if (!container) return;
        const sel = renderSelectedBar();
        container.innerHTML = `
            <div class="cat-sidebar-header">
                <span class="cat-sidebar-title">📁 分类</span>
                <button class="cat-add-btn" data-action="add-root" title="新建分类">+</button>
            </div>
            ${sel}
            <div id="category-tree-root-drop" class="cat-tree-root-drop">
                ${render()}
            </div>`;
        bindEvents(container);
        bindDragDrop(container);
    }

    window.categorySidebar = { renderTo };
})();

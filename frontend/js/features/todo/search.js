/**
 * 搜索控制器：标签 chips + 结构化查询 + 子任务联想下拉
 *
 * 三部分围绕同一个搜索输入框工作（输入事件同时驱动 chips 显隐、
 * 查询构建与 ">" 联想下拉），彼此耦合紧密，故合并为一个控制器。
 *
 * 依赖的 TodoManager 成员：
 *   状态：searchChips / searchQuery / _chipEls / _searchDebounceTimer /
 *        _subtaskSuggestTimer / _subtaskSuggestItems / _subtaskSuggestIndex /
 *        subtaskParent / dropdown / currentPage / customDateFilter
 *   DOM：searchInput / searchTagWrapper / searchClearBtn
 *   方法：tagManager（refreshSelection / getTags）/ loadTasks
 *   其它控制器：ctx.infiniteScroll.reset
 */
class SearchController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // ===== 标签筛选状态访问（对标签模块与统计模块的统一出口） =====

    // 列表筛选中的标签 chips（含仅按名称匹配、尚无 id 的 chip）
    getTagFilterChips() {
        return this.ctx.searchChips.filter(chip => chip.type === 'tag' && chip.value);
    }

    // 列表筛选中的标签 id（尚无 id 的名称型 chip 不在其中）
    getTagFilterIds() {
        return this.getTagFilterChips()
            .filter(chip => chip.tagId)
            .map(chip => chip.tagId);
    }

    // 列表筛选中的标签名称（供统计等模块展示当前标签筛选）
    getTagFilterNames() {
        return this.getTagFilterChips().map(chip => chip.value);
    }

    // 清空全部搜索 chips 并同步视图（左侧标签选中态 + 清空按钮显隐）。
    // 只负责视图与状态，不触发重新加载，由调用方决定何时 loadTasks。
    clearChips() {
        const ctx = this.ctx;
        if (ctx.searchChips.length === 0) {
            ctx.tagManager.refreshSelection();
            return false;
        }
        ctx.searchChips = [];
        this.renderChips();
        ctx.tagManager.refreshSelection();
        this.updateClearButton();
        return true;
    }

    // ===== 搜索标签 chips 相关 =====

    // 初始化搜索标签输入框
    initInput() {
        const ctx = this.ctx;
        // 键盘交互：空格提交 #标签、退格删除最后一个 chip、回车提交/搜索
        ctx.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

        // 输入变化：实时更新清空按钮，并防抖触发搜索（自由文本搜索）
        // 当输入以 ">" 开头（且无 chip）时，进入子任务建议模式：仅刷新下拉，不重载主列表
        ctx.searchInput.addEventListener('input', () => {
            this.updateClearButton();
            if (this.isSuggestMode(ctx.searchInput.value)) {
                // 仍以 ">" 开头但文本已被改写时，之前选中的父任务精确ID不再可信，
                // 清除后自动回退为按名称解析
                if (ctx.subtaskParent.title
                    && ctx.searchInput.value.trim() !== `>${ctx.subtaskParent.title}`) {
                    this.setParent(null, null);
                }
                this.scheduleSuggestions(250);
            } else {
                // 退出 ">" 子任务搜索模式，清除记录的父任务
                this.setParent(null, null);
                this.hideSuggestions();
                this.scheduleSearch(300);
            }
        });
        ctx.searchInput.addEventListener('change', () => this.updateClearButton());

        // 失焦时延时关闭下拉（延时以允许点击命中建议项）
        ctx.searchInput.addEventListener('blur', () => {
            setTimeout(() => this.hideSuggestions(), 150);
        });

        // 点击 wrapper 空白区域时聚焦输入框
        ctx.searchTagWrapper.addEventListener('click', (e) => {
            if (e.target === ctx.searchInput) return;
            if (e.target.classList && e.target.classList.contains('search-chip-remove')) return;
            ctx.searchInput.focus();
        });

        // 初始渲染（空）
        this.renderChips();
    }

    // 处理搜索输入框的键盘事件
    handleKeydown(e) {
        const ctx = this.ctx;
        const searchInput = e.target;
        const val = searchInput.value;
        const tagPattern = TAG_INPUT_PATTERN;

        // 子任务建议下拉的键盘交互（仅当处于 ">" 模式且下拉有项时）
        if (this.isSuggestMode(val) && ctx._subtaskSuggestItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                ctx._subtaskSuggestIndex = (ctx._subtaskSuggestIndex + 1) % ctx._subtaskSuggestItems.length;
                this._highlightSuggestion();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                ctx._subtaskSuggestIndex = (ctx._subtaskSuggestIndex - 1 + ctx._subtaskSuggestItems.length)
                    % ctx._subtaskSuggestItems.length;
                this._highlightSuggestion();
                return;
            }
            if (e.key === 'Enter' && ctx._subtaskSuggestIndex >= 0) {
                const item = ctx._subtaskSuggestItems[ctx._subtaskSuggestIndex];
                if (item) {
                    e.preventDefault();
                    this.selectSuggestion(item.title, item.id);
                    return;
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hideSuggestions();
                return;
            }
        }

        // 空格：若当前输入是一个完整的 #标签，则提交为 chip
        if ((e.key === ' ' || e.code === 'Space') && tagPattern.test(val)) {
            e.preventDefault();
            this.addChip({ type: 'tag', value: val.substring(1) });
            searchInput.value = '';
            this.syncQuery(0);
            return;
        }

        // 退格：输入框为空时删除最后一个 chip
        if (e.key === 'Backspace' && val === '' && ctx.searchChips.length > 0) {
            e.preventDefault();
            this.removeChip(ctx.searchChips.length - 1);
            this.syncQuery(0);
            return;
        }

        // 回车：提交 #标签（若是），并触发搜索
        if (e.key === 'Enter') {
            e.preventDefault();
            if (tagPattern.test(val)) {
                this.addChip({ type: 'tag', value: val.substring(1) });
                searchInput.value = '';
            }
            this.hideSuggestions();
            this.syncQuery(0);
        }
    }

    // 若输入框内容是完整的 #标签，提交为 chip（用于搜索按钮点击）
    commitInputAsChipIfTag() {
        const ctx = this.ctx;
        const val = ctx.searchInput.value.trim();
        if (TAG_INPUT_PATTERN.test(val)) {
            this.addChip({ type: 'tag', value: val.substring(1) });
            ctx.searchInput.value = '';
        }
    }

    // 创建一个 chip DOM 元素
    createChipElement(chip) {
        const ctx = this.ctx;
        const el = document.createElement('span');
        el.className = 'search-chip';
        const label = chip.type === 'tag' ? '#' + chip.value : chip.value;
        el.innerHTML = `
            <span class="search-chip-label"></span>
            <span class="search-chip-remove" title="移除">×</span>
        `;
        el.querySelector('.search-chip-label').textContent = label;
        el.querySelector('.search-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = ctx.searchChips.indexOf(chip);
            if (idx !== -1) {
                this.removeChip(idx);
                this.syncQuery(0);
            }
        });
        ctx._chipEls.set(chip, el);
        return el;
    }

    // 全量重建所有 chips（插入到输入框之前）
    // 仅用于批量替换（如保存任务后整体重建标签筛选、外部模块清空筛选）；
    // 单个 chip 的增删走 addChip / removeChip 的增量路径，避免整排重绘
    renderChips() {
        const ctx = this.ctx;
        ctx.searchTagWrapper.querySelectorAll('.search-chip').forEach(el => el.remove());
        // 在输入框前依次插入
        ctx.searchChips.forEach(chip => {
            ctx.searchTagWrapper.insertBefore(this.createChipElement(chip), ctx.searchInput);
        });
    }

    // 添加一个 chip（自动按名称匹配已有标签以补全 tagId/color，去重）
    addChip(chip) {
        const ctx = this.ctx;
        if (!chip || !chip.value) return false;
        // 标签类型：若没有 tagId，尝试按名称匹配已加载的标签
        if (chip.type === 'tag' && !chip.tagId) {
            const match = ctx.tagManager.getTags().find(t => t.name.toLowerCase() === chip.value.toLowerCase());
            if (match) {
                chip.tagId = match.id;
                chip.color = chip.color || match.color;
            }
        }
        // 去重（按类型 + 值，忽略大小写）
        const exists = ctx.searchChips.some(c =>
            c.type === chip.type && c.value.toLowerCase() === chip.value.toLowerCase());
        if (exists) return false;
        ctx.searchChips.push(chip);
        // 增量插入单个 chip，不重建整排
        ctx.searchTagWrapper.insertBefore(this.createChipElement(chip), ctx.searchInput);
        return true;
    }

    // 移除指定索引的 chip
    removeChip(index) {
        const ctx = this.ctx;
        if (index < 0 || index >= ctx.searchChips.length) return false;
        const [chip] = ctx.searchChips.splice(index, 1);
        // 增量移除对应 DOM，不重建整排
        const el = ctx._chipEls.get(chip);
        if (el) {
            el.remove();
            ctx._chipEls.delete(chip);
        }
        return true;
    }

    // 按 tagId 移除 chip（用于标签模块取消选择）
    removeChipByTagId(tagId) {
        const ctx = this.ctx;
        const idx = ctx.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (idx !== -1) {
            this.removeChip(idx);
            return true;
        }
        return false;
    }

    // 切换左侧标签的 chip 选择状态
    toggleTagChip(tagId) {
        const ctx = this.ctx;
        const tag = ctx.tagManager.getTags().find(t => t.id === tagId);
        if (!tag) return;
        const existing = ctx.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (existing !== -1) {
            this.removeChip(existing);
        } else {
            this.addChip({ type: 'tag', value: tag.name, tagId: tag.id, color: tag.color });
        }
        this.syncQuery(0);
    }

    // 将 chips + 输入框文本转换为后端 query 解析层支持的结构化查询对象。
    // 三种搜索语义在这里一次性确定，后端不再需要猜测字符串格式：
    //   tags     - 标签 chips（有 tagId 时带精确 id，否则按名称匹配）
    //   keywords - 文本 chips + 输入框文本
    //   parent   - 输入以 ">" 开头时，查询该父任务的直接子任务
    buildQuery() {
        const ctx = this.ctx;
        const inputText = ctx.searchInput ? ctx.searchInput.value.trim() : '';
        const isParentMode = this.isSuggestMode(inputText);

        const tags = this.getTagFilterChips()
            .map(chip => (chip.tagId
                ? { id: chip.tagId, name: chip.value }
                : { name: chip.value }));

        // 单独的 "#" 是快捷筛选"含标签任务"，不参与普通文本匹配
        const isAnyTag = inputText === '#';

        // 父任务模式下，输入框文本已被父任务消费，不再作为普通关键词
        const keywords = ctx.searchChips
            .filter(chip => chip.type !== 'tag' && chip.value)
            .map(chip => chip.value);
        if (!isParentMode && !isAnyTag && inputText) keywords.push(inputText);

        let parent = null;
        if (isParentMode) {
            const name = inputText.substring(1).trim();
            if (name) {
                parent = { id: ctx.subtaskParent.id || null, name };
            }
        }

        return { tags, keywords, parent, anyTag: isAnyTag };
    }

    // 同步 searchQuery、清空按钮、标签模块选中态，并触发搜索
    syncQuery(delay = 0) {
        const ctx = this.ctx;
        ctx.searchQuery = this.buildQuery();
        this.updateClearButton();
        ctx.tagManager.refreshSelection();
        this.scheduleSearch(delay);
    }

    // 防抖触发搜索任务加载
    scheduleSearch(delay = 300) {
        const ctx = this.ctx;
        if (ctx._searchDebounceTimer) clearTimeout(ctx._searchDebounceTimer);
        ctx._searchDebounceTimer = setTimeout(async () => {
            ctx._searchDebounceTimer = null;
            ctx.searchQuery = this.buildQuery();
            ctx.currentPage = 1;
            ctx.customDateFilter = null; // 清除自定义日期筛选
            ctx.infiniteScroll.reset(); // 重置无限下拉状态
            await ctx.loadTasks();
        }, delay);
    }

    // ===== 子任务搜索建议下拉（输入 ">" 触发） =====

    // 判断当前是否处于子任务建议模式：输入以 ">" 开头。
    // 仅输入 ">" 时关键字为空，后端返回"有子任务的父任务"列表供选择，因此不能要求后面必须有内容。
    // 标签 chips 允许与父任务条件并存（后端按 AND 组合），因此不再要求 chips 为空。
    isSuggestMode(value) {
        const v = (value || '').trim();
        return v.startsWith('>');
    }

    // 防抖拉取「有子任务的父任务」建议
    // 调用后端前，自动将搜索内容 ">" 转换为后端支持的关键字（剥离 ">" 前缀并 trim）
    scheduleSuggestions(delay = 250) {
        const ctx = this.ctx;
        if (ctx._subtaskSuggestTimer) clearTimeout(ctx._subtaskSuggestTimer);
        ctx._subtaskSuggestTimer = setTimeout(async () => {
            ctx._subtaskSuggestTimer = null;
            // 防抖期间状态可能变化，再次确认仍处于 ">" 模式
            if (!this.isSuggestMode(ctx.searchInput.value)) {
                this.hideSuggestions();
                return;
            }
            // 转换：剥离 ">" 前缀并 trim，得到后端支持的关键字
            const keyword = ctx.searchInput.value.trim().substring(1).trim();
            await Api.tasks.search({
                apiArgs: [keyword, 5],
                onSuccess: (response) => this.renderSuggestions(response.data || []),
                onError: () => this.hideSuggestions()
            });
        }, delay);
    }

    // 下拉容器按需创建（初始不在 DOM 中），统一做惰性解析并缓存引用
    _getDropdown() {
        const ctx = this.ctx;
        if (!ctx.dropdown || !ctx.dropdown.isConnected) {
            ctx.dropdown = document.getElementById('subtask-suggestions');
        }
        return ctx.dropdown;
    }

    // 渲染建议下拉（至多 5 条）
    renderSuggestions(tasks) {
        const ctx = this.ctx;
        let dropdown = document.getElementById('subtask-suggestions');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'subtask-suggestions';
            dropdown.className = 'subtask-suggestions';
            ctx.searchTagWrapper.appendChild(dropdown);
        }
        // 缓存引用：否则 hideSuggestions/_highlightSuggestion 拿到的是 null，
        // 下拉会一直停在那里关不掉、键盘上下选择也会报错
        ctx.dropdown = dropdown;
        dropdown.innerHTML = '';
        ctx._subtaskSuggestItems = (tasks || []).slice(0, 5);
        ctx._subtaskSuggestIndex = -1;

        if (ctx._subtaskSuggestItems.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'subtask-suggestion-empty';
            empty.textContent = window.languageManager
                ? window.languageManager.getText('subtaskSuggestEmpty', '无匹配的父任务')
                : '无匹配的父任务';
            dropdown.appendChild(empty);
            dropdown.classList.add('visible');
            return;
        }

        const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢', none: '⚪' };
        const unitText = window.languageManager
            ? window.languageManager.getText('subtaskUnit', '子任务')
            : '子任务';
        ctx._subtaskSuggestItems.forEach((task, idx) => {
            const item = document.createElement('div');
            item.className = 'subtask-suggestion-item';
            item.dataset.index = String(idx);

            const titleEl = document.createElement('span');
            titleEl.className = 'subtask-suggestion-title';
            const emoji = priorityEmoji[task.priority] || '⚪';
            titleEl.textContent = `${emoji} ${task.title}`;

            const countEl = document.createElement('span');
            countEl.className = 'subtask-suggestion-count';
            countEl.textContent = `${task.subtaskCount} ${unitText}`;

            // mousedown 阻止默认行为，防止输入框失焦导致下拉先被关闭
            item.addEventListener('mousedown', (e) => e.preventDefault());
            item.addEventListener('click', () => this.selectSuggestion(task.title, task.id));

            item.appendChild(titleEl);
            item.appendChild(countEl);
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
    }

    // 高亮当前选中的建议项并滚动到可见
    _highlightSuggestion() {
        const ctx = this.ctx;
        const dropdown = this._getDropdown();
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.subtask-suggestion-item');
        items.forEach((el, i) => el.classList.toggle('active', i === ctx._subtaskSuggestIndex));
        const active = dropdown.querySelector('.subtask-suggestion-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    // 搜索框当前是否处于"按父任务查子任务"模式，且已确定到具体的父任务。
    // 返回 { id, title }；仅输入 ">" 但未选中具体父任务（无 id），或文本已被改写时返回 null。
    getParentFilter() {
        const ctx = this.ctx;
        const inputText = ctx.searchInput ? ctx.searchInput.value.trim() : '';
        if (!this.isSuggestMode(inputText)) return null;
        if (!ctx.subtaskParent.id) return null;
        if (ctx.subtaskParent.title && inputText !== `>${ctx.subtaskParent.title}`) return null;
        return {
            id: ctx.subtaskParent.id,
            title: ctx.subtaskParent.title || inputText.substring(1).trim()
        };
    }

    // 记录当前子任务搜索对应的父任务（id 用于精确查询，title 用于校验搜索文本是否被改写）
    setParent(id, title) {
        const ctx = this.ctx;
        const cleanTitle = (title || '').trim() || null;
        ctx.subtaskParent = {
            // 没有标题就无法判断搜索文本是否仍指向该父任务，此时连 id 一起丢弃，
            // 否则残留的失效 id 会让后续查询命中错误的父任务（表现为查不到子任务）
            id: cleanTitle ? (id || null) : null,
            title: cleanTitle
        };
    }

    // 选中某条建议：填充 ">+精确标题" 并触发现有子任务搜索流程
    // id 为父任务精确ID，用于避免同名任务导致按标题解析到错误的父任务
    selectSuggestion(title, id = null) {
        const ctx = this.ctx;
        this.setParent(id, title);
        ctx.searchInput.value = '>' + title;
        this.hideSuggestions();
        this.syncQuery(0);
    }

    // 隐藏建议下拉并清理状态
    hideSuggestions() {
        const ctx = this.ctx;
        if (ctx._subtaskSuggestTimer) {
            clearTimeout(ctx._subtaskSuggestTimer);
            ctx._subtaskSuggestTimer = null;
        }
        const dropdown = this._getDropdown();
        if (dropdown) dropdown.classList.remove('visible');
        ctx._subtaskSuggestItems = [];
        ctx._subtaskSuggestIndex = -1;
    }

    // 清空搜索
    async clear() {
        const ctx = this.ctx;
        if (ctx._searchDebounceTimer) {
            clearTimeout(ctx._searchDebounceTimer);
            ctx._searchDebounceTimer = null;
        }
        this.hideSuggestions();
        this.setParent(null, null);
        ctx.searchChips = [];
        this.renderChips();
        ctx.searchInput.value = '';
        ctx.searchQuery = null;
        ctx.currentPage = 1;
        ctx.customDateFilter = null;
        ctx.infiniteScroll.reset(); // 重置无限下拉状态
        ctx.tagManager.refreshSelection();
        await ctx.loadTasks();
        this.updateClearButton();
    }

    // 更新搜索清空按钮状态
    updateClearButton() {
        const ctx = this.ctx;
        const hasText = ctx.searchInput.value.trim().length > 0;
        const hasChips = ctx.searchChips.length > 0;
        if (hasText || hasChips) {
            ctx.searchClearBtn.classList.add('visible');
        } else {
            ctx.searchClearBtn.classList.remove('visible');
        }
    }
}

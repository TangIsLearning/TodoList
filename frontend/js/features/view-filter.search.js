// 全局搜索栏：chips、结构化查询、子任务搜索建议（ViewFilter 的 mixin，须在 view-filter.js 之后加载）。
// 搜索框写在全局工具栏、与视图切换器同层，四个视图共用同一份 searchQuery，故归 ViewFilter。
// 边界：只负责「产出与呈现搜索条件」，定稿后交给 commitChange() 统一分页归位与分发，
// 本模块不碰 currentPage，也不直接取数。

// 截止时间搜索的输入前缀：'@2026-09-19'
const DUE_DATE_PREFIX = '@';

// 把日期文本归一化为 YYYY-MM-DD；不是合法日期时返回 null。
// 兼容 "@2026-09-19"（输入框写法）与 "2026-09-19"（日历点击回传）。
function normalizeDueDateText(text, { requirePrefix = false } = {}) {
    let raw = (text || '').trim();
    if (!raw) return null;
    if (raw.startsWith(DUE_DATE_PREFIX)) {
        raw = raw.substring(1).trim();
    } else if (requirePrefix) {
        return null;
    }
    const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
    if (!matched) return null;
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    const date = new Date(year, month - 1, day);
    // 排除 2026-02-30 这类会被 Date 自动进位的"假日期"
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

Object.assign(ViewFilter.prototype, {
    // ===== 标签筛选状态访问（对标签模块与统计模块的统一出口） =====

    // 列表筛选中的标签 chips（含仅按名称匹配、尚无 id 的 chip）
    getTagFilterChips() {
        return this.searchChips.filter(chip => chip.type === 'tag' && chip.value);
    },

    // 列表筛选中的标签 id（尚无 id 的名称型 chip 不在其中）
    getTagFilterIds() {
        return this.getTagFilterChips()
            .filter(chip => chip.tagId)
            .map(chip => chip.tagId);
    },

    // 列表筛选中的标签名称（供统计等模块展示当前标签筛选）
    getTagFilterNames() {
        return this.getTagFilterChips().map(chip => chip.value);
    },

    // 清空全部搜索 chips 并同步视图（左侧标签选中态 + 清空按钮显隐）。
    // 只负责视图与状态，不触发重新加载，由调用方决定何时取数。
    clearSearchChips() {
        const kept = this.searchChips.filter(chip => chip.type === 'category');
        if (kept.length === this.searchChips.length) {
            window.tagManager?.refreshSelection();
            return false;
        }
        this.searchChips = kept;
        this.renderSearchChips();
        window.tagManager?.refreshSelection();
        this.updateSearchClearButton();
        return true;
    },

    // ===== 搜索标签 chips 相关 =====

    initSearchTagInput() {
        // 键盘交互：空格提交 #标签、退格删除最后一个 chip、回车提交/搜索
        this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));

        // 输入变化：实时更新清空按钮，并防抖触发搜索（自由文本搜索）
        // 当输入以 ">" 开头（且无 chip）时，进入子任务建议模式：仅刷新下拉，不重载主列表
        this.searchInput.addEventListener('input', () => {
            this.updateSearchClearButton();
            if (this.isSubtaskSuggestMode(this.searchInput.value)) {
                // 文本被改写后已选中的父任务 id 不再可信，清掉回退为按名称解析
                if (this.subtaskParent.title
                    && this.searchInput.value.trim() !== `>${this.subtaskParent.title}`) {
                    this.setSubtaskParent(null, null);
                }
                this.scheduleSubtaskSuggestions(250);
            } else {
                // 退出 ">" 子任务搜索模式，清除记录的父任务
                this.setSubtaskParent(null, null);
                this.hideSubtaskSuggestions();
                this.scheduleSearch(300);
            }
        });
        this.searchInput.addEventListener('change', () => this.updateSearchClearButton());

        // 失焦时延时关闭下拉（延时以允许点击命中建议项）
        this.searchInput.addEventListener('blur', () => {
            setTimeout(() => this.hideSubtaskSuggestions(), 150);
        });

        // 点击 wrapper 空白区域时聚焦输入框
        this.searchTagWrapper.addEventListener('click', (e) => {
            if (e.target === this.searchInput) return;
            if (e.target.classList && e.target.classList.contains('search-chip-remove')) return;
            // 点日期按钮时不抢焦点：按钮失焦会立刻收起刚弹出的日历
            if (e.target.closest && e.target.closest('.search-due-btn')) return;
            this.searchInput.focus();
        });

        // 搜索按钮：提交输入框中待定的 #标签 / @日期，然后立即搜索
        this.searchBtn?.addEventListener('click', () => {
            this.commitInputAsChip();
            this.hideSubtaskSuggestions();
            this.syncSearchQuery(0);
        });

        // 清空按钮：分层清除（文本 → 截止时间 → 标签）
        this.searchClearBtn?.addEventListener('click', () => this.clearSearch());

        this.initSearchDueDatePicker();

        this.renderSearchChips();
    },

    // 搜索栏的"按截止时间搜索"：点 📅 弹出日历，选中后生成截止时间 chip。
    // 日历实例绑定在一个隐藏输入框上（不占布局），由按钮触发弹出。
    initSearchDueDatePicker() {
        const field = document.getElementById('search-due-input');
        const trigger = document.getElementById('search-due-btn');
        if (!field || !trigger) return;
        this.searchDuePicker = createDatePicker(field, {
            trigger,
            onChange: () => {
                const dateStr = normalizeDueDateText(field.value);
                // 清空隐藏输入框，保证下次能重复选中同一天
                field.value = '';
                if (dateStr) this.setDueDateChip(dateStr);
            }
        });
    },

    handleSearchKeydown(e) {
        const searchInput = e.target;
        const val = searchInput.value;

        // 子任务建议下拉的键盘交互（仅当处于 ">" 模式且下拉有项时）
        if (this.isSubtaskSuggestMode(val) && this._subtaskSuggestItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._subtaskSuggestIndex = (this._subtaskSuggestIndex + 1) % this._subtaskSuggestItems.length;
                this._highlightSubtaskSuggestion();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._subtaskSuggestIndex = (this._subtaskSuggestIndex - 1 + this._subtaskSuggestItems.length) % this._subtaskSuggestItems.length;
                this._highlightSubtaskSuggestion();
                return;
            }
            if (e.key === 'Enter' && this._subtaskSuggestIndex >= 0) {
                const item = this._subtaskSuggestItems[this._subtaskSuggestIndex];
                if (item) {
                    e.preventDefault();
                    this.selectSubtaskSuggestion(item.title, item.id);
                    return;
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hideSubtaskSuggestions();
                return;
            }
        }

        // 空格：若当前输入是一个完整的 #标签 / @截止日期，则提交为 chip
        if ((e.key === ' ' || e.code === 'Space') && this.commitInputAsChip()) {
            e.preventDefault();
            this.syncSearchQuery(0);
            return;
        }

        // 退格：输入框为空时删除最后一个 chip
        if (e.key === 'Backspace' && val === '' && this.searchChips.length > 0) {
            e.preventDefault();
            const last = this.searchChips[this.searchChips.length - 1];
            this.removeSearchChip(this.searchChips.length - 1);
            // 分类 chip 在队首，退格轮到它时说明前面已清空，即取消分类筛选
            if (last.type === 'category') this.setCategoryFilter('all');
            else this.syncSearchQuery(0);
            return;
        }

        // 回车：提交 #标签 / @截止日期（若是），并触发搜索
        if (e.key === 'Enter') {
            e.preventDefault();
            this.commitInputAsChip();
            this.hideSubtaskSuggestions();
            this.syncSearchQuery(0);
            return;
        }
    },

    // 若输入框内容是完整的 #标签 / @截止日期，提交为 chip（空格、回车、搜索按钮共用）
    // 返回是否真的提交了 chip
    commitInputAsChip() {
        const val = this.searchInput.value.trim();
        if (TAG_INPUT_PATTERN.test(val)) {
            this.addSearchChip({ type: 'tag', value: val.substring(1) });
            this.searchInput.value = '';
            return true;
        }
        const dueDate = normalizeDueDateText(val, { requirePrefix: true });
        if (dueDate) {
            this.addSearchChip({ type: 'due', value: dueDate });
            this.searchInput.value = '';
            return true;
        }
        return false;
    },

    createChipElement(chip) {
        const el = document.createElement('span');
        el.className = 'search-chip';
        if (chip.type === 'due') el.classList.add('search-chip--due');
        if (chip.type === 'category') {
            el.classList.add('search-chip--category');
            // 分类色是动态的，只能内联；浅底用 color-mix，不支持时退化为纯边框
            if (chip.color) {
                el.style.borderColor = chip.color;
                el.style.backgroundColor = `color-mix(in srgb, ${chip.color} 14%, transparent)`;
            }
        }
        const label = this.getChipLabel(chip);
        el.innerHTML = `
            <span class="search-chip-label"></span>
            <span class="search-chip-remove" title="移除">×</span>
        `;
        el.querySelector('.search-chip-label').textContent = label;
        el.querySelector('.search-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = this.searchChips.indexOf(chip);
            if (idx === -1) return;
            this.removeSearchChip(idx);
            // 分类 chip 只是 categoryId 的镜像，摘掉它即取消分类筛选
            if (chip.type === 'category') this.setCategoryFilter('all');
            else this.syncSearchQuery(0);
        });
        this._chipEls.set(chip, el);
        return el;
    },

    // chip 的展示文案：标签带 '#' 前缀，截止与分类各带语义前缀以便区分
    getChipLabel(chip) {
        if (chip.type === 'tag') return '#' + chip.value;
        if (chip.type === 'due') {
            const prefix = window.languageManager
                ? window.languageManager.getText('searchDuePrefix', '截止')
                : '截止';
            return `${prefix} ${chip.value}`;
        }
        if (chip.type === 'category') {
            const prefix = window.languageManager
                ? window.languageManager.getText('searchCategoryPrefix', '分类')
                : '分类';
            return `${prefix} ${chip.value}`;
        }
        return chip.value;
    },

    // 全量重建；单个 chip 的增删走 add/remove 的增量路径，避免整排重绘
    renderSearchChips() {
        this.searchTagWrapper.querySelectorAll('.search-chip').forEach(el => el.remove());
        this.searchChips.forEach(chip => {
            this.searchTagWrapper.insertBefore(this.createChipElement(chip), this.searchInput);
        });
    },

    // 添加一个 chip（自动按名称匹配已有标签以补全 tagId/color，去重）
    addSearchChip(chip) {
        if (!chip || !chip.value) return false;
        // 截止时间只保留一个：新的直接顶掉旧的，避免多个日期互相矛盾
        if (chip.type === 'due') {
            const oldDue = this.searchChips.find(c => c.type === 'due');
            if (oldDue) this.removeSearchChip(this.searchChips.indexOf(oldDue));
        }
        // 标签类型：若没有 tagId，尝试按名称匹配已加载的标签
        if (chip.type === 'tag' && !chip.tagId) {
            const match = window.tagManager?.getTags().find(t => t.name.toLowerCase() === chip.value.toLowerCase());
            if (match) {
                chip.tagId = match.id;
                chip.color = chip.color || match.color;
            }
        }
        // 去重（按类型 + 值，忽略大小写）
        const exists = this.searchChips.some(c =>
            c.type === chip.type && c.value.toLowerCase() === chip.value.toLowerCase());
        if (exists) return false;
        this.searchChips.push(chip);
        // 增量插入单个 chip，不重建整排
        this.searchTagWrapper.insertBefore(this.createChipElement(chip), this.searchInput);
        return true;
    },

    removeSearchChip(index) {
        if (index < 0 || index >= this.searchChips.length) return false;
        const [chip] = this.searchChips.splice(index, 1);
        // 增量移除对应 DOM，不重建整排
        const el = this._chipEls.get(chip);
        if (el) {
            el.remove();
            this._chipEls.delete(chip);
        }
        return true;
    },

    // 按 tagId 移除 chip（用于标签模块取消选择）
    removeSearchChipByTagId(tagId) {
        const idx = this.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (idx !== -1) {
            this.removeSearchChip(idx);
            return true;
        }
        return false;
    },

    // 切换左侧标签的 chip 选择状态
    toggleTagChip(tagId) {
        const tag = window.tagManager?.getTags().find(t => t.id === tagId);
        if (!tag) return;
        const existing = this.searchChips.findIndex(c => c.type === 'tag' && c.tagId === tagId);
        if (existing !== -1) {
            this.removeSearchChip(existing);
        } else {
            this.addSearchChip({ type: 'tag', value: tag.name, tagId: tag.id, color: tag.color });
        }
        this.syncSearchQuery(0);
    },

    // 把 chips + 输入框文本转成后端 query 解析层支持的结构化查询对象，
    // 四种搜索语义在这里一次性确定，后端不再需要猜测字符串格式：
    //   tags     - 标签 chips（有 tagId 时带精确 id，否则按名称匹配）
    //   keywords - 文本 chips + 输入框文本
    //   parent   - 输入以 ">" 开头时，查询该父任务的直接子任务
    //   dueDate  - 截止时间 chip，按当天匹配（忽略时刻）
    buildSearchQuery() {
        const inputText = this.searchInput ? this.searchInput.value.trim() : '';
        const isParentMode = this.isSubtaskSuggestMode(inputText);

        const tags = this.getTagFilterChips()
            .map(chip => (chip.tagId
                ? { id: chip.tagId, name: chip.value }
                : { name: chip.value }));

        // 单独的 "#" 是快捷筛选"含标签任务"，不参与普通文本匹配
        const isAnyTag = inputText === '#';

        // 父任务模式下，输入框文本已被父任务消费，不再作为普通关键词
        // 分类 chip 是 categoryId 的镜像而非搜索关键词，绝不能混进 keywords
        const keywords = this.searchChips
            .filter(chip => chip.type !== 'tag' && chip.type !== 'due' && chip.type !== 'category' && chip.value)
            .map(chip => chip.value);
        if (!isParentMode && !isAnyTag && inputText) keywords.push(inputText);

        let parent = null;
        if (isParentMode) {
            const name = inputText.substring(1).trim();
            if (name) {
                parent = { id: this.subtaskParent.id || null, name };
            }
        }

        return { tags, keywords, parent, dueDate: this.getDueDateChip(), anyTag: isAnyTag };
    },

    // 当前筛选中的截止时间（YYYY-MM-DD），无截止时间 chip 时返回 null
    getDueDateChip() {
        const chip = this.searchChips.find(c => c.type === 'due' && c.value);
        return chip ? chip.value : null;
    },

    // 日历按整月展示，带单日条件会让日历只剩一天，进入该视图前清掉
    clearDueDateChip() {
        const idx = this.searchChips.findIndex(c => c.type === 'due');
        if (idx === -1) return false;
        this.removeSearchChip(idx);
        this.searchQuery = this.buildSearchQuery();
        this.updateSearchClearButton();
        return true;
    },

    // 供日历点日期与搜索栏日期选择器回显；传 null / 非法值表示清除
    setDueDateChip(dateStr) {
        const dueDate = normalizeDueDateText(dateStr);
        const existing = this.searchChips.findIndex(c => c.type === 'due');
        if (existing !== -1) this.removeSearchChip(existing);
        if (dueDate) this.addSearchChip({ type: 'due', value: dueDate });
        this.updateSearchClearButton();
        this.syncSearchQuery(0);
        return !!dueDate;
    },

    // ===== 分类筛选 chip（categoryId 在搜索框里的镜像） =====

    // 分类筛选本身走 TaskFilter.categoryId，这里只负责把它显示成 chip，
    // 让"当前还挂着分类条件"这件事在搜索框里看得见。
    getCategoryChip() {
        return this.searchChips.find(c => c.type === 'category') || null;
    },

    // 把 categoryId 同步成 chip（新增 / 替换 / 移除）。
    // 插在队首：清空按钮按「文本 → 截止时间 → 标签 → 分类」分层清，退格又是从末尾往前
    // 删，排在队首才能保证分类始终是最后一个被清掉的条件。
    syncCategoryChip() {
        const idx = this.searchChips.findIndex(c => c.type === 'category');
        if (idx !== -1) this.removeSearchChip(idx);
        if (!this.categoryId || this.categoryId === 'all') return false;
        const category = window.categoryManager?.getCategoryById(this.categoryId);
        if (!category) return false;

        const chip = {
            type: 'category',
            value: category.name,
            categoryId: category.id,
            color: window.categoryManager.getCategoryColor(category.id)
        };
        this.searchChips.unshift(chip);
        if (!this.searchTagWrapper) return true;
        const first = this.searchTagWrapper.querySelector('.search-chip');
        this.searchTagWrapper.insertBefore(this.createChipElement(chip), first || this.searchInput);
        return true;
    },

    syncSearchQuery(delay = 0) {
        this.searchQuery = this.buildSearchQuery();
        this.updateSearchClearButton();
        window.tagManager?.refreshSelection();
        this.scheduleSearch(delay);
    },

    // 分页归位与"按前台视图取数"都交给 commitChange()，搜索栏不操心
    scheduleSearch(delay = 300) {
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(async () => {
            this._searchDebounceTimer = null;
            this.searchQuery = this.buildSearchQuery();
            await this.commitChange();
        }, delay);
    },

    // ===== 子任务搜索建议下拉（输入 ">" 触发） =====
    // 仅输入 ">" 时关键字为空，后端返回"有子任务的父任务"列表供选择，故不要求后面必须有内容；
    // 标签 chips 可与父任务条件并存（后端按 AND 组合），故也不要求 chips 为空
    isSubtaskSuggestMode(value) {
        const v = (value || '').trim();
        return v.startsWith('>');
    },

    // 防抖拉取「有子任务的父任务」建议，调用前把 ">" 前缀剥离成后端支持的关键字
    scheduleSubtaskSuggestions(delay = 250) {
        if (this._subtaskSuggestTimer) clearTimeout(this._subtaskSuggestTimer);
        this._subtaskSuggestTimer = setTimeout(async () => {
            this._subtaskSuggestTimer = null;
            // 防抖期间状态可能变化，再次确认仍处于 ">" 模式
            if (!this.isSubtaskSuggestMode(this.searchInput.value)) {
                this.hideSubtaskSuggestions();
                return;
            }
            const keyword = this.searchInput.value.trim().substring(1).trim();
            await Utils.apiCall({
                apiMethod: 'search_tasks_with_subtasks',
                apiArgs: [keyword, 5],
                onSuccess: (response) => this.renderSubtaskSuggestions(response.data || []),
                onError: () => this.hideSubtaskSuggestions()
            });
        }, delay);
    },

    // 下拉容器按需创建（初始不在 DOM 中），统一做惰性解析并缓存引用
    _getSubtaskDropdown() {
        if (!this.dropdown || !this.dropdown.isConnected) {
            this.dropdown = document.getElementById('subtask-suggestions');
        }
        return this.dropdown;
    },

    // 渲染建议下拉（至多 5 条）
    renderSubtaskSuggestions(tasks) {
        let dropdown = document.getElementById('subtask-suggestions');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'subtask-suggestions';
            dropdown.className = 'subtask-suggestions';
            this.searchTagWrapper.appendChild(dropdown);
        }
        // 不缓存则 hide/_highlight 拿到 null：下拉关不掉、键盘上下选也会报错
        this.dropdown = dropdown;
        dropdown.innerHTML = '';
        this._subtaskSuggestItems = (tasks || []).slice(0, 5);
        this._subtaskSuggestIndex = -1;

        if (this._subtaskSuggestItems.length === 0) {
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
        this._subtaskSuggestItems.forEach((task, idx) => {
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
            item.addEventListener('click', () => this.selectSubtaskSuggestion(task.title, task.id));

            item.appendChild(titleEl);
            item.appendChild(countEl);
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
    },

    _highlightSubtaskSuggestion() {
        const dropdown = this._getSubtaskDropdown();
        if (!dropdown) return;
        const items = dropdown.querySelectorAll('.subtask-suggestion-item');
        items.forEach((el, i) => el.classList.toggle('active', i === this._subtaskSuggestIndex));
        const active = dropdown.querySelector('.subtask-suggestion-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    },

    // 已确定到具体父任务时返回 { id, title }；仅输入 ">"（无 id）或文本已被改写时返回 null
    getSubtaskParentFilter() {
        const inputText = this.searchInput ? this.searchInput.value.trim() : '';
        if (!this.isSubtaskSuggestMode(inputText)) return null;
        if (!this.subtaskParent.id) return null;
        if (this.subtaskParent.title && inputText !== `>${this.subtaskParent.title}`) return null;
        return {
            id: this.subtaskParent.id,
            title: this.subtaskParent.title || inputText.substring(1).trim()
        };
    },

    // 记录当前子任务搜索对应的父任务（id 用于精确查询，title 用于校验搜索文本是否被改写）
    setSubtaskParent(id, title) {
        const cleanTitle = (title || '').trim() || null;
        this.subtaskParent = {
            // 没有标题就无法判断搜索文本是否仍指向该父任务，此时连 id 一起丢弃，
            // 否则残留的失效 id 会让后续查询命中错误的父任务（表现为查不到子任务）
            id: cleanTitle ? (id || null) : null,
            title: cleanTitle
        };
    },

    // id 为父任务精确 ID，避免同名任务按标题解析到错误的父任务
    selectSubtaskSuggestion(title, id = null) {
        this.setSubtaskParent(id, title);
        this.searchInput.value = '>' + title;
        this.hideSubtaskSuggestions();
        this.syncSearchQuery(0);
    },

    hideSubtaskSuggestions() {
        if (this._subtaskSuggestTimer) {
            clearTimeout(this._subtaskSuggestTimer);
            this._subtaskSuggestTimer = null;
        }
        const dropdown = this._getSubtaskDropdown();
        if (dropdown) dropdown.classList.remove('visible');
        this._subtaskSuggestItems = [];
        this._subtaskSuggestIndex = -1;
    },


    // ===== 搜索条件的分层清空 =====

    // 按「文本 → 截止时间 → 标签 → 分类」取第一个非空层级；全部清空后返回 null。
    // 分类排最后：它是最基础的一层筛选，前面几种都清完才轮到它。
    getSearchClearLayer() {
        if (this.searchInput.value.trim()) return 'text';
        if (this.searchChips.some(chip => chip.type === 'due' && chip.value)) return 'due';
        if (this.searchChips.some(chip => chip.type === 'tag' && chip.value)) return 'tag';
        // 兜底：既非标签也非截止时间的 chips（如自由关键词 chip）
        if (this.searchChips.some(chip => chip.type !== 'tag' && chip.type !== 'due' && chip.type !== 'category')) return 'other';
        if (this.searchChips.some(chip => chip.type === 'category')) return 'category';
        return null;
    },

    // 移除某一层级的全部搜索条件（只改状态与视图，不触发重新加载）
    removeSearchLayer(layer) {
        if (layer === 'text') {
            this.searchInput.value = '';
            // 文本被父任务查询占用时，连同记录的父任务一起清掉
            this.setSubtaskParent(null, null);
            return true;
        }
        if (layer === 'category') {
            this.clearCategoryFilter();
            return true;
        }
        let removed = false;
        // 倒序遍历，保证 removeSearchChip 的索引在删除过程中始终有效
        for (let i = this.searchChips.length - 1; i >= 0; i--) {
            const chip = this.searchChips[i];
            // other 是兜底层，须排除分类：分类有自己独立的层级，不能被兜底层顺手带走
            const hit = layer === 'other'
                ? chip.type !== 'tag' && chip.type !== 'due' && chip.type !== 'category'
                : chip.type === layer;
            if (hit) {
                this.removeSearchChip(i);
                removed = true;
            }
        }
        return removed;
    },

    getSearchClearButtonTitle(layer) {
        const keyMap = {
            text: ['searchClearKeyword', '清除搜索文本'],
            due: ['searchClearDueDate', '清除截止时间筛选'],
            tag: ['searchClearTags', '清除标签筛选'],
            category: ['searchClearCategory', '清除分类筛选'],
            other: ['searchClear', '清空搜索']
        };
        const [key, fallback] = keyMap[layer] || keyMap.other;
        return window.languageManager
            ? window.languageManager.getText(key, fallback)
            : fallback;
    },

    // 每次点击只清除一层，每层即时重查；全部清除后再点即空删除
    async clearSearch() {
        const layer = this.getSearchClearLayer();
        if (!layer) return false;

        if (this._searchDebounceTimer) {
            clearTimeout(this._searchDebounceTimer);
            this._searchDebounceTimer = null;
        }
        this.hideSubtaskSuggestions();
        this.removeSearchLayer(layer);

        // 只剩分类 chip 不算"还有搜索条件"：它不进 searchQuery，筛选由 categoryId 承载
        const remains = this.searchInput.value.trim().length > 0
            || this.searchChips.some(chip => chip.type !== 'category');
        this.searchQuery = remains ? this.buildSearchQuery() : null;
        this.updateSearchClearButton();
        window.tagManager?.refreshSelection();
        await this.commitChange();
        return true;
    },

    // 更新搜索清空按钮状态（按钮常驻可见，这里只切换醒目度 + 下一步将清除的内容提示）
    updateSearchClearButton() {
        const layer = this.getSearchClearLayer();
        if (layer) {
            this.searchClearBtn.classList.add('visible');
            this.searchClearBtn.title = this.getSearchClearButtonTitle(layer);
        } else {
            this.searchClearBtn.classList.remove('visible');
            this.searchClearBtn.title = this.getSearchClearButtonTitle('other');
        }
    },
});

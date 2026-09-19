// 标签管理模块
//
// 职责边界：
//   - 标签数据（加载 / 缓存 / 唯一数据源）
//   - 左侧标签模块（筛选入口、展开收起、重命名、删除）
//   - 任务弹窗内的标签选择器（选择状态、新建、删除）
//
// 与 TodoManager 的关系：本模块不反向依赖 TodoManager，
// 需要联动"列表筛选 chips / 任务列表刷新"时，一律走 configure() 注入的回调，
// 保持 TodoManager → TagManager 的单向依赖。
//
// 注意：本文件必须在 todo.js 之前引入（todo.js 依赖此处的标签常量与 window.tagManager）。

// ===== 标签常量 =====
// 标签名的合法字符：中文、英文、数字、下划线
const TAG_NAME_CHARS = '\\u4e00-\\u9fa5a-zA-Z0-9_';
// 输入框中"完整的 #标签"（用于判定是否可提交为 chip）
const TAG_INPUT_PATTERN = new RegExp(`^#[${TAG_NAME_CHARS}]+$`);
// 标签栏默认展示的标签个数（超出部分由"展开更多"控制）
const DEFAULT_VISIBLE_TAGS = 5;
// 临时标签 id 前缀：弹窗中新建、尚未落库的标签用它标记，不进入标签数据源
const TEMP_TAG_PREFIX = 'pending:';
// 新建标签未指定颜色时的默认色：走主题令牌，随自定义强调色/明暗模式变化
const DEFAULT_TAG_COLOR = 'var(--secondary-color)';

class TagManager {
    constructor() {
        // 已落库的标签：唯一数据源，只允许通过 setTags() 写入
        this.tags = [];
        // 任务弹窗表单的选择态（每次打开弹窗重置），与列表筛选无关
        this.formSelectedTagIds = [];
        // 弹窗中新建、尚未落库的标签名（保存任务时由后端按名称创建），随弹窗关闭丢弃
        this.pendingTagNames = [];
        this.isShowMoreTags = false;
        this.defaultShowTags = DEFAULT_VISIBLE_TAGS;
        this._fetching = null; // 标签列表拉取中的 promise（并发去重）
        this._pendingFromZero = false;
        this._countDebounceTimer = null;
        this._moduleEventsBound = false;
        this._selectorEventsBound = false;

        // 与 TodoManager 的联动回调，由 configure() 注入
        this.hooks = {};

        this.cacheDomRefs();
    }

    // 统一缓存标签相关的 DOM 节点
    cacheDomRefs() {
        const dom = {
            tagsSection: 'tags-section',
            tagsList: 'tags-list',
            tagsMore: 'tags-more',
            tagsMoreText: 'tags-more-text',
            showMoreTags: 'show-more-tags',
            showLessTags: 'show-less-tags',
            tagSelector: 'tags-selector'
        };
        Object.entries(dom).forEach(([key, id]) => {
            this[key] = document.getElementById(id);
        });
    }

    // 注入与 TodoManager 联动的回调：
    //   getFilterTagIds    - 读取列表当前筛选的标签 id（左侧模块的选中态数据源）
    //   onToggleFilterTag  - 点击左侧标签时切换对应筛选
    //   onTagRenamed       - 标签重命名后同步筛选 chip，返回是否命中了筛选中的标签
    //   onTagDeleted       - 标签删除后同步移除对应筛选 chip
    //   onTagsChanged      - 标签数据变化后刷新任务列表
    configure(hooks) {
        this.hooks = Object.assign({}, this.hooks, hooks || {});
    }

    // 绑定一次性事件（容器级委托 + 展开收起）
    init() {
        this.bindModuleEvents();
        this.bindSelectorEvents();
        // 展示更多/更少标签：仅末尾标识可点击，标题不再承担展开/收缩
        this.tagsMore?.addEventListener('click', () => this.toggleMoreTags());
    }

    // ===== 标签数据 =====

    // 标签唯一数据源的写入入口
    setTags(tags) {
        this.tags = Array.isArray(tags) ? tags : [];
        // 标签数量未超过限定个数时回到收缩态，避免出现无意义的展开状态
        if (this.tags.length <= this.defaultShowTags) {
            this.isShowMoreTags = false;
        }
    }

    getTags() {
        return this.tags;
    }

    // 拉取标签列表：标签的唯一加载入口
    // 左侧标签模块与弹窗标签选择器共用同一次请求，避免两者各拉一次并互相覆盖数据源。
    // 只做并发去重（同一时刻的重复请求合并），不做长期缓存——标签计数随任务增删频繁变化，缓存易读到脏数据。
    fetchTags() {
        if (this._fetching) return this._fetching;
        this._fetching = Utils.apiCall({
            apiMethod: 'get_all_tags',
            onSuccess: (response) => this.setTags(response.data),
            onError: () => Utils.showToast(window.languageManager.getText('loadTagsFailed', '加载标签失败'), 'error')
        }).finally(() => { this._fetching = null; });
        return this._fetching;
    }

    // 加载左侧标签模块
    async loadModule(fromZero = false) {
        await this.fetchTags();
        this.renderModule(fromZero);
    }

    // 加载弹窗内的标签选择器
    async loadSelector() {
        await this.fetchTags();
        this.renderSelector();
    }

    // ===== 弹窗表单态 =====

    // 打开任务弹窗：重置表单选择态，并丢弃上一次弹窗遗留的临时标签
    beginForm(selectedTagIds = []) {
        this.pendingTagNames = [];
        this.formSelectedTagIds = [...selectedTagIds];
    }

    // 标签已随任务保存落库时调用：清掉临时标签，避免与后端返回的真实标签重复
    clearPending() {
        this.pendingTagNames = [];
    }

    // 弹窗选择器中展示的标签：已落库的标签 + 本次弹窗新建的临时标签
    getSelectorTags() {
        const pendingTags = this.pendingTagNames.map(name => ({
            id: TEMP_TAG_PREFIX + name,
            name,
            color: DEFAULT_TAG_COLOR,
            taskCount: 0,
            pending: true
        }));
        return this.tags.concat(pendingTags);
    }

    // 临时标签 id → 标签名；非临时标签返回 null
    getPendingTagName(tagId) {
        const id = String(tagId || '');
        return id.startsWith(TEMP_TAG_PREFIX) ? id.slice(TEMP_TAG_PREFIX.length) : null;
    }

    // 已选标签 id（只读副本，避免外部直接改动内部数组）
    getFormSelectedTagIds() {
        return [...this.formSelectedTagIds];
    }

    // 已选标签的名称列表（已落库标签取最新名称，临时标签直接取名称）
    getSelectedTagNames() {
        return this.formSelectedTagIds
            .map(id => {
                const pendingName = this.getPendingTagName(id);
                if (pendingName !== null) return pendingName;
                const tag = this.tags.find(t => t.id === id);
                return tag ? tag.name : null;
            })
            .filter(name => !!name);
    }

    // ===== 左侧标签模块 =====

    // 渲染左侧标签模块
    // 选中态以列表筛选为唯一数据源（由 hooks.getFilterTagIds 提供）
    renderModule(fromZero = false) {
        if (this.tags.length <= 0) {
            this.tagsSection.style.display = 'none';
            return;
        }
        this.tagsSection.style.display = 'block';

        const selectedTagIds = this.hooks.getFilterTagIds ? this.hooks.getFilterTagIds() : [];

        let html = '';

        // 渲染现有标签：收缩状态下只渲染限定个数内的标签
        this.tags.forEach((tag, index) => {
            if (!this.isShowMoreTags && index >= this.defaultShowTags) return;
            const isSelected = selectedTagIds.includes(tag.id);
            const count = tag.taskCount || 0;
            // 标签存在引用（count>0）时可编辑名称；无引用（count=0）时可删除
            const action = count > 0
                ? { type: 'edit', icon: '✏️', title: '编辑标签' }
                : { type: 'delete', icon: '🗑️', title: '删除标签' };

            html += `
                <span class="tag-module-item ${isSelected ? 'selected' : ''}"
                      data-tag-id="${tag.id}"
                      style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                    <span class="tag-count" data-tag-count="${tag.id}">${count}</span>
                    <span class="tag-action-icon" data-tag-action="${action.type}"
                          title="${action.title}">${action.icon}</span>
                </span>
            `;
        });

        this.tagsList.innerHTML = html;

        // 渲染"展开更多/更少"标识（位于最后一个标签之后）
        this.renderMoreIndicator();

        // 事件为容器级委托，渲染时无需重新绑定
        this.bindModuleEvents();

        if (fromZero) this._pendingFromZero = true;

        if (this._countDebounceTimer) {
            clearTimeout(this._countDebounceTimer);
        }

        this._countDebounceTimer = setTimeout(() => {
            const shouldFromZero = this._pendingFromZero;
            this._pendingFromZero = false;
            this._countDebounceTimer = null;

            // 按 data-tag-count 定位计数节点，避免把标签 id 暴露成全局 DOM id
            const countEls = new Map();
            this.tagsList.querySelectorAll('.tag-count[data-tag-count]').forEach(el => {
                countEls.set(el.dataset.tagCount, el);
            });
            this.tags.forEach(tag => {
                const countEl = countEls.get(tag.id);
                const count = tag.taskCount || 0;
                if (countEl) {
                    Utils.animateNumber(countEl, count, { duration: 600, easing: 'easeOutCubic', fromZero: shouldFromZero });
                }
            });
        }, 200);
    }

    // 渲染标签末尾的"展开更多/更少"标识：
    // 标签数量未超过限定个数时完全隐藏；收缩态显示"展开更多"，展开态显示"展开更少"
    renderMoreIndicator() {
        if (!this.tagsMore) return;

        const hasOverflow = this.tags.length > this.defaultShowTags;
        this.tagsMore.style.display = hasOverflow ? 'inline-flex' : 'none';
        if (!hasOverflow) return;

        const isExpanded = this.isShowMoreTags;
        if (this.showMoreTags) this.showMoreTags.style.display = isExpanded ? 'none' : 'block';
        if (this.showLessTags) this.showLessTags.style.display = isExpanded ? 'block' : 'none';

        const tip = window.languageManager
            ? window.languageManager.getText(isExpanded ? 'showLessTags' : 'showMoreTags', isExpanded ? '展开更少' : '展开更多')
            : (isExpanded ? '展开更少' : '展开更多');
        if (this.tagsMoreText) this.tagsMoreText.textContent = tip;
        this.tagsMore.title = tip;
    }

    // 只切换选中态，不整体重渲染（用于筛选变化时的轻量刷新）
    refreshSelection() {
        const selectedIds = this.hooks.getFilterTagIds ? this.hooks.getFilterTagIds() : [];
        document.querySelectorAll('.tag-module-item').forEach(item => {
            const id = item.dataset.tagId;
            item.classList.toggle('selected', selectedIds.includes(id));
        });
    }

    // 左侧标签模块事件（容器级委托，只绑一次）：
    // 点击标签本体切换对应的搜索 chip；悬浮操作图标用于编辑/删除标签
    bindModuleEvents() {
        if (!this.tagsList || this._moduleEventsBound) return;
        this._moduleEventsBound = true;

        this.tagsList.addEventListener('click', (e) => {
            const item = e.target.closest('.tag-module-item');
            if (!item || !this.tagsList.contains(item)) return;
            const tagId = item.dataset.tagId;

            // 悬浮在标签上的编辑/删除图标（点击图标不触发筛选）
            const actionEl = e.target.closest('.tag-action-icon');
            if (actionEl) {
                e.stopPropagation();
                const tag = this.tags.find(t => t.id === tagId);
                if (!tag) return;
                if (actionEl.dataset.tagAction === 'delete') {
                    // 无引用标签：删除前弹窗确认，避免误操作
                    this.deleteTag(tagId, tag.name);
                } else if (actionEl.dataset.tagAction === 'edit') {
                    // 有引用标签：内联编辑标签名称
                    this.startRenameTag(tagId);
                }
                return;
            }

            this.hooks.onToggleFilterTag?.(tagId);
        });
    }

    toggleMoreTags(fromZero = false) {
        // 标签数量未超过限定个数时，无需展开/收起
        if (this.tags.length <= this.defaultShowTags) return;
        this.isShowMoreTags = !this.isShowMoreTags;
        // 仅切换展示范围，数据已在本地，无需重新请求
        this.renderModule(fromZero);
    }

    // ===== 弹窗标签选择器 =====

    renderSelector() {
        let html = '';

        // 渲染现有标签（含本次弹窗新建的临时标签）
        this.getSelectorTags().forEach(tag => {
            const isSelected = this.formSelectedTagIds.includes(tag.id);
            const count = tag.taskCount || 0;

            html += `
                <span class="tag-selector-item ${isSelected ? 'selected' : ''}"
                      data-tag-id="${tag.id}"
                      style="background-color: ${tag.color};">
                    #${Utils.escapeHtml(tag.name)}
                    <span class="tag-count">${count}</span>
                    ${count === 0 ? '<span class="tag-delete" data-action="delete-tag">×</span>' : ''}
                </span>
            `;
        });

        // 添加"新增标签"按钮
        html += `
            <span class="tag-add-btn" id="add-tag-btn">
                + ${window.languageManager.getText('taskTag', '标签')}
            </span>
        `;

        this.tagSelector.innerHTML = html;

        // 事件为容器级委托，渲染时无需重新绑定
        this.bindSelectorEvents();
    }

    // 弹窗标签选择器事件（容器级委托，只绑一次）
    bindSelectorEvents() {
        if (!this.tagSelector || this._selectorEventsBound) return;
        this._selectorEventsBound = true;

        this.tagSelector.addEventListener('click', (e) => {
            // 新增标签按钮
            if (e.target.closest('#add-tag-btn')) {
                this.showAddTagInput();
                return;
            }

            // 删除标签（点击删除图标不触发选择）
            const deleteBtn = e.target.closest('.tag-delete');
            if (deleteBtn) {
                e.stopPropagation();
                const owner = deleteBtn.closest('.tag-selector-item');
                if (owner) this.deleteTag(owner.dataset.tagId);
                return;
            }

            // 标签本体：选择/取消选择
            const item = e.target.closest('.tag-selector-item');
            if (item) this.toggleTagSelection(item.dataset.tagId);
        });
    }

    // 切换标签选择状态（弹窗表单内）
    toggleTagSelection(tagId) {
        const index = this.formSelectedTagIds.indexOf(tagId);
        if (index === -1) {
            this.formSelectedTagIds.push(tagId);
        } else {
            this.formSelectedTagIds.splice(index, 1);
        }
        this.renderSelector();
    }

    // 生成新增标签输入框的临时 DOM id（仅用于定位输入框，与标签 id 无关）
    generateRandomId() {
        return `new-tag-input-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }

    // 显示新增标签输入框
    showAddTagInput() {
        const addBtn = document.getElementById('add-tag-btn');
        if (!addBtn) return;

        const currentId = this.generateRandomId();

        const inputHtml = `
            <span class="tag-input-mode" id="tag-input-mode">
                <input type="text" id="${currentId}" placeholder="标签名" maxlength="20">
                <button class="btn btn--colorless" id="cancel-add-tag">×</button>
            </span>
        `;

        addBtn.replaceWith(document.createElement('span'));
        const inputContainer = document.getElementById('tag-input-mode');
        if (inputContainer) {
            inputContainer.outerHTML = inputHtml;
        } else {
            this.tagSelector.insertAdjacentHTML('beforeend', inputHtml);
        }

        const input = document.getElementById(currentId);
        const cancelBtn = document.getElementById('cancel-add-tag');

        input.focus();
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                await this.addNewTag(input.value.trim());
            } else if (e.key === 'Escape') {
                this.renderSelector();
            }
        });

        if (cancelBtn) cancelBtn.onclick = () => this.renderSelector();
    }

    // 添加新标签：
    // 标签实体由后端在保存任务时按名称创建，这里只在弹窗内登记为"临时标签"，
    // 不再伪造 id 塞进标签数据源——避免假 id 混入数据源、取消弹窗后残留
    async addNewTag(tagName) {
        const name = (tagName || '').trim();
        if (!name) {
            Utils.showToast(window.languageManager.getText('errorTagNameRequired', '请输入标签名'), 'warning');
            return;
        }

        // 重名校验：已落库的标签 + 本次弹窗已新建的临时标签
        if (this.tags.some(tag => tag.name === name) || this.pendingTagNames.includes(name)) {
            Utils.showToast(window.languageManager.getText('errorTagExisted', '标签已存在'), 'warning');
            return;
        }

        this.pendingTagNames.push(name);
        // 新建后直接置为选中，符合"点了新增就是要用它"的预期
        const tempId = TEMP_TAG_PREFIX + name;
        if (!this.formSelectedTagIds.includes(tempId)) this.formSelectedTagIds.push(tempId);

        this.renderSelector();
    }

    // ===== 标签维护 =====

    // 删除标签（tagName 用于展示更明确的确认文案）
    async deleteTag(tagId, tagName = null) {
        // 临时标签（弹窗中新建、尚未落库）：本地直接丢弃，无需调用后端
        const pendingName = this.getPendingTagName(tagId);
        if (pendingName !== null) {
            this.pendingTagNames = this.pendingTagNames.filter(name => name !== pendingName);
            const pendingIndex = this.formSelectedTagIds.indexOf(tagId);
            if (pendingIndex !== -1) this.formSelectedTagIds.splice(pendingIndex, 1);
            this.renderSelector();
            return;
        }

        const tag = this.tags.find(t => t.id === tagId);
        const name = tagName || (tag && tag.name) || '';
        Utils.confirmDialog(
            name ? `确定要删除标签“${name}”吗？` : '确定要删除这个标签吗？',
            async () => {
                await Utils.apiCall({
                    apiMethod: 'delete_tag',
                    apiArgs: [tagId],
                    onSuccess: () => {
                        Utils.showToast(window.languageManager.getText('taskTagDeleted', '标签删除成功'), 'success');

                        // 同步表单选择态与列表筛选（若该标签正处于筛选中，移除对应 chip 并重新搜索）
                        const index = this.formSelectedTagIds.indexOf(tagId);
                        if (index !== -1) this.formSelectedTagIds.splice(index, 1);
                        this.hooks.onTagDeleted?.(tagId);

                        // 重新加载标签（选择器可能正处于打开状态，两个视图共用同一次请求）
                        this.loadSelector();
                        this.loadModule(true);
                    },
                    onError: () => {
                        Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                    }
                });
            }
        );
    }

    // 开始内联编辑标签名称
    startRenameTag(tagId) {
        let item = this.tagsList.querySelector(`.tag-module-item[data-tag-id="${tagId}"]`);
        const tag = this.tags.find(t => t.id === tagId);
        if (!item || !tag) return;

        // 若已有其他标签正处于编辑状态，先退出恢复原状（重渲染后重新获取目标节点）
        const editing = this.tagsList.querySelector('.tag-module-item.editing');
        if (editing && editing !== item) {
            this.renderModule();
            item = this.tagsList.querySelector(`.tag-module-item[data-tag-id="${tagId}"]`);
            if (!item) return;
        }

        item.classList.add('editing');
        item.innerHTML = '';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-edit-input';
        input.value = tag.name;
        input.maxLength = 20;
        input.placeholder = '标签名';
        item.appendChild(input);

        let finished = false;
        const finish = (callback) => {
            if (finished) return;
            finished = true;
            input.removeEventListener('keydown', handleKeydown);
            input.removeEventListener('blur', handleBlur);
            callback();
        };
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finish(() => this.commitTagRename(tagId, input.value.trim()));
            } else if (e.key === 'Escape') {
                finish(() => this.renderModule());
            }
        };
        const handleBlur = () => finish(() => this.renderModule());

        input.addEventListener('keydown', handleKeydown);
        input.addEventListener('blur', handleBlur);
        input.focus();
        input.select();
    }

    // 提交标签重命名
    async commitTagRename(tagId, newName) {
        if (!newName) {
            Utils.showToast(window.languageManager.getText('errorTagNameRequired', '请输入标签名'), 'warning');
            this.renderModule();
            return;
        }

        // 重名校验（排除自身）
        if (this.tags.some(t => t.id !== tagId && t.name === newName)) {
            Utils.showToast(window.languageManager.getText('errorTagExisted', '标签已存在'), 'warning');
            this.renderModule();
            return;
        }

        Utils.setLoading(true, '更新中...');
        await Utils.apiCall({
            apiMethod: 'update_tag',
            apiArgs: [tagId, { name: newName }],
            onSuccess: async () => {
                Utils.showToast(window.languageManager.getText('tagUpdated', '标签更新成功'), 'success');

                // 同步本地标签名称，并让筛选 chip 同步显示新名称
                const localTag = this.tags.find(t => t.id === tagId);
                if (localTag) localTag.name = newName;
                const chipRenamed = this.hooks.onTagRenamed?.(tagId, newName) ?? false;

                // 刷新标签列表，并重新加载任务以更新任务中展示的标签名称
                await this.loadModule(true);
                this.hooks.onTagsChanged?.({ resyncSearch: chipRenamed });
            },
            onError: () => {
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
                // 退出编辑态，恢复原标签列表
                this.renderModule();
            },
            onFinally: () => Utils.setLoading(false)
        });
    }
}

// 创建全局实例
window.tagManager = new TagManager();
window.tagManager.init();

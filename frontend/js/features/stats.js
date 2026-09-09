// ============================================================
// 统计视图管理模块（StatsManager）
// 依赖后端 StatisticsApiMixin 提供的两个接口：
//   - get_statistics_options(date_basis)
//   - get_task_statistics(date_basis, scope, year, month, week, category_id)
// 图表使用纯 CSS/SVG 实现，无第三方图表库依赖，离线可用。
// ============================================================

const STATS_BASIS_LABELS = {
    created: '创建时间',
    due: '截止时间',
    completed: '完成时间（仅已完成）'
};

const STATS_SCOPE_LABELS = {
    all: '全部时间',
    year: '按年份',
    month: '按月份',
    week: '按周'
};

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ---------------- 工具 ----------------
function statsPad(n) {
    return n < 10 ? '0' + n : '' + n;
}

function statsEsc(v) {
    return Utils.escapeHtml(String(v == null ? '' : v));
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${statsPad(d.getMonth() + 1)}-${statsPad(d.getDate())}`;
}

// 返回给定日期所在周的周一（周起始），本地时区
function statsMondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - (x.getDay() + 6) % 7);
    return `${x.getFullYear()}-${statsPad(x.getMonth() + 1)}-${statsPad(x.getDate())}`;
}

function addDaysISO(iso, days) {
    const p = iso.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${statsPad(d.getMonth() + 1)}-${statsPad(d.getDate())}`;
}

// ISO 日期 -> 星期几（周一~周日）
function statsWeekdayOf(iso) {
    const p = iso.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return WEEKDAY_NAMES[(d.getDay() + 6) % 7];
}

// 趋势横轴刻度文案：
//   年粒度 -> 2026；月粒度 -> 01月；按周 -> 周一~周日；按月份 -> 1日~月末
function trendAxisLabel(granularity, scope, key) {
    if (granularity === 'year') return key;
    if (granularity === 'month') {
        return `${key.split('-')[1]}月`;
    }
    if (scope === 'week') return statsWeekdayOf(key);
    return `${Number(key.slice(8, 10))}日`;
}

function curPeriod() {
    const now = new Date();
    const y = now.getFullYear();
    return {
        year: String(y),
        month: `${y}-${statsPad(now.getMonth() + 1)}`,
        week: statsMondayOf(now)
    };
}

// ---------------- 小部件 HTML 构造 ----------------
function legendHtml(items) {
    return `<div class="stats-legend">${items.map(it =>
        `<span><i style="background:${it.color}"></i>${statsEsc(it.label)}</span>`
    ).join('')}</div>`;
}

function panelHead(title, sub, extra) {
    return `<div class="stats-panel__head"><h3>${statsEsc(title)}${sub ? `<span class="stats-panel__sub">${statsEsc(sub)}</span>` : ''}</h3>${extra || ''}</div>`;
}

function emptyHtml(msg) {
    return `<div class="stats-empty">${statsEsc(msg)}</div>`;
}

// 通用柱状图。columns: [{x, tip, total, parts:[{v,color}], num, cls}]
function buildVChart(columns, { dense = false, showValues = true } = {}) {
    if (!columns.length) return '';
    const max = Math.max(1, ...columns.map(c => c.total));
    const colsHtml = columns.map(col => {
        const segs = (col.parts || []).map(p => {
            const h = p.v > 0 ? Math.max(2, Math.round(p.v / max * 100)) : 0;
            return `<div class="v-col__seg" style="height:${h}%;background:${p.color || 'var(--stats-bar)'}"></div>`;
        }).join('');
        const num = (showValues && col.num != null && col.num !== '')
            ? `<div class="v-col__num">${col.num}</div>` : '';
        return `<div class="v-col${col.cls ? ' v-col--' + col.cls : ''}" title="${statsEsc(col.tip || '')}">${num}<div class="v-col__bars">${segs}</div>${col.x == null ? '' : `<div class="v-col__x">${statsEsc(col.x)}</div>`}</div>`;
    }).join('');
    return `<div class="v-chart-scroll"><div class="v-chart${dense ? ' v-chart--dense' : ''}">${colsHtml}</div></div>`;
}

// 环形图 parts: [{label, color, v}]
function donutHtml(parts, centerBig, centerSub) {
    const total = parts.reduce((s, p) => s + (p.v || 0), 0);
    if (!total) return emptyHtml('暂无数据');
    let acc = 0;
    const stops = [];
    parts.forEach(p => {
        const from = acc / total * 360;
        acc += p.v;
        const to = acc / total * 360;
        if (p.v > 0) stops.push(`${p.color} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`);
    });
    const legend = parts.filter(p => p.v > 0).map(p =>
        `<li><i style="background:${p.color}"></i><span>${statsEsc(p.label)}</span><span class="dl-num">${p.v}</span><span class="dl-pct">${(p.v / total * 100).toFixed(1)}%</span></li>`
    ).join('');
    return `<div class="donut-wrap">
        <div class="donut" style="background:conic-gradient(${stops.join(',')})">
            <div class="donut-center"><b>${statsEsc(centerBig)}</b><span>${statsEsc(centerSub)}</span></div>
        </div>
        <ul class="donut-legend">${legend}</ul></div>`;
}

// ---------------- StatsManager ----------------
class StatsManager {
    constructor() {
        this.state = {
            basis: 'created',
            // 默认筛选当前周（若数据中没有本周，则落到最近一个有数据的周期）
            scope: 'week',
            year: '',
            month: '',
            week: ''
        };
        this.available = { years: [], months: [], weeks: [] };
        this.inited = false;
        this._loadedOnce = false;
        this._seq = 0;
        this._lastTotal = 0;
    }

    // 模块初始化（仅绑定事件，不做重量级请求）
    init() {
        if (this.inited) return;
        this.inited = true;
        this.bindEvents();
    }

    // 统计视图被切换到前台时触发
    onViewEnter() {
        const content = document.getElementById('stats-content');
        if (content && !content.dataset.loaded) {
            content.innerHTML = '<div class="stats-loading">加载统计数据中...</div>';
        }
        this.ensureReady();
    }

    refresh() {
        const view = document.getElementById('stats-view');
        if (!view || view.style.display === 'none') return;
        this.ensureReady();
    }

    bindEvents() {
        const basisSel = document.getElementById('stats-basis-select');
        const scopeSel = document.getElementById('stats-scope-select');
        const yearSel = document.getElementById('stats-year-select');
        const monthSel = document.getElementById('stats-month-select');
        const weekSel = document.getElementById('stats-week-select');
        basisSel?.addEventListener('change', async () => {
            this.state.basis = basisSel.value;
            await this._refreshOptions(true);
        });
        scopeSel?.addEventListener('change', () => {
            this.state.scope = scopeSel.value;
            // 切换档位后，年份联动刷新其下辖的月份/周
            this._renderCascade();
            this.loadStats();
        });
        yearSel?.addEventListener('change', () => {
            this.state.year = yearSel.value || '';
            // 年份变化后重置月份/周，联动到新年份（保留用户刚选的年份）
            this.state.month = '';
            this.state.week = '';
            this._renderCascade(true);
            this.loadStats();
        });
        monthSel?.addEventListener('change', () => {
            this.state.month = monthSel.value || '';
            // 月份变化后重置周，联动到新月份（保留用户刚选的年份与月份）
            this.state.week = '';
            this._renderCascade(true);
            this.loadStats();
        });
        weekSel?.addEventListener('change', () => {
            this.state.week = weekSel.value || '';
            this.loadStats();
        });
    }

    // 当前统计使用的分类：跟随左侧菜单「分类」的点击选择
    _currentCategoryId() {
        return (window.categoryManager && window.categoryManager.currentCategory) || 'all';
    }

    // 当前选中分类的展示名
    _currentCategoryName() {
        const cid = this._currentCategoryId();
        if (!cid || cid === 'all') return '全部分类';
        const cm = window.categoryManager;
        const c = cm ? cm.categories.find(x => String(x.id) === String(cid)) : null;
        return c ? c.name : `#${cid}`;
    }

    // 左侧已点选标签（搜索 chips 中 type='tag'）的 id 集合，用于统计过滤
    _currentTagIds() {
        const tm = window.todoManager;
        if (!tm || !Array.isArray(tm.searchChips)) return [];
        return tm.searchChips
            .filter(c => c && c.type === 'tag' && c.tagId)
            .map(c => c.tagId);
    }

    // 左侧已点选标签的名称列表（用于提示文案）
    _currentTagNames() {
        const tm = window.todoManager;
        if (!tm || !Array.isArray(tm.searchChips)) return [];
        return tm.searchChips
            .filter(c => c && c.type === 'tag' && c.value)
            .map(c => c.value);
    }

    // 当前筛选（分类/标签）发生变化、且统计视图处于前台时调用：
    // 按最新筛选重新加载统计，保持已选的时间范围与周期不变
    reloadStatsIfVisible() {
        const view = document.getElementById('stats-view');
        if (!view || view.style.display === 'none') return;
        return this.loadStats();
    }

    // 统一走后端调用封装 window.Utils.apiCall（内部等待 pywebview 就绪、统一错误处理）
    _call(name, args) {
        return new Promise((resolve, reject) => {
            Utils.apiCall({
                apiMethod: name,
                apiArgs: args || [],
                onSuccess: (resp) => resolve(resp && 'data' in resp ? resp.data : resp),
                onError: (error) => {
                    if (error instanceof Error) reject(error);
                    else reject(new Error(error || `${name} 请求失败`));
                }
            });
        });
    }

    _syncSelects() {
        const basisSel = document.getElementById('stats-basis-select');
        const scopeSel = document.getElementById('stats-scope-select');
        if (basisSel) basisSel.value = this.state.basis;
        if (scopeSel) scopeSel.value = this.state.scope;
    }

    async ensureReady() {
        if (this._loading) return;
        this._loading = true;
        try {
            this._syncSelects();
            this._loadedOnce = true;
            await this._refreshOptions(false);
            await this.loadStats();
        } catch (e) {
            this._renderError(e);
        } finally {
            this._loading = false;
        }
    }

    // 重新拉取可选时间项，并刷新「年份-月份-周」级联下拉
    async _refreshOptions(reload = true) {
        const opt = await this._call('get_statistics_options', [this.state.basis]);
        this.available = {
            years: (opt && opt.years) || [],
            months: (opt && opt.months) || [],
            weeks: (opt && opt.weeks) || []
        };
        this._renderCascade();
        if (reload) await this.loadStats();
    }

    // 候选项全部取自实际数据：
    //   年份 = 有数据的年份；月份 = 该年内有数据的月份；
    //   周   = 与所选月份有交集、且有数据的周。
    // 只有「当前年/月/周」本身有数据时，才会作为候选项出现，不额外注入。
    _yearOptions() {
        return (this.available.years || [])
            .map(String)
            .sort((a, b) => (+a) - (+b));
    }

    _monthOptions(year) {
        const prefix = `${year}-`;
        return (this.available.months || [])
            .filter(m => String(m).startsWith(prefix) && m.length === 7)
            .sort();
    }

    _weekOptions(year, ym) {
        return (this.available.weeks || [])
            .filter(w => this._weekOverlapMonth(w.start, ym))
            .map(w => w.start)
            .sort();
    }

    // 判断某周(周一)是否与 YYYY-MM 月份有交集
    _weekOverlapMonth(mondayISO, ym) {
        const y = +ym.slice(0, 4);
        const m = +ym.slice(5, 7);
        const first = new Date(y, m - 1, 1);
        const last = new Date(y, m, 0);
        const w = mondayISO.split('-');
        const start = new Date(+w[0], +w[1] - 1, +w[2]);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return start <= last && end >= first;
    }

    // 默认选中项：若当前周期真实存在于候选项中则选它，否则选最近的一个数据周期
    _pickPeriod(list, current) {
        if (current && list.includes(current)) return current;
        return list.length ? list[list.length - 1] : '';
    }

    // 填充一个下拉框（values 为升序字符串数组）
    _fillPeriodSelect(sel, values, labelOf, current) {
        const html = values.map(v => {
            const lbl = labelOf(v);
            const tip = lbl === v ? v : `${v}（${lbl}）`;
            return `<option value="${statsEsc(v)}" title="${statsEsc(tip)}">${statsEsc(lbl)}</option>`;
        }).join('');
        sel.innerHTML = html;
        sel.disabled = !values.length;
        sel.value = values.includes(current) ? current : (values[0] || '');
    }

    // 按当前 scope 显隐并联动刷新 年份/月份/周 三个下拉框
    // preserve=true：保留用户已选中的周期值（只要其仍在候选项中就不重置），
    //   供年份/月份手动切换后刷新子级使用；否则默认选中「当前周期」。
    _renderCascade(preserve = false) {
        const { scope } = this.state;
        const yearItem = document.getElementById('stats-year-item');
        const monthItem = document.getElementById('stats-month-item');
        const weekItem = document.getElementById('stats-week-item');
        const yearSel = document.getElementById('stats-year-select');
        const monthSel = document.getElementById('stats-month-select');
        const weekSel = document.getElementById('stats-week-select');

        // 该口径下连一个可选周期都没有时，自动退回「全部时间」，避免出现空下拉
        let curScope = scope;
        if (curScope !== 'all' && !this._yearOptions().length) {
            this.state.scope = 'all';
            curScope = 'all';
            const scopeSel = document.getElementById('stats-scope-select');
            if (scopeSel) scopeSel.value = 'all';
        }

        const showYear = curScope !== 'all';
        const showMonth = curScope === 'month' || curScope === 'week';
        const showWeek = curScope === 'week';
        if (yearItem) yearItem.style.display = showYear ? 'flex' : 'none';
        if (monthItem) monthItem.style.display = showMonth ? 'flex' : 'none';
        if (weekItem) weekItem.style.display = showWeek ? 'flex' : 'none';
        if (!showYear) return;

        const p = curPeriod();
        const years = this._yearOptions();
        // 1) 年份：有数据的年份
        if (!(preserve && years.includes(this.state.year))) {
            this.state.year = this._pickPeriod(years, p.year);
        }
        if (yearSel) {
            this._fillPeriodSelect(yearSel, years, y => `${y}年`, this.state.year);
        }

        // 2) 月份：随年份联动，仅该年内有数据的月份
        if (showMonth) {
            const months = this._monthOptions(this.state.year);
            if (!(preserve && months.includes(this.state.month))) {
                this.state.month = this._pickPeriod(months, p.month);
            }
            if (monthSel) {
                this._fillPeriodSelect(
                    monthSel, months,
                    m => `${Number(m.slice(5, 7))}月`,
                    this.state.month
                );
            }
        }

        // 3) 周：随年份+月份联动，仅与该月相交且有数据的周
        if (showWeek) {
            const weeks = this._weekOptions(this.state.year, this.state.month);
            if (!(preserve && weeks.includes(this.state.week))) {
                this.state.week = this._pickPeriod(weeks, p.week);
            }
            if (weekSel) {
                this._fillPeriodSelect(
                    weekSel, weeks,
                    w => `${w.slice(5)} ~ ${addDaysISO(w, 6).slice(5)}`,
                    this.state.week
                );
            }
        }
    }

    _buildArgs() {
        const tagIds = this._currentTagIds();
        const args = [
            this.state.basis, this.state.scope, null, null, null,
            this._currentCategoryId(),
            tagIds.length ? tagIds : null
        ];
        if (this.state.scope === 'year') args[2] = this.state.year || null;
        if (this.state.scope === 'month') args[3] = this.state.month || null;
        if (this.state.scope === 'week') args[4] = this.state.week || null;
        return args;
    }

    async loadStats() {
        const seq = ++this._seq;
        const content = document.getElementById('stats-content');
        if (!content) return;
        try {
            const data = await this._call('get_task_statistics', this._buildArgs());
            if (seq !== this._seq) return; // 丢弃过期请求结果
            this._lastTotal = (data && data.kpi && data.kpi.total) || 0;
            content.dataset.loaded = '1';
            content.innerHTML = this._buildDashboard(data || {});
            this._updateHint();
        } catch (e) {
            if (seq !== this._seq) return;
            this._renderError(e);
        }
    }

    _renderError(e) {
        const content = document.getElementById('stats-content');
        if (content) {
            content.dataset.loaded = '1';
            content.innerHTML = `<div class="stats-empty">统计数据加载失败：${statsEsc(e && e.message ? e.message : e)}</div>`;
        }
        Utils.showToast('统计数据加载失败', 'error');
    }

    // ---------- 摘要 ----------
    _scopeDesc() {
        const { scope, year, month, week } = this.state;
        if (scope === 'year') {
            return year ? `${year}年` : '按年份';
        }
        if (scope === 'month') {
            if (!month) return '按月份';
            return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
        }
        if (scope === 'week') {
            if (!week) return '按周';
            if (week === statsMondayOf(new Date())) return `本周（${week} ~ ${addDaysISO(week, 6)}）`;
            return `${week} ~ ${addDaysISO(week, 6)}`;
        }
        return '全部时间';
    }

    _updateHint() {
        const hint = document.getElementById('stats-toolbar-hint');
        if (!hint) return;
        const basis = STATS_BASIS_LABELS[this.state.basis] || this.state.basis;
        const tagNames = this._currentTagNames();
        const tagText = tagNames.length
            ? ` · 标签：${tagNames.map(n => `#${n}`).join('、')}`
            : '';
        hint.textContent = `口径：${basis} · 范围：${this._scopeDesc()} · ${this._currentCategoryName()}${tagText} · 共 ${this._lastTotal} 个任务`;
    }

    // ---------- 仪表板构造 ----------
    _buildDashboard(data) {
        const kpi = data.kpi || {};
        const html = [];
        html.push(this._buildKpis(kpi, data));
        html.push(this._buildTrend(data.trend));
        html.push(`<div class="stats-grid">${this._buildStatus(data.status, kpi)}${this._buildPriority(data.priority)}</div>`);
        html.push(this._buildCategory(data.category));
        html.push(`<div class="stats-grid">${this._buildWeekday(data.weekday)}${this._buildHour(data.hour)}</div>`);
        html.push(this._buildTags(data.tags));
        const overduePanel = this._buildOverdue(data.overdueTasks);
        if (overduePanel) html.push(overduePanel);
        const insightPanel = this._buildInsights(data);
        if (insightPanel) html.push(insightPanel);
        return html.join('');
    }

    _buildKpis(kpi) {
        const total = kpi.total || 0;
        const completed = kpi.completed || 0;
        const uncompleted = kpi.uncompleted || 0;
        const rate = kpi.completionRate != null ? kpi.completionRate : (total ? +(completed / total * 100).toFixed(1) : 0);
        const overdue = kpi.overdue || 0;
        const noDue = kpi.noDueDate || 0;

        const card = (label, value, cls, sub) =>
            `<div class="kpi-card"><span class="kpi-card__label">${label}</span>` +
            `<span class="kpi-card__value${cls ? ' ' + cls : ''}">${value}</span>` +
            (sub ? `<span class="kpi-card__sub">${sub}</span>` : '') + `</div>`;

        return `<div class="stats-kpis">
            ${card('任务总数', total, 'kpi--blue', `当前筛选范围`)}
            ${card('已完成', completed, 'kpi--green', uncompleted ? `占 ${rate}%` : '')}
            ${card('未完成', uncompleted, 'kpi--orange', completed ? `占 ${(100 - rate).toFixed(1)}%` : '')}
            ${card('完成率', `${rate}%`, 'kpi--blue', '')}
            ${card('逾期未完成', overdue, overdue > 0 ? 'kpi--red' : 'kpi--slate', overdue > 0 ? '请及时处理' : '暂无逾期')}
            ${card('无截止日期', noDue, 'kpi--slate', noDue > 0 ? '建议补充截止时间' : '')}
        </div>`;
    }

    _buildTrend(trend) {
        const items = (trend && trend.items) || [];
        if (!items.length) {
            return `<section class="stats-panel stats-panel--full">${panelHead('任务量趋势', STATS_BASIS_LABELS[this.state.basis])}<div class="stats-panel__body">${emptyHtml('当前范围内没有带有效时间的任务数据')}</div></section>`;
        }
        const granularity = ['day', 'month', 'year'].includes(trend.granularity)
            ? trend.granularity : 'year';
        // 全部时间 -> 年度任务量趋势；按年份 -> 月度；按月份/按周 -> 日度
        const title = granularity === 'year' ? '年度任务量趋势'
            : (granularity === 'month' ? '月度任务量趋势' : '日度任务量趋势');
        const showValues = items.length <= 16;
        const dense = items.length > 26;
        const legend = legendHtml([
            { label: '已完成', color: 'var(--stats-done)' },
            { label: '未完成', color: 'var(--stats-todo)' }
        ]);
        const today = todayISO();
        const scope = this.state.scope;
        const cols = items.map(it => ({
            x: trendAxisLabel(granularity, scope, it.key),
            tip: `${it.key}：已完成 ${it.completed || 0} · 未完成 ${it.uncompleted || 0} · 共 ${it.total || 0}`,
            total: it.total || 0,
            parts: [
                { v: it.completed || 0, color: 'var(--stats-done)' },
                { v: it.uncompleted || 0, color: 'var(--stats-todo)' }
            ],
            num: showValues ? (it.total || 0) : null,
            cls: granularity === 'day' && it.key === today ? 'today' : ''
        }));
        return `<section class="stats-panel stats-panel--full">${panelHead(title, STATS_BASIS_LABELS[this.state.basis], legend)}<div class="stats-panel__body">${buildVChart(cols, { dense, showValues })}</div></section>`;
    }

    _buildStatus(status, kpi) {
        const completed = (status && status.completed) || 0;
        const uncompleted = (status && status.uncompleted) || 0;
        const rate = kpi.total ? (completed / kpi.total * 100) : 0;
        const parts = [];
        if (completed > 0) parts.push({ label: '已完成', color: 'var(--stats-done)', v: completed });
        if (uncompleted > 0) parts.push({ label: '未完成', color: 'var(--stats-todo)', v: uncompleted });
        const centerBig = `${rate.toFixed(1)}%`;
        const centerSub = '完成率';
        return `<section class="stats-panel">${panelHead('完成状态', this.state.basis === 'completed' ? '已完成任务' : '')}<div class="stats-panel__body">${donutHtml(parts, centerBig, centerSub)}</div></section>`;
    }

    _buildPriority(priority) {
        const list = (priority || []).filter(p => p.count > 0);
        if (!list.length) {
            return `<section class="stats-panel">${panelHead('优先级分布')}<div class="stats-panel__body">${emptyHtml('暂无数据')}</div></section>`;
        }
        const max = Math.max(...list.map(p => p.count));
        const rows = list.map(p => {
            const info = Utils.getPriorityInfo(p.key);
            const label = `${info.icon} ${info.label}优先级`;
            const pct = Math.round(p.count / max * 100);
            return `<li class="h-row">
                <span class="h-row__name" title="${statsEsc(label)}"><i style="background:${info.color}"></i>${statsEsc(label)}</span>
                <div class="h-row__track"><div class="h-row__fill" style="width:${Math.max(pct, 2)}%;background:${info.color}"></div></div>
                <span class="h-row__value">${p.count}</span></li>`;
        }).join('');
        return `<section class="stats-panel">${panelHead('优先级分布')}<div class="stats-panel__body"><ul class="h-list">${rows}</ul></div></section>`;
    }

    _buildCategory(category) {
        const list = (category || []).filter(c => c.count > 0);
        if (!list.length) {
            return `<section class="stats-panel stats-panel--full">${panelHead('分类分布（含完成率）')}<div class="stats-panel__body">${emptyHtml('暂无数据')}</div></section>`;
        }
        const max = Math.max(...list.map(c => c.count));
        const rows = list.map(c => {
            const pct = Math.round(c.count / max * 100);
            const innerPct = c.count > 0 ? Math.round(c.completed / c.count * 100) : 0;
            return `<li class="h-row">
                <span class="h-row__name" title="${statsEsc(c.name)}"><i style="background:${c.color || '#95a5a6'}"></i>${statsEsc(c.name)}</span>
                <div class="h-row__track"><div class="h-row__fill" style="width:${Math.max(pct, 2)}%;background:${c.color || 'var(--stats-bar)'}"><div class="h-row__fill--rate" style="width:${innerPct}%"></div></div></div>
                <span class="h-row__value" title="完成率 ${c.rate}%">${c.count} · ${c.rate}%</span></li>`;
        }).join('');
        const sub = this._currentCategoryId() !== 'all' ? '' : `${list.length} 个分类`;
        return `<section class="stats-panel stats-panel--full">${panelHead('分类分布', sub, legendHtml([{ label: '完成率', color: 'var(--stats-done)' }]))}<div class="stats-panel__body"><ul class="h-list">${rows}</ul></div></section>`;
    }

    _buildWeekday(weekday) {
        const counts = (weekday || []).slice(0, 7).map(w => w.count || 0);
        if (counts.every(c => c === 0)) {
            return `<section class="stats-panel">${panelHead('截止星期分布', '有截止日期')}<div class="stats-panel__body">${emptyHtml('暂无带截止日期的任务')}</div></section>`;
        }
        const cols = counts.map((c, i) => ({
            x: WEEKDAY_NAMES[i],
            tip: `${WEEKDAY_NAMES[i]}：${c} 个`,
            total: c,
            parts: c > 0 ? [{ v: c, color: 'var(--stats-bar)' }] : [],
            num: c
        }));
        return `<section class="stats-panel">${panelHead('截止星期分布', '有截止日期')}<div class="stats-panel__body">${buildVChart(cols)}</div></section>`;
    }

    _buildHour(hour) {
        const counts = (hour || []).slice(0, 24).map(h => h.count || 0);
        if (counts.every(c => c === 0)) {
            return `<section class="stats-panel">${panelHead('截止时段分布', '小时')}<div class="stats-panel__body">${emptyHtml('暂无带截止日期的任务')}</div></section>`;
        }
        const cols = counts.map((c, i) => ({
            x: `${i}`,
            tip: `${i}时：${c} 个`,
            total: c,
            parts: c > 0 ? [{ v: c, color: 'var(--stats-slate)' }] : [],
            num: c > 0 ? c : null
        }));
        return `<section class="stats-panel">${panelHead('截止时段分布', '0-23时')}<div class="stats-panel__body">${buildVChart(cols, { dense: true, showValues: true })}</div></section>`;
    }

    _buildTags(tags) {
        const list = (tags || []).slice(0, 10);
        if (!list.length) {
            return `<section class="stats-panel stats-panel--full">${panelHead('标签使用 Top', '')}<div class="stats-panel__body">${emptyHtml('当前范围内暂无标签')}</div></section>`;
        }
        const max = Math.max(...list.map(t => t.count));
        const rows = list.map(t => {
            const pct = Math.round(t.count / max * 100);
            return `<li class="h-row">
                <span class="h-row__name" title="标签：${statsEsc(t.name)}">🏷️ ${statsEsc(t.name)}</span>
                <div class="h-row__track"><div class="h-row__fill" style="width:${Math.max(pct, 2)}%;background:var(--stats-bar)"></div></div>
                <span class="h-row__value">${t.count}</span></li>`;
        }).join('');
        return `<section class="stats-panel stats-panel--full">${panelHead('标签使用 Top', list.length > 9 ? '前10' : '')}<div class="stats-panel__body"><ul class="h-list">${rows}</ul></div></section>`;
    }

    _buildOverdue(overdueTasks) {
        const list = overdueTasks || [];
        if (!list.length) return null;
        const rows = list.slice(0, 50).map(t => {
            const prio = Utils.getPriorityInfo(t.priority);
            return `<tr>
                <td class="st-title" title="${statsEsc(t.title)}">${statsEsc(t.title)}</td>
                <td><span class="stats-cat-tag"><i style="background:${t.color || '#95a5a6'}"></i>${statsEsc(t.categoryName || '未分类')}</span></td>
                <td><span class="stats-priority">${prio.icon} ${prio.label}</span></td>
                <td class="st-due">${statsEsc(t.dueDate)}</td></tr>`;
        }).join('');
        const sub = list.length > 50 ? `前50 / 共${list.length}` : `共 ${list.length} 条`;
        return `<section class="stats-panel stats-panel--full">${panelHead('逾期未完成任务', sub)}<div class="stats-panel__body"><table class="stats-table"><thead><tr><th>任务</th><th>分类</th><th>优先级</th><th>截止时间</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    _buildInsights(data) {
        const kpi = data.kpi || {};
        const list = [];
        if (!kpi.total) return null;
        const basis = data.basis === 'completed';
        list.push(`当前范围内共 <b>${kpi.total}</b> 个任务${basis ? '（均为已完成）' : ''}，已完成 <b>${kpi.completed}</b> 个，完成率 <b>${kpi.completionRate}%</b>。`);
        if (!basis && (kpi.overdue || 0) > 0) {
            list.push(`有 <b>${kpi.overdue}</b> 个任务已逾期未完成，建议优先处理。`);
        }
        const items = (data.trend && data.trend.items) || [];
        if (items.length) {
            const best = items.reduce((a, b) => ((b.total || 0) > (a.total || 0) ? b : a), items[0]);
            if (best && best.total > 0) {
                const g = data.trend.granularity;
                let peak = '';
                if (g === 'year') peak = `任务量最高的年份是 <b>${best.key}年</b>`;
                else if (g === 'month') {
                    const yy = best.key.slice(0, 4);
                    const mm = best.key.slice(5, 7);
                    peak = `任务量最高的月份是 <b>${yy}年${Number(mm)}月</b>`;
                } else {
                    peak = `任务量最高的日期是 <b>${trendAxisLabel(g, this.state.scope, best.key)}</b>（${best.key}）`;
                }
                list.push(`${peak}，共 ${best.total} 个，其中已完成 ${best.completed} 个。`);
            }
        }
        const cats = (data.category || []).filter(c => c.count > 0);
        if (cats.length) {
            const top = cats.slice().sort((a, b) => b.count - a.count)[0];
            if (top && top.count > 0) list.push(`分类 <b>${top.name}</b> 任务最多（${top.count} 个），完成率 ${top.rate}%。`);
            const weak = cats.filter(c => c.count >= 5 && c.rate < 40).sort((a, b) => a.rate - b.rate)[0];
            if (weak) list.push(`分类 <b>${weak.name}</b> 完成率偏低（${weak.rate}%），可考虑拆解或设置提醒。`);
        }
        if ((kpi.noDueDate || 0) > 0 && !basis) {
            list.push(`有 <b>${kpi.noDueDate}</b> 个任务未设置截止时间，建议补充以便更好跟踪。`);
        }
        if (!list.length) return null;
        const lis = list.map(t => `<li>${t}</li>`).join('');
        return `<section class="stats-panel stats-panel--full">${panelHead('要点速览', '基于当前筛选自动生成')}<div class="stats-panel__body"><ul class="stats-insights">${lis}</ul></div></section>`;
    }
}

window.StatsManager = StatsManager;
window.statsManager = new StatsManager();

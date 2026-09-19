/**
 * 周期性任务规则控制器
 *
 * 周期规则的控件重置、选项构建、规则收集与校验、
 * 预览、面板显隐，以及「单次 / 周期性」模式切换。
 *
 * 依赖的 TodoManager 成员：
 *   DOM：recurrenceModeNormal / recurrenceModeCron / recurrenceType /
 *        dailyModeTimes / dailyModeInterval / dailyIntervalStart /
 *        dailyIntervalEnd / dailyIntervalMinutes / recurrenceCron /
 *        recurrenceEndType / recurrenceCount / recurrenceEndDate /
 *        recurrenceEndPikaday / weeklyDays / monthlyDays / yearlyMonth /
 *        yearlyDay / recurrenceTimes / recurrencePreview / recurringOptions /
 *        scheduleModeRecurring / recurrenceNormalPanel / recurrenceCronPanel /
 *        dailyModeGroup / dailyIntervalGroup / weeklyGroup / monthlyGroup /
 *        yearlyGroup / recurrenceTimesGroup / recurrenceCountGroup /
 *        recurrenceEndDateGroup / recurrenceHabitHint
 *
 * 注意：提醒时间点的 DOM 事件回调里会调用本控制器方法，
 * 因此这些闭包通过 controller 而非 ctx 调用。
 *
 * 校验失败文案表直接挂在类上（见文件末尾 RecurrenceController.ERROR_MESSAGES），
 * 不再依赖顶层 const 与 index.html 中的脚本加载顺序。
 */
class RecurrenceController {
    constructor(ctx) {
        this.ctx = ctx;
    }

    // 重置周期规则的全部控件到默认状态
    reset() {
        const ctx = this.ctx;
        if (ctx.recurrenceModeNormal) ctx.recurrenceModeNormal.checked = true;
        if (ctx.recurrenceModeCron) ctx.recurrenceModeCron.checked = false;
        if (ctx.recurrenceType) ctx.recurrenceType.value = '';
        if (ctx.dailyModeTimes) ctx.dailyModeTimes.checked = true;
        if (ctx.dailyModeInterval) ctx.dailyModeInterval.checked = false;
        if (ctx.dailyIntervalStart) ctx.dailyIntervalStart.value = '09:00';
        if (ctx.dailyIntervalEnd) ctx.dailyIntervalEnd.value = '18:00';
        if (ctx.dailyIntervalMinutes) ctx.dailyIntervalMinutes.value = '60';
        if (ctx.recurrenceCron) ctx.recurrenceCron.value = '';
        // 默认「习惯」：只保留一条待办，避免一次创建大量任务
        if (ctx.recurrenceEndType) ctx.recurrenceEndType.value = 'habit';
        if (ctx.recurrenceCount) ctx.recurrenceCount.value = '';
        if (ctx.recurrenceEndDate) {
            ctx.recurrenceEndDate.value = '';
            // 同步清掉日历内部的选中态，否则重开日历仍高亮上一次的日期
            if (ctx.recurrenceEndPikaday && typeof ctx.recurrenceEndPikaday.setDate === 'function') {
                ctx.recurrenceEndPikaday.setDate(null);
            }
        }

        // 重建星期 / 日期选择器并清空已选
        this.initPickers({ clear: true });

        const today = new Date();
        if (ctx.yearlyMonth) ctx.yearlyMonth.value = String(today.getMonth() + 1);
        if (ctx.yearlyDay) ctx.yearlyDay.value = String(today.getDate());

        if (ctx.recurrenceTimes) {
            ctx.recurrenceTimes.innerHTML = '';
            this.addTimeChip('09:00');
        }
        this.clearPreview();
        this.updatePanels();
    }

    // 构建星期 / 每月日期 / 每年月日的选项（语言切换时重建，默认保留已选值）
    initPickers({ clear = false } = {}) {
        const ctx = this.ctx;
        const lang = (key, fallback) => window.languageManager.getText(key, fallback);
        const buildChips = (container, selected, items) => {
            if (!container) return;
            container.innerHTML = '';
            items.forEach(({ value, text }) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'chip-option';
                // 「最后一天」这类非数字选项独占一行横向排布，
                // 否则它会在日期网格里占一个格子并把整行文字挤到换行
                if (Number(value) < 0) chip.classList.add('chip-option--wide');
                chip.dataset.value = String(value);
                chip.textContent = text;
                chip.classList.toggle('active', !clear && selected.includes(value));
                chip.addEventListener('click', () => {
                    chip.classList.toggle('active');
                    this.clearPreview();
                });
                container.appendChild(chip);
            });
        };

        // 星期：ISO 1-7（周一 ~ 周日）
        buildChips(ctx.weeklyDays, this.getSelectedWeekdays(),
            [1, 2, 3, 4, 5, 6, 7].map((value) => ({
                value,
                text: lang(`recurrenceWeekdays.${value - 1}`,
                    ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][value - 1]),
            })));

        // 每月日期：1-31 加上「最后一天」
        const monthItems = Array.from({ length: 31 }, (_, index) => ({
            value: index + 1,
            text: String(index + 1),
        }));
        monthItems.push({ value: -1, text: lang('recurrenceLastDay', '最后一天') });
        buildChips(ctx.monthlyDays, this.getSelectedMonthDays(), monthItems);

        // 每年：月份与日期
        if (ctx.yearlyMonth) {
            const current = ctx.yearlyMonth.value;
            ctx.yearlyMonth.innerHTML = '';
            for (let month = 1; month <= 12; month += 1) {
                ctx.yearlyMonth.appendChild(
                    new Option(lang('recurrenceMonthUnit', '{month}月').replace('{month}', month), month));
            }
            if (!clear && current) ctx.yearlyMonth.value = current;
        }
        if (ctx.yearlyDay) {
            const current = ctx.yearlyDay.value;
            ctx.yearlyDay.innerHTML = '';
            for (let day = 1; day <= 31; day += 1) {
                ctx.yearlyDay.appendChild(
                    new Option(lang('recurrenceDayUnit', '{day}日').replace('{day}', day), day));
            }
            ctx.yearlyDay.appendChild(new Option(lang('recurrenceLastDay', '最后一天'), -1));
            if (!clear && current) ctx.yearlyDay.value = current;
        }
    }

    getSelectedWeekdays() {
        return [...(this.ctx.weeklyDays ? this.ctx.weeklyDays.querySelectorAll('.chip-option.active') : [])]
            .map((chip) => parseInt(chip.dataset.value, 10))
            .filter((value) => !Number.isNaN(value));
    }

    getSelectedMonthDays() {
        return [...(this.ctx.monthlyDays ? this.ctx.monthlyDays.querySelectorAll('.chip-option.active') : [])]
            .map((chip) => parseInt(chip.dataset.value, 10))
            .filter((value) => !Number.isNaN(value));
    }

    getTimes() {
        return [...(this.ctx.recurrenceTimes ? this.ctx.recurrenceTimes.querySelectorAll('input[type="time"]') : [])]
            .map((input) => input.value)
            .filter((value) => !!value);
    }

    // 新增一个提醒时间点输入项
    addTimeChip(value = '') {
        const ctx = this.ctx;
        if (!ctx.recurrenceTimes) return;
        // 每年只做单次提醒
        const max = ctx.recurrenceType && ctx.recurrenceType.value === 'yearly' ? 1 : 20;
        if (ctx.recurrenceTimes.children.length >= max) {
            this.reportError('errorRecurrenceTimesLimit');
            return;
        }

        const item = document.createElement('div');
        item.className = 'time-chip';
        const index = document.createElement('span');
        index.className = 'time-chip__index';

        const input = document.createElement('input');
        input.type = 'time';
        input.step = '60';
        input.className = 'time-chip__input';
        input.value = value;
        input.addEventListener('change', () => this.clearPreview());

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--colorless time-chip__remove';
        remove.textContent = '×';
        remove.title = window.languageManager.getText('delete', '删除');
        remove.addEventListener('click', () => {
            item.remove();
            // 至少保留一个输入项，避免用户无从填写
            if (!ctx.recurrenceTimes.children.length) this.addTimeChip();
            this.refreshTimeChipIndexes();
            this.clearPreview();
        });

        item.append(index, input, remove);
        ctx.recurrenceTimes.appendChild(item);
        this.refreshTimeChipIndexes();
    }

    // 刷新提醒时间点的序号（删除后保持连续）
    refreshTimeChipIndexes() {
        const children = this.ctx.recurrenceTimes ? this.ctx.recurrenceTimes.children : [];
        [...children].forEach((chip, position) => {
            const badge = chip.querySelector('.time-chip__index');
            if (badge) badge.textContent = String(position + 1);
        });
    }

    // 按当前模式 / 周期显示对应的配置项
    updatePanels() {
        const ctx = this.ctx;
        const show = (element, visible) => {
            if (element) element.style.display = visible ? '' : 'none';
        };
        const isCron = !!(ctx.recurrenceModeCron && ctx.recurrenceModeCron.checked);
        const freq = ctx.recurrenceType ? ctx.recurrenceType.value : undefined;
        const isDailyInterval = !isCron && freq === 'daily'
            && !!(ctx.dailyModeInterval && ctx.dailyModeInterval.checked);
        const isDailyTimes = !isCron && freq === 'daily' && !isDailyInterval;

        show(ctx.recurrenceNormalPanel, !isCron);
        show(ctx.recurrenceCronPanel, isCron);

        show(ctx.dailyModeGroup, !isCron && freq === 'daily');
        show(ctx.dailyIntervalGroup, isDailyInterval);
        show(ctx.weeklyGroup, !isCron && freq === 'weekly');
        show(ctx.monthlyGroup, !isCron && freq === 'monthly');
        show(ctx.yearlyGroup, !isCron && freq === 'yearly');
        // 时间点：每天-指定时间点 / 每周 / 每月 / 每年
        show(ctx.recurrenceTimesGroup,
            isDailyTimes || (!isCron && ['weekly', 'monthly', 'yearly'].includes(freq)));

        // 每年只保留一个时间点
        if (freq === 'yearly' && ctx.recurrenceTimes && ctx.recurrenceTimes.children.length > 1) {
            [...ctx.recurrenceTimes.children].slice(1).forEach((child) => child.remove());
        }

        const endType = (ctx.recurrenceEndType && ctx.recurrenceEndType.value) || 'habit';
        show(ctx.recurrenceCountGroup, endType === 'count');
        show(ctx.recurrenceEndDateGroup, endType === 'date');
        // 面板隐藏时收起日历，避免浮层残留在页面上
        if (endType !== 'date' && ctx.recurrenceEndPikaday && typeof ctx.recurrenceEndPikaday.hide === 'function') {
            ctx.recurrenceEndPikaday.hide();
        }
        // 习惯：只保留一条待办，完成后才续建，因此不需要次数 / 结束日期
        show(ctx.recurrenceHabitHint, endType === 'habit');

        // 同步分段控件的选中态（不依赖 CSS :has，兼容旧版内核）
        document.querySelectorAll('.segmented .segmented-item').forEach((item) => {
            item.classList.toggle('active', !!item.querySelector('input[type="radio"]')?.checked);
        });

        this.clearPreview();
    }

    // 收集当前表单上的周期规则
    collectRule() {
        const ctx = this.ctx;
        const isCron = !!(ctx.recurrenceModeCron && ctx.recurrenceModeCron.checked);
        const endType = (ctx.recurrenceEndType && ctx.recurrenceEndType.value) || 'habit';
        const rule = {
            mode: isCron ? 'cron' : 'normal',
            endType,
            count: endType === 'count'
                ? (parseInt(ctx.recurrenceCount ? ctx.recurrenceCount.value : '', 10) || null) : null,
            endDate: endType === 'date' ? ((ctx.recurrenceEndDate && ctx.recurrenceEndDate.value) || null) : null,
        };

        if (isCron) {
            rule.cron = ((ctx.recurrenceCron && ctx.recurrenceCron.value) || '').trim();
            return rule;
        }

        return Object.assign(rule, {
            freq: (ctx.recurrenceType && ctx.recurrenceType.value) || null,
            dailyMode: ctx.dailyModeInterval && ctx.dailyModeInterval.checked ? 'interval' : 'times',
            times: this.getTimes(),
            intervalStart: (ctx.dailyIntervalStart && ctx.dailyIntervalStart.value) || null,
            intervalEnd: (ctx.dailyIntervalEnd && ctx.dailyIntervalEnd.value) || null,
            intervalMinutes: parseInt(ctx.dailyIntervalMinutes ? ctx.dailyIntervalMinutes.value : '', 10) || null,
            weekdays: this.getSelectedWeekdays(),
            monthDays: this.getSelectedMonthDays(),
            yearlyMonth: ctx.yearlyMonth && ctx.yearlyMonth.value
                ? parseInt(ctx.yearlyMonth.value, 10) : null,
            yearlyDay: ctx.yearlyDay && ctx.yearlyDay.value !== '' && ctx.yearlyDay.value !== undefined
                ? parseInt(ctx.yearlyDay.value, 10) : null,
        });
    }

    // 校验周期规则，返回错误文案的 i18n key（通过时返回 null）
    validateRule(rule) {
        if (rule.mode === 'cron') {
            return rule.cron ? null : 'errorRecurrenceCronRequired';
        }
        if (!rule.freq) return 'errorRecurrenceTypeRequired';

        if (rule.freq === 'daily') {
            if (rule.dailyMode === 'interval') {
                if (!rule.intervalStart || !rule.intervalEnd) return 'errorRecurrenceIntervalRequired';
                if (rule.intervalEnd <= rule.intervalStart) return 'errorRecurrenceIntervalOrder';
                if (!(rule.intervalMinutes >= 1 && rule.intervalMinutes <= 1440)) {
                    return 'errorRecurrenceIntervalMinutes';
                }
            } else if (!rule.times.length) {
                return 'errorRecurrenceTimesRequired';
            }
        } else if (rule.freq === 'weekly') {
            if (!rule.weekdays.length) return 'errorRecurrenceWeekdaysRequired';
            if (!rule.times.length) return 'errorRecurrenceTimesRequired';
        } else if (rule.freq === 'monthly') {
            if (!rule.monthDays.length) return 'errorRecurrenceMonthDaysRequired';
            if (!rule.times.length) return 'errorRecurrenceTimesRequired';
        } else if (rule.freq === 'yearly') {
            if (!rule.yearlyMonth || rule.yearlyDay === null) return 'errorRecurrenceYearlyRequired';
            if (!rule.times.length) return 'errorRecurrenceTimesRequired';
        }

        if (rule.endType === 'count' && (!rule.count || rule.count < 1)) return 'errorRecurrenceCountRequired';
        if (rule.endType === 'date' && !rule.endDate) return 'errorRecurrenceEndDateRequired';
        return null;
    }

    // 弹出周期规则相关提示（文案表见 RecurrenceController.ERROR_MESSAGES）
    reportError(errorKey) {
        Utils.showToast(
            window.languageManager.getText(errorKey, RecurrenceController.ERROR_MESSAGES[errorKey]),
            'warning'
        );
    }

    // 校验并在失败时弹出提示：返回 true 表示校验通过
    // 文案表由本控制器统一维护，调用方（预览、表单提交）无需各自拼装提示
    validateAndReport(rule = this.collectRule()) {
        const errorKey = this.validateRule(rule);
        if (!errorKey) return true;
        this.reportError(errorKey);
        return false;
    }

    clearPreview() {
        if (!this.ctx.recurrencePreview) return;
        this.ctx.recurrencePreview.style.display = 'none';
        this.ctx.recurrencePreview.innerHTML = '';
    }

    // 预览周期规则接下来会产生的提醒时间
    async preview() {
        const rule = this.collectRule();
        if (!this.validateAndReport(rule)) return;
        await Api.tasks.previewRecurring({
            apiArgs: [this.getTodayISO(), rule, 10],
            onSuccess: (response) => {
                const occurrences = response.data || [];
                const preview = this.ctx.recurrencePreview;
                if (!preview) return;

                if (!occurrences.length) {
                    preview.textContent = window.languageManager.getText('recurrencePreviewEmpty',
                        '当前规则没有匹配到提醒时间，请调整配置');
                    preview.style.display = 'block';
                    return;
                }

                // 习惯类任务每次只保留一条待办，预览只展示首次提醒
                const title = rule.endType === 'habit'
                    ? window.languageManager.getText('recurrencePreviewHabitTitle', '首次提醒时间：')
                    : window.languageManager.getText('recurrencePreviewTitle', '接下来 10 次提醒：');
                const items = occurrences
                    .map((iso) => `<li>${iso.slice(0, 16).replace('T', ' ')}</li>`)
                    .join('');
                const footer = rule.endType === 'habit'
                    ? `<div class="recurrence-preview__hint">${window.languageManager.getText(
                        'recurrenceHabitHint', '每次只保留一条待办，完成后才按周期生成下一条')}</div>`
                    : '';
                preview.innerHTML =
                    `<div class="recurrence-preview__title">${title}</div><ul>${items}</ul>${footer}`;
                preview.style.display = 'block';
            }
        });
    }

    // 为编辑模式添加周期性任务提示
    addEditNotice() {
        const recurringSection = document.querySelector('.recurring-options')?.parentElement;
        if (recurringSection) {
            // 检查是否已有提示
            let notice = recurringSection.querySelector('.edit-notice');
            if (!notice) {
                notice = document.createElement('div');
                notice.className = 'edit-notice';
                notice.innerHTML = `⚠️ ${window.languageManager.getText('recurringEditNotice', '非周期性任务编辑模式下不支持改周期性任务')}`;

                // 插入到周期性选项区域之前
                recurringSection.insertBefore(notice, this.ctx.recurringOptions);
            }
        }
    }

    // 移除编辑模式提示
    removeEditNotice() {
        const notice = document.querySelector('.edit-notice');
        if (notice) notice.remove();
    }

    // 当前时间设置模式：once（单次带截止时间） / recurring（周期性任务）
    getScheduleMode() {
        return this.ctx.scheduleModeRecurring && this.ctx.scheduleModeRecurring.checked ? 'recurring' : 'once';
    }

    // 周期起始日期：规则里已包含完整周期配置，默认从今天开始，无需用户填写
    getTodayISO() {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    // 切换「单次任务 / 周期性任务」：两者并列互斥，切换后只展示对应配置
    updateScheduleMode() {
        const ctx = this.ctx;
        const isRecurring = this.getScheduleMode() === 'recurring';
        // 容器本身是纵向 flex（分区之间有间距），这里显式还原为 flex 而非 block
        ctx.recurringOptions.style.display = isRecurring ? 'flex' : 'none';
        // 周期性任务的提醒时间完全由规则决定，日期与时间都不再需要
        const datetimeInputs = document.getElementById('datetime-inputs');
        if (datetimeInputs) datetimeInputs.style.display = isRecurring ? 'none' : '';
        ctx.datePicker.required = false;
        ctx.timeInput.required = false;
        // 分段控件选中态由 CSS :has 之外的 class 维护（兼容旧内核）
        document.querySelectorAll('#schedule-mode-switch .segmented-item').forEach((item) => {
            item.classList.toggle('active', !!item.querySelector('input[type="radio"]')?.checked);
        });
        if (isRecurring) this.updatePanels();
    }
}

// ===== 周期规则校验提示文案（i18n key → 中文默认值）=====
// 采用类上赋值而非 static 字段，兼容较老的 WebView；仅供本控制器的
// reportError / validateAndReport 使用，外部不要再直接引用。
RecurrenceController.ERROR_MESSAGES = {
    errorRecurrenceTypeRequired: '请选择重复周期',
    errorRecurrenceCronRequired: '请输入 Cron 表达式',
    errorRecurrenceTimesRequired: '请至少添加一个提醒时间点',
    errorRecurrenceWeekdaysRequired: '请至少选择一个星期',
    errorRecurrenceMonthDaysRequired: '请至少选择一个日期',
    errorRecurrenceYearlyRequired: '请选择有效的月份和日期',
    errorRecurrenceIntervalRequired: '请填写完整的时间段',
    errorRecurrenceIntervalOrder: '时间段结束时间需晚于开始时间',
    errorRecurrenceIntervalMinutes: '间隔分钟需在 1-1440 之间',
    errorRecurrenceCountRequired: '请输入有效的循环次数',
    errorRecurrenceEndDateRequired: '请选择有效的结束日期',
    errorRecurrenceTimesLimit: '提醒时间点数量已达上限',
};

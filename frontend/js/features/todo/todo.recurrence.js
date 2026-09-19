/**
 * 任务管理 - 周期性任务规则编辑器（mixin）
 * 依赖：todo.js（TodoManager 类），须在 todo.js 之后加载
 */

Object.assign(TodoManager.prototype, {
    // ============ 周期性任务规则配置 ============

    // 重置周期规则的全部控件到默认状态
    resetRecurrenceConfig() {
        if (this.recurrenceModeNormal) this.recurrenceModeNormal.checked = true;
        if (this.recurrenceModeCron) this.recurrenceModeCron.checked = false;
        if (this.recurrenceType) this.recurrenceType.value = '';
        if (this.dailyModeTimes) this.dailyModeTimes.checked = true;
        if (this.dailyModeInterval) this.dailyModeInterval.checked = false;
        if (this.dailyIntervalStart) this.dailyIntervalStart.value = '09:00';
        if (this.dailyIntervalEnd) this.dailyIntervalEnd.value = '18:00';
        if (this.dailyIntervalMinutes) this.dailyIntervalMinutes.value = '60';
        if (this.recurrenceCron) this.recurrenceCron.value = '';
        // 默认「习惯」：只保留一条待办，避免一次创建大量任务
        if (this.recurrenceEndType) this.recurrenceEndType.value = 'habit';
        if (this.recurrenceCount) this.recurrenceCount.value = '';
        if (this.recurrenceEndDate) {
            this.recurrenceEndDate.value = '';
            // 同步清掉日历内部的选中态，否则重开日历仍高亮上一次的日期
            this.recurrenceEndPikaday?.setDate?.(null);
        }

        // 重建星期 / 日期选择器并清空已选
        this.initRecurrencePickers({ clear: true });

        const today = new Date();
        if (this.yearlyMonth) this.yearlyMonth.value = String(today.getMonth() + 1);
        if (this.yearlyDay) this.yearlyDay.value = String(today.getDate());

        if (this.recurrenceTimes) {
            this.recurrenceTimes.innerHTML = '';
            this.addRecurrenceTimeChip('09:00');
        }
        this.clearRecurrencePreview();
        this.updateRecurrencePanels();
    },

    // 构建星期 / 每月日期 / 每年月日的选项（语言切换时重建，默认保留已选值）
    initRecurrencePickers({ clear = false } = {}) {
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
                    this.clearRecurrencePreview();
                });
                container.appendChild(chip);
            });
        };

        // 星期：ISO 1-7（周一 ~ 周日）
        buildChips(this.weeklyDays, this.getSelectedWeekdays(),
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
        buildChips(this.monthlyDays, this.getSelectedMonthDays(), monthItems);

        // 每年：月份与日期
        if (this.yearlyMonth) {
            const current = this.yearlyMonth.value;
            this.yearlyMonth.innerHTML = '';
            for (let month = 1; month <= 12; month += 1) {
                this.yearlyMonth.appendChild(
                    new Option(lang('recurrenceMonthUnit', '{month}月').replace('{month}', month), month));
            }
            if (!clear && current) this.yearlyMonth.value = current;
        }
        if (this.yearlyDay) {
            const current = this.yearlyDay.value;
            this.yearlyDay.innerHTML = '';
            for (let day = 1; day <= 31; day += 1) {
                this.yearlyDay.appendChild(
                    new Option(lang('recurrenceDayUnit', '{day}日').replace('{day}', day), day));
            }
            this.yearlyDay.appendChild(new Option(lang('recurrenceLastDay', '最后一天'), -1));
            if (!clear && current) this.yearlyDay.value = current;
        }
    },

    getSelectedWeekdays() {
        return [...(this.weeklyDays?.querySelectorAll('.chip-option.active') || [])]
            .map((chip) => parseInt(chip.dataset.value, 10))
            .filter((value) => !Number.isNaN(value));
    },

    getSelectedMonthDays() {
        return [...(this.monthlyDays?.querySelectorAll('.chip-option.active') || [])]
            .map((chip) => parseInt(chip.dataset.value, 10))
            .filter((value) => !Number.isNaN(value));
    },

    getRecurrenceTimes() {
        return [...(this.recurrenceTimes?.querySelectorAll('input[type="time"]') || [])]
            .map((input) => input.value)
            .filter((value) => !!value);
    },

    // 新增一个提醒时间点输入项
    addRecurrenceTimeChip(value = '') {
        if (!this.recurrenceTimes) return;
        // 每年只做单次提醒
        const max = this.recurrenceType?.value === 'yearly' ? 1 : 20;
        if (this.recurrenceTimes.children.length >= max) {
            Utils.showToast(window.languageManager.getText('errorRecurrenceTimesLimit',
                RECURRENCE_ERROR_MESSAGES.errorRecurrenceTimesLimit), 'warning');
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
        input.addEventListener('change', () => this.clearRecurrencePreview());

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--colorless time-chip__remove';
        remove.textContent = '×';
        remove.title = window.languageManager.getText('delete', '删除');
        remove.addEventListener('click', () => {
            item.remove();
            // 至少保留一个输入项，避免用户无从填写
            if (!this.recurrenceTimes.children.length) this.addRecurrenceTimeChip();
            this.refreshTimeChipIndexes();
            this.clearRecurrencePreview();
        });

        item.append(index, input, remove);
        this.recurrenceTimes.appendChild(item);
        this.refreshTimeChipIndexes();
    },

    // 刷新提醒时间点的序号（删除后保持连续）
    refreshTimeChipIndexes() {
        [...(this.recurrenceTimes?.children || [])].forEach((chip, position) => {
            const badge = chip.querySelector('.time-chip__index');
            if (badge) badge.textContent = String(position + 1);
        });
    },

    // 按当前模式 / 周期显示对应的配置项
    updateRecurrencePanels() {
        const show = (element, visible) => {
            if (element) element.style.display = visible ? '' : 'none';
        };
        const isCron = !!this.recurrenceModeCron?.checked;
        const freq = this.recurrenceType?.value;
        const isDailyInterval = !isCron && freq === 'daily' && !!this.dailyModeInterval?.checked;
        const isDailyTimes = !isCron && freq === 'daily' && !isDailyInterval;

        show(this.recurrenceNormalPanel, !isCron);
        show(this.recurrenceCronPanel, isCron);

        show(this.dailyModeGroup, !isCron && freq === 'daily');
        show(this.dailyIntervalGroup, isDailyInterval);
        show(this.weeklyGroup, !isCron && freq === 'weekly');
        show(this.monthlyGroup, !isCron && freq === 'monthly');
        show(this.yearlyGroup, !isCron && freq === 'yearly');
        // 时间点：每天-指定时间点 / 每周 / 每月 / 每年
        show(this.recurrenceTimesGroup,
            isDailyTimes || (!isCron && ['weekly', 'monthly', 'yearly'].includes(freq)));

        // 每年只保留一个时间点
        if (freq === 'yearly' && this.recurrenceTimes?.children.length > 1) {
            [...this.recurrenceTimes.children].slice(1).forEach((child) => child.remove());
        }

        const endType = this.recurrenceEndType?.value || 'habit';
        show(this.recurrenceCountGroup, endType === 'count');
        show(this.recurrenceEndDateGroup, endType === 'date');
        // 面板隐藏时收起日历，避免浮层残留在页面上
        if (endType !== 'date') this.recurrenceEndPikaday?.hide?.();
        // 习惯：只保留一条待办，完成后才续建，因此不需要次数 / 结束日期
        show(this.recurrenceHabitHint, endType === 'habit');

        // 同步分段控件的选中态（不依赖 CSS :has，兼容旧版内核）
        document.querySelectorAll('.segmented .segmented-item').forEach((item) => {
            item.classList.toggle('active', !!item.querySelector('input[type="radio"]')?.checked);
        });

        this.clearRecurrencePreview();
    },

    // 收集当前表单上的周期规则
    collectRecurrenceRule() {
        const isCron = !!this.recurrenceModeCron?.checked;
        const endType = this.recurrenceEndType?.value || 'habit';
        const rule = {
            mode: isCron ? 'cron' : 'normal',
            endType,
            count: endType === 'count' ? (parseInt(this.recurrenceCount?.value, 10) || null) : null,
            endDate: endType === 'date' ? (this.recurrenceEndDate?.value || null) : null,
        };

        if (isCron) {
            rule.cron = (this.recurrenceCron?.value || '').trim();
            return rule;
        }

        return Object.assign(rule, {
            freq: this.recurrenceType?.value || null,
            dailyMode: this.dailyModeInterval?.checked ? 'interval' : 'times',
            times: this.getRecurrenceTimes(),
            intervalStart: this.dailyIntervalStart?.value || null,
            intervalEnd: this.dailyIntervalEnd?.value || null,
            intervalMinutes: parseInt(this.dailyIntervalMinutes?.value, 10) || null,
            weekdays: this.getSelectedWeekdays(),
            monthDays: this.getSelectedMonthDays(),
            yearlyMonth: this.yearlyMonth?.value ? parseInt(this.yearlyMonth.value, 10) : null,
            yearlyDay: this.yearlyDay?.value !== '' && this.yearlyDay?.value !== undefined
                ? parseInt(this.yearlyDay.value, 10) : null,
        });
    },

    // 校验周期规则，返回错误文案的 i18n key（通过时返回 null）
    validateRecurrenceRule(rule) {
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
    },

    clearRecurrencePreview() {
        if (!this.recurrencePreview) return;
        this.recurrencePreview.style.display = 'none';
        this.recurrencePreview.innerHTML = '';
    },

    // 预览周期规则接下来会产生的提醒时间
    async previewRecurrence() {
        const rule = this.collectRecurrenceRule();
        const errorKey = this.validateRecurrenceRule(rule);
        if (errorKey) {
            Utils.showToast(window.languageManager.getText(errorKey, RECURRENCE_ERROR_MESSAGES[errorKey]), 'warning');
            return;
        }
        await Utils.apiCall({
            apiMethod: 'preview_recurring_occurrences',
            apiArgs: [this.getTodayISO(), rule, 10],
            onSuccess: (response) => {
                const occurrences = response.data || [];
                const preview = this.recurrencePreview;
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
    },
    
    // 展开"更多选项"（用于让自动填充的父任务等字段对用户可见）
    expandMoreOptions() {
        this.moreOptionsContent.style.display = 'block';
        this.moreOptionsToggle.classList.add('expanded');
        const toggleIcon = this.moreOptionsToggle.querySelector('.toggle-icon');
        if (toggleIcon) toggleIcon.textContent = '-';
    },

    // 为编辑模式添加周期性任务提示
    addRecurringEditNotice() {
        const recurringSection = document.querySelector('.recurring-options')?.parentElement;
        if (recurringSection) {
            // 检查是否已有提示
            let notice = recurringSection.querySelector('.edit-notice');
            if (!notice) {
                notice = document.createElement('div');
                notice.className = 'edit-notice';
                notice.innerHTML = `⚠️ ${window.languageManager.getText('recurringEditNotice', '非周期性任务编辑模式下不支持改周期性任务')}`;
                
                // 插入到周期性选项区域之前
                recurringSection.insertBefore(notice, this.recurringOptions);
            }
        }
    },
    
    // 移除编辑模式提示
    removeRecurringEditNotice() {
        const notice = document.querySelector('.edit-notice');
        if (notice) notice.remove();
    },
    
    // 当前时间设置模式：once（单次带截止时间） / recurring（周期性任务）
    getScheduleMode() {
        return this.scheduleModeRecurring?.checked ? 'recurring' : 'once';
    },

    // 周期起始日期：规则里已包含完整周期配置，默认从今天开始，无需用户填写
    getTodayISO() {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    },

    // 切换「单次任务 / 周期性任务」：两者并列互斥，切换后只展示对应配置
    updateScheduleMode() {
        const isRecurring = this.getScheduleMode() === 'recurring';
        // 容器本身是纵向 flex（分区之间有间距），这里显式还原为 flex 而非 block
        this.recurringOptions.style.display = isRecurring ? 'flex' : 'none';
        // 周期性任务的提醒时间完全由规则决定，日期与时间都不再需要
        const datetimeInputs = document.getElementById('datetime-inputs');
        if (datetimeInputs) datetimeInputs.style.display = isRecurring ? 'none' : '';
        this.datePicker.required = false;
        this.timeInput.required = false;
        // 分段控件选中态由 CSS :has 之外的 class 维护（兼容旧内核）
        document.querySelectorAll('#schedule-mode-switch .segmented-item').forEach((item) => {
            item.classList.toggle('active', !!item.querySelector('input[type="radio"]')?.checked);
        });
        if (isRecurring) this.updateRecurrencePanels();
    },
});
/**
 * 语言管理器 - 各业务界面的 DOM 文案刷新（mixin）
 * 依赖：language.js（LanguageManager 类）
 *
 * 说明：设置面板文案的唯一刷新入口是本文件的 updateSettings，
 * settings.js 不再维护重复的刷新逻辑；主题配色区等由 JS 动态渲染的文案，
 * 在 DOM 允许时委托 settingsManager 一并重建。
 */

Object.assign(LanguageManager.prototype, {

    // 更新页面标题
    updatePageTitle(lang) {
        document.title = lang.appTitle;
    },

    // 更新主界面文本
    updateMainInterface(lang) {
        // 应用标题
        const appTitle = document.querySelector('.app-title');
        if (appTitle) appTitle.textContent = lang.appTitle;

        // 设置按钮
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) settingsBtn.title = lang.settingsBtn;

        // 统计信息标签
        const statLabels = document.querySelectorAll('.stat-label');
        if (statLabels.length >= 4) {
            statLabels[0].textContent = lang.statsUnCompletedTasks;
            statLabels[1].textContent = lang.statsTodayCompletedTasks;
            statLabels[2].textContent = lang.statsCompletionRate;
            statLabels[3].textContent = lang.statsOverDueDateTasks;
        }

        // 分类标题
        const categoriesTitle = document.querySelector('.categories-section .categories-section-title');
        if (categoriesTitle) categoriesTitle.textContent = lang.categories;

        // 全部分类选项
        const allCategories = document.querySelector('.category-item-btn #allCategories');
        if (allCategories) allCategories.textContent = lang.allCategories;

        // 无分类
        const uncategorized = document.querySelector('#task-category option');
        if (uncategorized) uncategorized.textContent = lang.uncategorized;

        // 添加分类按钮
        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) addCategoryBtn.textContent = lang.addCategory;

        // 展示更多按钮
        const moreCategories = document.getElementById('categories-more');
        if (moreCategories) moreCategories.textContent = lang.showMoreCategories;

        // 搜索框占位符
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.title = lang.searchTitle;

        // 搜索清空按钮
        const searchClearBtn = document.getElementById('search-clear-btn');
        if (searchClearBtn) {
            searchClearBtn.title = lang.searchClear;
            // 清空按钮提示会随当前可分层的搜索条件变化，交回搜索模块按当前语言重算
            if (window.todoManager && window.todoManager.updateSearchClearButton) {
                window.todoManager.updateSearchClearButton();
            }
        }

        // 搜索栏的截止时间筛选按钮
        const searchDueBtn = document.getElementById('search-due-btn');
        if (searchDueBtn && lang.searchDueDate) searchDueBtn.title = lang.searchDueDate;

        // 重建搜索 chips：截止时间 chip 的"截止/Due"前缀需要跟随语言
        if (window.todoManager && window.todoManager.searchChips.length > 0) {
            window.todoManager.renderSearchChips();
        }

        // 筛选器选项
        this.updateFilterOptions(lang);

        // 添加任务按钮
        const addTaskBtn = document.getElementById('add-task-btn');
        if (addTaskBtn) addTaskBtn.textContent = `+ ${lang.newTask}`;

        // 移动端悬浮按钮
        const addTaskFab = document.getElementById('add-task-fab');
        if (addTaskFab) addTaskFab.title = lang.newTask;

        // 空状态文本
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            const emptyH3 = emptyState.querySelector('h3');
            const emptyP = emptyState.querySelector('p');
            if (emptyH3) emptyH3.textContent = lang.emptyTasks;
            if (emptyP) emptyP.textContent = lang.emptyTasksMessage;
        }

        // 设置任务列表表头
        const headerRow = document.querySelector('.tasks-header-row');
        if (headerRow) {
            const options = headerRow.querySelectorAll('.tasks-header-cell');
            if (options.length >= 5) {
                options[0].textContent = lang.taskHeaderName;
                options[1].textContent = lang.taskHeaderPriority;
                options[2].textContent = lang.taskHeaderDueDate;
                options[3].textContent = lang.taskHeaderTag;
            }
            const actionOption = headerRow.querySelectorAll('.tasks-header-cell .tasks-header-label');
            actionOption.textContent = lang.taskHeaderAction;
        }

        // 设置任务列表优先级列
        const taskPriorityHigh = document.querySelectorAll('.task-priority.high');
        taskPriorityHigh.forEach(element => {
            element.textContent = `🔴 ${lang.high}`;
        });
        const taskPriorityMedium = document.querySelectorAll('.task-priority.medium');
        taskPriorityMedium.forEach(element => {
            element.textContent = `🟡 ${lang.medium}`;
        });
        const taskPriorityLow = document.querySelectorAll('.task-priority.low');
        taskPriorityLow.forEach(element => {
            element.textContent = `🟢 ${lang.low}`;
        });
        const taskPriorityNone = document.querySelectorAll('.task-priority.none');
        taskPriorityNone.forEach(element => {
            element.textContent = `⚪ ${lang.none}`;
        });

        // 设置任务列表操作列提示语
        document.querySelectorAll('.btn.edit').forEach(btn => {
            if (btn.disabled) {
                btn.title = lang.recurringTaskEditTip;
            } else {
                btn.title = lang.normalTaskEditTip;
            }
        });
        document.querySelectorAll('.btn.view').forEach(btn => {
            btn.title = lang.taskViewTip;
        });
        document.querySelectorAll('.btn.delete').forEach(btn => {
            btn.title = lang.taskDeleteTip;
        });

        // 分页文本
        this.updatePagination(lang);

        // 联系作者
        const contactAuthor = document.querySelector('.contact-text');
        if (contactAuthor) contactAuthor.textContent = lang.contactAuthor;

        // 标签标题（含分隔符，中文用全角冒号，英文用半角冒号）
        const tags = document.getElementById('tags-title');
        if (tags) tags.textContent = lang.taskTags;

        // 标签末尾的展开更多/更少标识跟随语言刷新
        window.tagManager?.renderMoreIndicator();
    },

    // 更新筛选器选项
    updateFilterOptions(lang) {
        // 视图
        const viewSelect = document.getElementById('view-toggle-select');
        const viewOptions = viewSelect?.querySelectorAll('option');
        if (viewOptions.length >= 4) {
            viewOptions[0].textContent = `📋 ${lang.listView}`;
            viewOptions[1].textContent = `📅 ${lang.calendarView}`;
            viewOptions[2].textContent = `⌛ ${lang.timelineView}`;
            viewOptions[3].textContent = `📊 ${lang.statsView}`;
        }

        // 小屏更多菜单的视图切换项
        const moreMenuViewTexts = document.querySelectorAll('.more-menu-text[data-view-text]');
        const moreMenuViewLabels = {
            list: lang.listView,
            calendar: lang.calendarView,
            timeline: lang.timelineView,
            stats: lang.statsView
        };
        moreMenuViewTexts.forEach(textEl => {
            const label = moreMenuViewLabels[textEl.dataset.viewText];
            if (label) textEl.textContent = label;
        });

        // 优先级筛选器
        const priorityFilter = document.getElementById('priority-filter');
        const priorityOptions = priorityFilter?.querySelectorAll('option');
        if (priorityOptions.length >= 5) {
            priorityOptions[0].textContent = lang.filterPriority;
            priorityOptions[1].textContent = `🔴 ${lang.priorityHigh}`;
            priorityOptions[2].textContent = `🟡 ${lang.priorityMedium}`;
            priorityOptions[3].textContent = `🟢 ${lang.priorityLow}`;
            priorityOptions[4].textContent = `⚪ ${lang.priorityNone}`;
        }

        // 状态筛选器
        const statusFilter = document.getElementById('status-filter');
        const statusOptions = statusFilter?.querySelectorAll('option');
        if (statusOptions.length >= 5) {
            statusOptions[0].textContent = lang.filterStatus;
            statusOptions[1].textContent = lang.statusCompleted;
            statusOptions[2].textContent = lang.statusUncompleted;
            statusOptions[3].textContent = lang.statusPending;
            statusOptions[4].textContent = lang.statusOverdue;
        }

        // 截止日期筛选器
        const dueDateFilter = document.getElementById('due-date-filter');
        const dueDateOptions = dueDateFilter?.querySelectorAll('option');
        if (dueDateOptions.length >= 6) {
            dueDateOptions[0].textContent = lang.dueDateAll;
            dueDateOptions[1].textContent = lang.dueDateToday;
            dueDateOptions[2].textContent = lang.dueDateTomorrow;
            dueDateOptions[3].textContent = lang.dueDateWeek;
            dueDateOptions[4].textContent = lang.dueDateMonth;
            dueDateOptions[5].textContent = lang.dueDateNoDueDate;
        }
    },

    // 更新分页文本
    updatePagination(lang) {
        const paginationInfo = document.getElementById('pagination-showing');
        if (paginationInfo) {
            // 分页信息会在任务加载时动态更新，这里只更新静态文本
            const currentText = paginationInfo.textContent;
            const match = currentText.match(/(\d+)-(\d+).*?(\d+)/);
            if (match) {
                const [, start, end, total] = match;
                paginationInfo.textContent = `${lang.paginationShowing} ${start}-${end} ${lang.paginationOf} ${total} ${lang.paginationItems}`;
            }
        }

        // 分页按钮
        const firstBtn = document.getElementById('pagination-first');
        const prevBtn = document.getElementById('pagination-prev');
        const nextBtn = document.getElementById('pagination-next');
        const lastBtn = document.getElementById('pagination-last');

        if (firstBtn) firstBtn.textContent = lang.paginationFirst;
        if (prevBtn) prevBtn.textContent = lang.paginationPrev;
        if (nextBtn) nextBtn.textContent = lang.paginationNext;
        if (lastBtn) lastBtn.textContent = lang.paginationLast;

        // 每页显示数量选择器
        const pageSizeSelect = document.getElementById('page-size-select');
        const options = pageSizeSelect?.querySelectorAll('option');
        options.forEach(option => {
            const value = option.value;
            option.textContent = `${value} ${lang.paginationItems}/${lang.paginationPage}`;
        });
    },

    // 更新模态框文本
    updateModals(lang) {
        // 任务模态框
        const modalTitle = document.getElementById('modal-title');
        if (modalTitle) {
            const isEditMode = modalTitle.textContent.includes('编辑');
            modalTitle.textContent = isEditMode ? lang.editTask : lang.newTask;
        }

        // 任务表单标签
        const formLabels = document.querySelectorAll('.task-form label');
        formLabels.forEach(label => {
            const forAttr = label.getAttribute('for');
            switch (forAttr) {
                case 'task-title':
                    label.textContent = `${lang.taskTitle}*`;
                    break;
                case 'task-description':
                    label.innerHTML = `${lang.taskDescription} <span style="color: #999; font-size: 12px;">${lang.optional}</span>`;
                    break;
                case 'task-priority':
                    label.textContent = lang.taskPriority;
                    break;
                case 'task-category':
                    label.textContent = lang.taskCategory;
                    break;
            }
        });

        // 标签选择器标签
        const tagsLabel = document.querySelector('.form-group label[for="tags-selector"]');
        if (tagsLabel) tagsLabel.innerHTML = `${lang.taskTags} <span style="color: #999; font-size: 12px;">${lang.optional}</span>`;

        // 截止日期标签（仅单次任务使用该字段）
        const dueDateLabel = document.getElementById('date-field-label');
        if (dueDateLabel) dueDateLabel.textContent = lang.taskDueDate;

        // 优先级选项
        const priorityOptions = document.querySelectorAll('#task-priority option');
        if (priorityOptions.length >= 4) {
            priorityOptions[0].textContent = `⚪ ${lang.priorityNone}`;
            priorityOptions[1].textContent = `🟢 ${lang.priorityLow}`;
            priorityOptions[2].textContent = `🟡 ${lang.priorityMedium}`;
            priorityOptions[3].textContent = `🔴 ${lang.priorityHigh}`;
        }

        // 分类选项
        const categorySelect = document.getElementById('task-category');
        const firstOption = categorySelect?.options[0];
        if (firstOption) firstOption.text = lang.uncategorized;

        // 更多选项按钮
        const moreOptionsToggle = document.getElementById('more-options-toggle');
        if (moreOptionsToggle) {
            const toggleIcon = moreOptionsToggle.querySelector('.toggle-icon');
            moreOptionsToggle.innerHTML = `<span class="toggle-icon">+</span> ${lang.moreOptions}`;
            if (toggleIcon) {
                moreOptionsToggle.querySelector('.toggle-icon').textContent = toggleIcon.textContent;
            }
        }

        // 时间设置：单次任务 / 周期性任务（并列二选一）
        const recurrenceTypeLabels = [lang.recurrenceChoose, lang.recurrenceDaily,
            lang.recurrenceWeekly, lang.recurrenceMonthly, lang.recurrenceYearly];
        document.querySelectorAll('#recurrence-type option').forEach((option, index) => {
            if (recurrenceTypeLabels[index]) option.textContent = recurrenceTypeLabels[index];
        });

        // 结束方式：习惯 / 按次数 / 按日期
        const recurrenceEndTypeLabels = [lang.recurrenceEndHabit, lang.recurrenceEndByCount,
            lang.recurrenceEndByDate];
        document.querySelectorAll('#recurrence-end-type option').forEach((option, index) => {
            if (recurrenceEndTypeLabels[index]) option.textContent = recurrenceEndTypeLabels[index];
        });

        // 周期性任务其余静态文案（id → 文案）
        const recurrenceTexts = {
            'schedule-mode-label': lang.scheduleMode,
            'schedule-mode-once-text': lang.scheduleModeOnce,
            'schedule-mode-recurring-text': lang.scheduleModeRecurring,
            'time-field-label': lang.timeLabel,
            'recurrence-habit-hint': lang.recurrenceHabitHint,
            'recurrence-mode-label': lang.recurrenceMode,
            'recurrence-mode-normal-text': lang.recurrenceModeNormal,
            'recurrence-mode-cron-text': lang.recurrenceModeCron,
            'recurrence-type-label': lang.recurrenceTypeLabel,
            'daily-mode-label': lang.recurrenceDailyMode,
            'daily-mode-times-text': lang.recurrenceDailyModeTimes,
            'daily-mode-interval-text': lang.recurrenceDailyModeInterval,
            'daily-interval-label': lang.dailyIntervalLabel,
            'daily-interval-start-label': lang.recurrenceIntervalStartShort,
            'daily-interval-end-label': lang.recurrenceIntervalEndShort,
            'daily-interval-minutes-label': lang.recurrenceIntervalMinutes,
            'recurrence-times-label': lang.recurrenceTimes,
            'recurrence-add-time': lang.recurrenceAddTime,
            'weekly-days-label': lang.recurrenceWeeklyDays,
            'weekly-days-hint': lang.recurrenceWeeklyDaysHint,
            'monthly-days-label': lang.recurrenceMonthlyDays,
            'monthly-days-hint': lang.recurrenceMonthlyDaysHint,
            'yearly-label': lang.recurrenceYearlyLabel,
            'yearly-month-label': lang.recurrenceYearlyMonth,
            'yearly-day-label': lang.recurrenceYearlyDay,
            'recurrence-cron-label': lang.recurrenceCron,
            'recurrence-cron-hint': lang.recurrenceCronHint,
            'recurrence-end-type-label': lang.recurrenceEndType,
            'recurrence-count-label': lang.recurrenceCountLabel,
            'recurrence-end-date-label': lang.recurrenceEndDate,
            'recurrence-preview-btn': lang.recurrencePreviewBtn,
        };
        Object.entries(recurrenceTexts).forEach(([id, text]) => {
            const element = document.getElementById(id);
            if (element && text) element.textContent = text;
        });

        const recurrenceCountInput = document.getElementById('recurrence-count');
        if (recurrenceCountInput) recurrenceCountInput.placeholder = lang.recurrenceCountRequired;

        // 附件
        this.updateAttachmentTexts(lang);

        // 模态框按钮
        const cancelBtn = document.getElementById('cancel-btn');
        const saveBtn = document.getElementById('save-btn');
        if (cancelBtn) cancelBtn.textContent = lang.cancel;
        if (saveBtn) saveBtn.textContent = lang.save;

        // 分类模态框
        this.updateCategoryModal(lang);

        // 确认对话框
        this.updateConfirmDialog(lang);
    },

    // 更新附件相关文本
    updateAttachmentTexts(lang) {
        // 表单附件标签（保留计数元素的现有值）
        const attachmentLabel = document.querySelector('.attachment-group label');
        if (attachmentLabel) {
            const hintEl = attachmentLabel.querySelector('span:not(.attachment-count)');
            if (hintEl) hintEl.textContent = lang.attachmentOptionalHint;
            attachmentLabel.childNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                    node.textContent = `${lang.attachment} `;
                }
            });
        }

        // 附件操作按钮
        const addFileBtn = document.getElementById('attachment-add-file-btn');
        if (addFileBtn) addFileBtn.textContent = `📎 ${lang.attachmentUploadFile}`;
        const addLinkBtn = document.getElementById('attachment-add-link-btn');
        if (addLinkBtn) addLinkBtn.textContent = `🔗 ${lang.attachmentAddLink}`;
        const addFolderBtn = document.getElementById('attachment-add-folder-btn');
        if (addFolderBtn) addFolderBtn.textContent = `📁 ${lang.attachmentAddFolder}`;

        // 在线链接弹窗
        const linkTitle = document.querySelector('#attachment-link-modal h2');
        if (linkTitle) linkTitle.textContent = lang.attachmentAddLinkTitle;
        const linkNameLabel = document.querySelector('label[for="attachment-link-name"]');
        if (linkNameLabel) {
            linkNameLabel.innerHTML = `${lang.attachmentLinkName} <span style="color: #666; font-size: 12px;">${lang.attachmentLinkNameHint}</span>`;
        }
        const linkUrlLabel = document.querySelector('label[for="attachment-link-url"]');
        if (linkUrlLabel) linkUrlLabel.textContent = `${lang.attachmentLinkUrl} *`;
        const linkCancelBtn = document.getElementById('attachment-link-cancel');
        if (linkCancelBtn) linkCancelBtn.textContent = lang.cancel;
        const linkSaveBtn = document.getElementById('attachment-link-save');
        if (linkSaveBtn) linkSaveBtn.textContent = lang.attachmentAdd;
    },

    // 更新分类模态框
    updateCategoryModal(lang) {
        const categoryModalTitle = document.getElementById('category-modal-title');
        if (categoryModalTitle) categoryModalTitle.textContent = lang.addCategory;

        const categoryLabels = document.querySelectorAll('.category-form label');
        categoryLabels.forEach(label => {
            const forAttr = label.getAttribute('for');
            switch (forAttr) {
                case 'category-name':
                    label.textContent = `${lang.categoryName} *`;
                    break;
                case 'category-color':
                    label.textContent = lang.categoryColor;
                    break;
            }
        });

        const categoryCancelBtn = document.getElementById('category-cancel-btn');
        const categorySaveBtn = document.getElementById('category-save-btn');
        if (categoryCancelBtn) categoryCancelBtn.textContent = lang.cancel;
        if (categorySaveBtn) categorySaveBtn.textContent = lang.save;
    },

    // 更新确认对话框
    updateConfirmDialog(lang) {
        const confirmTitle = document.querySelector('#confirm-dialog h2');
        if (confirmTitle && confirmTitle.textContent === '确认操作') confirmTitle.textContent = lang.confirm;

        const confirmCancelBtn = document.getElementById('confirm-cancel');
        const confirmOkBtn = document.getElementById('confirm-ok');
        if (confirmCancelBtn) confirmCancelBtn.textContent = lang.cancel;
        if (confirmOkBtn) confirmOkBtn.textContent = lang.confirm;
    },

    // 更新日历视图
    updateCalendar(lang) {
        const calendarWeekdays = document.querySelectorAll('.calendar-weekday');
        if (calendarWeekdays.length === 7) {
            calendarWeekdays.forEach((day, index) => {
                day.textContent = lang.calendarWeekdays[index];
            });
        }
    },

    // 更新设置中心（设置面板文案的唯一刷新入口）
    updateSettings(lang) {
        const settingsTitle = document.querySelector('#settings-modal h2');
        if (settingsTitle) settingsTitle.textContent = lang.settings;

        // 设置区块标题及带标记的文案统一按 data-lang-key 定位。
        // 不再使用下标（sectionTitles[0]/[1]/[2]），否则新增区块会导致后续文案串位。
        document.querySelectorAll('#settings-modal [data-lang-key], #theme-modal [data-lang-key]')
            .forEach((element) => {
                const text = lang[element.dataset.langKey];
                if (text) element.textContent = text;
            });

        // 主题配色令牌名称与入口行模式文案由 JS 动态渲染，
        // settingsManager 已初始化时委托其按新语言重建（未初始化时跳过，打开弹窗时会重建）
        window.settingsManager?.renderThemeColorRows?.();
        window.settingsManager?.syncThemeEditorState?.();

        // 窗口置顶设置
        this.setSettingItemText('window-top-toggle', lang.settingsWindowTop);

        // 中英文设置
        this.setSettingItemText('language-toggle', lang.language);

        // 自启动设置
        this.setSettingItemText('auto-start-toggle', lang.settingsAutoStart);

        // 快捷键设置
        this.setSettingItemText('shortcut-toggle', lang.settingsShortcut);

        // 数据管理
        const dataSectionTitle = document.querySelector('#settings-modal [data-lang-key="settingsData"]');
        if (dataSectionTitle) dataSectionTitle.textContent = lang.settingsData;

        // 数据共享
        const dataTransferTitle = document.querySelector('#data-transfer-modal h2');
        if (dataTransferTitle) dataTransferTitle.textContent = lang.settingsDataShare;
        this.setTextIn(document.getElementById('data-share-btn'), '.setting-text', lang.settingsDataShare);
        this.setTextIn(document.getElementById('data-sync-btn'), '.setting-text', lang.settingsDataSync);
        const shareModeText = document.querySelector('#share-mode-btn .mode-text');
        if (shareModeText) shareModeText.textContent = lang.shareMode;
        const receiveModeText = document.querySelector('#receive-mode-btn .mode-text');
        if (receiveModeText) receiveModeText.textContent = lang.receiveMode;

        const dataShareDataLabel = document.getElementById('share-mode-panel')?.querySelectorAll('h3');
        if (dataShareDataLabel && dataShareDataLabel.length >= 3) {
            dataShareDataLabel[0].textContent = lang.currentDataSummary;
            dataShareDataLabel[1].textContent = lang.shareSettings;
            dataShareDataLabel[2].textContent = lang.shareStatus;
        }

        const dataSummaryTitle = document.querySelector('#share-mode-panel h3');
        if (dataSummaryTitle) dataSummaryTitle.textContent = lang.currentDataSummary;
        const dataSummaryText = document.querySelector('#share-data-summary p');
        if (dataSummaryText) dataSummaryText.textContent = lang.loading;
        const startShareBtn = document.getElementById('start-share-btn');
        if (startShareBtn) startShareBtn.textContent = lang.startShare;
        const stopShareBtn = document.getElementById('stop-share-btn');
        if (stopShareBtn) stopShareBtn.textContent = lang.stopShare;

        const shareStatusInfo = document.getElementById('share-status')?.querySelectorAll('strong');
        if (shareStatusInfo && shareStatusInfo.length >= 3) {
            shareStatusInfo[0].textContent = lang.ipAddress;
            shareStatusInfo[1].textContent = lang.port;
            shareStatusInfo[2].textContent = lang.sharingData;
        }
        const receiveModeTitle = document.getElementById('receive-mode-panel')?.querySelectorAll('h3');
        if (receiveModeTitle && receiveModeTitle.length >= 3) {
            receiveModeTitle[0].textContent = lang.scanDevice;
            receiveModeTitle[1].textContent = lang.availableDevices;
            receiveModeTitle[2].textContent = lang.receivedDataPreview;
        }
        const scanDevicesBtn = document.getElementById('scan-devices-btn');
        if (scanDevicesBtn) scanDevicesBtn.textContent = lang.scanNetworkDevice;
        const deviceList = document.querySelector('#device-list p');
        if (deviceList) deviceList.textContent = lang.noDevicesFound;
        const waitForDataText = document.querySelector('#receive-data-summary p');
        if (waitForDataText) waitForDataText.textContent = lang.waitingForData;
        const importWarningText = document.querySelector('#import-warning p');
        if (importWarningText) importWarningText.textContent = lang.importWarning;
        const confirmImportBtn = document.getElementById('confirm-import-btn');
        if (confirmImportBtn) confirmImportBtn.textContent = lang.confirmImport;
        const cancelImportBtn = document.getElementById('cancel-import-btn');
        if (cancelImportBtn) cancelImportBtn.textContent = lang.cancelImport;

        // 数据存储
        this.setTextIn(document.querySelector('.data-storage'), '.data-label', lang.dataStoragePath);

        // 更新应用标签
        const applyLabels = document.querySelectorAll('.setting-config-btn');
        applyLabels.forEach((element, index) => {
            element.textContent = lang.settingsApply;
        });

        // 数据同步
        const dataSyncTitle = document.querySelector('#data-sync-modal h2');
        if (dataSyncTitle) dataSyncTitle.textContent = lang.settingsDataSync;
        this.setSettingItemText('webdav-enable-toggle', lang.dataSync);

        const dataSyncPanel = document.getElementById('webdav-config-panel');
        const dataSyncDataLabel = dataSyncPanel?.querySelectorAll('.data-label');
        if (dataSyncDataLabel) {
            const dataSyncLabels = [lang.syncType, lang.url, lang.account, lang.password, lang.filepath, lang.firstSyncMode];
            dataSyncLabels.forEach((text, index) => {
                if (dataSyncDataLabel[index]) dataSyncDataLabel[index].textContent = text;
            });
        }
        const firstSyncModeOptions = document.getElementById('webdav-first-sync-mode')?.querySelectorAll('option');
        if (firstSyncModeOptions && firstSyncModeOptions.length >= 2) {
            firstSyncModeOptions[0].textContent = lang.firstSyncModeRemote;
            firstSyncModeOptions[1].textContent = lang.firstSyncModeLocal;
        }
        this.setTextIn(dataSyncPanel, '.edit-notice', lang.autoSyncNotice);
        const webDavTestBtn = document.getElementById('webdav-test-btn');
        if (webDavTestBtn) webDavTestBtn.textContent = lang.testConnection;
        const webDavSaveBtn = document.getElementById('webdav-save-btn');
        if (webDavSaveBtn) webDavSaveBtn.textContent = lang.saveConfiguration;

        // 关于
        const aboutTitle = document.querySelector('#settings-modal [data-lang-key="about"]');
        if (aboutTitle) aboutTitle.textContent = lang.about;

        const aboutSection = aboutTitle?.closest('.setting-section');
        if (aboutSection) {
            const aboutOptions = aboutSection.querySelectorAll('.setting-text');
            if (aboutOptions.length >= 3) {
                aboutOptions[0].textContent = lang.sourceCode;
                aboutOptions[1].textContent = lang.document;
                aboutOptions[2].textContent = lang.statement;
            }
            const externalLinks = aboutSection.querySelectorAll('.external-link');
            if (externalLinks.length >= 3) {
                externalLinks[1].textContent = lang.documentText;
                externalLinks[2].textContent = lang.statementText;
            }
        }
    },

    // 更新日期选择器
    updateDatePicker(language) {
        if (window.todoManager && window.todoManager.pikaday) {
            const pikaday = window.todoManager.pikaday;

            if (language === 'en') {
                pikaday._o.i18n = {
                    previousMonth: 'Prev',
                    nextMonth: 'Next',
                    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
                    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                };
            } else {
                pikaday._o.i18n = {
                    previousMonth: '上个月',
                    nextMonth: '下个月',
                    months: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
                    weekdays: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
                    weekdaysShort: ['日', '一', '二', '三', '四', '五', '六']
                };
            }

            // 重新渲染日期选择器（实例可能已被销毁，失败不应影响语言切换结果）
            try {
                pikaday.draw();
            } catch (error) {
                logger.warning('重绘日期选择器失败:', error);
            }
        }
    }
});

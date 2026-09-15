/**
 * 语言管理器
 * 支持语言切换和动态更新界面文本
 */

class LanguageManager {
    constructor() {
        this.currentLanguage;
        this.isInitialized = false;
        this.observers = []; // 观察者列表，用于通知界面更新
        this.retryCount = 0;
        this.initPromise = null;    // 初始化承诺，避免构造与 DOMContentLoaded 重复初始化
        this.switchingPromise = null; // 切换中的承诺，避免快速连点造成并发切换
        
        // 等待语言配置文件加载完成后再初始化
        this.waitForLanguagesConfig().then(() => this.init());
    }
    
    // 初始化（幂等，避免并发重复执行）
    init() {
        if (this.initPromise) return this.initPromise;
        
        this.initPromise = this.doInit().catch((error) => {
            logger.error('Failed to initialize LanguageManager:', error);
            // 使用默认语言
            this.currentLanguage = this.currentLanguage || 'zh';
        });
        
        return this.initPromise;
    }
    
    // 初始化
    async doInit() {
        try {
            // 从存储中恢复语言设置
            await this.initLanguageSetting();

            // 应用当前语言设置
            await this.applyLanguage(this.currentLanguage);
            
            this.isInitialized = true;
        } catch (error) {
            logger.error('Failed to initialize LanguageManager:', error);
            // 使用默认语言
            this.currentLanguage = 'zh';
        }
    }
    
    // 恢复语言设置
    async initLanguageSetting() {
        let language = localStorage.getItem('todolist_language');
        if (language) {
            this.currentLanguage = language;
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['language'],
            onSuccess: (response) => {
                const savedLanguage = response.data.language;
                localStorage.setItem('todolist_language', savedLanguage);
                this.currentLanguage = savedLanguage;
            },
            onError: (error) => {
                this.currentLanguage = 'zh';
            }
        });
    }
    
    // 保存语言设置（后端写入失败会抛出，交由调用方判定为切换失败）
    async saveLanguageSetting(language) {
        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['language', language],
            throwOnError: true,
            onSuccess: (response) => {
                // 写入本地缓存，保证下次启动能立即恢复用户选择
                localStorage.setItem('todolist_language', language);
            }
        });
    }
    
    // 切换语言
    switchLanguage(language) {
        // 串行化切换请求，避免快速连点导致并发写入与界面错乱
        if (this.switchingPromise) {
            return this.switchingPromise.then(() => this.switchLanguage(language));
        }
        
        this.switchingPromise = this.doSwitchLanguage(language).finally(() => {
            this.switchingPromise = null;
        });
        
        return this.switchingPromise;
    }
    
    // 切换语言实现
    async doSwitchLanguage(language) {
        if (!window.Languages || !window.Languages[language]) {
            logger.error('Language not supported:', language);
            return false;
        }
        
        if (this.currentLanguage === language) {
            return true; // 已经是目标语言
        }
        
        try {
            // 保存设置（持久化失败才是真正的切换失败）
            await this.saveLanguageSetting(language);
        } catch (error) {
            logger.error('Failed to switch language:', error);
            return false;
        }
        
        // 持久化成功即视为切换成功，后续界面刷新异常不应回滚语言
        this.currentLanguage = language;
        
        try {
            // 应用语言设置
            await this.applyLanguage(language);
        } catch (error) {
            logger.error('Failed to apply language to UI, keeping language setting:', error);
        }
        
        // 通知观察者
        this.notifyObservers();
        
        // 持久化已生效，界面也已按新语言刷新，判定为成功
        return true;
    }
    
    // 等待语言配置文件加载完成
    async waitForLanguagesConfig() {
        return new Promise((resolve) => {
            const checkConfig = () => {
                if (window.Languages && window.Languages.zh && window.Languages.en) {
                    resolve();
                } else {
                    setTimeout(checkConfig, 100);
                }
            };
            checkConfig();
        });
    }
    
    // 安全设置文本：元素不存在时静默跳过，避免因个别节点缺失中断整体刷新
    setText(el, text) {
        if (el && text !== undefined && text !== null) el.textContent = text;
    }
    
    // 在指定容器内查找目标节点并设置文本
    setTextIn(container, selector, text) {
        if (!container) return;
        this.setText(container.querySelector(selector), text);
    }
    
    // 按 id 取控件，向上找到所属设置项后更新其文本
    setSettingItemText(id, text, itemSelector = '.setting-item', textSelector = '.setting-text') {
        const control = document.getElementById(id);
        if (!control) return;
        
        this.setTextIn(control.closest(itemSelector), textSelector, text);
    }
    
    // 应用语言设置到界面
    async applyLanguage(language) {
        // 检查语言配置是否可用
        if (!window.Languages || !window.Languages.zh || !window.Languages.en) {
            logger.warning('Languages config not fully loaded yet, waiting...');
            // 等待配置加载完成
            await this.waitForLanguagesConfig();
        }
        
        // 重置重试计数器
        this.retryCount = 0;
        
        if (!window.Languages[language]) {
            logger.warning('Language not available:', language, 'falling back to zh');
            // 如果请求的语言不可用，回退到中文
            language = 'zh';
            
            // 再次检查中文是否可用
            if (!window.Languages[language]) {
                logger.error('Fallback language zh also not available');
                return;
            }
        }
        
        const lang = window.Languages[language];
        
        // 更新HTML lang属性
        document.documentElement.lang = language;
        
        // 各区块独立刷新：任一区块因 DOM 未就绪而失败时，不影响其余区块继续刷新
        const steps = [
            ['页面标题', () => this.updatePageTitle(lang)],
            ['主界面', () => this.updateMainInterface(lang)],
            ['模态框', () => this.updateModals(lang)],
            ['日历视图', () => this.updateCalendar(lang)],
            ['设置中心', () => this.updateSettings(lang)],
            ['日期选择器', () => this.updateDatePicker(language)]
        ];
        
        for (const [name, step] of steps) {
            try {
                step();
            } catch (error) {
                logger.warning(`更新${name}文本失败（已跳过该区块）:`, error);
            }
        }
    }
    
    // 更新页面标题
    updatePageTitle(lang) {
        document.title = lang.appTitle;
    }
    
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
        if (searchClearBtn) searchClearBtn.title = lang.searchClear;
        
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

        // 标签按钮
        const tags = document.getElementById('tags-text');
        if (tags) tags.textContent = lang.taskTags;
    }
    
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
    }
    
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
    }
    
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
        
        // 截止日期标签
        const dueDateLabel = document.querySelector('.datetime-group label');
        if (dueDateLabel) dueDateLabel.innerHTML = `${lang.taskDueDate} <span style="color: #666; font-size: 12px;">${lang.optional}</span>`;

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
        
        // 周期性任务选项
        const recurrenceToggle = document.getElementById('recurrence-toggle');
        if (recurrenceToggle) recurrenceToggle.textContent = lang.createRecurringTask;

        const recurrenceTypeLabel = document.querySelector('label[for="recurrence-type"]');
        if (recurrenceTypeLabel) recurrenceTypeLabel.textContent = lang.recurrenceType;

        const recurrenceCountLabel = document.querySelector('label[for="recurrence-count"]');
        if (recurrenceCountLabel) recurrenceCountLabel.textContent = lang.recurrenceCount;

        const recurrenceTypeOptions = document.querySelectorAll('#recurrence-type option');
        if (recurrenceTypeOptions.length >= 5) {
            recurrenceTypeOptions[0].textContent = lang.recurrenceChoose;
            recurrenceTypeOptions[1].textContent = lang.recurrenceDaily;
            recurrenceTypeOptions[2].textContent = lang.recurrenceWeekly;
            recurrenceTypeOptions[3].textContent = lang.recurrenceMonthly;
            recurrenceTypeOptions[4].textContent = lang.recurrenceYearly;
        }
        
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
    }
    
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
    }

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
    }
    
    // 更新确认对话框
    updateConfirmDialog(lang) {
        const confirmTitle = document.querySelector('#confirm-dialog h2');
        if (confirmTitle && confirmTitle.textContent === '确认操作') confirmTitle.textContent = lang.confirm;

        const confirmCancelBtn = document.getElementById('confirm-cancel');
        const confirmOkBtn = document.getElementById('confirm-ok');
        if (confirmCancelBtn) confirmCancelBtn.textContent = lang.cancel;
        if (confirmOkBtn) confirmOkBtn.textContent = lang.confirm;
    }
    
    // 更新日历视图
    updateCalendar(lang) {
        const calendarWeekdays = document.querySelectorAll('.calendar-weekday');
        if (calendarWeekdays.length === 7) {
            calendarWeekdays.forEach((day, index) => {
                day.textContent = lang.calendarWeekdays[index];
            });
        }
    }
    
    // 更新设置中心
    updateSettings(lang) {
        const settingsTitle = document.querySelector('#settings-modal h2');
        if (settingsTitle) settingsTitle.textContent = lang.settings;
        
        // 获取所有设置区块标题
        const sectionTitles = document.querySelectorAll('.setting-section h3');
        
        if (sectionTitles[0]) sectionTitles[0].textContent = lang.settingsWindow;

        // 窗口置顶设置
        this.setSettingItemText('window-top-toggle', lang.settingsWindowTop);
        
        // 主题设置
        this.setSettingItemText('theme-dark-toggle', lang.settingsDarkTheme);

        // 中英文设置
        this.setSettingItemText('language-toggle', lang.language);

        // 自启动设置
        this.setSettingItemText('auto-start-toggle', lang.settingsAutoStart);

        // 快捷键设置
        this.setSettingItemText('shortcut-toggle', lang.settingsShortcut);

        // 数据管理
        if (sectionTitles[1]) sectionTitles[1].textContent = lang.settingsData;

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
        const aboutTitle = sectionTitles[2];
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
    }
    
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
    
    // 获取翻译文本
    getText(key, defaultValue = '') {
        if (!window.Languages || !window.Languages[this.currentLanguage]) return defaultValue;

        // 支持嵌套键，如 'statsTimeDimension.all'
        const keys = key.split('.');
        let value = window.Languages[this.currentLanguage];
        
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        
        return value || defaultValue;
    }
    
    // 添加观察者
    addObserver(observer) {
        if (typeof observer === 'function') this.observers.push(observer);
    }
    
    // 移除观察者
    removeObserver(observer) {
        const index = this.observers.indexOf(observer);
        if (index > -1) this.observers.splice(index, 1);
    }
    
    // 通知观察者
    notifyObservers() {
        this.observers.forEach(observer => {
            try {
                observer(this.currentLanguage);
            } catch (error) {
                logger.error('Observer error:', error);
            }
        });
    }
    
    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLanguage;
    }
    
    // 获取支持的语言列表
    getSupportedLanguages() {
        return window.Languages ? Object.keys(window.Languages) : ['zh'];
    }
    
    // 获取语言显示名称
    getLanguageDisplayName(languageCode) {
        const lang = window.Languages && window.Languages[languageCode];
        return lang ? lang[`language${languageCode === 'zh' ? 'Chinese' : 'English'}`] : languageCode;
    }
}

// 创建全局实例
window.languageManager = new LanguageManager();

// 简化的翻译函数（用于动态文本）
window.t = function(key, defaultValue = '') {
    return window.languageManager ? window.languageManager.getText(key, defaultValue) : defaultValue;
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保语言配置文件已加载
    setTimeout(() => {
        if (window.languageManager && !window.languageManager.isInitialized) {
            window.languageManager.init();
        }
    }, 500);
});
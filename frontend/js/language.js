/**
 * 语言管理器
 * 支持中英文切换和动态更新界面文本
 */

class LanguageManager {
    constructor() {
        this.currentLanguage = 'zh'; // 默认中文
        this.isInitialized = false;
        this.observers = []; // 观察者列表，用于通知界面更新
        this.retryCount = 0;
        
        // 等待语言配置文件加载完成后再初始化
        this.waitForLanguagesConfig().then(() => this.init());
    }
    
    // 初始化
    async init() {
        try {
            // 从存储中恢复语言设置
            await this.restoreLanguageSetting();
            
            // 应用当前语言设置
            await this.applyLanguage(this.currentLanguage);
            
            this.isInitialized = true;
            console.log('LanguageManager initialized successfully');
        } catch (error) {
            console.error('Failed to initialize LanguageManager:', error);
            // 使用默认语言
            this.currentLanguage = 'zh';
        }
    }
    
    // 恢复语言设置
    async restoreLanguageSetting() {
        try {
            const savedLanguage = localStorage.getItem('todolist_language') || 'zh';
            this.currentLanguage = savedLanguage;
            console.log('Language setting restored:', savedLanguage);
        } catch (error) {
            console.error('Failed to restore language setting:', error);
            this.currentLanguage = 'zh';
        }
    }
    
    // 保存语言设置
    async saveLanguageSetting(language) {
        try {
            localStorage.setItem('todolist_language', language);
            console.log('Language setting saved:', language);
        } catch (error) {
            console.error('Failed to save language setting:', error);
        }
    }
    
    // 切换语言
    async switchLanguage(language) {
        if (!window.Languages || !window.Languages[language]) {
            console.error('Language not supported:', language);
            return false;
        }
        
        if (this.currentLanguage === language) {
            return true; // 已经是目标语言
        }
        
        try {
            // 保存设置
            await this.saveLanguageSetting(language);
            
            // 更新当前语言
            this.currentLanguage = language;
            
            // 应用语言设置
            await this.applyLanguage(language);
            
            // 通知观察者
            this.notifyObservers();
            
            console.log('Language switched to:', language);
            return true;
        } catch (error) {
            console.error('Failed to switch language:', error);
            return false;
        }
    }
    
    // 等待语言配置文件加载完成
    async waitForLanguagesConfig() {
        return new Promise((resolve) => {
            const checkConfig = () => {
                if (window.Languages && window.Languages.zh && window.Languages.en) {
                    console.log('Languages config loaded successfully');
                    resolve();
                } else {
                    console.log('Waiting for languages config to load...');
                    setTimeout(checkConfig, 100);
                }
            };
            checkConfig();
        });
    }
    
    // 应用语言设置到界面
    async applyLanguage(language) {
        // 检查语言配置是否可用
        if (!window.Languages || !window.Languages.zh || !window.Languages.en) {
            console.warn('Languages config not fully loaded yet, waiting...');
            // 等待配置加载完成
            await this.waitForLanguagesConfig();
        }
        
        // 重置重试计数器
        this.retryCount = 0;
        
        if (!window.Languages[language]) {
            console.warn('Language not available:', language, 'falling back to zh');
            // 如果请求的语言不可用，回退到中文
            language = 'zh';
            
            // 再次检查中文是否可用
            if (!window.Languages[language]) {
                console.error('Fallback language zh also not available');
                return;
            }
        }
        
        const lang = window.Languages[language];
        
        // 更新HTML lang属性
        document.documentElement.lang = language;
        
        // 更新页面标题
        this.updatePageTitle(lang);
        
        // 更新主界面文本
        this.updateMainInterface(lang);
        
        // 更新模态框文本
        this.updateModals(lang);
        
        // 更新日历视图文本
        this.updateCalendar(lang);
        
        // 更新设置中心文本
        this.updateSettings(lang);
        
        // 更新Pikaday日期选择器
        this.updateDatePicker(language);
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
            statLabels[0].textContent = lang.statsTotalTasks;
            statLabels[1].textContent = lang.statsCompletedTasks;
            statLabels[2].textContent = lang.statsCompletionRate;
            statLabels[3].textContent = lang.statsNoDueDateTasks;
        }
        
        // 统计维度按钮
        const dimensionBtns = document.querySelectorAll('.dimension-btn');
        dimensionBtns.forEach(btn => {
            const dimension = btn.dataset.dimension;
            if (dimension && lang.statsTimeDimension[dimension]) {
                btn.textContent = lang.statsTimeDimension[dimension];
                btn.title = lang.statsTimeDimension[dimension];
            }

        });
        const activeDimensionBtn = document.querySelector('.dimension-btn.active');
        if (activeDimensionBtn.dataset.dimension === 'all') {
            document.querySelector('.date-range-text').textContent = lang.statsTimeDimension['all'];
        }
        
        // 分类标题
        const categoriesTitle = document.querySelector('.categories-section h3');
        if (categoriesTitle) categoriesTitle.textContent = lang.categories;

        // 全部分类选项
        const allCategories = document.querySelector('.category-item #allCategories');
        if (allCategories) allCategories.textContent = lang.allCategories;

        // 无分类
        const uncategorized = document.querySelector('#task-category option');
        if (uncategorized) uncategorized.textContent = lang.uncategorized;
        
        // 添加分类按钮
        const addCategoryBtn = document.getElementById('add-category-btn');
        if (addCategoryBtn) addCategoryBtn.textContent = lang.addCategory;
        
        // 搜索框占位符
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.placeholder = lang.searchPlaceholder;
        
        // 搜索清空按钮
        const searchClearBtn = document.getElementById('search-clear-btn');
        if (searchClearBtn) searchClearBtn.title = lang.searchClear;
        
        // 视图切换按钮
        const viewToggleBtn = document.getElementById('view-toggle-btn');
        if (viewToggleBtn) {
            const isCalendarView = viewToggleBtn.textContent.includes('列表');
            viewToggleBtn.textContent = isCalendarView ? 
                `📅 ${lang.calendarView}` : `📋 ${lang.listView}`;
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
                options[4].textContent = lang.taskHeaderAction;
            }
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
        document.querySelectorAll('.task-action-btn.edit').forEach(btn => {
            if (btn.disabled) {
                btn.title = lang.recurringTaskEditTip;
            } else {
                btn.title = lang.normalTaskEditTip;
            }
        });
        document.querySelectorAll('.task-action-btn.view').forEach(btn => {
            btn.title = lang.taskViewTip;
        });
        document.querySelectorAll('.task-action-btn.delete').forEach(btn => {
            btn.title = lang.taskDeleteTip;
        });
        
        // 分页文本
        this.updatePagination(lang);

        // 联系作者
        const contactAuthor = document.querySelector('.contact-text');
        if (contactAuthor) contactAuthor.textContent = lang.contactAuthor;
    }
    
    // 更新筛选器选项
    updateFilterOptions(lang) {
        // 优先级筛选器
        const priorityFilter = document.getElementById('priority-filter');
        if (priorityFilter) {
            const options = priorityFilter.querySelectorAll('option');
            if (options.length >= 5) {
                options[0].textContent = lang.filterPriority;
                options[1].textContent = `🔴 ${lang.priorityHigh}`;
                options[2].textContent = `🟡 ${lang.priorityMedium}`;
                options[3].textContent = `🟢 ${lang.priorityLow}`;
                options[4].textContent = `⚪ ${lang.priorityNone}`;
            }
        }
        
        // 状态筛选器
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            const options = statusFilter.querySelectorAll('option');
            if (options.length >= 5) {
                options[0].textContent = lang.filterStatus;
                options[1].textContent = lang.statusCompleted;
                options[2].textContent = lang.statusUncompleted;
                options[3].textContent = lang.statusPending;
                options[4].textContent = lang.statusOverdue;
            }
        }
        
        // 截止日期筛选器
        const dueDateFilter = document.getElementById('due-date-filter');
        if (dueDateFilter) {
            const options = dueDateFilter.querySelectorAll('option');
            if (options.length >= 6) {
                options[0].textContent = lang.dueDateAll;
                options[1].textContent = lang.dueDateToday;
                options[2].textContent = lang.dueDateTomorrow;
                options[3].textContent = lang.dueDateWeek;
                options[4].textContent = lang.dueDateMonth;
                options[5].textContent = lang.dueDateNoDueDate;
            }
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
        if (pageSizeSelect) {
            const options = pageSizeSelect.querySelectorAll('option');
            options.forEach(option => {
                const value = option.value;
                option.textContent = `${value} ${lang.paginationItems}/${lang.paginationPage}`;
            });
        }
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
                    label.textContent = lang.taskDescription;
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
        if (tagsLabel) {
            tagsLabel.innerHTML = `${lang.taskTags} <span style="color: #999; font-size: 12px;">${lang.optional}</span>`;
        }
        
        // 截止日期标签
        const dueDateLabel = document.querySelector('.datetime-group label');
        if (dueDateLabel) {
            dueDateLabel.innerHTML = `${lang.taskDueDate} <span style="color: #666; font-size: 12px;">${lang.optional}</span>`;
        }
        
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
        if (categorySelect) {
            const firstOption = categorySelect.options[0];
            if (firstOption) firstOption.text = lang.uncategorized;
        }
        
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
        if (recurrenceToggle) {
            recurrenceToggle.textContent = lang.createRecurringTask;
        }
        
        const recurrenceTypeLabel = document.querySelector('label[for="recurrence-type"]');
        if (recurrenceTypeLabel) {
            recurrenceTypeLabel.textContent = lang.recurrenceType;
        }
        
        const recurrenceCountLabel = document.querySelector('label[for="recurrence-count"]');
        if (recurrenceCountLabel) {
            recurrenceCountLabel.textContent = lang.recurrenceCount;
        }
        
        const recurrenceTypeOptions = document.querySelectorAll('#recurrence-type option');
        if (recurrenceTypeOptions.length >= 5) {
            recurrenceTypeOptions[0].textContent = lang.recurrenceChoose;
            recurrenceTypeOptions[1].textContent = lang.recurrenceDaily;
            recurrenceTypeOptions[2].textContent = lang.recurrenceWeekly;
            recurrenceTypeOptions[3].textContent = lang.recurrenceMonthly;
            recurrenceTypeOptions[4].textContent = lang.recurrenceYearly;
        }
        
        const recurrenceCountInput = document.getElementById('recurrence-count');
        if (recurrenceCountInput) {
            recurrenceCountInput.placeholder = lang.recurrenceCountRequired;
        }
        
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
    
    // 更新分类模态框
    updateCategoryModal(lang) {
        const categoryModalTitle = document.getElementById('category-modal-title');
        if (categoryModalTitle) {
            categoryModalTitle.textContent = lang.addCategory;
        }
        
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
        const categorySaveBtn = document.querySelector('.category-form .save-btn');
        if (categoryCancelBtn) categoryCancelBtn.textContent = lang.cancel;
        if (categorySaveBtn) categorySaveBtn.textContent = lang.save;
    }
    
    // 更新确认对话框
    updateConfirmDialog(lang) {
        const confirmTitle = document.querySelector('#confirm-dialog h2');
        if (confirmTitle && confirmTitle.textContent === '确认操作') {
            confirmTitle.textContent = lang.confirm;
        }
        
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
        const windowTopCheckbox = document.getElementById('window-top-toggle');
        const windowTopSettingItem = windowTopCheckbox.closest('.setting-item');
        const windowTopLabel = windowTopSettingItem.querySelector('.setting-text');
        if (windowTopLabel) windowTopLabel.textContent = lang.settingsWindowTop;
        
        // 主题设置
        const darkModeCheckbox = document.getElementById('theme-dark-toggle');
        const settingItem = darkModeCheckbox.closest('.setting-item');
        const themeTopLabel = settingItem.querySelector('.setting-text');
        if (themeTopLabel) themeTopLabel.textContent = lang.settingsDarkTheme;

        // 中英文设置
        const languageCheckbox = document.getElementById('language-toggle');
        const languageSettingItem = languageCheckbox.closest('.setting-item');
        const languageLabel = languageSettingItem.querySelector('.setting-text');
        if (languageLabel) languageLabel.textContent = lang.language;

        // 数据管理
        if (sectionTitles[2]) sectionTitles[2].textContent = lang.settingsData;

        // 数据共享
        const dataTransferTitle = document.querySelector('#data-transfer-modal h2');
        if (dataTransferTitle) dataTransferTitle.textContent = lang.settingsDataShare;
        const dataShareSettingItem = document.getElementById('data-share-btn');
        const dataShareLabel = dataShareSettingItem.querySelector('.setting-text');
        if (dataShareLabel) {
            dataShareLabel.textContent = lang.settingsDataShare;
        }

        const dataSyncSettingItem = document.getElementById('data-sync-btn');
        const dataSyncLabel = dataSyncSettingItem.querySelector('.setting-text');
        if (dataSyncLabel) {
            dataSyncLabel.textContent = lang.settingsDataSync;
        }
        const shareModeText = document.querySelector('#share-mode-btn .mode-text');
        if (shareModeText) shareModeText.textContent = lang.shareMode;
        const receiveModeText = document.querySelector('#receive-mode-btn .mode-text');
        if (receiveModeText) receiveModeText.textContent = lang.receiveMode;
        const dataSharePanel = document.getElementById('share-mode-panel');
        const dataShareDataLabel = dataSharePanel.querySelectorAll('h3');
        if (dataShareDataLabel.length >= 3) {
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

        const shareStatus = document.getElementById('share-status');
        const shareStatusInfo = shareStatus.querySelectorAll('strong');
        if (shareStatusInfo.length >= 3) {
            shareStatusInfo[0].textContent = lang.ipAddress;
            shareStatusInfo[1].textContent = lang.port;
            shareStatusInfo[2].textContent = lang.sharingData;
        }
        const receiveModePanel = document.getElementById('receive-mode-panel');
        const receiveModeTitle = receiveModePanel.querySelectorAll('h3');
        if (receiveModeTitle.length >= 3) {
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
        const dataStorageLabel = document.querySelector('.data-label');
        if (dataStorageLabel) {
            dataStorageLabel.textContent = lang.dataStoragePath;
        }
        const dataStorageApplyLabel = document.querySelector('.apply-dir-btn');
        if (dataStorageApplyLabel) {
            dataStorageApplyLabel.textContent = lang.dataStorageApply;
        }

        // 数据同步
        const dataSyncTitle = document.querySelector('#data-sync-modal h2');
        if (dataSyncTitle) dataSyncTitle.textContent = lang.settingsDataSync;
        const webDavCheckbox = document.getElementById('webdav-enable-toggle');
        const webDavSettingItem = webDavCheckbox.closest('.setting-item');
        const webDavLabel = webDavSettingItem.querySelector('.setting-text');
        if (webDavLabel) webDavLabel.textContent = lang.dataSync;

        const dataSyncPanel = document.getElementById('webdav-config-panel');
        const dataSyncDataLabel = dataSyncPanel.querySelectorAll('.data-label');
        if (dataSyncDataLabel.length >= 4) {
            dataSyncDataLabel[0].textContent = lang.account;
            dataSyncDataLabel[1].textContent = lang.password;
            dataSyncDataLabel[2].textContent = lang.filepath;
            dataSyncDataLabel[3].textContent = lang.autoSync;
        }
        const webDavTestBtn = document.getElementById('webdav-test-btn');
        if (webDavTestBtn) webDavTestBtn.textContent = lang.testConnection;
        const webDavSaveBtn = document.getElementById('webdav-save-btn');
        if (webDavSaveBtn) webDavSaveBtn.textContent = lang.saveConfiguration;
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
            
            // 重新渲染日期选择器
            pikaday.draw();
        }
    }
    
    // 获取翻译文本
    getText(key, defaultValue = '') {
        if (!window.Languages || !window.Languages[this.currentLanguage]) {
            return defaultValue;
        }
        
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
        if (typeof observer === 'function') {
            this.observers.push(observer);
        }
    }
    
    // 移除观察者
    removeObserver(observer) {
        const index = this.observers.indexOf(observer);
        if (index > -1) {
            this.observers.splice(index, 1);
        }
    }
    
    // 通知观察者
    notifyObservers() {
        this.observers.forEach(observer => {
            try {
                observer(this.currentLanguage);
            } catch (error) {
                console.error('Observer error:', error);
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
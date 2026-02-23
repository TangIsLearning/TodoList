/**
 * 多语言配置文件
 * 支持中文和英文
 */

const Languages = {
    // 中文（默认）
    zh: {
        // 应用标题和基本界面
        appTitle: "📝 Todo List",
        settingsBtn: "设置中心",
        settings: "设置",
        save: "保存",
        cancel: "取消",
        confirm: "确认",
        delete: "删除",
        edit: "编辑",
        view: "查看",
        close: "关闭",
        loading: "加载中...",
        
        // 任务相关
        task: "任务",
        tasks: "任务",
        newTask: "新建任务",
        editTask: "编辑任务",
        taskTitle: "任务标题",
        taskDescription: "任务描述",
        taskPriority: "优先级",
        taskCategory: "分类",
        taskDueDate: "截止日期",
        taskDueTime: "截止时间",
        taskCreateTime: "创建时间",
        taskUpdateTime: "更新时间",
        taskTags: "标签",
        taskTag: "标签",
        taskStatus: "状态",

        // 任务详情
        noTaskTags: "无标签",
        noTaskDescription: "无描述",

        // 优先级
        priorityHigh: "高优先级",
        priorityMedium: "中优先级", 
        priorityLow: "低优先级",
        priorityNone: "无优先级",
        // 优先级-图标
        high: "高",
        medium: "中",
        low: "低",
        none: "无",
        
        // 状态
        statusCompleted: "已完成",
        statusUncompleted: "未完成",
        statusPending: "未完成未逾期",
        statusOverdue: "未完成已逾期",
        
        // 统计信息
        statsTotalTasks: "总任务",
        statsCompletedTasks: "已完成",
        statsCompletionRate: "完成率",
        statsNoDueDateTasks: "无截止日期",
        statsTimeDimension: {
            all: "全部",
            year: "今年",
            month: "本月", 
            week: "本周",
            day: "今天"
        },
        
        // 分类管理
        categories: "分类",
        allCategories: "📋 全部",
        addCategory: "添加分类",
        categoryName: "分类名称",
        categoryColor: "颜色",
        uncategorized: "未分类",
        
        // 搜索和筛选
        searchPlaceholder: "搜索任务... (支持 #标签 搜索)",
        searchClear: "清空搜索",
        filterAll: "所有",
        filterPriority: "所有优先级",
        filterStatus: "所有状态",
        filterDueDate: "截止日期",
        
        // 日期筛选选项
        dueDateAll: "所有时间",
        dueDateToday: "今天",
        dueDateTomorrow: "明天", 
        dueDateWeek: "本周内",
        dueDateMonth: "本月内",
        dueDateNoDueDate: "无截止日期",
        
        // 视图切换
        listView: "列表视图",
        calendarView: "日历视图",
        
        // 日历相关
        calendarMonth: "月",
        calendarWeekdays: ["日", "一", "二", "三", "四", "五", "六"],

        // 任务表头
        taskHeaderName: "任务名称",
        taskHeaderPriority: "优先级",
        taskHeaderDueDate: "到期时间",
        taskHeaderTag: "标签",
        taskHeaderAction: "操作",
        
        // 任务列表操作项提示语
        recurringTaskEditTip: "周期性任务不支持编辑",
        normalTaskEditTip: "编辑",
        taskViewTip: "查看",
        taskDeleteTip: "删除",

        // 分页
        paginationShowing: "显示",
        paginationOf: "共",
        paginationItems: "条",
        paginationPage: "页",
        paginationFirst: "首页",
        paginationPrev: "上一页", 
        paginationNext: "下一页",
        paginationLast: "末页",
        
        // 空状态
        emptyTasks: "暂无任务",
        emptyTasksMessage: "点击\"新建任务\"按钮创建你的第一个任务",
        
        // 操作提示
        taskCreated: "任务创建成功",
        taskUpdated: "任务更新成功", 
        taskDeleted: "任务删除成功",
        taskCompleted: "任务已完成",
        taskReopened: "任务已重新开启",
        darkModeSwitched: "已切换到深色主题",
        LightModeSwitched: "已切换到浅色主题",
        useTaskCached: "使用缓存数据",
        loadingTaskFailed: "加载任务失败",
        periodicTaskEditFailed: "周期性任务不支持编辑，请删除后重新创建",
        periodicTaskDeleted: "整个周期任务删除成功",
        operationFailed: "操作失败",
        taskTagDeleted: "标签删除成功",
        errorTagNameRequired: "请输入标签名",
        errorTagExisted: "标签已存在",
        windowOnTopSet: "窗口已设置置顶",
        windowOnTopUnset: "窗口已取消置顶",
        languageSwitchFailed: "语言切换失败",
        languageSwitchTo: "已切换到",
        initializationFailed: "应用初始化失败",
        unknownErrorOccurred: "发生了未知错误",
        refreshDataFailed: "刷新数据失败",
        resetStateFailed: "应用状态重置失败",
        resetStateSuccess: "应用状态已重置",
        sharingStopped: "共享已停止",
        sharingStarted: "共享已启动",
        NoDeviceFound: "未找到可用的设备",
        receiveDataFailed: "接收数据失败",
        dataImportedSuccess: "数据导入成功",
        dataImportedFailed: "数据导入失败",
        retrieveDataFailed: "无法获取接收到的数据",
        loadCategoriesFailed: "加载分类失败",
        errorCategoryNameRequired: "请输入分类名称",
        errorCategoryExisted: "分类名称已存在",
        categoryCreated: "分类创建成功",
        categoryUpdated: "分类更新成功",
        categoryDeleted: "分类删除成功",
        showTaskFor: "当前任务日期：",

        // 错误消息
        errorTitleRequired: "请输入任务标题",
        errorInvalidDateTime: "截止时间不能早于当前时间",
        errorDateTimeIncomplete: "日期和时间选择不完整",
        errorRecurrenceTypeRequired: "请选择重复周期",
        errorRecurrenceCountRequired: "请输入有效的循环次数",

        // 周期性任务
        recurringTask: "周期性任务",
        createRecurringTask: "创建为周期性任务",
        recurrenceType: "重复周期",
        recurrenceCount: "循环次数*",
        recurrenceDaily: "每天",
        recurrenceWeekly: "按周",
        recurrenceMonthly: "按月",
        recurrenceYearly: "按年",
        recurrenceCountRequired: "循环次数不能为空",
        recurrenceChoose: "请选择",
        recurringEditNotice: "非周期性任务编辑模式下不支持改周期性任务",

        // 设置中心
        settingsWindow: "通用设置",
        settingsWindowTop: "窗口置顶",
        settingsDarkTheme: "深色模式",
        settingsData: "数据管理",
        settingsDataShare: "共享数据",
        settingsDataReceive: "接收数据",
        
        // 语言设置
        language: "中英文切换",
        
        // 确认对话框
        confirmDeleteTask: "确定要删除任务",
        confirmDeleteTaskMessage: "此操作无法撤销。",
        
        // 周期性任务删除选项
        deleteSingleTask: "仅删除此任务",
        deleteSingleTaskDesc: "删除当前选中的任务，保留周期中的其他任务",
        deleteAllTasks: "删除整个周期", 
        deleteAllTasksDesc: "删除此周期内的所有任务",
        
        // 更多选项
        moreOptions: "更多选项",
        optional: "可选",
        required: "必填",
        
        // 数据传输
        dataTransfer: "数据传输",
        shareMode: "共享数据",
        receiveMode: "接收数据",
        currentDataSummary: "当前数据摘要",
        shareSettings: "共享设置",
        startShare: "启动共享",
        stopShare: "停止共享",
        shareStatus: "共享状态",
        ipAddress: "IP地址",
        port: "端口",
        sharingData: "正在共享数据",
        scanDevices: "扫描局域网设备",
        availableDevices: "可用设备",
        noDevicesFound: "未找到设备",
        receivedDataPreview: "接收到的数据预览",
        waitingForData: "等待接收数据...",
        importWarning: "注意: 导入数据将覆盖当前所有数据，建议先备份数据！",
        confirmImport: "确认导入",
        cancelImport: "取消"
    },
    
    // 英文
    en: {
        // 应用标题和基本界面
        appTitle: "📝 Todo List",
        settingsBtn: "Settings",
        settings: "Settings",
        save: "Save",
        cancel: "Cancel",
        confirm: "Confirm",
        delete: "Delete",
        edit: "Edit",
        view: "View",
        close: "Close",
        loading: "Loading...",
        
        // 任务相关
        task: "Task",
        tasks: "Tasks",
        newTask: "New Task",
        editTask: "Edit Task",
        taskTitle: "Task Title",
        taskDescription: "Task Description",
        taskPriority: "Priority",
        taskCategory: "Category",
        taskDueDate: "Due Date",
        taskDueTime: "Due Time",
        taskCreateTime: "Create Time",
        taskUpdateTime: "Update Time",
        taskTags: "Tags",
        taskTag: "Tag",
        taskStatus: "Status",

        // 任务详情
        noTaskTags: "(none)",
        noTaskDescription: "(none)",

        // 优先级
        priorityHigh: "High Priority",
        priorityMedium: "Medium Priority",
        priorityLow: "Low Priority", 
        priorityNone: "No Priority",
        // 优先级-图标
        high: "High",
        medium: "Medium",
        low: "Low",
        none: "None",
        
        // 状态
        statusCompleted: "Completed",
        statusUncompleted: "Uncompleted",
        statusPending: "Pending (Not Overdue)",
        statusOverdue: "Overdue",
        
        // 统计信息
        statsTotalTasks: "Total Tasks",
        statsCompletedTasks: "Completed",
        statsCompletionRate: "Completion Rate",
        statsNoDueDateTasks: "No Due Date",
        statsTimeDimension: {
            all: "All Time",
            year: "This Year",
            month: "This Month",
            week: "This Week",
            day: "Today"
        },
        
        // 分类管理
        categories: "Categories",
        allCategories: "📋 All",
        addCategory: "Add Category",
        categoryName: "Category Name",
        categoryColor: "Color",
        uncategorized: "Uncategorized",
        
        // 搜索和筛选
        searchPlaceholder: "Search tasks... (Supports #tag search)",
        searchClear: "Clear Search",
        filterAll: "All",
        filterPriority: "All Priority",
        filterStatus: "All Status",
        filterDueDate: "Due Date",
        
        // 日期筛选选项
        dueDateAll: "All Time",
        dueDateToday: "Today",
        dueDateTomorrow: "Tomorrow",
        dueDateWeek: "This Week",
        dueDateMonth: "This Month",
        dueDateNoDueDate: "No Due Date",
        
        // 视图切换
        listView: "List View",
        calendarView: "Calendar View",
        
        // 日历相关
        calendarMonth: "Month",
        calendarWeekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

        // 任务表头
        taskHeaderName: "Task Name",
        taskHeaderPriority: "Priority",
        taskHeaderDueDate: "Due Date",
        taskHeaderTag: "Tag",
        taskHeaderAction: "Action",
        
        // 任务列表操作项提示语
        recurringTaskEditTip: "Periodic tasks cannot be edited",
        normalTaskEditTip: "Edit",
        taskViewTip: "View",
        taskDeleteTip: "Delete",

        // 分页
        paginationShowing: "Showing",
        paginationOf: "of",
        paginationItems: "items",
        paginationPage: "page",
        paginationFirst: "First",
        paginationPrev: "Previous",
        paginationNext: "Next",
        paginationLast: "Last",
        
        // 空状态
        emptyTasks: "No Tasks",
        emptyTasksMessage: "Click the \"New Task\" button to create your first task",
        
        // 操作提示
        taskCreated: "Task created successfully",
        taskUpdated: "Task updated successfully",
        taskDeleted: "Task deleted successfully",
        taskCompleted: "Task completed",
        taskReopened: "Task reopened",
        darkModeSwitched: "Switched to Dark mode",
        LightModeSwitched: "Switched to Light mode",
        useTaskCached: "Using cached data",
        loadingTaskFailed: "Failed to load tasks",
        periodicTaskEditFailed: "Periodic tasks cannot be edited, please delete and recreate them",
        periodicTaskDeleted: "The periodic task has been deleted successfully",
        operationFailed: "Operation failed",
        taskTagDeleted: "The tag has been deleted successfully",
        errorTagNameRequired: "Please enter a tag name",
        errorTagExisted: "The tag already exists",
        windowOnTopSet: "The window has been set to stay on top",
        windowOnTopUnset: "The window has been unset from staying on top",
        languageSwitchFailed: "Language switch failed",
        languageSwitchTo: "Switched to ",
        initializationFailed: "Application initialization failed",
        unknownErrorOccurred: "An unknown error occurred",
        refreshDataFailed: "Failed to refresh data",
        resetStateFailed: "Failed to reset application state",
        resetStateSuccess: "Application state has been reset",
        sharingStopped: "Sharing has stopped",
        sharingStarted: "Sharing has started",
        NoDeviceFound: "No available devices found",
        receiveDataFailed: "Failed to receive data",
        dataImportedSuccess: "Data imported successfully",
        dataImportedFailed: "Data import failed",
        retrieveDataFailed: "Unable to retrieve received data",
        loadCategoriesFailed: "Failed to load categories",
        errorCategoryNameRequired: "Please enter a category name",
        errorCategoryExisted: "Category name already exists",
        categoryCreated: "Category created successfully",
        categoryUpdated: "Category updated successfully",
        categoryDeleted: "Category deleted successfully",
        showTaskFor: "Show tasks for ",

        // 错误消息
        errorTitleRequired: "Please enter task title",
        errorInvalidDateTime: "Due time cannot be earlier than current time",
        errorDateTimeIncomplete: "Date and time must be selected together",
        errorRecurrenceTypeRequired: "Please select recurrence type",
        errorRecurrenceCountRequired: "Please enter valid repeat count",

        // 周期性任务
        recurringTask: "Recurring Task",
        createRecurringTask: "Create as recurring task",
        recurrenceType: "Recurrence",
        recurrenceCount: "Repeat Count",
        recurrenceDaily: "Daily",
        recurrenceWeekly: "Weekly",
        recurrenceMonthly: "Monthly",
        recurrenceYearly: "Yearly",
        recurrenceCountRequired: "Cycle times cannot be empty",
        recurrenceChoose: "Please Choose",
        recurringEditNotice: "Periodic tasks cannot be edited in non-periodic mode",

        // 设置中心
        settingsWindow: "General Settings",
        settingsWindowTop: "Window Always On Top",
        settingsDarkTheme: "Dark Mode",
        settingsData: "Data Management",
        settingsDataShare: "Share Data",
        settingsDataReceive: "Receive Data",
        
        // 语言设置
        language: "Chinese/English Switch",
        
        // 确认对话框
        confirmDeleteTask: "Are you sure you want to delete task",
        confirmDeleteTaskMessage: "This action cannot be undone.",
        
        // 周期性任务删除选项
        deleteSingleTask: "Delete this task only",
        deleteSingleTaskDesc: "Delete the selected task, keep other tasks in the series",
        deleteAllTasks: "Delete entire series",
        deleteAllTasksDesc: "Delete all tasks in this recurring series",
        
        // 更多选项
        moreOptions: "More Options",
        optional: "Optional",
        required: "Required",
        
        // 数据传输
        dataTransfer: "Data Transfer",
        shareMode: "Share Data",
        receiveMode: "Receive Data",
        currentDataSummary: "Current Data Summary",
        shareSettings: "Share Settings",
        startShare: "Start Sharing",
        stopShare: "Stop Sharing",
        shareStatus: "Sharing Status",
        ipAddress: "IP Address",
        port: "Port",
        sharingData: "Sharing Data",
        scanDevices: "Scan Devices",
        availableDevices: "Available Devices",
        noDevicesFound: "No devices found",
        receivedDataPreview: "Received Data Preview",
        waitingForData: "Waiting to receive data...",
        importWarning: "Warning: Importing will overwrite all current data. Please backup first!",
        confirmImport: "Confirm Import",
        cancelImport: "Cancel"
    }
};

// 导出到全局
if (typeof window !== 'undefined') {
    window.Languages = Languages;
    console.log('Languages config loaded successfully');
}
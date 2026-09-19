/**
 * 任务模块的常量定义
 *
 * 从 todo.js 中抽出，供 todo.js 及其后续拆分的子模块共用。
 * 这些以顶层 const 声明：经典 <script> 之间共享同一全局词法环境，
 * 只要本文件先于使用方加载即可（见 index.html 中的加载顺序）。
 *
 * 注意：顶层 const 不会挂到 window 上，需要被 evaluate_js 等外部脚本访问的
 * 对象不应放在这里。
 */

// 任务列表可配置的显示列
// fixedWidth：固定像素宽度列（内容长度可预期，不随窗口变宽而变宽）
// minWidth：弹性列（任务名称）的最小像素宽度，弹性列会占据表格剩余宽度
const TASK_LIST_COLUMN_DEFS = [
    { key: 'name', i18nKey: 'taskHeaderName', fallback: '任务名称', defaultVisible: true, locked: true, minWidth: 420 },
    { key: 'priority', i18nKey: 'taskHeaderPriority', fallback: '优先级', defaultVisible: true, fixedWidth: 100 },
    { key: 'dueDate', i18nKey: 'taskHeaderDueDate', fallback: '到期时间', defaultVisible: true, fixedWidth: 185 },
    { key: 'tags', i18nKey: 'taskHeaderTag', fallback: '标签', defaultVisible: true, fixedWidth: 145 },
    { key: 'category', i18nKey: 'taskHeaderCategory', fallback: '所属分类', defaultVisible: false, fixedWidth: 160 },
    { key: 'parentTask', i18nKey: 'taskHeaderParentTask', fallback: '关联父项任务', defaultVisible: false, fixedWidth: 170 },
    { key: 'attachments', i18nKey: 'taskHeaderAttachments', fallback: '任务附件', defaultVisible: false, fixedWidth: 130 }
];
// 操作列固定展示且不参与配置；内部是固定数量的按钮，使用固定像素宽度避免列变窄后换行变形
const TASK_LIST_ACTION_COLUMN = { key: 'actions', i18nKey: 'taskHeaderAction', fallback: '操作', fixedWidth: 150 };
// 任务名称列的最小像素宽度（同时保证不小于其他列中最宽一列的 2 倍）
const TASK_LIST_NAME_MIN_WIDTH = 420;
// 表格最小宽度（列较多时自动增大，保证列内容可读）
const TASK_LIST_MIN_WIDTH = 1060;
// 列配置本地缓存键（数据库为唯一来源，本地仅作首屏兜底）
const TASK_LIST_COLUMNS_CACHE_KEY = 'todolist_task_list_columns';

// 周期性任务规则校验失败的兜底文案（i18n key → 中文默认值）
const RECURRENCE_ERROR_MESSAGES = {
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

/**
 * 后端 API 封装层
 *
 * 目的：把原先散落在各业务模块的后端调用（apiMethod 字符串 + Utils.apiCall 回调式）
 * 收敛为具名方法（Api.tasks.list(...)）。收益：
 *   1. 后端重命名/删除接口时，可静态检索而非全局搜字符串；
 *   2. 一个后端接口对应一个入口，调用点参数形态可统一核对；
 *   3. 为后续拆分超大模块（todo.js / settings.js）提供稳定的依赖边界。
 *
 * 通道层（等待 pywebview 就绪、成功判定、错误兜底）已并入本文件且不对外暴露，
 * 业务代码调用后端接口的唯一途径是 Api.<group>.<method>()。
 *
 * 回调式：Api.tasks.list({ apiArgs: [args], onSuccess, onError })
 * Promise 式：await Api.tasks.list.async([args])
 */
(function (global) {
    'use strict';

    /**
     * 后端方法名登记表：此处是前端引用后端接口的唯一出处
     */
    const METHODS = {
        // 任务
        TASK_LIST: 'get_todos',
        TASK_GET: 'get_todo',
        TASK_PAGE: 'get_task_page',
        TASK_SEARCH: 'search_tasks_with_subtasks',
        TASK_ADD: 'add_todo',
        TASK_ADD_RECURRING: 'add_recurring_todo',
        TASK_UPDATE: 'update_todo',
        TASK_DELETE: 'delete_todo',
        TASK_TOGGLE: 'toggle_todo',
        TASK_UPDATE_DUE_DATE: 'update_todo_due_date',
        TASK_PREVIEW_RECURRING: 'preview_recurring_occurrences',
        TASK_EXPORT_EXCEL: 'export_tasks_excel',
        TASK_TRIGGER_UPLOAD: 'trigger_upload_on_change',

        // 任务关系（父子任务）
        RELATION_CHILDREN: 'get_children',
        RELATION_PARENT: 'get_parent',
        RELATION_PARENTS_MAP: 'get_parents_map',
        RELATION_ADD: 'add_task_relation',
        RELATION_SET_PARENT: 'set_task_parent',

        // 分类
        CATEGORY_LIST: 'get_categories',
        CATEGORY_ADD: 'add_category',
        CATEGORY_UPDATE: 'update_category',
        CATEGORY_DELETE: 'delete_category',

        // 标签
        TAG_LIST: 'get_all_tags',
        TAG_UPDATE: 'update_tag',
        TAG_DELETE: 'delete_tag',

        // 配置
        CONFIG_GET: 'get_config',
        CONFIG_SET: 'set_config',

        // 统计
        STATS_SUMMARY: 'get_stats',
        STATS_OPTIONS: 'get_statistics_options',
        STATS_TASKS: 'get_task_statistics',

        // 数据文件与存储目录迁移
        DATA_FILE_CONFIG: 'get_data_file_config',
        DATA_FILE_VALIDATE: 'validate_data_file',
        DIRECTORY_SELECT: 'select_directory_dialog',
        STORAGE_MIGRATION_PREVIEW: 'preview_storage_dir_migration',
        STORAGE_MIGRATION_START: 'start_storage_dir_migration',
        STORAGE_MIGRATION_PROGRESS: 'get_storage_dir_migration_progress',
        STORAGE_MIGRATION_CANCEL: 'cancel_storage_dir_migration',
        STORAGE_BACKUP_CLEANUP: 'cleanup_previous_storage_backup',

        // WebDAV 同步
        WEBDAV_GET: 'get_webdav_config',
        WEBDAV_SET: 'set_webdav_config',
        WEBDAV_TEST: 'test_webdav_connection',
        WEBDAV_SYNC_TO_CLOUD: 'sync_to_cloud',
        WEBDAV_SYNC_FROM_CLOUD: 'sync_from_cloud',

        // 附件
        ATTACHMENT_SELECT_FILES: 'select_attachment_files',
        ATTACHMENT_SELECT_FOLDER: 'select_attachment_folder',
        ATTACHMENT_ACCESS_MODE: 'get_attachment_access_mode',
        ATTACHMENT_OPEN: 'open_attachment',
        ATTACHMENT_REVEAL: 'reveal_attachment',
        ATTACHMENT_DOWNLOAD_URL: 'get_attachment_download_url',

        // 局域网数据分享（P2P）
        P2P_START_SERVER: 'p2p_start_server',
        P2P_STOP_SERVER: 'p2p_stop_server',
        P2P_SCAN_DEVICES: 'p2p_scan_devices',
        P2P_EXPORT_DATA: 'p2p_export_data',
        P2P_RECEIVE_DATA: 'p2p_receive_data',
        P2P_GET_RECEIVED_DATA: 'p2p_get_received_data',
        P2P_HAS_DATA: 'p2p_has_data',
        P2P_IMPORT_DATA: 'p2p_import_data',
        P2P_CLEAR_RECEIVED_DATA: 'p2p_clear_received_data',
        P2P_DATA_SUMMARY: 'p2p_get_data_summary',

        // 系统能力
        OPEN_IN_BROWSER: 'open_in_browser',
        CALENDAR_PERMISSION: 'check_calendar_permission'
    };

    /**
     * 等待 pywebview 通道就绪（窗口创建后由后端异步绑定 API，前端需轮询等待）
     * @param {number} [maxRetries]
     * @param {number} [interval]
     * @returns {Promise<boolean>} 超时未就绪返回 false
     */
    async function waitForBackend(maxRetries = 20, interval = 300) {
        for (let i = 0; i < maxRetries; i++) {
            if (global.pywebview && global.pywebview.api) return true;

            if (i < maxRetries - 1) {
                safeLog('info', `等待 pywebview 加载... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        }
        safeLog('error', 'pywebview 加载超时');
        return false;
    }

    function safeLog(level, message) {
        const fn = global.logger && global.logger[level];
        if (typeof fn === 'function') fn(message);
    }

    /**
     * 通道层：统一处理等待就绪、成功判定、错误兜底
     * 仅由本文件内部使用；业务代码一律走 Api.<group>.<method>()
     */
    async function invokeBackend({
        apiMethod,
        apiArgs = [],
        onSuccess,
        onError = null,
        onFinally = null,
        throwOnError = false,
        successCheck = (result) => result.success !== false
    }) {
        try {
            const isLoaded = await waitForBackend();
            if (!isLoaded) throw new Error('后端请求调用失败！');

            const result = await global.pywebview.api[apiMethod](...apiArgs);
            if (successCheck(result)) {
                if (typeof onSuccess === 'function') onSuccess(result);
            } else {
                throw new Error(`${JSON.stringify(result && result.error)}`);
            }
        } catch (error) {
            safeLog('error', `API '${apiMethod}' error: '${error}'`);
            if (typeof onError === 'function') onError(error);
            if (throwOnError) throw error;
        } finally {
            if (typeof onFinally === 'function') onFinally();
        }
    }

    /**
     * 生成一个回调式调用方法
     * @param {string} methodName 后端方法名
     */
    function define(methodName) {
        function invoke(options) {
            const opts = options || {};
            return invokeBackend({
                apiMethod: methodName,
                apiArgs: opts.apiArgs || [],
                onSuccess: opts.onSuccess,
                onError: opts.onError,
                onFinally: opts.onFinally,
                throwOnError: opts.throwOnError,
                successCheck: opts.successCheck
            });
        }

        /**
         * Promise 形态：resolve 后端的 data 字段（无 data 时回退整个响应）
         * @param {Array} [apiArgs]
         * @param {Object} [options] { successCheck }
         */
        invoke.async = function (apiArgs, options) {
            const opts = options || {};
            return new Promise((resolve, reject) => {
                invoke({
                    apiArgs: apiArgs || [],
                    successCheck: opts.successCheck,
                    onSuccess: (response) => resolve(response && 'data' in response ? response.data : response),
                    onError: (error) => reject(error instanceof Error ? error : new Error(error || `${methodName} 请求失败`))
                });
            });
        };

        return invoke;
    }

    /**
     * 通用逃生舱：尚未封装进分组的后端方法仍可调用，但需显式给出方法名
     */
    function request(methodName, options) {
        return define(methodName)(options);
    }

    function requestAsync(methodName, apiArgs, options) {
        return define(methodName).async(apiArgs, options);
    }

    const Api = {
        methods: METHODS,
        /** 等待后端通道就绪（启动阶段使用） */
        waitForBackend: waitForBackend,
        request: request,
        requestAsync: requestAsync,

        /** 任务 */
        tasks: {
            list: define(METHODS.TASK_LIST),
            get: define(METHODS.TASK_GET),
            page: define(METHODS.TASK_PAGE),
            search: define(METHODS.TASK_SEARCH),
            add: define(METHODS.TASK_ADD),
            addRecurring: define(METHODS.TASK_ADD_RECURRING),
            update: define(METHODS.TASK_UPDATE),
            remove: define(METHODS.TASK_DELETE),
            toggle: define(METHODS.TASK_TOGGLE),
            updateDueDate: define(METHODS.TASK_UPDATE_DUE_DATE),
            previewRecurring: define(METHODS.TASK_PREVIEW_RECURRING),
            exportExcel: define(METHODS.TASK_EXPORT_EXCEL),
            triggerUpload: define(METHODS.TASK_TRIGGER_UPLOAD)
        },

        /** 父子任务关系 */
        relations: {
            children: define(METHODS.RELATION_CHILDREN),
            parent: define(METHODS.RELATION_PARENT),
            parentsMap: define(METHODS.RELATION_PARENTS_MAP),
            add: define(METHODS.RELATION_ADD),
            setParent: define(METHODS.RELATION_SET_PARENT)
        },

        /** 分类 */
        categories: {
            list: define(METHODS.CATEGORY_LIST),
            add: define(METHODS.CATEGORY_ADD),
            update: define(METHODS.CATEGORY_UPDATE),
            remove: define(METHODS.CATEGORY_DELETE)
        },

        /** 标签 */
        tags: {
            list: define(METHODS.TAG_LIST),
            update: define(METHODS.TAG_UPDATE),
            remove: define(METHODS.TAG_DELETE)
        },

        /** 配置读写 */
        config: {
            get: define(METHODS.CONFIG_GET),
            set: define(METHODS.CONFIG_SET)
        },

        /** 统计 */
        stats: {
            summary: define(METHODS.STATS_SUMMARY),
            options: define(METHODS.STATS_OPTIONS),
            tasks: define(METHODS.STATS_TASKS)
        },

        /** 数据文件与存储目录迁移 */
        storage: {
            dataFileConfig: define(METHODS.DATA_FILE_CONFIG),
            validateDataFile: define(METHODS.DATA_FILE_VALIDATE),
            selectDirectory: define(METHODS.DIRECTORY_SELECT),
            previewMigration: define(METHODS.STORAGE_MIGRATION_PREVIEW),
            startMigration: define(METHODS.STORAGE_MIGRATION_START),
            migrationProgress: define(METHODS.STORAGE_MIGRATION_PROGRESS),
            cancelMigration: define(METHODS.STORAGE_MIGRATION_CANCEL),
            cleanupBackup: define(METHODS.STORAGE_BACKUP_CLEANUP)
        },

        /** WebDAV */
        webdav: {
            get: define(METHODS.WEBDAV_GET),
            set: define(METHODS.WEBDAV_SET),
            test: define(METHODS.WEBDAV_TEST),
            syncToCloud: define(METHODS.WEBDAV_SYNC_TO_CLOUD),
            syncFromCloud: define(METHODS.WEBDAV_SYNC_FROM_CLOUD)
        },

        /** 附件 */
        attachments: {
            selectFiles: define(METHODS.ATTACHMENT_SELECT_FILES),
            selectFolder: define(METHODS.ATTACHMENT_SELECT_FOLDER),
            accessMode: define(METHODS.ATTACHMENT_ACCESS_MODE),
            open: define(METHODS.ATTACHMENT_OPEN),
            reveal: define(METHODS.ATTACHMENT_REVEAL),
            downloadUrl: define(METHODS.ATTACHMENT_DOWNLOAD_URL)
        },

        /** 局域网数据分享 */
        p2p: {
            startServer: define(METHODS.P2P_START_SERVER),
            stopServer: define(METHODS.P2P_STOP_SERVER),
            scanDevices: define(METHODS.P2P_SCAN_DEVICES),
            exportData: define(METHODS.P2P_EXPORT_DATA),
            receiveData: define(METHODS.P2P_RECEIVE_DATA),
            receivedData: define(METHODS.P2P_GET_RECEIVED_DATA),
            hasData: define(METHODS.P2P_HAS_DATA),
            importData: define(METHODS.P2P_IMPORT_DATA),
            clearReceivedData: define(METHODS.P2P_CLEAR_RECEIVED_DATA),
            dataSummary: define(METHODS.P2P_DATA_SUMMARY)
        },

        /** 系统能力 */
        system: {
            openInBrowser: define(METHODS.OPEN_IN_BROWSER),
            calendarPermission: define(METHODS.CALENDAR_PERMISSION)
        }
    };

    global.Api = Api;

    if (global.TodoApp) {
        global.TodoApp.register({ name: 'api', category: 'core', instance: Api, requires: [] });
    }
})(window);

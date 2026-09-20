/**
 * 数据传输功能模块 - 简化版本
 */

class DataTransfer {
    constructor() {
        this.isSharing = false;
        this.currentMode = 'share';
        this.sharedData = null;
        this.isInitialized = false;
        this.isReceiving = false;

        try {
            // 获取DOM元素
            const domInitSuccess = this.initDOM();
            
            if (!domInitSuccess) {
                throw new Error('DOM元素初始化失败');
            }

            // 延迟绑定事件，确保DOM完全加载
            setTimeout(() => {
                this.bindEvents();
                this.isInitialized = true;
            }, 100);
        } catch (error) {
            logger.error('DataTransfer初始化失败:', error);
            this.isInitialized = false;
        }
    }

    initDOM() {
        // 核心模态框元素
        this.modal = document.getElementById('data-transfer-modal');
        this.closeBtn = document.getElementById('data-transfer-close');
        this.shareModeBtn = document.getElementById('share-mode-btn');
        this.receiveModeBtn = document.getElementById('receive-mode-btn');
        this.shareModePanel = document.getElementById('share-mode-panel');
        this.receiveModePanel = document.getElementById('receive-mode-panel');
        this.startShareBtn = document.getElementById('start-share-btn');
        this.stopShareBtn = document.getElementById('stop-share-btn');
        this.shareStatus = document.getElementById('share-status');
        this.shareIp = document.getElementById('share-ip');
        this.sharePort = document.getElementById('share-port');
        this.shareDataSummary = document.getElementById('share-data-summary');
        this.scanDevicesBtn = document.getElementById('scan-devices-btn');
        this.includeAttachmentsCheckbox = document.getElementById('include-attachments-checkbox');
        this.deviceListSection = document.getElementById('device-list-section');
        this.deviceList = document.getElementById('device-list');
        this.receiveDataPreviewSection = document.getElementById('receive-data-preview-section');
        this.receiveDataSummary = document.getElementById('receive-data-summary');
        this.importWarning = document.getElementById('import-warning');
        this.confirmImportBtn = document.getElementById('confirm-import-btn');
        this.cancelImportBtn = document.getElementById('cancel-import-btn');
        return true;
    }

    bindEvents() {
        // 关闭模态框
        this.closeBtn?.addEventListener('click', () => this.closeModal());

        // 点击模态框外部关闭（仅在遮罩层本身按下并抬起时触发，避免拖选文本误关闭）
        Utils.bindBackdropClose(this.modal, () => this.closeModal());

        this.modal?.addEventListener('click', (e) => {
            if (e.target !== this.modal) return;
            if (window.App && document.querySelector('.sidebar')?.classList.contains('open')) {
                window.App.closeMobileSidebar();
            }
        });

        // 模式切换
        this.shareModeBtn?.addEventListener('click', () => this.switchMode('share'));
        this.receiveModeBtn?.addEventListener('click', () => this.switchMode('receive'));

        // 共享操作
        this.startShareBtn?.addEventListener('click', () => this.startSharing());
        this.stopShareBtn?.addEventListener('click', () => this.stopSharing());

        // 接收操作
        this.scanDevicesBtn?.addEventListener('click', () => this.scanDevices());
        this.confirmImportBtn?.addEventListener('click', () => this.confirmImport());
        this.cancelImportBtn?.addEventListener('click', () => this.cancelImport());
    }

    openModal() {
        if (this.modal) {
            this.modal.classList.remove('is-closing');
            this.modal.style.display = 'flex';
            this.loadDataSummary();
        } else {
            logger.error('模态框未找到！');
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
        }
    }

    closeModal() {
        if (this.modal) {
            // 先播放退场动画，动画结束后再真正隐藏
            Utils.closeModalWithAnimation(this.modal, () => {
                this.modal.style.display = 'none';
            });
            if (this.isSharing) {
                this.stopSharing();
            }
        }
    }

    switchMode(mode) {
        this.currentMode = mode;

        if (mode === 'share') {
            this.shareModeBtn.classList.add('active');
            this.receiveModeBtn.classList.remove('active');
            this.shareModePanel.classList.add('active');
            this.receiveModePanel.classList.remove('active');
        } else {
            this.receiveModeBtn.classList.add('active');
            this.shareModeBtn.classList.remove('active');
            this.receiveModePanel.classList.add('active');
            this.shareModePanel.classList.remove('active');
        }
    }

    async loadDataSummary() {
        await Utils.apiCall({
            apiMethod: 'p2p_get_data_summary',
            onSuccess: (response) => {
                const summary = response.data;
                if (summary) {
                    this.shareDataSummary.innerHTML = `
                        <p><strong>${window.languageManager.getText('statsTotalTasks', '总任务数')}:</strong> ${summary.total_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsCompletedTasks', '已完成')}:</strong> ${summary.completed_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsUnCompletedTasks', '未完成')}:</strong> ${summary.total_tasks - summary.completed_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsCategories', '分类数')}:</strong> ${summary.total_categories}</p>
                        <p><strong>${window.languageManager.getText('statsLastUpdateTime', '最后更新')}:</strong> ${summary.last_updated || '无'}</p>
                    `;
                }
            },
            onError: (error) => this.shareDataSummary.innerHTML = '<p>加载数据失败</p>'
        });
    }

    async startSharing() {
        // 是否同时传输附件（元信息 + 实体文件），由用户勾选决定
        const includeAttachments = !!this.includeAttachmentsCheckbox?.checked;
        await Utils.apiCall({
            apiMethod: 'p2p_export_data',
            apiArgs: [includeAttachments],
            onSuccess: (response) => {
                this.sharedData = response.data;

                // 显示加载状态
                Utils.setLoading(true, '配置开启防火墻中...');
                Utils.apiCall({
                    apiMethod: 'p2p_start_server',
                    onSuccess: (response) => {
                        this.isSharing = true;
                        this.startShareBtn.style.display = 'none';
                        this.stopShareBtn.style.display = 'block';
                        this.shareStatus.style.display = 'block';
                        this.shareIp.textContent = response.data.ip;
                        this.sharePort.textContent = response.data.port;

                        // 显示详细的启动信息，包括防火墙配置状态
                        let message = `✓ ${window.languageManager.getText('sharingStarted', '共享已启动')}\n\n`;

                        // 如果消息包含防火墙相关信息，显示给用户
                        if (response.data?.message) {
                            message += `\n\n:\n${response.data.message}`;
                        }
                        Utils.setLoading(false);
                        Utils.showToast(message, 'success');
                    },
                    onFinally: () => Utils.setLoading(false)
                });
            },
            onError: (error) => Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${error.message}`, 'error')
        });
    }

    async stopSharing() {
        Utils.setLoading(true, '配置关闭防火墻中...');
        await Utils.apiCall({
            apiMethod: 'p2p_stop_server',
            onSuccess: (response) => {
                this.isSharing = false;
                this.startShareBtn.style.display = 'block';
                this.stopShareBtn.style.display = 'none';
                this.shareStatus.style.display = 'none';
                this.sharedData = null;
                Utils.setLoading(false);
                Utils.showToast(window.languageManager.getText('sharingStopped', '共享已停止'), 'success');
            },
            onError: (error) => Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${error.message}`, 'error'),
            onFinally: () => Utils.setLoading(false)
        });
    }

    async scanDevices() {
        this.scanDevicesBtn.disabled = true;
        this.scanDevicesBtn.textContent = '扫描中...';
        await Utils.apiCall({
            apiMethod: 'p2p_scan_devices',
            onSuccess: (response) => {
                const devices = response.data;
                if (devices && devices.length > 0) {
                    this.displayDevices(devices);
                } else {
                    this.deviceList.innerHTML = `<p>${window.languageManager.getText('noDeviceFound', '未找到可用的设备')}</p>`;
                }
                this.deviceListSection.style.display = 'block';
            },
            onError: (error) => Utils.showToast(`${window.languageManager.getText('unknownErrorOccurred', '发生了未知错误')}: ${error.message}`, 'error'),
            onFinally: () => {
                this.scanDevicesBtn.disabled = false;
                this.scanDevicesBtn.textContent = '扫描局域网设备';
            }
        });
    }

    displayDevices(devices) {
        this.deviceList.innerHTML = devices.map(device => `
            <div class="device-item" data-ip="${device[0]}">
                <span class="device-name">${device[1]}</span>
                <span class="device-ip">${device[0]}</span>
            </div>
        `).join('');

        this.deviceList.querySelectorAll('.device-item').forEach(item => {
            item.addEventListener('click', () => this.receiveData(item.dataset.ip));
        });
    }

    async receiveData(ip) {
        // 防止重复点击导致并发接收
        if (this.isReceiving) return;

        const item = this.deviceList.querySelector(`.device-item[data-ip="${ip}"]`);
        const ipSpan = item?.querySelector('.device-ip');
        const originalIpText = ipSpan?.textContent;

        // 只在被点击的设备项上展示接收中状态，保留设备列表，避免整块重绘
        this.isReceiving = true;
        item?.classList.add('is-loading');
        if (ipSpan) ipSpan.textContent = '正在接收数据...';

        await Utils.apiCall({
            apiMethod: 'p2p_receive_data',
            apiArgs: [ip],
            onSuccess: (response) => {
                const data = response.data;
                if (data) {
                    // 高亮当前数据来源设备
                    this.deviceList.querySelectorAll('.device-item.is-selected')
                        .forEach(el => el.classList.remove('is-selected'));
                    item?.classList.add('is-selected');

                    this.displayReceivedData(data);
                    this.receiveDataPreviewSection.style.display = 'block';

                    // 本地已有数据时提示导入会覆盖（复用共享面板使用的摘要接口）
                    Utils.apiCall({
                        apiMethod: 'p2p_get_data_summary',
                        onSuccess: (response) => {
                            if ((response.data?.total_tasks || 0) > 0) {
                                this.importWarning.style.display = 'flex';
                            }
                        }
                    });
                }
            },
            onError: (error) => {
                Utils.showToast(`${window.languageManager.getText('receiveDataFailed', '接收数据失败')}: ${error.message}`, 'error');
            },
            onFinally: () => {
                this.isReceiving = false;
                item?.classList.remove('is-loading');
                if (ipSpan) ipSpan.textContent = originalIpText;
            }
        });
    }

    displayReceivedData(data) {
        const tasks = data.tasks || [];
        const categories = data.categories || [];
        const attachmentCount = (data.attachments || []).length;
        const attachmentFileCount = data.attachment_file_count || 0;

        this.receiveDataSummary.innerHTML = `
            <p><strong>版本:</strong> ${data.version || '未知'}</p>
            <p><strong>导出时间:</strong> ${data.export_time || '未知'}</p>
            <p><strong>任务数:</strong> ${tasks.length}</p>
            <p><strong>分类数:</strong> ${categories.length}</p>
            <p><strong>设置项:</strong> ${Object.keys(data.settings || {}).length}</p>
            <p><strong>${window.languageManager.getText('attachmentRecords', '附件记录数')}:</strong> ${attachmentCount}</p>
            <p><strong>${window.languageManager.getText('attachmentFiles', '附件文件数')}:</strong> ${attachmentFileCount}</p>
        `;
    }

    async confirmImport() {
        this.closeModal();
        Utils.confirmDialog(
            window.languageManager.getText('settingsImportWarning', '注意：当前操作将覆盖本地所有数据。建议先备份重要数据。是否继续？'),
            async () => {
                this.confirmImportBtn.disabled = true;
                this.confirmImportBtn.textContent = '导入中...';
                Utils.apiCall({
                    apiMethod: 'p2p_get_received_data',
                    onSuccess: (response) => {
                        const data = response.data;
                        if (data) {
                            Utils.apiCall({
                                apiMethod: 'p2p_import_data',
                                apiArgs: [data],
                                onSuccess: async () => {
                                    Utils.showToast(window.languageManager.getText('dataImportedSuccess', '数据导入成功'), 'success');
                                    this.closeModal();
                                    // 清空接收预览并释放后端缓存的接收数据：过去由整页刷新完成，这里显式补齐
                                    this.cancelImport();
                                    await this.reloadAfterImport();
                                }
                            });
                        }
                    },
                    onError: (error) => Utils.showToast(`${window.languageManager.getText('dataImportedFailed', '数据导入失败')}: ${error.message}`, 'error'),
                    onFinally: () => {
                        this.confirmImportBtn.disabled = false;
                        this.confirmImportBtn.textContent = '确认导入';
                    }
                });
            }
        );
    }

    // 导入完成后原地热重载界面（不整页刷新，避免 WebView 重建页面时的整体白闪）
    async reloadAfterImport() {
        try {
            await window.App?.reloadAfterDataReplaced();
        } catch (error) {
            logger.error('Failed to reload after importing data:', error);
            Utils.showToast(window.languageManager.getText('refreshDataFailed', '刷新数据失败'), 'error');
        }
    }

    cancelImport() {
        this.receiveDataPreviewSection.style.display = 'none';
        this.importWarning.style.display = 'none';
        this.deviceList?.querySelectorAll('.device-item.is-selected')
            .forEach(el => el.classList.remove('is-selected'));
        // 释放后端缓存的接收数据（可能包含较大的附件实体文件）
        Utils.apiCall({ apiMethod: 'p2p_clear_received_data' });
    }
}

// 全局实例
let dataTransfer = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保所有脚本都加载完成
    setTimeout(() => {
        if (!dataTransfer) {
            dataTransfer = new DataTransfer();
            // 导出到全局
            window.dataTransfer = dataTransfer;
        }
    }, 500);
});

// window加载后再次尝试
window.addEventListener('load', () => {
    if (!dataTransfer) {
        dataTransfer = new DataTransfer();
        // 导出到全局
        window.dataTransfer = dataTransfer;
    }
});

// 全局函数，作为备用方案
window.openDataTransferModal = function() {
    if (dataTransfer) {
        dataTransfer.openModal();
    } else {
        Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
    }
};
/**
 * 数据传输功能模块 - 简化版本
 */

class DataTransfer {
    constructor() {
        console.log('DataTransfer构造函数被调用');
        this.isSharing = false;
        this.currentMode = 'share';
        this.sharedData = null;
        this.isInitialized = false;

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
                console.log('DataTransfer初始化完成');
            }, 100);
        } catch (error) {
            console.error('DataTransfer初始化失败:', error);
            this.isInitialized = false;
        }
    }

    initDOM() {
        console.log('初始化DOM元素...');
        
        // 核心模态框元素
        this.modal = document.getElementById('data-transfer-modal');
        this.closeBtn = document.getElementById('data-transfer-close');
        
        if (!this.modal) {
            console.error('未找到数据传输模态框元素');
            return false;
        }
        
        // 其他可选元素
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
        this.deviceListSection = document.getElementById('device-list-section');
        this.deviceList = document.getElementById('device-list');
        this.receiveDataPreviewSection = document.getElementById('receive-data-preview-section');
        this.receiveDataSummary = document.getElementById('receive-data-summary');
        this.importWarning = document.getElementById('import-warning');
        this.confirmImportBtn = document.getElementById('confirm-import-btn');
        this.cancelImportBtn = document.getElementById('cancel-import-btn');

        console.log('DOM元素初始化完成');
        return true;
    }

    bindEvents() {
        console.log('开始绑定事件...');

        // 注意：数据传输通过设置中心的数据共享/接收按钮来调用

        console.log('数据传输按钮事件绑定已跳过（功能已迁移到设置中心）');

        // 关闭模态框
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.closeModal());
        }

        // 点击模态框外部关闭
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });
        }

        // 模式切换
        if (this.shareModeBtn) {
            this.shareModeBtn.addEventListener('click', () => this.switchMode('share'));
        }
        if (this.receiveModeBtn) {
            this.receiveModeBtn.addEventListener('click', () => this.switchMode('receive'));
        }

        // 共享操作
        if (this.startShareBtn) {
            this.startShareBtn.addEventListener('click', () => this.startSharing());
        }
        if (this.stopShareBtn) {
            this.stopShareBtn.addEventListener('click', () => this.stopSharing());
        }

        // 接收操作
        if (this.scanDevicesBtn) {
            this.scanDevicesBtn.addEventListener('click', () => this.scanDevices());
        }
        if (this.confirmImportBtn) {
            this.confirmImportBtn.addEventListener('click', () => this.confirmImport());
        }
        if (this.cancelImportBtn) {
            this.cancelImportBtn.addEventListener('click', () => this.cancelImport());
        }

        console.log('所有事件绑定完成');
    }

    openModal() {
        console.log('打开模态框');
        if (this.modal) {
            this.modal.style.display = 'flex';
            this.loadDataSummary();
        } else {
            console.log('模态框未找到！');
            Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
        }
    }

    closeModal() {
        console.log('关闭模态框');
        if (this.modal) {
            this.modal.style.display = 'none';
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
        try {
            if (typeof pywebview !== 'undefined' && pywebview.api) {
                const result = await pywebview.api.p2p_get_data_summary();
                if (result.success && result.summary) {
                    const summary = result.summary;
                    this.shareDataSummary.innerHTML = `
                        <p><strong>${window.languageManager.getText('statsTotalTasks', '总任务数')}:</strong> ${summary.total_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsCompletedTasks', '已完成')}:</strong> ${summary.completed_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsUnCompletedTasks', '未完成')}:</strong> ${summary.total_tasks - summary.completed_tasks}</p>
                        <p><strong>${window.languageManager.getText('statsCategories', '分类数')}:</strong> ${summary.total_categories}</p>
                        <p><strong>${window.languageManager.getText('statsLastUpdateTime', '最后更新')}:</strong> ${summary.last_updated || '无'}</p>
                    `;
                }
            }
        } catch (error) {
            console.error('加载数据摘要失败:', error);
            this.shareDataSummary.innerHTML = '<p>加载数据失败</p>';
        }
    }

    async startSharing() {
        console.log('启动共享...');
        try {
            const exportResult = await pywebview.api.p2p_export_data();
            if (exportResult.success) {
                this.sharedData = exportResult.data;

                // 显示加载状态
                Utils.setLoading(true, '配置开启防火墻中...');
                const result = await pywebview.api.p2p_start_server();
                if (result.success) {
                    this.isSharing = true;
                    this.startShareBtn.style.display = 'none';
                    this.stopShareBtn.style.display = 'block';
                    this.shareStatus.style.display = 'block';
                    this.shareIp.textContent = result.ip;
                    this.sharePort.textContent = result.port;

                    // 显示详细的启动信息，包括防火墙配置状态
                    let message = `✓ ${window.languageManager.getText('sharingStarted', '共享已启动')}\n\n`;

                    // 如果消息包含防火墙相关信息，显示给用户
                    if (result.message) {
                        message += `\n\n:\n${result.message}`;
                    }
                    Utils.setLoading(false);
                    Utils.showToast(message, 'success');
                } else {
                    Utils.setLoading(false);
                    Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${result.error}`, 'error');
                }
            } else {
                Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${exportResult.error}`, 'error');
            }
        } catch (error) {
            console.error('启动共享失败:', error);
            Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${error.message}`, 'error');
        }
    }

    async stopSharing() {
        try {
            // 显示加载状态
            Utils.setLoading(true, '配置关闭防火墻中...');
            const result = await pywebview.api.p2p_stop_server();
            if (result.success) {
                this.isSharing = false;
                this.startShareBtn.style.display = 'block';
                this.stopShareBtn.style.display = 'none';
                this.shareStatus.style.display = 'none';
                this.sharedData = null;
                Utils.setLoading(false);
                Utils.showToast(window.languageManager.getText('sharingStopped', '共享已停止'), 'success');
            } else {
                Utils.setLoading(false);
                Utils.showToast(window.languageManager.getText('operationFailed', '操作失败'), 'error');
            }
        } catch (error) {
            Utils.setLoading(false);
            console.error('停止共享失败:', error);
            Utils.showToast(`${window.languageManager.getText('operationFailed', '操作失败')} : ${error.message}`, 'error');
        }
    }

    async scanDevices() {
        try {
            this.scanDevicesBtn.disabled = true;
            this.scanDevicesBtn.textContent = '扫描中...';

            const result = await pywebview.api.p2p_scan_devices();
            if (result.success) {
                if (result.devices && result.devices.length > 0) {
                    this.displayDevices(result.devices);
                } else {
                    this.deviceList.innerHTML = `<p>${window.languageManager.getText('NoDeviceFound', '未找到可用的设备')}</p>`;
                }
                this.deviceListSection.style.display = 'block';
            } else {
                Utils.showToast(`${window.languageManager.getText('unknownErrorOccurred', '发生了未知错误')}: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('扫描设备失败:', error);
            Utils.showToast(`${window.languageManager.getText('unknownErrorOccurred', '发生了未知错误')}: ${error.message}`, 'error');
        } finally {
            this.scanDevicesBtn.disabled = false;
            this.scanDevicesBtn.textContent = '扫描局域网设备';
        }
    }

    displayDevices(devices) {
        this.deviceList.innerHTML = devices.map(device => `
            <div class="device-item" data-ip="${device[0]}">
                <span class="device-name">${device[1]}</span>
                <span class="device-ip">${device[0]}</span>
            </div>
        `).join('');

        this.deviceList.querySelectorAll('.device-item').forEach(item => {
            item.addEventListener('click', () => {
                this.receiveData(item.dataset.ip);
            });
        });
    }

    async receiveData(ip) {
        try {
            this.deviceList.innerHTML = '<p style="text-align: center;">正在接收数据...</p>';

            const result = await pywebview.api.p2p_receive_data(ip);
            if (result.success && result.data) {
                this.displayReceivedData(result.data);
                this.receiveDataPreviewSection.style.display = 'block';

                const hasDataResult = await pywebview.api.p2p_has_data();
                if (hasDataResult.success && hasDataResult.has_data) {
                    this.importWarning.style.display = 'flex';
                }
            } else {
                this.deviceList.innerHTML = `<p style="text-align: center;">${window.languageManager.getText('receiveDataFailed', '接收数据失败')}</p>`;
                Utils.showToast(window.languageManager.getText('receiveDataFailed', '接收数据失败'), 'error');
            }
        } catch (error) {
            console.error('接收数据失败:', error);
            this.deviceList.innerHTML = `<p style="text-align: center;">${window.languageManager.getText('receiveDataFailed', '接收数据失败')}</p>`;
            Utils.showToast(`${window.languageManager.getText('receiveDataFailed', '接收数据失败')}: ${error.message}`, 'error');
        }
    }

    displayReceivedData(data) {
        const tasks = data.tasks || [];
        const categories = data.categories || [];

        this.receiveDataSummary.innerHTML = `
            <p><strong>版本:</strong> ${data.version || '未知'}</p>
            <p><strong>导出时间:</strong> ${data.export_time || '未知'}</p>
            <p><strong>任务数:</strong> ${tasks.length}</p>
            <p><strong>分类数:</strong> ${categories.length}</p>
            <p><strong>设置项:</strong> ${Object.keys(data.settings || {}).length}</p>
        `;

        this.scanDevicesBtn.click();
    }

    async confirmImport() {
        try {
            if (!confirm('确认要导入数据吗？\n\n注意：此操作将覆盖当前所有数据！')) {
                return;
            }

            this.confirmImportBtn.disabled = true;
            this.confirmImportBtn.textContent = '导入中...';

            const result = await pywebview.api.p2p_get_received_data();
            if (result.success && result.data) {
                const importResult = await pywebview.api.p2p_import_data(result.data);
                if (importResult.success) {
                    Utils.showToast(window.languageManager.getText('dataImportedSuccess', '数据导入成功'), 'success');
                    this.closeModal();
                    setTimeout(() => {
                        location.reload();
                    }, 1000);
                } else {
                    Utils.showToast(`${window.languageManager.getText('dataImportedFailed', '数据导入失败')}: ${importResult.error}`, 'error');
                }
            } else {
                Utils.showToast(window.languageManager.getText('retrieveDataFailed', '无法获取接收到的数据'), 'error');
            }
        } catch (error) {
            console.error('导入数据失败:', error);
            Utils.showToast(`${window.languageManager.getText('dataImportedFailed', '数据导入失败')}: ${error.message}`, 'error');
        } finally {
            this.confirmImportBtn.disabled = false;
            this.confirmImportBtn.textContent = '确认导入';
        }
    }

    cancelImport() {
        this.receiveDataPreviewSection.style.display = 'none';
        this.importWarning.style.display = 'none';
    }
}

// 全局实例
let dataTransfer = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded - 创建DataTransfer实例');

    // 延迟初始化，确保所有脚本都加载完成
    setTimeout(() => {
        if (!dataTransfer) {
            dataTransfer = new DataTransfer();
            console.log('DataTransfer实例创建成功');
            // 导出到全局
            window.dataTransfer = dataTransfer;
        }
    }, 500);
});

// window加载后再次尝试
window.addEventListener('load', () => {
    console.log('window.load - 检查DataTransfer实例');

    if (!dataTransfer) {
        dataTransfer = new DataTransfer();
        console.log('DataTransfer实例（window.load）创建成功');
        // 导出到全局
        window.dataTransfer = dataTransfer;
    }
});

// 全局函数，作为备用方案
window.openDataTransferModal = function() {
    console.log('openDataTransferModal被调用');
    if (dataTransfer) {
        dataTransfer.openModal();
    } else {
        Utils.showToast(window.languageManager.getText('initializationFailed', '应用初始化失败'), 'error');
    }
};
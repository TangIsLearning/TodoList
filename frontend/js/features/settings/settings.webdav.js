/**
 * 设置中心 - WebDAV 配置（mixin）
 * 依赖：settings/settings.js（SettingsUIManager 类）
 */

Object.assign(SettingsUIManager.prototype, {

    // ==================== WebDAV相关方法 ====================

    async updateWebDAVConfig() {
        // 更新WebDAV配置显示
        await Utils.apiCall({
            apiMethod: 'get_webdav_config',
            onSuccess: (response) => {
                const config = response.data;
                if (config) {
                    this.webdavEnableToggle.checked = config.enabled || false;
                    this.webdavSyncType.value = config.sync_type;
                    this.webdavUrlInput.value = config.url;
                    this.webdavUsernameInput.value = config.username || '';
                    this.webdavPasswordInput.value = config.password || '';
                    this.webdavRemotePathInput.value = config.remote_path || '';
                    this.webdavFirstSyncModeSelect.value = config.first_sync_mode || 'remote_overwrite';
                    this.toggleWebDAVPanel();
                    this.handleSyncTypeChange();
                }
            }
        });
    },

    handleSyncTypeChange() {
        // 处理同步类型切换
        if (this.webdavSyncType.value === 'jianguoyun') {
            this.webdavUrlInput.value = 'https://dav.jianguoyun.com/dav';
            this.webdavUrlInput.disabled = true;
        } else {
            this.webdavUrlInput.disabled = false;
        }
    },

    async toggleWebDAV() {
        // 切换WebDAV启用状态
        const isEnabled = this.webdavEnableToggle.checked;
        this.toggleWebDAVPanel();

        // 如果禁用，直接保存配置
        if (!isEnabled) await this.saveWebDAVConfig();
    },

    toggleWebDAVPanel() {
        // 切换WebDAV配置面板显示
        const isEnabled = this.webdavEnableToggle.checked;
        if (this.webdavConfigPanel) this.webdavConfigPanel.style.display = isEnabled ? 'block' : 'none';
    },

    async testWebDAVConnection() {
        // 测试WebDAV连接
        // 获取当前输入的配置
        const url = this.webdavUrlInput.value.trim();
        const username = this.webdavUsernameInput.value.trim();
        const password = this.webdavPasswordInput.value;
        const remotePath = this.webdavRemotePathInput.value;

        if (!url || !username || !password || !remotePath) {
            Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
            return;
        }
        await Utils.apiCall({
            apiMethod: 'test_webdav_connection',
            apiArgs: [url, username, password, remotePath],
            onSuccess: (response) => {
                this.showWebDAVStatus(`✅ ${window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！')}`, 'success');
                Utils.showToast(window.languageManager.getText('settingsConnectSuccess', '连接成功！可以正常使用云端同步功能！'), 'success');
            },
            onError: (error) => {
                this.showWebDAVStatus(`❌ ${window.languageManager.getText('settingsConnectionFailed', '连接失败')}：${error.message}`, 'error');
                Utils.showToast(window.languageManager.getText('settingsConnectionFailed', '连接失败'), 'error');
            }
        });
    },

    async saveWebDAVConfig() {
        // 保存WebDAV配置
        const config = {
            enabled: this.webdavEnableToggle.checked,
            sync_type: this.webdavSyncType.value.trim(),
            url: this.webdavUrlInput.value.trim(),
            username: this.webdavUsernameInput.value.trim(),
            password: this.webdavPasswordInput.value,
            remote_path : this.webdavRemotePathInput.value,
            auto_sync: true,
            first_sync_mode: this.webdavFirstSyncModeSelect.value
        };

        // 验证启用时必需的字段
        if (config.enabled) {
            if (!config.url || !config.username || !config.password || !config.remote_path) {
                Utils.showToast(window.languageManager.getText('itemRequired', '请填写必填项！'), 'warning');
                return;
            }
        }

        const overwriteMsg = config.first_sync_mode === 'local_overwrite' ? 'settingsSyncModeLocalWarning' : 'settingsSyncModeRemoteWarning';
        const warningMsg = config.enabled ? overwriteMsg : 'settingsSyncCloseWarning';

        const modal = document.getElementById('data-sync-modal');
        modal.style.display = 'none';
        modal.classList.remove('show');
        // 确认提示
        Utils.confirmDialog(
            window.languageManager.getText(warningMsg),
            async () => {
                await Utils.apiCall({
                    apiMethod: 'set_webdav_config',
                    apiArgs: [config],
                    onSuccess: async (response) => {
                        Utils.showToast(window.languageManager.getText('settingsSaveSuccess', '保存成功'), 'success');
                        // 如果是开启同步功能，则额外进行一次数据同步
                        if (config.enabled) {
                            // 根据首次同步模式执行不同的操作: 本地覆盖远程-上传本地数据到云端 or 远程覆盖本地-从云端下载数据
                            await Utils.apiCall({
                                apiMethod: config.first_sync_mode === 'local_overwrite' ? 'sync_to_cloud' : 'sync_from_cloud',
                                apiArgs: config.first_sync_mode === 'local_overwrite' ? [] : [true],
                            });
                            await this.reloadAfterStorageSwitch();
                        }
                    },
                    onError: (error) => {
                        Utils.showToast(`${window.languageManager.getText('settingsFailed', '设置失败')}: ${error.message}`, 'error');
                    }
                });
            }
        );
    },

    showWebDAVStatus(message, type) {
        // 显示WebDAV状态信息
        if (this.webdavStatusDiv) {
            this.webdavStatusDiv.textContent = message;
            this.webdavStatusDiv.className = `webdav-status ${type}`;
            this.webdavStatusDiv.style.display = 'block';
        }
    }
});

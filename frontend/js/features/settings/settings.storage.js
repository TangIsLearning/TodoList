/**
 * 设置中心 - 存储目录迁移（mixin）
 * 依赖：settings/settings.js（SettingsUIManager 类）
 */

// 把字节数格式化成人类可读的体积，用于迁移体量提示与进度显示
function formatStorageSize(bytes) {
    const size = Number(bytes) || 0;
    if (size <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
    const value = size / Math.pow(1024, index);
    return `${index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

Object.assign(SettingsUIManager.prototype, {

    // ==================== 数据目录配置方法 ====================

    async updateDataFileConfig() {
        // 更新数据文件配置显示
        await Utils.apiCall({
            apiMethod: 'get_data_file_config',
            onSuccess: (response) => {
                if (this.dataDirBtn) {
                    this.dataDirBtn.textContent = response.data;
                    this.dataDirBtn.title = response.data;
                }
            },
            onError: (error) => {
                Utils.showToast('获取配置时发生错误', 'error');
            }
        });
    },

    async browseFile() {
        // 浏览选择目录
        this.setDirectoryButtonsDisabled(true);
        await Utils.apiCall({
            apiMethod: 'select_directory_dialog',
            onSuccess: (response) => {
                const selectedPath = response.data;
                if (selectedPath && this.dataDirBtn) {
                    this.dataDirBtn.textContent = selectedPath;
                    this.dataDirBtn.title = selectedPath;
                    Utils.showToast(`已选择目录: ${selectedPath}`, 'success');

                    // 自动聚焦到应用按钮，方便用户快速操作
                    setTimeout(() => {
                        if (this.applyDirBtn) {
                            this.applyDirBtn.focus();
                        }
                    }, 300);
                }
            },
            onError: (error) => {
                Utils.showToast('浏览目录时发生错误: ' + error.message, 'error');
            },
            onFinally: () => this.setDirectoryButtonsDisabled(false)
        });
    },

    async applyDataFile() {
        // 应用新的数据文件配置
        if (!this.dataDirBtn || !this.dataDirBtn.textContent.trim()) {
            Utils.showToast('请输入数据文件路径', 'warning');
            return;
        }

        const newFile = this.dataDirBtn.textContent.trim();

        // 显示加载状态
        this.setDirectoryButtonsDisabled(true);
        Utils.showToast('正在验证文件...', 'warning');

        // 验证文件路径
        let isValidateFailed = false;
        await Utils.apiCall({
            apiMethod: 'validate_data_file',
            successCheck: (response) => !response.success,
            apiArgs: [newFile],
            onSuccess: (response) => {
                isValidateFailed = true;
                Utils.showToast(response.error, 'error');
            },
        });
        if (isValidateFailed) {
            this.setDirectoryButtonsDisabled(false);
            return;
        }

        // 预估迁移体量：数据量偏大时先把规模告诉用户，再由他决定是否继续
        let estimate = null;
        await Utils.apiCall({
            apiMethod: 'preview_storage_dir_migration',
            apiArgs: [newFile],
            onSuccess: (response) => { estimate = response?.data || null; },
            onError: (error) => {
                const reason = String(error?.message || '').replace(/^"|"$/g, '').trim();
                Utils.showToast(reason || this.t('settingsFailed', '设置失败'), 'error');
            }
        });
        if (!estimate) {
            this.setDirectoryButtonsDisabled(false);
            return;
        }

        // 目录没变：不弹"数据会被复制"的确认框，直接刷新一次即可
        if (estimate.unchanged) {
            this.closeModal();
            await this.runStorageMigration(newFile);
            return;
        }

        const baseWarning = this.t('settingsStorageWarning', '注意：这将影响所有数据的读写操作，当前数据会被复制到新的存储目录，原目录的数据文件将保留为备份。建议先备份重要数据。是否继续？');
        const sizeHint = estimate.exceedsThreshold
            ? this.t('settingsStorageLargeWarning', '注意：本次需要复制约 {size} 数据（附件 {count} 个），耗时可能较长，期间请勿关闭应用。')
                .replace('{size}', formatStorageSize(estimate.totalBytes))
                .replace('{count}', estimate.fileCount)
            : '';

        // 确认提示
        this.closeModal();
        Utils.confirmDialog(
            sizeHint ? `${sizeHint}\n\n${baseWarning}` : baseWarning,
            async () => {
                await this.runStorageMigration(newFile);
            },
            () => this.setDirectoryButtonsDisabled(false)
        );
    },

    // 切目录可能要复制大量附件，放到后台执行并轮询进度，避免界面长时间无响应
    async runStorageMigration(dirPath) {
        let started = false;
        let unchanged = false;
        await Utils.apiCall({
            apiMethod: 'start_storage_dir_migration',
            apiArgs: [dirPath],
            onSuccess: (response) => {
                const data = response?.data || {};
                // 目录没变时后端只做了刷新，没有进度可跟踪
                if (data.unchanged) {
                    unchanged = true;
                    return;
                }
                started = data.started !== false;
                if (started) this.showStorageMigrationProgress(data);
            },
            onError: (error) => {
                const reason = String(error?.message || '').replace(/^"|"$/g, '').trim();
                Utils.showToast(reason || this.t('settingsFailed', '设置失败'), 'error');
            }
        });
        if (unchanged) {
            await this.reloadAfterStorageSwitch(this.t('settingsStorageUnchanged', '存储目录未变更，已重新加载数据'));
            return;
        }
        if (!started) {
            this.setDirectoryButtonsDisabled(false);
            return;
        }

        const result = await this.pollStorageMigration();
        this.hideStorageMigrationProgress();

        if (result?.status === 'success') {
            await this.reloadAfterStorageSwitch();
            // 复制语义下旧数据仍留在原目录，提示位置并提供一键清理
            if (result.backupPath) this.offerStorageBackupCleanup(result.backupPath);
        } else if (result?.status === 'cancelled') {
            // 取消后配置没动过，无需重载；把按钮解禁让用户能重新选择
            Utils.showToast(result.message || this.t('storageMigrationCancelled', '已取消切换，数据仍在原存储目录'), 'info');
            this.setDirectoryButtonsDisabled(false);
        } else {
            const reason = String(result?.message || '').trim();
            Utils.showToast(reason || this.t('settingsFailed', '设置失败'), 'error');
            this.setDirectoryButtonsDisabled(false);
        }
    },

    async pollStorageMigration() {
        const maxFailures = 5;
        let failures = 0;

        while (true) {
            await new Promise(resolve => setTimeout(resolve, 300));

            let state = null;
            await Utils.apiCall({
                apiMethod: 'get_storage_dir_migration_progress',
                onSuccess: (response) => { state = response?.data || null; }
            });

            if (state) {
                failures = 0;
                this.updateStorageMigrationProgress(state);
                if (['success', 'error', 'idle', 'cancelled'].includes(state.status)) return state;
            } else {
                failures += 1;
                // 连续查询失败说明通信出了问题，退出轮询避免界面卡在进度条上
                if (failures >= maxFailures) {
                    return { status: 'error', message: this.t('storageMigrationProgressLost', '迁移进度查询失败，请检查应用状态') };
                }
            }
        }
    },

    showStorageMigrationProgress(state) {
        this.hideStorageMigrationProgress();

        const overlay = document.createElement('div');
        overlay.id = 'storage-migration-progress';
        overlay.setAttribute('role', 'status');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);';
        overlay.innerHTML = `
            <div style="width:min(420px,90vw);padding:20px 22px;background:var(--bg-primary,#fff);color:var(--text-primary,#212529);border:1px solid var(--border-color,#e0e0e0);border-radius:var(--border-radius-lg,12px);box-shadow:var(--shadow-lg,0 8px 24px rgba(0,0,0,.18));">
                <div style="font-size:16px;font-weight:600;">${this.t('storageMigrationTitle', '正在切换存储目录')}</div>
                <div data-role="phase" style="margin-top:6px;font-size:13px;color:var(--text-secondary,#6c757d);"></div>
                <div style="margin-top:12px;height:8px;background:var(--bg-tertiary,#e9ecef);border-radius:999px;overflow:hidden;">
                    <div data-role="bar" style="height:100%;width:0;background:var(--primary-color,#007bff);border-radius:999px;transition:width .2s ease;"></div>
                </div>
                <div data-role="detail" style="margin-top:10px;font-size:12px;color:var(--text-secondary,#6c757d);"></div>
                <div style="margin-top:16px;display:flex;justify-content:flex-end;">
                    <button data-role="cancel" class="btn btn--tertiary-color btn--padding-md">${this.t('storageMigrationCancel', '取消')}</button>
                </div>
            </div>`;
        overlay.querySelector('[data-role="cancel"]')
            ?.addEventListener('click', () => this.requestCancelStorageMigration());
        document.body.appendChild(overlay);
        this.migrationProgressEl = overlay;
        this.updateStorageMigrationProgress(state);
    },

    async requestCancelStorageMigration() {
        const button = this.migrationProgressEl?.querySelector('[data-role="cancel"]');
        // 先就地反馈：后端要在下一个文件边界才真正停下，不能让按钮看起来没反应
        if (button) {
            button.disabled = true;
            button.textContent = this.t('storageMigrationCancelling', '正在取消…');
        }

        await Utils.apiCall({
            apiMethod: 'cancel_storage_dir_migration',
            onSuccess: (response) => {
                const data = response?.data;
                if (data?.accepted === false) {
                    // 任务其实已经结束（刚好跑完），把按钮还回去，避免停在"正在取消…"
                    Utils.showToast(this.t('storageMigrationCancelFailed', '取消失败，请稍后重试'), 'warning');
                    if (button) {
                        button.disabled = false;
                        button.textContent = this.t('storageMigrationCancel', '取消');
                    }
                }
                if (data?.state) this.updateStorageMigrationProgress(data.state);
            },
            onError: (error) => {
                // 取消请求本身没成功（比如迁移刚好已结束），把按钮还给用户再试一次
                if (button) {
                    button.disabled = false;
                    button.textContent = this.t('storageMigrationCancel', '取消');
                }
                const reason = String(error?.message || '').replace(/^"|"$/g, '').trim();
                Utils.showToast(reason || this.t('settingsFailed', '设置失败'), 'error');
            }
        });
    },

    updateStorageMigrationProgress(state) {
        const overlay = this.migrationProgressEl;
        if (!overlay || !state) return;

        const bar = overlay.querySelector('[data-role="bar"]');
        const phaseEl = overlay.querySelector('[data-role="phase"]');
        const detailEl = overlay.querySelector('[data-role="detail"]');
        const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));

        if (bar) bar.style.width = `${percent}%`;
        if (phaseEl) phaseEl.textContent = this.describeMigrationPhase(state);
        if (detailEl) {
            detailEl.textContent = `${percent}%　${formatStorageSize(state.copiedBytes)} / ${formatStorageSize(state.totalBytes)}`;
        }

        // 后端已收到取消请求：按钮进入等待态，避免用户重复点击
        if (state.cancelRequested) {
            const cancelBtn = overlay.querySelector('[data-role="cancel"]');
            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.textContent = this.t('storageMigrationCancelling', '正在取消…');
            }
        }
    },

    hideStorageMigrationProgress() {
        this.migrationProgressEl?.remove();
        this.migrationProgressEl = null;
    },

    describeMigrationPhase(state) {
        const attaching = this.t('storageMigrationAttachments', '正在复制附件');
        switch (state.phase) {
            case 'preparing':
                return this.t('storageMigrationPreparing', '正在准备迁移…');
            case 'cancelling':
                return this.t('storageMigrationCancelling', '正在取消…');
            case 'database':
                return this.t('storageMigrationDatabase', '正在复制数据文件…');
            case 'attachments': {
                const total = Number(state.totalFiles) || 0;
                return total > 0
                    ? `${attaching}（${Number(state.copiedFiles) || 0}/${total}）…`
                    : `${attaching}…`;
            }
            default:
                return this.t('storageMigrationWorking', '正在迁移数据…');
        }
    },

    // 切换到新的存储目录后热重载界面（不整页刷新，避免 WebView 重建页面时的整体白闪）
    // 各模块复用自身的淡入淡出过渡，不叠加全局遮罩，避免遮罩自身的一闪
    async reloadAfterStorageSwitch(message) {
        try {
            await window.App?.reloadAfterDataReplaced();
            await this.updateDataFileConfig();
            Utils.showToast(message || window.languageManager.getText('settingsSuccess', '设置成功'), 'success');
        } catch (error) {
            logger.error('Failed to reload after storage switch:', error);
            Utils.showToast(window.languageManager.getText('refreshDataFailed', '刷新数据失败'), 'error');
        } finally {
            this.setDirectoryButtonsDisabled(false);
        }
    },

    // 迁移是把数据复制到新目录，原目录的完整副本会保留下来，提示用户并提供一键清理
    offerStorageBackupCleanup(backupPath) {
        Utils.showToast(`${this.t('storageBackupKept', '旧数据仍保留在原目录：')}${backupPath}`, 'info');
        Utils.confirmDialog(
            `${this.t('storageBackupCleanupConfirm', '是否清理原目录中保留的旧数据备份？清理后新目录的数据不受影响。')}\n\n${backupPath}`,
            async () => {
                await Utils.apiCall({
                    apiMethod: 'cleanup_previous_storage_backup',
                    onSuccess: (res) => Utils.showToast(res?.data || this.t('settingsSuccess', '设置成功'), 'success'),
                    onError: (error) => {
                        const reason = String(error?.message || '').replace(/^"|"$/g, '').trim();
                        Utils.showToast(reason || this.t('settingsFailed', '设置失败'), 'error');
                    }
                });
            }
        );
    },

    setDirectoryButtonsDisabled(disabled) {
        // 设置目录配置按钮的禁用状态
        const buttons = [this.applyDirBtn, this.dataDirBtn];
        buttons.forEach(btn => {
            if (btn) btn.disabled = disabled;
        });

        // 更新输入框状态
        if (this.dataDirBtn) this.dataDirBtn.disabled = disabled;
    }
});

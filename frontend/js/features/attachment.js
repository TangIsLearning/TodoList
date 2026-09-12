// 任务附件管理模块
// 负责：任务表单中的附件选择/展示/移除，任务详情中的附件展示与打开

const ATTACHMENT_MAX_COUNT = 5;
const ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

class AttachmentManager {
    constructor(todoManager) {
        this.todo = todoManager;
        // items: 已存在附件(含 id) 或 待新增附件(含 tempId)
        this.items = [];
        this._tempSeq = 0;
        this.cacheDomRefs();
        this.bindEvents();
    }

    getText(key, fallback) {
        return window.languageManager ? window.languageManager.getText(key, fallback) : fallback;
    }

    cacheDomRefs() {
        this.listEl = document.getElementById('attachment-list');
        this.countEl = document.getElementById('attachment-count');
        this.addFileBtn = document.getElementById('attachment-add-file-btn');
        this.addLinkBtn = document.getElementById('attachment-add-link-btn');
        // 在线链接弹窗
        this.linkModal = document.getElementById('attachment-link-modal');
        this.linkNameInput = document.getElementById('attachment-link-name');
        this.linkUrlInput = document.getElementById('attachment-link-url');
        this.linkSaveBtn = document.getElementById('attachment-link-save');
        this.linkCancelBtn = document.getElementById('attachment-link-cancel');
        this.linkCloseBtn = document.getElementById('attachment-link-close');
    }

    bindEvents() {
        this.addFileBtn?.addEventListener('click', () => this.addFiles());
        this.addLinkBtn?.addEventListener('click', () => this.openLinkModal());
        this.linkSaveBtn?.addEventListener('click', () => this.confirmAddLink());
        this.linkCancelBtn?.addEventListener('click', () => this.closeLinkModal());
        this.linkCloseBtn?.addEventListener('click', () => this.closeLinkModal());
        // 表单附件移除（事件委托）
        this.listEl?.addEventListener('click', (e) => {
            const btn = e.target.closest('.attachment-remove');
            if (btn) {
                this.removeItem(btn.dataset.key);
            }
        });
    }

    // ==================== 表单（新建/编辑） ====================

    reset() {
        this.items = [];
        this._tempSeq = 0;
        this.renderFormList();
    }

    loadFromTask(task) {
        this.items = (task && task.attachments ? task.attachments : []).map(att => ({
            id: att.id,
            type: att.type,
            name: att.name,
            url: att.url || '',
            filePath: att.filePath || '',
            size: att.size,
            isImage: !!att.isImage
        }));
        this._tempSeq = 0;
        this.renderFormList();
    }

    removeItem(key) {
        this.items = this.items.filter(item => this._itemKey(item) !== key);
        this.renderFormList();
    }

    async addFiles() {
        if (this.items.length >= ATTACHMENT_MAX_COUNT) {
            Utils.showToast(this.getText('attachmentMaxReached', '最多只能添加 {count} 个附件').replace('{count}', ATTACHMENT_MAX_COUNT), 'warning');
            return;
        }

        await Utils.apiCall({
            apiMethod: 'select_attachment_files',
            onSuccess: (response) => {
                const files = response.data || [];
                let skippedBySize = 0;
                for (const file of files) {
                    if (this.items.length >= ATTACHMENT_MAX_COUNT) break;
                    if (file.size && file.size > ATTACHMENT_MAX_SIZE) {
                        skippedBySize++;
                        continue;
                    }
                    this.items.push({
                        tempId: `new_${Date.now()}_${this._tempSeq++}`,
                        type: 'file',
                        name: file.name,
                        sourcePath: file.path,
                        size: file.size,
                        isImage: !!file.isImage
                    });
                }
                if (skippedBySize > 0) {
                    Utils.showToast(this.getText('attachmentTooLarge', '单个附件不能超过 10MB，已忽略 {count} 个文件').replace('{count}', skippedBySize), 'warning');
                }
                this.renderFormList();
            },
            onError: () => {
                // 用户取消选择属于正常操作，不提示错误
            }
        });
    }

    openLinkModal() {
        if (this.items.length >= ATTACHMENT_MAX_COUNT) {
            Utils.showToast(this.getText('attachmentMaxReached', '最多只能添加 {count} 个附件').replace('{count}', ATTACHMENT_MAX_COUNT), 'warning');
            return;
        }
        if (this.linkNameInput) this.linkNameInput.value = '';
        if (this.linkUrlInput) this.linkUrlInput.value = '';
        Utils.ModalManager.show('attachment-link-modal');
        setTimeout(() => this.linkUrlInput?.focus(), 150);
    }

    closeLinkModal() {
        Utils.ModalManager.hide('attachment-link-modal');
    }

    confirmAddLink() {
        const url = (this.linkUrlInput?.value || '').trim();
        const name = (this.linkNameInput?.value || '').trim();
        if (!url) {
            Utils.showToast(this.getText('attachmentLinkRequired', '请输入链接地址'), 'warning');
            return;
        }
        if (!Utils.isValidUrl(url)) {
            Utils.showToast(this.getText('attachmentLinkInvalid', '链接地址格式不正确'), 'warning');
            return;
        }
        this.items.push({
            tempId: `new_${Date.now()}_${this._tempSeq++}`,
            type: 'link',
            name: name || url,
            url: url
        });
        this.closeLinkModal();
        this.renderFormList();
    }

    renderFormList() {
        if (!this.listEl) return;

        if (this.items.length === 0) {
            this.listEl.innerHTML = `<div class="attachment-empty">${this.getText('attachmentEmpty', '暂无附件')}</div>`;
        } else {
            this.listEl.innerHTML = this.items.map(item => {
                const key = this._itemKey(item);
                const icon = this._itemIcon(item);
                const sizeText = item.type === 'file' && item.size
                    ? ` <span class="attachment-size">${this.formatSize(item.size)}</span>` : '';
                return `
                    <div class="attachment-item">
                        <span class="attachment-item-icon">${icon}</span>
                        <span class="attachment-item-name" title="${Utils.escapeHtml(item.name)}">${Utils.escapeHtml(item.name)}</span>
                        ${sizeText}
                        <button type="button" class="attachment-remove" data-key="${key}" title="${this.getText('delete', '删除')}">&times;</button>
                    </div>
                `;
            }).join('');
        }

        if (this.countEl) {
            this.countEl.textContent = `${this.items.length}/${ATTACHMENT_MAX_COUNT}`;
        }
        const reached = this.items.length >= ATTACHMENT_MAX_COUNT;
        if (this.addFileBtn) this.addFileBtn.disabled = reached;
        if (this.addLinkBtn) this.addLinkBtn.disabled = reached;
    }

    getAttachments() {
        return this.items.map(item => {
            if (item.id) {
                return {
                    id: item.id,
                    type: item.type,
                    name: item.name,
                    url: item.url || null
                };
            }
            if (item.type === 'link') {
                return { type: 'link', name: item.name, url: item.url };
            }
            return {
                type: 'file',
                name: item.name,
                sourcePath: item.sourcePath,
                size: item.size
            };
        });
    }

    _itemKey(item) {
        return item.id || item.tempId;
    }

    _itemIcon(item) {
        if (item.type === 'link') return '🔗';
        return item.isImage ? '🖼️' : '📎';
    }

    formatSize(size) {
        if (!size && size !== 0) return '';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ==================== 任务详情 ====================

    buildDetailHtml(task) {
        const attachments = task && task.attachments ? task.attachments : [];
        let inner;
        if (attachments.length === 0) {
            inner = `<span style="color: var(--text-secondary);">${this.getText('noTaskAttachments', '无附件')}</span>`;
        } else {
            inner = attachments.map(att => {
                const sizeText = att.type === 'file' && att.size
                    ? ` <span class="attachment-size">(${this.formatSize(att.size)})</span>` : '';
                return `
                    <a href="javascript:void(0)" class="detail-attachment-link" data-attachment-id="${att.id}">
                        <span class="attachment-item-icon">${this._itemIcon(att)}</span>
                        <span class="detail-attachment-name">${Utils.escapeHtml(att.name)}</span>${sizeText}
                    </a>
                `;
            }).join('');
        }

        return `
            <div style="grid-column: 1 / -1;">
                <strong style="display: block; color: var(--text-secondary); margin-bottom: 8px; font-size: 14px;">
                    ${this.getText('taskAttachments', '附件')} (${attachments.length})
                </strong>
                <div class="detail-attachment-list">${inner}</div>
            </div>
        `;
    }

    bindDetailEvents(task) {
        const attachments = task && task.attachments ? task.attachments : [];
        document.querySelectorAll('.detail-attachment-link[data-attachment-id]').forEach(el => {
            el.onclick = () => {
                const att = attachments.find(a => a.id === el.dataset.attachmentId);
                if (att) this.openAttachment(att);
            };
        });
    }

    openAttachment(att) {
        if (att.type === 'link') {
            this.openExternal(att);
            return;
        }
        // 由后端统一判断访问模式：
        // - local：桌面端且未开启同步，直接打开本地文件
        // - remote：移动端或已开启同步，拼接云端地址下载
        Utils.apiCall({
            apiMethod: 'get_attachment_access_mode',
            onSuccess: (response) => {
                const mode = (response.data && response.data.mode) || 'local';
                if (mode === 'remote') {
                    this.openViaDownloadUrl(att);
                } else {
                    this.openLocalFile(att);
                }
            },
            onError: () => this.openLocalFile(att)
        });
    }

    openExternal(att) {
        Utils.apiCall({
            apiMethod: 'open_attachment',
            apiArgs: [att.id],
            onError: () => {
                if (att.url) {
                    window.open(att.url, '_blank');
                } else {
                    Utils.showToast(this.getText('attachmentOpenFailed', '打开附件失败'), 'error');
                }
            }
        });
    }

    // 本地模式：使用系统默认程序打开；失败时提示并打开文件所在目录
    openLocalFile(att) {
        Utils.apiCall({
            apiMethod: 'open_attachment',
            apiArgs: [att.id],
            onError: () => {
                Utils.showToast(this.getText('attachmentOpenFallback', '无法直接打开附件，已为你打开文件所在目录，请手动打开'), 'warning');
                Utils.apiCall({
                    apiMethod: 'reveal_attachment',
                    apiArgs: [att.id],
                    onError: () => Utils.showToast(this.getText('attachmentRevealFailed', '无法打开文件所在目录'), 'error')
                });
            }
        });
    }

    // 云模式：拼接云端（WebDAV）地址，点击后下载，由用户自行打开
    openViaDownloadUrl(att) {
        Utils.apiCall({
            apiMethod: 'get_attachment_download_url',
            apiArgs: [att.id],
            onSuccess: (response) => {
                const url = response.data && response.data.url;
                if (url) {
                    window.open(url, '_blank');
                } else {
                    Utils.showToast(this.getText('attachmentOpenFailed', '打开附件失败'), 'error');
                }
            },
            onError: () => Utils.showToast(this.getText('attachmentOpenFailed', '打开附件失败'), 'error')
        });
    }
}

window.AttachmentManager = AttachmentManager;

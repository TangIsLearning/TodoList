/**
 * 设置中心 - 快捷键配置（mixin）
 * 依赖：settings/settings.js（SettingsUIManager 类）
 */

Object.assign(SettingsUIManager.prototype, {

    // ==================== 快捷键配置 ====================

    // 更新快捷键配置
    async updateShortcutConfig() {
        if (!this.smartKeyShow) return;

        let shortcut = localStorage.getItem('todolist_shortcut');
        if (shortcut) {
            this.smartKeyShow.textContent = shortcut;
            return;
        }

        await Utils.apiCall({
            apiMethod: 'get_config',
            apiArgs: ['shortcut'],
            onSuccess: (response) => {
                localStorage.setItem('todolist_shortcut', response.data.shortcut);
                this.smartKeyShow.textContent = response.data.shortcut;
            },
            onError: (error) => {
                this.smartKeyShow.textContent = '<ctrl>+<space>';
            }
        });
    },

    // 更新快捷操作开关状态
    async updateShortcutToggleState() {
        if (!this.shortcutToggle) return;

        let enabled = localStorage.getItem('todolist_shortcut_enabled');
        if (!enabled) {
            await Utils.apiCall({
                apiMethod: 'get_config',
                apiArgs: ['shortcut_enabled'],
                onSuccess: (response) => {
                    enabled = response.data.shortcut_enabled.toString();
                    localStorage.setItem('todolist_shortcut_enabled', enabled);
                }
            });
        }
        const isEnabled = enabled === 'true';
        this.shortcutToggle.checked = isEnabled;
        this.setShortcutEditable(isEnabled);
    },

    // 设置快捷操作配置是否可编辑
    setShortcutEditable(enabled) {
        if (this.smartKeyShow) {
            this.smartKeyShow.disabled = !enabled;
            this.smartKeyShow.style.opacity = enabled ? '' : '0.5';
        }
        if (this.smartKeyApply) {
            this.smartKeyApply.disabled = !enabled;
            this.smartKeyApply.style.opacity = enabled ? '' : '0.5';
        }
    },

    // 切换快捷操作开关
    async toggleShortcut() {
        if (!this.shortcutToggle) return;

        const enabled = this.shortcutToggle.checked;

        await Utils.apiCall({
            apiMethod: 'set_config',
            apiArgs: ['shortcut_enabled', enabled],
            onSuccess: (response) => {
                localStorage.setItem('todolist_shortcut_enabled', enabled.toString());
                this.setShortcutEditable(enabled);
                Utils.showToast(enabled ?
                    `${window.languageManager.getText('settingsShortcutEnabled', '快捷操作已启用')}, ${window.languageManager.getText('settingsShortcutNeedRestart', '请重启应用后尝试')}` :
                    `${window.languageManager.getText('settingsShortcutDisabled', '快捷操作已禁用')}, ${window.languageManager.getText('settingsShortcutNeedRestart', '请重启应用后尝试')}`,
                    'success');
            },
            onError: (error) => {
                this.setShortcutEditable(!enabled);
                Utils.showToast(window.languageManager.getText('settingsFailed', '设置失败'), 'error');
            }
        });
    },

    // ==================== 快捷按键录制 ====================

    // 获取按键显示名称
    getKeyDisplayName(key) {
        const keyMap = {
            ' ': '<space>',
            'Space': '<space>',
            'Enter': '<enter>',
            'Backspace': '<backspace>',
            'Tab': '<tab>',
            'Escape': '<esc>',
            'ArrowUp': '<↑>',
            'ArrowDown': '<↓>',
            'ArrowLeft': '<←>',
            'ArrowRight': '<→>',
            'Minus': '-',
            'Equal': '='
        };
        if (keyMap[key]) return keyMap[key];
        return key.toLowerCase();
    },

    // 获取当前按下的所有修饰键
    getActiveModifiers() {
        const modifiers = [];
        if (this.currentModifiers?.ctrl) modifiers.push('<ctrl>');
        if (this.currentModifiers?.alt) modifiers.push('<alt>');
        if (this.currentModifiers?.shift) modifiers.push('<shift>');
        if (this.currentModifiers?.meta) modifiers.push('<win>');
        return modifiers;
    },

    // 格式化组合键显示
    formatComboKey(mainKey) {
        const modifiers = this.getActiveModifiers();
        const mainDisplay = this.getKeyDisplayName(mainKey);

        if (modifiers.length === 0) return mainDisplay;
        return [...modifiers, mainDisplay].join('+');
    },

    // 重置修饰键状态
    resetModifiers() {
        this.currentModifiers = {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false
        };
    },

    // 处理按键按下
    handleKeyDown(e) {
        // 1. 同步修饰键状态
        this.currentModifiers.ctrl = e.ctrlKey;
        this.currentModifiers.alt = e.altKey;
        this.currentModifiers.shift = e.shiftKey;
        this.currentModifiers.meta = e.metaKey;

        const key = e.key;
        e.preventDefault();

        // 如果是单纯的修饰键本身，不作为主键录入
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

        // 2. 【Mac 修复核心】：如果是字母或数字键，使用 e.code 提取干净的物理键名
        let mainKey = key;
        if (e.code && e.code.startsWith('Key')) {
            // 例如 "KeyA" 截取后变成 "a"
            mainKey = e.code.replace('Key', '').toLowerCase();
        } else if (e.code && e.code.startsWith('Digit')) {
            // 例如 "Digit1" 截取后变成 "1"
            mainKey = e.code.replace('Digit', '');
        }

        // 3. 获取组合键名称并显示
        let comboName = this.formatComboKey(mainKey);
        this.smartKeyShow.textContent = comboName;
    },

    // 处理按键释放
    handleKeyUp(e) {
    // 同步最新的修饰键状态
        this.currentModifiers.ctrl = e.ctrlKey;
        this.currentModifiers.alt = e.altKey;
        this.currentModifiers.shift = e.shiftKey;
        this.currentModifiers.meta = e.metaKey;
    }
});

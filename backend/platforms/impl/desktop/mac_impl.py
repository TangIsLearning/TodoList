# impl/desktop/mac_impl.py

import sys
from backend.platforms.interface.service import PlatformService
from typing import Tuple, Optional

class MacService(PlatformService):
    def shortcut_handler(self, shortcut, handler):
        from quickmachotkey import quickHotKey, mask
        from quickmachotkey.constants import (
            kVK_ANSI_A, kVK_ANSI_B, kVK_ANSI_C, kVK_ANSI_D, kVK_ANSI_E,
            kVK_ANSI_F, kVK_ANSI_G, kVK_ANSI_H, kVK_ANSI_I, kVK_ANSI_J,
            kVK_ANSI_K, kVK_ANSI_L, kVK_ANSI_M, kVK_ANSI_N, kVK_ANSI_O,
            kVK_ANSI_P, kVK_ANSI_Q, kVK_ANSI_R, kVK_ANSI_S, kVK_ANSI_T,
            kVK_ANSI_U, kVK_ANSI_V, kVK_ANSI_W, kVK_ANSI_X, kVK_ANSI_Y,
            kVK_ANSI_Z,
            kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5,
            kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9, kVK_ANSI_0,
            kVK_Space, kVK_Return, kVK_Tab, kVK_Escape, kVK_Delete, kVK_ForwardDelete,
            kVK_LeftArrow, kVK_RightArrow, kVK_UpArrow, kVK_DownArrow,
            kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8,
            kVK_F9, kVK_F10, kVK_F11, kVK_F12,
            cmdKey, controlKey, optionKey, shiftKey
        )

        # ============ 1. 映射表定义 ============

        # pynput 修饰符字符串 -> quickmachotkey 修饰符常量
        MODIFIER_MAP = {
            '<ctrl>': controlKey,
            '<cmd>': cmdKey,
            '<command>': cmdKey,
            '<alt>': optionKey,
            '<option>': optionKey,
            '<shift>': shiftKey,
        }

        # pynput 特殊键名 -> quickmachotkey 虚拟键码
        SPECIAL_KEY_MAP = {
            '<space>': kVK_Space,
            '<enter>': kVK_Return,
            '<return>': kVK_Return,
            '<tab>': kVK_Tab,
            '<esc>': kVK_Escape,
            '<escape>': kVK_Escape,
            '<backspace>': kVK_Delete,
            '<delete>': kVK_ForwardDelete,
            '<up>': kVK_UpArrow,
            '<down>': kVK_DownArrow,
            '<left>': kVK_LeftArrow,
            '<right>': kVK_RightArrow,
            '<f1>': kVK_F1,
            '<f2>': kVK_F2,
            '<f3>': kVK_F3,
            '<f4>': kVK_F4,
            '<f5>': kVK_F5,
            '<f6>': kVK_F6,
            '<f7>': kVK_F7,
            '<f8>': kVK_F8,
            '<f9>': kVK_F9,
            '<f10>': kVK_F10,
            '<f11>': kVK_F11,
            '<f12>': kVK_F12,
        }

        # 显式获取正确的子模块对象
        constants_mod = sys.modules['quickmachotkey.constants']

        LETTER_KEY_MAP = {
            chr(ord('a') + i): getattr(constants_mod, f"kVK_ANSI_{chr(ord('A') + i)}")
            for i in range(26)
        }

        DIGIT_KEY_MAP = {
            str(i): getattr(constants_mod, f"kVK_ANSI_{i}")
            for i in range(10)
        }

        def get_virtual_key_for_char(char: str) -> Optional[int]:
            """根据单个字符返回对应的虚拟键码"""
            if char in LETTER_KEY_MAP:
                return LETTER_KEY_MAP[char]
            if char in DIGIT_KEY_MAP:
                return DIGIT_KEY_MAP[char]
            return None

        def parse_pynput_shortcut(shortcut_str: str) -> Tuple[int, int]:
            """解析 pynput 风格的快捷键字符串，返回 (virtual_key, modifier_mask)"""
            shortcut_str = shortcut_str.replace('meta', 'cmd').replace('win', 'cmd').replace('control', 'ctrl')
            # 按 '+' 分割
            parts = shortcut_str.lower().split('+')
            if len(parts) < 1:
                raise ValueError(f"无效的快捷键格式: {shortcut_str}")

            modifiers = 0
            virtual_key = None

            for part in parts:
                # 处理修饰符
                if part in MODIFIER_MAP:
                    modifiers |= MODIFIER_MAP[part]
                # 处理特殊键
                elif part in SPECIAL_KEY_MAP:
                    if virtual_key is not None:
                        raise ValueError(f"快捷键 '{shortcut_str}' 包含多个主键，最后一个为 '{part}'")
                    virtual_key = SPECIAL_KEY_MAP[part]
                # 处理字母或数字
                elif len(part) == 1 and part.isalnum():
                    if virtual_key is not None:
                        raise ValueError(f"快捷键 '{shortcut_str}' 包含多个主键，最后一个为 '{part}'")
                    vk = get_virtual_key_for_char(part)
                    if vk is None:
                        raise ValueError(f"不支持的按键: {part}")
                    virtual_key = vk
                else:
                    raise ValueError(f"无法识别的键: {part}")

            if virtual_key is None:
                raise ValueError(f"快捷键 '{shortcut_str}' 中没有指定主键")

            return virtual_key, mask(*([modifiers] if modifiers else []))

        try:
            # 使用装饰器语法生成快捷键绑定
            virtual_key, modifier_mask = parse_pynput_shortcut(shortcut)

            # 使用 quickHotKey 装饰器注册
            @quickHotKey(virtualKey=virtual_key, modifierMask=modifier_mask)
            def macos_shortcut_handler():
                print("【快捷键触发】系统 RunLoop 捕获到 Option+Space，执行 UI 切换")
                handler()

            # 重要：保存注册引用，否则快捷键会在函数结束后失效
            print("【主线程】macOS 全局快捷键注册成功，无后台常驻线程。")
            return macos_shortcut_handler

        except Exception as e:
            print(f"快捷键注册失败: {e}")

    def force_kill_process_tree(self, pid):
        """强制结束当前进程及其所有子进程的统一接口"""
        import subprocess
        import time
        # 优雅终止 (SIGTERM)
        subprocess.run(['kill', '-TERM', str(pid)])
        time.sleep(2)
        # 强制终止 (SIGKILL)
        subprocess.run(['kill', '-KILL', str(pid)])
        # 强制终止所有子进程，使用 pgrep -P 查找并传递给 kill -9[reference:5]
        subprocess.run(f'pgrep -P {pid} | xargs kill -9', shell=True)

    def get_log_directory(self):
        """返回可写的日志目录的统一接口"""
        from pathlib import Path
        # macOS: 使用 ~/Library/Logs/TodoList
        home = Path.home()
        log_dir = home / 'Library' / 'Logs' / 'TodoList'
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir

    def get_app_icon(self, base_path):
        """获取应用图标的统一接口"""
        return base_path / 'todo_icon.icns'

    def is_ssl_enable(self):
        """获取是否开启ssl的统一接口"""
        # MacOS端开启后存在不影响使用的warning
        return False

    def is_default_hide(self):
        """获取是否隐藏快捷键窗口的统一接口"""
        return True

    def icon_exit(self):
        """图标注销消息的统一接口"""
        pass

    def start_prepare(self):
        """应用启动前准备工作的统一接口"""
        # 强制在主线程预热 TIS API，防止后台线程后续并发调用导致崩溃
        import ctypes
        import ctypes.util

        try:
            # 加载 Carbon 框架并调用一次获取当前输入源
            carbon = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/Carbon.framework/Carbon')
            carbon.TISCopyCurrentKeyboardInputSource()
        except Exception:
            pass

    def start_keyboard(self, webview):
        """应用启用快捷键的统一接口"""
        from backend.platforms.impl.desktop.common.smart_task import SmartTaskInput
        SmartTaskInput(webview)

    def start_desktop_task_reminder(self, is_start, event=None):
        """应用桌面端消息提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import start_reminder, stop_reminder
        if is_start:
            start_reminder(click_event=event)
        else:
            stop_reminder()

    def add_new_desktop_task_reminder(self):
        """应用桌面端新任务添加消息提醒的统一接口"""
        from backend.platforms.impl.desktop.common.task_reminder import get_reminder
        # 重置已提醒任务列表，确保新任务可以被提醒
        reminder = get_reminder()
        reminder.reset_notified_tasks()

    def check_calendar_permission(self):
        """校验日历使用权限的统一接口"""
        pass

    def add_task_reminder_to_calendar(self, title, desc, start_time_ms):
        """添加任务提醒到日历的统一接口"""
        pass

    def sync_reminder_to_calendar(self, sync_start_time, sync_end_time):
        """同步任务提醒到日历的统一接口"""
        pass

    def add_firewall_rule(self, port):
        """添加防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需配置防火墙"

    def remove_firewall_rule(self, port):
        """移除防火墙策略规则的统一接口"""
        return True, "非Windows系统，无需操作防火墙"

# 用于给工厂注册的导出变量
ExportService = MacService

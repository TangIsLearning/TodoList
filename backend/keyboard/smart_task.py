import tkinter as tk
from datetime import datetime, timedelta
from pynput import keyboard
import re

from backend.database.operations import TodoDatabase

class SmartTaskInput:
    def __init__(self):
        self.window = None
        self.entry = None
        self.hint_label = None
        self.hint_frame = None
        self.db = TodoDatabase()
        self.setup_keyboard()
        self.create_window()
        self.categories = [item['name'] for item in self.db.get_all_categories()]

    def create_window(self):
        """创建主窗口"""
        self.window = tk.Tk()
        self.window.title("Smart Task")
        self.window.overrideredirect(True)  # 无边框
        self.window.attributes('-topmost', True)  # 置顶
        self.window.configure(bg='#1e1e1e')

        # 设置窗口大小和位置
        width, height = 500, 80
        screen_width = self.window.winfo_screenwidth()
        screen_height = self.window.winfo_screenheight()
        x = (screen_width - width) // 2
        y = (screen_height - height) // 3
        self.window.geometry(f'{width}x{height}+{x}+{y}')

        # 主容器
        main_frame = tk.Frame(self.window, bg='#1e1e1e')
        main_frame.pack(fill='both', expand=True, padx=10, pady=(10, 5))

        # 输入框
        self.entry = tk.Entry(
            main_frame,
            font=('Consolas', 14),
            bg='#2d2d2d',
            fg='#ffffff',
            insertbackground='#ffffff',
            relief='flat',
            highlightthickness=1,
            highlightcolor='#4CAF50',
            highlightbackground='#3d3d3d'
        )
        self.entry.pack(fill='x', ipady=8)
        self.entry.focus()

        # 提示框架
        self.hint_frame = tk.Frame(self.window, bg='#1e1e1e', height=30)
        self.hint_frame.pack(fill='x', padx=10, pady=(0, 5))
        self.hint_frame.pack_propagate(False)

        # 提示标签
        self.hint_label = tk.Label(
            self.hint_frame,
            text='输入任务内容... 使用 #标签 @时间 *分类',
            font=('Segoe UI', 9),
            bg='#1e1e1e',
            fg='#808080',
            anchor='w'
        )
        self.hint_label.pack(fill='both', expand=True)

        # 绑定事件
        self.entry.bind('<KeyRelease>', self.on_key_release)
        self.entry.bind('<Return>', self.save_task)
        self.entry.bind('<Escape>', lambda e: self.hide_window())
        self.entry.bind('<Tab>', self.auto_complete)

        # 初始隐藏
        self.window.withdraw()

    def parse_time_string(self, time_str):
        """解析时间字符串"""
        now = datetime.now()
        time_str = time_str.strip()

        try:
            # 相对时间：1h, 2h30m, 1d, 1d12h
            if re.match(r'^\d+[hdm]+$', time_str.lower()):
                delta = timedelta()
                parts = re.findall(r'(\d+)([hdm])', time_str.lower())
                for value, unit in parts:
                    value = int(value)
                    if unit == 'h':
                        delta += timedelta(hours=value)
                    elif unit == 'd':
                        delta += timedelta(days=value)
                    elif unit == 'm':
                        delta += timedelta(minutes=value)
                return now + delta

            # 今日时间：1130, 1430
            elif re.match(r'^\d{4}$', time_str):
                hour = int(time_str[:2])
                minute = int(time_str[2:])
                if 0 <= hour <= 23 and 0 <= minute <= 59:
                    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if target < now:
                        target += timedelta(days=1)
                    return target

            # 完整日期时间：YYYYMMDDHHMM
            elif re.match(r'^\d{12}$', time_str):
                year = int(time_str[:4])
                month = int(time_str[4:6])
                day = int(time_str[6:8])
                hour = int(time_str[8:10])
                minute = int(time_str[10:12])
                return datetime(year, month, day, hour, minute)

            # 月日时间：MMDDHHMM (如11300001 = 11月30日00:01)
            elif re.match(r'^\d{8}$', time_str):
                month = int(time_str[:2])
                day = int(time_str[2:4])
                hour = int(time_str[4:6])
                minute = int(time_str[6:8])
                year = now.year
                target = datetime(year, month, day, hour, minute)
                if target < now:
                    target = datetime(year + 1, month, day, hour, minute)
                return target

        except Exception as e:
            print(f"时间解析错误: {e}")

        return None

    def parse_input(self, text):
        """解析输入内容"""
        result = {
            'title': text,
            'tags': [],
            'categoryId': None,
            'category': None,
            'dueDate': None,
            'is_valid': True,
            'error_message': '',
            'priority': 'none',
            'description': '',
            'completed': False,
            'isRecurring': False,
        }

        # 检查是否在开头输入特殊符号（违法）
        if text and text[0] in ['#', '@', '*']:
            result['is_valid'] = False
            result['error_message'] = f'不能在开头使用 {text[0]} 符号'
            return result

        # 提取标签 #
        tag_pattern = r'#(\w+)'
        tags = re.findall(tag_pattern, text)
        result['tags'] = tags
        content = re.sub(tag_pattern, '', text)

        # 提取时间 @
        time_pattern = r'@(\S+)'
        time_match = re.search(time_pattern, content)
        if time_match:
            time_str = time_match.group(1)
            due_time = self.parse_time_string(time_str)
            if due_time:
                result['dueDate'] = due_time.strftime("%Y-%m-%d %H:%M")
            else:
                result['is_valid'] = False
                result['error_message'] = f'无效的时间格式: {time_str}'
            content = re.sub(time_pattern, '', content)

        # 提取分类 *
        category_pattern = r'\*(\S+)'
        category_match = re.search(category_pattern, content)
        if category_match:
            category = category_match.group(1)
            category_id = next((item['id'] for item in self.db.get_all_categories() if item['name'] == category), None)
            if category_id:
                result['categoryId'] = category_id
                result['category'] = category
            else:
                result['is_valid'] = False
                result['error_message'] = f'未知分类: {category}, 可用分类: {", ".join(self.categories)}'
            content = re.sub(category_pattern, '', content)

        result['title'] = content.strip()

        # 检查内容是否为空
        if not result['title']:
            result['is_valid'] = False
            result['error_message'] = '任务内容不能为空'

        return result

    def generate_hint(self, text):
        """生成智能提示"""
        if not text:
            return '输入任务内容... 使用 #标签 @时间 *分类', '#808080'

        # 检查开头违法
        if text and text[0] in ['#', '@', '*']:
            return f'❌ 不能在开头使用 {text[0]} 符号', '#ff6b6b'

        # 解析当前位置
        cursor_pos = self.entry.index(tk.INSERT)
        text_before_cursor = text[:cursor_pos]

        hints = []

        # 检查是否在输入标签
        if '#' in text_before_cursor:
            last_hash = text_before_cursor.rfind('#')
            if last_hash >= 0:
                tag_text = text_before_cursor[last_hash + 1:cursor_pos]
                hints.append(f'📌 标签: {tag_text or "输入标签名"}')

        # 检查是否在输入时间
        if '@' in text_before_cursor:
            last_at = text_before_cursor.rfind('@')
            if last_at >= 0:
                time_text = text_before_cursor[last_at + 1:cursor_pos]
                if not time_text:
                    hints.append('⏰ 时间格式: 1h(1小时) 1d(1天) 1130(11:30) 202412312359')
                else:
                    parsed = self.parse_time_string(time_text)
                    if parsed:
                        hints.append(f'⏰ 将提醒于: {parsed.strftime("%Y-%m-%d %H:%M")}')
                    else:
                        hints.append(f'⏰ 无效格式: {time_text}')

        # 检查是否在输入分类
        if '*' in text_before_cursor:
            last_star = text_before_cursor.rfind('*')
            if last_star >= 0:
                cat_text = text_before_cursor[last_star + 1:cursor_pos]
                if not cat_text:
                    hints.append(f'📂 可用分类(支持使用tab自动模糊补全): {", ".join(self.categories)}')
                else:
                    matches = [c for c in self.categories if c.startswith(cat_text)]
                    if matches:
                        hints.append(f'📂 分类: {matches[0]}')
                        if len(matches) > 1:
                            hints.append(f'   (还有 {len(matches) - 1} 个匹配)')

        # 显示解析结果预览
        if text and not any(s in text_before_cursor for s in ['#', '@', '*']):
            parsed = self.parse_input(text)
            if parsed['is_valid']:
                preview = []
                if parsed['tags']:
                    preview.append(f"📌 {', '.join(parsed['tags'])}")
                if parsed['dueDate']:
                    preview.append(f"⏰ {parsed['dueDate'].strftime('%m-%d %H:%M')}")
                if parsed['categoryId']:
                    preview.append(f"📂 {parsed['category']}")
                if preview:
                    hints.append(' | '.join(preview))
            elif parsed['error_message']:
                return f'❌ {parsed["error_message"]}', '#ff6b6b'

        if hints:
            return '  •  '.join(hints), '#4CAF50'

        return '输入任务内容... 使用 #标签 @时间 *分类', '#808080'

    def on_key_release(self, event):
        """按键释放事件"""
        text = self.entry.get()
        hint_text, color = self.generate_hint(text)

        self.hint_label.config(text=hint_text, fg=color)

    def auto_complete(self, event):
        """Tab自动补全"""
        text = self.entry.get()
        cursor_pos = self.entry.index(tk.INSERT)
        text_before = text[:cursor_pos]

        # 补全分类
        if '*' in text_before:
            last_star = text_before.rfind('*')
            cat_start = text_before[last_star + 1:]
            matches = [item for item in self.categories if cat_start in item]
            if len(matches) == 1:
                remaining = matches[0]
                self.entry.delete(last_star + 1, cursor_pos)
                self.entry.insert(last_star + 1, remaining)
                return 'break'

        return None

    def save_task(self, event=None):
        """保存任务"""
        text = self.entry.get().strip()
        if not text:
            self.hide_window()
            return

        parsed = self.parse_input(text)

        if not parsed['is_valid']:
            self.hint_label.config(text=f'❌ {parsed["error_message"]}', fg='#ff6b6b')
            return

        # 保存到数据库
        self.db.add_task(parsed)

        # 显示成功提示
        self.hint_label.config(text='✓ 任务已保存！', fg='#4CAF50')
        self.entry.delete(0, tk.END)

        # 延迟隐藏
        self.window.after(1000, self.hide_window)

    def hide_window(self):
        """隐藏窗口"""
        self.window.withdraw()
        self.entry.delete(0, tk.END)
        self.hint_label.config(
            text='输入任务内容... 使用 #标签 @时间 *分类',
            fg='#808080'
        )

    def show_window(self):
        """显示窗口"""
        self.window.deiconify()
        self.entry.focus()

    def toggle_window(self):
        """切换窗口显示/隐藏"""
        if self.window.state() == 'withdrawn':
            self.show_window()
        else:
            self.hide_window()

    def setup_keyboard(self):
        """设置全局快捷键"""

        def on_activate():
            self.window.after(0, self.toggle_window)

        listener = keyboard.GlobalHotKeys({'<ctrl>+<space>': on_activate})
        listener.start()

    def run(self):
        """运行应用"""
        self.window.mainloop()
from datetime import datetime, timedelta
import re

from backend.database.operations import TodoDatabase

font_color_other = '#b85c00'
font_color_white = '#ffffff'
background_color_error = '#ff6b6b'
background_color_success = '#4CAF50'
background_color_warning = '#fff9e8'
default_warning = '💡 输入任务内容... 使用 #标签 *分类 @时间'

class SmartTaskInput:
    def __init__(self, webview=None):
        self.window = None
        self.is_hide = True
        self.value = None
        self.input_element = None
        self.db = TodoDatabase()
        self.create_window(webview)
        self.categories = [item['name'] for item in self.db.get_all_categories()]
        self.setup_keyboard()
        self._hotkey_ref = None  # MacOS：必须持有快捷键引用的句柄，防止被 GC 垃圾回收

    def on_closing(self):
        """窗口关闭点击事件：仅首次关闭弹窗提醒"""
        self.window.hide()
        self.is_hide = True
        return False

    def render_warning_content(self, hint_text, color, background_color):
        """渲染提示文本和样式"""
        import json
        js_hint = json.dumps(hint_text)
        js_color = json.dumps(color)
        js_bg = json.dumps(background_color)

        # 通过 JS 脚本安全安全赋值，杜绝 Unexpected EOF 错误
        self.window.evaluate_js(f"""
            var el = document.querySelector('#warning');
            if (el) {{
                el.textContent = {js_hint};
                el.style.color = {js_color};
                el.style.backgroundColor = {js_bg};
            }}
        """)

    def handle_input_change(self, event):
        """当输入框内容变化时，此函数会被触发"""
        # 1. 安全获取 target，如果不存在则返回空字典
        target = event.get('target', {})
        # 2. 安全获取 value，如果清空了或不存在则返回空字符串 ""
        self.value = target.get('value', "")
        if self.value != "":
            hint_text, color, background_color = self.generate_hint()
            self.render_warning_content(hint_text, color, background_color)

    def create_window(self, webview):
        """创建主窗口"""
        loading_html = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
            <title>智能输入助手 - 动态转换与计算</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    align-items: center;
                    justify-content: center;
                    font-family: 'Segoe UI', 'Roboto', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
                    width: 100%;
                    backdrop-filter: blur(0px);
                    box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.2), 0 1px 2px rgba(0,0,0,0.05);
                    transition: all 0.2s ease;
                    overflow: hidden;
                }
                .input-field {
                    width: 100%;
                    font-size: 1.1rem;
                    font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', monospace;
                    background: #ffffff;
                    border: none;
                    resize: vertical;
                    transition: 0.2s;
                    outline: none;
                    color: #0f172a;
                    font-weight: 500;
                    line-height: 1.4;
                    padding: 1rem;
                }
                .input-field::placeholder {
                    color: #94a3b8;
                    font-weight: 400;
                    font-family: monospace;
                }
                /* 静态警告区域 */
                .warning {
                    background: #fff9e8;
                    border: 1px solid #ffecb3;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 0.8rem;
                    font-size: 0.8rem;
                    color: #b85c00;
                    font-weight: 500;
                    padding: 0.8rem;
                }
            </style>
        </head>
        <body>
            <!-- 输入区 -->
            <input type="text" class="input-field" id="input-field"
                   placeholder="完成xx任务 #A项目 *工作 @1d" autocomplete="off">
            <!-- 静态警告信息 (模仿图中样式) -->
            <div class="warning" id="warning">💡 输入任务内容... 使用 #标签 *分类 @时间</div>
        </body>
        </html>
        """

        from backend.platforms.core.factory import get_platform_service
        service = get_platform_service()
        self.is_hide = service.is_default_hide()

        self.window = webview.create_window(
            'TodoList',
            html=loading_html,  # 【关键】改用 html= 启动，不传递文件路径
            js_api=None,  # 此时先不绑定 API，等全加载完后再载入
            width=760,
            height=100,
            text_select=True,
            resizable=True,
            frameless=True,
            easy_drag=True,
            hidden=self.is_hide
        )
        self.window.events.closing += self.on_closing
        self.input_element = self.window.dom.get_element('#input-field')
        self.input_element.events.input += self.handle_input_change
        self.input_element.events.keydown += self.handle_keydown
        if not self.is_hide:
            self.window.hide()

    def handle_keydown(self, event):
        """监听键盘事件，当按下回车键时触发"""
        # 检查按下的键是否为 'Tab'
        if event['key'] == 'Tab':
            # 获取输入框的当前值
            self.auto_complete()
            self.input_element.value = self.value
            if self.value != "":
                hint_text, color, background_color = self.generate_hint()
                self.render_warning_content(hint_text, color, background_color)
        # 检查按下的键是否为 'Enter'
        if event['key'] == 'Enter':
            # 获取输入框的当前值
            self.save_task()

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

    def generate_hint(self):
        """生成智能提示"""
        text = self.value
        if not text:
            return default_warning, font_color_other, background_color_warning

        # 检查开头违法
        if text and text[0] in ['#', '@', '*']:
            return f'❌ 不能在开头使用 {text[0]} 符号', font_color_white, background_color_error

        # 解析当前位置
        cursor_pos = len(self.value)
        text_before_cursor = text[:cursor_pos]

        hints = []

        # 检查是否在输入标签
        if '#' in text_before_cursor:
            hints.clear()
            last_hash = text_before_cursor.rfind('#')
            if last_hash >= 0:
                tag_text = text_before_cursor[last_hash + 1:cursor_pos]
                hints.append(f'📌 标签: {tag_text or "输入标签名"}')

        # 检查是否在输入时间
        if '@' in text_before_cursor:
            hints.clear()
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
            hints.clear()
            last_star = text_before_cursor.rfind('*')
            if last_star >= 0:
                cat_text = text_before_cursor[last_star + 1:cursor_pos]
                if not cat_text:
                    hints.append(f'📂 可用分类(支持使用tab自动模糊补全): {", ".join(self.categories)}')
                elif not cat_text.strip():
                    hints.append(f'📂 无效分类: {cat_text}')
                else:
                    matches = [c for c in self.categories if c.startswith(cat_text.strip())]
                    if matches:
                        hints.append(f'📂 分类: {matches[0]}')
                    else:
                        hints.append(f'📂 无效分类: {cat_text}')

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
                return f'❌ {parsed["error_message"]}', font_color_white, background_color_error

        if hints:
            return '  •  '.join(hints), font_color_white, background_color_success

        return default_warning, font_color_other, background_color_warning

    def auto_complete(self):
        """Tab自动补全"""
        cursor_pos = len(self.value)
        text_before = self.value[:cursor_pos]

        # 补全分类
        if '*' in text_before:
            last_star = text_before.rfind('*')
            cat_start = text_before[last_star + 1:]
            matches = [item for item in self.categories if cat_start in item]
            if len(matches) == 1:
                remaining = matches[0]
                self.value = self.value[:(last_star + 1)] + self.value[cursor_pos:]
                self.value = self.value + remaining
                return remaining

        return None

    def save_task(self):
        """保存任务"""
        import time
        text = self.value.strip()
        if not text:
            self.window.hide()
            return

        parsed = self.parse_input(text)

        if not parsed['is_valid']:
            self.render_warning_content(f'❌ {parsed["error_message"]}', font_color_white, background_color_error)
            return

        # 保存到数据库
        self.db.add_task(parsed)

        # 显示成功提示
        self.render_warning_content('✓ 任务已保存！', font_color_white, background_color_success)

        time.sleep(1)
        self.window.hide()
        self.is_hide = True
        self.render_warning_content(default_warning, font_color_other, background_color_warning)

    def toggle_window(self):
        """切换窗口显示/隐藏"""
        if self.is_hide:
            self.window.show()
            self.window.on_top = True
            self.is_hide = False
        else:
            self.window.hide()
            self.window.on_top = False
            self.is_hide = True

    def setup_keyboard(self):
        """设置全局快捷键"""
        from backend.utils.logger import app_logger
        try:
            from backend.platforms.core.factory import get_platform_service
            service = get_platform_service()
            raw_shortcut = self.db.get_setting('shortcut', '<ctrl>+<space>').strip().lower()
            self._hotkey_ref = service.shortcut_handler(raw_shortcut, self.toggle_window)
        except Exception as e:
            app_logger.info(f"设置全局快捷键发生异常: {e}")
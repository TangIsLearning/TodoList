import json
import sqlite3
from typing import Any, Dict

class SettingCrudMixin:
    def get_setting(self, key: str, default_value: Any = None) -> Any:
        """获取单个设置值"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
            result = cursor.fetchone()

            if result is None:
                return default_value

            # 尝试解析 JSON
            try:
                return json.loads(result[0])
            except json.JSONDecodeError:
                return result[0]

    def set_setting(self, key: str, value: Any) -> None:
        """保存单个设置值"""
        # 将值转换为 JSON 字符串
        if isinstance(value, (dict, list, bool)):
            value_str = json.dumps(value)
        elif isinstance(value, str):
            value_str = value
        else:
            value_str = json.dumps(value)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', (key, value_str))
            conn.commit()

    def delete_setting(self, key: str) -> None:
        """删除单个设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM settings WHERE key = ?', (key,))
            conn.commit()

    def get_all_settings(self) -> Dict[str, Any]:
        """获取所有设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT key, value FROM settings')
            results = cursor.fetchall()

            settings = {}
            for key, value in results:
                try:
                    settings[key] = json.loads(value)
                except json.JSONDecodeError:
                    settings[key] = value

            return settings

    def reset_settings(self) -> None:
        """重置所有设置"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM settings')
            conn.commit()
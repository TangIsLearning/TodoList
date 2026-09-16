# backend/database/mixins/setting_crud_mixin.py
import json
from typing import Any, Dict


class SettingCrudMixin:
    """应用设置（键值对，值为 JSON 字符串）"""

    @staticmethod
    def _decode(raw: str) -> Any:
        """尽量把存储值还原为 Python 对象，失败时返回原始字符串。"""
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return raw

    @staticmethod
    def _encode(value: Any) -> str:
        """把设置值序列化为存储字符串。"""
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False)

    def get_setting(self, key: str, default_value: Any = None) -> Any:
        """获取单个设置值"""
        with self.query() as conn:
            row = conn.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
        if row is None:
            return default_value
        return self._decode(row['value'])

    def set_setting(self, key: str, value: Any) -> None:
        """保存单个设置值"""
        with self.tx() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                (key, self._encode(value))
            )

    def delete_setting(self, key: str) -> None:
        """删除单个设置"""
        with self.tx() as conn:
            conn.execute('DELETE FROM settings WHERE key = ?', (key,))

    def get_all_settings(self) -> Dict[str, Any]:
        """获取所有设置"""
        with self.query() as conn:
            rows = conn.execute('SELECT key, value FROM settings').fetchall()
        return {row['key']: self._decode(row['value']) for row in rows}

    def reset_settings(self) -> None:
        """重置所有设置"""
        with self.tx() as conn:
            conn.execute('DELETE FROM settings')

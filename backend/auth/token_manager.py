"""
API Token 管理模块
用于生成、验证和管理 API 访问令牌
"""

import secrets
import hashlib
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from pathlib import Path

from backend.database.operations import TodoDatabase
from backend.utils.logger import backend_logger


class TokenManager:
    """API Token 管理器"""

    # Token 设置相关的键
    TOKEN_SETTINGS_KEY = "api_token_config"
    TOKEN_HASH_KEY = "api_token_hash"
    TOKEN_CREATED_AT_KEY = "api_token_created_at"
    TOKEN_EXPIRES_AT_KEY = "api_token_expires_at"
    TOKEN_ENABLED_KEY = "api_token_enabled"

    def __init__(self):
        self.db = TodoDatabase()

    def generate_token(self, expires_days: int = 365) -> str:
        """
        生成新的 API Token

        Args:
            expires_days: Token 有效期（天），默认 365 天，0 表示永不过期

        Returns:
            生成的 Token 字符串
        """
        # 生成随机 Token
        token = secrets.token_urlsafe(32)

        # 计算过期时间
        now = datetime.now()
        if expires_days > 0:
            expires_at = (now + timedelta(days=expires_days)).isoformat()
        else:
            expires_at = None

        # 存储 Token 的哈希值（不存储明文）
        token_hash = self._hash_token(token)

        # 保存到设置
        self.db.set_setting(self.TOKEN_HASH_KEY, token_hash)
        self.db.set_setting(self.TOKEN_CREATED_AT_KEY, now.isoformat())

        if expires_at:
            self.db.set_setting(self.TOKEN_EXPIRES_AT_KEY, expires_at)
        else:
            self.db.delete_setting(self.TOKEN_EXPIRES_AT_KEY)

        self.db.set_setting(self.TOKEN_ENABLED_KEY, True)

        backend_logger.info(f"生成新的 API Token，过期时间：{expires_at or '永不过期'}")

        # 返回明文 Token（仅此一次）
        return token

    def _hash_token(self, token: str) -> str:
        """对 Token 进行哈希"""
        return hashlib.sha256(token.encode()).hexdigest()

    def validate_token(self, token: str) -> Dict[str, Any]:
        """
        验证 Token 是否有效

        Args:
            token: 待验证的 Token

        Returns:
            {'valid': bool, 'error': str}
        """
        # 检查是否启用了 API Token
        enabled = self.db.get_setting(self.TOKEN_ENABLED_KEY, False)
        if not enabled:
            return {'valid': False, 'error': 'API 访问未启用'}

        # 获取存储的哈希值
        stored_hash = self.db.get_setting(self.TOKEN_HASH_KEY)
        if not stored_hash:
            return {'valid': False, 'error': '未生成 API Token'}

        # 验证 Token
        token_hash = self._hash_token(token)
        if token_hash != stored_hash:
            return {'valid': False, 'error': 'Token 无效'}

        # 检查过期时间
        expires_at = self.db.get_setting(self.TOKEN_EXPIRES_AT_KEY)
        if expires_at:
            try:
                expires_time = datetime.fromisoformat(expires_at)
                if datetime.now() > expires_time:
                    return {'valid': False, 'error': 'Token 已过期'}
            except ValueError:
                pass

        return {'valid': True, 'error': None}

    def get_token_info(self) -> Dict[str, Any]:
        """
        获取当前 Token 信息（不包含 Token 明文）

        Returns:
            Token 信息字典
        """
        enabled = self.db.get_setting(self.TOKEN_ENABLED_KEY, False)
        created_at = self.db.get_setting(self.TOKEN_CREATED_AT_KEY)
        expires_at = self.db.get_setting(self.TOKEN_EXPIRES_AT_KEY)
        has_token = bool(self.db.get_setting(self.TOKEN_HASH_KEY))

        # 检查是否过期
        is_expired = False
        if expires_at:
            try:
                expires_time = datetime.fromisoformat(expires_at)
                is_expired = datetime.now() > expires_time
            except ValueError:
                pass

        return {
            'enabled': enabled,
            'has_token': has_token,
            'created_at': created_at,
            'expires_at': expires_at,
            'is_expired': is_expired,
            'is_valid': enabled and has_token and not is_expired
        }

    def revoke_token(self) -> bool:
        """
        撤销当前 Token

        Returns:
            是否成功撤销
        """
        try:
            self.db.delete_setting(self.TOKEN_HASH_KEY)
            self.db.delete_setting(self.TOKEN_CREATED_AT_KEY)
            self.db.delete_setting(self.TOKEN_EXPIRES_AT_KEY)
            self.db.set_setting(self.TOKEN_ENABLED_KEY, False)
            backend_logger.info("API Token 已撤销")
            return True
        except Exception as e:
            backend_logger.error(f"撤销 Token 失败：{e}")
            return False

    def enable_api_access(self) -> bool:
        """启用 API 访问"""
        try:
            self.db.set_setting(self.TOKEN_ENABLED_KEY, True)
            backend_logger.info("API 访问已启用")
            return True
        except Exception as e:
            backend_logger.error(f"启用 API 访问失败：{e}")
            return False

    def disable_api_access(self) -> bool:
        """禁用 API 访问"""
        try:
            self.db.set_setting(self.TOKEN_ENABLED_KEY, False)
            backend_logger.info("API 访问已禁用")
            return True
        except Exception as e:
            backend_logger.error(f"禁用 API 访问失败：{e}")
            return False

    def get_api_access_status(self) -> Dict[str, Any]:
        """获取 API 访问状态"""
        token_info = self.get_token_info()
        enabled = self.db.get_setting(self.TOKEN_ENABLED_KEY, False)

        return {
            'enabled': enabled,
            'has_token': token_info['has_token'],
            'is_valid': token_info['is_valid'],
            'is_expired': token_info['is_expired'],
            'created_at': token_info['created_at'],
            'expires_at': token_info['expires_at']
        }


# 全局 Token Manager 实例
_token_manager: Optional[TokenManager] = None


def get_token_manager() -> TokenManager:
    """获取全局 TokenManager 实例"""
    global _token_manager
    if _token_manager is None:
        _token_manager = TokenManager()
    return _token_manager

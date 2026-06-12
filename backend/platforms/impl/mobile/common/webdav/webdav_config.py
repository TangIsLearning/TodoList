"""
坚果云WebDAV配置模块
"""

from typing import Dict, Any

from backend.config_manager import get_config_manager

# WebDAV配置常量
WEBDAV_CONFIG_KEY = 'webdav_config'

def get_webdav_config() -> Dict[str, Any]:
    """获取WebDAV配置"""
    config = get_config_manager().get(WEBDAV_CONFIG_KEY, {})
    return {
        'enabled': config.get('enabled', False),
        'username': config.get('username', ''),
        'password': config.get('password', ''),
        'remote_path': config.get('remote_path', ''),
        'auto_sync': config.get('auto_sync', True),
        'sync_interval': config.get('sync_interval', 15),  # 默认 15s
        'first_sync_mode': config.get('first_sync_mode', 'remote_overwrite')  # 默认远程覆盖本地
    }


def set_webdav_config(config: Dict[str, Any]) -> bool:
    """设置WebDAV配置"""
    # 验证配置
    if not isinstance(config, dict):
        raise ValueError("配置必须是字典类型")

    # 验证必要字段
    enabled = config.get('enabled', False)
    if enabled:
        username = config.get('username', '')
        password = config.get('password', '')
        remote_path = config.get('remote_path', '')
        if not username or not password or not remote_path:
            raise ValueError("启用WebDAV时，用户名、密码和远程文件路径不能为空")

    # 设置默认值
    webdav_config = {
        'enabled': bool(enabled),
        'username': str(config.get('username', '')),
        'password': str(config.get('password', '')),
        'remote_path': str(config.get('remote_path', '')),
        'auto_sync': bool(config.get('auto_sync', True)),
        'sync_interval': int(config.get('sync_interval', 15)),
        'first_sync_mode': str(config.get('first_sync_mode', 'remote_overwrite'))  # local_overwrite | remote_overwrite
    }

    return get_config_manager().set(WEBDAV_CONFIG_KEY, webdav_config)


def is_webdav_enabled() -> bool:
    """检查WebDAV是否启用"""
    config = get_webdav_config()
    return config.get('enabled', False) and config.get('username') and config.get('password') and config.get(
        'remote_path')
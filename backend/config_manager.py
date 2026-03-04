"""
外部配置管理器
用于管理不依赖数据库的配置信息，避免循环依赖问题
"""

import os
import json
import platform
from pathlib import Path
from typing import Optional, Dict, Any

from backend.config import ANDROID_PRIMARY_USR_DIR, ANDROID_PRIMARY_DATA_DIR, ANDROID_EXTERNAL_DIR, ANDROID_PACKAGE_NAME

class ConfigManager:
    """外部配置管理器，独立于数据库"""
    
    def __init__(self):
        self.config_file = self._get_config_file_path()
        self.config = self._load_config()
    
    def _is_android(self) -> bool:
        """检测是否为Android系统"""
        try:
            # 方法1: 检查platform信息
            if platform.system() == 'Linux':
                # 方法2: 检查Android特有的环境变量
                if os.environ.get('ANDROID_ROOT') or os.environ.get('ANDROID_DATA'):
                    return True
                
                # 方法3: 检查Android特有的系统文件
                android_files = [
                    '/system/build.prop',
                    '/system/framework/framework-res.apk',
                    '/proc/version'
                ]
                
                for file_path in android_files:
                    if file_path == '/proc/version':
                        # 特殊处理/proc/version
                        try:
                            with open(file_path, 'r') as f:
                                content = f.read().lower()
                                if 'android' in content:
                                    return True
                        except:
                            continue
                    else:
                        if os.path.exists(file_path):
                            return True
            
            # 方法4: 检查是否在Termux环境中
            if 'com.termux' in os.environ.get('PREFIX', '') or \
               'termux' in os.environ.get('PATH', '').lower():
                return True
                
            return False
        except Exception:
            return False
    
    def _get_config_file_path(self) -> Path:
        """获取配置文件路径"""
        # 在用户目录下创建配置文件，避免权限问题
        if os.name == 'nt':  # Windows
            config_dir = Path(os.environ.get('APPDATA', '')) / 'TodoList'
        elif self._is_android():  # Android系统
            # Android应用配置目录
            android_config_dirs = [
                Path(ANDROID_PRIMARY_USR_DIR + '/files/.config'),  # 私有存储
                Path(ANDROID_EXTERNAL_DIR + '/files'),   # 外部存储
                Path.home() / '.config'  # 备用方案
            ]
            
            # 尝试使用第一个可写的目录
            config_dir = None
            for dir_path in android_config_dirs:
                try:
                    dir_path.mkdir(parents=True, exist_ok=True)
                    if os.access(dir_path, os.W_OK):
                        config_dir = dir_path / 'TodoList'
                        break
                except:
                    continue
            
            # 如果都没有权限，则使用应用私有目录
            if config_dir is None:
                config_dir = Path(ANDROID_PRIMARY_DATA_DIR + '/shared_prefs') / 'TodoList'
                config_dir.mkdir(parents=True, exist_ok=True)
                
        else:  # Unix-like systems (Linux/macOS)
            config_dir = Path.home() / '.config' / 'TodoList'
        
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir / 'app_config.json'
    
    def _load_config(self) -> Dict[str, Any]:
        """加载配置文件"""
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"警告：配置文件读取失败: {e}")
                return {}
        return {}
    
    def _save_config(self) -> bool:
        """保存配置文件"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            return True
        except IOError as e:
            print(f"警告：配置文件保存失败: {e}")
            return False
    
    def get(self, key: str, default: Any = None) -> Any:
        """获取配置项"""
        return self.config.get(key, default)
    
    def set(self, key: str, value: Any) -> bool:
        """设置配置项"""
        self.config[key] = value
        return self._save_config()
    
    def delete(self, key: str) -> bool:
        """删除配置项"""
        if key in self.config:
            del self.config[key]
            return self._save_config()
        return True
    
    def get_data_file(self) -> str:
        """获取数据文件配置"""
        # 优先级：配置文件 > 环境变量 > 默认文件
        config_file = self.get('data_file')
        if config_file and isinstance(config_file, str):
            return config_file
        
        env_file = os.environ.get('TODO_DATA_FILE')
        if env_file:
            return env_file
            
        # 返回默认文件
        project_root = Path(__file__).parent.parent
        
        # Android系统使用专用的数据目录
        if self._is_android():
            # Android数据文件目录
            android_data_dirs = [
                Path(ANDROID_PRIMARY_USR_DIR + '/databases'),  # 应用私有数据库目录
                Path(ANDROID_EXTERNAL_DIR + '/databases'),  # 外部存储
                project_root / 'data'  # 开发环境备用
            ]
            
            # 尝试使用第一个可写的目录
            for dir_path in android_data_dirs:
                try:
                    dir_path.mkdir(parents=True, exist_ok=True)
                    if os.access(dir_path, os.W_OK):
                        return str(dir_path / 'todo.db')
                except:
                    continue
            
            # 如果都不可写，使用应用私有目录
            private_dir = Path(ANDROID_PRIMARY_DATA_DIR + '/databases')
            private_dir.mkdir(parents=True, exist_ok=True)
            return str(private_dir / 'todo.db')
        
        return str(project_root / 'data' / 'todo.db')
    
    def set_data_file(self, path: str) -> bool:
        """设置数据文件配置"""
        if not path or not isinstance(path, str):
            raise ValueError("数据文件路径不能为空")
        
        path_obj = Path(path)
        
        # 检查扩展名
        if path_obj.suffix.lower() not in ['.db']:
            raise ValueError("仅支持 .db 文件")
        
        # 检查路径是否存在，不存在则创建父目录
        if not path_obj.parent.exists():
            try:
                path_obj.parent.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                raise ValueError(f"无法创建目录 {path_obj.parent}: {e}")
        
        # 检查权限
        if path_obj.exists() and not os.access(path, os.R_OK | os.W_OK):
            raise PermissionError(f"没有对文件 {path} 的读写权限")
        elif not path_obj.exists() and not os.access(path_obj.parent, os.W_OK):
            raise PermissionError(f"没有在目录 {path_obj.parent} 创建文件的权限")
        
        # 保存配置
        success = self.set('data_file', path)
        if success:
            print(f"数据文件配置已保存到外部配置文件: {path}")
        return success

# WebDAV配置常量
WEBDAV_CONFIG_KEY = 'webdav_config'

# 全局配置管理器实例
_config_manager: Optional[ConfigManager] = None

def get_config_manager() -> ConfigManager:
    """获取全局配置管理器实例"""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager()
    return _config_manager

def get_data_file() -> str:
    """获取数据文件（便捷函数）"""
    return get_config_manager().get_data_file()

def set_data_file(path: str) -> bool:
    """设置数据文件（便捷函数）"""
    return get_config_manager().set_data_file(path)

def get_webdav_config() -> Dict[str, Any]:
    """获取WebDAV配置"""
    config = get_config_manager().get(WEBDAV_CONFIG_KEY, {})
    return {
        'enabled': config.get('enabled', False),
        'username': config.get('username', ''),
        'password': config.get('password', ''),
        'remote_path': config.get('remote_path', ''),
        'auto_sync': config.get('auto_sync', True),
        'sync_interval': config.get('sync_interval', 15)  # 默认15s
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
        'sync_interval': int(config.get('sync_interval', 15))
    }
    
    return get_config_manager().set(WEBDAV_CONFIG_KEY, webdav_config)

def is_webdav_enabled() -> bool:
    """检查WebDAV是否启用"""
    config = get_webdav_config()
    return config.get('enabled', False) and config.get('username') and config.get('password') and config.get('remote_path')
"""
外部配置管理器
用于管理不依赖数据库的配置信息，避免循环依赖问题
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any

class ConfigManager:
    """外部配置管理器，独立于数据库"""
    
    def __init__(self):
        self.config_file = self._get_config_file_path()
        self.config = self._load_config()
    
    def _get_config_file_path(self) -> Path:
        """获取配置文件路径"""
        # 在用户目录下创建配置文件，避免权限问题
        if os.name == 'nt':  # Windows
            config_dir = Path(os.environ.get('APPDATA', '')) / 'TodoList'
        else:  # Unix-like systems
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
    
    def get_data_directory(self) -> str:
        """获取数据目录配置"""
        # 优先级：配置文件 > 环境变量 > 默认目录
        config_dir = self.get('data_directory')
        if config_dir and isinstance(config_dir, str):
            return config_dir
        
        env_dir = os.environ.get('TODO_DATA_DIR')
        if env_dir:
            return env_dir
            
        # 返回默认目录
        project_root = Path(__file__).parent.parent
        return str(project_root / 'data')
    
    def set_data_directory(self, path: str) -> bool:
        """设置数据目录配置"""
        if not path or not isinstance(path, str):
            raise ValueError("数据目录路径不能为空")
        
        path_obj = Path(path)
        
        # 检查路径是否存在，不存在则创建
        if not path_obj.exists():
            try:
                path_obj.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                raise ValueError(f"无法创建目录 {path}: {e}")
        
        # 检查是否有读写权限
        if not os.access(path, os.R_OK | os.W_OK):
            raise PermissionError(f"没有对目录 {path} 的读写权限")
        
        # 保存配置
        success = self.set('data_directory', path)
        if success:
            print(f"数据目录配置已保存到外部配置文件: {path}")
        return success

# 全局配置管理器实例
_config_manager: Optional[ConfigManager] = None

def get_config_manager() -> ConfigManager:
    """获取全局配置管理器实例"""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager()
    return _config_manager

def get_data_directory() -> str:
    """获取数据目录（便捷函数）"""
    return get_config_manager().get_data_directory()

def set_data_directory(path: str) -> bool:
    """设置数据目录（便捷函数）"""
    return get_config_manager().set_data_directory(path)
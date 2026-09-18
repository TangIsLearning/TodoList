"""外部配置管理器

负责应用配置的持久化：一个跨进程存活的 JSON 文件及其读写。

刻意不掺入任何「数据存到哪」的判断——那是 backend.storage 的职责。这里既不知道
应用数据目录在磁盘上的哪个位置，也不参与目录迁移，因此存储层可以放心依赖它，
而不会反过来形成循环（storage → config_manager，单向）。
"""

import os
import json
from pathlib import Path
from typing import Any, Dict, Optional

from backend.config import ANDROID_PRIMARY_USR_DIR, ANDROID_PRIMARY_DATA_DIR, ANDROID_EXTERNAL_DIR
from backend.platforms.detection import is_android
from backend.utils.logger import LogManager


class ConfigManager(LogManager):
    """外部配置管理器，独立于数据库"""

    def __init__(self) -> None:
        super().__init__()
        self.config_file: Path = self._get_config_file_path()
        self.config: Dict[str, Any] = self._load_config()

    def _get_config_file_path(self) -> Path:
        """获取配置文件路径"""
        # 在用户目录下创建配置文件，避免权限问题
        if os.name == 'nt':  # Windows
            config_dir = Path(os.environ.get('APPDATA', '')) / 'TodoList'
        elif is_android():  # Android系统
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
                self.get_logger.error(f"警告：配置文件读取失败: {e}")
                return {}
        return {}

    def _save_config(self) -> bool:
        """保存配置文件"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            return True
        except IOError as e:
            self.get_logger.error(f"警告：配置文件保存失败: {e}")
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


# 全局配置管理器实例
_config_manager: Optional[ConfigManager] = None


def get_config_manager() -> ConfigManager:
    """获取全局配置管理器实例"""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager()
    return _config_manager

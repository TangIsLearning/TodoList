"""外部配置管理器

负责应用配置的持久化：一个跨进程存活的 JSON 文件及其读写。

刻意不掺入任何「数据存到哪」的判断——那是 backend.storage 的职责。这里既不知道
应用数据目录在磁盘上的哪个位置，也不参与目录迁移，因此存储层可以放心依赖它，
而不会反过来形成循环（storage → config_manager，单向）。
"""

import json
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

from backend.utils.logger import LogManager


class ConfigManager(LogManager):
    """外部配置管理器，独立于数据库"""

    def __init__(self) -> None:
        super().__init__()
        self.config_file: Path = self._resolve_config_file()
        self.config: Dict[str, Any] = self._load_config()

    def _resolve_config_file(self) -> Path:
        """确定配置文件位置；任何异常都不允许向外抛出

        配置管理器在启动阶段被多处实例化（存储层、WebDAV 同步等），一旦抛异常
        就是「应用起不来」级别的故障，因此这里做最终兜底，宁可丢配置也不中断启动。
        """
        try:
            return self._get_config_file_path()
        except Exception as e:
            fallback = Path(tempfile.gettempdir()) / 'TodoList' / 'app_config.json'
            try:
                self.get_logger.error(f"配置文件目录解析失败，已退回临时目录: {e}", exc_info=True)
                fallback.parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            return fallback

    def _get_config_file_path(self) -> Path:
        """获取配置文件路径

        目录位置由平台决定（Windows 走 APPDATA、Unix 走 XDG、Android 走应用私有
        目录并逐级降级），这里不再自行判断运行环境。
        """
        config_dir = Path(self.service.get_config_dir())
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

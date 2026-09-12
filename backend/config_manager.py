"""
外部配置管理器
用于管理不依赖数据库的配置信息，避免循环依赖问题
"""

import os
import json
import platform
import shutil
from pathlib import Path
from typing import Optional, Dict, Any
from backend.config import ANDROID_PRIMARY_USR_DIR, ANDROID_PRIMARY_DATA_DIR, ANDROID_EXTERNAL_DIR, ANDROID_PACKAGE_NAME
from backend.utils.logger import LogManager

class ConfigManager(LogManager):
    """外部配置管理器，独立于数据库"""

    # 存储目录结构：<用户选择的目录>/todolist/{todo.db, attachment/}
    STORAGE_DIR_NAME = 'todolist'
    ATTACHMENT_DIR_NAME = 'attachment'
    DB_FILE_NAME = 'todo.db'

    def __init__(self) -> None:
        super().__init__()
        self.config_file: Path = self._get_config_file_path()
        self.config: Dict[str, Any] = self._load_config()
        # 存储根目录缓存，避免重复计算与迁移
        self._storage_dir: Optional[Path] = None
    
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
    
    def _get_default_storage_dir(self) -> Path:
        """获取默认的存储根目录（用户未配置时）"""
        import sys

        # Android 系统优先使用应用可写目录
        if self._is_android():
            android_dirs = [
                Path(ANDROID_PRIMARY_USR_DIR + '/files'),
                Path(ANDROID_EXTERNAL_DIR + '/files'),
                Path.home() / '.todolist'
            ]
            for dir_path in android_dirs:
                try:
                    dir_path.mkdir(parents=True, exist_ok=True)
                    if os.access(str(dir_path), os.W_OK):
                        return dir_path
                except Exception:
                    continue
            fallback = Path(ANDROID_PRIMARY_DATA_DIR + '/files')
            fallback.mkdir(parents=True, exist_ok=True)
            return fallback

        # 打包环境（PyInstaller）下的处理
        if getattr(sys, 'frozen', False):
            if platform.system() == 'Windows':
                appdata = os.environ.get('APPDATA') or os.environ.get('LOCALAPPDATA')
                base = Path(appdata) / 'TodoList' if appdata else Path.home() / '.todolist'
                base.mkdir(parents=True, exist_ok=True)
                return base
            if os.environ.get('APPIMAGE') is not None:
                base = Path.home() / '.todolist'
                base.mkdir(parents=True, exist_ok=True)
                return base

        # 开发/默认环境：项目根目录
        return Path(__file__).parent.parent

    def _get_legacy_default_data_file(self) -> Optional[Path]:
        """获取旧版本默认的数据文件位置（用于迁移）"""
        import sys
        candidates = []
        if self._is_android():
            candidates.extend([
                Path(ANDROID_PRIMARY_USR_DIR + '/databases/todo.db'),
                Path(ANDROID_EXTERNAL_DIR + '/databases/todo.db'),
            ])
        elif getattr(sys, 'frozen', False):
            if platform.system() == 'Windows':
                appdata = os.environ.get('APPDATA') or os.environ.get('LOCALAPPDATA')
                candidates.append(
                    (Path(appdata) / 'TodoList' / 'data' / 'todo.db') if appdata
                    else (Path.home() / '.todolist' / 'data' / 'todo.db')
                )
            elif os.environ.get('APPIMAGE') is not None:
                candidates.append(Path.home() / '.todolist' / 'data' / 'todo.db')

        candidates.append(Path(__file__).parent.parent / 'data' / 'todo.db')
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return None

    def _ensure_storage_layout(self, base_dir: Path, legacy_file: Optional[Path] = None) -> None:
        """确保存储目录结构存在（<base>/todolist/{todo.db, attachment}），必要时迁移旧数据文件"""
        base_dir = Path(base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)
        app_dir = base_dir / self.STORAGE_DIR_NAME
        app_dir.mkdir(parents=True, exist_ok=True)
        (app_dir / self.ATTACHMENT_DIR_NAME).mkdir(parents=True, exist_ok=True)

        if legacy_file is None:
            return

        try:
            legacy_file = Path(legacy_file)
            new_file = app_dir / self.DB_FILE_NAME
            if legacy_file.exists() and not new_file.exists() \
                    and legacy_file.resolve() != new_file.resolve():
                new_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_file), str(new_file))
                self.get_logger.info(f"已迁移旧数据文件: {legacy_file} -> {new_file}")
        except Exception as e:
            self.get_logger.error(f"迁移旧数据文件失败: {e}")

    def get_storage_dir(self) -> Path:
        """获取数据存储根目录

        优先级：
        1. 新配置 storage_dir（用户选择的存储目录）
        2. 旧配置 data_file（兼容老版本，取其父目录作为存储目录并迁移文件）
        3. 环境变量 TODO_STORAGE_DIR / TODO_DATA_FILE
        4. 默认目录
        """
        if self._storage_dir is not None:
            return self._storage_dir

        # 1. 新配置：存储目录
        dir_config = self.get('storage_dir')
        if dir_config and isinstance(dir_config, str):
            base_dir = Path(dir_config)
            self._ensure_storage_layout(base_dir)
            self._storage_dir = base_dir
            return base_dir

        # 2. 旧配置：数据文件路径（适配老版本，迁移到新结构）
        legacy = self.get('data_file')
        if legacy and isinstance(legacy, str):
            legacy_file = Path(legacy)
            base_dir = legacy_file.parent
            self._ensure_storage_layout(base_dir, legacy_file)
            self._storage_dir = base_dir
            return base_dir

        # 3. 环境变量
        env_dir = os.environ.get('TODO_STORAGE_DIR')
        if env_dir:
            base_dir = Path(env_dir)
            self._ensure_storage_layout(base_dir)
            self._storage_dir = base_dir
            return base_dir

        env_file = os.environ.get('TODO_DATA_FILE')
        if env_file:
            legacy_file = Path(env_file)
            base_dir = legacy_file.parent
            self._ensure_storage_layout(base_dir, legacy_file)
            self._storage_dir = base_dir
            return base_dir

        # 4. 默认目录（同时迁移旧默认位置的数据）
        base_dir = self._get_default_storage_dir()
        self._ensure_storage_layout(base_dir, self._get_legacy_default_data_file())
        self._storage_dir = base_dir
        return base_dir

    def get_app_dir(self) -> Path:
        """获取应用数据目录（<存储目录>/todolist）"""
        app_dir = self.get_storage_dir() / self.STORAGE_DIR_NAME
        app_dir.mkdir(parents=True, exist_ok=True)
        return app_dir

    def get_attachment_dir(self) -> Path:
        """获取附件根目录（<存储目录>/todolist/attachment）"""
        attach_dir = self.get_app_dir() / self.ATTACHMENT_DIR_NAME
        attach_dir.mkdir(parents=True, exist_ok=True)
        return attach_dir

    def get_data_file(self) -> str:
        """获取数据文件路径（位于存储目录下的 todolist/todo.db）"""
        app_dir = self.get_app_dir()
        return str(app_dir / self.DB_FILE_NAME)

    def set_storage_dir(self, path: str) -> bool:
        """设置存储目录"""
        if not path or not isinstance(path, str):
            raise ValueError("存储目录不能为空")

        path_obj = Path(path)
        if path_obj.exists() and not path_obj.is_dir():
            raise ValueError("请选择一个目录，而不是文件")

        try:
            path_obj.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise ValueError(f"无法创建目录 {path_obj}: {e}")

        if not os.access(str(path_obj), os.W_OK):
            raise PermissionError(f"没有对目录 {path} 的写权限")

        # 若旧目录存在数据且新目录没有，则迁移，保证数据不丢失
        legacy_db: Optional[Path] = None
        try:
            legacy_db = Path(self.get_data_file())
        except Exception:
            legacy_db = None

        self._ensure_storage_layout(path_obj, legacy_db)

        success = self.set('storage_dir', str(path_obj))
        if success:
            self._storage_dir = path_obj
            # 清理旧的文件路径配置，避免后续继续使用旧逻辑
            self.delete('data_file')
            self.get_logger.info(f"存储目录配置已保存到外部配置文件: {path_obj}")
        return success

    def set_data_file(self, path: str) -> bool:
        """【兼容旧接口】设置数据文件路径，实际转换为设置其所属存储目录"""
        if not path or not isinstance(path, str):
            raise ValueError("数据文件路径不能为空")
        return self.set_storage_dir(str(Path(path).parent))

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

def get_storage_dir() -> Path:
    """获取存储目录（便捷函数）"""
    return get_config_manager().get_storage_dir()

def get_app_dir() -> Path:
    """获取应用数据目录（便捷函数）"""
    return get_config_manager().get_app_dir()

def get_attachment_dir() -> Path:
    """获取附件根目录（便捷函数）"""
    return get_config_manager().get_attachment_dir()

def set_data_file(path: str) -> bool:
    """设置数据文件（便捷函数，兼容旧接口）"""
    return get_config_manager().set_data_file(path)

def set_storage_dir(path: str) -> bool:
    """设置存储目录（便捷函数）"""
    return get_config_manager().set_storage_dir(path)

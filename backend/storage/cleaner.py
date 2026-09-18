"""旧存储数据的清理器。

切换存储目录走的是「复制」语义，旧数据完整留在原地，于是磁盘上会出现一份
用户不再需要却也不知道能不能删的残留。这里负责把这批残留安全清掉。

与迁移器互不依赖：两者唯一的关系是「先有迁移才有残留」，编排交由上层处理。
"""

import os
import shutil
from pathlib import Path
from typing import List, Optional, Tuple

from backend.config_manager import get_config_manager
from backend.storage.layout import (
    ATTACHMENT_DIR_NAME, BACKUP_DIR_NAME, DB_FILE_NAME, STORAGE_DIR_NAME,
    DB_SIDECAR_SUFFIXES,
)
from backend.utils.logger import LogManager


class StorageCleaner(LogManager):
    """清理上一次迁移遗留的旧数据备份"""

    # 旧备份落点存在配置文件里：它得跨进程存活——用户多半是隔天才想起来清理，
    # 放在内存里重启一次就丢，清理入口也就跟着消失了。
    CONFIG_KEY = 'last_backup_dir'

    def get_pending_backup(self) -> Optional[Path]:
        """上一次迁移遗留的旧数据所在目录；没有则 None"""
        raw = get_config_manager().get(self.CONFIG_KEY)
        return Path(raw) if raw and isinstance(raw, str) else None

    def set_pending_backup(self, value: Optional[Path]) -> None:
        """记录（或清空）待清理的旧备份目录"""
        config = get_config_manager()
        if value is None:
            config.delete(self.CONFIG_KEY)
        else:
            config.set(self.CONFIG_KEY, str(value))

    def cleanup(self, current_app_dir: Path) -> Tuple[bool, str]:
        """清理遗留的旧数据备份。

        安全策略：只删除本应用自己创建的内容（todo.db 及其 WAL 边车、attachment 目录、
        backups 自动备份目录），其它文件一律保留；父目录仅在被清空后才会删除；
        当前正在使用的存储目录永不清理。

        current_app_dir 由调用方给出：清理器自己不去猜「当前目录在哪」，
        那是路径决策的事，不该由它兼职。
        """
        target = self.get_pending_backup()
        if target is None:
            return False, "没有可清理的旧数据备份"
        if not target.exists():
            self.set_pending_backup(None)
            return False, "旧数据备份已不存在"

        try:
            current_app_dir_resolved = current_app_dir.resolve()
        except Exception as e:
            return False, f"无法确定当前存储目录，已取消清理: {e}"

        if target.resolve() == current_app_dir_resolved:
            return False, "该目录正是当前使用的存储目录，已跳过清理"

        removable_names = {
            DB_FILE_NAME,
            *{f"{DB_FILE_NAME}{suffix}" for suffix in DB_SIDECAR_SUFFIXES},
            ATTACHMENT_DIR_NAME,
            BACKUP_DIR_NAME,
        }
        removed: List[str] = []
        outer = target.parent if target.name == STORAGE_DIR_NAME else None
        removed_outer = False
        try:
            for child in target.iterdir():
                if child.name not in removable_names:
                    continue
                if child.is_dir():
                    shutil.rmtree(str(child))
                else:
                    child.unlink()
                removed.append(child.name)
            # 仅在已被清空时才删除外壳目录，避免误删用户自己的其它文件
            if not any(target.iterdir()):
                target.rmdir()
                # 再往外一层就是用户当初选的存储目录，清干净后往往是个空壳（比如 D:\backup），
                # 留着容易被当成「没清理成功」。rmdir 对非空目录必然失败，所以即便用户
                # 在同一层还放了别的东西也不会误删，这里可以放心尝试。
                if outer is not None and self._is_dir_safe_to_remove(outer, current_app_dir_resolved):
                    try:
                        outer.rmdir()
                        removed_outer = True
                    except OSError:
                        # 非空、没权限或正被资源管理器占用：保持现状，不算清理失败
                        pass
        except Exception as e:
            self.get_logger.error(f"清理旧数据备份失败: {target}, 错误: {e}")
            return False, f"清理失败: {e}"

        self.set_pending_backup(None)
        names = ', '.join(removed)
        if not removed:
            return True, f"旧备份目录中已无本应用数据: {target}"
        if removed_outer:
            self.get_logger.info(f"已清理旧数据备份: {target}（{names}），并移除已空的外层目录 {outer}")
            return True, f"已清理旧备份（{names}），并移除已空的外层目录: {outer}"
        if target.exists():
            # 目录里还有本应用之外的文件，此时不能删目录，得说清楚为什么还在
            self.get_logger.info(f"已清理旧数据备份: {target}（{names}），目录内仍有其它文件已保留")
            return True, f"已清理旧备份（{names}）；目录内仍有其它文件，已保留: {target}"
        self.get_logger.info(f"已清理旧数据备份: {target}（{names}）")
        return True, f"已清理旧备份（{names}）: {target}"

    @staticmethod
    def _is_dir_safe_to_remove(directory: Path, protected: Path) -> bool:
        """判断目录能否删除：盘根目录、当前存储目录及其祖先一律不动"""
        try:
            if directory == directory.parent:  # 盘根目录：Path('D:\\').parent 仍是自身
                return False
            directory = directory.resolve()
            protected = protected.resolve()
            if directory == protected:
                return False
            # protected 位于 directory 之下时，删掉 directory 等于删掉正在用的数据
            if str(protected).startswith(f"{directory}{os.sep}"):
                return False
        except Exception:
            return False
        return True

_cleaner: Optional[StorageCleaner] = None


def get_storage_cleaner() -> StorageCleaner:
    """获取全局清理器实例（单例）"""
    global _cleaner
    if _cleaner is None:
        _cleaner = StorageCleaner()
    return _cleaner

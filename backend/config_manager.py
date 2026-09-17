"""
外部配置管理器
用于管理不依赖数据库的配置信息，避免循环依赖问题
"""

import os
import json
import platform
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional, Dict, List, Tuple
from backend.config import ANDROID_PRIMARY_USR_DIR, ANDROID_PRIMARY_DATA_DIR, ANDROID_EXTERNAL_DIR, ANDROID_PACKAGE_NAME
from backend.utils.logger import LogManager

class StorageMigrationCancelled(Exception):
    """用户主动取消了存储目录迁移。

    取消靠抛异常往上冒泡：SQLite 的 backup 进度回调返回非零值并不会中止复制
    （实测仍会跑完全部页），只有抛异常才能立刻停住，因此取消路径统一用异常。
    """


class ConfigManager(LogManager):
    """外部配置管理器，独立于数据库"""

    # 存储目录结构：<用户选择的目录>/todolist/{todo.db, attachment/, backups/}
    STORAGE_DIR_NAME = 'todolist'
    ATTACHMENT_DIR_NAME = 'attachment'
    DB_FILE_NAME = 'todo.db'
    # 旧版本在导入 / 切换数据文件前自动生成的安全备份目录。该逻辑已移除（无人使用、
    # 只增不减），常量保留下来只为清理用户磁盘上已有的历史残留。
    BACKUP_DIR_NAME = 'backups'

    # 迁移数据量超过该阈值时提示用户二次确认（字节）
    # 切目录是复制语义，体量大时会占双倍空间且耗时明显，需要先把规模告知用户
    MIGRATION_SIZE_WARNING_THRESHOLD = 200 * 1024 * 1024

    # SQLite backup 每批复制的页数。默认 -1 是「一次搬完」，实测 88MB 库只回调进度
    # 1 次——取消根本没机会生效。分批后同样耗时下回调上百次，取消才能在批次边界停住。
    MIGRATION_BACKUP_PAGES = 200

    def __init__(self) -> None:
        super().__init__()
        self.config_file: Path = self._get_config_file_path()
        self.config: Dict[str, Any] = self._load_config()
        # 存储根目录缓存，避免重复计算与迁移
        self._storage_dir: Optional[Path] = None
        # 存储目录变更版本号：每次 set_storage_dir 成功后自增，
        # 供持有路径缓存的实例判断缓存是否过期（见 TodoDatabase.db_path）
        self._storage_dir_version: int = 0
        # 上一次迁移遗留的旧数据所在目录（<旧目录>/todolist），用于提示与一键清理
        self.last_backup_dir: Optional[Path] = None
        # 迁移任务状态：迁移在后台线程执行，前端轮询该状态展示进度
        self._migration_lock: threading.Lock = threading.Lock()
        self._migration_state: Dict[str, Any] = {'status': 'idle'}
        self._migration_cancel: threading.Event = threading.Event()
    
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

    @staticmethod
    def _safe_resolve(path: Path) -> Optional[Path]:
        """resolve 失败（路径不存在/越权）时返回 None，供相等性比较使用"""
        try:
            return path.resolve()
        except Exception:
            return None

    @staticmethod
    def _file_size(path: Path) -> int:
        try:
            return path.stat().st_size
        except OSError:
            return 0

    def _iter_pending_attachment_files(self, source: Path, target: Path) -> List[Tuple[Path, Path, int]]:
        """列出待复制的附件：目标已存在的同名文件跳过（与合并复制语义一致）"""
        pending: List[Tuple[Path, Path, int]] = []
        for root, _dirs, files in os.walk(str(source)):
            rel_dir = Path(root).relative_to(source)
            target_dir = target if str(rel_dir) == '.' else target / rel_dir
            for name in files:
                source_file = Path(root) / name
                destination = target_dir / name
                if destination.exists():
                    continue
                pending.append((source_file, destination, self._file_size(source_file)))
        return pending

    def _plan_storage_migration(self, base_dir: Path) -> Dict[str, Any]:
        """规划一次切换要搬运的数据（旧库 + 旧附件）。

        预估体量与正式迁移共用同一套判断口径（跳过哪些文件），避免前台显示的数量
        和实际迁移的数量对不上。
        """
        base_dir = Path(base_dir)
        app_dir = base_dir / self.STORAGE_DIR_NAME
        new_file = app_dir / self.DB_FILE_NAME
        attach_dir = app_dir / self.ATTACHMENT_DIR_NAME

        legacy_file: Optional[Path] = None
        try:
            legacy_file = Path(self.get_data_file())
        except Exception:
            legacy_file = None

        migrate_db = False
        db_bytes = 0
        if legacy_file is not None and legacy_file.exists() and not new_file.exists():
            if self._safe_resolve(legacy_file) != self._safe_resolve(new_file):
                migrate_db = True
                for suffix in ('', '-wal', '-shm'):
                    sidecar = Path(f'{legacy_file}{suffix}')
                    if sidecar.exists():
                        db_bytes += self._file_size(sidecar)

        legacy_attach = self._legacy_attachment_dir(legacy_file) if legacy_file is not None else None
        pending: List[Tuple[Path, Path, int]] = []
        if legacy_attach is not None \
                and self._safe_resolve(legacy_attach) != self._safe_resolve(attach_dir):
            pending = self._iter_pending_attachment_files(legacy_attach, attach_dir)

        attach_bytes = sum(size for _src, _dst, size in pending)
        return {
            'migrateDb': migrate_db,
            'dbBytes': db_bytes,
            'attachmentBytes': attach_bytes,
            'totalBytes': db_bytes + attach_bytes,
            'fileCount': len(pending),
        }

    def estimate_storage_migration(self, base_dir: Path) -> Dict[str, Any]:
        """预估切换到目标目录需要搬运的数据量，供前端提示与二次确认"""
        plan = self._plan_storage_migration(base_dir)
        total_bytes = int(plan['totalBytes'])
        return {
            'needsMigrate': bool(plan['migrateDb'] or plan['fileCount']),
            'totalBytes': total_bytes,
            'dbBytes': int(plan['dbBytes']),
            'attachmentBytes': int(plan['attachmentBytes']),
            'fileCount': int(plan['fileCount']),
            'thresholdBytes': self.MIGRATION_SIZE_WARNING_THRESHOLD,
            'exceedsThreshold': total_bytes >= self.MIGRATION_SIZE_WARNING_THRESHOLD,
        }

    # ==================== 迁移进度状态（后台线程写，前端轮询读） ====================

    def begin_storage_migration(self, base_dir: Path, estimate: Dict[str, Any]) -> None:
        """标记一次切换开始，并把预估总量作为进度分母"""
        self._migration_cancel.clear()
        with self._migration_lock:
            self._migration_state = {
                'status': 'running',
                'phase': 'preparing',
                'targetDir': str(base_dir),
                'percent': 0,
                'copiedBytes': 0,
                'totalBytes': int(estimate.get('totalBytes', 0)),
                'copiedFiles': 0,
                'totalFiles': int(estimate.get('fileCount', 0)),
                'elapsedSeconds': 0,
                'message': '',
                'backupPath': None,
                'cancelRequested': False,
                'startedAt': time.time(),
            }

    def report_storage_migration(self, info: Dict[str, Any]) -> None:
        """接收迁移过程中的进度回调（由迁移线程调用）"""
        with self._migration_lock:
            state = self._migration_state
            if state.get('status') != 'running':
                return
            for key, value in info.items():
                if value is not None:
                    state[key] = value
            total = int(state.get('totalBytes') or 0)
            copied = int(state.get('copiedBytes') or 0)
            # 完成前最高显示 99%，真正的 100% 由 finish 给出
            state['percent'] = min(99, int(copied * 100 / total)) if total > 0 else 0
            started_at = state.get('startedAt')
            if started_at:
                state['elapsedSeconds'] = int(time.time() - started_at)

    def finish_storage_migration(self, success: bool, message: str = '',
                                 status: Optional[str] = None, **extra: Any) -> None:
        """结束一次切换并记录结果（成功/失败/取消 + 旧备份位置）

        status 显式给出时优先于 success，用于区分「被取消」和「出错」。
        """
        with self._migration_lock:
            state = self._migration_state
            state['status'] = status or ('success' if success else 'error')
            state['message'] = message
            state['finishedAt'] = time.time()
            for key, value in extra.items():
                state[key] = value
            if success:
                state['percent'] = 100
                state['copiedBytes'] = int(state.get('totalBytes') or 0)

    def get_storage_migration_state(self) -> Dict[str, Any]:
        """返回迁移进度快照（含 status/percent/phase 等）"""
        with self._migration_lock:
            state = dict(self._migration_state)
            started_at = state.get('startedAt')
            if state.get('status') == 'running' and started_at:
                state['elapsedSeconds'] = int(time.time() - started_at)
            return state

    def is_storage_migration_running(self) -> bool:
        with self._migration_lock:
            return self._migration_state.get('status') == 'running'

    def request_storage_migration_cancel(self) -> bool:
        """请求取消正在进行的迁移。

        只置标志，不阻塞：迁移线程在下一个检查点（每个附件文件或 backup 进度回调）
        自行停下并回滚已复制的内容。返回 False 表示当前没有可取消的任务。
        """
        with self._migration_lock:
            if self._migration_state.get('status') != 'running':
                return False
            self._migration_state['cancelRequested'] = True
            self._migration_state['phase'] = 'cancelling'
        self._migration_cancel.set()
        return True

    def is_storage_migration_cancelled(self) -> bool:
        return self._migration_cancel.is_set()

    def _ensure_storage_layout(self, base_dir: Path, legacy_file: Optional[Path] = None,
                               progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> bool:
        """确保存储目录结构存在（<base>/todolist/{todo.db, attachment}），必要时迁移旧数据。

        迁移是「复制」语义：库文件与附件都被复制过来，旧位置的原文件保留为备份。
        返回 False 表示「存在旧数据但迁移失败」，调用方据此决定是否中止本次切换。

        progress 为可选回调，接收 {'phase', 'copiedBytes', 'copiedFiles', 'totalFiles'}，
        用于在体量较大时向前端汇报进度。
        """
        base_dir = Path(base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)
        app_dir = base_dir / self.STORAGE_DIR_NAME
        app_dir.mkdir(parents=True, exist_ok=True)
        attach_dir = app_dir / self.ATTACHMENT_DIR_NAME
        attach_dir.mkdir(parents=True, exist_ok=True)

        if legacy_file is None:
            return True

        legacy_file = Path(legacy_file)
        new_file = app_dir / self.DB_FILE_NAME
        legacy_attach = self._legacy_attachment_dir(legacy_file)

        if not legacy_file.exists() and legacy_attach is None:
            return True

        def emit(phase: str, copied_bytes: int,
                 copied_files: Optional[int] = None, total_files: Optional[int] = None) -> None:
            if progress is None:
                return
            progress({
                'phase': phase,
                'copiedBytes': int(copied_bytes),
                'copiedFiles': copied_files,
                'totalFiles': total_files,
            })

        db_created = False
        try:
            db_bytes = 0
            if legacy_file.exists() and not new_file.exists() \
                    and self._safe_resolve(legacy_file) != self._safe_resolve(new_file):
                emit('database', 0)
                if not self._migrate_data_file(legacy_file, new_file,
                                               progress=lambda done: emit('database', done)):
                    return False
                db_bytes = self._file_size(new_file)
                db_created = True

            # 附件必须一起迁：库里存的是相对路径，基准就是当前附件根目录
            if legacy_attach is not None \
                    and self._safe_resolve(legacy_attach) != self._safe_resolve(attach_dir):
                # 不带文件计数，保留 begin 阶段算好的总数，避免开局闪一下 0/0
                emit('attachments', db_bytes)
                if not self._migrate_attachment_dir(
                        legacy_attach, attach_dir,
                        progress=lambda done, files, total: emit('attachments', db_bytes + done,
                                                                 files, total)):
                    return False
        except StorageMigrationCancelled:
            # 库已迁完但附件被取消时，新目录会留下一个「此刻的快照」库。
            # 不删的话下次切同一目录会因「目标库已存在」跳过迁移，直接用上这份过期库，
            # 用户取消之后新增的数据就丢了。这里只删本次迁移新建的那份，旧目录原件不动。
            if db_created:
                self._remove_incomplete_file(new_file)
            raise

        if legacy_file.exists():
            # 旧数据原样保留，记录位置以便后续提示 / 一键清理
            self.last_backup_dir = legacy_file.parent
        return True

    def _legacy_attachment_dir(self, legacy_file: Path) -> Optional[Path]:
        """定位旧数据对应的附件目录。

        新结构是 <base>/todolist/attachment，早期版本把 attachment 直接放在数据文件
        同级，两个位置都尝试，返回第一个真实存在的非空目录。
        """
        candidates = [
            legacy_file.parent / self.STORAGE_DIR_NAME / self.ATTACHMENT_DIR_NAME,
            legacy_file.parent / self.ATTACHMENT_DIR_NAME,
        ]
        for candidate in candidates:
            try:
                if candidate.is_dir() and any(candidate.iterdir()):
                    return candidate
            except Exception:
                continue
        return None

    def _raise_if_migration_cancelled(self) -> None:
        """取消检查点：用户请求取消时立刻中断迁移。

        检查粒度刻意放在「每个文件 / 每次 backup 回调」级别——太粗会让取消按钮
        点了没反应，太细（按字节）又没必要，复制单个文件本身是原子且很快的。
        """
        if self._migration_cancel.is_set():
            raise StorageMigrationCancelled("用户取消了迁移")

    def _rollback_migrated_files(self, created_files: List[Path], created_dirs: List[Path]) -> None:
        """回滚本次复制出来的内容，只动自己创建的文件，绝不动目标目录原有的东西"""
        for item in reversed(created_files):
            try:
                item.unlink()
            except Exception:
                pass
        for directory in reversed(created_dirs):
            try:
                if directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()
            except Exception:
                pass

    def _migrate_attachment_dir(self, source: Path, target: Path,
                                progress: Optional[Callable[..., None]] = None) -> bool:
        """把旧附件目录合并复制到新存储目录的附件下。

        必须随库一起迁移：附件在库中以相对路径存储（`AttachmentService.resolve_path`
        基于当前附件根目录解析），只搬迁库文件会让历史附件全部指向新目录里的空位置，
        表现为附件丢失。

        与库文件一致采用复制语义：目标已存在的同名文件跳过，旧文件保留为备份。
        progress 签名：(已完成字节数, 已完成文件数, 总文件数)。

        用户取消时抛 StorageMigrationCancelled：已复制的文件会被回滚，
        调用方据此把状态标为「已取消」而不是「失败」。
        """
        if source.resolve() == target.resolve():
            return True

        self._raise_if_migration_cancelled()
        # 先扫一次拿到待复制清单，才能给出稳定的进度分母；之后照清单复制
        pending = self._iter_pending_attachment_files(source, target)
        if not pending:
            return True
        self._raise_if_migration_cancelled()

        total_bytes = sum(size for _source_file, _destination, size in pending)
        created_files: List[Path] = []
        created_dirs: List[Path] = []
        copied_bytes = 0
        try:
            for index, (source_file, destination, size) in enumerate(pending, 1):
                # 每个文件前检查一次：取消的响应粒度就是单个文件
                self._raise_if_migration_cancelled()
                target_dir = destination.parent
                if not target_dir.exists():
                    target_dir.mkdir(parents=True, exist_ok=True)
                    created_dirs.append(target_dir)
                shutil.copy2(str(source_file), str(destination))
                created_files.append(destination)
                copied_bytes += size
                if progress:
                    progress(min(copied_bytes, total_bytes), index, len(pending))
            self.get_logger.info(f"已迁移附件 {len(created_files)} 个: {source} -> {target}")
            return True
        except StorageMigrationCancelled:
            # 取消不是错误：同样回滚已复制的内容，然后把取消语义原样抛给调用方
            self.get_logger.info(f"迁移附件已被用户取消，回滚已复制内容: {target}")
            self._rollback_migrated_files(created_files, created_dirs)
            raise
        except Exception as e:
            self.get_logger.error(f"迁移附件目录失败: {source} -> {target}, 错误: {e}")
            self._rollback_migrated_files(created_files, created_dirs)
            return False

    def cleanup_previous_storage_backup(self) -> Tuple[bool, str]:
        """清理上一次迁移遗留的旧数据备份（<旧目录>/todolist）。

        安全策略：只删除本应用自己创建的内容（todo.db 及其 WAL 边车、attachment 目录、
        backups 自动备份目录），其它文件一律保留；父目录仅在被清空后才会删除；
        当前正在使用的存储目录永不清理。
        """
        target = self.last_backup_dir
        if target is None:
            return False, "没有可清理的旧数据备份"
        if not target.exists():
            self.last_backup_dir = None
            return False, "旧数据备份已不存在"

        try:
            current_app_dir = self.get_app_dir().resolve()
        except Exception as e:
            return False, f"无法确定当前存储目录，已取消清理: {e}"

        if target.resolve() == current_app_dir:
            return False, "该目录正是当前使用的存储目录，已跳过清理"

        removable_names = {
            self.DB_FILE_NAME,
            f"{self.DB_FILE_NAME}-wal",
            f"{self.DB_FILE_NAME}-shm",
            self.ATTACHMENT_DIR_NAME,
            self.BACKUP_DIR_NAME,
        }
        removed: List[str] = []
        outer = target.parent if target.name == self.STORAGE_DIR_NAME else None
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
                if outer is not None and self._is_dir_safe_to_remove(outer, current_app_dir):
                    try:
                        outer.rmdir()
                        removed_outer = True
                    except OSError:
                        # 非空、没权限或正被资源管理器占用：保持现状，不算清理失败
                        pass
        except Exception as e:
            self.get_logger.error(f"清理旧数据备份失败: {target}, 错误: {e}")
            return False, f"清理失败: {e}"

        self.last_backup_dir = None
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

    def _migrate_data_file(self, source: Path, target: Path,
                           progress: Optional[Callable[[int], None]] = None) -> bool:
        """把旧库的数据迁到目标位置（复制语义，源文件保留）。

        走 SQLite backup API 而不是 shutil.move，原因有二：
        1. WAL 模式下 -wal 里可能滞留尚未合并的事务，shutil.move 只搬主库文件，这部分数据会丢；
        2. Windows 上正在被打开的文件无法 move——后台提醒线程每 30s 轮询一次会撞车，直接报 WinError 32。
        backup API 由数据库自身读取并提供一致快照，上述两个问题都不存在。

        源文件保留为安全备份：删除它在 Windows 上有同样的占用风险，
        且直接删用户数据不可逆，交还给用户自行处理更稳妥。

        progress 签名：(已完成字节数)，按页进度折算，仅用于界面展示，不追求精确。

        用户取消时抛 StorageMigrationCancelled。
        """
        target.parent.mkdir(parents=True, exist_ok=True)
        self._raise_if_migration_cancelled()
        total_bytes = sum(self._file_size(Path(f'{source}{suffix}'))
                          for suffix in ('', '-wal', '-shm'))
        try:
            src = sqlite3.connect(str(source), timeout=15)
            try:
                # 先把 WAL 合并回主库，让后续处理都基于自包含的单文件
                try:
                    src.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                except Exception as e:
                    # 有其他连接占用时不强求：backup API 本身就读得到完整数据
                    self.get_logger.warning(f"跳过 WAL checkpoint: {e}")

                dst = sqlite3.connect(str(target), timeout=15)
                try:
                    # 必须分批：默认一次搬完时进度回调只触发 1 次，取消无从下手
                    src.backup(dst, pages=self.MIGRATION_BACKUP_PAGES,
                               progress=self._make_backup_progress(total_bytes, progress,
                                                                   self._raise_if_migration_cancelled))
                    dst.execute('PRAGMA wal_checkpoint(TRUNCATE)')
                finally:
                    dst.close()
            finally:
                src.close()
            if progress:
                progress(total_bytes)
            self.get_logger.info(f"已迁移旧数据文件: {source} -> {target}（源文件已保留为备份）")
            return True
        except StorageMigrationCancelled:
            # 取消：清掉半成品，向上抛以便把状态标为「已取消」而非「失败」
            self.get_logger.info(f"迁移数据文件已被用户取消: {target}")
            self._remove_incomplete_file(target)
            raise
        except Exception as e:
            self.get_logger.error(f"迁移旧数据文件失败: {e}")
            self._remove_incomplete_file(target)
            return False

    @staticmethod
    def _make_backup_progress(total_bytes: int, progress: Optional[Callable[[int], None]],
                              cancel_check: Optional[Callable[[], None]] = None):
        """把 SQLite backup 的页进度折算成字节进度回调。

        cancel_check 在每次回调时先跑一次：backup 只能通过「回调里抛异常」中止
        （返回非零值不生效），库文件较大时这是唯一的取消入口。
        """
        if progress is None and cancel_check is None:
            return None

        def _on_pages(_status: int, remaining: int, page_count: int) -> None:
            if cancel_check is not None:
                cancel_check()
            if progress is None or page_count <= 0:
                return
            done_pages = max(0, page_count - max(0, remaining))
            progress(int(total_bytes * done_pages / page_count))

        return _on_pages

    def _remove_incomplete_file(self, target: Path) -> None:
        """清理迁移失败时可能产生的半成品目标文件及其 WAL 边车文件"""
        for suffix in ('', '-wal', '-shm'):
            path = Path(f'{target}{suffix}')
            try:
                if path.exists():
                    path.unlink()
            except Exception as e:
                self.get_logger.warning(f"清理半成品文件 {path} 失败: {e}")

    def _remove_created_dirs(self, dirs: List[Path], existed_before: Dict[str, bool]) -> None:
        """清理本次切换过程中新建的目录。

        仅在目录为空时才删除，避免误删用户在该目录下已有的数据。
        """
        for directory in reversed(dirs):
            if existed_before.get(str(directory), True):
                continue
            try:
                if directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()
            except Exception as e:
                self.get_logger.warning(f"清理目录 {directory} 失败: {e}")

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

    def get_storage_dir_version(self) -> int:
        """存储目录变更版本号。

        每次成功切换目录后自增。TodoDatabase 会缓存解析后的数据文件路径，
        借助该版本号即可判断缓存是否过期，从而在用户切换存储目录后自动
        重解析到新库，避免出现仍指向旧库的陈旧连接。
        """
        return self._storage_dir_version

    def set_storage_dir(self, path: str,
                        progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> bool:
        """设置存储目录

        progress：可选的迁移进度回调，见 `_ensure_storage_layout`。
        """
        if not path or not isinstance(path, str):
            raise ValueError("存储目录不能为空")

        path_obj = Path(path)

        # 记录哪些目录是本次新建的：失败回滚时只清理这些，绝不删除用户已有内容
        dirs_created = [
            path_obj,
            path_obj / self.STORAGE_DIR_NAME,
            path_obj / self.STORAGE_DIR_NAME / self.ATTACHMENT_DIR_NAME,
        ]
        existed_before = {str(directory): directory.exists() for directory in dirs_created}

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

        # 迁移是切换的一部分：失败即中止，避免"配置已切到新目录、数据仍在旧目录"的丢数据假象
        if not self._ensure_storage_layout(path_obj, legacy_db, progress=progress):
            self._remove_created_dirs(dirs_created, existed_before)
            raise RuntimeError(
                f"数据迁移失败，已取消切换并继续使用原目录"
                f"{f'（{legacy_db}）' if legacy_db else ''}"
                f"，请确认该文件未被其他程序占用后重试"
            )

        success = self.set('storage_dir', str(path_obj))
        if success:
            self._storage_dir = path_obj
            # 自增版本号，使所有持有路径缓存的实例在下次访问时重新解析到新库
            self._storage_dir_version += 1
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

def get_storage_dir_version() -> int:
    """获取存储目录变更版本号（便捷函数）"""
    return get_config_manager().get_storage_dir_version()

def get_app_dir() -> Path:
    """获取应用数据目录（便捷函数）"""
    return get_config_manager().get_app_dir()

def get_attachment_dir() -> Path:
    """获取附件根目录（便捷函数）"""
    return get_config_manager().get_attachment_dir()

def set_data_file(path: str) -> bool:
    """设置数据文件（便捷函数，兼容旧接口）"""
    return get_config_manager().set_data_file(path)

def set_storage_dir(path: str, progress: Optional[Callable[[Dict[str, Any]], None]] = None) -> bool:
    """设置存储目录（便捷函数）"""
    return get_config_manager().set_storage_dir(path, progress=progress)

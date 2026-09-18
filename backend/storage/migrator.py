"""存储目录迁移执行器。

职责边界：只管「把数据在两个存储目录之间搬起来」——建目录结构、复制库与附件、
上报进度、响应取消并回滚。它不问配置怎么存、也不决定路径该选哪个，那属于
ConfigManager。因此本模块刻意不反向依赖 config_manager，依赖保持单向。
"""

import os
import shutil
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.storage.layout import (
    ATTACHMENT_DIR_NAME, DB_FILE_NAME, DB_SIDECAR_SUFFIXES, STORAGE_DIR_NAME,
    MIGRATION_SIZE_WARNING_THRESHOLD, MIGRATION_BACKUP_PAGES,
)
from backend.utils.logger import LogManager


class StorageMigrationCancelled(Exception):
    """用户主动取消了存储目录迁移。

    取消靠抛异常往上冒泡：SQLite 的 backup 进度回调返回非零值并不会中止复制
    （实测仍会跑完全部页），只有抛异常才能立刻停住，因此取消路径统一用异常。
    """


@dataclass
class StorageLayoutResult:
    """`ensure_layout` 的执行结果。

    ok=False 表示「存在旧数据但迁移失败」；backup_dir 是这次复制后旧数据的落点，
    由调用方决定怎么用它（提示用户还是交给清理器）——迁移器自己不持有这个状态，
    否则它就得知道「什么时候可以清」，职责又黏回去了。
    """
    ok: bool
    backup_dir: Optional[Path] = None


class StorageMigrator(LogManager):
    """执行存储目录之间的数据搬迁（复制语义，源文件一律保留）"""

    def __init__(self) -> None:
        super().__init__()
        # 迁移跑在后台线程，状态在这里统一收口，对外只给快照
        self._lock: threading.Lock = threading.Lock()
        self._state: Dict[str, Any] = {'status': 'idle'}
        self._cancel: threading.Event = threading.Event()

    # ==================== 迁移进度状态（后台线程写，前端轮询读） ====================

    def begin(self, base_dir: Path, estimate: Dict[str, Any]) -> None:
        """标记一次切换开始，并把预估总量作为进度分母"""
        self._cancel.clear()
        with self._lock:
            self._state = {
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

    def report(self, info: Dict[str, Any]) -> None:
        """接收迁移过程中的进度回调（由迁移线程调用）"""
        with self._lock:
            state = self._state
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

    def finish(self, success: bool, message: str = '',
               status: Optional[str] = None, **extra: Any) -> None:
        """结束一次切换并记录结果（成功/失败/取消 + 旧备份位置）

        status 显式给出时优先于 success，用于区分「被取消」和「出错」。
        """
        with self._lock:
            state = self._state
            state['status'] = status or ('success' if success else 'error')
            state['message'] = message
            state['finishedAt'] = time.time()
            for key, value in extra.items():
                state[key] = value
            if success:
                state['percent'] = 100
                state['copiedBytes'] = int(state.get('totalBytes') or 0)

    def get_state(self) -> Dict[str, Any]:
        """返回迁移进度快照（含 status/percent/phase 等）"""
        with self._lock:
            state = dict(self._state)
            started_at = state.get('startedAt')
            if state.get('status') == 'running' and started_at:
                state['elapsedSeconds'] = int(time.time() - started_at)
            return state

    def is_running(self) -> bool:
        with self._lock:
            return self._state.get('status') == 'running'

    def request_cancel(self) -> bool:
        """请求取消正在进行的迁移。

        只置标志，不阻塞：迁移线程在下一个检查点（每个附件文件或 backup 进度回调）
        自行停下并回滚已复制的内容。返回 False 表示当前没有可取消的任务。
        """
        with self._lock:
            if self._state.get('status') != 'running':
                return False
            self._state['cancelRequested'] = True
            self._state['phase'] = 'cancelling'
        self._cancel.set()
        return True

    def is_cancelled(self) -> bool:
        return self._cancel.is_set()

    # ==================== 规模预估 ====================

    def build_plan(self, base_dir: Path, legacy_file: Optional[Path]) -> Dict[str, Any]:
        """规划一次切换要搬运的数据（旧库 + 旧附件）。

        预估体量与正式迁移共用同一套判断口径（跳过哪些文件），避免前台显示的数量
        和实际迁移的数量对不上。
        """
        base_dir = Path(base_dir)
        app_dir = base_dir / STORAGE_DIR_NAME
        new_file = app_dir / DB_FILE_NAME
        attach_dir = app_dir / ATTACHMENT_DIR_NAME

        migrate_db = False
        db_bytes = 0
        if legacy_file is not None and legacy_file.exists() and not new_file.exists():
            if self._safe_resolve(legacy_file) != self._safe_resolve(new_file):
                migrate_db = True
                for suffix in DB_SIDECAR_SUFFIXES:
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

    def estimate(self, base_dir: Path, legacy_file: Optional[Path]) -> Dict[str, Any]:
        """预估切换到目标目录需要搬运的数据量，供前端提示与二次确认"""
        plan = self.build_plan(base_dir, legacy_file)
        total_bytes = int(plan['totalBytes'])
        return {
            'needsMigrate': bool(plan['migrateDb'] or plan['fileCount']),
            'totalBytes': total_bytes,
            'dbBytes': int(plan['dbBytes']),
            'attachmentBytes': int(plan['attachmentBytes']),
            'fileCount': int(plan['fileCount']),
            'thresholdBytes': MIGRATION_SIZE_WARNING_THRESHOLD,
            'exceedsThreshold': total_bytes >= MIGRATION_SIZE_WARNING_THRESHOLD,
        }

    # ==================== 布局建立与数据搬迁 ====================

    def ensure_layout(self, base_dir: Path, legacy_file: Optional[Path] = None,
                      progress: Optional[Callable[[Dict[str, Any]], None]] = None
                      ) -> StorageLayoutResult:
        """确保存储目录结构存在（<base>/todolist/{todo.db, attachment}），必要时迁移旧数据。

        迁移是「复制」语义：库文件与附件都被复制过来，旧位置的原文件保留为备份，
        其位置通过返回值的 backup_dir 给出。ok=False 表示「存在旧数据但迁移失败」，
        调用方据此决定是否中止本次切换。

        progress 为可选回调，接收 {'phase', 'copiedBytes', 'copiedFiles', 'totalFiles'}，
        用于在体量较大时向前端汇报进度。
        """
        base_dir = Path(base_dir)
        base_dir.mkdir(parents=True, exist_ok=True)
        app_dir = base_dir / STORAGE_DIR_NAME
        app_dir.mkdir(parents=True, exist_ok=True)
        attach_dir = app_dir / ATTACHMENT_DIR_NAME
        attach_dir.mkdir(parents=True, exist_ok=True)

        if legacy_file is None:
            return StorageLayoutResult(True)

        legacy_file = Path(legacy_file)
        new_file = app_dir / DB_FILE_NAME
        legacy_attach = self._legacy_attachment_dir(legacy_file)

        if not legacy_file.exists() and legacy_attach is None:
            return StorageLayoutResult(True)

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
                    return StorageLayoutResult(False)
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
                    return StorageLayoutResult(False)
        except StorageMigrationCancelled:
            # 库已迁完但附件被取消时，新目录会留下一个「此刻的快照」库。
            # 不删的话下次切同一目录会因「目标库已存在」跳过迁移，直接用上这份过期库，
            # 用户取消之后新增的数据就丢了。这里只删本次迁移新建的那份，旧目录原件不动。
            if db_created:
                self._remove_incomplete_file(new_file)
            raise

        backup_dir = legacy_file.parent if legacy_file.exists() else None
        return StorageLayoutResult(True, backup_dir)

    def remove_created_dirs(self, dirs: List[Path], existed_before: Dict[str, bool]) -> None:
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

    # ==================== 内部实现 ====================

    def _legacy_attachment_dir(self, legacy_file: Path) -> Optional[Path]:
        """定位旧数据对应的附件目录。

        新结构是 <base>/todolist/attachment，早期版本把 attachment 直接放在数据文件
        同级，两个位置都尝试，返回第一个真实存在的非空目录。
        """
        candidates = [
            legacy_file.parent / STORAGE_DIR_NAME / ATTACHMENT_DIR_NAME,
            legacy_file.parent / ATTACHMENT_DIR_NAME,
        ]
        for candidate in candidates:
            try:
                if candidate.is_dir() and any(candidate.iterdir()):
                    return candidate
            except Exception:
                continue
        return None

    def _raise_if_cancelled(self) -> None:
        """取消检查点：用户请求取消时立刻中断迁移。

        检查粒度刻意放在「每个文件 / 每次 backup 回调」级别——太粗会让取消按钮
        点了没反应，太细（按字节）又没必要，复制单个文件本身是原子且很快的。
        """
        if self._cancel.is_set():
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

        self._raise_if_cancelled()
        # 先扫一次拿到待复制清单，才能给出稳定的进度分母；之后照清单复制
        pending = self._iter_pending_attachment_files(source, target)
        if not pending:
            return True
        self._raise_if_cancelled()

        total_bytes = sum(size for _source_file, _destination, size in pending)
        created_files: List[Path] = []
        created_dirs: List[Path] = []
        copied_bytes = 0
        try:
            for index, (source_file, destination, size) in enumerate(pending, 1):
                # 每个文件前检查一次：取消的响应粒度就是单个文件
                self._raise_if_cancelled()
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
        self._raise_if_cancelled()
        total_bytes = sum(self._file_size(Path(f'{source}{suffix}'))
                          for suffix in DB_SIDECAR_SUFFIXES)
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
                    src.backup(dst, pages=MIGRATION_BACKUP_PAGES,
                               progress=self._make_backup_progress(total_bytes, progress,
                                                                   self._raise_if_cancelled))
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
        for suffix in DB_SIDECAR_SUFFIXES:
            path = Path(f'{target}{suffix}')
            try:
                if path.exists():
                    path.unlink()
            except Exception as e:
                self.get_logger.warning(f"清理半成品文件 {path} 失败: {e}")

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


# 迁移进度是全局单例才有效：前端的取消请求与后台线程必须命中同一个 Event
_migrator: Optional[StorageMigrator] = None


def get_storage_migrator() -> StorageMigrator:
    """获取全局迁移器实例（单例）"""
    global _migrator
    if _migrator is None:
        _migrator = StorageMigrator()
    return _migrator

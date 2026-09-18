# backend/api/mixins/datafile_api_mixin.py

import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from backend.storage import service as storage
from backend.storage.service import StorageMigrationCancelled
from backend.database.todo_database import TodoDatabase
from backend.utils.response_wrapper import api_handler

class DatafileApiMixin:
    """数据存储目录配置操作 Mixin"""

    # ==================== 内部实现（避免直接调用被装饰的公开方法） ====================

    @staticmethod
    def _get_storage_dir_value() -> str:
        return str(storage.get_storage_dir())

    @staticmethod
    def _get_storage_backup_path() -> Optional[str]:
        """上一次迁移遗留的旧数据备份目录（用于提示与一键清理）"""
        backup_dir = storage.get_pending_backup()
        return str(backup_dir) if backup_dir else None

    def _apply_storage_dir_change(self, dir_path: str) -> Optional[str]:
        """目录切换成功后统一完成实例侧的收尾，并返回旧备份位置。

        重建数据库实例触发 init_database()，在新目录下补齐表结构与索引
        （TodoDatabase.db_path 与 DataExportManager.db_path 都已按需解析，
         长期持有者如提醒线程、快捷键面板会在下一次访问时自动跟随到新库，
         无需在此逐一通知）"""
        self.db = TodoDatabase()
        self.get_logger.info(f"存储目录已设置为: {dir_path}")
        # 复制语义下旧数据仍留在原目录，把位置回抛给前端以便提示和清理
        return self._get_storage_backup_path()

    def _set_storage_dir(self, dir_path: str) -> Dict[str, Any]:
        """同步切换存储目录（调用方需自己承担耗时）。"""
        if not storage.switch_storage_dir(dir_path):
            raise Exception("设置存储目录失败")

        backup_path = self._apply_storage_dir_change(dir_path)
        return {'backupPath': backup_path} if backup_path else {}

    def _start_storage_dir_migration(self, dir_path: str) -> Dict[str, Any]:
        """在后台线程执行切换：数据量可能很大（附件全量复制），不能阻塞调用线程。

        迁移进度写进迁移器的状态机，前端轮询 get_storage_dir_migration_progress
        即可展示；迁移完成（或失败）后由轮询结果触发前端刷新。
        """
        self._validate_storage_dir(dir_path)
        if storage.is_migration_running():
            raise Exception("已有切换任务在进行中，请等待其完成后再试")

        path_obj = Path(dir_path)
        # 先跑一次预估（只 stat、不读内容），把总量作为进度分母，进度条才能立即有刻度
        estimate = storage.estimate_migration(path_obj)
        storage.begin_migration(path_obj, estimate)

        def _runner() -> None:
            try:
                if not storage.switch_storage_dir(dir_path, progress=storage.report_migration):
                    raise Exception("设置存储目录失败")
                backup_path = self._apply_storage_dir_change(dir_path)
                storage.finish_migration(True, backupPath=backup_path)
            except StorageMigrationCancelled:
                # 取消不是失败：配置未落盘，仍指向原目录，已复制的内容也已回滚
                # 不写 message：文案交给前端按语言取，避免英文界面冒出中文提示
                self.get_logger.info(f"切换存储目录已被用户取消: {dir_path}")
                storage.finish_migration(False, status='cancelled')
            except Exception as e:
                self.get_logger.error(f"切换存储目录失败: {e}")
                storage.finish_migration(False, message=str(e))

        threading.Thread(target=_runner, name="StorageDirMigration", daemon=True).start()

        state = storage.get_migration_state()
        state['started'] = True
        return state

    @staticmethod
    def _validate_storage_dir(dir_path: str) -> None:
        if not dir_path or not isinstance(dir_path, str):
            raise Exception("目录路径不能为空")

        path = Path(dir_path)
        if path.exists() and not path.is_dir():
            raise Exception("请选择一个目录，而不是文件")

        if path.exists():
            if not os.access(str(path), os.R_OK | os.W_OK):
                raise Exception("没有对该目录的读写权限")
        else:
            parent = path.parent
            if not parent.exists():
                raise Exception(f"父目录不存在: {parent}")
            if not os.access(str(parent), os.W_OK):
                raise Exception(f"没有在目录 {parent} 创建文件夹的权限")

    # ==================== 公开 API ====================

    @api_handler
    def cleanup_previous_storage_backup(self) -> str:
        """清理上一次切换存储目录后保留的旧数据备份

        仅删除本应用创建的内容（todo.db 及其 WAL 边车、attachment 目录），
        用户在同目录下的其它文件不受影响。
        """
        success, message = storage.cleanup_previous_backup()
        if not success:
            raise Exception(message)
        return message

    @api_handler
    def preview_storage_dir_migration(self, dir_path: str) -> Dict[str, Any]:
        """预估切换存储目录要搬运的数据量

        切换是复制语义（库 + 附件全量搬到新目录），数据量越大耗时越长、
        额外占用的磁盘空间越多，因此前端需要先据此决定是否让用户二次确认。
        """
        self._validate_storage_dir(dir_path)
        info = storage.estimate_migration(Path(dir_path))
        info['targetDir'] = dir_path
        return info

    @api_handler
    def start_storage_dir_migration(self, dir_path: str) -> Dict[str, Any]:
        """后台开始迁移数据到新存储目录，立即返回初始进度状态

        迁移可能耗时较久，实际进度由前端轮询 get_storage_dir_migration_progress 获取。
        """
        return self._start_storage_dir_migration(dir_path)

    @api_handler
    def get_storage_dir_migration_progress(self) -> Dict[str, Any]:
        """获取存储目录迁移进度（status: idle/running/success/error/cancelled）"""
        return storage.get_migration_state()

    @api_handler
    def cancel_storage_dir_migration(self) -> Dict[str, Any]:
        """请求取消正在进行的存储目录迁移

        只置取消标志，迁移线程会在下一个检查点停下并回滚已复制内容；
        前端继续轮询 get_storage_dir_migration_progress 直到 status 变为 cancelled。
        """
        accepted = storage.request_migration_cancel()
        return {'accepted': accepted, 'state': storage.get_migration_state()}

    @api_handler
    def get_storage_dir_config(self) -> str:
        """获取存储目录配置（存储根目录）"""
        return self._get_storage_dir_value()

    @api_handler
    def set_storage_dir_config(self, dir_path: str) -> Dict[str, Any]:
        """设置存储目录配置

        用户选择目录后，会在该目录下生成 todolist 子目录，
        其中包含 todo.db 以及 attachment 附件目录。
        返回旧数据备份所在目录（backupPath），供前端提示与清理。
        """
        return self._set_storage_dir(dir_path)

    @api_handler
    def validate_storage_dir(self, dir_path: str) -> None:
        """验证存储目录的有效性"""
        self._validate_storage_dir(dir_path)

    # ==================== 兼容旧接口 ====================

    @api_handler
    def get_data_file_config(self) -> str:
        """【兼容旧接口】获取存储目录配置"""
        return self._get_storage_dir_value()

    @api_handler
    def set_data_file_config(self, dir_path: str) -> Dict[str, Any]:
        """【兼容旧接口】设置存储目录配置"""
        return self._set_storage_dir(dir_path)

    @api_handler
    def validate_data_file(self, dir_path: str) -> None:
        """【兼容旧接口】验证存储目录"""
        self._validate_storage_dir(dir_path)

    # ==================== 文件/目录选择 ====================

    @api_handler
    def select_directory_dialog(self) -> Tuple[Any, str]:
        """打开目录选择对话框"""
        import webview
        active_window = webview.active_window()
        selected_dir = active_window.create_file_dialog(webview.FileDialog.FOLDER)
        if selected_dir:
            # FOLDER 模式下部分平台返回 tuple/list
            if isinstance(selected_dir, (list, tuple)):
                selected_dir = selected_dir[0] if selected_dir else None
            if selected_dir:
                return selected_dir, '目录选择成功'
        raise Exception("用户取消了目录选择")

    @api_handler
    def select_file_dialog(self) -> Tuple[Any, str]:
        """打开文件选择对话框"""
        import webview
        active_window = webview.active_window()
        selected_path = active_window.create_file_dialog(
            webview.FileDialog.OPEN,
            file_types=('All files (*.*)',)
        )
        if selected_path:
            return selected_path, '文件选择成功'
        else:
            raise Exception("用户取消了文件选择")

    @api_handler
    def select_attachment_files(self) -> List[dict]:
        """打开附件选择对话框（支持多选）

        返回选中文件的基础信息（路径、名称、大小、是否图片），
        实际复制到存储目录会在保存任务时由后端完成。
        """
        import webview
        active_window = webview.active_window()
        selected = active_window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=True,
            file_types=('All files (*.*)',)
        )
        if not selected:
            raise Exception("用户取消了文件选择")

        if isinstance(selected, str):
            selected = [selected]

        result: List[dict] = []
        for file_path in selected:
            file_path = str(file_path)
            try:
                size = os.path.getsize(file_path)
            except OSError:
                size = 0
            name = os.path.basename(file_path)
            result.append({
                'path': file_path,
                'name': name,
                'size': size,
                'isImage': self._is_image_name(name),
            })
        return result

    @api_handler
    def select_attachment_folder(self) -> Dict[str, Any]:
        """打开文件夹选择对话框（用于任务关联文件夹）

        桌面端可用；移动端没有目录选择能力，返回 supported=False 由前端提示用户。
        文件夹不会被复制到附件存储目录，仅记录其绝对路径。
        """
        if getattr(self, 'is_android', False):
            return {'supported': False, 'reason': 'mobile'}

        import webview
        active_window = webview.active_window()
        selected_dir = active_window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected_dir:
            raise Exception("用户取消了文件夹选择")
        if isinstance(selected_dir, (list, tuple)):
            selected_dir = selected_dir[0] if selected_dir else None
        if not selected_dir:
            raise Exception("用户取消了文件夹选择")

        folder_path = str(selected_dir)
        return {
            'supported': True,
            'path': folder_path,
            'name': Path(folder_path).name or folder_path,
        }

    @staticmethod
    def _is_image_name(name: str) -> bool:
        """根据文件名判断是否为图片"""
        image_exts = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic'}
        return Path(name).suffix.lower() in image_exts

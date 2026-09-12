# backend/api/mixins/datafile_api_mixin.py

import os
from pathlib import Path
from typing import Any, List, Tuple
from backend.database.todo_database import TodoDatabase
from backend.utils.response_wrapper import api_handler

class DatafileApiMixin:
    """数据存储目录配置操作 Mixin"""

    # ==================== 内部实现（避免直接调用被装饰的公开方法） ====================

    @staticmethod
    def _get_storage_dir_value() -> str:
        from backend.config_manager import get_storage_dir
        return str(get_storage_dir())

    def _set_storage_dir(self, dir_path: str) -> None:
        from backend.config_manager import set_storage_dir

        if not set_storage_dir(dir_path):
            raise Exception("设置存储目录失败")

        # 重新初始化数据库连接以使用新目录下的数据库
        self.db = TodoDatabase()
        # 更新数据管理器
        self._data_manager.switch_data_file(self.db.db_path)
        self.get_logger.info(f"存储目录已设置为: {dir_path}")

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
    def get_storage_dir_config(self) -> str:
        """获取存储目录配置（存储根目录）"""
        return self._get_storage_dir_value()

    @api_handler
    def set_storage_dir_config(self, dir_path: str) -> None:
        """设置存储目录配置

        用户选择目录后，会在该目录下生成 todolist 子目录，
        其中包含 todo.db 以及 attachment 附件目录。
        """
        self._set_storage_dir(dir_path)

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
    def set_data_file_config(self, dir_path: str) -> None:
        """【兼容旧接口】设置存储目录配置"""
        self._set_storage_dir(dir_path)

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

    @staticmethod
    def _is_image_name(name: str) -> bool:
        """根据文件名判断是否为图片"""
        image_exts = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic'}
        return Path(name).suffix.lower() in image_exts

# backend/api/mixins/datafile_api_mixin.py

import os
from typing import Any, Tuple
from backend.database.operations import TodoDatabase
from backend.utils.response_wrapper import api_handler

class DatafileApiMixin:
    """数据目录配置操作 Mixin"""

    @api_handler
    def get_data_file_config(self) -> str:
        """获取数据文件配置"""
        from backend.config import get_current_data_file
        return get_current_data_file()

    @api_handler
    def set_data_file_config(self, file_path: str) -> None:
        """设置数据文件配置"""
        from backend.config import set_data_file

        # 验证并设置新文件
        if not set_data_file(file_path):
            raise Exception(f"设置数据文件失败")

        # 重新初始化数据库连接以使用新文件
        self.db = TodoDatabase()
        # 更新数据管理器
        self._data_manager.switch_data_file(file_path)
        self.get_logger.info(f"数据文件已设置为: {file_path}")

    @api_handler
    def validate_data_file(self, file_path: str) -> None:
        """验证数据文件路径的有效性"""
        from pathlib import Path

        if not file_path or not isinstance(file_path, str):
            raise Exception(f"文件路径不能为空")

        # 检查路径格式
        path = Path(file_path)
        path.resolve()

        # 检查扩展名
        if path.suffix.lower() not in ['.db']:
            raise Exception(f"仅支持 .db 文件")

        # 检查权限
        if path.exists():
            if not os.access(path, os.R_OK | os.W_OK):
                raise Exception(f"没有对该文件的读写权限")
        else:
            # 检查父目录权限
            parent = path.parent
            if not parent.exists():
                raise Exception(f"父目录不存在")
            if not os.access(parent, os.W_OK):
                raise Exception(f"没有在该目录创建文件的权限")

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
            raise Exception(f"用户取消了文件选择")
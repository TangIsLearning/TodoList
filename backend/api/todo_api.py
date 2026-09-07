"""
TodoList应用的前后端通信API
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from backend.database.operations import TodoDatabase
from backend.database.data_export import DataExportManager
from backend.features.p2p.p2p_server import P2PServer
from backend.features.p2p.p2p_client import P2PClient
from backend.api.mixins import AllApiMixins
from backend.utils.logger import LogManager

# 确保能找到database模块
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

class TodoApi(AllApiMixins, LogManager):
    """TodoList应用的API类，提供前后端通信接口"""
    
    def __init__(self, is_android: bool, sync_manager: Any) -> None:
        super().__init__()
        self.db = TodoDatabase()
        self.is_android = is_android
        self.sync_manager = sync_manager
        self._received_data: Any = None
        self._exported_data: Any = None
        self._p2p_server = P2PServer()
        self._p2p_client = P2PClient()
        self._data_manager = DataExportManager()
        try:
            self.service.add_new_desktop_task_reminder()
            self.get_logger.info("任务提醒器已重置")
        except Exception as e:
            self.get_logger.warning(f"重置任务提醒器失败: {e}")
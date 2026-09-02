# backend/api/mixins/webdav_mixin.py
from typing import Any, Dict
from backend.utils.response_wrapper import api_handler

class WebDAVMixin:
    """WebDAV同步核心操作 Mixin"""

    @api_handler
    def get_webdav_config(self) -> Dict[str, Any]:
        """获取WebDAV配置"""
        return self.sync_manager.get_webdav_config()

    @api_handler
    def set_webdav_config(self, config: Dict[str, Any]) -> None:
        """设置WebDAV配置"""
        self.sync_manager.set_webdav_config(config)

    @api_handler
    def test_webdav_connection(self, url: str, username: str, password: str, remote_path: str) -> None:
        """测试WebDAV连接"""
        self.sync_manager.test_webdav_connection(url, username, password, remote_path)

    @api_handler
    def sync_from_cloud(self, is_overwrite: bool = False) -> None:
        """从云端同步数据到本地"""
        self.sync_manager.sync_from_cloud(is_overwrite)

    @api_handler
    def sync_to_cloud(self) -> None:
        """将本地数据同步到云端"""
        self.sync_manager.sync_to_cloud()

    @api_handler
    def trigger_upload_on_change(self) -> None:
        """在数据变更时触发上传"""
        self.sync_manager.trigger_upload_on_change()
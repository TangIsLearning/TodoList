"""
数据同步管理模块
负责处理WebDAV数据同步逻辑
"""

import os
import time
import threading
from typing import Any, Callable, Dict, Optional, Tuple
from datetime import datetime
from backend.features.webdav.webdav_config import get_webdav_config, is_webdav_enabled, set_webdav_config
from backend.features.webdav.webdav_client import WebDAVClient, get_webdav_client
from backend.utils.logger import LogManager

class DataSyncManager(LogManager):
    """数据同步管理器"""
    
    def __init__(self) -> None:
        super().__init__()
        self.sync_timer: Optional[threading.Timer] = None
        self.is_syncing = False
        self.last_sync_time: Optional[datetime] = None
        self.on_sync_callback: Optional[Callable[[], None]] = None

    def set_sync_callback(self, callback: Callable[[], None]) -> None:
        """设置同步回调函数"""
        self.on_sync_callback = callback
    
    def start_auto_sync(self) -> None:
        """启动自动同步"""
        config = get_webdav_config()
        
        if not config.get('enabled', False) or not config.get('auto_sync', True):
            self.get_logger.info("自动同步未启用")
            return
            
        interval = config.get('sync_interval', 15)  # 默认15s

        # 取消之前的定时器
        if self.sync_timer:
            self.sync_timer.cancel()
        
        # 启动定时同步
        self._schedule_sync(interval)
        self.get_logger.info(f"自动同步已启动，间隔: {interval}秒")
    
    def stop_auto_sync(self) -> None:
        """停止自动同步"""
        if self.sync_timer:
            self.sync_timer.cancel()
            self.sync_timer = None
            self.get_logger.info("自动同步已停止")
    
    def _schedule_sync(self, interval: int) -> None:
        """安排下次同步"""
        def sync_wrapper() -> None:
            try:
                self.sync_from_cloud()
                self.get_logger.info(f"定时同步中")
            except Exception as e:
                self.get_logger.error(f"定时同步出错: {e}")
            finally:
                # 安排下一次同步
                self._schedule_sync(interval)
        
        self.sync_timer = threading.Timer(interval, sync_wrapper)
        self.sync_timer.daemon = True
        self.sync_timer.start()

    def _prepare_sync(self) -> Tuple[WebDAVClient, str]:
        """准备同步环境，返回 (WebDAV客户端, 本地应用数据目录)"""
        if self.is_syncing:
            raise Exception('同步正在进行中')
        if not is_webdav_enabled():
            raise Exception('WebDAV未启用')

        client = get_webdav_client()
        config = get_webdav_config()
        url = config.get('url', 'https://dav.jianguoyun.com/dav')
        if not client.configure(config['username'], config['password'], config['remote_path'], url):
            raise Exception('WebDAV客户端配置失败')

        # 本地应用数据目录：<存储目录>/todolist（包含 todo.db 与 attachment）
        from backend.config_manager import get_app_dir
        local_dir = str(get_app_dir())
        return client, local_dir

    def sync_from_cloud(self, is_overwrite: bool = False) -> None:
        client, local_dir = self._prepare_sync()
        self.is_syncing = True
        try:
            self.get_logger.info("开始从云端同步数据...")
            client.download_app_dir(local_dir, is_overwrite)
            self.last_sync_time = datetime.now()
            self.get_logger.info("云端数据同步成功")
            if self.on_sync_callback:
                try:
                    self.on_sync_callback()
                except Exception as e:
                    self.get_logger.error(f"同步回调执行失败: {e}")
        finally:
            self.is_syncing = False

    def sync_to_cloud(self) -> None:
        client, local_dir = self._prepare_sync()
        self.is_syncing = True
        try:
            self.get_logger.info("开始上传数据到云端...")
            if not os.path.exists(local_dir):
                raise Exception(f'本地数据目录不存在: {local_dir}')
            client.upload_app_dir(local_dir)
            self.last_sync_time = datetime.now()
            self.get_logger.info("数据上传到云端成功")
        finally:
            self.is_syncing = False

    def download_attachment(self, relative_path: str, local_file: str) -> None:
        """按需下载单个附件（移动端查看附件时使用）

        Args:
            relative_path: 附件相对路径（attachment/YYYY/YYYYMM/YYYYMMDD/xxx）
            local_file: 本地下载目标路径
        """
        if not is_webdav_enabled():
            raise Exception('WebDAV未启用')

        client = get_webdav_client()
        config = get_webdav_config()
        url = config.get('url', 'https://dav.jianguoyun.com/dav')
        if not client.configure(config['username'], config['password'], config['remote_path'], url):
            raise Exception('WebDAV客户端配置失败')

        remote_path = client.build_remote_path(relative_path)
        client.download_file(remote_path, local_file, is_overwrite=True, compare_version=False)

    def trigger_upload_on_change(self) -> None:
        """在数据变更时触发上传"""
        config = get_webdav_config()
        if not config.get('enabled', False):
            return
            
        # 异步执行上传，避免阻塞主线程
        upload_thread = threading.Thread(target=self._delayed_upload, daemon=True)
        upload_thread.start()

    def _delayed_upload(self) -> None:
        """延迟上传，避免频繁操作"""
        time.sleep(1)  # 等待1秒再上传
        try:
            self.sync_to_cloud()
        except Exception as e:
            self.get_logger.error(f"变更时上传失败: {e}")

    def get_webdav_config(self) -> Dict[str, Any]:
        """获取WebDAV配置"""
        return get_webdav_config()

    def set_webdav_config(self, config: Dict[str, Any]) -> None:
        """设置WebDAV配置"""
        # 保存配置前，测试数据同步连接是否成功
        url = config.get('url', '')
        username = config.get('username', '')
        password = config.get('password', '')
        remote_path = config.get('remote_path', '')
        self.test_webdav_connection(url, username, password, remote_path)

        # 保存配置
        success = set_webdav_config(config)

        if not success:
            raise Exception(f'配置保存失败')

        # 如果启用了自动同步，重启同步管理器
        if config.get('enabled') and config.get('auto_sync'):
            get_data_sync_manager().start_auto_sync()
        elif not config.get('enabled') or not config.get('auto_sync'):
            # 停止自动同步
            get_data_sync_manager().stop_auto_sync()

    def test_webdav_connection(self, url: str, username: str, password: str, remote_path: str) -> None:
        """测试WebDAV连接"""
        # 创建临时客户端进行测试
        client = get_webdav_client()
        if not client.configure(username, password, remote_path, url):
            raise Exception(f'客户端配置失败')
        client.test_connection()

# 全局同步管理器实例
_data_sync_manager: Optional[DataSyncManager] = None

def get_data_sync_manager() -> DataSyncManager:
    """获取全局数据同步管理器实例"""
    global _data_sync_manager
    if _data_sync_manager is None:
        _data_sync_manager = DataSyncManager()
    return _data_sync_manager
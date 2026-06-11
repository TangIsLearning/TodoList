"""
数据同步管理模块
负责处理WebDAV数据同步逻辑
"""

import os
import time
import threading
import logging
from typing import Optional, Callable
from datetime import datetime

from backend.config_manager import get_webdav_config, is_webdav_enabled
from backend.webdav.webdav_client import get_webdav_client

logger = logging.getLogger(__name__)

class DataSyncManager:
    """数据同步管理器"""
    
    def __init__(self):
        self.sync_timer = None
        self.is_syncing = False
        self.last_sync_time = None
        self.on_sync_callback: Optional[Callable] = None
        
    def set_sync_callback(self, callback: Callable):
        """设置同步回调函数"""
        self.on_sync_callback = callback
    
    def start_auto_sync(self):
        """启动自动同步"""
        config = get_webdav_config()
        
        if not config.get('enabled', False) or not config.get('auto_sync', True):
            logger.info("自动同步未启用")
            return
            
        interval = config.get('sync_interval', 15)  # 默认15s

        # 取消之前的定时器
        if self.sync_timer:
            self.sync_timer.cancel()
        
        # 启动定时同步
        self._schedule_sync(interval)
        logger.info(f"自动同步已启动，间隔: {interval}秒")
    
    def stop_auto_sync(self):
        """停止自动同步"""
        if self.sync_timer:
            self.sync_timer.cancel()
            self.sync_timer = None
            logger.info("自动同步已停止")
    
    def _schedule_sync(self, interval: int):
        """安排下次同步"""
        def sync_wrapper():
            try:
                self.sync_from_cloud()
                logger.info(f"定时同步中")
            except Exception as e:
                logger.error(f"定时同步出错: {e}")
            finally:
                # 安排下一次同步
                self._schedule_sync(interval)
        
        self.sync_timer = threading.Timer(interval, sync_wrapper)
        self.sync_timer.daemon = True
        self.sync_timer.start()
    
    def sync_from_cloud(self, is_overwrite = False) -> dict:
        """
        从云端同步数据到本地
        
        Returns:
            dict: 同步结果
        """
        if self.is_syncing:
            return {
                "success": False,
                "error": "同步正在进行中"
            }

        if not is_webdav_enabled():
            return {
                "success": False,
                "error": "WebDAV未启用"
            }
        
        self.is_syncing = True
        try:
            logger.info("开始从云端同步数据...")
            
            # 获取WebDAV客户端
            client = get_webdav_client()
            config = get_webdav_config()
            
            # 配置客户端
            if not client.configure(config['username'], config['password'], config['remote_path']):
                return {
                    "success": False,
                    "error": "WebDAV客户端配置失败"
                }
            
            # 获取本地数据文件路径
            from backend.config import get_current_data_file
            local_file = get_current_data_file()
            
            # 下载文件
            result = client.download_file(local_file, is_overwrite)
            
            if result['success']:
                self.last_sync_time = datetime.now()
                logger.info("云端数据同步成功")
                
                # 触发回调
                if self.on_sync_callback:
                    try:
                        self.on_sync_callback()
                    except Exception as e:
                        logger.error(f"同步回调执行失败: {e}")
                
                return {
                    "success": True,
                    "message": "数据同步成功",
                    "timestamp": self.last_sync_time.isoformat()
                }
            else:
                logger.error(f"云端数据同步失败: {result['error']}")
                return result
                
        except Exception as e:
            logger.error(f"云端同步异常: {e}")
            return {
                "success": False,
                "error": f"同步异常: {str(e)}"
            }
        finally:
            self.is_syncing = False
    
    def sync_to_cloud(self) -> dict:
        """
        将本地数据同步到云端
        
        Returns:
            dict: 同步结果
        """
        if self.is_syncing:
            return {
                "success": False,
                "error": "同步正在进行中"
            }
        
        if not is_webdav_enabled():
            return {
                "success": False,
                "error": "WebDAV未启用"
            }
        
        self.is_syncing = True
        try:
            logger.info("开始上传数据到云端...")
            
            # 获取WebDAV客户端
            client = get_webdav_client()
            config = get_webdav_config()
            
            # 配置客户端
            if not client.configure(config['username'], config['password'], config['remote_path']):
                return {
                    "success": False,
                    "error": "WebDAV客户端配置失败"
                }
            
            # 获取本地数据文件路径
            from backend.config import get_current_data_file
            local_file = get_current_data_file()
            
            # 检查本地文件是否存在
            if not os.path.exists(local_file):
                return {
                    "success": False,
                    "error": f"本地数据文件不存在: {local_file}"
                }
            
            # 上传文件
            result = client.upload_file(local_file)
            
            if result['success']:
                self.last_sync_time = datetime.now()
                logger.info("数据上传到云端成功")
                return {
                    "success": True,
                    "message": "数据上传成功",
                    "timestamp": self.last_sync_time.isoformat()
                }
            else:
                logger.error(f"数据上传到云端失败: {result['error']}")
                return result
                
        except Exception as e:
            logger.error(f"云端上传异常: {e}")
            return {
                "success": False,
                "error": f"上传异常: {str(e)}"
            }
        finally:
            self.is_syncing = False
    
    def get_sync_status(self) -> dict:
        """获取同步状态"""
        return {
            "enabled": is_webdav_enabled(),
            "is_syncing": self.is_syncing,
            "last_sync_time": self.last_sync_time.isoformat() if self.last_sync_time else None,
            "auto_sync": get_webdav_config().get('auto_sync', False)
        }
    
    def trigger_upload_on_change(self):
        """在数据变更时触发上传"""
        config = get_webdav_config()
        if not config.get('enabled', False):
            return
            
        # 异步执行上传，避免阻塞主线程
        upload_thread = threading.Thread(target=self._delayed_upload, daemon=True)
        upload_thread.start()
    
    def _delayed_upload(self):
        """延迟上传，避免频繁操作"""
        time.sleep(1)  # 等待1秒再上传
        try:
            self.sync_to_cloud()
        except Exception as e:
            logger.error(f"变更时上传失败: {e}")

# 全局同步管理器实例
_data_sync_manager: Optional[DataSyncManager] = None

def get_data_sync_manager() -> DataSyncManager:
    """获取全局数据同步管理器实例"""
    global _data_sync_manager
    if _data_sync_manager is None:
        _data_sync_manager = DataSyncManager()
    return _data_sync_manager
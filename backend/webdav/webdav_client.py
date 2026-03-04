"""
坚果云WebDAV客户端模块
提供连接、上传、下载等功能
"""

import os
import logging
import re
from pathlib import Path
from typing import Optional, Dict, Any
from webdav3.client import Client
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def _parse_webdav_time(time_str):
    """
    解析WebDAV返回的两种常见时间格式：
    - GMT格式：Mon, 02 Mar 2026 05:29:30 GMT
    - ISO格式：2026-03-02T05:29:30Z
    :param time_str: 时间字符串
    :return: 时间戳（float）
    """
    # %a: 星期缩写（Mon）, %d: 日期(02), %b: 月份缩写(Mar), %Y: 年, %H:%M:%S: 时分秒, %Z: 时区(GMT)
    time_str_without_tz = re.sub(r'\s+GMT$', '', time_str)
    dt_naive = datetime.strptime(time_str_without_tz, '%a, %d %b %Y %H:%M:%S')
    return dt_naive.replace(tzinfo=timezone.utc).timestamp()


class WebDAVClient:
    """坚果云WebDAV客户端"""

    def __init__(self):
        self.client = None
        self.username = None
        self.password = None
        self.remote_path = None

    def configure(self, username: str, password: str, remote_path: str) -> bool:
        """
        配置WebDAV连接参数
        
        Args:
            username: 坚果云用户名
            password: 坚果云应用密码
            remote_path： 坚果云文件路径
            
        Returns:
            bool: 配置是否成功
        """
        if not username or not password:
            logger.error("用户名或密码不能为空")
            return False
            
        self.username = username
        self.password = password
        self.remote_path = remote_path

        try:
            options = {
                'webdav_hostname': 'https://dav.jianguoyun.com/dav',
                'webdav_login': self.username,
                'webdav_password': self.password,
                'disable_check': True
            }
            self.client = Client(options)

            logger.info("WebDAV客户端配置成功")
            return True
        except Exception as e:
            logger.error(f"WebDAV客户端配置失败: {e}")
            self.client = None
            return False
    
    def test_connection(self) -> Dict[str, Any]:
        """
        测试WebDAV连接
        
        Returns:
            dict: 包含连接状态和错误信息的字典
        """
        if not self.client:
            return {
                "success": False,
                "error": "WebDAV客户端未配置"
            }
        
        try:
            # 尝试列出根目录内容来测试连接
            self.client.list('/')
            return {
                "success": True,
                "message": "连接成功"
            }
        except Exception as e:
            logger.error(f"WebDAV连接测试失败: {e}")
            return {
                "success": False,
                "error": f"连接失败: {str(e)}"
            }
    
    def upload_file(self, local_file_path: str) -> Dict[str, Any]:
        """
        上传本地文件到坚果云
        
        Args:
            local_file_path: 本地文件路径
            
        Returns:
            dict: 上传结果
        """
        if not self.client:
            return {
                "success": False,
                "error": "WebDAV客户端未配置"
            }
        
        if not os.path.exists(local_file_path):
            return {
                "success": False,
                "error": f"本地文件不存在: {local_file_path}"
            }
        
        try:
            # 确保远程目录存在
            remote_dir = os.path.dirname(self.remote_path)
            if remote_dir:
                self._ensure_remote_directory(remote_dir)
            
            # 上传文件
            self.client.upload_sync(remote_path = self.remote_path, local_path = local_file_path)
            logger.info(f"文件上传成功: {local_file_path} -> {self.remote_path}")
            
            return {
                "success": True,
                "message": "文件上传成功",
                "remote_path": self.remote_path
            }
        except Exception as e:
            logger.error(f"文件上传失败: {e}")
            return {
                "success": False,
                "error": f"上传失败: {str(e)}"
            }

    def download_file(self, local_file_path: str, is_overwrite: bool = False) -> Dict[str, Any]:
        """
        从坚果云下载文件到本地
        
        Args:
            local_file_path: 本地文件路径
            is_overwrite: 强制覆盖，默认为false
            
        Returns:
            dict: 下载结果
        """
        if not self.client:
            return {
                "success": False,
                "error": "WebDAV客户端未配置"
            }
        
        try:
            # 检查远程文件是否存在
            if not self._remote_file_exists(self.remote_path):
                return {
                    "success": False,
                    "error": "远程文件不存在"
                }
            
            # 确保本地目录存在
            local_path = Path(local_file_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)

            # 步骤2：获取远程文件的最后修改时间（时间戳）
            remote_info = self.client.info(self.remote_path)
            # 坚果云返回的modified是字符串（如 '2026-03-02T10:00:00Z'），转成时间戳
            remote_modified_str = remote_info['modified']
            remote_modified = _parse_webdav_time(remote_modified_str)

            # 步骤3：获取本地文件的最后修改时间（若本地文件不存在，直接下载）
            if not os.path.exists(local_file_path):
                print("本地文件不存在，执行首次下载")
                self.client.download_sync(remote_path=self.remote_path, local_path=local_file_path)
                return {
                    "success": True,
                    "message": "文件下载成功",
                    "local_path": local_file_path
                }

            local_modified = datetime.fromtimestamp(os.path.getmtime(local_file_path), tz=timezone.utc)
            print(f"远程时间：{remote_modified}，本地时间：{local_modified.timestamp()}")

            # 步骤4：对比时间戳（版本），仅远程更新时下载
            # 加1秒容差：避免系统时间微小差异导致误判
            if remote_modified > local_modified.timestamp() + 1 or is_overwrite:
                print(f"远程文件更新（远程时间：{remote_modified} > 本地时间：{local_modified}），执行下载")
                self.client.download_sync(remote_path=self.remote_path, local_path=local_file_path)
                return {
                    "success": True,
                    "message": "文件下载成功",
                    "local_path": local_file_path
                }
            else:
                print(f"远程文件版本早于本地，跳过下载")
                return {
                    "success": False,
                    "error": "远程文件版本早于本地，跳过下载"
                }
        except Exception as e:
            logger.error(f"文件下载失败: {e}")
            return {
                "success": False,
                "error": f"下载失败: {str(e)}"
            }

    def _ensure_remote_directory(self, remote_dir: str):
        """
        确保远程目录存在，如果不存在则创建
        
        Args:
            remote_dir: 远程目录路径
        """
        try:
            # 尝试列出目录，如果失败说明目录不存在
            self.client.list(remote_dir)
        except:
            # 目录不存在，需要逐级创建
            dirs = remote_dir.strip('/').split('/')
            current_path = ''
            
            for dir_name in dirs:
                if dir_name:
                    current_path = f"{current_path}/{dir_name}" if current_path else dir_name
                    try:
                        self.client.mkdir(current_path)
                        logger.debug(f"创建远程目录: {current_path}")
                    except:
                        # 目录可能已经存在，忽略错误
                        pass
    
    def _remote_file_exists(self, remote_path: str) -> bool:
        """
        检查远程文件是否存在
        
        Args:
            remote_path: 远程文件路径
            
        Returns:
            bool: 文件是否存在
        """
        try:
            return self.client.check(remote_path)
        except Exception as e:
            logger.error(f"检查远程文件存在性失败: {e}")
            return False
    
    def is_configured(self) -> bool:
        """
        检查是否已配置WebDAV
        
        Returns:
            bool: 是否已配置
        """
        return self.client is not None and self.username is not None and self.password is not None


# 全局WebDAV客户端实例
_webdav_client: Optional[WebDAVClient] = None

def get_webdav_client() -> WebDAVClient:
    """获取全局WebDAV客户端实例"""
    global _webdav_client
    if _webdav_client is None:
        _webdav_client = WebDAVClient()
    return _webdav_client
"""
坚果云WebDAV客户端模块
提供连接、上传、下载等功能
"""

import os
import re
from pathlib import Path
from typing import Optional, Dict, Any
from webdav3.client import Client
from datetime import datetime, timezone
from backend.utils.logger import LogManager

def _parse_webdav_time(time_str: str) -> float:
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

class WebDAVClient(LogManager):
    """坚果云WebDAV客户端"""

    def __init__(self) -> None:
        super().__init__()
        self.url: Optional[str] = None
        self.client: Optional[Client] = None
        self.username: Optional[str] = None
        self.password: Optional[str] = None
        self.remote_path: Optional[str] = None

    def configure(self, username: str, password: str, remote_path: str, url: str = 'https://dav.jianguoyun.com/dav') -> bool:
        """
        配置WebDAV连接参数
        
        Args:
            username: WebDAV用户名
            password: WebDAV密码
            remote_path： 远程文件路径
            url: WebDAV服务器地址，默认为坚果云地址
            
        Returns:
            bool: 配置是否成功
        """
        if not username or not password:
            self.get_logger.error("用户名或密码不能为空")
            return False
            
        self.username = username
        self.password = password
        self.remote_path = remote_path
        self.url = url

        try:
            options = {
                'webdav_hostname': url,
                'webdav_login': self.username,
                'webdav_password': self.password,
                'disable_check': True
            }
            self.client = Client(options)

            self.get_logger.info("WebDAV客户端配置成功")
            return True
        except Exception as e:
            self.get_logger.error(f"WebDAV客户端配置失败: {e}")
            self.client = None
            return False
    
    def test_connection(self) -> None:
        """
        测试WebDAV连接
        
        Returns:
            dict: 包含连接状态和错误信息的字典
        """
        if not self.client:
            raise Exception(f'WebDAV客户端未配置')

        # 尝试列出根目录内容来测试连接
        path = '/'
        has_directory = "/" in self.remote_path
        if has_directory:
            filename = os.path.basename(self.remote_path)
            for item_path in self.remote_path.split('/'):
                client_list = self.client.list(path)
                item_path_exit = any(item_path in item for item in client_list)
                if item_path == filename:
                    # 如果已经遍历到最后一层，则直接判断结果，不再进一步遍历
                    file_exit = any(item_path == item for item in client_list)
                    if not file_exit:
                        raise Exception(f'路径不存在')
                if item_path_exit:
                    path = path + '/' + item_path
                else:
                    raise Exception(f'路径不存在')
        else:
            found = any(self.remote_path in item for item in self.client.list(path))
            if not found:
                raise Exception(f'路径不存在')
    
    def upload_file(self, local_file_path: str) -> None:
        """
        上传本地文件到坚果云
        
        Args:
            local_file_path: 本地文件路径
            
        Returns:
            dict: 上传结果
        """
        if not self.client:
            raise Exception(f'WebDAV客户端未配置')

        if not os.path.exists(local_file_path):
            raise Exception(f'本地文件不存在: {local_file_path}')

        # 确保远程目录存在
        remote_dir = os.path.dirname(self.remote_path)
        if remote_dir:
            self._ensure_remote_directory(remote_dir)

        # 上传文件
        self.client.upload_sync(remote_path = self.remote_path, local_path = local_file_path)
        self.get_logger.info(f"文件上传成功: {local_file_path} -> {self.remote_path}")

    def download_file(self, local_file_path: str, is_overwrite: bool = False) -> None:
        """
        从坚果云下载文件到本地
        
        Args:
            local_file_path: 本地文件路径
            is_overwrite: 强制覆盖，默认为false
            
        Returns:
            dict: 下载结果
        """
        if not self.client:
            raise Exception(f'WebDAV客户端未配置')

        # 检查远程文件是否存在
        if not self._remote_file_exists(self.remote_path):
            raise Exception(f'远程文件不存在')

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
            self.get_logger.warning("本地文件不存在，执行首次下载")
            self.client.download_sync(remote_path=self.remote_path, local_path=local_file_path)
            return

        local_modified = datetime.fromtimestamp(os.path.getmtime(local_file_path), tz=timezone.utc)
        self.get_logger.info(f"远程时间：{remote_modified}，本地时间：{local_modified.timestamp()}")

        # 步骤4：对比时间戳（版本），仅远程更新时下载
        # 加1秒容差：避免系统时间微小差异导致误判
        if remote_modified <= local_modified.timestamp() + 1 and not is_overwrite:
            raise Exception(f'远程文件版本早于本地，跳过下载')
        self.client.download_sync(remote_path=self.remote_path, local_path=local_file_path)
        self.service.sync_reminder_to_calendar(local_modified.timestamp() + 1, remote_modified)

    def _ensure_remote_directory(self, remote_dir: str) -> None:
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
                        self.get_logger.debug(f"创建远程目录: {current_path}")
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
            self.get_logger.error(f"检查远程文件存在性失败: {e}")
            return False

# 全局WebDAV客户端实例
_webdav_client: Optional[WebDAVClient] = None

def get_webdav_client() -> WebDAVClient:
    """获取全局WebDAV客户端实例"""
    global _webdav_client
    if _webdav_client is None:
        _webdav_client = WebDAVClient()
    return _webdav_client
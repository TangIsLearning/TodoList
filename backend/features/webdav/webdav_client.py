"""
坚果云WebDAV客户端模块
提供连接、目录/文件上传、下载等功能

说明：
- remote_path 现在表示「同步目录」，该目录与本地应用数据目录
  （<存储目录>/todolist，内含 todo.db 与 attachment 附件目录）一一对应。
- 兼容旧版本：若 remote_path 指向的是 db 文件路径，会自动取其父目录作为同步目录。
"""

import os
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from webdav3.client import Client
from datetime import datetime, timezone
from backend.utils.logger import LogManager

# 本地应用数据目录中需要同步的数据库文件名
DB_FILE_NAME = 'todo.db'
# 附件目录名
ATTACHMENT_DIR_NAME = 'attachment'


def _parse_webdav_time(time_str: str) -> float:
    """
    解析WebDAV返回的两种常见时间格式：
    - GMT格式：Mon, 02 Mar 2026 05:29:30 GMT
    - ISO格式：2026-03-02T05:29:30Z
    :param time_str: 时间字符串
    :return: 时间戳（float）
    """
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

    # ==================== 配置 ====================

    def configure(self, username: str, password: str, remote_path: str,
                  url: str = 'https://dav.jianguoyun.com/dav') -> bool:
        """配置WebDAV连接参数

        Args:
            username: WebDAV用户名
            password: WebDAV密码
            remote_path: 远程同步目录（兼容旧的 db 文件路径，会自动取其父目录）
            url: WebDAV服务器地址
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

    @property
    def remote_dir(self) -> str:
        """远程同步目录（标准化为 /a/b 形式，根目录返回 ''）"""
        raw = (self.remote_path or '').strip()
        # 兼容旧版本：如果配置的是 db 文件路径，则取父目录
        if raw.lower().endswith('.db'):
            raw = os.path.dirname(raw)
        raw = raw.strip().strip('/')
        return f'/{raw}' if raw else ''

    def _remote_join(self, *parts: str) -> str:
        """拼接远程路径"""
        segments = [p.strip('/') for p in parts if p and p.strip('/')]
        base = self.remote_dir.strip('/')
        if base:
            segments.insert(0, base)
        return '/' + '/'.join(segments)

    def build_remote_path(self, relative_path: str) -> str:
        """将相对于同步目录的相对路径拼接为完整远程路径"""
        return self._remote_join(relative_path)

    # ==================== 连接测试 ====================

    def test_connection(self) -> None:
        """测试WebDAV连接，并确保同步目录存在"""
        if not self.client:
            raise Exception('WebDAV客户端未配置')

        # 列出根目录，验证账号可用
        self.client.list('/')

        # 确保同步目录存在（不存在则创建）
        if self.remote_dir:
            self._ensure_remote_directory(self.remote_dir)

    # ==================== 远程目录 ====================

    def _ensure_remote_directory(self, remote_dir: str) -> None:
        """确保远程目录存在，如果不存在则逐级创建"""
        remote_dir = '/' + str(remote_dir).strip('/')
        if remote_dir == '/':
            return

        current = ''
        for part in [p for p in remote_dir.split('/') if p]:
            current += f'/{part}'
            try:
                if self.client.check(current):
                    continue
            except Exception:
                pass
            try:
                self.client.mkdir(current)
                self.get_logger.debug(f"创建远程目录: {current}")
            except Exception:
                # 目录可能已存在（并发场景），忽略
                pass

    def _remote_file_exists(self, remote_path: str) -> bool:
        """检查远程文件是否存在"""
        try:
            return self.client.check(remote_path)
        except Exception as e:
            self.get_logger.error(f"检查远程文件存在性失败: {e}")
            return False

    def _list_files_recursive(self, remote_dir: str) -> List[str]:
        """递归列出远程目录下的所有文件"""
        results: List[str] = []
        if not self.client:
            return results

        remote_dir = '/' + str(remote_dir).strip('/') if str(remote_dir).strip('/') else '/'
        try:
            items = self.client.list(remote_dir, get_info=False)
        except Exception as e:
            self.get_logger.warning(f"列出远程目录失败 {remote_dir}: {e}")
            return results

        base = remote_dir.rstrip('/')
        for item in items:
            full = item if str(item).startswith('/') else f'{base}/{item}'
            full = full.rstrip('/')
            if not full or full == base:
                continue
            try:
                if self.client.is_dir(full):
                    results.extend(self._list_files_recursive(full))
                else:
                    results.append(full)
            except Exception:
                results.append(full)
        return results

    # ==================== 上传 ====================

    def upload_file(self, remote_file: str, local_file: str) -> None:
        """上传单个文件到指定远程路径"""
        if not self.client:
            raise Exception('WebDAV客户端未配置')
        if not os.path.exists(local_file):
            raise Exception(f'本地文件不存在: {local_file}')

        parent = os.path.dirname(remote_file)
        if parent:
            self._ensure_remote_directory(parent)

        self.client.upload_sync(remote_path=remote_file, local_path=local_file)
        self.get_logger.info(f"文件上传成功: {local_file} -> {remote_file}")

    def upload_app_dir(self, local_dir: str) -> None:
        """将本地应用数据目录（todo.db + attachment）整体上传到远程同步目录"""
        local_path = Path(local_dir)
        if not local_path.exists():
            raise Exception(f'本地数据目录不存在: {local_dir}')

        if self.remote_dir:
            self._ensure_remote_directory(self.remote_dir)

        uploaded = 0
        for file in local_path.rglob('*'):
            if not file.is_file():
                continue
            rel = file.relative_to(local_path).as_posix()
            remote_file = self._remote_join(rel)
            self.upload_file(remote_file, str(file))
            uploaded += 1
        self.get_logger.info(f"数据目录上传完成，共 {uploaded} 个文件")

    # ==================== 下载 ====================

    def download_file(self, remote_file: str, local_file: str,
                      is_overwrite: bool = False, compare_version: bool = True) -> bool:
        """下载单个远程文件到本地

        Returns:
            bool: 是否实际执行了下载
        """
        if not self.client:
            raise Exception('WebDAV客户端未配置')

        if not self._remote_file_exists(remote_file):
            raise Exception('远程文件不存在')

        local_path = Path(local_file)
        local_path.parent.mkdir(parents=True, exist_ok=True)

        if compare_version and local_path.exists() and not is_overwrite:
            try:
                remote_info = self.client.info(remote_file)
                remote_modified = _parse_webdav_time(remote_info['modified'])
                local_modified = datetime.fromtimestamp(
                    os.path.getmtime(local_file), tz=timezone.utc
                ).timestamp()
                # 加1秒容差，避免系统时间微小差异导致误判
                if remote_modified <= local_modified + 1:
                    self.get_logger.info("远程文件版本不新于本地，跳过下载")
                    return False
            except Exception as e:
                # 时间解析失败时直接下载，避免同步中断
                self.get_logger.warning(f"比较远程/本地文件版本失败，将直接下载: {e}")

        self.client.download_sync(remote_path=remote_file, local_path=local_file)
        return True

    def download_app_dir(self, local_dir: str, is_overwrite: bool = False) -> None:
        """从远程同步目录整体下载到本地应用数据目录

        - todo.db：按版本（修改时间）判断，避免覆盖较新的本地数据
        - attachment 附件：文件不可变（文件名含唯一标识），仅下载本地缺失的文件
        """
        local_path = Path(local_dir)
        local_path.mkdir(parents=True, exist_ok=True)

        if not self.remote_dir or not self._remote_file_exists(self.remote_dir):
            self.get_logger.warning("远程同步目录不存在，跳过下载")
            return

        remote_files = self._list_files_recursive(self.remote_dir)
        base = self.remote_dir.rstrip('/')

        for remote_file in remote_files:
            rel = remote_file[len(base):].lstrip('/')
            if not rel:
                continue
            local_file = local_path / rel

            if rel == DB_FILE_NAME:
                downloaded = self.download_file(remote_file, str(local_file), is_overwrite)
                if downloaded:
                    # 同步日历提醒
                    try:
                        remote_info = self.client.info(remote_file)
                        remote_modified = _parse_webdav_time(remote_info['modified'])
                        self.service.sync_reminder_to_calendar(remote_modified - 1, remote_modified)
                    except Exception:
                        pass
            else:
                if local_file.exists() and not is_overwrite:
                    continue
                local_file.parent.mkdir(parents=True, exist_ok=True)
                try:
                    self.client.download_sync(remote_path=remote_file, local_path=str(local_file))
                except Exception as e:
                    self.get_logger.error(f"下载附件失败 {remote_file}: {e}")

        self.get_logger.info("数据目录下载完成")


# 全局WebDAV客户端实例
_webdav_client: Optional[WebDAVClient] = None


def get_webdav_client() -> WebDAVClient:
    """获取全局WebDAV客户端实例"""
    global _webdav_client
    if _webdav_client is None:
        _webdav_client = WebDAVClient()
    return _webdav_client

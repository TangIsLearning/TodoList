# backend/features/attachment/attachment_service.py
"""附件服务

职责：
1. 将用户选择的实体文件复制到存储目录（不移动、不删除原文件）
2. 按 年/年月/年月日 的方式拆分目录存储
3. 提供附件文件的删除、定位能力
4. 为移动端/云端同步场景提供附件访问地址拼接
"""
from __future__ import annotations

import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import quote

from backend.utils.logger import LogManager

# 附件限制
MAX_ATTACHMENT_COUNT = 5
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  # 10MB

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.heic'}

# 附件类型
TYPE_FILE = 'file'
TYPE_LINK = 'link'


class AttachmentError(Exception):
    """附件相关业务异常"""


class AttachmentService(LogManager):
    """附件服务"""

    ATTACHMENT_DIR_NAME = 'attachment'

    @property
    def attachment_root(self) -> Path:
        """附件根目录：<存储目录>/todolist/attachment"""
        from backend.config_manager import get_attachment_dir
        return get_attachment_dir()

    # ==================== 路径处理 ====================

    @staticmethod
    def normalize_relative_path(relative_path: str) -> str:
        """统一使用 / 作为分隔符，兼容不同平台"""
        return str(relative_path).replace('\\', '/').strip('/')

    def get_date_dir(self, dt: Optional[datetime] = None) -> Path:
        """获取按年月日拆分的目录：attachment/YYYY/YYYYMM/YYYYMMDD"""
        dt = dt or datetime.now()
        year = dt.strftime('%Y')
        year_month = dt.strftime('%Y%m')
        day = dt.strftime('%Y%m%d')
        return self.attachment_root / year / year_month / day

    def resolve_path(self, relative_path: str) -> Path:
        """将相对路径解析为绝对路径"""
        rel = self.normalize_relative_path(relative_path)
        return self.attachment_root / rel

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """清理文件名，避免非法字符"""
        name = os.path.basename(name or '').strip()
        name = re.sub(r'[\\/:*?"<>|\r\n\t]+', '_', name)
        return name or 'attachment'

    @staticmethod
    def is_image(name: str) -> bool:
        """根据文件名判断是否为图片"""
        return Path(name or '').suffix.lower() in IMAGE_EXTENSIONS

    # ==================== 文件复制 ====================

    def save_file(self, source_path: str, size: Optional[int] = None,
                  dt: Optional[datetime] = None) -> Dict[str, Any]:
        """复制用户选择的文件到附件存储目录

        Args:
            source_path: 用户原始文件路径（不会被删除或移动）
            size: 文件大小（可选，未提供则实时读取）

        Returns:
            包含 name / relativePath / size / isImage / mimeType 的字典

        Raises:
            AttachmentError: 源文件不存在或超过大小限制
        """
        src = Path(source_path)
        if not src.exists() or not src.is_file():
            raise AttachmentError(f"附件文件不存在: {source_path}")

        real_size = src.stat().st_size if size is None else int(size)
        if real_size > MAX_ATTACHMENT_SIZE:
            raise AttachmentError(
                f"附件「{src.name}」超过单个 {MAX_ATTACHMENT_SIZE // (1024 * 1024)}MB 的大小限制"
            )

        target_dir = self.get_date_dir(dt)
        target_dir.mkdir(parents=True, exist_ok=True)

        safe_name = self._sanitize_filename(src.name)
        unique_name = f"{uuid.uuid4().hex}_{safe_name}"
        target_file = target_dir / unique_name

        shutil.copy2(str(src), str(target_file))

        relative_path = self.normalize_relative_path(str(target_file.relative_to(self.attachment_root)))
        return {
            'name': safe_name,
            'relativePath': relative_path,
            'size': real_size,
            'isImage': self.is_image(safe_name),
            'mimeType': self._guess_mime(safe_name),
        }

    def delete_file(self, relative_path: Optional[str]) -> bool:
        """删除附件实体文件（若存在）"""
        if not relative_path:
            return False
        try:
            target = self.resolve_path(relative_path)
            if target.exists() and target.is_file():
                target.unlink()
                self._cleanup_empty_dirs(target.parent)
                return True
        except Exception as e:
            self.get_logger.error(f"删除附件文件失败: {relative_path}, 错误: {e}")
        return False

    def _cleanup_empty_dirs(self, directory: Path) -> None:
        """清理因删除文件而产生的空目录（不删除 attachment 根目录）"""
        root = self.attachment_root
        current = directory
        while current != root and root in current.parents:
            try:
                if any(current.iterdir()):
                    break
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def file_exists(self, relative_path: Optional[str]) -> bool:
        if not relative_path:
            return False
        return self.resolve_path(relative_path).exists()

    # ==================== 实体文件打包 / 还原（P2P 等场景） ====================

    def _safe_resolve(self, relative_path: str) -> Optional[Path]:
        """将相对路径安全地解析到附件根目录下（校验路径穿越）"""
        rel = self.normalize_relative_path(relative_path)
        if not rel or rel.startswith('..') or '..' in Path(rel).parts:
            return None
        try:
            root = self.attachment_root.resolve()
            target = (root / rel).resolve()
            target.relative_to(root)
        except (ValueError, OSError):
            return None
        return target

    def collect_files(self, relative_paths: Optional[Iterable[str]]) -> Dict[str, str]:
        """收集附件实体文件并以 base64 编码，用于 P2P 等场景整体传输

        Args:
            relative_paths: 附件相对路径集合（file 类型附件的 file_path）

        Returns:
            {归一化的相对路径: base64 文本}，不存在的文件会被跳过
        """
        import base64
        files: Dict[str, str] = {}
        for relative_path in relative_paths or []:
            if not relative_path:
                continue
            rel = self.normalize_relative_path(relative_path)
            if rel in files:
                continue
            target = self._safe_resolve(rel)
            if not target or not target.exists() or not target.is_file():
                self.get_logger.warning(f"附件实体文件缺失，跳过打包: {rel}")
                continue
            try:
                files[rel] = base64.b64encode(target.read_bytes()).decode('ascii')
            except Exception as e:
                self.get_logger.error(f"读取附件文件失败: {rel}, 错误: {e}")
        return files

    def restore_files(self, files: Optional[Dict[str, str]]) -> int:
        """将 base64 编码的附件实体文件还原到附件存储目录

        Args:
            files: {相对路径: base64 文本}

        Returns:
            成功写入的文件数量
        """
        import base64
        restored = 0
        for relative_path, content in (files or {}).items():
            target = self._safe_resolve(relative_path)
            if not target:
                self.get_logger.warning(f"忽略非法的附件路径: {relative_path}")
                continue
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(base64.b64decode(content))
                restored += 1
            except Exception as e:
                self.get_logger.error(f"写入附件文件失败: {relative_path}, 错误: {e}")
        return restored

    # ==================== 云端（WebDAV）地址拼接 ====================

    def build_remote_url(self, relative_path: str) -> Optional[str]:
        """拼接云端附件访问地址

        移动端可通过 WebDAV 直接拼接地址获取云端附件数据。
        格式：<webdav_url>/<同步目录>/attachment/<年>/<年月>/<年月日>/<文件>
        """
        try:
            from backend.features.webdav.webdav_config import get_webdav_config
            config = get_webdav_config()
            if not config or not config.get('enabled') or not config.get('url'):
                return None

            base_url = str(config.get('url')).rstrip('/')
            remote_dir = str(config.get('remote_path') or '').strip().strip('/')
            rel = self.normalize_relative_path(
                f'{AttachmentService.ATTACHMENT_DIR_NAME}/{relative_path}'
            )
            parts = [p for p in [remote_dir, rel] if p]
            full_path = '/'.join(parts)
            encoded = '/'.join(quote(seg) for seg in full_path.split('/'))
            return f'{base_url}/{encoded}'
        except Exception as e:
            self.get_logger.error(f"拼接云端附件地址失败: {e}")
            return None

    @staticmethod
    def _guess_mime(name: str) -> str:
        import mimetypes
        mime, _ = mimetypes.guess_type(name)
        return mime or 'application/octet-stream'


_attachment_service: Optional[AttachmentService] = None


def get_attachment_service() -> AttachmentService:
    """获取全局附件服务实例"""
    global _attachment_service
    if _attachment_service is None:
        _attachment_service = AttachmentService()
    return _attachment_service

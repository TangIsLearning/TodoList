# backend/api/mixins/attachment_api_mixin.py
"""附件相关 API Mixin

设计说明：
- 数据库仅保存附件的存储信息（相对路径 / 在线链接），不保存文件内容。
- 用户选择文件后，后端会把文件复制一份到存储目录，
  原文件不会被删除或移动。
- 实体文件按 附件根目录/YYYY/YYYYMM/YYYYMMDD 分层存放。
"""

import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from backend.utils.response_wrapper import api_handler
from backend.features.attachment.attachment_service import (
    AttachmentError,
    MAX_ATTACHMENT_COUNT,
    TYPE_FILE,
    TYPE_LINK,
    get_attachment_service,
)


class AttachmentApiMixin:
    """附件操作 Mixin"""

    # ==================== 内部方法（供任务 API 复用） ====================

    def _validate_attachment_count(self, attachments: List[Dict[str, Any]]) -> None:
        if attachments and len(attachments) > MAX_ATTACHMENT_COUNT:
            raise Exception(f"最多只能添加 {MAX_ATTACHMENT_COUNT} 个附件")

    def _create_attachment_from_payload(self, task_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """根据前端提交的附件信息创建附件（实体文件会复制到存储目录）"""
        service = get_attachment_service()
        att_type = payload.get('type', TYPE_FILE)

        if att_type == TYPE_LINK:
            url = (payload.get('url') or '').strip()
            if not url:
                return None
            name = (payload.get('name') or url).strip()
            return self.db.add_attachment(task_id, {
                'type': TYPE_LINK,
                'name': name,
                'url': url,
            })

        # 实体文件
        source_path = payload.get('sourcePath') or payload.get('path')
        if not source_path:
            return None
        saved = service.save_file(source_path, payload.get('size'))
        return self.db.add_attachment(task_id, {
            'type': TYPE_FILE,
            'name': payload.get('name') or saved['name'],
            # save_file 返回的键是 relativePath，而数据库模型读取的是 filePath，这里必须显式映射，
            # 否则 file_path 会写入 NULL，后续打开/定位附件都会失败
            'filePath': saved['relativePath'],
            'size': saved['size'],
            'mimeType': saved['mimeType'],
            'isImage': saved['isImage'],
        })

    def sync_task_attachments(self, task_id: str, attachments: Optional[List[Dict[str, Any]]]) -> None:
        """同步任务附件（用于新增/编辑任务时统一处理）

        前端提交的附件列表项：
        - 已存在：包含 id（保留）
        - 新增文件：包含 sourcePath / size
        - 新增链接：包含 type=link, url, name
        - 被移除：不包含在列表中，同步时删除记录及实体文件
        """
        if attachments is None:
            return

        self._validate_attachment_count(attachments)
        service = get_attachment_service()

        existing = {a['id']: a for a in self.db.get_task_attachments(task_id)}
        kept_ids = set()

        for item in attachments:
            att_id = item.get('id')
            if att_id and att_id in existing:
                kept_ids.add(att_id)
                current = existing[att_id]
                # 仅允许修改展示名称 / 链接地址
                self.db.update_attachment(att_id, {
                    'name': (item.get('name') or current['name']),
                    'url': item.get('url', current.get('url')),
                })
            else:
                self._create_attachment_from_payload(task_id, item)

        # 删除已被移除的附件（含实体文件）
        for att_id, att in existing.items():
            if att_id in kept_ids:
                continue
            self.db.delete_attachment(att_id)
            if att.get('type') == TYPE_FILE:
                service.delete_file(att.get('filePath'))

    def cleanup_task_attachments(self, task_id: str) -> None:
        """删除任务的所有附件记录及实体文件"""
        service = get_attachment_service()
        attachments = self.db.delete_task_attachments(task_id)
        for att in attachments:
            if att.get('type') == TYPE_FILE:
                service.delete_file(att.get('filePath'))

    # ==================== 公开 API ====================

    @api_handler
    def get_task_attachments(self, task_id: str) -> List[Dict[str, Any]]:
        """获取任务的附件列表"""
        return self.db.get_task_attachments(task_id)

    @api_handler
    def add_task_attachment(self, task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """为任务新增单个附件"""
        task = self.db.get_task(task_id)
        if not task:
            raise Exception("任务不存在")

        current = self.db.get_task_attachments(task_id)
        if len(current) >= MAX_ATTACHMENT_COUNT:
            raise Exception(f"最多只能添加 {MAX_ATTACHMENT_COUNT} 个附件")

        created = self._create_attachment_from_payload(task_id, payload or {})
        if not created:
            raise Exception("附件信息不完整")
        return created

    @api_handler
    def update_task_attachment(self, attachment_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """更新附件信息（名称 / 链接地址）"""
        att = self.db.get_attachment(attachment_id)
        if not att:
            raise Exception("附件不存在")

        payload = payload or {}
        if att.get('type') == TYPE_LINK and not (payload.get('url') or att.get('url')):
            raise Exception("在线链接不能为空")

        updated = self.db.update_attachment(attachment_id, payload)
        if not updated:
            raise Exception("更新附件失败")
        return updated

    @api_handler
    def delete_task_attachment(self, attachment_id: str) -> None:
        """删除附件（若为实体文件则同时删除本地文件）"""
        att = self.db.get_attachment(attachment_id)
        if not att:
            raise Exception("附件不存在")

        self.db.delete_attachment(attachment_id)
        if att.get('type') == TYPE_FILE:
            get_attachment_service().delete_file(att.get('filePath'))

    @api_handler
    def get_attachment_access_mode(self) -> Dict[str, Any]:
        """获取附件的访问模式

        - local：桌面端且未开启云端同步，附件保存在本地，直接使用系统默认程序打开
        - remote：移动端或已开启云端同步，通过拼接云端地址下载后再由用户自行打开
        """
        sync_enabled = False
        try:
            from backend.features.webdav.webdav_config import is_webdav_enabled
            sync_enabled = bool(is_webdav_enabled())
        except Exception as e:
            self.get_logger.error(f"获取云端同步状态失败: {e}")

        is_mobile = bool(self.is_android)
        mode = 'remote' if (is_mobile or sync_enabled) else 'local'
        return {'mode': mode, 'sync_enabled': sync_enabled, 'is_mobile': is_mobile}

    @api_handler
    def open_attachment(self, attachment_id: str) -> Dict[str, Any]:
        """打开本地附件

        - 在线链接：使用默认浏览器打开
        - 实体文件：使用系统默认程序打开（图片同样交给默认看图工具，不做预览）。
          文件缺失或无法打开时抛出异常，由前端提示用户并打开文件所在目录。
        """
        att = self.db.get_attachment(attachment_id)
        if not att:
            raise Exception("附件不存在")

        if att.get('type') == TYPE_LINK:
            url = att.get('url')
            if not url:
                raise Exception("在线链接为空")
            self._open_external_url(url)
            return {'opened': True, 'kind': 'link', 'url': url}

        local_file = self._locate_local_attachment_file(att)
        if not local_file:
            raise AttachmentError("本地附件文件不存在")
        self._open_local_file(str(local_file))
        return {'opened': True, 'kind': 'file', 'name': att['name']}

    @api_handler
    def reveal_attachment(self, attachment_id: str) -> Dict[str, Any]:
        """在系统文件管理器中定位附件文件（无法直接打开时的兜底）

        文件已被删除时退回到其所在目录；目录也不存在时退回到附件根目录。
        """
        att = self.db.get_attachment(attachment_id)
        if not att:
            raise Exception("附件不存在")
        if att.get('type') != TYPE_FILE:
            raise Exception("仅本地文件支持定位")

        service = get_attachment_service()
        resolved = self._resolve_attachment_path(att)
        # 连文件位置都无法确定时，退回到附件根目录，让用户自行查找
        target = Path(resolved) if resolved else service.attachment_root
        if not target.exists():
            parent = target.parent
            target = parent if parent.exists() else service.attachment_root
        self._reveal_in_file_manager(target)
        return {'revealed': True, 'path': str(target)}

    @api_handler
    def get_attachment_download_url(self, attachment_id: str) -> Dict[str, Any]:
        """获取附件的云端下载地址（移动端 / 已开启同步时使用）"""
        att = self.db.get_attachment(attachment_id)
        if not att:
            raise Exception("附件不存在")

        if att.get('type') == TYPE_LINK:
            return {'type': 'link', 'url': att.get('url')}

        service = get_attachment_service()
        relative = self._attachment_relative_path(att)
        if not relative:
            raise Exception("附件文件信息缺失，无法获取下载地址")

        url = service.build_remote_url(relative)
        if not url:
            raise Exception("未启用云端同步，无法获取下载地址")
        return {'type': 'file', 'url': url, 'name': att.get('name')}

    # ==================== 辅助方法 ====================

    def _locate_local_attachment_file(self, att: Dict[str, Any]) -> Optional[Path]:
        """定位本地附件实体文件（仅本地查找，不触发云端下载）"""
        resolved = self._resolve_attachment_path(att)
        if not resolved:
            return None
        local_file = Path(resolved)
        return local_file if local_file.exists() else None

    def _resolve_attachment_path(self, att: Dict[str, Any]) -> Optional[str]:
        """解析附件实体文件的可用路径（绝对路径）

        1. 数据库已记录 filePath：优先使用（兼容历史数据中直接存储绝对路径的情况）
        2. 记录缺失时按「<uuid>_<name>」命名规则回查并回写数据库
           （兼容字段映射缺陷导致 file_path 为空的历史附件）
        """
        service = get_attachment_service()
        file_path = str(att.get('filePath') or '').strip()
        if file_path:
            candidate = Path(file_path)
            return str(candidate) if candidate.is_absolute() else str(service.resolve_path(file_path))

        matched = self._find_attachment_file_by_name(service, att.get('name'))
        if not matched:
            return None
        self._persist_attachment_path(att, matched, service)
        return str(matched)

    def _attachment_relative_path(self, att: Dict[str, Any]) -> Optional[str]:
        """获取附件相对于附件根目录的存储路径（用于拼接云端地址）"""
        service = get_attachment_service()
        file_path = str(att.get('filePath') or '').strip()
        if file_path and not Path(file_path).is_absolute():
            return service.normalize_relative_path(file_path)

        resolved = self._resolve_attachment_path(att)
        if not resolved:
            return None
        try:
            return service.normalize_relative_path(
                str(Path(resolved).relative_to(service.attachment_root))
            )
        except ValueError:
            return None

    def _find_attachment_file_by_name(self, service: Any, name: Optional[str]) -> Optional[Path]:
        """按「<uuid>_<name>」命名规则在附件目录中回查实体文件

        仅用于历史数据 file_path 缺失时兜底；同名文件存在多个时取最近修改的一个。
        """
        safe_name = str(name or '').strip()
        root = service.attachment_root
        if not safe_name or not root.exists():
            return None

        suffix = f'_{safe_name}'
        matches: List[Path] = []
        try:
            for path in root.rglob('*'):
                if path.is_file() and path.name.endswith(suffix):
                    matches.append(path)
        except OSError as e:
            self.get_logger.error(f"回查附件文件失败: {e}")
            return None

        if not matches:
            return None
        return max(matches, key=lambda p: p.stat().st_mtime)

    def _persist_attachment_path(self, att: Dict[str, Any], target: Path, service: Any) -> None:
        """把回查到的附件路径回写数据库，避免每次打开都重复扫描"""
        try:
            relative = service.normalize_relative_path(
                str(target.relative_to(service.attachment_root))
            )
        except ValueError:
            return
        try:
            self.db.update_attachment(att['id'], {'filePath': relative})
            att['filePath'] = relative
            self.get_logger.info(f"已回写附件路径: {att['id']} -> {relative}")
        except Exception as e:
            self.get_logger.error(f"回写附件路径失败: {att['id']}, 错误: {e}")

    def _open_local_file(self, file_path: str) -> None:
        """使用系统默认程序打开本地文件"""
        if self.is_android:
            raise Exception("移动端请使用云链接下载后查看")

        if os.name == 'nt':
            os.startfile(file_path)  # type: ignore[attr-defined]
        elif sys.platform == 'darwin':
            import subprocess
            subprocess.Popen(['open', file_path])
        else:
            import subprocess
            subprocess.Popen(['xdg-open', file_path])

    def _reveal_in_file_manager(self, target: Path) -> None:
        """在系统文件管理器中显示目标文件或目录"""
        if self.is_android:
            raise Exception("移动端不支持打开文件所在目录")

        import subprocess
        path = str(target)
        is_file = target.is_file()

        if os.name == 'nt':
            # explorer /select,"<file>" 会打开所在目录并选中该文件
            if is_file:
                subprocess.Popen(f'explorer /select,"{path}"')
            else:
                os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', '-R', path] if is_file else ['open', path])
        else:
            subprocess.Popen(['xdg-open', path if not is_file else str(target.parent)])

    def _open_external_url(self, url: str) -> None:
        """使用默认浏览器打开外部链接"""
        import webbrowser
        try:
            webbrowser.open(url)
        except Exception as e:
            raise Exception(f"打开链接失败: {e}")
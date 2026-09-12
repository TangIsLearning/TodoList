# backend/api/mixins/p2p_api_mixin.py
from typing import Any, Dict
from backend.utils.response_wrapper import api_handler

class P2PApiMixin:
    """P2P服务核心操作 Mixin"""

    @staticmethod
    def _build_received_summary(data: Any) -> Any:
        """构建供前端展示的接收数据摘要

        附件实体文件（base64）体积可能很大，不返回给前端，仅返回文件数量；
        导入时由后端缓存的完整数据补全，避免大字符串在 JS 桥接中反复传递。
        """
        if not isinstance(data, dict):
            return data
        summary = {k: v for k, v in data.items() if k != 'attachment_files'}
        summary['attachment_file_count'] = len(data.get('attachment_files') or {})
        return summary

    @api_handler
    def p2p_start_server(self) -> Dict[str, Any]:
        """启动P2P服务器"""
        def data_received_callback(data: Any, address: Any) -> None:
            """数据接收回调"""
            # 存储接收到的数据供前端获取
            self._received_data = data
            self.get_logger.info(f"接收到来自 {address[0]} 的数据")

        def data_request_callback() -> Any:
            """数据请求回调 - 返回要共享的数据"""
            return self._exported_data if self._exported_data else None

        self._p2p_server.set_data_request_callback(data_request_callback)
        success, message = self._p2p_server.start(data_received_callback)

        if not success:
            raise Exception(message or f'服务器启动失败')

        local_ip = self._p2p_server.get_local_ip()
        return {
            'ip': local_ip,
            'port': self._p2p_server.port,
            'message': message or f'服务器已启动，IP: {local_ip}, 端口: {self._p2p_server.port}'
        }

    @api_handler
    def p2p_stop_server(self) -> None:
        """停止P2P服务器"""
        self._p2p_server.stop()
        # 清空缓存的共享数据，避免停止后仍响应旧数据（可能包含较大附件）
        self._exported_data = None

    @api_handler
    def p2p_clear_received_data(self) -> None:
        """清空已接收的缓存数据（取消导入时释放内存）"""
        self._received_data = None

    @api_handler
    def p2p_scan_devices(self) -> Any:
        """扫描局域网内的设备"""
        return self._p2p_client.scan_devices()

    @api_handler
    def p2p_receive_data(self, ip: str) -> Any:
        """从指定设备接收数据"""
        self._received_data = self._p2p_client.receive_data(ip)
        if not self._received_data:
            raise Exception(f'接收数据失败')
        return self._build_received_summary(self._received_data)

    @api_handler
    def p2p_get_received_data(self) -> Any:
        """获取接收到的数据"""
        return self._build_received_summary(self._received_data)

    @api_handler
    def p2p_export_data(self, include_attachments: bool = False) -> Any:
        """导出当前数据

        Args:
            include_attachments: 是否同时打包附件数据（元信息 + 实体文件），
                默认 False，即不传输任何附件数据
        """
        self._exported_data = self._data_manager.export_data(include_attachments=include_attachments)
        if not self._exported_data:
            raise Exception(f'导出数据失败')
        return self._build_received_summary(self._exported_data)

    @api_handler
    def p2p_get_data_summary(self) -> Any:
        """获取当前数据摘要"""
        summary = self._data_manager.get_data_summary()
        if not summary:
            raise Exception(f'获取数据摘要失败')
        return summary

    @api_handler
    def p2p_has_data(self) -> bool:
        """检查是否有数据"""
        return self._data_manager.has_data()

    @api_handler
    def p2p_import_data(self, data: Any) -> None:
        """导入数据"""
        merged = data if isinstance(data, dict) else {}
        cached = self._received_data if isinstance(self._received_data, dict) else {}
        # 前端传入的是摘要（不含附件实体文件），此处补全后端缓存的实体文件
        if 'attachment_files' not in merged and cached.get('attachment_files'):
            merged = {**merged, 'attachment_files': cached['attachment_files']}
        # 在安卓设备上由于可能存在权限问题，因而不做备份操作
        success = self._data_manager.import_data(merged, backup=(not self.is_android))
        if not success:
            raise Exception(f'数据导入失败')
        # 导入成功后刷新前端缓存
        self._received_data = None
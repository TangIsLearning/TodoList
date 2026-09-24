# core/factory.py
import os
import sys
import importlib
from typing import Optional

from backend.platforms.interface.service import PlatformService

# 将平台映射到具体的模块路径（配置化，避免硬编码 if 判断）
PLATFORM_MAPPING = {
    'win32': 'backend.platforms.impl.desktop.win_impl',
    'darwin': 'backend.platforms.impl.desktop.mac_impl',
    'linux': 'backend.platforms.impl.desktop.linux_impl',
    'android': 'backend.platforms.impl.mobile.android_impl',
}

# 平台服务在进程内复用，避免每次调用都重新探测一次环境
_service: Optional[PlatformService] = None


def current_platform() -> str:
    """当前平台标识

    Android 依据 python-for-android 留下的特征判定（hasattr(sys, 'getandroidapilevel')
    与 ANDROID_ARGUMENT），而不是「是不是 Linux 上跑着 Python」——后者会把 Termux
    之类环境也算进来，但那并不是本应用支持的运行形态。
    """
    if hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ:
        return 'android'
    return sys.platform


def get_platform_service() -> PlatformService:
    """获取平台能力实现（快捷键、托盘、自启动、路径等）

    延迟 import 是刻意的：不满足条件的平台模块在运行时不会被触发 import，
    避免在 Windows 上加载 jnius、在 Android 上加载 pynput 这类平台专属依赖。
    """
    global _service
    if _service is None:
        platform_key = current_platform()
        if platform_key not in PLATFORM_MAPPING:
            raise NotImplementedError(f"当前平台 {platform_key} 暂不支持")

        module = importlib.import_module(PLATFORM_MAPPING[platform_key])
        _service = module.ExportService()
    return _service

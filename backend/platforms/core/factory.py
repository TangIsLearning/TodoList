# core/factory.py
import os
import sys
import importlib
from backend.platforms.interface.service import PlatformService

# 将平台映射到具体的模块路径（配置化，避免硬编码 if 判断）
PLATFORM_MAPPING = {
    'win32': 'backend.platforms.impl.desktop.win_impl',
    'darwin': 'backend.platforms.impl.desktop.mac_impl',
    'linux': 'backend.platforms.impl.desktop.linux_impl',
    'android': 'backend.platforms.impl.mobile.android_impl',
}


def get_platform_service() -> PlatformService:
    is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ

    if is_android:
        current_platform = 'android'
    else:
        current_platform = sys.platform

    if current_platform not in PLATFORM_MAPPING:
        raise NotImplementedError(f"当前平台 {current_platform} 暂不支持")

    # 动态加载对应的模块，不满足条件的模块在运行时完全不会被触发 import
    module_path = PLATFORM_MAPPING[current_platform]
    module = importlib.import_module(module_path)

    # 实例化具体平台实现类并返回
    return module.ExportService()

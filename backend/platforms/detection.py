"""运行环境探测。

把「当前是不是某种环境」这类判断收拢到一处，避免同一件事在多个模块里各有一套说法
（例如 Android 判定原本散落在配置管理器和平台工厂里，且判据并不相同）。
本模块零业务依赖，任何模块都可以安全引用。
"""

import os
import platform


def is_android() -> bool:
    """是否运行在 Android 环境（含 Termux）。

    多种信号并行判断，是因为 Android 上 Python 的宿主形态很杂：随 APK 打包的解释器、
    Termux、以及各类嵌入式 Python，各自留下的痕迹不同，没有哪个单一指标可靠。
    """
    try:
        # 方法1: 检查platform信息
        if platform.system() == 'Linux':
            # 方法2: 检查Android特有的环境变量
            if os.environ.get('ANDROID_ROOT') or os.environ.get('ANDROID_DATA'):
                return True

            # 方法3: 检查Android特有的系统文件
            android_files = [
                '/system/build.prop',
                '/system/framework/framework-res.apk',
                '/proc/version'
            ]

            for file_path in android_files:
                if file_path == '/proc/version':
                    # 特殊处理/proc/version
                    try:
                        with open(file_path, 'r') as f:
                            content = f.read().lower()
                            if 'android' in content:
                                return True
                    except Exception:
                        continue
                else:
                    if os.path.exists(file_path):
                        return True

        # 方法4: 检查是否在Termux环境中
        if 'com.termux' in os.environ.get('PREFIX', '') or \
           'termux' in os.environ.get('PATH', '').lower():
            return True

        return False
    except Exception:
        return False

# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

# 获取项目根目录 (兼容 PyInstaller 编译时环境)
try:
    project_root = Path(SPECPATH).parent
except NameError:
    project_root = Path('.').resolve()

frontend_dir = project_root / 'frontend'
data_dir = project_root / 'data'

# 收集前端文件
frontend_files = [
    ('frontend/index.html', 'frontend'),
    ('frontend/css', 'frontend/css'),
    ('frontend/js', 'frontend/js'),
    ('frontend/config', 'frontend/config'),
    ('frontend/asset', 'frontend/asset'),
]

# 收集数据文件
data_files = []
if data_dir.exists():
    for item in data_dir.rglob('*'):
        if item.is_file():
            # 保持 data 内部目录结构
            rel_path = item.relative_to(project_root).parent
            data_files.append((str(item), str(rel_path)))

# 收集 desktop_notifier 的资源文件
# desktop_notifier/common.py 在【导入时】就会执行：
#   importlib.resources.files("desktop_notifier.resources") / "python.png"
# 该路径在打包后必须真实存在，否则抛 FileNotFoundError，因此需一并收集数据文件
try:
    from PyInstaller.utils.hooks import collect_data_files
    notifier_data_files = collect_data_files('desktop_notifier')
except Exception:
    notifier_data_files = []

# ================= 平台相关配置 =================
# hiddenimports 只保留【PyInstaller 静态分析无法发现】的模块：
#   1. 通过 importlib.import_module(字符串变量) 在运行时动态加载的平台实现
#      ——见 backend/platforms/core/factory.py 的 PLATFORM_MAPPING
#   2. 第三方库按平台动态选择、且历史上打包易漏的后端（保险项，代价极低）
#
# 说明：所有以字面量 import 出现的 backend.* 模块（含函数内的延迟 import，
# 如 backend.start 中 `from backend.api.todo_api import TodoApi`）都会被
# PyInstaller 的模块图从 main.py -> backend.start 的引用链自动推导，
# 无需再写进 hiddenimports。
if sys.platform == 'darwin':
    # macOS 平台
    extra_hiddenimports = [
        'webview.platforms.cocoa',
        'backend.platforms.impl.desktop.mac_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.win_impl',
        'backend.platforms.impl.desktop.win_firewall_manager',
        'backend.platforms.impl.desktop.linux_impl',
        'backend.platforms.impl.mobile.android_impl',
        'backend.platforms.impl.mobile.common.calendar_manager',
    ]
    icon_file = 'todo_icon.icns' if Path('todo_icon.icns').exists() else None
elif sys.platform == 'win32':
    # Windows 平台
    extra_hiddenimports = [
        'backend.platforms.impl.desktop.win_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.mac_impl',
        'backend.platforms.impl.desktop.linux_impl',
        'backend.platforms.impl.mobile.android_impl',
        'backend.platforms.impl.mobile.common.calendar_manager',
    ]
    icon_file = 'todo_icon.ico' if Path('todo_icon.ico').exists() else None
else:  # Linux
    extra_hiddenimports = [
        'backend.platforms.impl.desktop.linux_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.mac_impl',
        'backend.platforms.impl.desktop.win_impl',
        'backend.platforms.impl.desktop.win_firewall_manager',
        'backend.platforms.impl.mobile.android_impl',
        'backend.platforms.impl.mobile.common.calendar_manager',
    ]
    icon_file = 'todo_icon.png' if Path('todo_icon.png').exists() else None

# 这里只放：静态分析完全看不到、但运行时一定会被加载的模块
base_hiddenimports = [
    'webview',
    'pystray',
    # desktop_notifier/common.py 在导入时执行
    # importlib.resources.files("desktop_notifier.resources")，
    # 模块名以字符串形式出现，静态分析不可见
    'desktop_notifier.resources',
]

base_exclude_modules = [
    'matplotlib',
    'numpy',
    'scipy',
    'pandas',
    'cv2',
    'PyQt6',
    'PyQt5',
    'PySide2',
    'PySide6',
]

# 🌟 核心：将公共依赖与当前平台的特有依赖合并；将公共移除的模块与当前平台特定移除的模块合并
final_hiddenimports = base_hiddenimports + extra_hiddenimports
final_exclude_modules = base_exclude_modules + extra_exclude_modules

# 自动处理图标元组（用于 datas）
current_icon_tuple = []
if icon_file and Path(icon_file).exists():
    current_icon_tuple = [(icon_file, '.')]

# ================= 核心 Analysis =================
block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[str(project_root)],
    binaries=[],
    datas=frontend_files + data_files + current_icon_tuple + notifier_data_files,
    hiddenimports=final_hiddenimports,  # 🌟 确保这里传入的是合并后的完整列表，且名字没有写错！
    excludes=final_exclude_modules,           # 🌟 确保这里精准排除了非本平台的模块
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ================= 平台打包输出 =================
if sys.platform == 'darwin':
    # ================= macOS 专属优化：BUNDLE 模式 =================
    exe = EXE(
        pyz,
        a.scripts,
        exclude_binaries=True,         # 🔥 关键：不把二进制和数据塞进单文件中
        name='TodoList',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=False,                      # 🔥 macOS 下关闭 UPX，UPX 会严重拖慢启动速度并导致崩溃
        console=False,
        disable_windowed_traceback=False,
        argv_emulation=False,           # 🔥 pywebview 应用开启此项偶尔会导致诡异的启动白屏，建议关闭
        target_arch=None,
        icon=icon_file,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=False,
        upx=False,
        name='TodoList'
    )

    app = BUNDLE(
        coll,                           # 🔥 将整个 COLLECT 文件夹打包进 .app，实现零解压、秒开
        name='TodoList.app',
        icon=icon_file,
        bundle_identifier='com.pywebview.todos.todolist',
        strip=True,               # 🔥 剥离调试符号，减小 .app 体积
        info_plist={
            'CFBundleName': 'TodoList',
            'CFBundleDisplayName': 'TodoList',
            'CFBundleShortVersionString': '1.0.0',
            'CFBundleVersion': '1',
            'NSHighResolutionCapable': True,
            'LSUIElement': False,
            # 🔥 允许网页使用 JIT 编译（防止 pywebview 的 JavaScript 运行卡顿/白屏）
            'com.apple.security.cs.allow-jit': True,
        }
    )

elif sys.platform == 'win32':
    # ================= Windows：经典单文件模式 =================
    exe = EXE(
        pyz,
        a.scripts,
        a.binaries,
        a.zipfiles,
        a.datas,
        [],
        name='TodoList',
        debug=False,
        bootloader_ignore_signals=False,
        strip=False,
        upx=True,                      # Windows 允许 UPX 压缩
        console=False,
        disable_windowed_traceback=False,
        icon=icon_file,
        version='version_info.txt' if Path('version_info.txt').exists() else None
    )

else:
    # ================= Linux 专属优化：目录模式 (为 AppImage 完美铺路) =================
    exe = EXE(
        pyz,
        a.scripts,
        exclude_binaries=True,         # 🔥 关键：不打进单个二进制，依靠后续 AppImage 机制实现单文件
        name='TodoList',
        debug=False,
        bootloader_ignore_signals=False,
        strip=True,                    # 剔除符号表，深度优化体积
        upx=False,                     # 🔥 关键：Linux 下 pywebview 用 upx 极易导致核心 WebKit 库崩溃闪退
        console=False,
        disable_windowed_traceback=False,
        icon=icon_file,
    )

    coll = COLLECT(
        exe,
        a.binaries,
        a.zipfiles,
        a.datas,
        strip=True,
        upx=False,
        name='TodoList'                # 生成解离的 dist/TodoList 目录供 AppImage 抓取
    )

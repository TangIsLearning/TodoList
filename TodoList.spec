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

# ================= 平台相关配置 =================
# 1. 平台特定隐藏导入（保留你原有的第三方库）
# 2. 策略模块隐藏导入（确保动态导入的模块被打包）
# 3. 需要排除的其他平台策略模块（实现物理隔离）
if sys.platform == 'darwin':
    # macOS 平台
    extra_hiddenimports = [
        'desktop_notifier.platforms.darwin',
        'webview.platforms.cocoa',
        'backend.platforms.impl.desktop.mac_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.win_impl',
        'backend.platforms.impl.desktop.linux_impl',
    ]
    icon_file = 'todo_icon.icns' if Path('todo_icon.icns').exists() else None
elif sys.platform == 'win32':
    # Windows 平台
    extra_hiddenimports = [
        'desktop_notifier.platforms.windows',
        'winsdk.windows.ui.notifications',
        'winsdk.windows.foundation',
        'backend.platforms.impl.desktop.win_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.mac_impl',
        'backend.platforms.impl.desktop.linux_impl',
    ]
    icon_file = 'todo_icon.ico' if Path('todo_icon.ico').exists() else None
else:  # Linux
    extra_hiddenimports = [
        'desktop_notifier.platforms.linux',
        'backend.platforms.impl.desktop.linux_impl',
    ]
    extra_exclude_modules = [
        'backend.platforms.impl.desktop.mac_impl',
        'backend.platforms.impl.desktop.win_impl',
    ]
    icon_file = 'todo_icon.png' if Path('todo_icon.png').exists() else None

# 这里只放完全跨平台的、公共的、且因为动态加载可能漏掉的模块
base_hiddenimports = [
    'webview',
    'Pillow',
    'pystray',
    'desktop_notifier.resources',
    'desktop_notifier.main',
    'backend.database.operations',
    'backend.database.data_sync',
    'backend.database.models',
    'backend.api.todo_api',
    'backend.utils.logger',
    'backend.utils.utils',
    'backend.platforms.impl.desktop.common.smart_task',
    'backend.platforms.impl.desktop.common.system_tray',
    'backend.platforms.impl.desktop.common.task_reminder',
    'backend.reminder.impl.mobile.common.calendar_manager',
    'backend.p2p.data_manager',
    'backend.p2p.p2p_client',
    'backend.p2p.p2p_server',
    'backend.platforms.core_factory',
    'backend.platforms.interface.service',
    'backend.webdav.webdav_client',
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
    datas=frontend_files + data_files + current_icon_tuple,
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

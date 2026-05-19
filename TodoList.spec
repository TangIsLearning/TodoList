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

# 平台相关隐藏导入
extra_hiddenimports = []
if sys.platform == 'darwin':
    extra_hiddenimports.append('desktop_notifier.platforms.darwin')
elif sys.platform == 'win32':
    extra_hiddenimports.extend([
        'desktop_notifier.platforms.windows',
        'winsdk.windows.ui.notifications',
        'winsdk.windows.foundation'
    ])

# 平台相关图标文件
if sys.platform == 'darwin':
    icon_file = 'todo_icon.icns' if Path('todo_icon.icns').exists() else None
else:
    icon_file = 'todo_icon.ico' if Path('todo_icon.ico').exists() else None

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[str(project_root), str(project_root / 'backend')],
    binaries=[],
    datas=frontend_files + data_files + ([('todo_icon.ico', '.')] if sys.platform != 'darwin' else []),
    hiddenimports=[
        'webview', 'webview.platforms', 'webview.platforms.cocoa', # 显式补充 macOS 原生渲染器
        'Pillow', 'pystray', 'sqlite3', 'json', 'threading', 'datetime',
        'http.server', 'socketserver', 'urllib.parse', 'pathlib', 'os', 'sys',
        'shutil', 'subprocess', 're', 'uuid', 'hashlib', 'base64', 'html',
        'webbrowser', 'tkinter', 'desktop_notifier.resources', 'desktop_notifier.main',
        'tkinter.messagebox', 'tkinter.filedialog', 'tkinter.simpledialog',
        'database.operations', 'database.models', 'api.todo_api', 'utils.logger', 'utils.task_reminder'
    ] + extra_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'cv2', 'PyQt6', 'PyQt5', 'PySide2', 'PySide6'], # 排除所有冗余 UI 库
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

if sys.platform == 'darwin':
    # ================= macOS 专属优化：目录模式 (秒开) =================
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
        bundle_identifier='com.yourcompany.todolist',
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

else:
    # ================= Windows / Linux：单文件模式 =================
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
        upx=True,
        console=False,
        disable_windowed_traceback=False,
        icon=icon_file,
        version='version_info.txt' if Path('version_info.txt').exists() else None
    )

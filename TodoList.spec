# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

# 获取项目根目录
project_root = Path(SPECPATH).parent
frontend_dir = project_root / 'frontend'
data_dir = project_root / 'data'

# 收集前端文件
frontend_files = [
 ('frontend/index.html', 'frontend/'),
 ('frontend/css/*', 'frontend/css'),
 ('frontend/js/*', 'frontend/js'),
 ('frontend/config/*', 'frontend/config'),
 ('frontend/asset/*', 'frontend/asset'),
# ('backend/*', 'backend/*')
]

# 收集数据文件
data_files = []
if data_dir.exists():
    for item in data_dir.rglob('*'):
        if item.is_file():
            relative_path = item.relative_to(data_dir)
            data_files.append((str(item), 'data'))

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[str(project_root), str(project_root / 'backend'), str(project_root / 'TodoList' / 'backend')],
    binaries=[],
    datas=frontend_files + data_files,
    hiddenimports=[
        'webview',
        'webview.platforms',
        'webview.platforms.cef',
        'webview.platforms.edgechromium',
        'webview.platforms.mshtml',
        'webview.platforms.gtk',
        'webview.platforms.cocoa',
        'webview.platforms.qt',
        'sqlite3',
        'json',
        'threading',
        'datetime',
        'http.server',
        'socketserver',
        'urllib.parse',
        'pathlib',
        'os',
        'sys',
        'shutil',
        'subprocess',
        're',
        'uuid',
        'hashlib',
        'base64',
        'html',
        'webbrowser',
        'tkinter',
        'desktop_notifier.resources',
        'desktop_notifier.main',
        'desktop_notifier.platforms.windows', # 如果是Windows
        'winsdk.windows.ui.notifications', #(针对 Windows)
        'winsdk.windows.foundation',
        'tkinter.messagebox',
        'tkinter.filedialog',
        'tkinter.simpledialog',
        # 后端模块
        'database.operations',
        'database.models',
        'api.todo_api',
        'utils.logger',
        'utils.task_reminder'
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'numpy',
        'scipy',
        'pandas',
        'PIL',
        'cv2',
        'PyQt6'
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

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
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # 关闭控制台日志输出
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='todo_icon.ico' if Path('todo_icon.ico').exists() else None,
    version='version_info.txt' if Path('version_info.txt').exists() else None
)
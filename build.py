#!/usr/bin/env python3
"""
TodoList应用打包脚本
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

def create_icon():
    """创建应用图标"""
    print("🎨 创建应用图标...")
    
    try:
        # 尝试运行图标创建脚本
        result = subprocess.run([sys.executable, Path(os.path.dirname(__file__), "scripts", "utils", 'create_icon.py')],
                                capture_output=True, text=True, encoding='utf-8')
        if result.returncode == 0:
            print("   ✅ 图标创建成功")
            return True
        else:
            print("   ⚠️  图标创建失败，使用默认图标")
            return False
    except Exception as e:
        print(f"   ⚠️  图标创建过程出错: {e}")
        return False

def clean_build():
    """清理之前的构建文件"""
    print("🧹 清理构建文件...")
    
    dirs_to_clean = ['build', 'dist', '__pycache__']
    for dir_name in dirs_to_clean:
        dir_path = Path(dir_name)
        if dir_path.exists():
            shutil.rmtree(dir_path)
            print(f"   删除: {dir_name}")
    
    # 清理所有__pycache__
    for cache_dir in Path('.').rglob('__pycache__'):
        shutil.rmtree(cache_dir)
        print(f"   删除: {cache_dir}")
    
    # 清理.pyc文件
    for pyc_file in Path('.').rglob('*.pyc'):
        pyc_file.unlink()
        print(f"   删除: {pyc_file}")

def check_dependencies():
    """检查依赖是否安装"""
    print("📦 检查依赖...")
    
    required_packages = {
        'pyinstaller': 'PyInstaller',
        'pywebview': 'webview',
        'desktop-notifier': 'desktop_notifier'
    }
    
    missing_packages = []
    
    for package_name, import_name in required_packages.items():
        try:
            __import__(import_name)
            print(f"   ✅ {package_name}")
        except ImportError:
            missing_packages.append(package_name)
            print(f"   ❌ {package_name}")
    
    if missing_packages:
        print(f"\n❌ 缺少依赖: {', '.join(missing_packages)}")
        print("请运行: pip install pyinstaller pywebview")
        return False
    
    return True

def build_process():
    """构建exe/app文件"""
    print("🔨 开始构建...")
    
    try:
        # 检查是否有图标文件
        if Path('todo_icon.ico').exists():
            print("   使用自定义图标")
        else:
            print("   使用默认图标")
        
        # 使用PyInstaller构建（不传递icon参数，因为使用spec文件）
        cmd = [
            'pyinstaller',
            '--clean',
            '--noconfirm',
            'TodoList.spec'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ 构建成功!")
        else:
            print("❌ 构建失败!")
            print("错误输出:")
            print(result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ 构建过程中出错: {e}")
        return False
    
    return True

def copy_additional_files():
    """复制额外的文件到dist目录"""
    print("📋 复制额外文件...")
    
    dist_dir = Path('dist')
    
    # 复制README
    readme_src = Path('README.md')
    if readme_src.exists():
        shutil.copy2(readme_src, dist_dir)
        print(f"   复制: README.md")

    # 创建启动脚本
    if sys.platform == 'win32':
        start_script = dist_dir / 'start.bat'
        with open(start_script, 'w', encoding='utf-8') as f:
            f.write('''@echo off
echo 启动TodoList应用...
TodoList.exe
pause
''')
        print(f"   创建: start.bat")
    elif sys.platform == 'darwin':
        # 可选：创建 .command 启动脚本（双击即可在终端运行）
        start_script = dist_dir / 'start.command'
        with open(start_script, 'w', encoding='utf-8') as f:
            f.write('''#!/bin/bash
cd "$(dirname "$0")"
open TodoList.app
''')
        # 添加执行权限
        start_script.chmod(0o755)
        print(f"   创建: start.command")

def create_dmg():
    """将 macOS 的 .app 打包为 .dmg 映像档并输出到 dist 目录"""
    print("🍏 开始制作 macOS DMG 安装包...")

    app_path = Path('dist/TodoList.app')
    # 修改此处：将输出路径指定到 dist 目录下
    dmg_output = Path('dist/TodoList_Setup.dmg')
    tmp_dmg_dir = Path('build/dmg_root')

    if not app_path.exists():
        print("   ❌ 未找到 TodoList.app，无法制作 DMG")
        return False

    try:
        # 1. 清理并创建临时的 DMG 根目录结构
        if tmp_dmg_dir.exists():
            shutil.rmtree(tmp_dmg_dir)
        tmp_dmg_dir.mkdir(parents=True, exist_ok=True)

        # 2. 复制 .app 到临时目录（使用 cp -R 保留 macOS 软链接与权限）
        print("   -> 复制应用程序...")
        subprocess.run(['cp', '-R', str(app_path), str(tmp_dmg_dir)], check=True)

        # 3. 创建指向系统的 /Applications 快捷方式链接（实现拖拽安装效果）
        print("   -> 创建 Applications 快捷方式...")
        os.symlink('/Applications', tmp_dmg_dir / 'Applications')

        # 4. 如果有 README，也一同放入 DMG
        readme_src = Path('README.md')
        if readme_src.exists():
            shutil.copy2(readme_src, tmp_dmg_dir)

        # 5. 如果旧的 DMG 存在则先删除
        if dmg_output.exists():
            dmg_output.unlink()

        # 6. 使用 hdiutil 工具生成 DMG
        print("   -> 正在使用 hdiutil 生成 DMG 映像...")
        cmd = [
            'hdiutil', 'create',
            '-volname', 'TodoList 安装程序',
            '-srcfolder', str(tmp_dmg_dir),
            '-ov',
            '-format', 'UDZO',  # 采用压缩格式
            str(dmg_output)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ DMG 安装包创建成功: {dmg_output}")
            return True
        else:
            print("   ❌ hdiutil 执行失败:")
            print(result.stderr)
            return False
    except Exception as e:
        print(f"⚠️ 制作 DMG 时出错: {e}")
        return False

def create_appimage():
    print("🐧 创建 AppImage 包...")
    appdir = Path('build/AppDir')
    if appdir.exists():
        shutil.rmtree(appdir)
    appdir.mkdir(parents=True)

    # 创建标准目录结构
    (appdir / 'usr/bin').mkdir(parents=True)

    # 复制可执行文件：兼容 PyInstaller 目录/单文件模式拷贝
    dist_src = Path('dist/TodoList')
    if dist_src.is_dir():
        # 如果是 COLLECT 生成的文件夹，将其内容全量搬运
        for item in dist_src.iterdir():
            if item.is_dir():
                shutil.copytree(item, appdir / 'usr/bin' / item.name)
            else:
                shutil.copy2(item, appdir / 'usr/bin')
    else:
        # 如果是单文件模式，走原有的单文件拷贝
        shutil.copy2(dist_src, appdir / 'usr/bin/TodoList')

    # 【修改点 1】严格确保 Name 字段、Icon 字段与文件名在大小写上完美统一
    desktop_content = """[Desktop Entry]
Name=TodoList
Comment=A simple todo list app
Exec=TodoList
Icon=todolist
Terminal=false
Type=Application
Categories=Utility;
StartupWMClass=TodoList
"""

    # 写入小写的桌面文件
    (appdir / 'todolist.desktop').write_text(desktop_content)

    (appdir / 'usr/share/applications').mkdir(parents=True, exist_ok=True)
    (appdir / 'usr/share/applications/todolist.desktop').write_text(desktop_content)

    # 处理图标
    icon_src = Path('todo_icon.png')
    if not icon_src.exists():
        print(" ⚠️ 未找到 todo_icon.png，请先运行 create_icon.py 生成")
        return False

    # 复制到标准图标目录
    icons_dir = appdir / 'usr/share/icons/hicolor/256x256/apps'
    icons_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(icon_src, icons_dir / 'todolist.png')

    # 复制到根目录，保持全小写
    root_icon = appdir / 'todolist.png'
    shutil.copy(icon_src, root_icon)
    print(f" ✅ 图标已复制到标准目录: {icons_dir}/todolist.png")

    # 【修改点 2】在根目录下显式创建符合 AppImage 规范的 .DirIcon 软链接
    dir_icon = appdir / '.DirIcon'
    if dir_icon.exists():
        dir_icon.unlink()
    # 创建软链接指向根目录下的图标文件
    os.symlink('todolist.png', dir_icon)
    print(" ✅ 已成功创建 .DirIcon 规范软链接")

    # 创建 AppRun 脚本 (保持你原有的逻辑不变)
    apprun_content = """#!/bin/bash
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export PATH="$HERE/usr/bin:$PATH"
export LD_LIBRARY_PATH="$HERE/usr/lib:$LD_LIBRARY_PATH"
export WEBKIT_DISABLE_DMABUF_RENDERER=1 # 针对 Ubuntu 24.04 虚拟机的最稳健软渲染管线
export GDK_BACKEND=x11
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_GPU_PROCESS=1
export NO_AT_BRIDGE=1

exec $HERE/usr/bin/TodoList "$@"
"""
    (appdir / 'AppRun').write_text(apprun_content)
    (appdir / 'AppRun').chmod(0o755)

    # 使用 appimagetool 生成 AppImage
    appimagetool = shutil.which('appimagetool')
    if not appimagetool:
        print("   ⚠️ 未找到 appimagetool，跳过 AppImage 生成")
        return False

    # 指定 runtime 文件（如果存在）
    runtime_file = Path('/home/ubuntu24/TodoList/runtime-x86_64')
    cmd = [appimagetool, str(appdir), 'dist/TodoList-x86_64.AppImage']
    if runtime_file.exists():
        cmd.insert(1, '--runtime-file')
        cmd.insert(2, str(runtime_file))
        print(f"   ✅ 使用 runtime 文件: {runtime_file}")

    output = Path('dist/TodoList-x86_64.AppImage')
    if output.exists():
        output.unlink()

    try:
        subprocess.run(cmd, check=True, env={**os.environ, 'ARCH': 'x86_64'})
        print(f"   ✅ AppImage 已生成: {output}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"   ❌ AppImage 生成失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 50)
    print("🚀 TodoList应用打包工具")
    print("=" * 50)
    
    # 检查当前目录
    if not Path('main.py').exists():
        print("❌ 请在项目根目录运行此脚本")
        sys.exit(1)
    
    # 检查依赖
    if not check_dependencies():
        sys.exit(1)
    
    # 创建图标
    create_icon()
    
    # 清理构建文件
    clean_build()

    # 构建exe/app
    if not build_process():
        sys.exit(1)
    
    # 复制额外文件
    copy_additional_files()

    # 根据操作系统生成最终安装包
    if sys.platform == 'darwin':
        create_dmg()
    elif sys.platform.startswith('linux'):
        if create_appimage():
            # 【针对 Ubuntu 24.04 GNOME 的自动化集成】
            print("💡 正在为当前系统注册桌面图标...")
            try:
                home_dir = Path.home()
                apps_dir = home_dir / '.local/share/applications'
                apps_dir.mkdir(parents=True, exist_ok=True)

                # 1. 动态生成指向最终生成的 AppImage 绝对路径的桌面文件
                appimage_path = Path('dist/TodoList-x86_64.AppImage').resolve()

                # 图标可以复制到用户本地图标目录，让 GNOME 能够全局识别
                user_icons_dir = home_dir / '.local/share/icons/hicolor/256x256/apps'
                user_icons_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy('todo_icon.png', user_icons_dir / 'todolist.png')

                integrated_desktop = f"""[Desktop Entry]
        Name=TodoList
        Comment=A simple todo list app
        Exec={appimage_path}
        Icon=todolist
        Terminal=false
        Type=Application
        Categories=Utility;
        StartupWMClass=TodoList
        """
                # 2. 写入到当前用户的应用程序目录中
                (apps_dir / 'todolist.desktop').write_text(integrated_desktop, encoding='utf-8')
                print(" ✅ 已成功将 TodoList 添加到系统的“应用程序”菜单中！")
                print(" 📝 现在你可以直接在 Ubuntu 的应用中心搜索 'TodoList' 并看到图标了。")

                # 3. 刷新 GNOME 桌面数据库缓存
                subprocess.run(['update-desktop-database', str(apps_dir)], capture_output=True)
            except Exception as e:
                print(f" ⚠️ 自动注册系统图标失败（不影响AppImage生成）: {e}")

    print("\n" + "=" * 50)
    print("✅ 打包完成!")
    print("=" * 50)
    if sys.platform == 'darwin':
        print("🍎 macOS 应用已生成：dist/TodoList.app")
        print("📦 DMG 安装包位置：dist/TodoList_Setup.dmg")
        print("\n🎉 TodoList应用已成功打包为 DMG 程序!")
        print("📝 使用说明:")
        print("   1. 双击打开 TodoList_Setup.dmg")
        print("   2. 将 TodoList 图标拖拽至 Applications 文件夹即可完成安装")
    elif sys.platform == 'win32':
        print(f"📁 可执行文件位置: dist/TodoList.exe")
        print("\n🎉 TodoList应用已成功打包为exe程序!")
        print("📝 使用说明:")
        print("   1. 将dist文件夹复制到目标电脑")
        print("   2. 双击TodoList.exe运行应用")
    else:
        print("🐧 Linux 可执行文件位置: dist/TodoList")
        print("\n🎉 TodoList 应用已成功打包为AppImage程序!")
        print("📝 使用说明:")
        print("     1. 应用分发：将 TodoList-x86_64.AppImage 发送给用户")
        print("     2. 本地使用：进入 dist 目录, 运行 ./TodoList（确保已具有可执行权限）")
        print("\n💡 提示：如果提示权限不足，请执行 chmod +x TodoList")

if __name__ == '__main__':
    main()
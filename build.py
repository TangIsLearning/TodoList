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
    else:
        print(f"📁 可执行文件位置: dist/TodoList.exe")
        print("\n🎉 TodoList应用已成功打包为exe程序!")
        print("📝 使用说明:")
        print("   1. 将dist文件夹复制到目标电脑")
        print("   2. 双击TodoList.exe运行应用")

if __name__ == '__main__':
    main()
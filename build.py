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

def build_exe():
    """构建exe文件"""
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
    start_script = dist_dir / 'start.bat'
    with open(start_script, 'w', encoding='utf-8') as f:
        f.write('''@echo off
echo 启动TodoList应用...
TodoList.exe
pause
''')
    print(f"   创建: start.bat")

def create_installer():
    """创建简单的安装包"""
    print("📦 创建安装包...")
    
    dist_dir = Path('dist')
    installer_name = 'TodoList_Setup.zip'
    
    try:
        import zipfile
        
        with zipfile.ZipFile(installer_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in dist_dir.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(dist_dir.parent)
                    zipf.write(file_path, arcname)
        
        print(f"✅ 安装包创建成功: {installer_name}")
        
    except ImportError:
        print("⚠️  无法创建zip安装包，需要zipfile支持")
    except Exception as e:
        print(f"⚠️  创建安装包时出错: {e}")

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
    
    # 构建exe
    if not build_exe():
        sys.exit(1)
    
    # 复制额外文件
    copy_additional_files()
    
    # 创建安装包
    create_installer()
    
    print("\n" + "=" * 50)
    print("✅ 打包完成!")
    print("=" * 50)
    print(f"📁 可执行文件位置: dist/TodoList.exe")
    print(f"📦 安装包位置: TodoList_Setup.zip")
    print("\n🎉 TodoList应用已成功打包为exe程序!")
    print("📝 使用说明:")
    print("   1. 将dist文件夹复制到目标电脑")
    print("   2. 双击TodoList.exe运行应用")
    print("   3. 或解压TodoList_Setup.zip后运行TodoList.exe")

if __name__ == '__main__':
    main()
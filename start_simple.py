#!/usr/bin/env python3
"""
TodoList桌面应用简单启动脚本
解决导入路径问题的启动方式
"""

import sys
import os
from pathlib import Path

def main():
    print("🚀 启动TodoList应用...")
    
    # 获取当前脚本目录
    script_dir = Path(__file__).parent
    backend_dir = script_dir / 'backend'
    
    print(f"项目目录: {script_dir}")
    print(f"后端目录: {backend_dir}")
    
    # 验证文件存在
    main_py = backend_dir / 'main.py'
    if not main_py.exists():
        print(f"❌ 错误: 找不到 {main_py}")
        return False
    
    # 添加到Python路径
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))
        print(f"✅ 已添加后端目录到Python路径")
    
    # 临时切换工作目录
    original_cwd = os.getcwd()
    os.chdir(str(backend_dir))
    
    try:
        # 直接运行main.py的内容，避免导入问题
        print("📖 正在导入应用模块...")
        
        # 检查依赖
        try:
            import webview
            print("✅ PyWebView 已安装")
        except ImportError:
            print("❌ 错误: PyWebView 未安装")
            print("请运行: pip install pywebview")
            return False
        
        # 导入数据库模块
        try:
            from database.operations import TodoDatabase
            print("✅ 数据库模块导入成功")
        except Exception as e:
            print(f"❌ 数据库模块导入失败: {e}")
            return False
        
        # 导入API模块
        try:
            from api.todo_api import TodoApi
            print("✅ API模块导入成功")
        except Exception as e:
            print(f"❌ API模块导入失败: {e}")
            return False
        
        # 创建并启动应用
        print("🎯 创建应用实例...")
        api = TodoApi()
        
        # 获取前端文件路径
        frontend_path = script_dir / 'frontend' / 'index.html'
        if not frontend_path.exists():
            print(f"❌ 错误: 找不到前端文件 {frontend_path}")
            return False
        
        print(f"✅ 前端文件: {frontend_path}")
        
        # 创建窗口
        print("🖥️  创建应用窗口...")
        window = webview.create_window(
            'Todo List App',
            str(frontend_path),
            js_api=api,
            width=1000,
            height=700,
            resizable=True,
            text_select=True
        )
        
        print("🎉 启动成功！")
        print("📍 提示: 如果应用无响应，请检查是否有其他PyWebView进程在运行")
        
        # 启动应用
        webview.start(debug=True)
        return True
        
    except Exception as e:
        print(f"❌ 启动失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        # 恢复工作目录
        os.chdir(original_cwd)

if __name__ == '__main__':
    try:
        success = main()
        if not success:
            input("按回车键退出...")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 应用已取消启动")
    except Exception as e:
        print(f"\n💥 发生未预期的错误: {e}")
        input("按回车键退出...")
        sys.exit(1)
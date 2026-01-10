@echo off
chcp 65001 > nul
echo =====================================
echo 🚀 TodoList应用一键打包工具
echo =====================================
echo.

echo 📋 检查Python环境...
python --version > nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到Python，请先安装Python
    pause
    exit /b 1
)

echo ✅ Python环境正常

echo.
echo 📦 安装打包依赖...
pip install pyinstaller pywebview

if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

echo ✅ 依赖安装完成

echo.
echo 🔨 开始打包应用...
python build.py

echo.
echo 🎉 打包流程完成!
pause
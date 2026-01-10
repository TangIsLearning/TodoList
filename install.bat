@echo off
chcp 65001 >nul

REM TodoList桌面应用Windows安装脚本

echo 🚀 开始安装TodoList桌面应用...

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到Python，请先安装Python 3.8或更高版本
    pause
    exit /b 1
)

echo ✅ 找到Python
python --version

REM 检查pip
pip --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未找到pip，请先安装pip
    pause
    exit /b 1
)

REM 创建虚拟环境（推荐）
echo 📦 创建虚拟环境...
if not exist "venv" (
    python -m venv venv
    echo ✅ 虚拟环境创建成功
) else (
    echo ℹ️  虚拟环境已存在，跳过创建
)

REM 激活虚拟环境
echo 🔧 激活虚拟环境...
call venv\Scripts\activate.bat

REM 升级pip
echo ⬆️  升级pip...
python -m pip install --upgrade pip

REM 安装依赖
echo 📚 安装依赖包...
pip install -r requirements.txt

if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
) else (
    echo ✅ 依赖安装成功
)

REM 创建启动脚本
echo 📝 创建启动脚本...
(
echo @echo off
echo chcp 65001 ^>nul
echo REM TodoList启动脚本
echo.
echo REM 激活虚拟环境
echo call venv\Scripts\activate.bat
echo.
echo REM 启动应用
echo python run.py
) > start.bat

REM 测试运行（可选）
echo.
echo 🧪 是否要运行测试？^(y/n^)
set /p run_test=
if "%run_test%"=="y" (
    if "%run_test%"=="Y" (
        echo 🧪 运行后端测试...
        python tests\test_backend.py
    )
)

echo.
echo 🎉 安装完成！
echo.
echo 📖 使用说明:
echo    1. 双击 start.bat 启动应用
echo    2. 或者在命令行中运行: python run.py
echo    3. 在虚拟环境中运行: venv\Scripts\activate && python run.py
echo.
echo 🌐 其他:
echo    - 前端测试: 打开 tests\test_frontend.html
echo    - 后端测试: python tests\test_backend.py
echo    - 项目文档: 查看 README.md
echo.

pause
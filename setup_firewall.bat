@echo off
chcp 65001 >nul
echo ============================================================
echo TodoList P2P 防火墙配置工具
echo ============================================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [✓] 检测到管理员权限
    echo.
) else (
    echo [✗] 需要管理员权限！
    echo.
    echo 请右键点击此文件，选择"以管理员身份运行"
    echo.
    pause
    exit /b 1
)

:: 添加防火墙规则
echo [1/2] 正在添加防火墙规则...
netsh advfirewall firewall add rule name="TodoList P2P Server" dir=in action=allow protocol=TCP localport=5353 description="TodoList P2P数据传输服务" profile=any >nul 2>&1

if %errorLevel% == 0 (
    echo [✓] 防火墙规则添加成功
    echo.
    echo 规则详情：
    echo   名称: TodoList P2P Server
    echo   端口: 5353/TCP
    echo   方向: 入站
    echo   操作: 允许
) else (
    echo [✗] 防火墙规则添加失败
    echo.
    pause
    exit /b 1
)

echo.
echo [2/2] 验证防火墙规则...
netsh advfirewall firewall show rule name="TodoList P2P Server" >nul 2>&1

if %errorLevel% == 0 (
    echo [✓] 防火墙规则验证成功
) else (
    echo [✗] 防火墙规则验证失败
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo 配置完成！
echo ============================================================
echo.
echo 现在您可以启动TodoList的P2P共享功能了。
echo 其他设备应该能够扫描并连接到您的设备。
echo.
echo 如需删除防火墙规则，请运行: remove_firewall.bat
echo.
pause

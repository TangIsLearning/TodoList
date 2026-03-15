@echo off
chcp 65001 >nul
echo ============================================================
echo TodoList P2P 防火墙规则删除工具
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

:: 检查规则是否存在
echo [1/2] 检查防火墙规则是否存在...
netsh advfirewall firewall show rule name="TodoList P2P Server" >nul 2>&1

if %errorLevel% == 0 (
    echo [✓] 找到防火墙规则
) else (
    echo [!] 防火墙规则不存在，无需删除
    echo.
    pause
    exit /b 0
)

echo.
echo [2/2] 正在删除防火墙规则...
netsh advfirewall firewall delete rule name="TodoList P2P Server" >nul 2>&1

if %errorLevel% == 0 (
    echo [✓] 防火墙规则删除成功
) else (
    echo [✗] 防火墙规则删除失败
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo 删除完成！
echo ============================================================
echo.
echo 防火墙规则已删除，其他设备将无法访问您的P2P服务。
echo.
pause

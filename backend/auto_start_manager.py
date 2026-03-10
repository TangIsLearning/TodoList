#!/usr/bin/env python3
"""
开机自启动管理器
支持Windows、Linux和macOS平台
"""

import os
import sys
import platform
from pathlib import Path
from typing import Optional, Dict, Any

from backend.utils.logger import app_logger
from backend.config_manager import get_config_manager

class AutoStartManager:
    """开机自启动管理器"""
    
    def __init__(self):
        self.system = platform.system().lower()
        self.config_manager = get_config_manager()
        self.app_name = "TodoList"
        self.app_path = self._get_app_path()
        self.delay_time = self.config_manager.get('auto_start_delay', 0)
        self.run_as_admin = self.config_manager.get('auto_start_run_as_admin', False)
        self.use_systemd = self.config_manager.get('auto_start_use_systemd', False)
        self.startup_args = self.config_manager.get('auto_start_args', '')
        
    def _get_app_path(self) -> str:
        """获取应用可执行文件路径"""
        try:
            if getattr(sys, 'frozen', False):
                # 打包后的可执行文件
                app_path = sys.executable
                app_logger.debug(f"获取到打包后的可执行文件路径: {app_path}")
                return app_path
            else:
                # 开发环境
                project_root = Path(__file__).parent.parent
                app_path = str(project_root / 'main.py')
                app_logger.debug(f"获取到开发环境应用路径: {app_path}")
                return app_path
        except Exception as e:
            app_logger.error(f"获取应用路径失败: {e}")
            raise
    
    def _get_launch_command(self) -> str:
        """获取启动命令"""
        try:
            base_command = ''
            
            # 添加延迟启动
            if self.delay_time > 0:
                if self.system == 'windows':
                    # Windows使用timeout命令
                    base_command = f'timeout /t {self.delay_time} /nobreak && '
                else:
                    # Linux/macOS使用sleep命令
                    base_command = f'sleep {self.delay_time} && '
            
            if self.app_path.endswith('.py'):
                # Python脚本
                command = f'{base_command}"{sys.executable}" "{self.app_path}" {self.startup_args}'
            else:
                # 可执行文件
                command = f'{base_command}"{self.app_path}" {self.startup_args}'
            
            app_logger.debug(f"生成启动命令: {command}")
            return command
        except Exception as e:
            app_logger.error(f"生成启动命令失败: {e}")
            raise
    
    def is_enabled(self) -> bool:
        """检查开机自启动是否已启用"""
        return self.config_manager.get('auto_start_enabled', False)
    
    def verify_auto_start(self) -> bool:
        """验证开机自启动是否真正生效"""
        try:
            if self.system == 'windows':
                return self._verify_windows_auto_start()
            elif self.system == 'linux':
                return self._verify_linux_auto_start()
            elif self.system == 'darwin':  # macOS
                return self._verify_macos_auto_start()
            else:
                app_logger.warning(f"不支持的操作系统: {self.system}")
                return False
        except Exception as e:
            app_logger.error(f"验证开机自启动失败: {e}")
            return False
    
    def set_enabled(self, enabled: bool) -> bool:
        """设置开机自启动状态"""
        app_logger.info(f"设置开机自启动状态: {enabled}")
        try:
            # 保存配置
            success = self.config_manager.set('auto_start_enabled', enabled)
            if not success:
                app_logger.warning("保存自启动配置失败")
                return False
            
            # 根据状态设置或取消自启动
            if enabled:
                result = self._enable_auto_start()
                if result:
                    app_logger.info("开机自启动已成功启用")
                else:
                    app_logger.warning("开机自启动启用失败")
                return result
            else:
                result = self._disable_auto_start()
                if result:
                    app_logger.info("开机自启动已成功禁用")
                else:
                    app_logger.warning("开机自启动禁用失败")
                return result
                
        except Exception as e:
            app_logger.error(f"设置开机自启动失败: {e}")
            return False
    
    def set_delay_time(self, delay_seconds: int) -> bool:
        """设置延迟启动时间（秒）"""
        app_logger.info(f"设置延迟启动时间: {delay_seconds}秒")
        try:
            if delay_seconds < 0:
                delay_seconds = 0
                app_logger.warning(f"延迟时间不能为负数，已设置为: {delay_seconds}秒")
            
            # 保存配置
            success = self.config_manager.set('auto_start_delay', delay_seconds)
            if not success:
                app_logger.warning("保存延迟时间配置失败")
                return False
            
            self.delay_time = delay_seconds
            
            # 如果自启动已启用，重新设置以应用延迟
            if self.is_enabled():
                app_logger.info("自启动已启用，重新应用延迟设置")
                result = self._enable_auto_start()
                if result:
                    app_logger.info(f"延迟启动时间已成功设置为: {delay_seconds}秒")
                else:
                    app_logger.warning("应用延迟设置失败")
                return result
            
            app_logger.info(f"延迟启动时间已成功设置为: {delay_seconds}秒")
            return True
            
        except Exception as e:
            app_logger.error(f"设置延迟启动时间失败: {e}")
            return False
    
    def set_run_as_admin(self, run_as_admin: bool) -> bool:
        """设置是否以管理员权限运行"""
        app_logger.info(f"设置管理员权限: {run_as_admin}")
        try:
            # 保存配置
            success = self.config_manager.set('auto_start_run_as_admin', run_as_admin)
            if not success:
                app_logger.warning("保存管理员权限配置失败")
                return False
            
            self.run_as_admin = run_as_admin
            
            # 如果自启动已启用，重新设置以应用管理员权限
            if self.is_enabled() and self.system == 'windows':
                app_logger.info("自启动已启用，重新应用管理员权限设置")
                result = self._enable_auto_start()
                if result:
                    app_logger.info(f"管理员权限设置已成功更新: {run_as_admin}")
                else:
                    app_logger.warning("应用管理员权限设置失败")
                return result
            elif self.system != 'windows':
                app_logger.info(f"管理员权限设置已更新: {run_as_admin} (仅Windows平台有效)")
            else:
                app_logger.info(f"管理员权限设置已成功更新: {run_as_admin}")
            
            return True
            
        except Exception as e:
            app_logger.error(f"设置管理员权限失败: {e}")
            return False
    
    def set_use_systemd(self, use_systemd: bool) -> bool:
        """设置是否使用 systemd 服务"""
        app_logger.info(f"设置 systemd 服务: {use_systemd}")
        try:
            # 保存配置
            success = self.config_manager.set('auto_start_use_systemd', use_systemd)
            if not success:
                app_logger.warning("保存 systemd 服务配置失败")
                return False
            
            self.use_systemd = use_systemd
            
            # 如果自启动已启用，重新设置以应用 systemd
            if self.is_enabled() and self.system == 'linux':
                app_logger.info("自启动已启用，重新应用 systemd 服务设置")
                result = self._enable_auto_start()
                if result:
                    app_logger.info(f"systemd 服务设置已成功更新: {use_systemd}")
                else:
                    app_logger.warning("应用 systemd 服务设置失败")
                return result
            elif self.system != 'linux':
                app_logger.info(f"systemd 服务设置已更新: {use_systemd} (仅Linux平台有效)")
            else:
                app_logger.info(f"systemd 服务设置已成功更新: {use_systemd}")
            
            return True
            
        except Exception as e:
            app_logger.error(f"设置 systemd 服务失败: {e}")
            return False
    
    def set_startup_args(self, args: str) -> bool:
        """设置启动参数"""
        app_logger.info(f"设置启动参数: {args}")
        try:
            # 保存配置
            success = self.config_manager.set('auto_start_args', args)
            if not success:
                app_logger.warning("保存启动参数配置失败")
                return False
            
            self.startup_args = args
            
            # 如果自启动已启用，重新设置以应用启动参数
            if self.is_enabled():
                app_logger.info("自启动已启用，重新应用启动参数设置")
                result = self._enable_auto_start()
                if result:
                    app_logger.info(f"启动参数已成功设置: {args}")
                else:
                    app_logger.warning("应用启动参数设置失败")
                return result
            
            app_logger.info(f"启动参数已成功设置: {args}")
            return True
            
        except Exception as e:
            app_logger.error(f"设置启动参数失败: {e}")
            return False
    
    def _enable_auto_start(self) -> bool:
        """启用开机自启动"""
        app_logger.debug(f"启用开机自启动，平台: {self.system}")
        try:
            if self.system == 'windows':
                return self._enable_windows_auto_start()
            elif self.system == 'linux':
                return self._enable_linux_auto_start()
            elif self.system == 'darwin':  # macOS
                return self._enable_macos_auto_start()
            else:
                app_logger.warning(f"不支持的操作系统: {self.system}")
                return False
        except Exception as e:
            app_logger.error(f"启用开机自启动失败: {e}")
            return False
    
    def _disable_auto_start(self) -> bool:
        """禁用开机自启动"""
        app_logger.debug(f"禁用开机自启动，平台: {self.system}")
        try:
            if self.system == 'windows':
                return self._disable_windows_auto_start()
            elif self.system == 'linux':
                return self._disable_linux_auto_start()
            elif self.system == 'darwin':  # macOS
                return self._disable_macos_auto_start()
            else:
                app_logger.warning(f"不支持的操作系统: {self.system}")
                return False
        except Exception as e:
            app_logger.error(f"禁用开机自启动失败: {e}")
            return False
    
    def _enable_windows_auto_start(self) -> bool:
        """Windows平台启用自启动"""
        try:
            import winreg
            
            # 启动命令
            launch_cmd = self._get_launch_command()
            
            # 如果需要以管理员权限运行
            if self.run_as_admin:
                # 使用runas命令
                launch_cmd = f'runas /user:administrator "{launch_cmd}"'
            
            # 注册表路径
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            
            # 打开注册表键
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                # 设置注册表值
                winreg.SetValueEx(key, self.app_name, 0, winreg.REG_SZ, launch_cmd)
            
            app_logger.info(f"Windows开机自启动已启用: {launch_cmd}")
            return True
            
        except ImportError:
            # 备用方案：使用启动文件夹
            return self._enable_windows_startup_folder()
        except Exception as e:
            app_logger.error(f"Windows注册表设置失败: {e}")
            return self._enable_windows_startup_folder()
    
    def _enable_windows_startup_folder(self) -> bool:
        """Windows启动文件夹方案"""
        try:
            # 获取启动文件夹路径
            startup_folder = Path(os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'
            startup_folder.mkdir(parents=True, exist_ok=True)
            
            if self.delay_time > 0 or self.run_as_admin:
                # 使用批处理文件实现延迟启动或管理员权限
                bat_path = startup_folder / f"{self.app_name}.bat"
                
                bat_content = "@echo off\n"
                
                # 添加延迟
                if self.delay_time > 0:
                    bat_content += f"timeout /t {self.delay_time} /nobreak > nul\n"
                
                # 添加管理员权限
                if self.run_as_admin:
                    bat_content += f"runas /user:administrator \"{self.app_path}\""
                else:
                    bat_content += f"start \"{self.app_name}\" \"{self.app_path}\""
                
                with open(bat_path, 'w', encoding='utf-8') as f:
                    f.write(bat_content)
                
                app_logger.info(f"Windows启动批处理文件已创建: {bat_path}")
            else:
                # 创建快捷方式
                shortcut_path = startup_folder / f"{self.app_name}.lnk"
                
                # 使用Python创建快捷方式
                import pythoncom
                from win32com.client import Dispatch
                
                shell = Dispatch('WScript.Shell')
                shortcut = shell.CreateShortcut(str(shortcut_path))
                shortcut.Targetpath = self.app_path
                shortcut.WorkingDirectory = str(Path(self.app_path).parent)
                
                # 如果需要管理员权限，设置快捷方式属性
                if self.run_as_admin:
                    # 设置以管理员身份运行
                    shortcut.Arguments = f"/runas"
                
                shortcut.save()
                
                app_logger.info(f"Windows启动文件夹快捷方式已创建: {shortcut_path}")
            
            return True
            
        except Exception as e:
            app_logger.error(f"Windows启动文件夹方案失败: {e}")
            return False
    
    def _disable_windows_auto_start(self) -> bool:
        """Windows平台禁用自启动"""
        try:
            import winreg
            
            # 注册表路径
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
            
            # 尝试删除注册表项
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_WRITE) as key:
                    winreg.DeleteValue(key, self.app_name)
            except FileNotFoundError:
                # 注册表项不存在，继续检查启动文件夹
                pass
            
            # 删除启动文件夹中的快捷方式和批处理文件
            startup_folder = Path(os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'
            
            # 删除快捷方式
            shortcut_path = startup_folder / f"{self.app_name}.lnk"
            if shortcut_path.exists():
                shortcut_path.unlink()
            
            # 删除批处理文件
            bat_path = startup_folder / f"{self.app_name}.bat"
            if bat_path.exists():
                bat_path.unlink()
            
            app_logger.info("Windows开机自启动已禁用")
            return True
            
        except Exception as e:
            app_logger.error(f"Windows禁用自启动失败: {e}")
            return False
    
    def _enable_linux_auto_start(self) -> bool:
        """Linux平台启用自启动"""
        try:
            if self.use_systemd:
                # 使用 systemd 服务
                return self._enable_linux_systemd()
            else:
                # 使用传统的 autostart 方式
                # 获取autostart目录
                autostart_dir = Path.home() / '.config' / 'autostart'
                autostart_dir.mkdir(parents=True, exist_ok=True)
                
                # 创建.desktop文件
                desktop_file = autostart_dir / f"{self.app_name}.desktop"
                
                # 启动命令
                launch_cmd = self._get_launch_command()
                
                # 桌面文件内容
                desktop_content = f"""[Desktop Entry]
Type=Application
Name={self.app_name}
Exec={launch_cmd}
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Comment=TodoList应用
"""
                
                with open(desktop_file, 'w', encoding='utf-8') as f:
                    f.write(desktop_content)
                
                # 设置可执行权限
                desktop_file.chmod(0o755)
                
                app_logger.info(f"Linux开机自启动已启用: {desktop_file}")
                return True
            
        except Exception as e:
            app_logger.error(f"Linux启用自启动失败: {e}")
            return False
    
    def _disable_linux_auto_start(self) -> bool:
        """Linux平台禁用自启动"""
        try:
            if self.use_systemd:
                # 禁用 systemd 服务
                return self._disable_linux_systemd()
            else:
                # 删除.desktop文件
                autostart_dir = Path.home() / '.config' / 'autostart'
                desktop_file = autostart_dir / f"{self.app_name}.desktop"
                
                if desktop_file.exists():
                    desktop_file.unlink()
                
                app_logger.info("Linux开机自启动已禁用")
                return True
            
        except Exception as e:
            app_logger.error(f"Linux禁用自启动失败: {e}")
            return False
    
    def _enable_linux_systemd(self) -> bool:
        """Linux平台启用 systemd 服务"""
        try:
            # 用户 systemd 服务目录
            systemd_dir = Path.home() / '.config' / 'systemd' / 'user'
            systemd_dir.mkdir(parents=True, exist_ok=True)
            
            # 服务文件路径
            service_file = systemd_dir / f"{self.app_name}.service"
            
            # 启动命令
            exec_start = self._get_launch_command()
            
            # 服务文件内容
            service_content = f"""
[Unit]
Description={self.app_name} Application
After=graphical.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=no

[Install]
WantedBy=default.target
"""
            
            with open(service_file, 'w', encoding='utf-8') as f:
                f.write(service_content)
            
            # 重新加载 systemd 配置
            import subprocess
            subprocess.run(['systemctl', '--user', 'daemon-reload'], check=False)
            
            # 启用并启动服务
            subprocess.run(['systemctl', '--user', 'enable', f'{self.app_name}.service'], check=False)
            subprocess.run(['systemctl', '--user', 'start', f'{self.app_name}.service'], check=False)
            
            app_logger.info(f"Linux systemd 服务已启用: {service_file}")
            return True
            
        except Exception as e:
            app_logger.error(f"Linux systemd 服务启用失败: {e}")
            return False
    
    def _disable_linux_systemd(self) -> bool:
        """Linux平台禁用 systemd 服务"""
        try:
            # 停止并禁用服务
            import subprocess
            subprocess.run(['systemctl', '--user', 'stop', f'{self.app_name}.service'], check=False)
            subprocess.run(['systemctl', '--user', 'disable', f'{self.app_name}.service'], check=False)
            
            # 删除服务文件
            service_file = Path.home() / '.config' / 'systemd' / 'user' / f"{self.app_name}.service"
            if service_file.exists():
                service_file.unlink()
            
            # 重新加载 systemd 配置
            subprocess.run(['systemctl', '--user', 'daemon-reload'], check=False)
            
            app_logger.info("Linux systemd 服务已禁用")
            return True
            
        except Exception as e:
            app_logger.error(f"Linux systemd 服务禁用失败: {e}")
            return False
    
    def _enable_macos_auto_start(self) -> bool:
        """macOS平台启用自启动"""
        try:
            # LaunchAgents目录
            launch_agents_dir = Path.home() / 'Library' / 'LaunchAgents'
            launch_agents_dir.mkdir(parents=True, exist_ok=True)
            
            # plist文件路径
            plist_file = launch_agents_dir / f"com.{self.app_name.lower()}.plist"
            
            # 日志目录
            log_dir = Path.home() / '.local' / 'var' / 'log'
            log_dir.mkdir(parents=True, exist_ok=True)
            
            if self.delay_time > 0:
                # 使用shell脚本实现延迟启动
                script_path = Path.home() / '.local' / 'bin'
                script_path.mkdir(parents=True, exist_ok=True)
                
                script_file = script_path / f"{self.app_name}_start.sh"
                script_content = f"""#!/bin/bash
 sleep {self.delay_time}
 {sys.executable} "{self.app_path}" {self.startup_args}
 """
                
                with open(script_file, 'w', encoding='utf-8') as f:
                    f.write(script_content)
                
                # 设置可执行权限
                script_file.chmod(0o755)
                
                # plist文件内容
                plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{self.app_name.lower()}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>{script_file}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{log_dir}/{self.app_name}.out.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/{self.app_name}.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>{Path(self.app_path).parent}</string>
    <key>StartInterval</key>
    <integer>0</integer>
    <key>LaunchOnlyOnce</key>
    <true/>
</dict>
</plist>
"""
            else:
                # 直接启动应用
                # plist文件内容
                plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{self.app_name.lower()}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{sys.executable}</string>
        <string>{self.app_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>{log_dir}/{self.app_name}.out.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/{self.app_name}.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>{Path(self.app_path).parent}</string>
    <key>StartInterval</key>
    <integer>0</integer>
    <key>LaunchOnlyOnce</key>
    <true/>
</dict>
</plist>
"""
            
            with open(plist_file, 'w', encoding='utf-8') as f:
                f.write(plist_content)
            
            # 加载LaunchAgent
            import subprocess
            subprocess.run(['launchctl', 'load', str(plist_file)], check=False)
            
            app_logger.info(f"macOS开机自启动已启用: {plist_file}")
            return True
            
        except Exception as e:
            app_logger.error(f"macOS启用自启动失败: {e}")
            return False
    
    def _disable_macos_auto_start(self) -> bool:
        """macOS平台禁用自启动"""
        try:
            # LaunchAgents目录
            launch_agents_dir = Path.home() / 'Library' / 'LaunchAgents'
            plist_file = launch_agents_dir / f"com.{self.app_name.lower()}.plist"
            
            if plist_file.exists():
                # 卸载LaunchAgent
                import subprocess
                subprocess.run(['launchctl', 'unload', str(plist_file)], check=False)
                
                # 删除plist文件
                plist_file.unlink()
            
            # 删除启动脚本
            script_file = Path.home() / '.local' / 'bin' / f"{self.app_name}_start.sh"
            if script_file.exists():
                script_file.unlink()
            
            app_logger.info("macOS开机自启动已禁用")
            return True
            
        except Exception as e:
            app_logger.error(f"macOS禁用自启动失败: {e}")
            return False
    
    def _verify_windows_auto_start(self) -> bool:
        """验证Windows平台自启动状态"""
        try:
            # 检查注册表
            try:
                import winreg
                key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ) as key:
                    value, _ = winreg.QueryValueEx(key, self.app_name)
                    if value:
                        return True
            except Exception:
                pass
            
            # 检查启动文件夹
            startup_folder = Path(os.environ.get('APPDATA', '')) / 'Microsoft' / 'Windows' / 'Start Menu' / 'Programs' / 'Startup'
            shortcut_path = startup_folder / f"{self.app_name}.lnk"
            return shortcut_path.exists()
            
        except Exception as e:
            app_logger.error(f"验证Windows自启动失败: {e}")
            return False
    
    def _verify_linux_auto_start(self) -> bool:
        """验证Linux平台自启动状态"""
        try:
            if self.use_systemd:
                # 验证 systemd 服务
                import subprocess
                result = subprocess.run(
                    ['systemctl', '--user', 'is-enabled', f'{self.app_name}.service'],
                    capture_output=True,
                    text=True
                )
                return result.stdout.strip() == 'enabled'
            else:
                # 验证传统的 autostart 方式
                autostart_dir = Path.home() / '.config' / 'autostart'
                desktop_file = autostart_dir / f"{self.app_name}.desktop"
                return desktop_file.exists()
        except Exception as e:
            app_logger.error(f"验证Linux自启动失败: {e}")
            return False
    
    def _verify_macos_auto_start(self) -> bool:
        """验证macOS平台自启动状态"""
        try:
            launch_agents_dir = Path.home() / 'Library' / 'LaunchAgents'
            plist_file = launch_agents_dir / f"com.{self.app_name.lower()}.plist"
            return plist_file.exists()
        except Exception as e:
            app_logger.error(f"验证macOS自启动失败: {e}")
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """获取自启动状态信息"""
        enabled = self.is_enabled()
        verified = self.verify_auto_start()
        
        return {
            'enabled': enabled,
            'verified': verified,
            'delay_time': self.delay_time,
            'run_as_admin': self.run_as_admin,
            'use_systemd': self.use_systemd,
            'startup_args': self.startup_args,
            'platform': self.system,
            'app_path': self.app_path,
            'launch_command': self._get_launch_command(),
            'supported': self.system in ['windows', 'linux', 'darwin']
        }

# 全局自启动管理器实例
_auto_start_manager: Optional[AutoStartManager] = None

def get_auto_start_manager() -> AutoStartManager:
    """获取全局自启动管理器实例"""
    global _auto_start_manager
    if _auto_start_manager is None:
        _auto_start_manager = AutoStartManager()
    return _auto_start_manager

def set_auto_start_enabled(enabled: bool) -> bool:
    """设置开机自启动状态（便捷函数）"""
    return get_auto_start_manager().set_enabled(enabled)

def get_auto_start_status() -> Dict[str, Any]:
    """获取自启动状态信息（便捷函数）"""
    return get_auto_start_manager().get_status()
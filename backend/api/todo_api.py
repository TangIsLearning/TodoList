"""
TodoList应用的前后端通信API
"""
import os
import sys
import logging
import webbrowser
from datetime import datetime
from pathlib import Path

from backend.database.operations import TodoDatabase
from backend.utils.logger import backend_logger, log_frontend_message

logger = logging.getLogger(__name__)

# 确保能找到database模块
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

class TodoApi:
    """TodoList应用的API类，提供前后端通信接口"""
    
    def __init__(self):
        backend_logger.info("初始化TodoApi")
        self.db = TodoDatabase()
        backend_logger.info("数据库连接成功")
        # 重置已提醒任务列表，确保新任务可以被提醒
        try:
            from backend.reminder.task_reminder import get_reminder
            reminder = get_reminder()
            reminder.reset_notified_tasks()
            backend_logger.info("任务提醒器已重置")
        except Exception as e:
            backend_logger.warning(f"重置任务提醒器失败: {e}")
    
    def validate_due_date(self, task_data):
        """校验截止时间"""
        due_date_str = task_data.get('dueDate')
        
        if not due_date_str:
            return {'valid': True, 'message': ''}
        
        try:
            due_date = datetime.fromisoformat(due_date_str)
            now = datetime.now()
            
            # 检查是否早于当前时间
            if due_date < now:
                return {
                    'valid': False, 
                    'message': '截止时间不能早于当前时间'
                }
            
            return {'valid': True, 'message': ''}
            
        except ValueError as e:
            return {
                'valid': False,
                'message': '截止时间格式无效'
            }
    
    # 任务相关API
    def add_todo(self, task_data):
        """添加新任务"""
        # 校验截止时间
        validation_result = self.validate_due_date(task_data)
        if not validation_result['valid']:
            return {'success': False, 'error': validation_result['message']}
        
        try:
            result = self.db.add_task(task_data)
            return {'success': True, 'task': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_todos(self, page=1, page_size=10, category_id=None, status=None, 
                   priority=None, due_date_filter=None, year=None, month=None, 
                   search_query=None, custom_date=None):
        """分页获取任务，支持多种筛选条件
        
        参数:
            page: 页码，从1开始
            page_size: 每页数量，支持10/20/50/100
            category_id: 分类ID，'all'表示所有分类，'uncategorized'表示未分类
            status: 状态筛选，可选值: all/completed/uncompleted/pending/overdue
            priority: 优先级筛选，可选值: all/high/medium/low/none
            due_date_filter: 日期筛选，可选值: all/today/tomorrow/week/month/no-due-date
            year: 年份筛选
            month: 月份筛选
            search_query: 搜索关键词
            custom_date: 自定义日期筛选，格式YYYY-MM-DD
        """
        try:
            result = self.db.get_tasks_paginated(
                page=page, 
                page_size=page_size,
                category_id=category_id,
                status=status,
                priority=priority,
                due_date_filter=due_date_filter,
                year=year,
                month=month,
                search_query=search_query,
                custom_date=custom_date
            )
            return {'success': True, **result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_todo(self, task_id):
        """获取单个任务"""
        try:
            task = self.db.get_task(task_id)
            return {'success': True, 'task': task}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def update_todo(self, task_id, task_data):
        """更新任务"""
        # 校验截止时间
        validation_result = self.validate_due_date(task_data)
        if not validation_result['valid']:
            return {'success': False, 'error': validation_result['message']}
        
        try:
            result = self.db.update_task(task_id, task_data)
            return {'success': True, 'task': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def delete_todo(self, task_id, delete_all=False):
        """删除任务"""
        try:
            # 先检查是否为周期性任务
            task = self.db.get_task(task_id)
            if task and (task.get('isRecurring') or task.get('parentTaskId')):
                result = self.db.delete_recurring_task(task_id, delete_all)
            else:
                result = self.db.delete_task(task_id)
            return {'success': True, 'result': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def add_recurring_todo(self, task_data):
        """添加周期性任务"""
        # 校验截止时间
        validation_result = self.validate_due_date(task_data)
        if not validation_result['valid']:
            return {'success': False, 'error': validation_result['message']}
        
        # 校验周期性任务参数
        if task_data.get('isRecurring'):
            if not task_data.get('recurrenceType'):
                return {'success': False, 'error': '周期类型不能为空'}
            if not task_data.get('dueDate'):
                return {'success': False, 'error': '周期性任务必须设置截止时间'}
        
        try:
            result = self.db.create_recurring_tasks(task_data)
            return {'success': True, 'tasks': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def toggle_todo(self, task_id):
        """切换任务完成状态"""
        try:
            task = self.db.get_task(task_id)
            if task:
                task['completed'] = not task['completed']
                result = self.db.update_task(task_id, task, False)
                return {'success': True, 'task': result}
            return {'success': False, 'error': 'Task not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # 分类相关API
    def add_category(self, category_data):
        """添加新分类"""
        try:
            result = self.db.add_category(category_data)
            return {'success': True, 'category': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_categories(self):
        """获取所有分类"""
        try:
            categories = self.db.get_all_categories()
            return {'success': True, 'categories': categories}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def delete_category(self, category_id):
        """删除分类"""
        try:
            result = self.db.delete_category(category_id)
            return {'success': True, 'result': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def update_category(self, category_id, category_data):
        """更新分类"""
        try:
            result = self.db.update_category(category_id, category_data)
            return {'success': True, 'category': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # 统计相关API
    def get_stats(self, dimension='all'):
        """获取任务统计信息

        参数:
            dimension: 统计维度，可选值: all/year/month/week/day
        """
        try:
            from datetime import timedelta

            tasks = self.db.get_all_tasks()
            now = datetime.now()

            # 根据维度过滤任务
            filtered_tasks = tasks
            if dimension != 'all':
                if dimension == 'year':
                    # 今年
                    filtered_tasks = [task for task in tasks if task['createdAt'] and
                                     datetime.fromisoformat(task['createdAt']).year == now.year]
                elif dimension == 'month':
                    # 本月
                    filtered_tasks = [task for task in tasks if task['createdAt'] and
                                     datetime.fromisoformat(task['createdAt']).year == now.year and
                                     datetime.fromisoformat(task['createdAt']).month == now.month]
                elif dimension == 'week':
                    # 本周（周一到周日）
                    today = now.date()
                    monday = today - timedelta(days=today.weekday())
                    sunday = monday + timedelta(days=6)
                    filtered_tasks = [task for task in tasks if task['createdAt'] and
                                     monday <= datetime.fromisoformat(task['createdAt']).date() <= sunday]
                elif dimension == 'day':
                    # 今天
                    filtered_tasks = [task for task in tasks if task['createdAt'] and
                                     datetime.fromisoformat(task['createdAt']).date() == now.date()]

            # 统计数据
            total_tasks = len(filtered_tasks)
            completed_tasks = sum(1 for task in filtered_tasks if task['completed'])
            uncompleted_tasks = total_tasks - completed_tasks
            no_due_date_tasks = sum(1 for task in filtered_tasks if not task['dueDate'])

            # 按优先级统计
            high_priority = sum(1 for task in filtered_tasks if task['priority'] == 'high' and not task['completed'])
            medium_priority = sum(1 for task in filtered_tasks if task['priority'] == 'medium' and not task['completed'])
            low_priority = sum(1 for task in filtered_tasks if task['priority'] == 'low' and not task['completed'])

            return {
                'success': True,
                'stats': {
                    'total': total_tasks,
                    'completed': completed_tasks,
                    'uncompleted': uncompleted_tasks,
                    'completion_rate': round((completed_tasks / total_tasks * 100) if total_tasks > 0 else 0, 1),
                    'no_due_date': no_due_date_tasks,
                    'by_priority': {
                        'high': high_priority,
                        'medium': medium_priority,
                        'low': low_priority
                    }
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # 设置相关API
    def get_settings(self):
        """获取所有设置"""
        try:
            from backend.database.operations import TodoDatabase
            settings_db = TodoDatabase()
            settings = settings_db.get_all_settings()
            return {'success': True, 'settings': settings}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_setting(self, key, default_value=None):
        """获取单个设置"""
        try:
            from backend.database.operations import TodoDatabase
            settings_db = TodoDatabase()
            value = settings_db.get_setting(key, default_value)
            return {'success': True, 'value': value}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def set_setting(self, key, value):
        """保存单个设置"""
        try:
            from backend.database.operations import TodoDatabase
            settings_db = TodoDatabase()
            settings_db.set_setting(key, value)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def delete_setting(self, key):
        """删除单个设置"""
        try:
            from backend.database.operations import TodoDatabase
            settings_db = TodoDatabase()
            settings_db.delete_setting(key)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def reset_settings(self):
        """重置所有设置为默认值"""
        try:
            from backend.database.operations import TodoDatabase
            settings_db = TodoDatabase()
            settings_db.reset_settings()
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # P2P数据传输相关API
    def p2p_start_server(self):
        """启动P2P服务器"""
        try:
            from backend.p2p.p2p_server import P2PServer
            from backend.p2p.data_manager import DataManager

            # 确保只启动一个服务器实例
            if not hasattr(self, '_p2p_server'):
                self._p2p_server = P2PServer()
                self._data_manager = DataManager()

            def data_received_callback(data, address):
                """数据接收回调"""
                # 存储接收到的数据供前端获取
                self._received_data = data
                print(f"接收到来自 {address[0]} 的数据")

            def data_request_callback():
                """数据请求回调 - 返回要共享的数据"""
                if hasattr(self, '_exported_data') and self._exported_data:
                    return self._exported_data
                return None

            self._p2p_server.set_data_request_callback(data_request_callback)

            success, message = self._p2p_server.start(data_received_callback)

            if success:
                local_ip = self._p2p_server.get_local_ip()
                return {
                    'success': True,
                    'ip': local_ip,
                    'port': self._p2p_server.port,
                    'message': message or f'服务器已启动，IP: {local_ip}, 端口: {self._p2p_server.port}'
                }
            else:
                return {'success': False, 'error': message or '服务器启动失败'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_get_shared_data(self):
        """获取要共享的数据（供服务器使用）"""
        try:
            if hasattr(self, '_exported_data'):
                return self._exported_data
            return None
        except:
            return None

    def p2p_stop_server(self):
        """停止P2P服务器"""
        try:
            if hasattr(self, '_p2p_server'):
                success, message = self._p2p_server.stop()
                return {'success': success, 'message': message or '服务器已停止'}
            return {'success': True, 'message': '服务器未运行'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_scan_devices(self):
        """扫描局域网内的设备"""
        try:
            from backend.p2p.p2p_client import P2PClient
            client = P2PClient()
            devices = client.scan_devices()
            return {'success': True, 'devices': devices}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_receive_data(self, ip):
        """从指定设备接收数据"""
        try:
            from backend.p2p.p2p_client import P2PClient
            client = P2PClient()
            data = client.receive_data(ip)
            if data:
                # 存储接收到的数据供前端确认后导入
                self._received_data = data
                return {'success': True, 'data': data}
            else:
                return {'success': False, 'error': '接收数据失败'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_get_received_data(self):
        """获取接收到的数据"""
        try:
            if hasattr(self, '_received_data'):
                return {'success': True, 'data': self._received_data}
            return {'success': False, 'error': '暂无接收到的数据'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_export_data(self):
        """导出当前数据"""
        try:
            from backend.p2p.data_manager import DataManager
            data_manager = DataManager()
            data = data_manager.export_data()
            if data:
                # 存储导出的数据供服务器使用
                self._exported_data = data
                return {'success': True, 'data': data}
            else:
                return {'success': False, 'error': '导出数据失败'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_get_exported_data(self):
        """获取导出的数据"""
        try:
            if hasattr(self, '_exported_data'):
                return {'success': True, 'data': self._exported_data}
            return {'success': False, 'error': '暂无导出的数据'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_get_data_summary(self):
        """获取当前数据摘要"""
        try:
            from backend.p2p.data_manager import DataManager
            data_manager = DataManager()
            summary = data_manager.get_data_summary()
            if summary:
                return {'success': True, 'summary': summary}
            else:
                return {'success': False, 'error': '获取数据摘要失败'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_has_data(self):
        """检查是否有数据"""
        try:
            from backend.p2p.data_manager import DataManager
            data_manager = DataManager()
            has_data = data_manager.has_data()
            return {'success': True, 'has_data': has_data}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_import_data(self, data, backup=True):
        """导入数据"""
        try:
            from backend.p2p.data_manager import DataManager
            data_manager = DataManager()
            is_android = hasattr(sys, 'getandroidapilevel') or 'ANDROID_ARGUMENT' in os.environ
            if is_android:
                backup = False # 在安卓设备上由于可能存在权限问题，因而不做备份操作
            success = data_manager.import_data(data, backup=backup)
            if success:
                # 导入成功后刷新前端缓存
                self._received_data = None
                backend_logger.info("数据导入成功")
                return {'success': True, 'message': '数据导入成功'}
            else:
                backend_logger.error("数据导入失败")
                return {'success': False, 'error': '数据导入失败'}
        except Exception as e:
            backend_logger.error(f"导入数据异常: {e}")
            return {'success': False, 'error': str(e)}
    
    # ==================== 数据目录配置API ====================
    
    def get_data_file_config(self):
        """获取数据文件配置"""
        try:
            from backend.config import get_current_data_file, get_default_data_file
            from backend.database.operations import get_app_data_file
            from backend.config_manager import get_config_manager
            
            current_file = get_current_data_file()
            default_file = get_default_data_file()
            actual_file = str(get_app_data_file())
            
            # 获取配置管理器中的配置信息
            config_manager = get_config_manager()
            external_config = config_manager.get('data_file')
            
            return {
                'success': True,
                'current_file': current_file,
                'default_file': default_file,
                'actual_file': actual_file,
                'external_config': external_config,
                'is_custom': current_file != default_file
            }
        except Exception as e:
            backend_logger.error(f"获取数据文件配置失败: {e}")
            return {'success': False, 'error': str(e)}
    
    def set_data_file_config(self, file_path):
        """设置数据文件配置"""
        try:
            from backend.config import set_data_file
            from backend.p2p.data_manager import DataManager
            
            # 验证并设置新文件
            if set_data_file(file_path):
                # 重新初始化数据库连接以使用新文件
                self.db = TodoDatabase()
                
                # 更新数据管理器
                if hasattr(self, '_data_manager'):
                    self._data_manager.switch_data_file(file_path)
                else:
                    self._data_manager = DataManager(file_path)
                
                backend_logger.info(f"数据文件已设置为: {file_path}")
                return {
                    'success': True, 
                    'message': '数据文件设置成功',
                    'new_file': file_path
                }
            else:
                return {'success': False, 'error': '设置数据文件失败'}
                
        except Exception as e:
            backend_logger.error(f"设置数据文件配置失败: {e}")
            return {'success': False, 'error': str(e)}
    
    def validate_data_file(self, file_path):
        """验证数据文件路径的有效性"""
        try:
            import os
            from pathlib import Path
            
            if not file_path or not isinstance(file_path, str):
                return {'success': False, 'error': '文件路径不能为空'}
            
            path = Path(file_path)
            
            # 检查路径格式
            try:
                path.resolve()
            except Exception:
                return {'success': False, 'error': '文件路径格式无效'}
            
            # 检查扩展名
            if path.suffix.lower() not in ['.db']:
                return {'success': False, 'error': '仅支持 .db 文件'}
            
            # 检查权限
            if path.exists():
                if not os.access(path, os.R_OK | os.W_OK):
                    return {'success': False, 'error': '没有对该文件的读写权限'}
            else:
                # 检查父目录权限
                parent = path.parent
                if not parent.exists():
                    return {'success': False, 'error': '父目录不存在'}
                if not os.access(parent, os.W_OK):
                    return {'success': False, 'error': '没有在该目录创建文件的权限'}
            
            return {'success': True, 'message': '文件路径有效'}
            
        except Exception as e:
            return {'success': False, 'error': f'验证文件路径时出错: {str(e)}'}
    
    def select_file_dialog(self):
        """打开文件选择对话框"""
        try:
            import webview
            active_window = webview.active_window()
            file_types = ('Data Files (*.db)', 'All files (*.*)')
            selected_path = active_window.create_file_dialog(
                webview.FileDialog.OPEN,
                file_types=file_types
            )

            if selected_path:
                return {
                    'success': True,
                    'selected_path': selected_path,
                    'message': '文件选择成功'
                }
            else:
                return {
                    'success': False,
                    'error': '用户取消了文件选择'
                }

        except Exception as e:
            return {
                'success': False,
                'error': f'文件选择对话框不可用: {str(e)}',
                'fallback': True
            }

    def log(self, level, message, source='frontend'):
        """从前端记录日志
        
        Args:
            level: 日志级别（debug, info, warning, error, critical）
            message: 日志消息
            source: 日志来源
        """
        log_frontend_message(level, message, source)

    # ==================== 标签相关API ====================

    def get_all_tags(self):
        """获取所有标签"""
        try:
            tags = self.db.get_all_tags()
            return {'success': True, 'tags': tags}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_task_tags(self, task_id):
        """获取任务的标签"""
        try:
            tags = self.db.get_task_tags(task_id)
            return {'success': True, 'tags': tags}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def delete_tag(self, tag_id):
        """删除标签"""
        try:
            self.db.delete_tag(tag_id)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    # ==================== WebDAV同步相关API ====================
    
    def get_webdav_config(self):
        """获取WebDAV配置"""
        try:
            from backend.config_manager import get_webdav_config
            config = get_webdav_config()
            return {
                'success': True,
                'config': config
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def set_webdav_config(self, config):
        """设置WebDAV配置"""
        try:
            from backend.config_manager import set_webdav_config
            
            # 保存配置
            success = set_webdav_config(config)
            
            if success:
                # 如果启用了自动同步，重启同步管理器
                if config.get('enabled') and config.get('auto_sync'):
                    from backend.webdav.data_sync import get_data_sync_manager
                    sync_manager = get_data_sync_manager()
                    sync_manager.start_auto_sync()
                elif not config.get('enabled') or not config.get('auto_sync'):
                    # 停止自动同步
                    from backend.webdav.data_sync import get_data_sync_manager
                    sync_manager = get_data_sync_manager()
                    sync_manager.stop_auto_sync()
                
                return {
                    'success': True,
                    'message': 'WebDAV配置保存成功'
                }
            else:
                return {
                    'success': False,
                    'error': '配置保存失败'
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def test_webdav_connection(self, username, password, remote_path):
        """测试WebDAV连接"""
        try:
            from backend.webdav.webdav_client import WebDAVClient
            
            # 创建临时客户端进行测试
            client = WebDAVClient()
            if client.configure(username, password, remote_path):
                result = client.test_connection()
                return result
            else:
                return {
                    'success': False,
                    'error': '客户端配置失败'
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def sync_from_cloud(self, is_overwrite = False):
        """从云端同步数据到本地"""
        try:
            from backend.webdav.data_sync import get_data_sync_manager
            sync_manager = get_data_sync_manager()
            result = sync_manager.sync_from_cloud(is_overwrite)
            return result
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def sync_to_cloud(self):
        """将本地数据同步到云端"""
        try:
            from backend.webdav.data_sync import get_data_sync_manager
            sync_manager = get_data_sync_manager()
            result = sync_manager.sync_to_cloud()
            return result
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def get_sync_status(self):
        """获取同步状态"""
        try:
            from backend.webdav.data_sync import get_data_sync_manager
            sync_manager = get_data_sync_manager()
            status = sync_manager.get_sync_status()
            return {
                'success': True,
                'status': status
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def trigger_upload_on_change(self):
        """在数据变更时触发上传"""
        try:
            from backend.webdav.data_sync import get_data_sync_manager
            sync_manager = get_data_sync_manager()
            sync_manager.trigger_upload_on_change()
            logger.info(f"更新文件成功")
            return {
                'success': True
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    # ==================== 开机自启动相关API ====================
    
    def get_auto_start_config(self):
        """获取开机自启动配置"""
        try:
            from backend.auto_start_manager import get_auto_start_status
            status = get_auto_start_status()
            return {
                'success': True,
                'config': {
                    'enabled': status['enabled'],
                    'platform': status['platform'],
                    'supported': status['supported']
                }
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def set_auto_start_config(self, enabled):
        """设置开机自启动配置"""
        try:
            from backend.auto_start_manager import set_auto_start_enabled
            success = set_auto_start_enabled(enabled)
            if success:
                return {
                    'success': True,
                    'message': '开机自启动设置已保存'
                }
            else:
                return {
                    'success': False,
                    'error': '设置开机自启动失败'
                }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def get_auto_start_status(self):
        """获取开机自启动状态详情"""
        try:
            from backend.auto_start_manager import get_auto_start_status
            status = get_auto_start_status()
            return {
                'success': True,
                'status': status
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def open_in_browser(self, url):
        webbrowser.open(url)

    # ==================== API Token 管理相关 API ====================

    def get_api_token_config(self):
        """获取 API Token 配置"""
        try:
            from backend.auth.token_manager import get_token_manager
            token_manager = get_token_manager()
            status = token_manager.get_api_access_status()
            return {
                'success': True,
                'config': status
            }
        except Exception as e:
            backend_logger.error(f"获取 API Token 配置失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def generate_api_token(self, expires_days=365):
        """生成 API Token"""
        try:
            from backend.auth.token_manager import get_token_manager
            token_manager = get_token_manager()
            token = token_manager.generate_token(expires_days)
            return {
                'success': True,
                'token': token,
                'message': '请妥善保管此 Token，这是唯一一次显示明文'
            }
        except Exception as e:
            backend_logger.error(f"生成 API Token 失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def revoke_api_token(self):
        """撤销 API Token"""
        try:
            from backend.auth.token_manager import get_token_manager
            token_manager = get_token_manager()
            result = token_manager.revoke_token()
            return {
                'success': result,
                'message': 'Token 已撤销' if result else '撤销失败'
            }
        except Exception as e:
            backend_logger.error(f"撤销 API Token 失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def enable_api_access(self):
        """启用 API 访问"""
        try:
            from backend.auth.token_manager import get_token_manager
            token_manager = get_token_manager()
            result = token_manager.enable_api_access()
            return {
                'success': result,
                'message': 'API 访问已启用' if result else '启用失败'
            }
        except Exception as e:
            backend_logger.error(f"启用 API 访问失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def disable_api_access(self):
        """禁用 API 访问"""
        try:
            from backend.auth.token_manager import get_token_manager
            token_manager = get_token_manager()
            result = token_manager.disable_api_access()
            return {
                'success': result,
                'message': 'API 访问已禁用' if result else '禁用失败'
            }
        except Exception as e:
            backend_logger.error(f"禁用 API 访问失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    # ==================== HTTP API 服务器控制 API ====================

    def start_http_server(self, host='127.0.0.1', port=8765):
        """启动 HTTP API 服务器"""
        try:
            from backend.api.http_server import get_http_server

            if self._http_server is None:
                self._http_server = get_http_server(host, port)

            success, message = self._http_server.start()

            return {
                'success': success,
                'message': message,
                'status': self._http_server.get_status() if success else None
            }
        except Exception as e:
            backend_logger.error(f"启动 HTTP 服务器失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def stop_http_server(self):
        """停止 HTTP API 服务器"""
        try:
            from backend.api.http_server import stop_http_server

            if self._http_server:
                success, message = self._http_server.stop()
                self._http_server = None
            else:
                success, message = stop_http_server()

            return {
                'success': success,
                'message': message
            }
        except Exception as e:
            backend_logger.error(f"停止 HTTP 服务器失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }

    def get_http_server_status(self):
        """获取 HTTP 服务器状态"""
        try:
            from backend.api.http_server import get_http_server_status

            if self._http_server:
                return {
                    'success': True,
                    'status': self._http_server.get_status()
                }
            else:
                status = get_http_server_status()
                return {
                    'success': True,
                    'status': status
                }
        except Exception as e:
            backend_logger.error(f"获取 HTTP 服务器状态失败：{e}")
            return {
                'success': False,
                'error': str(e)
            }
"""
TodoList应用的前后端通信API
"""
import os
import sys
import logging
import webbrowser
from datetime import datetime
from pathlib import Path

from backend.database.operations import TodoDatabase, UserManager, CategoryManager
from backend.database.data_export import DataExportManager
from backend.features.p2p.p2p_server import P2PServer
from backend.features.p2p.p2p_client import P2PClient
from backend.utils.logger import backend_logger, log_frontend_message

logger = logging.getLogger(__name__)

# 确保能找到database模块
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.platforms.core.factory import get_platform_service
service = get_platform_service()

class TodoApi:
    """TodoList应用的API类，提供前后端通信接口"""
    
    def __init__(self, is_android, sync_manager):
        backend_logger.info("初始化TodoApi")
        self.db = TodoDatabase()
        self.user_manager = UserManager(self.db)
        self.category_manager = CategoryManager(self.db)
        self.is_android = is_android
        self.sync_manager = sync_manager
        self._received_data = None
        self._exported_data = None
        self._p2p_server = P2PServer()
        self._p2p_client = P2PClient()
        self._data_manager = DataExportManager()
        backend_logger.info("初始化TodoApi成功")
        try:
            service.add_new_desktop_task_reminder()
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

    # 日历写入权限校验
    def check_calendar_permission(self):
        """检查权限"""
        service.check_calendar_permission()

    # 任务相关API
    def add_todo(self, task_data):
        """添加新任务"""
        # 校验截止时间
        validation_result = self.validate_due_date(task_data)
        if not validation_result['valid']:
            return {'success': False, 'error': validation_result['message']}

        try:
            if task_data.get('dueDate') and self.is_android:
                target_time = datetime.fromisoformat(task_data['dueDate']).timestamp() * 1000
                service.add_task_reminder_to_calendar(task_data['title'], task_data['description'], target_time)
            result = self.db.add_task(task_data)
            return {'success': True, 'task': result}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_todos(self, page=1, page_size=10, category_id=None, status=None, 
                   priority=None, due_date_filter=None, year=None, month=None, 
                   search_query=None, custom_date=None, custom_start_date=None, custom_end_date=None):
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
            custom_date: 自定义具体日期筛选，格式YYYY-MM-DD
            custom_start_date: 自定义开始日期筛选，格式YYYY-MM-DD
            custom_end_date: 自定义结束日期筛选，格式YYYY-MM-DD
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
                custom_date=custom_date,
                custom_start_date=custom_start_date,
                custom_end_date=custom_end_date
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
            for task in result:
                if task.get('dueDate') and self.is_android:
                    target_time = datetime.fromisoformat(task['dueDate']).timestamp() * 1000
                    service.add_task_reminder_to_calendar(task['title'], task['description'], target_time)
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
            devices = self._p2p_client.scan_devices()
            return {'success': True, 'devices': devices}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_receive_data(self, ip):
        """从指定设备接收数据"""
        try:
            data = self._p2p_client.receive_data(ip)
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
            self._exported_data  = self._data_manager.export_data()
            if self._exported_data :
                # 存储导出的数据供服务器使用
                return {'success': True, 'data': self._exported_data }
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
            summary = self._data_manager.get_data_summary()
            if summary:
                return {'success': True, 'summary': summary}
            else:
                return {'success': False, 'error': '获取数据摘要失败'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_has_data(self):
        """检查是否有数据"""
        try:
            has_data = self._data_manager.has_data()
            return {'success': True, 'has_data': has_data}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def p2p_import_data(self, data):
        """导入数据"""
        try:
            # 在安卓设备上由于可能存在权限问题，因而不做备份操作
            success = self._data_manager.import_data(data, backup=(not self.is_android))
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
            
            # 验证并设置新文件
            if set_data_file(file_path):
                # 重新初始化数据库连接以使用新文件
                self.db = TodoDatabase()
                
                # 更新数据管理器
                if hasattr(self, '_data_manager'):
                    self._data_manager.switch_data_file(file_path)
                else:
                    self._data_manager = DataExportManager(file_path)
                
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

    def _call_manager_method(self, method_name, *args, **kwargs):
        """通用调用 sync_manager 的方法，自动处理异常和不支持的情况"""
        if self.sync_manager and hasattr(self.sync_manager, method_name):
            try:
                return getattr(self.sync_manager, method_name)(*args, **kwargs)
            except Exception as e:
                return {'success': False, 'error': str(e)}
        else:
            return {'success': False, 'error': '当前系统不支持'}

    def get_webdav_config(self):
        """获取WebDAV配置"""
        return self._call_manager_method('get_webdav_config')
    
    def set_webdav_config(self, config):
        """设置WebDAV配置"""
        return self._call_manager_method('set_webdav_config', config)
    
    def test_webdav_connection(self, username, password, remote_path):
        """测试WebDAV连接"""
        return self._call_manager_method('test_webdav_connection', username, password, remote_path)
    
    def sync_from_cloud(self, is_overwrite = False):
        """从云端同步数据到本地"""
        return self._call_manager_method('sync_from_cloud', is_overwrite)
    
    def sync_to_cloud(self):
        """将本地数据同步到云端"""
        return self._call_manager_method('sync_to_cloud')
    
    def get_sync_status(self):
        """获取同步状态"""
        return self._call_manager_method('get_sync_status')
    
    def trigger_upload_on_change(self):
        """在数据变更时触发上传"""
        return self._call_manager_method('trigger_upload_on_change')
    
    # ==================== 开机自启动相关API ====================
    
    def get_auto_start_config(self):
        """获取开机自启动配置"""
        from backend.utils import utils
        try:
            status = service.get_auto_start_status()
            return {
                'success': True,
                'config': {
                    'enabled': utils.str_to_bool(status['enabled']),
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
            success = service.set_auto_start_enabled(enabled)
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

    # ==================== 窗口置顶相关API ====================

    def set_window_on_top_config(self, enabled):
        """设置窗口置顶配置"""
        try:
            from backend.utils import utils
            import backend.globals
            self.set_setting('window_on_top', enabled)
            backend.globals.window.on_top = utils.str_to_bool(self.db.get_setting('window_on_top', False))
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_window_on_top_config(self):
        """获取窗口置顶配置"""
        try:
            from backend.utils import utils
            enabled = utils.str_to_bool(self.db.get_setting('window_on_top', False))
            return {
                'success': True,
                'enabled': enabled
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    # ==================== 快捷键相关API ====================

    def set_shortcut_config(self, shortcut):
        """设置快捷键配置"""
        try:
            self.set_setting('shortcut', shortcut)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_shortcut_config(self):
        """获取快捷键配置"""
        try:
            shortcut = self.db.get_setting('shortcut', '<ctrl>+<space>')
            return {
                'success': True,
                'config': shortcut
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    # ==================== 快捷键相关API ====================

    def set_theme_config(self, theme):
        """设置快捷键配置"""
        try:
            self.set_setting('theme', theme)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_theme_config(self):
        """获取快捷键配置"""
        try:
            theme = self.db.get_setting('theme', 'light')
            return {
                'success': True,
                'config': theme
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def set_language_config(self, language):
        """设置快捷键配置"""
        try:
            self.set_setting('language', language)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def get_language_config(self):
        """获取快捷键配置"""
        try:
            language = self.db.get_setting('language', 'zh')
            return {
                'success': True,
                'config': language
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }

    def open_in_browser(self, url):
        webbrowser.open(url)

    # ===== A 阶段：用户系统 / 审计日志 API =====

    def auth_get_current_user(self):
        """获取当前登录用户。无有效 session 时 user=None。"""
        try:
            token = self.user_manager.get_current_token()
            if not token:
                return {'success': True, 'user': None, 'token': None}
            user = self.user_manager.get_user_by_token(token)
            return {
                'success': True,
                'user': user.to_dict() if user else None,
                'token': token,
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_create_user(self, display_name, unit=None, department=None,
                         role=None, avatar_color='#4f46e5'):
        """创建新账号并自动登录。"""
        try:
            user = self.user_manager.create_user(
                display_name=display_name, unit=unit, department=department,
                role=role, avatar_color=avatar_color,
            )
            # 清除旧 session，确保单活跃
            old = self.user_manager.get_current_token()
            if old:
                self.user_manager.logout(old)
            token = self.user_manager.create_session(user.id)
            return {'success': True, 'user': user.to_dict(), 'token': token}
        except ValueError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_switch_user(self, user_id):
        """切换到指定用户。"""
        try:
            user = self.user_manager.get_user(user_id)
            if not user:
                return {'success': False, 'error': '用户不存在'}
            old = self.user_manager.get_current_token()
            if old:
                self.user_manager.logout(old)
            token = self.user_manager.create_session(user_id)
            return {'success': True, 'user': user.to_dict(), 'token': token}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_update_user(self, user_id, display_name=None, unit=None,
                         department=None, role=None, avatar_color=None):
        """更新当前用户的档案。"""
        try:
            user = self.user_manager.update_user(
                user_id, display_name=display_name, unit=unit,
                department=department, role=role, avatar_color=avatar_color,
            )
            return {'success': True, 'user': user.to_dict()}
        except ValueError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_delete_user(self, user_id):
        """软删除用户（最后一个账号阻止）。"""
        try:
            remaining = [u for u in self.user_manager.list_local_users() if u.id != user_id]
            if not remaining:
                return {'success': False, 'error': '至少保留一个账号'}
            token = self.user_manager.get_current_token()
            if token:
                current = self.user_manager.get_user_by_token(token)
                if current and current.id == user_id:
                    self.user_manager.logout(token)
            self.user_manager.delete_user(user_id)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_logout(self):
        """退出当前登录。"""
        try:
            token = self.user_manager.get_current_token()
            if token:
                self.user_manager.logout(token)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_heartbeat(self):
        """更新心跳时间（前端 60s 一次调用）。"""
        try:
            token = self.user_manager.get_current_token()
            if token:
                self.user_manager.heartbeat(token)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def auth_list_local_users(self):
        """列出本机所有账号。"""
        try:
            users = self.user_manager.list_local_users()
            return {
                'success': True,
                'users': [
                    {
                        'id': u.id,
                        'displayName': u.display_name,
                        'unit': u.unit,
                        'department': u.department,
                        'role': u.role,
                        'avatarColor': u.avatar_color,
                        'lastActiveAt': u.last_active_at.isoformat() if u.last_active_at else None,
                    }
                    for u in users
                ],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def user_search(self, query):
        """按 display_name/unit/department 模糊匹配本机用户。"""
        try:
            q = (query or '').lower()
            users = self.user_manager.list_local_users()
            matched = [
                u for u in users
                if q in (u.display_name or '').lower()
                or q in (u.unit or '').lower()
                or q in (u.department or '').lower()
            ]
            return {'success': True, 'users': [u.to_dict() for u in matched]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ===== B 阶段：分类管理 API =====
    # 8 个核心 API + 1 个拖拽辅助：list / create / update / move / delete / get_path / get_descendants / task_count + add_to_task

    def _current_owner_id(self):
        """当前 owner_id = 当前用户 id。B 阶段仅 user 维度。"""
        token = self.user_manager.get_current_token()
        if not token:
            return None
        u = self.user_manager.get_user_by_token(token)
        return u.id if u else None

    def category_list(self):
        try:
            owner_id = self._current_owner_id()
            if not owner_id:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            cats = self.category_manager.list_categories('user', owner_id)
            for c in cats:
                c['taskCount'] = self.category_manager.get_task_count(c['id'])
            return {'success': True, 'categories': cats}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_create(self, name, parent_id=None, icon='📁', color='#4f46e5',
                        sort_order=None):
        try:
            owner_id = self._current_owner_id()
            if not owner_id:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            cat = self.category_manager.create_category(
                name=name, owner_type='user', owner_id=owner_id,
                parent_id=parent_id, icon=icon, color=color,
                sort_order=sort_order,
            )
            return {'success': True, 'category': cat}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_update(self, category_id, name=None, icon=None, color=None,
                        sort_order=None):
        try:
            cat = self.category_manager.update_category(
                category_id, name=name, icon=icon, color=color, sort_order=sort_order)
            return {'success': True, 'category': cat}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_move(self, category_id, new_parent_id, new_sort_order=None):
        try:
            cat = self.category_manager.move_category(
                category_id, new_parent_id, new_sort_order=new_sort_order)
            return {'success': True, 'category': cat}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_delete(self, category_id):
        try:
            affected = self.category_manager.delete_category(category_id)
            return {'success': True, 'affectedTaskCount': affected}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ===== C 阶段：协作组 / 消息 / 同步 API =====

    def _ensure_c_managers(self):
        """懒加载 C 阶段 3 个 Manager + SyncEngine。"""
        if not hasattr(self, 'group_manager') or self.group_manager is None:
            from backend.database.operations import (
                GroupManager, MessageManager, SyncManager,
            )
            self.group_manager = GroupManager(self.db)
            self.message_manager = MessageManager(self.db)
            self.sync_manager = SyncManager(self.db)
        if not hasattr(self, 'network_engine') or self.network_engine is None:
            from backend.network.sync_engine import SyncEngine
            self.network_engine = SyncEngine(self.db, self.sync_manager)

    # ===== D 阶段：节点注册 / 网络协调器 =====

    def _ensure_d_components(self):
        """懒加载 D 阶段：NodeRegistry / EventManager / NetworkCoordinator。"""
        self._ensure_c_managers()
        from backend.database.operations import NetworkNodeRegistry, NetworkEventManager
        if not hasattr(self, 'node_registry') or self.node_registry is None:
            self.node_registry = NetworkNodeRegistry(self.db)
        if not hasattr(self, 'event_manager') or self.event_manager is None:
            self.event_manager = NetworkEventManager(self.db)
        if not hasattr(self, 'network_coordinator') or self.network_coordinator is None:
            from backend.network.network_coordinator import NetworkCoordinator
            from backend.network.discovery import GroupBeacon
            uid = self._current_owner_id() or 'anonymous'
            user = self.user_manager.get_user(uid) if hasattr(self, 'user_manager') else None
            user_name = (user.display_name if user else uid) or uid

            def _groups_provider():
                if not hasattr(self, 'group_manager') or self.group_manager is None:
                    return []
                try:
                    groups = self.group_manager.list_user_groups(uid)
                except Exception:
                    return []
                return [GroupBeacon(group_id=g.id, join_code=g.join_code,
                                    is_hidden=bool(g.is_hidden)) for g in groups]

            self.network_coordinator = NetworkCoordinator(
                node_id=f'node-{uid}', user_id=uid, user_name=user_name,
                tcp_port=54722, udp_port=54721,
                db=self.db, sync_manager=self.sync_manager,
                sync_engine=self.network_engine,
                node_registry=self.node_registry, event_manager=self.event_manager,
                groups_provider=_groups_provider,
            )

    @staticmethod
    def _group_to_dict(g) -> dict:
        """Group dataclass → camelCase dict（与现有 Task 风格一致）。"""
        return {
            'id': g.id,
            'name': g.name,
            'icon': g.icon,
            'color': g.color,
            'description': g.description,
            'joinCode': g.join_code,
            'createdBy': g.created_by,
            'isHidden': g.is_hidden,
            'isDeleted': g.is_deleted,
            'createdAt': g.created_at,
            'updatedAt': g.updated_at,
        }

    @staticmethod
    def _member_to_dict(m) -> dict:
        return {
            'id': m.id,
            'groupId': m.group_id,
            'userId': m.user_id,
            'role': m.role,
            'shareTasks': m.share_tasks,
            'shareCategories': m.share_categories,
            'shareGroupTasks': m.share_group_tasks,
            'shareHistory': m.share_history,
            'joinedAt': m.joined_at,
            'lastSeenAt': m.last_seen_at,
        }

    @staticmethod
    def _message_to_dict(m) -> dict:
        import json
        att_ids = m.attachment_ids
        if isinstance(att_ids, str):
            try:
                att_ids = json.loads(att_ids or '[]')
            except json.JSONDecodeError:
                att_ids = []
        read_by = m.read_by
        if isinstance(read_by, str):
            try:
                read_by = json.loads(read_by or '{}')
            except json.JSONDecodeError:
                read_by = {}
        return {
            'id': m.id,
            'groupId': m.group_id,
            'senderId': m.sender_id,
            'content': m.content,
            'msgType': m.msg_type,
            'attachmentIds': att_ids or [],
            'replyToId': m.reply_to_id,
            'createdAt': m.created_at,
            'updatedAt': m.updated_at,
            'isDeleted': m.is_deleted,
            'readBy': read_by or {},
        }

    @staticmethod
    def _sync_log_to_dict(l) -> dict:
        return {
            'id': l.id,
            'entityType': l.entity_type,
            'entityId': l.entity_id,
            'operation': l.operation,
            'peerId': l.peer_id,
            'userId': l.user_id,
            'hasConflict': l.has_conflict,
            'detail': l.detail,
            'createdAt': l.created_at,
        }

    # ---------- 协作组 ----------

    def group_list(self):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            groups = self.group_manager.list_user_groups(uid)
            out = []
            for g in groups:
                d = self._group_to_dict(g)
                d['memberCount'] = len(self.group_manager.list_members(g.id))
                out.append(d)
            return {'success': True, 'groups': out}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_create(self, name, icon='👥', color='#4f46e5',
                     description=None, is_hidden=0):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            if not name or not name.strip():
                return {'success': False, 'error': 'NAME_REQUIRED'}
            join_code = self.group_manager.generate_join_code()
            g = self.group_manager.create_group(
                name=name.strip(), created_by=uid, join_code=join_code,
                icon=icon, color=color, description=description,
                is_hidden=int(is_hidden) if is_hidden else 0,
            )
            return {'success': True, 'group': self._group_to_dict(g)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_join(self, join_code, share_tasks=0, share_categories=0,
                   share_group_tasks=1, share_history=0):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group_by_code(join_code)
            if not g:
                return {'success': False, 'error': 'GROUP_NOT_FOUND'}
            m = self.group_manager.add_member(
                group_id=g.id, user_id=uid, role='member',
                share_tasks=int(share_tasks or 0),
                share_categories=int(share_categories or 0),
                share_group_tasks=int(share_group_tasks if share_group_tasks is not None else 1),
                share_history=int(share_history or 0),
            )
            return {
                'success': True,
                'group': self._group_to_dict(g),
                'member': self._member_to_dict(m),
            }
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_leave(self, group_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.group_manager.remove_member(group_id, uid)
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_disband(self, group_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.group_manager.soft_delete_group(group_id, by_user=uid)
            return {'success': ok, 'error': 'NOT_OWNER' if not ok else None}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_reset_code(self, group_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group(group_id)
            if not g or g.created_by != uid:
                return {'success': False, 'error': 'NOT_OWNER'}
            new_code = self.group_manager.generate_join_code()
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                cur.execute(
                    'UPDATE groups SET join_code = ?, updated_at = ? WHERE id = ?',
                    (new_code, datetime.now().isoformat(), group_id),
                )
                conn.commit()
            return {'success': True, 'joinCode': new_code}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_members(self, group_id):
        try:
            self._ensure_c_managers()
            members = self.group_manager.list_members(group_id)
            return {'success': True, 'members': [self._member_to_dict(m) for m in members]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_kick(self, group_id, user_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            g = self.group_manager.get_group(group_id)
            if not g or g.created_by != uid:
                return {'success': False, 'error': 'NOT_OWNER'}
            ok = self.group_manager.remove_member(group_id, user_id)
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def group_set_share(self, group_id, share_tasks=None, share_categories=None,
                        share_group_tasks=None, share_history=None):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            updates = {k: v for k, v in {
                'share_tasks': share_tasks, 'share_categories': share_categories,
                'share_group_tasks': share_group_tasks, 'share_history': share_history,
            }.items() if v is not None}
            if not updates:
                return {'success': False, 'error': 'NO_UPDATE'}
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                for k, v in updates.items():
                    cur.execute(
                        f'UPDATE group_members SET {k} = ? '
                        f'WHERE group_id = ? AND user_id = ?',
                        (int(v), group_id, uid),
                    )
                conn.commit()
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ---------- 消息 ----------

    def message_list(self, group_id, limit=50, before=None):
        try:
            self._ensure_c_managers()
            msgs = self.message_manager.list_messages(
                group_id, limit=int(limit or 50), before=before,
            )
            return {'success': True, 'messages': [self._message_to_dict(m) for m in msgs]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_send(self, group_id, content=None, msg_type='text',
                     attachment_ids=None, reply_to_id=None):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            m = self.message_manager.send_message(
                group_id=group_id, sender_id=uid, content=content,
                msg_type=msg_type or 'text',
                attachment_ids=list(attachment_ids) if attachment_ids else None,
                reply_to_id=reply_to_id,
            )
            return {'success': True, 'message': self._message_to_dict(m)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_mark_read(self, message_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.message_manager.mark_read(
                message_id, uid, datetime.now().isoformat(),
            )
            return {'success': ok}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def message_delete(self, message_id):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            ok = self.message_manager.soft_delete_message(message_id, by_user=uid)
            return {'success': ok, 'error': 'NOT_SENDER' if not ok else None}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ---------- 同步 ----------

    def sync_status(self):
        try:
            self._ensure_c_managers()
            uid = self._current_owner_id()
            if not uid:
                return {'success': False, 'error': 'NOT_LOGGED_IN'}
            groups = self.group_manager.list_user_groups(uid)
            return {
                'success': True,
                'status': {
                    'groupCount': len(groups),
                    'onlineCount': 0,
                    'connectedPeers': getattr(self, '_connected_peers', []),
                },
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def sync_log(self, limit=50):
        try:
            self._ensure_c_managers()
            logs = self.sync_manager.list_recent_sync_logs(limit=int(limit or 50))
            return {'success': True, 'logs': [self._sync_log_to_dict(l) for l in logs]}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_get_path(self, category_id):
        try:
            path = self.category_manager.get_category_path(category_id)
            return {'success': True, 'path': path}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_get_descendants(self, category_id):
        try:
            ids = self.category_manager.get_descendant_ids(category_id)
            return {'success': True, 'ids': ids}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ===== D 阶段：网络 / 节点 / 事件 8 个 API =====

    def network_list_peers(self, status: str = None):
        """返回节点列表（可按 status 过滤：online/syncing/offline）。"""
        try:
            self._ensure_d_components()
            nodes = self.node_registry.list_all(status=status) if status \
                else self.node_registry.list_all()
            return {
                'success': True,
                'peers': [
                    {
                        'nodeId': n.id,
                        'userId': n.user_id,
                        'userName': n.user_name,
                        'address': n.address,
                        'lastSeen': n.last_seen,
                        'lastSyncAt': n.last_sync_at,
                        'status': n.status,
                        'protocolVersion': n.protocol_version,
                    } for n in nodes
                ],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_get_local_node(self):
        """返回本机节点信息。"""
        try:
            self._ensure_d_components()
            return {'success': True, 'node': self.network_coordinator.get_local_node()}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_start_coordinator(self):
        """启动 LAN 协调器（Discovery + PeerServer）。"""
        try:
            self._ensure_d_components()
            if self.network_coordinator.is_running():
                return {'success': True, 'message': '已在运行', 'node': self.network_coordinator.get_local_node()}
            self.network_coordinator.start()
            return {
                'success': True,
                'message': '协调器已启动',
                'node': self.network_coordinator.get_local_node(),
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_stop_coordinator(self):
        """停止协调器。"""
        try:
            self._ensure_d_components()
            self.network_coordinator.stop()
            return {'success': True, 'message': '协调器已停止'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_pull_from_peer(self, peer_id: str = None):
        """对单个 peer 或所有 peer 触发增量同步。"""
        try:
            self._ensure_d_components()
            if not self.network_coordinator.is_running():
                return {'success': False, 'error': 'COORDINATOR_NOT_RUNNING'}
            if peer_id:
                ok = self.network_coordinator.resync_with_peer(peer_id)
                return {'success': ok, 'resynced': [peer_id] if ok else []}
            n = self.network_coordinator.resync_all()
            return {'success': True, 'resynced_count': n}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_broadcast_change(self, entity_type: str, entity: dict):
        """把本地变更广播至所有在线 peer。"""
        try:
            self._ensure_d_components()
            if not self.network_coordinator.is_running():
                return {'success': False, 'error': 'COORDINATOR_NOT_RUNNING'}
            self.network_coordinator.apply_local_change(entity_type, entity)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def network_resync(self):
        """对所有 peer 触发重同步（手动入口）。"""
        return self.network_pull_from_peer()

    def network_event_log(self, limit: int = 50, event_type: str = None):
        """获取网络事件日志。"""
        try:
            self._ensure_d_components()
            events = self.event_manager.list_recent(limit=limit, event_type=event_type)
            return {
                'success': True,
                'events': [
                    {
                        'id': e.id,
                        'type': e.type,
                        'peerId': e.peer_id,
                        'userId': e.user_id,
                        'detail': e.detail,
                        'createdAt': e.created_at,
                    } for e in events
                ],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_task_count(self, category_id):
        try:
            count = self.category_manager.get_task_count(category_id)
            return {'success': True, 'count': count}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def category_add_to_task(self, task_id, category_id):
        """拖拽交互：将分类 ID 添加到任务 category_ids 数组"""
        try:
            self.category_manager.add_category_to_task(task_id, category_id)
            return {'success': True}
        except ValueError as e:
            return {'success': False, 'error': str(e), 'code': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def task_get_audit_log(self, task_id):
        """获取任务的审计日志（含已删除用户的占位显示）。"""
        try:
            with self.db.get_connection() as conn:
                cur = conn.cursor()
                cur.execute('''
                    SELECT a.*, u.display_name AS user_name
                    FROM task_audit_log a
                    LEFT JOIN users u ON a.user_id = u.id AND u.is_deleted = 0
                    WHERE a.task_id = ?
                    ORDER BY a.created_at DESC
                ''', (task_id,))
                rows = cur.fetchall()
            return {
                'success': True,
                'logs': [
                    {
                        'id': r['id'],
                        'taskId': r['task_id'],
                        'userId': r['user_id'],
                        'userName': r['user_name'] or '已删除用户',
                        'action': r['action'],
                        'field': r['field'],
                        'oldValue': r['old_value'],
                        'newValue': r['new_value'],
                        'createdAt': r['created_at'],
                    }
                    for r in rows
                ],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
"""
HTTP API 服务器模块
提供 RESTful API 供外部 Agent 调用
"""

import json
import threading
from functools import wraps
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

from backend.api.todo_api import TodoApi
from backend.auth.token_manager import get_token_manager
from backend.utils.logger import backend_logger


def create_app():
    """创建 Flask 应用"""
    app = Flask(__name__)

    # 配置 CORS
    CORS(app, supports_credentials=True)

    # 创建 API 实例
    todo_api = TodoApi()

    # 注册路由
    register_routes(app, todo_api)

    return app


def require_auth(f):
    """认证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 从 Authorization 头获取 Token
        auth_header = request.headers.get('Authorization')

        if not auth_header:
            return jsonify({
                'success': False,
                'error': '缺少 Authorization 头'
            }), 401

        # 解析 Bearer Token
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            return jsonify({
                'success': False,
                'error': '无效的 Authorization 格式，应为：Bearer <token>'
            }), 401

        token = parts[1]

        # 验证 Token
        token_manager = get_token_manager()
        validation = token_manager.validate_token(token)

        if not validation['valid']:
            return jsonify({
                'success': False,
                'error': validation['error']
            }), 401

        return f(*args, **kwargs)

    return decorated_function


def register_routes(app, todo_api):
    """注册 API 路由"""

    # ==================== 任务相关 API ====================

    @app.route('/api/v1/todos', methods=['POST'])
    @require_auth
    def create_todo():
        """创建任务"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': '请求体不能为空'}), 400

            # 构建任务数据
            task_data = {
                'title': data.get('title', ''),
                'description': data.get('description', ''),
                'priority': data.get('priority', 'none'),
                'categoryId': data.get('categoryId'),
                'dueDate': data.get('dueDate'),
                'tags': data.get('tags', [])
            }

            result = todo_api.add_todo(task_data)

            if result['success']:
                return jsonify(result), 201
            else:
                return jsonify(result), 400

        except Exception as e:
            backend_logger.error(f"创建任务失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/todos', methods=['GET'])
    @require_auth
    def get_todos():
        """获取任务列表"""
        try:
            # 获取查询参数
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 20))
            category_id = request.args.get('category_id', 'all')
            status = request.args.get('status', 'all')
            priority = request.args.get('priority', 'all')
            due_date_filter = request.args.get('due_date_filter', 'all')
            search_query = request.args.get('search_query', '')

            result = todo_api.get_todos(
                page=page,
                page_size=page_size,
                category_id=category_id,
                status=status,
                priority=priority,
                due_date_filter=due_date_filter,
                search_query=search_query
            )

            return jsonify(result)

        except Exception as e:
            backend_logger.error(f"获取任务列表失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/todos/<task_id>', methods=['GET'])
    @require_auth
    def get_todo(task_id):
        """获取单个任务"""
        try:
            result = todo_api.get_todo(task_id)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"获取任务失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/todos/<task_id>', methods=['PUT'])
    @require_auth
    def update_todo(task_id):
        """更新任务"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': '请求体不能为空'}), 400

            result = todo_api.update_todo(task_id, data)

            if result['success']:
                return jsonify(result)
            else:
                return jsonify(result), 400

        except Exception as e:
            backend_logger.error(f"更新任务失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/todos/<task_id>', methods=['DELETE'])
    @require_auth
    def delete_todo(task_id):
        """删除任务"""
        try:
            delete_all = request.args.get('delete_all', 'false').lower() == 'true'
            result = todo_api.delete_todo(task_id, delete_all)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"删除任务失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/todos/<task_id>/toggle', methods=['POST'])
    @require_auth
    def toggle_todo(task_id):
        """切换任务完成状态"""
        try:
            result = todo_api.toggle_todo(task_id)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"切换任务状态失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    # ==================== 分类相关 API ====================

    @app.route('/api/v1/categories', methods=['GET'])
    @require_auth
    def get_categories():
        """获取分类列表"""
        try:
            result = todo_api.get_categories()
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"获取分类列表失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/categories', methods=['POST'])
    @require_auth
    def create_category():
        """创建分类"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': '请求体不能为空'}), 400

            category_data = {
                'name': data.get('name', ''),
                'color': data.get('color', '#007bff')
            }

            result = todo_api.add_category(category_data)

            if result['success']:
                return jsonify(result), 201
            else:
                return jsonify(result), 400

        except Exception as e:
            backend_logger.error(f"创建分类失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/categories/<category_id>', methods=['PUT'])
    @require_auth
    def update_category(category_id):
        """更新分类"""
        try:
            data = request.get_json()
            if not data:
                return jsonify({'success': False, 'error': '请求体不能为空'}), 400

            result = todo_api.update_category(category_id, data)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"更新分类失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/categories/<category_id>', methods=['DELETE'])
    @require_auth
    def delete_category(category_id):
        """删除分类"""
        try:
            result = todo_api.delete_category(category_id)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"删除分类失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    # ==================== 统计相关 API ====================

    @app.route('/api/v1/stats', methods=['GET'])
    @require_auth
    def get_stats():
        """获取统计信息"""
        try:
            dimension = request.args.get('dimension', 'all')
            result = todo_api.get_stats(dimension)
            return jsonify(result)
        except Exception as e:
            backend_logger.error(f"获取统计信息失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    # ==================== Token 管理 API ====================

    @app.route('/api/v1/token/generate', methods=['POST'])
    @require_auth
    def generate_token():
        """生成新的 API Token（需要已有 Token）"""
        try:
            data = request.get_json() or {}
            expires_days = int(data.get('expires_days', 365))

            token_manager = get_token_manager()
            token = token_manager.generate_token(expires_days)

            return jsonify({
                'success': True,
                'token': token,
                'message': '请妥善保管此 Token，这是唯一一次显示明文'
            })
        except Exception as e:
            backend_logger.error(f"生成 Token 失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/token/revoke', methods=['POST'])
    @require_auth
    def revoke_token():
        """撤销当前 Token"""
        try:
            token_manager = get_token_manager()
            result = token_manager.revoke_token()

            return jsonify({
                'success': result,
                'message': 'Token 已撤销' if result else '撤销失败'
            })
        except Exception as e:
            backend_logger.error(f"撤销 Token 失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/v1/token/info', methods=['GET'])
    @require_auth
    def get_token_info():
        """获取 Token 信息"""
        try:
            token_manager = get_token_manager()
            info = token_manager.get_api_access_status()

            return jsonify({
                'success': True,
                'info': info
            })
        except Exception as e:
            backend_logger.error(f"获取 Token 信息失败：{e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    # ==================== 健康检查 API（无需认证） ====================

    @app.route('/api/health', methods=['GET'])
    def health_check():
        """健康检查接口（无需认证）"""
        return jsonify({
            'status': 'ok',
            'message': 'TodoList API Server is running'
        })

    # ==================== 错误处理 ====================

    @app.errorhandler(404)
    def not_found(error):
        return jsonify({
            'success': False,
            'error': '接口不存在'
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({
            'success': False,
            'error': '服务器内部错误'
        }), 500

    @app.errorhandler(405)
    def method_not_allowed(error):
        return jsonify({
            'success': False,
            'error': '方法不允许'
        }), 405


# 全局服务器实例
_server = None
_server_thread = None


class HTTPServer:
    """HTTP 服务器封装类"""

    def __init__(self, host='127.0.0.1', port=8765):
        self.host = host
        self.port = port
        self.app = create_app()
        self._server = None
        self._thread = None
        self._running = False

    def start(self) -> tuple[bool, str]:
        """启动服务器"""
        try:
            if self._running:
                return True, f'服务器已在 http://{self.host}:{self.port} 运行'

            self._running = True

            # 在新线程中启动 Flask 服务器
            def run_server():
                # 使用 Werkzeug 的生产服务器
                self._server = self.app.run(
                    host=self.host,
                    port=self.port,
                    threaded=True,
                    use_reloader=False,
                    debug=False
                )

            self._thread = threading.Thread(target=run_server, daemon=True)
            self._thread.start()

            # 等待服务器启动
            import time
            time.sleep(0.5)

            backend_logger.info(f"HTTP API 服务器已启动：http://{self.host}:{self.port}")
            return True, f'服务器已启动：http://{self.host}:{self.port}'

        except Exception as e:
            backend_logger.error(f"启动 HTTP 服务器失败：{e}")
            self._running = False
            return False, str(e)

    def stop(self) -> tuple[bool, str]:
        """停止服务器"""
        try:
            if not self._running:
                return True, '服务器未运行'

            self._running = False

            # Flask 开发服务器没有优雅的停止方法
            # 由于是 daemon 线程，会在主进程退出时自动停止

            backend_logger.info("HTTP API 服务器已停止")
            return True, '服务器已停止'

        except Exception as e:
            backend_logger.error(f"停止 HTTP 服务器失败：{e}")
            return False, str(e)

    def get_status(self) -> dict:
        """获取服务器状态"""
        return {
            'running': self._running,
            'host': self.host,
            'port': self.port,
            'url': f'http://{self.host}:{self.port}' if self._running else None
        }


# 全局服务器实例
_http_server: HTTPServer = None


def get_http_server(host='127.0.0.1', port=8765) -> HTTPServer:
    """获取全局 HTTP 服务器实例"""
    global _http_server
    if _http_server is None:
        _http_server = HTTPServer(host, port)
    return _http_server


def start_http_server(host='127.0.0.1', port=8765) -> tuple[bool, str]:
    """启动 HTTP 服务器"""
    server = get_http_server(host, port)
    return server.start()


def stop_http_server() -> tuple[bool, str]:
    """停止 HTTP 服务器"""
    global _http_server
    if _http_server:
        return _http_server.stop()
    return True, '服务器未运行'


def get_http_server_status() -> dict:
    """获取 HTTP 服务器状态"""
    global _http_server
    if _http_server:
        return _http_server.get_status()
    return {'running': False, 'host': None, 'port': None, 'url': None}

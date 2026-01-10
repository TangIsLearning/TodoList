# #!/usr/bin/env python3
# """
# 后端功能测试
# """
#
# import sys
# import os
# import unittest
# from pathlib import Path
#
# # 添加后端目录到Python路径
# current_dir = Path(__file__).parent.parent
# backend_dir = current_dir / 'backend'
# sys.path.insert(0, str(backend_dir))
#
# from database.operations import TodoDatabase
# from database.models import Task, Category
#
#
# class TestTodoDatabase(unittest.TestCase):
#     """测试数据库操作"""
#
#     def setUp(self):
#         """测试前准备"""
#         # 使用测试数据库
#         self.test_db_path = current_dir / 'test_todo.db'
#         self.db = TodoDatabase()
#         # 临时修改数据库路径用于测试
#         self.db.db_path = self.test_db_path
#         self.db.init_database()
#
#     def tearDown(self):
#         """测试后清理"""
#         # 删除测试数据库文件
#         if self.test_db_path.exists():
#             self.test_db_path.unlink()
#
#     def test_add_task(self):
#         """测试添加任务"""
#         task_data = {
#             'title': '测试任务',
#             'description': '这是一个测试任务',
#             'priority': 'high'
#         }
#
#         result = self.db.add_task(task_data)
#
#         self.assertIn('id', result)
#         self.assertEqual(result['title'], '测试任务')
#         self.assertEqual(result['description'], '这是一个测试任务')
#         self.assertEqual(result['priority'], 'high')
#         self.assertFalse(result['completed'])
#
#     def test_get_all_tasks(self):
#         """测试获取所有任务"""
#         # 添加测试任务
#         task_data = {
#             'title': '测试任务1',
#             'priority': 'high'
#         }
#         self.db.add_task(task_data)
#
#         task_data2 = {
#             'title': '测试任务2',
#             'priority': 'low'
#         }
#         self.db.add_task(task_data2)
#
#         tasks = self.db.get_all_tasks()
#
#         self.assertEqual(len(tasks), 2)
#         self.assertEqual(tasks[0]['title'], '测试任务1')
#         self.assertEqual(tasks[1]['title'], '测试任务2')
#
#     def test_update_task(self):
#         """测试更新任务"""
#         # 添加任务
#         task_data = {
#             'title': '原始任务',
#             'priority': 'none'
#         }
#         added_task = self.db.add_task(task_data)
#         task_id = added_task['id']
#
#         # 更新任务
#         updated_data = {
#             'title': '更新后的任务',
#             'description': '添加了描述',
#             'priority': 'high',
#             'completed': True
#         }
#
#         result = self.db.update_task(task_id, updated_data)
#
#         self.assertEqual(result['title'], '更新后的任务')
#         self.assertEqual(result['description'], '添加了描述')
#         self.assertEqual(result['priority'], 'high')
#         self.assertTrue(result['completed'])
#
#     def test_delete_task(self):
#         """测试删除任务"""
#         # 添加任务
#         task_data = {
#             'title': '待删除任务',
#             'priority': 'none'
#         }
#         added_task = self.db.add_task(task_data)
#         task_id = added_task['id']
#
#         # 删除任务
#         result = self.db.delete_task(task_id)
#
#         self.assertTrue(result['success'])
#         self.assertEqual(result['deleted_id'], task_id)
#
#         # 验证任务已被删除
#         tasks = self.db.get_all_tasks()
#         self.assertEqual(len(tasks), 0)
#
#     def test_add_category(self):
#         """测试添加分类"""
#         category_data = {
#             'name': '工作',
#             'color': '#ff0000'
#         }
#
#         result = self.db.add_category(category_data)
#
#         self.assertIn('id', result)
#         self.assertEqual(result['name'], '工作')
#         self.assertEqual(result['color'], '#ff0000')
#
#     def test_get_all_categories(self):
#         """测试获取所有分类"""
#         # 添加测试分类
#         category_data1 = {'name': '工作', 'color': '#ff0000'}
#         self.db.add_category(category_data1)
#
#         category_data2 = {'name': '学习', 'color': '#00ff00'}
#         self.db.add_category(category_data2)
#
#         categories = self.db.get_all_categories()
#
#         self.assertEqual(len(categories), 2)
#         self.assertEqual(categories[0]['name'], '工作')
#         self.assertEqual(categories[1]['name'], '学习')
#
#
# class TestTaskModel(unittest.TestCase):
#     """测试任务模型"""
#
#     def test_task_creation(self):
#         """测试任务创建"""
#         task = Task(
#             title='测试任务',
#             description='测试描述',
#             priority='high'
#         )
#
#         self.assertIsNotNone(task.id)
#         self.assertEqual(task.title, '测试任务')
#         self.assertEqual(task.description, '测试描述')
#         self.assertEqual(task.priority, 'high')
#         self.assertFalse(task.completed)
#
#     def test_task_to_dict(self):
#         """测试任务转换为字典"""
#         task = Task(
#             title='测试任务',
#             priority='medium'
#         )
#
#         task_dict = task.to_dict()
#
#         self.assertIn('id', task_dict)
#         self.assertEqual(task_dict['title'], '测试任务')
#         self.assertEqual(task_dict['priority'], 'medium')
#         self.assertFalse(task_dict['completed'])
#
#     def test_task_from_dict(self):
#         """测试从字典创建任务"""
#         data = {
#             'title': '字典任务',
#             'description': '字典描述',
#             'priority': 'low',
#             'completed': True
#         }
#
#         task = Task.from_dict(data)
#
#         self.assertEqual(task.title, '字典任务')
#         self.assertEqual(task.description, '字典描述')
#         self.assertEqual(task.priority, 'low')
#         self.assertTrue(task.completed)
#
#
# class TestCategoryModel(unittest.TestCase):
#     """测试分类模型"""
#
#     def test_category_creation(self):
#         """测试分类创建"""
#         category = Category(
#             name='测试分类',
#             color='#ff0000'
#         )
#
#         self.assertIsNotNone(category.id)
#         self.assertEqual(category.name, '测试分类')
#         self.assertEqual(category.color, '#ff0000')
#
#     def test_category_to_dict(self):
#         """测试分类转换为字典"""
#         category = Category(
#             name='测试分类',
#             color='#00ff00'
#         )
#
#         category_dict = category.to_dict()
#
#         self.assertIn('id', category_dict)
#         self.assertEqual(category_dict['name'], '测试分类')
#         self.assertEqual(category_dict['color'], '#00ff00')
#
#
# if __name__ == '__main__':
#     # 运行测试
#     print("开始运行后端测试...")
#     unittest.main(verbosity=2)
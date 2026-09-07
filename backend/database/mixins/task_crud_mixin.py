import sqlite3
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Union
from backend.database.models import Task

class TaskCrudMixin:

    def add_task(self, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """添加新任务"""
        task = Task(
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None,
            is_recurring=task_data.get('isRecurring', False),
            recurrence_type=task_data.get('recurrenceType'),
            recurrence_interval=task_data.get('recurrenceInterval', 1),
            recurrence_count=task_data.get('recurrenceCount'),
            parent_task_id=task_data.get('parentTaskId')
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO tasks (id, title, description, completed, priority, 
                              category_id, due_date, is_recurring, recurrence_type, 
                              recurrence_interval, recurrence_count, parent_task_id, 
                              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            task.id, task.title, task.description, task.completed, task.priority,
            task.category_id, task.due_date.isoformat() if task.due_date else None,
            task.is_recurring, task.recurrence_type, task.recurrence_interval,
            task.recurrence_count, task.parent_task_id,
            task.created_at.isoformat(), task.updated_at.isoformat()
        ))

        conn.commit()
        conn.close()

        # 处理标签
        tags = task_data.get('tags', [])
        if tags:
            self.update_task_tags(task.id, tags)

        return task.to_dict()

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        """获取所有任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 明确指定字段顺序，避免依赖字段位置
        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks 
            ORDER BY 
                CASE 
                    WHEN due_date IS NOT NULL THEN 1 
                    ELSE 2 
                END,
                due_date ASC,
                CASE priority 
                    WHEN 'high' THEN 1 
                    WHEN 'medium' THEN 2 
                    WHEN 'low' THEN 3 
                    ELSE 4 
                END,
                created_at DESC
        ''')

        rows = cursor.fetchall()
        conn.close()

        tasks = []
        for row in rows:
            task_dict = {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'tags': self.get_task_tags(row[0])  # 添加标签信息
            }
            tasks.append(task_dict)

        return tasks

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取单个任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 明确指定字段顺序
        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks WHERE id = ?
        ''', (task_id,))
        row = cursor.fetchone()

        if not row:
            conn.close()
            return None

        task_dict = {
            'id': row[0],
            'title': row[1],
            'description': row[2],
            'completed': bool(row[3]),
            'priority': row[4],
            'categoryId': row[5],
            'dueDate': row[6],
            'isRecurring': bool(row[7]) if row[7] is not None else False,
            'recurrenceType': row[8],
            'recurrenceInterval': row[9] if row[9] is not None else 1,
            'recurrenceCount': row[10],
            'parentTaskId': row[11],
            'createdAt': row[12],
            'updatedAt': row[13],
            'tags': self.get_task_tags(task_id)  # 添加标签信息
        }

        conn.close()
        return task_dict

    def update_task(self, task_id: str, task_data: Dict[str, Any],
                    is_update_task_tags: bool = True) -> Dict[str, Any]:
        """更新任务"""
        task = Task(
            title=task_data.get('title', ''),
            description=task_data.get('description', ''),
            completed=task_data.get('completed', False),
            priority=task_data.get('priority', 'none'),
            category_id=task_data.get('categoryId'),
            due_date=datetime.fromisoformat(task_data['dueDate']) if task_data.get('dueDate') else None
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE tasks 
            SET title = ?, description = ?, completed = ?, priority = ?,
                category_id = ?, due_date = ?, updated_at = ?
            WHERE id = ?
        ''', (
            task.title, task.description, task.completed, task.priority,
            task.category_id, task.due_date.isoformat() if task.due_date else None,
            datetime.now().isoformat(), task_id
        ))

        conn.commit()
        conn.close()

        # 处理标签
        if is_update_task_tags:
            tags = task_data.get('tags', [])
            self.update_task_tags(task_id, tags)

        return task.to_dict()

    def update_task_due_date(self, task_id: str, due_date: str) -> Dict[str, Any]:
        """更新任务截止时间"""
        task = Task(
            due_date=datetime.fromisoformat(due_date)
        )

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?
        ''', (
            due_date, datetime.now().isoformat(), task_id
        ))

        conn.commit()
        conn.close()

        return task.to_dict()

    def delete_task(self, task_id: str) -> None:
        """删除任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 1. 如果任务有子任务（作为父任务），删除所有子关联（子任务保留）
        self.delete_relations_by_parent(task_id)

        # 2. 如果任务有父任务（作为子任务），删除自身关联
        self.delete_relation_by_children(task_id)

        cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        cursor.execute('DELETE FROM task_tags WHERE task_id = ?', (task_id,))

        conn.commit()
        conn.close()

        # 在标签未关联任何任务时，同步删除标签
        self.check_delete_tag()

    def get_tasks_paginated(self, page: int = 1, page_size: int = 10,
                            category_id: Optional[str] = None, status: Optional[str] = None,
                            priority: Optional[str] = None, due_date_filter: Optional[str] = None,
                            year: Optional[int] = None, month: Optional[int] = None,
                            search_query: Optional[str] = None, custom_date: Optional[str] = None,
                            sync_start_time: Optional[Union[str, date]] = None,
                            sync_end_time: Optional[Union[str, date]] = None,
                            custom_start_date: Optional[str] = None,
                            custom_end_date: Optional[str] = None) -> Dict[str, Any]:
        """分页查询任务，支持多种筛选条件

        参数:
            page: 页码，从1开始
            page_size: 每页数量
            category_id: 分类ID筛选
            status: 状态筛选
            priority: 优先级筛选
            due_date_filter: 日期筛选
            year: 年份筛选
            month: 月份筛选
            search_query: 搜索关键词，多关键词请用分号分隔（如 "工作;紧急"）
            custom_date: 自定义日期筛选（用于日历点击）
            sync_start_time: 自定义日期筛选（数据同步开始时间）
            sync_end_time: 自定义日期筛选（数据同步结束时间）
            custom_start_date: 自定义日期筛选（数据同步开始时间）
            custom_end_date: 自定义日期筛选（数据同步结束时间）

        返回:
            包含 tasks, total, page, page_size, total_pages 的字典
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # 构建WHERE条件
        where_clauses = []
        params = []

        # 自定义日期筛选（优先级最高，用于日历视图点击）
        if custom_date:
            where_clauses.append('date(due_date) = ?')
            params.append(custom_date)
        if custom_start_date and custom_end_date:
            where_clauses.append('date(due_date) BETWEEN ? AND ?')
            params.append(custom_start_date)
            params.append(custom_end_date)

        # 分类筛选
        if not custom_date:  # 如果有自定义日期筛选，则忽略其他日期筛选
            if category_id == 'uncategorized':
                where_clauses.append('(category_id IS NULL OR category_id = "")')
            elif category_id and category_id != 'all':
                where_clauses.append('category_id = ?')
                params.append(category_id)

        # 优先级筛选
        if priority and priority != 'all':
            where_clauses.append('priority = ?')
            params.append(priority)

        # 状态筛选
        today = datetime.now().date()
        if status == 'completed':
            where_clauses.append('completed = 1')
        elif status == 'uncompleted':
            where_clauses.append('completed = 0')
        elif status == 'pending':
            # 未完成且未逾期
            where_clauses.append('completed = 0')
            where_clauses.append('(due_date IS NULL OR date(due_date) >= ?)')
            params.append(today.isoformat())
        elif status == 'overdue':
            # 未完成且已逾期
            where_clauses.append('completed = 0')
            where_clauses.append('due_date IS NOT NULL')
            where_clauses.append('date(due_date) < ?')
            params.append(today.isoformat())

        # 日期筛选
        if due_date_filter and not custom_date:
            if due_date_filter == 'today':
                where_clauses.append('date(due_date) = ?')
                params.append(today.isoformat())
            elif due_date_filter == 'tomorrow':
                tomorrow = today.replace(day=today.day + 1) if today.day < 28 else (
                    today.replace(day=1, month=today.month + 1) if today.month < 12 else today.replace(
                        year=today.year + 1, month=1, day=1))
                where_clauses.append('date(due_date) = ?')
                params.append(tomorrow.isoformat())
            elif due_date_filter == 'week':
                week_start = today - timedelta(days=today.weekday())
                week_end = today.replace(day=week_start.day + 7) if today.day <= 21 else today.replace(day=28)
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(week_start.isoformat())
                params.append(week_end.isoformat())
            elif due_date_filter == 'month':
                month_start = today.replace(month=today.month, day=1)
                if today.month == 12:
                    next_month = today.replace(year=today.year + 1, month=1, day=1)
                else:
                    next_month = month_start.replace(month=month_start.month + 1)
                month_end = next_month - timedelta(days=1)
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) BETWEEN ? AND ?')
                params.append(month_start.isoformat())
                params.append(month_end.isoformat())
            elif due_date_filter == 'sync':  # 仅同步
                where_clauses.append('due_date IS NOT NULL')
                where_clauses.append('date(due_date) >= ?')
                params.append(today.isoformat())
                where_clauses.append('date(created_at) BETWEEN ? AND ?')
                params.append(sync_start_time.isoformat())
                params.append(sync_end_time.isoformat())
            elif due_date_filter == 'no-due-date':
                where_clauses.append('(due_date IS NULL OR due_date = "")')

        # 年月筛选
        if year and not custom_date:
            where_clauses.append('strftime("%Y", date(created_at)) = ?')
            params.append(str(year))

        if month and not custom_date:
            where_clauses.append('strftime("%m", date(created_at)) = ?')
            params.append(str(month).zfill(2))

        # 搜索关键词
        if search_query:
            search_query = search_query.strip(';')
            if search_query:
                # 检查是否包含分号，支持多关键词
                keywords = [kw.strip() for kw in search_query.split(';') if kw.strip()]
                keyword_conditions = []
                for kw in keywords:
                    if kw.startswith('#'):
                        # 标签搜索
                        tag_name = kw[1:]
                        condition = '''
                                            id IN (SELECT task_id FROM task_tags WHERE tag_id IN (
                                                SELECT id FROM tags WHERE name LIKE ?
                                            ))
                                        '''
                        keyword_conditions.append(condition)
                        params.append(f'%{tag_name}%')
                    else:
                        # 普通文本搜索（标题、描述、标签）
                        condition = '''
                                            (title LIKE ? OR description LIKE ? OR id IN (
                                                SELECT task_id FROM task_tags WHERE tag_id IN (
                                                    SELECT id FROM tags WHERE name LIKE ?
                                                )
                                            ))
                                        '''
                        keyword_conditions.append(condition)
                        params.extend([f'%{kw}%', f'%{kw}%', f'%{kw}%'])
                # 将所有关键词条件用 OR 连接，并作为一个整体条件
                combined_condition = '(' + ' OR '.join(keyword_conditions) + ')'
                where_clauses.append(combined_condition)

        # 构建完整的WHERE子句
        where_sql = ' AND '.join(where_clauses) if where_clauses else '1=1'

        # 查询总数
        count_sql = f'SELECT COUNT(*) FROM tasks WHERE {where_sql}'
        cursor.execute(count_sql, params)
        total = cursor.fetchone()[0]

        # 计算总页数
        total_pages = (total + page_size - 1) // page_size if total > 0 else 0

        # 查询分页数据
        offset = (page - 1) * page_size
        data_sql = f'''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks 
            WHERE {where_sql}
            ORDER BY 
                completed ASC,
                CASE 
                    WHEN due_date IS NOT NULL THEN 1 
                    ELSE 2 
                END,
                due_date ASC,
                CASE priority 
                    WHEN 'high' THEN 1 
                    WHEN 'medium' THEN 2 
                    WHEN 'low' THEN 3 
                    ELSE 4 
                END,
                created_at DESC
            LIMIT ? OFFSET ?
        '''

        cursor.execute(data_sql, params + [page_size, offset])
        rows = cursor.fetchall()

        tasks = []
        for row in rows:
            task_dict = {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'tags': self.get_task_tags(row[0])  # 添加标签信息
            }
            tasks.append(task_dict)

        conn.close()

        return {
            'tasks': tasks,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages
        }

    def get_tasks_by_ids(self, task_ids: List[str]) -> List[Dict[str, Any]]:
        """
        根据任务ID列表批量获取任务完整信息（含标签）
        :param task_ids: 任务ID列表
        :return: 任务字典列表（顺序与传入ID无关）
        """
        if not task_ids:
            return []
        ids = list(set([tid for tid in task_ids if tid]))
        if not ids:
            return []

        placeholders = ','.join(['?'] * len(ids))
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(f'''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks WHERE id IN ({placeholders})
        ''', ids)
        rows = cursor.fetchall()
        conn.close()

        tasks = []
        for row in rows:
            task_dict = {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'tags': self.get_task_tags(row[0])
            }
            tasks.append(task_dict)
        return tasks

    def find_task_by_title_exact(self, title: str) -> Optional[Dict[str, Any]]:
        """通过任务标题精确查找任务（不区分大小写）"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            SELECT id, title, description, completed, priority, category_id, due_date,
                   is_recurring, recurrence_type, recurrence_interval, recurrence_count, 
                   parent_task_id, created_at, updated_at
            FROM tasks 
            WHERE title = ? COLLATE NOCASE
            LIMIT 1
        ''', (title,))

        row = cursor.fetchone()
        conn.close()

        if row:
            return {
                'id': row[0],
                'title': row[1],
                'description': row[2],
                'completed': bool(row[3]),
                'priority': row[4],
                'categoryId': row[5],
                'dueDate': row[6],
                'isRecurring': bool(row[7]) if row[7] is not None else False,
                'recurrenceType': row[8],
                'recurrenceInterval': row[9] if row[9] is not None else 1,
                'recurrenceCount': row[10],
                'parentTaskId': row[11],
                'createdAt': row[12],
                'updatedAt': row[13],
                'tags': self.get_task_tags(row[0])
            }
        return None

    def search_tasks_with_subtasks(self, keyword: str = '', limit: int = 5) -> List[Dict[str, Any]]:
        """搜索具有子任务的父任务（按标题模糊匹配，不区分大小写），返回前 limit 条。

        通过 task_relations 表 JOIN tasks，找出作为父任务（main_task_id）且标题匹配的任务，
        并统计其子任务数量。关键字中的 % 与 _ 会被转义为字面量，不会被当作 LIKE 通配符。

        返回:
            [{id, title, priority, dueDate, completed, subtaskCount}, ...]
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        base_sql = '''
            SELECT t.id, t.title, t.priority, t.due_date, t.completed, COUNT(r.sub_task_id) AS sub_count
            FROM task_relations r
            JOIN tasks t ON t.id = r.main_task_id
        '''
        if keyword:
            # 转义 LIKE 通配符，避免关键字中的 %/_ 被当通配符
            esc = '\\'
            escaped = keyword.replace(esc, esc + esc).replace('%', esc + '%').replace('_', esc + '_')
            like = f'%{escaped}%'
            cursor.execute(
                base_sql +
                ' WHERE t.title COLLATE NOCASE LIKE ? ESCAPE ?'
                ' GROUP BY r.main_task_id'
                ' ORDER BY sub_count DESC, t.updated_at DESC'
                ' LIMIT ?',
                (like, esc, limit)
            )
        else:
            cursor.execute(
                base_sql +
                ' GROUP BY r.main_task_id'
                ' ORDER BY sub_count DESC, t.updated_at DESC'
                ' LIMIT ?',
                (limit,)
            )
        rows = cursor.fetchall()
        conn.close()
        return [{
            'id': r[0],
            'title': r[1],
            'priority': r[2],
            'dueDate': r[3],
            'completed': bool(r[4]),
            'subtaskCount': r[5]
        } for r in rows]

    def create_recurring_tasks(self, parent_task_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """创建周期性任务系列"""
        from dateutil.relativedelta import relativedelta

        tasks = []
        parent_task = Task(
            title=parent_task_data.get('title', ''),
            description=parent_task_data.get('description', ''),
            completed=False,
            priority=parent_task_data.get('priority', 'none'),
            category_id=parent_task_data.get('categoryId'),
            due_date=datetime.fromisoformat(parent_task_data['dueDate']) if parent_task_data.get('dueDate') else None,
            is_recurring=True,
            recurrence_type=parent_task_data.get('recurrenceType'),
            recurrence_interval=parent_task_data.get('recurrenceInterval', 1),
            recurrence_count=parent_task_data.get('recurrenceCount'),
            parent_task_id=None
        )

        # 创建父任务
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO tasks (id, title, description, completed, priority, 
                              category_id, due_date, is_recurring, recurrence_type, 
                              recurrence_interval, recurrence_count, parent_task_id, 
                              created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            parent_task.id, parent_task.title, parent_task.description, parent_task.completed,
            parent_task.priority, parent_task.category_id,
            parent_task.due_date.isoformat() if parent_task.due_date else None,
            parent_task.is_recurring, parent_task.recurrence_type, parent_task.recurrence_interval,
            parent_task.recurrence_count, parent_task.parent_task_id,
            parent_task.created_at.isoformat(), parent_task.updated_at.isoformat()
        ))

        tasks.append(parent_task.to_dict())

        # 创建子任务
        if parent_task.due_date and parent_task.recurrence_type:
            current_date = parent_task.due_date
            count = 1

            while True:
                # 计算下一个任务日期
                if parent_task.recurrence_type == 'yearly':
                    next_date = current_date + relativedelta(years=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'monthly':
                    next_date = current_date + relativedelta(months=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'weekly':
                    next_date = current_date + relativedelta(weeks=parent_task.recurrence_interval)
                elif parent_task.recurrence_type == 'daily':
                    next_date = current_date + relativedelta(days=parent_task.recurrence_interval)
                else:
                    break

                count += 1

                # 检查是否超过循环次数
                if parent_task.recurrence_count and count > parent_task.recurrence_count:
                    break

                # 创建子任务
                child_task = Task(
                    title=parent_task.title,
                    description=parent_task.description,
                    completed=False,
                    priority=parent_task.priority,
                    category_id=parent_task.category_id,
                    due_date=next_date,
                    is_recurring=False,
                    parent_task_id=parent_task.id
                )

                cursor.execute('''
                    INSERT INTO tasks (id, title, description, completed, priority, 
                                      category_id, due_date, is_recurring, recurrence_type, 
                                      recurrence_interval, recurrence_count, parent_task_id, 
                                      created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    child_task.id, child_task.title, child_task.description, child_task.completed,
                    child_task.priority, child_task.category_id,
                    child_task.due_date.isoformat() if child_task.due_date else None,
                    child_task.is_recurring, child_task.recurrence_type, child_task.recurrence_interval,
                    child_task.recurrence_count, child_task.parent_task_id,
                    child_task.created_at.isoformat(), child_task.updated_at.isoformat()
                ))

                tasks.append(child_task.to_dict())
                current_date = next_date

        conn.commit()
        conn.close()

        return tasks

    def delete_recurring_task(self, task_id: str, delete_all: bool = False) -> None:
        """删除周期性任务"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        if delete_all:
            # 删除整个周期的任务
            # 先获取任务信息
            cursor.execute('SELECT parent_task_id, id FROM tasks WHERE id = ?', (task_id,))
            task_info = cursor.fetchone()

            if task_info:
                parent_id, current_id = task_info

                if parent_id:
                    # 如果是子任务，获取父任务ID，然后删除所有子任务
                    cursor.execute('DELETE FROM tasks WHERE parent_task_id = ?', (parent_id,))
                    cursor.execute('DELETE FROM tasks WHERE id = ?', (parent_id,))
                else:
                    # 如果是父任务，删除所有子任务和父任务
                    cursor.execute('DELETE FROM tasks WHERE parent_task_id = ?', (task_id,))
                    cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        else:
            # 只删除单个任务
            cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))

        conn.commit()
        conn.close()
"""
TodoList应用的数据库操作
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from backend.database import schema
from backend.database.mixins import AllCrudMixins
from backend.database.utils import get_app_data_file

# 连接等待锁的超时时间（秒）。桌面端存在后台提醒线程与主线程并发访问，
# 设置超时可避免偶发的 "database is locked"。
_CONNECT_TIMEOUT = 15.0


class TodoDatabase(AllCrudMixins):
    """Todo数据库操作类"""

    def __init__(self) -> None:
        db_file = get_app_data_file()

        # 确保父目录存在
        db_file.parent.mkdir(parents=True, exist_ok=True)

        # 数据库文件路径
        self.db_path = str(db_file) if isinstance(db_file, Path) else db_file
        self.init_database()

    # ------------------------------------------------------------------ #
    # 连接与事务
    #
    # 全库唯一入口：业务代码不再自行 sqlite3.connect，避免连接泄漏、
    # 忘记提交，以及外键约束未开启等问题。
    # ------------------------------------------------------------------ #

    def _connect(self) -> sqlite3.Connection:
        """建立连接并应用统一的 PRAGMA。"""
        conn = sqlite3.connect(self.db_path, timeout=_CONNECT_TIMEOUT)
        # 统一的 PRAGMA：
        # - foreign_keys：启用外键级联删除（默认关闭，导致 ON DELETE CASCADE 失效）
        # - journal_mode=WAL：读写并发，避免后台线程轮询与主线程互相阻塞
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        # 以列名访问结果，彻底摆脱 row[0] 这类位置依赖
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """写事务上下文：正常结束提交，异常回滚，无论如何关闭连接。

        用于所有 INSERT / UPDATE / DELETE 场景。
        """
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @contextmanager
    def query(self) -> Iterator[sqlite3.Connection]:
        """只读查询上下文：不做提交，始终关闭连接。"""
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    def get_connection(self) -> sqlite3.Connection:
        """获取数据库连接（已应用统一 PRAGMA）。

        仅用于需要长期持有连接的特殊场景，调用方需自行关闭；
        常规读写请优先使用 tx() / query()。
        """
        return self._connect()

    def init_database(self) -> None:
        """初始化数据库表结构与索引"""
        with self.tx() as conn:
            cursor = conn.cursor()
            schema.initialize(cursor)

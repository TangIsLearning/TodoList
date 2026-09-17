"""
TodoList应用的数据库操作
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from backend.database import schema
from backend.database.mixins import AllCrudMixins
from backend.database.utils import get_app_data_file

# 连接等待锁的超时时间（秒）。桌面端存在后台提醒线程与主线程并发访问，
# 设置超时可避免偶发的 "database is locked"。
_CONNECT_TIMEOUT = 15.0


class TodoDatabase(AllCrudMixins):
    """Todo数据库操作类"""

    def __init__(self) -> None:
        # 路径不在构造时快照，而是按需解析 + 版本号缓存，详见 db_path
        self._cached_path: Optional[str] = None
        self._cached_version: Optional[int] = None
        self.init_database()

    @staticmethod
    def _resolve_storage_dir_version() -> int:
        """当前存储目录版本号（切换目录后自增，用于判定路径缓存是否过期）"""
        try:
            from backend.config_manager import get_storage_dir_version
            return get_storage_dir_version()
        except Exception:
            # 配置不可用时按版本号 0 处理，此时环境多半也已退化到默认路径，
            # 交给调用方随正常路径解析即可，不影响可用性
            return 0

    @property
    def db_path(self) -> str:
        """当前数据文件路径。

        之所以按需解析、而不是在 __init__ 里冻结快照：用户可在运行时切换
        存储目录，一旦路径被写成构造期快照，那些长期持有 TodoDatabase 的
        组件（后台到期提醒线程、全局快捷键任务面板）会继续连接旧库，形成
        陈旧连接——表现为新建的任务写进旧库、对已迁走的旧文件反复报
        no such table、或与新库争抢同一把写锁。

        版本号机制保证常态下无任何额外开销：只有存储目录真的发生切换时
        才重新解析。
        """
        version = self._resolve_storage_dir_version()
        if self._cached_path is None or self._cached_version != version:
            db_file = Path(get_app_data_file())

            # 确保父目录存在
            db_file.parent.mkdir(parents=True, exist_ok=True)

            self._cached_path = str(db_file)
            self._cached_version = version
        return self._cached_path

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

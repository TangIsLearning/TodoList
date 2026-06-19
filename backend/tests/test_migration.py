import sqlite3
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.database.operations import _migrate_database

def test_migrate_adds_users_table():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()

        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        )
        assert cur.fetchone() is not None
    finally:
        conn.close()
        Path(path).unlink()

def test_migrate_adds_task_audit_log_table():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()

        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task_audit_log'"
        )
        assert cur.fetchone() is not None
    finally:
        conn.close()
        Path(path).unlink()

def test_migrate_adds_task_extension_columns():
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        path = f.name
    try:
        conn = sqlite3.connect(path)
        conn.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY)')
        _migrate_database(conn.cursor())
        conn.commit()

        cols = [row[1] for row in conn.execute('PRAGMA table_info(tasks)').fetchall()]
        for expected in ['owning_dept_id', 'cooperating_dept_ids',
                         'owner_user_id', 'cooperator_user_ids', 'audit_enabled']:
            assert expected in cols, f'Missing column: {expected}'
    finally:
        conn.close()
        Path(path).unlink()

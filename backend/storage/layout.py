"""存储目录的布局约定。

单独成模块：迁移器、清理器、配置管理器三方都要遵循同一套目录约定，
放在零依赖模块里谁都能引用，且不会引入循环导入。
"""

# 存储目录结构：<用户选择的目录>/todolist/{todo.db, attachment/}
STORAGE_DIR_NAME = 'todolist'
ATTACHMENT_DIR_NAME = 'attachment'
DB_FILE_NAME = 'todo.db'

# 旧版本在导入 / 切换数据文件前自动生成的安全备份目录。该逻辑已移除（无人使用、
# 只增不减），常量保留下来只为清理用户磁盘上已有的历史残留。
BACKUP_DIR_NAME = 'backups'

# 迁移数据量超过该阈值时提示用户二次确认（字节）
# 切目录是复制语义，体量大时会占双倍空间且耗时明显，需要先把规模告知用户
MIGRATION_SIZE_WARNING_THRESHOLD = 200 * 1024 * 1024

# SQLite backup 每批复制的页数。默认 -1 是「一次搬完」，实测 88MB 库只回调进度
# 1 次——取消根本没机会生效。分批后同样耗时下回调上百次，取消才能在批次边界停住。
MIGRATION_BACKUP_PAGES = 200

# 数据库文件的 SQLite WAL 边车后缀，迁移与清理都要按它找齐
DB_SIDECAR_SUFFIXES = ('', '-wal', '-shm')

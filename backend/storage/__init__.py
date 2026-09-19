"""存储目录相关：布局约定、路径推断、迁移执行、旧备份清理、数据导入导出。

刻意保持为空：本包 __init__ 一旦 import 子模块，任何对子模块的引用都会连带把
依赖拉进来。依赖是单向的（本包 → config_manager 读配置），不空 __init__ 虽不至于
成环，但会把「import 一个常量」变成「拉起整套平台服务与配置读写」，代价不划算。

需要本包能力时请按模块显式引用：
- backend.storage.layout：目录名等零依赖常量
- backend.storage.paths：默认目录的平台推断
- backend.storage.service：路径解析与切换编排（对外门面）
- backend.storage.data_export：数据导出 / 导入（自带 SQLite 连接，依赖面重）
"""

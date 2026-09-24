# 后端模块初始化文件
from pathlib import Path

# 应用根：开发态是项目根，打包态是资源根（PyInstaller 的 _MEIPASS、p4a 的 app 目录）
#
# 由 backend 包自身的位置推导，而不是在深层模块里数 parents[n]——那种写法
# 与「文件埋在第几层目录」绑死，挪动目录或调整包结构就会静默指错位置。
# backend 包始终直接位于应用根下（源码态和打包产物里都是），所以这一层关系是稳定的。
_BACKEND_DIR: Path = Path(__file__).resolve().parent

APP_ROOT: Path = _BACKEND_DIR.parent

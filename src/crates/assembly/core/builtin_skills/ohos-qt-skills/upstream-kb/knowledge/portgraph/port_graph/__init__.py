"""port_graph - Qt 应用鸿蒙化可移植性拓扑图谱后端。

独立项目：无外部知识库依赖（Qt 模块状态 vendored 在 data/，
工程预扫描 vendored 在 qt_scanner.py）。

数据流：采集（Harmonybrew / cmd-pkgs / 种子 / 工程扫描）
      -> SQLite 图数据 -> 可移植性推导引擎 -> FastAPI / 前端图谱。
"""

from pathlib import Path

# 项目根（本包的上一级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = PROJECT_ROOT / "workspace"
DB_PATH = WORKSPACE / "portgraph.db"
# Harmonybrew formula 仓库（数据源，ingest 用）
HB_CORE = WORKSPACE / "hb-core" / "Formula"
# cmd-pkgs 仓库（数据源，ingest 用；缺失时自动 clone）
CMDPKGS_DIR = WORKSPACE / "cmd-pkgs"
# 本地已下载的鸿蒙 aarch64 预编译产物（<name>/<version>/，fetch 用）
OHOS_LIBS = WORKSPACE / "ohos-libs"
# vendored 数据（Qt 模块鸿蒙支持状态知识页）
DATA_DIR = PROJECT_ROOT / "data"

__all__ = ["PROJECT_ROOT", "WORKSPACE", "DB_PATH", "HB_CORE", "CMDPKGS_DIR",
           "OHOS_LIBS", "DATA_DIR"]

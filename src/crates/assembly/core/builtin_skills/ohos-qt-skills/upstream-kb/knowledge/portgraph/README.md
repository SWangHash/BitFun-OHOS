# portgraph — Qt 应用鸿蒙化可移植性拓扑图谱

分析一个 Qt 应用能否完整运行在 HarmonyOS（鸿蒙）上：扫描其依赖（Qt 模块、
KDE Frameworks 组件、第三方库）与平台接口使用（Win32/Cocoa/X11/ALSA…），
构建 SQLite 依赖图，递归推导可移植性结论，并在 Web 图谱中可视化。

**独立项目**：无外部知识库依赖。Qt 模块支持矩阵 vendored 在 `data/`，
工程预扫描器 vendored 在 `port_graph/qt_scanner.py`。

> 给别人讲清楚这个模块？先看 **[OVERVIEW.md](OVERVIEW.md)**（一页纸：
> 解决什么问题 + 架构图），再回本文档查 CLI 细节。

---

## 架构

```
数据源 ingest                扫描                    分析/呈现
─────────────────         ──────────────          ─────────────────
Harmonybrew formula  ─┐                          ┌─ CLI（analyze/summary）
  (4741 个 formula)    ├─► SQLite 图数据          ├─ REST API (FastAPI)
cmd-pkgs README       ─┤   nodes / edges /        └─ Web 图谱 (G6)
  (1248 预编译包)        │   interfaces                  横向层级布局
Qt 模块支持矩阵 ────────┤        ▲
  (data/*.md)           │        │ 递归判定引擎
                       ─┘        │ (portable/blocked/uncertain)
                   project_scanner ◄── app 工程扫描
                   (CMake/qmake + 源码宏守卫分析)
```

### 可移植性判定模型

一个 app 节点判定为 **portable**，当且仅当：
1. 其所有平台接口在鸿蒙受支持（或被非鸿蒙平台条件编译排除）；
2. 所有依赖递归 portable。

| 结论 | 含义 |
|---|---|
| `portable` | 全部依赖与接口就绪，可直接鸿蒙化 |
| `blocked` | 存在硬阻塞：不支持的平台接口 / 不支持的 Qt 模块 / 阻塞的依赖 |
| `uncertain` | 无硬阻塞但有未知依赖/接口（如无 bottle 的包） |

**节点边界**（何为一个"项目"节点）：最小"独立可移植判定单元"——你会独立移植、
独立打包、独立 link 的那个单元。app=工程仓库；package=Harmonybrew/cmd-pkgs recipe；
qt-module=Qt 模块；framework=KDE Frameworks 组件（如 kio，逐组件递归判定而非整体
blocked）。平台接口（ALSA/X11…）是节点属性，不占节点。

**平台接口守卫分析**：扫描源码中每个平台 API 命中点，用宏栈追踪
（`#ifdef`/`#ifndef`/`#if defined()` AND/OR 嵌套、`#else`/`#elif`）判定该代码
在鸿蒙下是否编译：
- `unconditional` / `ohos-active`：会编译 → 不支持则构成硬阻塞
- `platform-excluded`：被非鸿蒙宏守卫包裹 → 不阻塞，附鸿蒙同类替代接口
- `platform-file-excluded`：位于平台专属文件（macos/win/…路径）→ 不阻塞

每个阻塞接口带**风险等级**（按会编译的命中占比）：高 ≥80%、中 30~80%、低 <30%。

---

## 快速开始

### 依赖

- Python 3.10+（标准库即可跑 ingest/scan/analyze）
- Web 服务：`pip install fastapi uvicorn`
- 图谱前端：AntV G6（CDN 加载，无需安装）

### 初始化数据

```bash
# 1) Harmonybrew formula 仓库 sparse checkout（首次需要）
git clone --filter=blob:none --sparse https://atomgit.com/Harmonybrew/homebrew-core.git workspace/hb-core
cd workspace/hb-core && git sparse-checkout set Formula && cd ../..

# 2) 数据入库
python portgraph.py ingest harmonybrew   # 4741 formula → 包节点+bottle直链
python portgraph.py ingest cmdpkgs       # 1248 预编译包（自动 clone 仓库）
python portgraph.py ingest kb            # Qt 模块矩阵 + 接口白名单
# 或一次性: python portgraph.py ingest all
```

### 分析一个 Qt 应用

```bash
# 克隆并扫描（后台任务，见 Web 端）
python portgraph.py clone https://github.com/<org>/<你的Qt应用>

# 或扫描本地已有工程
python portgraph.py scan workspace/<app>

# 可移植性分析（含阻塞点、风险等级、依赖产物清单）
python portgraph.py analyze <app> --summary
```

输出示例（虚构样例 sample-app）：

```
verdict: blocked
blockers: 2
  [unsupported-interface] app:sample-app: 使用鸿蒙不支持的平台接口
      macOS Cocoa/AppKit …［证据: 212 处文件级排除 / 4 处无条件 …］
依赖产物清单: 8 个依赖（3 个有鸿蒙产物 / 5 个框架提供 / 0 个需移植）
  [有产物] ffmpeg v9.0.1 (runtime) ported
      鸿蒙产物: https://harmonybrew.atomgit.com/bottles/ffmpeg-9.0.1.arm64_ohos.bottle.1.tar.gz
      源码下载: https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz
```

### 综合依赖分析（角色分类 + 版本范围）

```bash
# 路径或已扫描应用名皆可；--json 输出机器可读报告
python portgraph.py deps <app>
```

按角色回答"这个项目到底依赖什么"（详见 docs/deps-report.md）：

| 角色 | 含义 | 示例 |
|---|---|---|
| link | 项目期望获取到编译产物的依赖（目标侧 headers+libs） | `find_package(ZLIB 1.2 REQUIRED)`、`target_link_libraries` 裸名、`find_library`、meson `dependency()`、autotools `PKG_CHECK_MODULES` |
| build-tool | 编译器/构建工具依赖（构建机运行，不部署） | cmake≥3.16 / C++17 / protoc / ECM / meson≥0.53 |
| runtime | 运行时依赖（设备侧 .so：传递闭包 + dlopen/QLibrary） | ffmpeg 的 14 个传递依赖 |
| test | 测试专用，不进发行包 | GTest / Catch2 |
| vendored | 项目内自带源码（.gitmodules / 3rdparty/ / FetchContent） | dep/spdlog、qtColorWidgets（GIT_TAG 锁定） |
| env | CI/脚本安装的环境清单（交叉核对信源） | `apt install libkeyutils-dev` |

每个依赖附版本范围（find_package 最低版本 / pkg-config·meson·autotools·包装函数
约束 / conan 范围）与鸿蒙产物获取途径、版本要求校验（satisfied / conflict）。
19 类声明信号的覆盖全景图见 docs/deps-report.md。

### 获取交叉编译依赖（非鸿蒙平台）

`brew install` 只能在鸿蒙设备执行；在其他平台上用 `fetch` 直接下载
arm64-OpenHarmony 预编译 bottle（含 include/ + lib/ + cmake 配置）：

```bash
# 单个/多个包
python portgraph.py fetch "zlib,jsoncpp,openssl@3"

# 或一键拿整个应用的全部依赖产物（agent 工具，详见 docs/fetch-deps.md）
python portgraph.py fetch-deps sample-app --dry-run   # 预览分类清单
python portgraph.py fetch-deps sample-app            # 下载 + manifest
```

自动完成：查库取直链 → 下载 → sha256 校验 → 解压到 `workspace/ohos-libs/`
→ Windows/NTFS 下拷贝补建 `.so` 符号链接 → 输出 CMake/qmake 集成片段。

**Bottle 直链规则**（实测验证）：

```
https://harmonybrew.atomgit.com/bottles/<name>-<version>[_<revision>].arm64_ohos.bottle[.<rebuild>].tar.gz
```

- 名与版本间为**单短横线**（非 Homebrew 双短横线）
- formula 顶层 `revision N` → 版本后缀 `_N`（如 pcre2-10.47_1）
- `bottle do` 块内 `rebuild N` → `.bottle.N.tar.gz`（如 curl-8.21.0）
- `@` 变体原样（openssl@3-3.6.4）；裸名 openssl/icu4c 需用变体

交叉编译集成要点：
- CMake：`-DCMAKE_PREFIX_PATH=<bottle路径> -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH`（铁律）
- qmake：`LIBS += -L<bottle>/lib -lfoo`（-l 列表由 fetch 输出）
- `.so` 在 Windows 上只能链接不能运行；部署到 `entry/libs/arm64-v8a/` 才能上设备
- 运行时依赖需递归 fetch 全（如 ffmpeg 14 个），漏拉会在设备 dlopen 失败

### 启动 Web 服务

```bash
python portgraph.py serve              # http://127.0.0.1:8000
python portgraph.py serve --port 8080
```

功能：应用选择、知识图谱（横向层级/力导向/环形布局，Qt 模块聚合可展开）、
阻塞点面板（风险等级筛选）、节点详情抽屉（平台接口证据、依赖、
鸿蒙产物与源码链接）、添加分析目标（后台克隆+扫描，进度条可最小化/随时刷新）。

---

## CLI 参考

| 命令 | 说明 |
|---|---|
| `ingest <source>` | 数据入库：`harmonybrew` / `cmdpkgs` / `kb` / `all`；`--offline` 不 pull |
| `clone <url> [--name N]` | shallow clone + 扫描入库 |
| `scan <project>` | 扫描本地 Qt 工程 |
| `analyze <app> [--summary]` | 可移植性分析；`--summary` 人读摘要 |
| `deps <path\|app> [--json]` | 综合依赖分析：link/build-tool/runtime/test/vendored 分类 + 版本范围 + 产物获取途径（[文档](docs/deps-report.md)） |
| `fetch <pkg,...> [--out D] [--force]` | 下载 bottle 交叉编译依赖 |
| `fetch-deps <app> [--out D] [--force] [--dry-run] [--json]` | 一键下载应用全部依赖的鸿蒙产物 + manifest（[文档](docs/fetch-deps.md)） |
| `stats` | 数据统计 |
| `export [out]` | 导出全图 JSON |
| `serve [--port P] [--host H]` | 启动 Web 服务 |

全局：`--compact` 输出紧凑 JSON。

## REST API

| 端点 | 说明 |
|---|---|
| `GET /api/apps` | 应用列表 |
| `GET /api/graph?root={app_id}` | 拓扑图数据（按可移植性智能展开：已鸿蒙化的节点不再下钻依赖，未鸿蒙化的递归展开） |
| `GET /api/analysis/{app_id}` | 可移植性分析（verdict/blockers/unknowns/风险） |
| `GET /api/node/{node_id}` | 节点详情（含 artifact 链接信息） |
| `POST /api/scan` | 扫描本地路径 `{path}` |
| `POST /api/clone` | 创建后台克隆+扫描任务 `{url}` → `job_id` |
| `GET /api/job/{id}` | 任务进度（percent/stage/message） |
| `GET /api/jobs` | 任务列表 |
| `POST /api/ingest` | 触发入库 `{source}` |

## 目录结构

```
portgraph/
├── README.md               本文档
├── docs/
│   ├── fetch-deps.md       依赖产物一键获取（agent 工具文档）
│   └── deps-report.md      综合依赖分析：角色分类 + 版本范围（agent 工具文档）
├── portgraph.py            CLI 入口
├── port_graph/             Python 包
│   ├── __init__.py         路径常量（PROJECT_ROOT/workspace/…）
│   ├── db.py               SQLite schema（nodes/edges/interfaces + 链接列）
│   ├── harmonybrew.py      formula 解析 + bottle 直链构造/下载器
│   ├── cmdpkgs.py          cmd-pkgs README 解析 + 产物直链
│   ├── kb_seed.py          Qt 模块矩阵（解析 data/）+ 接口白名单 + KF 组件依赖
│   ├── qt_scanner.py       工程预扫描（vendored；find_package 详情/工具链/动态加载）
│   ├── project_scanner.py  工程扫描入库（平台接口宏守卫分析/KF 递归/第三方对齐）
│   ├── engine.py           递归可移植性判定 + artifact_info
│   ├── deps_report.py      deps：综合依赖分析（角色分类/版本范围/传递闭包）
│   ├── deps_fetch.py       fetch-deps：应用依赖闭包产物一键获取
│   ├── cloner.py           git shallow clone
│   ├── jobs.py             后台任务（进度条）
│   └── api.py              FastAPI 端点 + 前端托管
├── web/                    前端（G6 知识图谱）
├── data/                   vendored 知识数据（Qt 模块鸿蒙支持矩阵）
├── tests/                  单元测试
└── workspace/              运行数据（gitignore）
    ├── portgraph.db        SQLite 图数据
    ├── hb-core/            Harmonybrew formula 仓库（数据源）
    ├── cmd-pkgs/           cmd-pkgs 仓库（数据源）
    ├── ohos-libs/          fetch 下载的鸿蒙预编译产物
    └── <app>/              clone/scan 的应用工程
```

## 数据源

| 来源 | 规模 | 提供内容 |
|---|---|---|
| [Harmonybrew](https://atomgit.com/Harmonybrew/homebrew-core) | 4741 formula | 依赖图、bottle 直链、源码/主页链接 |
| [cmd-pkgs](https://gitcode.com/OpenHarmonyPCDeveloper/cmd-pkgs) | 1248 包 | 鸿蒙 aarch64 预编译产物直链 |
| Qt 模块鸿蒙支持矩阵（vendored） | 50 模块 | 36 支持 / 14 不支持 |
| 接口白名单（人工策展） | 22 接口 | POSIX/socket/GLES/pthread… 支持态（含 3 条鸿蒙原生替代） |
| KDE Frameworks 组件依赖表 | 30 组件 | KF→Qt/KF/接口 递归展开 |

## 测试

```bash
cd portgraph
python -m unittest discover -s tests -v    # 119 项：解析器/引擎/守卫/闭包/提取/全形式依赖声明
```

## 已知限制

- 平台接口检测为正则匹配，注释中的 API 名（如 `// DestroyWindow(...)`）与
  同名自定义函数可能误报，虚高风险等级（计划：剥离注释 + 调用形态约束）
- hb 节点缺版本号的 formula（412 个，url 无版本形态）无 bottle 直链，
  回退源码交叉编译
- cmd-pkgs 与 harmonybrew 同名包跨源互补链接时，带版本的链接仅版本一致才互补

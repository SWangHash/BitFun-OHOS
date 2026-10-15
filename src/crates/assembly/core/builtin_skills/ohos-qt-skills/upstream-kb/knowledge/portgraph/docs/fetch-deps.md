# fetch-deps — 应用依赖鸿蒙产物一键获取（Agent 工具）

给定一个已扫描入库的 Qt 应用，一键获取其**全部依赖**在鸿蒙（arm64-v8a /
OpenHarmony）上的可运行产物，并生成机器可读的 manifest。面向 AI agent
自动化交叉编译场景：无需鸿蒙设备、无需 brew，任意平台（Windows/Linux/macOS）
可直接执行。

```bash
python portgraph.py fetch-deps <app> [--out DIR] [--force] [--dry-run] [--json]
```

---

## 典型 Agent 工作流

```bash
# ① 先预览：闭包里有什么、哪些能下载、哪些要移植（不写盘）
python portgraph.py fetch-deps sample-app --dry-run

# ② 确认可接受后执行下载（产物落在 workspace/ohos-libs/，跨应用共享缓存）
python portgraph.py fetch-deps sample-app

# ③ 读取 manifest，拿集成参数（CMAKE_PREFIX_PATH 等）
python portgraph.py fetch-deps sample-app --json        # 或直接读 manifest 文件
#   → workspace/ohos-libs/manifest-sample-app.json

# ④ 对 need_port 的依赖（无产物）：拿源码链接，自行交叉编译
#    （source_url / repo_url 已在 manifest 每个条目中给出）
```

## 参数

| 参数 | 说明 |
|---|---|
| `app` | 应用 ID 或名称：`sample-app` / `app:sample-app`（模糊匹配） |
| `--out DIR` | 下载解压目录，默认 `workspace/ohos-libs/`（跨应用共享，已有产物自动跳过） |
| `--force` | 已存在也重新下载（覆盖旧产物，含 brew 只读文件） |
| `--jobs N` | **并行下载线程数（默认 8）**：bottle 先并行预取 tar 到 `.cache/`（缓存命中自动跳过，重跑只补缺），再串行解压安装。弱网实测：串行 57KB/s 曾 90 分钟超时，8 线程并行同规模约 8 分钟。`0`/`1` = 关闭并行预取 |
| `--dry-run` | 只输出分类清单，不下载、不写盘、不写 manifest |
| `--json` | 结束时把完整 manifest JSON 打到 stdout（配合 `--dry-run` 做机器预览） |

## 分类语义与 Agent 决策表

manifest 中每个依赖条目带 `status`，agent 按下表决策：

| status | 含义 | Agent 应该做什么 |
|---|---|---|
| `downloaded` | 本次下载并解压成功（bottle 已过 sha256 校验） | 无需处理，路径见 `installed` |
| `already_local` | 本地已就绪（上次 fetch 的产物或 `artifact_local`） | 无需处理，路径见 `installed` |
| `covered` | 同名包产物已由另一数据源节点获取（hb:/cmdpkgs: 去重，去重键为规范化名——去 lib 前缀，qrencode/libqrencode 这类同库异名只下载一次） | 无需处理，路径见 `installed` |
| `provided` | Qt 模块 / 平台 API，由 Qt SDK / 鸿蒙框架提供；CMake 内置模块（OpenMP/Threads/iconv/dl）也归此类（随 OHOS NDK/SDK 自带，`note` 说明） | 不下载；随 Qt for HarmonyOS / NDK 部署 |
| `cmd_only` | 无直链（formula 未能解析版本号），只有获取命令 | 在鸿蒙设备执行 `artifact_cmd`；或查 formula 补版本号构造 bottle 直链 |
| `need_port` | 无鸿蒙产物，需自行交叉编译 | 取 `source_url`/`repo_url` 拉源码移植；能否鸿蒙化看 `port_status` 与递归分析 |
| `test` | 测试框架（GTest/Catch2 等），不进发行包 | 发行包无需处理；如需在鸿蒙设备跑测试才准备 |
| `failed` | 下载失败（404 / 网络 / sha256 不匹配） | 重试；仍失败则检查 URL 是否失效，回退源码编译 |
| `would_download` | 仅 dry-run 出现：将下载 | 决定是否执行真实下载 |
| `target` | 应用节点自身 | 即分析目标 |

## Manifest 结构

`workspace/ohos-libs/manifest-<app>.json`（每次真实执行覆盖写入）：

```jsonc
{
  "app": {"id": "app:sample-app", "name": "sample-app"},
  "generated_at": "2026-09-09T12:00:00",
  "out_dir": "workspace/ohos-libs",
  "closure_size": 35,                      // 依赖闭包节点总数
  "summary": {"downloaded": 27, "provided": 5, "cmd_only": 2, "target": 1},
  "roles": {"link": 8, "runtime": 21, "provided": 5, "target": 1},
  "deps": [                                 // 闭包内每个节点一个条目
    {
      "id": "hb:openssl@3", "name": "openssl@3", "kind": "package",
      "version": "3.6.4", "port_status": "ported",
      "status": "downloaded", "role": "link",
      // role（按闭包深度）：link=应用直接声明（编译/链接需要）
      //                    runtime=传递依赖（设备侧 .so）
      //                    provided=Qt 模块；target=应用自身
      //                    test=测试框架（不进发行包）
      //                    build-tool=CMake 内置/主机构建工具
      //                    （OpenMP 随 NDK、ECM 构建机安装即可）
      //                    vendored=源码自带依赖（require_source_dep，
      //                    随项目源码编译，不下载不下钻）
      // 带版本范围/REQUIRED 语义的精确分类用 `deps` 命令的报告
      "artifact_url": "https://harmonybrew.atomgit.com/bottles/openssl@3-3.6.4.arm64_ohos.bottle.tar.gz",
      "sha256": "verified",
      "installed": "workspace/ohos-libs/openssl@3/3.6.4",
      "libs": ["ssl", "crypto"],            // -l 链接名列表
      "hints": { "cmake": "...", "qmake": "...", "deploy": "..." },
      "symlinks_fixed": ["lib/libssl.so.3"] // NTFS 下以拷贝落地的 .so 链接
    },
    {"id": "qt:gui", "kind": "qt-module", "status": "provided",
     "role": "provided", "note": "…"},
    {"id": "hb:xxx", "status": "need_port", "role": "link",
     "source_url": "…", "repo_url": "…", "homepage": "…"}
  ],
  "toolchain": {
    "cmake_prefix_path": "…;…;…",           // 分号拼接，直接给 -DCMAKE_PREFIX_PATH
    "cmake": "cmake -S . -B build_ohos …",  // 完整可复制命令
    "note": "NATIVE_OHOS_SDK 为本机 HarmonyOS SDK native 路径；…"
  }
}
```

## 交叉编译集成

下载完成后，所有产物的安装根（含 `lib/`、`include/`、pkg-config、CMake 配置）
已按 `workspace/ohos-libs/<name>/<version>/` 落位：

```bash
cmake -S . -B build_ohos \
  -DCMAKE_TOOLCHAIN_FILE=$NATIVE_OHOS_SDK/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a \
  -DCMAKE_PREFIX_PATH=<manifest.toolchain.cmake_prefix_path> \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH     # 铁律：必须 BOTH
```

qmake 工程：`LIBS += -L<installed>/lib -lfoo`（`-l` 列表见每条目 `libs`）。

部署提醒：`.so` 在非鸿蒙主机上只能**链接**不能运行；打包时把所有
`lib/*.so` 复制到应用 `entry/libs/arm64-v8a/` 才能在设备上加载。

## 依赖闭包口径

- 沿 `runtime` / `uses-module` 边递归，跳过 `platform_cond=macos` 的条件依赖
- **与可移植性判定引擎的关键差异**：已鸿蒙化（ported）的包也继续下钻其
  runtime 依赖——bottle 不捆绑依赖，目标侧链接/运行仍需其依赖的 `.so`
- `build` / `test` 依赖是主机构建工具（cmake/nasm 在构建机运行），不属于
  目标侧产物需求，不下载
- Qt 模块为 provided，不展开（其依赖由 Qt SDK 自带）

## 产物来源

| 来源 | URL 形态 | 校验 |
|---|---|---|
| Harmonybrew bottle | `https://harmonybrew.atomgit.com/bottles/<name>-<ver>[_rev].arm64_ohos.bottle[.rebuild].tar.gz` | sha256（formula 内置摘要） |
| cmd-pkgs 预编译包 | `https://gitcode.com/OpenHarmonyPCDeveloper/cmd-pkgs/releases/download/pkgs/<name>-<ver>-ohos-aarch64.tar.gz` | 源未提供摘要（`sha256: n/a`） |

同名包在两源都有节点时自动去重（先到先得），另一个节点标记 `covered`。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功（含存在 need_port/cmd_only——它们是信息而非错误） |
| 1 | 应用不存在；或存在 `failed` 条目（至少一个下载失败，可重试） |

## 可靠性细节

- **原子落位**：先解压到 `.staging/`，成功后才移入最终目录——中途失败
  （断网、磁盘错误、杀毒软件瞬时锁文件）不会留下半成品，重跑不会把残缺
  产物误判为"已就绪"
- **Windows 只读文件**：brew 产物的 CMake 配置文件常为只读（mode 444），
  覆盖/删除时自动恢复写权限
- **瞬时文件锁重试**：杀毒软件扫描刚写入的文件可能导致 PermissionError，
  自动重试 3 次
- **NTFS 符号链接**：bottle 内 `.so` 链接以拷贝目标文件落地，保证
  `-lfoo` 可被 OHOS 交叉链接器解析
- **幂等**：重复执行跳过已就绪产物；`--force` 强制重下
- 下载成功后会回写节点的 `artifact_local`，Web 图谱详情页同步可见

## 相关命令

| 命令 | 关系 |
|---|---|
| `fetch <pkg,...>` | 手动指定包名下载单个/多个 bottle（fetch-deps 的底层能力） |
| `analyze <app> --summary` | 可移植性判定 + 阻塞点（回答"能不能移植"）；fetch-deps 回答"依赖产物怎么拿" |
| `deps <path\|app>` | 综合依赖分析（回答"依赖全景：角色分类 + 版本范围"）；其 runtime 传递闭包口径与本命令一致 |
| `serve` | Web 图谱；fetch-deps 回写的 artifact_local 会在节点详情中展示 |

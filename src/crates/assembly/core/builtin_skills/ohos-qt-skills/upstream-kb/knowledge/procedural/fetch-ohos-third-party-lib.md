---
id: procedural-fetch-ohos-third-party-lib
type: procedural
domain: workflow
tags: [qt, harmonyos, third-party, harmonybrew, bottle]
created: 2026-07-07
updated: 2026-07-07
status: active
audience: public
refs: [procedural-qt-app-harmonyos-migration, semantic-qt-harmonyos-third-party-libs]
summary: >
  从 Harmonybrew 一键下载 arm64-OpenHarmony 预编译 bottle（.so）并校验解压，
  免交叉编译即可链接到 Qt 鸿蒙工程。含依赖递归、qmake/CMake 链接片段、版本解析陷阱。
---

# 从 Harmonybrew 获取 arm64-OpenHarmony 三方库预编译包

> 用 `fetch-ohos-bottle.sh` 一键下载 Harmonybrew 社区预编译的 arm64-OpenHarmony bottle（`.so`），校验 sha256、解压、并递归拉取运行时依赖，免交叉编译即可链接到 Qt 鸿蒙工程。在应用鸿蒙化工作流中，当某三方库已有 bottle 时，用它替代源码交叉编译。

---

## 触发条件 / 适用场景

- 应用依赖某 C/C++ 三方库，且 Harmonybrew 已为该库提供 `arm64_ohos` 预编译 bottle。
- 想跳过 OHOS NDK 交叉编译，直接拿到可链接的 arm64-OpenHarmony `.so` + 头文件 + CMake config。
- CI 流水线中批量拉取依赖，避免每条流水线各自交叉编译。
- 想拿到 bottle 内自带的 `lib/cmake/<pkg>Config.cmake`，用 `find_package` 集成。

> 不适用：Harmonybrew 未提供 bottle 的库——回退到 [[qt-harmonyos-third-party-libs]] §2 源码交叉编译。

---

## 前置条件

| 工具 | 用途 | 备注 |
|------|------|------|
| bash | 运行脚本 | Git Bash / WSL / CI 均可（脚本用 `set -euo pipefail`，fail-fast）|
| git | clone/pull formula 仓库 | AtomGit raw `.rb` 与 REST API 被 CloudWAF 拦截（HTTP 418）；Harmonybrew formula JSON 返回 404 NoSuchKey——**只能走 git 协议**，脚本用 `git clone --sparse` 只拉 `Formula/` 树 |
| curl | 下载 bottle + HEAD 探测 | `-sIL` 探测、`-fL` 下载 |
| tar | 解压 `.tar.gz` | Git Bash 自带 |
| sha256sum 或 shasum | 校验 sha256 | Git Bash 自带 `shasum -a 256`；脚本自动回退 |

无需 curl raw `.rb` 或 JSON API——raw/REST 被 CloudWAF 418、formula JSON 404，脚本全走 git。

---

## 快速开始

```bash
# 拉取 abseil 及其运行时依赖，解压到 ${DELIVERABLES_ROOT}/ohos-libs
bash _scripts/fetch-ohos-bottle.sh -f abseil -o ${DELIVERABLES_ROOT}/ohos-libs
```

预期产出（`${DELIVERABLES_ROOT}/ohos-libs` 是 `-o` 解析后的绝对路径；进度/信息行打到 stderr，✅ 摘要与链接片段打到 stdout）：

```
✅ abseil 20260526.0
   lib/     ${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0/lib
   include/ ${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0/include
   cmake/   ${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0/lib/cmake

# qmake (.pro) — 链接 abseil
LIBS += -L${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0/lib \
        -labsl_base -labsl_city -labsl_clock -labsl_hash -labsl_raw_hash_set -labsl_status -labsl_strings -labsl_throw_delegate

# CMake — abseil 提供 abslConfig.cmake
cmake -S . -B build_ohos \
  -DCMAKE_TOOLCHAIN_FILE=$NATIVE_OHOS_SDK/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a \
  -DCMAKE_PREFIX_PATH=${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0 \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
```

abseil 无运行时依赖，故不触发递归。ffmpeg（14 个依赖）会递归拉取 zlib/openssl@3 等。

---

## 工作流定位

本步在 [[qt-app-harmonyos-migration]] **阶段一 §1.1 可行性评估**之后：

- 评估三方库依赖时，先查 Harmonybrew 是否有 `arm64_ohos` bottle。
- **有 bottle** → 用本脚本一键拉取 `.so` + 头文件 + CMake config，跳过交叉编译，直接进 §6 构建系统适配。
- **无 bottle** → 走 [[qt-harmonyos-third-party-libs]] §2 OHOS NDK 源码交叉编译。

即：本脚本是「预编译 .so 集成」策略（[[qt-harmonyos-third-party-libs]] §1 策略表第 3 行）的自动化实现，source = Harmonybrew 社区仓库。

---

## 依赖解析行为

脚本默认**递归拉取运行时依赖**，按 formula 实际名（如 `icu4c@78`、`zlib-ng-compat`、`pkgconf`）递归，带访问集合去重。

| depends_on 出现位置 | 处理 |
|--------------------|------|
| 类体顶层（裸 `depends_on "x"`）| ✅ 包含（运行时）|
| `on_linux do` / `on_arm64_ohos do` 块内 | ✅ 包含（OHOS 基于 linux）|
| `on_macos do` 块内 | ❌ 剥离 |
| `head do` 块内 | ❌ 剥离（head-only 构建依赖）|
| `resource "..." do` 块内 | ❌ 剥离 |
| `=> :build` 或 `=> :test` 或 `=> [:build, :test]` | ❌ 排除（非运行时）|
| 同包既 `:build` 又裸出现（如 glib 的 gettext）| ✅ 运行时列表保留裸实例一次 |

其他：
- `--no-deps` 关闭递归，仅拉指定 formula（仅当确信依赖已就位时用）。
- `uses_from_macos "bzip2"`（boost/pcre2）**不是** `depends_on`，不自动拉取——脚本打印 `ℹ️ 注意: <formula> 含 uses_from_macos 依赖…` 提示，运行时报缺库时手动 fetch。
- 行尾 `#` 注释（如 ffmpeg `depends_on "libvmaf" # dependent: ab-av1`）会被剥掉再取名。
- 递归复用缓存：已下载的 bottle 不会重下（除非 `--force`）。

---

## 支持的库

> 下列 16 个 formula 实测有 `arm64_ohos` bottle（2026-07-07 探测）。版本由脚本从 formula 动态解析；标「动态解析」的表示从 `url` 字段派生。不是所有 formula 都有 bottle；裸名（openssl / icu4c / pkg-config）不存在，用 `@` 变体或 `pkgconf`。

| 库 | 版本 | arm64_ohos | 备注 |
|----|------|:----------:|------|
| abseil | 20260526.0 | ✓ | sha256 `3a1ec15d…b46e` 已验证；无运行时依赖 |
| openssl@3 | 3.6.3 | ✓ | `@` 变体；裸 `openssl` 不存在，URL 先试 `@` 再试 `%40` |
| zlib | 1.3.2 | ✓ | |
| ffmpeg | 8.1.2 | ✓ | 14 个运行时依赖，递归拉取 |
| libpng | 动态解析 | ✓ | `lib` 前缀 → `Formula/lib/`（非 `Formula/l/`）|
| freetype | 动态解析 | ✓ | |
| harfbuzz | 动态解析 | ✓ | |
| protobuf | 35.1 | ✓ | url 含 `v` 前缀（`v35.1` → `35.1`）|
| jsoncpp | 动态解析 | ✓ | |
| boost | 1.90.0_1 | ✓ | 顶层 `revision 1` → 文件名 `<ver>_1` |
| sqlite | 3.53.0 | ✓ | 显式 `version "3.53.0"`（唯一显式版本）|
| curl | 8.21.0 | ✓ | `bottle do` 内 `rebuild 1` → `.bottle.1.tar.gz` |
| libxml2 | 动态解析 | ✓ | `lib` 前缀 |
| pcre2 | 10.47_1 | ✓ | 顶层 `revision 1` → `_1` |
| glib | 动态解析 | ✓ | gettext 同时以 `:build` 和裸出现，运行时列表去重保留一次 |
| fontconfig | 2.17.1 | ✓ | url `2.17.1.orig` → 正则在 `.orig` 处止 → `2.17.1` |

裸名缺失对照：`openssl` → 用 `openssl@3`；`icu4c` → 用 `icu4c@78`；`pkg-config` → 用 `pkgconf`（脚本自动改用）。

---

## 链接到 Qt

脚本在摘要中动态生成 qmake `-l` 列表（扫 `lib/lib*.so`，剥 `lib` 前缀与 `.so[.N]` 后缀）与 CMake 片段（仅当 `lib/cmake/<pkg>/<pkg>Config.cmake` 存在）。以下是 abseil 的实际产出，`${DELIVERABLES_ROOT}/ohos-libs` 代指 `-o` 解析后的绝对路径：

```makefile
# qmake (.pro) — 链接 abseil
LIBS += -L${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0/lib \
        -labsl_base -labsl_city -labsl_clock -labsl_hash -labsl_raw_hash_set -labsl_status -labsl_strings -labsl_throw_delegate
```

```cmake
# CMake — abseil 提供 abslConfig.cmake
cmake -S . -B build_ohos \
  -DCMAKE_TOOLCHAIN_FILE=$NATIVE_OHOS_SDK/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a \
  -DCMAKE_PREFIX_PATH=${DELIVERABLES_ROOT}/ohos-libs/abseil/20260526.0 \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
```

要点：
- `-L` 路径 = `<out-dir>/<formula>/<version>/lib`（解压后 `lib/` 子目录）。
- `-l` 列表由 `lib/lib*.so` 动态生成；不同库的 `.so` 集不同，直接复制脚本输出即可。
- `CMAKE_PREFIX_PATH` 指向 `<out-dir>/<formula>/<version>`（含 `lib/`、`include/`、`lib/cmake/`），`find_package` 据此定位。
- **必须**带 `-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH`，否则交叉编译 `find_package` 找不到依赖（[[qt-harmonyos-third-party-libs]] §4.1 铁律、[[qt-harmonyos-project-structure]] §4.2）。
- 拿到 `.so` 后，部署到 `entry/libs/arm64-v8a/` 才能在设备运行（[[qt-harmonyos-third-party-libs]] §3）。

---

## 注意事项 / 陷阱

- **单短横线**：bottle URL 是 `<formula>-<version>.arm64_ohos.bottle[.rebuild].tar.gz`（名与版本间**一个**短横线），不是 Homebrew 默认的双短横线。脚本按此拼接，勿手改。
- **并非所有 formula 都有 bottle**：脚本检测 formula 无 `arm64_ohos:` 行 → 报错并指向源码编译回退。无 bottle 时走 [[qt-harmonyos-third-party-libs]] §2。
- **arm64-only / Windows 不可运行**：`.so` 是 arm64-OpenHarmony ABI，Windows 上**只能链接、不能运行**；运行需把 `.so` 部署到鸿蒙设备（`entry/libs/arm64-v8a/`）。
- **运行时依赖必须一起拉**：默认递归（`--no-deps` 仅当确信依赖已就位时用）。漏拉依赖 → 设备 `dlopen` 失败。
- **sha256 必须校验**：脚本从 formula `bottle do` 块读 sha256 并强制校验；不匹配则删缓存报错。不要绕过。
- **Windows .so 符号链接**：bottle 内 `libfoo.so` 多为指向 `libfoo.so.N` 的符号链接，Windows NTFS 建不出来（tar 报 `Cannot create Symlink` 并退出非零）。脚本以"目标目录是否生成"判定解压成功（忽略 tar 退出码），并自动用**拷贝**补建缺失的链接名 `.so`，让 `-lfoo` 能被 OHOS 交叉链接器找到。解压时的 symlink 警告可忽略。
- **CloudWAF → 必须 git clone**：AtomGit raw `.rb` 与 atomgit.com REST API 被 418 拦截；Harmonybrew formula JSON 返回 404 NoSuchKey（非 418）。脚本用 `git clone --sparse` 读 formula，不能 `curl` raw。`git clone` 偶发被拦，重试即可。

---

## 故障排查

| 症状 | 排查 |
|------|------|
| `formula 'X' 不存在。可用的 @ 变体: …` | 裸名缺，用 `-f openssl@3` / `-f icu4c@78` / `-f pkgconf`（`pkg-config` 脚本会自动改用 `pkgconf`）|
| `bottle 404: <url>` | 版本不对——检查 `revision`/`rebuild`：用 `-v <ver>` 显式指定，或看 formula `.rb` 的顶层 `revision N` 与 `bottle do` 内 `rebuild N` |
| `formula 'X' 无 arm64_ohos bottle` | 该库无预编译包，走 [[qt-harmonyos-third-party-libs]] §2 源码交叉编译 |
| `sha256 不匹配` | 缓存损坏，`--force` 重下；若仍不对则 formula 更新了 bottle，`git pull` formula 仓库（`~/.cache/harmonybrew-core`）|
| `git clone 失败` | CloudWAF 间歇拦截，重试；或删除 `~/.cache/harmonybrew-core` 后重试；或用 `--formula-repo <path>` 指定新克隆路径；确无网络则无法读 formula |
| `无 sha256sum/shasum` | Windows Git Bash 自带 `shasum`；或用 WSL |
| 版本派生 warning 且 bottle 404 | url 派生被 `.`/`-` 截断（fontconfig `.orig` / boost `-b2`），用 `-v` 显式指定正确版本 |

---

## 检查清单

- [ ] formula 名正确（含 `@` 变体、`lib` 前缀；裸名 openssl/icu4c/pkg-config 改用变体或 pkgconf）
- [ ] HEAD 探测 bottle 返回 200
- [ ] sha256 校验通过（脚本强制）
- [ ] 运行时依赖递归完成（或 `--no-deps` 已确认依赖就位）
- [ ] `.so` 已部署到 `entry/libs/arm64-v8a/`（见 [[qt-harmonyos-third-party-libs]] §3）
- [ ] qmake `LIBS +=` 或 CMake `CMAKE_PREFIX_PATH` + `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH` 已配置

---

## 供应链

| 维度 | 详情 |
|------|------|
| **上游来源** | Harmonybrew 社区仓库（atomgit.com/Harmonybrew/homebrew-core）|
| **上游输入** | formula `.rb`（版本/sha256/依赖元数据）+ bottle `.tar.gz`（arm64-OpenHarmony 预编译 `.so`）|
| **下游接收方** | Qt 鸿蒙化项目（应用移植）/ CI 流水线 |
| **交付件** | `<out-dir>/<formula>/<version>/{lib,include,lib/cmake}` + qmake/CMake 链接片段 |
| **交付件路径** | `${DELIVERABLES_ROOT}/ohos-libs/`（见 `ENV.md`）|
| **分流规则** | 无 bottle → 回退源码交叉编译（[[qt-harmonyos-third-party-libs]] §2）|

---

## 相关上下文

- [[qt-app-harmonyos-migration]] — 应用鸿蒙化迁移工作流（本脚本在阶段一 §1.1 之后使用）
- [[qt-harmonyos-third-party-libs]] — 三方库鸿蒙化指南（无 bottle 时走 §2 源码交叉编译；`.so` 部署规则 §3；CMake 集成 §4）
- [[qt-harmonyos-platform-limits]] — `.so` 部署/dlopen 限制（dlopen 拒绝可写路径）

---

## 参考来源

- Harmonybrew formula 仓库：`https://atomgit.com/Harmonybrew/homebrew-core.git`（git clone，default branch `main`，文件在 `Formula/<first-letter>/<name>.rb`）
- Bottle 下载域：`https://harmonybrew.atomgit.com/bottles/<formula>-<version>.arm64_ohos.bottle.tar.gz`
- Harmonybrew mirror-deploy 文档（`HOMEBREW_BOTTLE_DOMAIN` 镜像配置）
- [Qt for HarmonyOS (Qt Wiki)](https://wiki.qt.io/Qt_for_HarmonyOS) — 整体架构

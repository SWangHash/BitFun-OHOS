# 环境变量与本地路径清单（开发者版）

> **使用方式**：运行 `skills/kb-init/` 初始化 skill 会自动生成 `ENV.local.md`，或手动把下表的 `<PLACEHOLDER_*>` 替换为你本机的实际路径后再参考。
> 知识页中以变量名引用路径，便于你按自身环境替换。
>
> 这是开发者版裁剪后的模板——已移除原版的供应链交付目录（与外部开发者无关），仅保留移植所需的路径变量。

---

## 🔧 Qt 源码路径

> QtOhosExtras 模块（`qtohosextras/`）是 Qt 源码树内的子目录，不是独立仓库。

### 源码获取渠道

根据是否有 Qt 商业 license，选择不同的获取路径：

| 场景 | 获取方式 | 说明 |
|------|----------|------|
| **有 Qt 商业 license** | `git clone https://codereview.qt-project.org/qt/tqtc-qt5` | 需要 Qt 商业 license，可获取最新补丁和完整历史 |
| **无 license（开源）** | GitCode 公开仓提供的开源代码 | 由 OpenHarmonyPCDeveloper 组织维护，提供开源代码和预编译产物 |
| **只需预编译 SDK** | GitCode 公开仓提供的预编译产物 | 适合不需要修改 Qt 源码的应用开发者 |

**开源获取步骤**（无 license 场景）：
1. 克隆源码：`git clone https://gitcode.com/ohos-qt/qt-harmonyos-src <目标路径>`
2. 切分支：`cd <目标路径> && git checkout tqtc/harmonyos-5.12.12`（或 `tqtc/harmonyos-5.15.16`）

**预编译 SDK 获取**（只需预编译 SDK 场景）：

访问发布页面下载：https://gitcode.com/ohos-qt/qt-harmonyos-src/releases

| 平台 | 渲染后端 | 说明 |
|------|----------|------|
| Windows | Desktop GL | Windows 平台开发，Desktop GL 渲染 |
| Windows | GLES | Windows 平台开发，GLES 渲染 |
| macOS | Desktop GL | macOS 平台开发，Desktop GL 渲染 |
| macOS | GLES | macOS 平台开发，GLES 渲染 |
| HarmonyOS | GLES | HarmonyOS 设备上运行，GLES 渲染 |

**商业获取步骤**（有 license 场景）：
1. 访问 https://codereview.qt-project.org 登录
2. Settings → HTTP Credentials → GENERATE NEW PASSWORD
3. `git clone https://codereview.qt-project.org/qt/tqtc-qt5`
4. 切分支：`git checkout tqtc/harmonyos-5.12.12` 或 `tqtc/harmonyos-5.15.16`
5. `git submodule update --init --recursive`

### 路径变量

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `QT5_12_SRC` | `<QT5_12_SRC_PATH>` | Qt 5.12.x LTS 鸿蒙主力分支源码（tqtc/harmonyos-5.12.12） |
| `QT5_15_SRC` | `<QT5_15_SRC_PATH>` | Qt 5.15.x 鸿蒙适配分支源码（tqtc/harmonyos-5.15.16） |
| `QT6_DEV_SRC` | `<QT6_DEV_SRC_PATH>` | Qt 6 dev 主干源码（鸿蒙化进行中，仅 qtbase） |

## 📦 编译产物与 SDK

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `QT_BUILD_ROOT` | `<QT_BUILD_ROOT_PATH>` | Qt 编译输出根目录 |
| `QT5_12_OHOS_SDK` | `<QT5_12_OHOS_SDK_PATH>` | CMake `CMAKE_PREFIX_PATH`（Qt 5.12 默认） |
| `QT5_15_OHOS_SDK` | `<QT5_15_OHOS_SDK_PATH>` | CMake `CMAKE_PREFIX_PATH`（Qt 5.15） |

## 📚 内嵌的 HarmonyOS 平台通用知识

本知识库内嵌了 `ohos-common-kb-public/` 目录，包含 HarmonyOS 平台通用知识（ArkTS、ArkUI、NAPI、Stage 模型、DevEco 工具链等）。当任务涉及平台机制而非 Qt 特定问题时，优先查阅该目录。

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `OHOS_COMMON_KB_PUBLIC` | `ohos-common-kb-public/` | 内嵌的 HarmonyOS 平台通用知识库（相对路径） |

## 📋 模板

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `OHOS_TEMPLATE_SRC` | `<QT_SRC>/qtbase/src/harmonyos/templates` | ★ 推荐：Qt 源码内置胶水模板（5.15 / 5.12 源码树内均有） |

> 新版 Qt 鸿蒙分支已将胶水模板内置于 `qtbase/src/harmonyos/templates`，无需再从外部下载 ZIP。

## 🔨 构建工具链

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `MINGW_ROOT` | `<MINGW_ROOT_PATH>` | MinGW 工具链（含 mingw32-make，Windows 编译 Qt 用） |
| `PERL_ROOT` | `<PERL_ROOT_PATH>` | Strawberry Perl 安装路径（Qt 构建系统依赖） |
| `OHOS_SDK_NATIVE` | `<DEVECO>/sdk/default/openharmony/native` | OHOS SDK native 工具链（clang/clang++） |

### 编译命令

```powershell
# Qt 5.12.x OHOS 编译安装（必须在 PowerShell 中执行，不要在 bash/git-bash 中运行）
cd <QT_BUILD_ROOT_PATH>
mingw32-make.exe -j64 install
```

> **⚠️ 必须在 PowerShell 中执行**——mingw32-make 内部调用 `/usr/bin/sh` 会导致反斜杠路径被吞掉。

### Windows 构建环境变量

```bat
SET NATIVE_OHOS_SDK=<DEVECO>/sdk/default/openharmony/native
SET OHOS_SDK_SYSROOT=%NATIVE_OHOS_SDK%/sysroot
SET LLVM_INSTALL_DIR=%NATIVE_OHOS_SDK%/llvm
SET QT5_ROOT_DIR=<QT5_12_SRC_PATH>
```

## 🖥️ IDE 与工具路径

| 变量名 | 你的值 | 说明 |
|--------|--------|------|
| `DEVECO_PATH` | `<DEVECO_PATH>` | DevEco Studio 安装路径 |

### MCP 配置文件位置

| IDE | 配置文件路径 |
|-----|------------|
| Trae CN / 国际版 | `<项目根>/.trae/mcp.json` |
| Cursor | `<项目根>/.cursor/mcp.json` |
| VS Code | `<项目根>/.vscode/mcp.json` |
| Claude Desktop (Windows) | `%APPDATA%/Claude/claude_desktop_config.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| OpenCode | `<项目根>/.opencode/config.json` |

## 📌 Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

---
name: ohos-qt-skills
description: Use when users need to compile, build, port, or debug Qt/Qt5/Qt6 applications for HarmonyOS/OpenHarmony/鸿蒙. Use when users mention Qt + HarmonyOS together, ask about Qt API replacement on HarmonyOS, encounter Qt HarmonyOS build errors (CMake find_package fails, dlopen failed, hvigor errors), Qt window/lifecycle issues on HarmonyOS, QtOhosExtras usage, Qt platform limits on HarmonyOS, third-party library cross-compilation for OHOS, or Qt project structure for HarmonyOS.
---

# Qt for HarmonyOS Development

## Overview

**Qt for HarmonyOS 移植参考知识库** — a comprehensive reference for Qt application porting, building, debugging, and deployment on HarmonyOS/OpenHarmony.

This SKILL.md and all knowledge base files below are a **self-contained skill package**. The directory layout:

```
SKILL.md           -> This file (skill entry point)
_index/            -> 索引层：_map, _tags, _dashboard, _task-routing
semantic/          -> 语义知识：API映射, 窗口模型, 生命周期, 平台限制, 模块状态, 构建指南
procedural/        -> 程序知识：移植工作流, 问题分析, 修复验证, Demo生成
episodic/          -> 情景知识：实际移植项目复盘
problems/          -> 错误知识库：编译/构建/运行时实际报错与解决方案（36条）
ohos-common-kb-public/ -> 内嵌的 HarmonyOS 平台通用知识（ArkTS, ArkUI, NAPI, Stage 模型, DevEco 工具链）
skills/            -> Agent skills（kb-init 初始化脚本）
```

**Core principle:** Do NOT load the entire knowledge base. Follow the loading sequence below, load only relevant pages, and trace cross-references (`refs` fields in frontmatter) for deep context.

**Qt version baseline (for validation):**

| Version | Branch | Commit |
|---------|--------|--------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de |

## Loading Sequence (MANDATORY)

When this skill is triggered, follow these steps **in order**:

```
① _index/_task-routing.md    -> Match task type, identify workflow and required pages
② semantic/qt-harmonyos-golden-rules.md  -> Scan 35 golden rules (avoid known traps)
③ _index/_map.md             -> Knowledge map - judge relevance by summary field
④ Load ONLY relevant pages   -> Do NOT load everything
⑤ Trace refs fields          -> Follow cross-references for deep context
```

## Task Routing Quick Reference

Match the user's request to a task type, then load the corresponding pages:

| User says... | Task Type | Load (paths relative to this directory) |
|-------------|-----------|------|
| 移植/迁移/鸿蒙化一个应用 | [A] App Porting | `procedural/qt-app-harmonyos-migration` + `semantic/qt-harmonyos-porting-workflow` + `api-mapping` + `code-patterns` (+ `procedural/fetch-qt-ohos-sdk` if no Qt SDK/templates) |
| 这个API在鸿蒙上怎么替换 | [B] API Replace | `semantic/qt-harmonyos-api-mapping` + `code-patterns` |
| 某个Qt模块是否支持鸿蒙 | [C] Module Support | `semantic/qt-harmonyos-modules` |
| 鸿蒙有什么限制/不能做什么 | [D] Platform Limits | `semantic/qt-harmonyos-platform-limits` |
| 编译失败/构建报错/部署不了 | [E] Build Troubleshoot | `golden-rules` §一 (B1-B12) + `problems/_lookup` + `semantic/qt-harmonyos-build` + `build-run-workflow` |
| 没有Qt SDK/模板工程 | - | `procedural/fetch-qt-ohos-sdk` — 直接 HTTP 下载预编译 SDK + 模板（无需 git clone） |
| 窗口显示异常/对话框行为不对 | [F] Window Issues | `golden-rules` §二 (W1-W6) + `semantic/qt-harmonyos-window-model` |
| 生命周期/closeEvent/接续 | [G] Lifecycle | `semantic/qt-harmonyos-lifecycle` + `golden-rules` §五 (L1-L4) |
| QtOhosExtras怎么用 | [H] QtOhosExtras | `semantic/qt-ohos-extras` |
| Qt6相关 | [L] Qt6 Status | `semantic/qt-harmonyos-qt6-status` |
| 三方库/依赖/交叉编译 | [M] Third-party Libs | `semantic/qt-harmonyos-third-party-libs` |
| DevEco/MCP/工具链 | [N] Toolchain | `ohos-common-kb-public/semantic/deveco-mcp-capabilities` + `ohos-common-kb-public/procedural/deveco-cli-usage-rules` |
| 写个demo/生成测试工程 | [Q] Demo | `procedural/demo-generation` |
| 遇到执行报错/运行时崩溃 | - | **First**: `problems/_lookup` -> search by error message/code/symptom |

See `_index/_task-routing.md` for the full routing table with detailed decision tree.

## Environment Initialization

When the required Qt SDK, HarmonyOS SDK, toolchain, or template is missing, load `skills/kb-init/SKILL.md` and follow its interactive setup flow. Use its scripts for environment detection, dependency installation, SDK/source/template download, local environment generation, and final verification; do not replace the scripted steps with an improvised installation sequence.


| Platform | Download URL | Size |
|----------|-------------|------|
| Windows | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip` | ~49 MB |
| macOS | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-macos-gles.zip` | ~43 MB |
| HarmonyOS | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-harmonyos-gles.zip` | ~42 MB |
| Templates | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/templates-0625.zip` | ~240 KB |

> **Critical**: GitCode requires a browser User-Agent header for release downloads. Without it, requests get HTTP 401. Use `curl -A "Mozilla/5.0"` or PowerShell `-Headers @{ "User-Agent" = "Mozilla/5.0" }`.

## Critical Rules (Inline Quick-Scan)

These are the most common pitfalls. See `semantic/qt-harmonyos-golden-rules.md` for all 35.

### Build & Deploy (Top 5)
- **B1**: CMake must set `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH` before `find_package`
- **B2**: Must link `Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin` (QPA plugin)
- **B3**: `APP_LIBRARY_NAME` must match compiled .so name exactly
- **B9**: qmake `unix` branch must append `:!ohos` - otherwise ohos hits unix branch
- **B10**: QML apps must enable `CMAKE_AUTORCC ON`
- **B12**: SQL driver `libqsqlite.so` must be manually copied to `libs/${ABI_DIR}/sqldrivers/` (same pattern as `libqohosstyle.so`→`styles/`)

### Window Management (Top 3)
- **W1**: `tagWindowOrWidgetAsSubWindowOf()` must be called BEFORE `show()` and `winId()`
- **W3**: Parentless `QDialog` becomes a new main window; must tag or set parent
- **W4**: First window cannot go fullscreen at startup; `show()` first, then `showFullScreen()`
- **W6**: Do NOT rely on `WINDOW_HIDDEN`/`WINDOW_SHOWN` as the only window state sync trigger — WMS can manage visibility without Qt event callbacks

### API/Enum Paths (Top 3)
- **A1**: Close event enum requires full path: `QtOhosExtras::CloseEventRootCause::AbilityClose`
- **A2**: Theme enum requires full path: `QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting`
- **A5**: qtohosextras headers are lowercase only: `#include <QtOhosExtras/qohosappcontext.h>` (NOT CamelCase)
- **A6**: `getCloseEventRootCause()` is a free function, not a member method

### Platform Limits (Top 3)
- **P1**: `chmod()`/`fchmod()` not available - silently fails
- **P2**: `symlink()` not available for third-party apps (EACCES)
- **P3**: `dlopen()` rejects writable paths - only load .so from app lib directory

### Lifecycle (Critical)
- **L1**: `closeEvent()` MUST check `CloseEventRootCause` - Level 2 (AbilityClose) **MUST NOT show UI dialogs**, only silent autoSave
- **L4**: Use `startAbility()` or `startNoUiChildProcess()` for GUI child processes; plain `QProcess` works for headless computation only

## Error Lookup Protocol

When encountering any error (build/runtime/crash):
1. **First**: Search `problems/_lookup.md` by error message, error code, or symptom
2. **Then**: Load the matching problem page for full solution
3. **If not found**: Follow `procedural/framework-issue-analysis.md` for root cause analysis

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Setting `compileSdkVersion`/`targetSdkVersion` in build-profile.json5 | Remove them (B4) |
| Using short enum paths like `QtOhosExtras::AbilityClose` | Use full path: `QtOhosExtras::CloseEventRootCause::AbilityClose` (A1) |
| Using CamelCase headers for qtohosextras | Use lowercase: `<QtOhosExtras/qohosappcontext.h>` (A5) |
| Calling `tagWindowOrWidgetAsSubWindowOf()` after `show()` | Call BEFORE `show()` and `winId()` (W1) |
| Using `QProcess` for GUI child processes | Use `startAbility()` or `startNoUiChildProcess()` for GUI; QProcess for headless only (L4) |
| Not appending `:!ohos` to qmake `unix` scope | Always use `unix:!android:!macx:!ohos` (B9) |
| Popping UI dialog on AbilityClose | Level 2 close MUST NOT show UI - silent autoSave only (L1) |
| Assuming `Q_OS_LINUX` excludes OHOS | `Q_OS_OHOS` implies `Q_OS_LINUX` - check all Linux branches (G1) |
| Not deploying SQL driver to `sqldrivers/` subdirectory | Manually copy `libqsqlite.so` to `libs/${ABI_DIR}/sqldrivers/` (B12) |
| Relying on `WINDOW_HIDDEN`/`WINDOW_SHOWN` for state sync | WMS manages visibility independently of Qt events (W6) |

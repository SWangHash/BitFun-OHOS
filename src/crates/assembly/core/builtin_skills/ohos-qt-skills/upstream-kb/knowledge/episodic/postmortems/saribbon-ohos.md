---
id: episodic-projects-saribbon-ohos
type: episodic
domain: project
tags: [saribbon, harmonyos, qt5.12, ribbon-ui, cmake]
created: 2026-06-26
updated: 2026-06-26
status: active
audience: public
refs: [procedural-qt-app-harmonyos-migration, semantic-qt-harmonyos-modules, semantic-qt-harmonyos-build]
summary: >
  SARibbon v2.5.5 鸿蒙化完整迁移：独立构建文件 + MainWindowExample 应用编译 (48MB HAP)
  + 两个编译问题修复（QDesktopWidget::screen 类型不匹配 + lazy import 语法不兼容）。
  关键发现：SARibbon 源码内 QDesktopWidget API 在 Qt 5.12 OHOS 下返回 QWidget* 而非 QScreen*、
  模板 lazy import 语法需 API 12 beta3、需为项目创建独立 CMakeLists.txt 避免改源码。
  可复用：三方 Qt 库鸿蒙化时保持源码完整性的独立构建文件模式。
---

# SARibbon v2.5.5 鸿蒙化迁移 — 经验总结

## 项目概览

| 字段 | 内容 |
|------|------|
| 时间 | 2026-06-26 |
| 角色 | Qt for HarmonyOS 开发者 |
| 技术栈 | SARibbon v2.5.5 + Qt 5.12.12 + CMake + OHOS SDK |
| 规模 | Ribbon UI 控件库（35 个 .cpp 文件）+ MainWindowExample 示例应用 |
| 状态 | ✅ 已完成（库编译 + 示例应用编译 + HAP 打包） |

## 背景与目标

将 [SARibbon](https://github.com/czyt1988/SARibbon) v2.5.5 迁移到 HarmonyOS 平台。SARibbon 是一个基于 Qt 的 Ribbon 界面控件库，提供类似 Microsoft Office 的功能区界面，适用于工业软件和复杂 UI 应用。v2.5.5 是该仓库明确标注"兼容 Qt 5.12"的版本。

**目标**：编译 SARibbonBar 库 + MainWindowExample 示例，打包为 OHOS HAP。

## 关键技术决策

### 决策 1: 独立构建文件而非修改源码

**背景**：SARibbon 的 CMakeLists.txt 面向桌面平台（Windows/Linux/macOS），直接修改会破坏其他平台。

**选择**：在 `OhosExampleApp/CMakeLists.txt` 中完整定义编译，保留 SARibbon 原始构建系统不变。

**理由**：保持源码完整性，便于后续版本升级和跨平台构建。

**结果**：成功，SARibbon 原始仓库无需任何 fork 或 patch。

### 决策 2: 使用 __attribute__((constructor)) 入口

**背景**：OHOS 平台要求 Qt 应用以 shared library 形式，需要自定义入口点。

**选择**：使用 GCC `__attribute__((constructor))` 和 `__attribute__((destructor))`。

**理由**：OHOS 动态库加载时会自动执行 constructor 函数，比 main() 更符合平台规范。

**结果**：成功，库加载时 QApplication 自动初始化。

### 决策 3: 包含 SARibbonBar 完整源码

**背景**：SARibbonBar 是一个库，需要链接到示例应用。

**选择**：在 OhosExampleApp CMakeLists.txt 中直接包含 SARibbonBar 所有源文件，而非作为独立库链接。

**理由**：OHOS 构建环境复杂，单库构建简化依赖管理。

**结果**：成功，所有符号正确解析，无链接错误。

## 踩过的坑

### 问题 1: QDesktopWidget::screen(int) 返回类型不匹配

**阶段**：C++ 编译阶段  
**现象**：`SARibbonUtil.cpp:225` 编译失败
```
cannot initialize a variable of type 'QScreen*' with an rvalue of type 'QWidget*'
if (QScreen* sc = dw->screen(idx))
```

**根因**：SARibbon 源码 `#if QT_VERSION < QT_VERSION_CHECK(5, 14, 0)` 分支中，误用了 `QDesktopWidget::screen(int)` 的返回值。在 Qt 5 中，该方法返回 `QWidget*`（已废弃），而非 `QScreen*`。这是 SARibbon 仓库自身的 bug。

**修复**：替换为正确的 Qt 5 API
```cpp
// 修复前
if (QScreen* sc = dw->screen(idx))

// 修复后（使用 QGuiApplication::screens()）
QList<QScreen*> screens = QGuiApplication::screens();
if (idx >= 0 && idx < screens.size()) {
    QScreen* sc = screens.at(idx);
    return sc->devicePixelRatio();
}
```

**教训**：三方库代码可能存在平台特定 bug，交叉编译时会暴露。修复时需查阅 Qt 5 官方文档确认 API 签名。

### 问题 2: template 胶水代码的 lazy import 语法不兼容

**阶段**：ArkTS 编译阶段  
**现象**：`OhosExportModules.ts` 编译失败
```
Current configuration does not support using lazy import. 
Lazy import can be used in the beta3 version of API 12 or higher versions.
```

**根因**：Qt 5.12 OHOS 模板文件使用了 `import lazy` 语法，但当前 DevEco Studio 配置的 `compatibleSdkVersion = "5.0.0(12)"` 不支持此语法（需要 API 12 beta3）。

**修复**：移除所有 `import lazy` 的 `lazy` 关键字
```typescript
// 修复前
import lazy { xxx } from '@kit.XxxKit';

// 修复后
import { xxx } from '@kit.XxxKit';
```

**教训**：OHOS 胶水模板可能包含新语法，使用前需检查 SDK 版本兼容性。`lazy import` 是优化手段，移除不影响功能。

## 工程结构

```
project/saribbon-ohos/
├── SARibbon/                          (tag v2.5.5)
│   ├── CMakeLists.txt                 (原始，未改动)
│   ├── src/                           (SARibbonBar 库源码，未改动)
│   ├── example/MainWindowExample/     (示例源码，未改动)
│   ├── OhosExampleApp/                (★ 新增)
│   │   ├── CMakeLists.txt             (OHOS 构建配置)
│   │   └── main.cpp                   (constructor 入口)
│   └── HarmonyOS/                     (★ 新增)
│       ├── entry/libs/arm64-v8a/libOhosSARibbonExample.so
│       └── ...
├── qt_env.md                          (环境配置)
├── qt_compile_plan.md                 (编译计划)
├── compile_fix_pro.md                 (问题修复记录)
└── qt_summary_saribbon.md             (项目总结)
```

## 可复用的经验

1. **三方库鸿蒙化策略**：保持源码完整，创建独立构建文件（如 `OhosExampleApp/CMakeLists.txt`），避免 fork 或 patch 原始仓库。

2. **Qt 5 API 陷阱**：`QDesktopWidget::screen(int)` 在 Qt 5 返回 `QWidget*`（已废弃），Qt 5.14+ 才提供 `QScreen*` 版本。跨版本代码需条件编译。

3. **OHOS template lazy import**：Qt OHOS 模板可能包含新语法，遇到 `lazy import` 错误时直接移除 `lazy` 关键字即可，不影响功能。

4. **入口点选择**：OHOS 动态库使用 `__attribute__((constructor))` 初始化 Qt 环境，比自定义 main() 更符合平台规范。

5. **单库构建简化依赖**：将库源码直接包含到应用 CMakeLists.txt，避免多库链接的依赖管理复杂性。

## 相关资源

- [[procedural-qt-app-harmonyos-migration]] — Qt 应用鸿蒙化迁移流程
- [[semantic-qt-harmonyos-modules]] — Qt OHOS 模块支持状态
- [[semantic-qt-harmonyos-build]] — Qt OHOS 构建指南
- [[episodic-projects-coin3d-quarter-ohos]] — Coin3D Quarter OHOS 迁移（类似项目）

## 文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| SARibbon 源码 | `project/saribbon-ohos/SARibbon/` | tag v2.5.5，未修改 |
| OHOS 构建配置 | `project/saribbon-ohos/SARibbon/OhosExampleApp/CMakeLists.txt` | 独立构建文件 |
| 入口点 | `project/saribbon-ohos/SARibbon/OhosExampleApp/main.cpp` | constructor/destructor |
| 编译计划 | `project/saribbon-ohos/qt_compile_plan.md` | 完整编译步骤 |
| 问题记录 | `project/saribbon-ohos/compile_fix_pro.md` | 2 个编译问题修复 |
| 项目总结 | `project/saribbon-ohos/qt_summary_saribbon.md` | 环境、版本、验证 |
| HAP 产物 | `project/saribbon-ohos/SARibbon/HarmonyOS/entry/libs/arm64-v8a/libOhosSARibbonExample.app` | 48 MB |

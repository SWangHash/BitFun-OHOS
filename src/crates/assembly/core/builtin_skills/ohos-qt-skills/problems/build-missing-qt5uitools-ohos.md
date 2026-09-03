---
id: problem-ohos-missing-qt5uitools
type: problem
domain: build
tags: [qt5, ohos, cmake, uitools, missing-module]
created: 2026-06-08
updated: 2026-06-08
status: workaround
audience: public
severity: medium
error_message: "CMake Error: find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET) 失败 (OHOS Qt5 SDK 缺 Qt5UiTools 模块)"
refs: [semantic-qt-harmonyos-modules]
summary: >
  OHOS Qt5 SDK 不含 Qt5UiTools 模块，导致 find_package(Qt5 COMPONENTS UiTools) 失败。
  需从 find_package 列表中移除 UiTools 或从 Qt 源码编译该模块。
---

# OHOS Qt5 SDK 缺失 Qt5UiTools 模块

## 错误信息

```
CMake Error: find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET) 失败
```

或当 fallback 到 Qt4 时：

```
CMake Error at FindQt4.cmake:1314 (message):
  Found unsuitable Qt version "5.12.12" from
  <LOCAL_PATH>, this code requires Qt 4.x
```

## 触发场景

- 交叉编译依赖 `Qt5::UiTools` 的第三方 Qt 库（如 Coin3D Quarter）
- OHOS Qt 5.12 和 5.15 的 SDK 均缺少此模块

## 根因

OHOS Qt SDK（`<LOCAL_PATH>` 和 `<LOCAL_PATH>`）不包含 `Qt5UiTools` cmake 配置目录。

Qt5UiTools 提供 `QUiLoader`（运行时加载 .ui 文件），在多数项目中仅 examples 使用，核心库通常不依赖。

> **⚠️ 根因修正（2026-07-08 lzh 确认）**：wiki 标 QtHelp/QtUiTools/QtDesigner **Completed**（已鸿蒙化），但 **qttools 模块的依赖只能在鸿蒙PC上主机编译（host build on HarmonyOS PC），Windows 交叉编译搞不定**。所以从 Windows 交叉编译的 OHOS Qt5 SDK（如 `<QT5_15_OHOS_SDK>`、`<QT5_15_OHOS_SDK_FULL>`）天然不含 Qt5UiTools/Qt5Help——这不是 SDK 打包遗漏，是**构建方式限制**。要补齐需在鸿蒙PC上主机编译 qttools 后部署。

## OHOS SDK 可用的 Qt5 模块

通过 `ls lib/cmake/` 确认：

| Qt 5.12 | Qt 5.15 |
|---------|---------|
| Qt5Concurrent | Qt5Concurrent |
| Qt5Core | Qt5Core |
| Qt5DocGallery | - |
| Qt5Gui | Qt5Gui |
| Qt5Network | Qt5Network |
| Qt5OhosExtras | Qt5OhosExtras |
| Qt5OpenGL | Qt5OpenGL |
| Qt5OpenGLExtensions | Qt5OpenGLExtensions |
| Qt5PrintSupport | Qt5PrintSupport |
| Qt5Qml | Qt5Qml |
| Qt5Quick | Qt5Quick |
| Qt5QuickCompiler | Qt5QuickCompiler |
| Qt5QuickTest | Qt5QuickTest |
| Qt5QuickWidgets | Qt5QuickWidgets |
| Qt5Sql | Qt5Sql |
| Qt5Svg | Qt5Svg |
| Qt5Test | Qt5Test |
| Qt5Widgets | Qt5Widgets |
| Qt5Xml | Qt5Xml |
| **Qt5UiTools ❌** | **Qt5UiTools ❌** |

## 解决方案

1. **从 find_package 中移除 UiTools**（推荐）：
   ```cmake
   # Before:
   find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET)
   # After:
   find_package(Qt5 COMPONENTS Widgets OpenGL QUIET)
   ```

2. **从 link targets 中移除**：
   ```cmake
   # Before:
   set(QUARTER_QT_TARGETS Qt5::Widgets Qt5::UiTools Qt5::OpenGL)
   # After:
   set(QUARTER_QT_TARGETS Qt5::Widgets Qt5::OpenGL)
   ```

3. **如果需要 UiTools 功能**：**只能在鸿蒙PC上主机编译 qttools**（host build on HarmonyOS PC），产物部署到 SDK。**Windows 交叉编译搞不定**（qttools 依赖决定，2026-07-08 lzh 确认）——不要尝试从 Windows 定向 qmake `qttools/src/assistant` 或 `src/designer/src/uitools` 交叉编译。

## 经验

交叉编译第三方 Qt 库前，先用 `ls <QT_SDK>/lib/cmake/` 扫描可用模块，提前识别缺失依赖。

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | Coin3D Quarter 交叉编译时发现，5.12 和 5.15 SDK 均验证确认 |

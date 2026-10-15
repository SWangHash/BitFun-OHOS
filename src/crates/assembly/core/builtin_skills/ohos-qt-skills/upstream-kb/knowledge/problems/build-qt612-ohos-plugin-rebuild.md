---
id: problem-build-qt612-ohos-plugin-rebuild
type: problem
domain: build
tags: [qt612, libqohos, platform-plugin, cmake, BUILD_SUBMODULES, node-addon-api, fontconfig, FIND_ROOT_PATH, kit替换]
created: 2026-09-12
updated: 2026-09-12
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-build]
summary: >
  修补 Qt 6.12-beta3 harmonyos kit 的 ohos 平台插件（libqohos.so）不能走常规
  qt-cmake，须 cmake + BUILD_SUBMODULES=src/plugins/platforms；配置期五连坑：
  qt-cmake 拒绝构建 qtbase 本体、缺 NODE_ADDON_API_ROOT、交叉工具链
  FIND_ROOT_PATH_MODE_INCLUDE=ONLY 重根化导致 find_path 永远失败、缺
  OHOS_SDK_ROOT/OHOS_NDK_ROOT、QT_FEATURE_fontconfig 条件作用域看不到
  Fontconfig_FOUND。重编产物必须替换 kit 内原文件（harmonydeployqt 从 kit 部署）。
leader_summary: >
  建立 Qt 6.12 OHOS 平台插件重编工作流：cmake BUILD_SUBMODULES + 预填 find cache +
  gui CMakeLists 条件放开 + kit 替换部署 + SONAME 差异补齐
impact: [构建体系, 平台后端]
deliverables: [problem记录]
evidence: []

error_message: >
  ① qt-cmake: "Call Stack ... qt_auto_detect_cyclic_toolchain ... configure qtbase
  with 'cmake' instead of 'qt-cmake'"
  ② ERROR: Qt for OHOS requires node-api-addon. Set NODE_ADDON_API_ROOT to point to its location.
  ③ CMake Error at cmake/QtPriHelpers.cmake:908 (file): file FILE([TO_CMAKE_PATH|TO_NATIVE_PATH]
  path result) must be called with exactly three arguments.
  ④ Target "QOhosPlatformIntegrationPlugin" links to: Fontconfig::Fontconfig ... the target was not found.
  ⑤ fatal error: 'QtGui/private/qfontconfigdatabase_p.h' file not found
error_code: ""
keywords: [libqohos, BUILD_SUBMODULES, NODE_ADDON_API_ROOT, node-addon-api, OHOS_SDK_ROOT, OHOS_NDK_ROOT, Fontconfig, CMAKE_FIND_ROOT_PATH_MODE_INCLUDE, QT_FEATURE_fontconfig, harmonydeployqt]
symptoms: "需要在 Qt 6.12 harmonyos kit 上重编 ohos 平台插件（修 QPA bug/加探针），configure 阶段连环失败；或编出的新插件装机后不生效/加载失败"
environment: "Windows + Qt 6.12-beta3 harmonyos_arm64_v8a kit + OHOS SDK (ohos.toolchain.cmake) + Ninja"
---

# Qt 6.12 OHOS 平台插件（libqohos.so）重编五连坑与部署

## 场景

Qt 6.12-beta3 harmonyos kit 的 ohos 平台插件有 bug（如 IME reset 问题）或需要加
诊断探针，必须重编 `libqohos.so` 并让设备上的应用真正用上。

## 坑 1：qt-cmake 拒绝构建 qtbase 本体

`qt-cmake` 会触发 `qt_auto_detect_cyclic_toolchain` 保护，报
"configure qtbase with 'cmake' instead of 'qt-cmake'"。

**正确姿势**——用 SDK 的 cmake + 子模块裁剪：

```powershell
& '<sdk>/native/build-tools/cmake/bin/cmake.exe' `
  -S '<Qt>/6.12.0/Src/qtbase' `
  -B '<build-dir>' -G Ninja -DCMAKE_BUILD_TYPE=Release `
  '-DCMAKE_TOOLCHAIN_FILE=<sdk>/native/build/cmake/ohos.toolchain.cmake' `
  -DOHOS_ARCH=arm64-v8a `
  '-DOHOS_SDK_ROOT=<sdk>/default/openharmony' `      # 坑 4
  '-DQT_HOST_PATH=<Qt>/6.12.0/mingw_64' `
  '-DNodeAddonApi_INCLUDE_DIR=<node-addon-api 目录>' `  # 坑 2+3
  '-DFontconfig_INCLUDE_DIR=<ohos fontconfig>/include' `
  '-DFontconfig_LIBRARY=<ohos fontconfig>/lib/libfontconfig.so' `
  -DBUILD_SUBMODULES=src/plugins/platforms `
  -DFEATURE_egl=ON -DFEATURE_opengl=ON

ninja -C <build-dir> QOhosPlatformIntegrationPlugin
# 产物：<build-dir>/plugins/platforms/libqohos.so
```

## 坑 2：Qt for OHOS 必需 node-addon-api

qtbase 的 OHOS 移植用 NAPI 桥（corelib 依赖 NodeAddonApi），Qt 6.12 源码树**不再
内置** `src/3rdparty/node-addon-api`。报错：

```
ERROR: Qt for OHOS requires node-api-addon. Set NODE_ADDON_API_ROOT to point to its location.
```

取一份 node-addon-api（7.x 可用；Qt 5.15 harmonyos 源码树里有现成副本可复用），
配 `NODE_ADDON_API_ROOT` 环境变量或 `-DNodeAddonApi_INCLUDE_DIR=<dir>`。

## 坑 3：交叉工具链把 find_path 的 HINTS 重根化（环境变量无效）

`ohos.toolchain.cmake` 设置 `CMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY`，find_path
对主机路径的 HINTS 全部被重根到 sysroot → **`NODE_ADDON_API_ROOT` 环境变量设了也
找不到**。

**正确姿势**：直接预填 find 模块的 **cache 变量**，find_path 见值即用、跳过搜索：

```
-DNodeAddonApi_INCLUDE_DIR=...
-DFontconfig_INCLUDE_DIR=...
-DFontconfig_LIBRARY=...
```

（fontconfig 等 Linux 系库 OHOS sysroot 没有，用 portgraph/workspace/ohos-libs 里的
预编译版本。）

## 坑 4：OHOS_NDK_ROOT 为空 → QtPriHelpers 报参数错误

直接传 `CMAKE_TOOLCHAIN_FILE` 会跳过 Qt 的 auto-detect，`OHOS_NDK_ROOT` 未定义，
`QtPriHelpers.cmake:908` 的 `file(TO_CMAKE_PATH ${OHOS_NDK_ROOT} ...)` 展开成空 →
"must be called with exactly three arguments"。

**修复**：加 `-DOHOS_SDK_ROOT=<sdk>/default/openharmony`，Qt 会自动派生
`OHOS_NDK_ROOT=<...>/native`。

## 坑 5：QT_FEATURE_fontconfig 被条件作用域强制 OFF（-D 开不上去）

ohos 插件的 `qohosplatformfontdatabase_p.h` include
`QtGui/private/qfontconfigdatabase_p.h`，该转发头仅在 fontconfig feature ON 时由
Gui 生成。症状链：

```
Fontconfig::Fontconfig target not found（先补坑 3 的 cache 变量）
→ fatal error: 'QtGui/private/qfontconfigdatabase_p.h' file not found
```

**根因**：Qt feature 的 CONDITION 在**嵌套函数作用域**求值
（`qt_evaluate_config_expression` → `qt_internal_evaluate_config_expression`），
`qt_find_package(Fontconfig)` 设置的 `Fontconfig_FOUND` **普通变量**在该作用域不可
见 → 条件恒假。实测 `-DQT_FEATURE_fontconfig=ON` 与 `-DFontconfig_FOUND=TRUE` 均
无效（INTERNAL 计算值覆盖 / 被 unset）。

**修复**（本地 patch qtbase 源码，放开 Gui 的源集条件）：

```cmake
# src/gui/CMakeLists.txt
qt_internal_extend_target(Gui CONDITION OHOS OR (QT_FEATURE_fontconfig AND QT_FEATURE_freetype AND UNIX AND NOT APPLE)
    SOURCES
        text/unix/qfontconfigdatabase.cpp text/unix/qfontconfigdatabase_p.h
        ...
)
```

## 部署：必须替换 kit，不能只改部署目录

`harmonydeployqt` 每次都从 **kit** 复制插件到 HAP 工程——直接改工程 libs 目录会在
下一次 deploy 时被旧文件覆盖。

```
① 备份：<kit>/plugins/platforms/libqohos.so → libqohos.so.kit-orig
② 覆盖：copy <build-dir>/plugins/platforms/libqohos.so <kit>/plugins/platforms/
③ 重打包：make_hap（deploy 会带上新插件）
```

**SONAME 差异坑**：自编 libqohos.so 若链接了 portgraph 的 fontconfig，NEEDED 变成
`libfontconfig.so.1`（kit 原版是 `libfontconfig.so`）→ HAP libs 目录需补一份
`libfontconfig.so.1`，否则插件 dlopen 失败。用
`llvm-readobj --needed-libs` 对比新旧插件确认依赖闭包。

## 验证

```
ninja QOhosPlatformIntegrationPlugin          # [N/N] Linking ... libqohos.so
llvm-readobj --needed-libs <新libqohos.so>     # 对照 kit 原版 NEEDED 差异
hdc install -r <signed.hap> && hdc shell pidof <bundle>   # 装机存活
```

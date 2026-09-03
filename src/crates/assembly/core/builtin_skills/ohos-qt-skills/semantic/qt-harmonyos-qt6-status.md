---
id: semantic-qt-harmonyos-qt6-status
type: semantic
domain: tech
tags: [qt, qt6, harmonyos, ohos, status, cmake]
created: 2026-06-03
updated: 2026-08-25
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-build, semantic-qt-harmonyos-modules, semantic-qt-harmonyos-platform-limits, semantic-qt-ohos-project-analyzer-workflow]
summary: >
  Qt 6 鸿蒙化状态：qtbase dev 已合并 HarmonyOS 支持（Gerrit 733351），
  最低 SDK API 20（HarmonyOS 6.0.0），CMake 构建系统。
  **Qt 6.12.0 Windows superbuild 已验证（2026-07-13）**：MinGW host + OHOS Clang target，
  gallery demo 真机运行通过（"Widget Gallery Qt 6.12.0"）。
  **⚠️ 2026-07-25 重大修正：Qt 6.12 预构建安装器 SDK 是完整发行版**（libQt6Quick.so/Multimedia/
  Charts/3D/OpenGL/DataVisualization/Bluetooth/Location/Sensors/SerialBus/UiTools/Core5Compat 全在,
  QtQuick qml runtime 全在），仅缺 WebEngine/DBus/Wayland/Pdf/Script。本文旧记"非 qtbase 未开始"
  "Quick .so absent""Multimedia missing"是**源码 superbuild（策略 B）**时代过时记录，对**预构建（策略 B'）**不成立。
  第 2 批 10 应用（MathMod/SolveSpace/CopyQ/SQLiteStudio 等用 opengl/qml/uitools）全编译成功佐证。
  **⚠️ 2026-08-25 beta3 复核**：Qt6HarmonyExtras 重新独立成模块（libQt6HarmonyExtras.so + cmake，公开头仅 exports/version 桩，16 个功能头全私有 `_p.h`）——翻 beta2「不作为独立模块存在」结论；文件权限授予=QtCore `QPermissions` 公开 API（无文件类权限类型，仅定位/日历/联系人/蓝牙/相机/麦克风）+ `QtHarmonyExtras::FileShare::persistPermission` 私有 API（对应鸿蒙 `@ohos.fileshare`）。
  Qt5→Qt6 关键差异（QStandardPaths、CMake API、QML、QPA API）。
---

# Qt 6 for HarmonyOS 状态

> **一句话**：Qt 6 鸿蒙化已在 qtbase dev 主干分支落地，当前处于早期阶段（仅 qtbase），其余模块尚未适配。

## 当前状态

| 项目 | 内容 |
|------|------|
| **合并状态** | ✅ Gerrit change [733351](https://codereview.qt-project.org/c/qt/qtbase/+/733351) 已合并到 qtbase dev |
| **最低 SDK** | HarmonyOS SDK **API 20**（HarmonyOS 6.0.0） |
| **目标架构** | arm64-v8a |
| **已完成模块（源码 superbuild，策略 B）** | 仅 **qtbase** + 5 子模块（qtsvg/qtimageformats/qtshadertools/qtlanguageserver/qtdeclarative）。**非 qtbase 模块（Multimedia/3D/Charts 等）源码无鸿蒙适配**。 |
| **已完成模块（预构建安装器，策略 B'）** | ⚠️ **完整 Qt6.12 发行版**（2026-07-25 ground-truth 复核）：libQt6Quick/Multimedia/Charts/3DCore/3DRender/OpenGL/OpenGLWidgets/DataVisualization/Bluetooth/Location/Positioning/Sensors/SerialBus/UiTools/Core5Compat/WebSockets/SerialPort/PrintSupport/Svg/SvgWidgets/Help/Designer/NetworkAuth/TextToSpeech/HttpServer/ShaderTools/Qml/QmlModels/QuickWidgets/QuickControls2/Quick3D 全在，QtQuick qml runtime（Controls/Dialogs/Layouts）全在。**仅缺 WebEngine/DBus/Wayland/Pdf/Script**。 |
| **构建系统** | **CMake**（Qt 6 全面使用 CMake，不再使用 qmake/configure） |

> ⚠️ **重要**：上表"已完成模块"按**构建方式**分两行。apps.csv / KB 旧记中"非 qtbase 未开始""Quick .so absent""Multimedia missing"等阻断结论均针对**源码 superbuild（策略 B）**，对**预构建安装器（策略 B'）不成立**——预构建是完整发行版。第 2 批 10 应用（MathMod/SolveSpace/CopyQ/SQLiteStudio 等用 opengl/qml/uitools）用预构建全编译成功佐证（见 第 2 批编译复盘）。收到 Qt6 项目鸿蒙化需求时**优先用预构建（策略 B'）**，勿因旧"模块缺失"结论直接判阻断。

## 源码获取

```bash
# Qt 6 主干（dev 分支）
# 本地路径：<LOCAL_PATH>
git clone https://code.qt.io/qt/qtbase.git
cd qtbase
# dev 分支已包含 HarmonyOS 支持
```

## 构建方式

Qt 6 构建与 Qt 5 有根本性差异：

| 维度 | Qt 5 for OHOS | Qt 6 for OHOS |
|------|---------------|---------------|
| 构建系统 | `configure` + `make` | **CMake** |
| 编译命令 | `../configure -xplatform ohos-clang ...` | `cmake -GNinja -DQT_HOST_PATH=... -DCMAKE_TOOLCHAIN_FILE=...` |
| 模块管理 | qmake `.pro` 文件 | CMake `qt_add_executable` / `qt_add_qml_modules` |
| QML 导入 | `import QtQuick 2.x` | `import QtQuick`（无版本号） |
| C++ 标准 | C++14 | **C++17**（最低要求） |

详细构建步骤：参见 [Building Qt6 for HarmonyOS](https://wiki.qt.io/Building_Qt6_for_HarmonyOS)

## Qt 5 vs Qt 6 关键差异（鸿蒙化相关）

### QStandardPaths 新枚举

Qt 6 新增了若干 `QStandardPaths::StandardLocation` 枚举值，以下映射已从 Qt6 qtbase 源码（`qstandardpaths_ohos.cpp`）验证：

| Qt 6 枚举 | OHOS 映射 | Qt 5 状态 |
|-----------|----------|-----------|
| `PublicShareLocation` | ❌ **NOT SUPPORTED**（返回空字符串） | ❌ 不存在 |
| `TemplatesLocation` | ❌ **NOT SUPPORTED**（返回空字符串） | ❌ 不存在 |
| `StateLocation` | ✅ 映射到 `filesDir` | ❌ 不存在 |
| `GenericStateLocation` | ✅ 映射到 `filesDir` | ❌ 不存在 |

> ⚠️ **行为变更**：`AppLocalDataLocation` 在 Qt 5 for OHOS 上映射到 `filesDir`，但在 Qt 6 中映射到 **`preferencesDir`**。迁移时需注意路径差异。

### CMake API 变更

| Qt 5 | Qt 6 | 说明 |
|------|------|------|
| `find_package(Qt5 ...)` | `find_package(Qt6 ...)` | 包名变更 |
| `qt5_add_resources()` | `qt_add_resources()` | 去掉版本号前缀 |
| 无 | `qt_add_qml_modules()` | Qt 6 QML 模块声明 |
| `add_executable()` | `qt_add_executable()` | Qt 6 推荐使用 |

### QML 变更

| Qt 5 | Qt 6 | 说明 |
|------|------|------|
| `import QtQuick 2.15` | `import QtQuick` | 无版本号导入 |
| `import QtQuick.Controls 2.15` | `import QtQuick.Controls` | 同上 |
| `QtQuick.Controls` 模块在 OHOS SDK 中缺失 | — | ⚠️ **源码 superbuild（策略 B）**：不在 qtbase 中，属于独立模块（qtdeclarative/qtquickcontrols2），需单独适配。**预构建安装器（策略 B'）**：libQt6QuickControls2.so + qml/QtQuick/Controls runtime **全在**（2026-07-25 ground-truth 复核），无需单独适配。CopyQ（qml）用预构建编译成功佐证（第 2 批编译复盘）。 |

### 其他变更

| 变更 | 影响 |
|------|------|
| `QFuture::then()` / `QPromise` | Qt 6 新增并发 API，Qt 5 需用 `QtConcurrent::run()` 替代 |
| `core5compat` 模块 | Qt 6 提供的 Qt 5 兼容层，部分 API 可通过此模块过渡 |
| 构建产物路径 | Qt 6 CMake 输出路径可能与 Qt 5 不同，影响 `QtAppConstants.ets` 中的 `APP_LIBRARY_NAME` |

### QPA 插件 API 变更（从源码验证）

Qt 6 将原 QtOhosExtras 模块的大部分功能**内联到了 QPA 插件中**（`src/plugins/platforms/ohos/`，196 个文件）。以下是关键 API 差异：

> ⚠️ **2026-08-25 beta3 复核修正**：beta3 起 QtHarmonyExtras **重新独立成模块**（`lib/libQt6HarmonyExtras.so` + `lib/cmake/Qt6HarmonyExtras/` + `Qt6HarmonyExtrasPrivate/` cmake target），但**公开头仅 `qtharmonyextrasexports.h`/`qtharmonyextrasversion.h` 两个桩**，16 个功能头（abilitycontext/appcontext/bundlemanager/fileshare/fileutils/pasteboard/sharekit/want/windowutils 等）**全私有 `_p.h`**。即"模块回归独立"但"公开 API 面仍空"。下表 API 差异基于源码 dev 时代记录；beta3 模块化后这些功能仍存于私有头中，签名未公开化。详见下方「Qt6 beta3 文件权限授予接口」节与已知问题 #2。

#### 关闭事件 API — 重大变更

| 维度 | Qt 5（QtOhosExtras） | Qt 6（QPA 内部） |
|------|---------------------|-----------------|
| 枚举名 | `CloseEventRootCause` | `CloseRootCause`（**private** `_p.h`） |
| `InternalClose` | ✅ 存在 | ❌ 移除（替换为 `NotSpecified`） |
| `AbilityClose` | ✅ 存在 | ⚠️ 更名为 `OnPrepareToTerminate` |
| `WindowStageClose` | ✅ 存在 | ✅ 存在（同名） |
| `SubWindowClose` | ❌ 不存在 | ✅ **新增** |
| 获取函数 | `getCloseEventRootCause(QCloseEvent*)` 公开 API | `getCloseRootCauseForEventOrDefault(QEvent*)` **私有 API** |

> ⚠️ **关键差异**：Qt 6 的关闭事件 API 目前是**私有内部 API**（`_p.h` 头文件），尚无公开接口。这意味着 Qt 5 中使用 `QtOhosExtras::getCloseEventRootCause()` 的代码在 Qt 6 中**无法直接迁移**，需要等待公开 API 或通过 QtOhosExtras Qt 6 版本提供。

#### 窗口标记 API — 保持一致

| API | Qt 5 | Qt 6 |
|-----|------|------|
| `tagWindowOrWidgetAsSubWindowOf` | `QOhosFunctions` (public) | `QPlatformNativeInterface` (internal) ✅ |
| `tagWindowOrWidgetAsMainWindow` | `QOhosFunctions` (public) | `QPlatformNativeInterface` (internal) ✅ |
| `tagWindowOrWidgetAsFloatWindow` | `QOhosFunctions` (public) | `QOhosQpaFunctions` (internal) ✅ |

> 函数签名一致，但 Qt 6 中通过 `QPlatformNativeInterface` 访问而非公开的 `QOhosFunctions` 类。公开 API 取决于 QtOhosExtras 的 Qt 6 版本。

#### ShareKit API — 接口变更

| 维度 | Qt 5 | Qt 6 |
|------|------|------|
| 命名空间 | `QtOhosExtras::ShareKit` | `QOhosShareKit`（内部） |
| 分享函数 | `shareDataWithShareKit()` | `shareDataUsingShareKit()` |
| 记录类型 | `QOhosSharedRecord` | `ShareKit::SharedRecord` |

## Qt6 beta3 文件权限授予接口（2026-08-25 复核）

> 鸿蒙文件访问权限分三层，Qt6 beta3 覆盖情况如下（基于本地 `${QT6_INSTALLER_ROOT}/6.12.0/harmonyos_arm64_v8a` 头文件 ground-truth）。

### (1) 公开跨平台 `QPermissions` API（QtCore，公开头）

- 头：`include/QtCore/qpermissions.h`（公开，非 `_p`）；OHOS 后端 `include/QtCore/6.12.0/QtCore/private/qohospermissionshelper_p.h`（私有）
- 入口：`QCoreApplication::checkPermission(const QPermission&)` → `Qt::PermissionStatus`（同步查）；`QCoreApplication::requestPermission(const QPermission&, context, functor)`（异步请求授权弹窗，见 `qcoreapplication.h:131-165`）
- 状态枚举：`Qt::PermissionStatus{Undetermined, Granted, Denied}`（`qnamespace.h:1766`）
- 内置权限类型**仅 6 种**：`QLocationPermission` / `QCalendarPermission` / `QContactsPermission` / `QBluetoothPermission` / `QCameraPermission` / `QMicrophonePermission`
- ⚠️ **无 `QFilePermission` / `QStoragePermission` / `QMediaPermission` 类型** — 文件/存储/媒体访问**不在** Qt6 公开权限 API 里

### (2) 鸿蒙文件持久化授权（QtHarmonyExtras，私有 `_p.h`）

- 头：`include/QtHarmonyExtras/6.12.0/QtHarmonyExtras/private/qohosfileshare_p.h`
- 命名空间：`QtHarmonyExtras::FileShare`
- API：`persistPermission(QList<PathPolicy>)` / `revokePermission` / `activatePermission` / `deactivatePermission` / `checkPersistent`
- `PathPolicy{QString path; OperationModes(Read|Write)}` — 对指定文件/目录路径持久化读写授权
- 对应鸿蒙原生 `@ohos.fileshare` 的 `grantPersistPermission`，需 `ohos.permission.FILE_ACCESS_PERSIST`
- ⚠️ **私有 API**，版本间无 ABI 保证，生产慎用

### (3) 临时文件授权（未封装，走鸿蒙原生）

- Qt 未封装文件选择器；走鸿蒙 `@ohos.file.picker`（`DocumentViewPicker` / `PhotoViewPicker`），picker 返回 URI 带临时读写权限，应用退出/重启失效
- 要跨重启保留 → 接 (2) `FileShare::persistPermission`，或原生 `@ohos.fileshare`

> **结论**：Qt6 beta3 没给"文件权限授予"公开封装。临时授权走鸿蒙 picker（无 Qt 封装），持久授权走 `QtHarmonyExtras::FileShare::persistPermission`（私有 `_p.h`）。公开 `QPermissions` 只管定位/日历/联系人/蓝牙/相机/麦克风 6 类，文件不在其中——收到"Qt6 应用如何申请文件读写权限"类需求时，勿指向 Qt 权限 API，应指引鸿蒙原生 `abilityAccessCtrl.requestPermissionsFromUser` + `@ohos.file.picker` + `@ohos.fileshare`。

## 模块适配状态

Qt 6 模块适配状态**独立于 Qt 5**，当前仅 qtbase 模块已合并。

| 模块分类 | Qt 5 状态 | Qt 6 状态 |
|---------|----------|----------|
| **qtbase**（Core/Gui/Widgets/Network/Qml/Quick） | ✅ Completed | ✅ 已合并到 dev |
| **qtbase**（Test/Sql/Concurrent/OpenGL） | ✅ Completed | ✅ 已验证：Test 有 OHOS hilog 集成，Sql/Concurrent/OpenGL 无需 OHOS 特定代码 |
| **非 qtbase**（Multimedia/3D/Charts/...） | ✅/❌ 见 [[qt-harmonyos-modules]] | ⚠️ **源码 superbuild（策略 B）❌ 未开始**。**预构建安装器（策略 B'）✅ 全在**：libQt6Multimedia/Charts/3DCore/3DRender/OpenGL/OpenGLWidgets/DataVisualization/Bluetooth/Location/Positioning/Sensors/SerialBus/UiTools/Core5Compat/WebSockets/SerialPort/Svg/SvgWidgets/Help/Designer/NetworkAuth/TextToSpeech/HttpServer/ShaderTools/Qml/Quick/QuickControls2/Quick3D 全在（2026-07-25 ground-truth，见 第 2 批编译复盘 决策 1）。**仅 WebEngine/DBus/Wayland/Pdf/Script 缺失**。 |
| **QtOhosExtras**（Qt5 名）/ **QtHarmonyExtras**（Qt6 beta3 名） | ✅ Completed | ⚠️ **beta2**：不作为独立模块，功能分散到 `corelib/platform/ohos/`（QOhosAppContext）和 `plugins/platforms/ohos/`（startAppProcess、ShareKit、窗口标记等），全私有 `_p.h`。**beta3（2026-08-25 复核）**：重新独立为 `Qt6HarmonyExtras` 模块（`libQt6HarmonyExtras.so` + cmake），但公开头仅 exports/version 桩，16 个功能头全私有 `_p.h`。 |

详细 Qt 6 模块状态：参见 [Qt for HarmonyOS Module Adaptation Status](https://wiki.qt.io/Qt_for_HarmonyOS)（wiki 页面中 Qt6 部分）

## Qt 6 项目适配策略

当前 Qt for HarmonyOS 的主力分支仍是 **Qt 5.12.12 / 5.15.16**。如果收到 Qt 6 项目的鸿蒙化需求，有两种策略：

### 策略 A：降级到 Qt 5（推荐，当前可行）

详见 [[qt-ohos-project-analyzer-workflow]] §Qt6 项目 → Qt5 兼容性评估：
1. 检测源码中的 Qt 6 独有特性
2. 查找项目的 Qt 5 兼容分支或 tag
3. 使用 `QT_VERSION_CHECK` 宏做条件编译

### 策略 B：使用 Qt 6.12 superbuild（✅ 推荐，Windows 已验证）

> **2026-07-13 验证**：Qt 6.12.0（`c7581743`）在 Windows + MinGW g++ 13.1.0 host + OHOS Clang 15.0.4 target（API 23, HarmonyOS 6.1.0）上**可编译**，superbuild 一次 configure 全部子模块（qtbase/qtsvg/qtimageformats/qtshadertools/qtlanguageserver/qtdeclarative），gallery demo 已在 HUAWEI MateBook 14 真机运行通过（"Widget Gallery Qt 6.12.0"）。需 4 项 Windows 额外配置 + DT_NEEDED patch，无需源码补丁。

1. 基于 Qt **6.12.0**（`c7581743`）用 superbuild 方式编译，MinGW g++ 13.1.0 作 host 编译器（无需源码补丁）。
2. Windows 额外配置（wiki 未提及）：手动指定 `NodeAddonApi_INCLUDE_DIR`、`EGL/GLESv2/Fontconfig` 的 `_INCLUDE_DIR` + `_LIBRARY`（共 7 个 CMake 变量），设置 `DEVECO_SDK_HOME` + `JAVA_HOME` 环境变量。
3. **业务库/应用构建后必做运行时检查**：Python 脚本二进制 patch 所有 `.so` 的 DT_NEEDED，移除 Windows 绝对路径前缀（developer build CMake 写入绝对路径 → 设备 dlopen 失败）。
4. 模块：**qtbase + qtsvg + qtimageformats + qtshadertools + qtlanguageserver + qtdeclarative（含 Quick/QuickControls2）** 全部构建验证通过。非 qtbase 模块（Multimedia/3D/Charts 等）仍未适配。
5. 处理 Qt5→6 API 差异（关闭事件 API 私有化、QStandardPaths `AppLocalDataLocation` 映射 `filesDir`→`preferencesDir`、CMake `qt_add_executable`）。

### 策略 B'：使用 Qt 6.12 预构建安装器 SDK（✅ 推荐，比源码 superbuild 更省事）

> **2026-07-25 验证（两批共 15 应用 14 成功）**：Qt 6.12.0 beta2 预构建安装器（Qt 在线安装器勾选 `Qt 6.12.0 → HarmonyOS arm64_v8a` + `MinGW 64-bit` + `CMake + Ninja`）装的 SDK（Qt6.12 预构建安装器 SDK）批量编译清单未鸿蒙化 Qt6 应用。**第 1 批** 5 纯 Widgets 应用 4 成功（QtPass/GitQlient/pgModeler/qView，对抗验证 real=true，详见 第 1 批编译复盘）。**第 2 批** 10 应用（扩展到 opengl/qml/uitools/svg 模块）**10/10 全成功**（MathMod/SolveSpace/CopyQ/SQLiteStudio/LibreCAD 等，含 2 重试成功 + 2 编译边界 stub + 1 Qt5→6 移植，详见 第 2 批编译复盘）。**关键修正：预构建是完整 Qt6.12 发行版**（50+ 模块 .so + qml runtime 全在，仅缺 WebEngine/DBus/Wayland/Pdf/Script），非旧记的"37 模块/qtbase+5"。

**比源码 superbuild（策略 B）消除 3 大坑**（对照 NotepadNext Qt6 移植复盘）：
1. **无需 patch_dt_needed**：预构建 libQt6Core.so 的 NEEDED 已全裸名（libicui18n/libicuuc/libicudata/libz/libc++_shared/libc 等），业务 .so 链接 Qt 库后 NEEDED 也裸名。源码 superbuild 用 `-developer-build` 写绝对 Windows 路径需 patch（NotepadNext 教训）。
2. **无需 shim/trim**：预构建是**完整 Qt6.12 发行版**（2026-07-25 ground-truth：libQt6Quick/Multimedia/Charts/3DCore/3DRender/OpenGL/OpenGLWidgets/DataVisualization/Bluetooth/Location/Positioning/Sensors/SerialBus/UiTools/Core5Compat/WebSockets/SerialPort/Svg/SvgWidgets/Help/Designer/NetworkAuth/TextToSpeech/HttpServer/ShaderTools/Qml/Quick/QuickControls2/Quick3D + QtQuick qml runtime 全在，仅缺 WebEngine/DBus/Wayland/Pdf/Script）。源码 superbuild 仅 qtbase+5 子模块，Core5Compat/Svg/UiTools/Multimedia/Quick 等要自建或 shim。第 2 批 CopyQ(qml)/SQLiteStudio(uitools+svg+qml)/MathMod(opengl) 全成功直接佐证。
3. **无需 Qt6_DIR/QT_DIR/junction**：预构建是 installed SDK（标准 `lib/cmake/Qt6/` 结构），非构建树。源码 superbuild 的构建树 forwarding header 硬编码绝对源码路径需 junction（NotepadNext 教训）。

**编译配方（CLI，qt-cmake.bat + harmonydeployqt6）**：
```
# 环境变量（每次 Bash 都 export，shell state 不持久）
export NODE_HOME=<DevEco>/tools/node JAVA_HOME=<DevEco>/jbr/bin DEVECO_SDK_HOME=<DevEco> QT_HARMONYOS_HVIGOR=<DevEco>/tools/hvigor/bin/hvigorw.bat
export PATH="<DevEco>/tools/node/bin:<DevEco>/jbr/bin:<DevEco>/tools/hvigor/bin:<DevEco>/tools/ohpm/bin:$PATH"

# configure（qt-cmake.bat 自动设 CMAKE_TOOLCHAIN_FILE=qt.toolchain.cmake；必须补 QT_CHAINLOAD_TOOLCHAIN_FILE 否则回退 Linux 默认路径→OHOS 工具链没加载→clang 当 host 链 Windows 库→broken）
cmd //c "<harmonyos_arm64_v8a>/bin/qt-cmake.bat" -G Ninja -DQT_HOST_PATH=<mingw_64> -DOHOS_SDK_NATIVE=<native> -DQT_CHAINLOAD_TOOLCHAIN_FILE=<native>/build/cmake/ohos.toolchain.cmake -DOHOS_ARCH=arm64-v8a -DCMAKE_PREFIX_PATH=<harmonyos_arm64_v8a> <src>

cmake --build . -j8   # 业务 .so（qt_add_executable 自动 MODULE + main GLOBAL DEFAULT）

# 打 HAP（json 由 qt_add_executable configure 自动生成）
<harmonydeployqt6.exe> --input <target>-harmony-deployment-settings.json --output <hap dir> --hvigor <wrapper.bat> --verbose
```

**关键 fix（3 成功项目共同）**：
- app CMake 用 `qt_add_executable`（非 `add_executable`）→ 自动 MODULE .so + `CXX_VISIBILITY_PRESET=default`（main 自动 GLOBAL DEFAULT，无需手动 visibility attribute）+ 生成 `<target>-harmony-deployment-settings.json` + bundle Qt6.12 兼容 ets glue（`APP_LIBRARY_NAME` 指业务 .so）。三种 app CMake 形态改造：上游已 qt_add_executable（GitQlient）/ 写 CMakeLists 包装 qmake sources（QtPass）/ 改自定义宏 pgm_add_executable→qt_add_executable on OHOS（pgModeler）。
- **harmonydeployqt6 sanitize 子进程 env 丢 java**：hvigorw 的 node workers spawn `java`（跑 app_packing_tool.jar during PackageHap）→ `spawn java ENOENT`，即便父进程 PATH 含 jbr/bin。解法：写 `hvigor-wrapper.bat` re-inject `jbr/bin` + `JAVA_HOME` 再调真 hvigorw.bat，经 `harmonydeployqt6 --hvigor <wrapper.bat>` 传入；或直接 `hvigorw.bat assembleHap`（bypass harmonydeployqt6 的 cmake `_make_hap` target，bash 用 MSYS `/c/` 路径 java，git-bash 转 Windows 路径给子进程）。
- 第三方库无 OHOS arm64 预编译时用 **no-op static stub**（pgModeler 的 libpq/libxml2：29 PQ* + 7 xml* fns + 自洽 structs，`.so` 链接 load 干净无 DT_NEEDED libpq/libxml2，DB/XML 运行时非功能——compile-only 边界）。

路径见 Qt6.12 预构建 QtC 配置流程（QtC IDE 流，本批 CLI 化其配方）+ ENV.local.md 的 Qt6.12 预构建路径。源码 superbuild 见 Qt6.12 源码 superbuild 流程。

> ⚠️ **2026-07-27 第 3 批（16 应用 8 成功 8 阻断）补四条经验**（见 第 3 批编译复盘）：
> - **"模块层可行" ≠ "应用可编译"**：预构建再推翻 3 个旧"模块缺失"阻断（Serial-Studio 旧"Quick absent"→Quick 全在编译成功；QCTools 旧"Multimedia missing"→Multimedia 现齐，真阻断=FFmpeg native；Contour 旧"Quick hard-requires"→Quick 现齐，真阻断=DBus+xcb）。翻案后真阻断常是 native 重型库（FFmpeg/DBus+xcb），非 Qt 模块。收到"Quick/Multimedia/3D absent"类应用应：① 先验模块层（预构建大概率已齐）；② 再验 native 重型依赖层。
> - **DBus 缺失是预构建确定性硬墙**（见已知问题 \#18）：无条件 REQUIRED DBus 的应用不可编译、不可 stub、不可 `-DCMAKE_DISABLE`；可选 DBus（`Q_OS_OHOS` 守护跳过）可编译。
> - **C++23 deducing-this/ranges 是编译器能力缺口**（见已知问题 \#19）：OHOS clang 15.0.4 不支持 P0847（需 Clang18+），非 stub 可解，硬天花板。
> - **`#ifdef Q_OS_LINUX` 不可信**（见已知问题 \#20）：Qt6 OHOS 同时定义 Q_OS_OHOS+Q_OS_LINUX，desktop-only 功能守护须用 `Q_OS_LINUX && !Q_OS_OHOS`。
> - 编译边界 stub 扩展：Merkaartor（GDAL/PROJ C++ 类层级 stub）、Drawpile（libav/libwebp/libzip/KArchive/libsodium stub）。第 3 批累计预构建 3 批 31 应用 22 成功。

## 已知问题与待验证项

| # | 项目 | 状态 |
|---|------|------|
| 1 | Qt 6 QStandardPaths 新枚举在 OHOS 上的映射 | ✅ 已验证：`PublicShareLocation`/`TemplatesLocation` 不支持，`StateLocation`/`GenericStateLocation` → `filesDir` |
| 2 | QtOhosExtras 模块是否有 Qt 6 版本 | ✅ 已验证（beta2）+ ⚠️ beta3 修正（2026-08-25）：**beta2**（6.12.0-beta2 预构建）不作为独立模块，功能分散到 `corelib/platform/ohos/`+QPA 内部，全私有 `_p.h`。**beta3**（本地 `${QT6_INSTALLER_ROOT}/6.12.0/harmonyos_arm64_v8a` 复核）**重新独立为 `Qt6HarmonyExtras` 模块**：`lib/libQt6HarmonyExtras.so` + `lib/cmake/Qt6HarmonyExtras/` + `Qt6HarmonyExtrasPrivate/` cmake target；`include/QtHarmonyExtras/` 公开头仅 `qtharmonyextrasexports.h` + `qtharmonyextrasversion.h` 两个桩，16 个功能头全私有 `_p.h`。即：模块回归独立，但公开 API 面仍空。详见下方「Qt6 beta3 文件权限授予接口」节。 |
| 3 | Qt 6 QPA 插件（qohos）与 Qt 5 的功能差异 | ✅ 已验证：196 文件，关闭事件 API 重大变更（私有化 + 枚举值改变），窗口标记 API 签名一致 |
| 4 | 非 qtbase 模块的鸿蒙适配时间表 | ⚠️ **已修正（2026-07-25）**：源码 superbuild（策略 B）仅 qtbase+5 子模块，非 qtbase 模块无鸿蒙适配。**预构建安装器（策略 B'）是完整 Qt6.12 发行版**——Multimedia/3D/Charts/OpenGL/DataVisualization/Bluetooth/Location/Sensors/SerialBus/UiTools/Core5Compat/Quick/QuickControls2 等 .so + QtQuick qml runtime **全在**（ground-truth 复核）。仅 WebEngine/DBus/Wayland/Pdf/Script 缺失。第 2 批 CopyQ(qml)/SQLiteStudio(uitools+svg+qml)/MathMod(opengl)/SolveSpace(openglwidgets) 用预构建全编译成功佐证（第 2 批编译复盘 决策 1） |
| 5 | Qt 6 的 `qt_add_qml_modules` 在 OHOS 交叉编译中的行为 | 🟡 部分验证：qtbase cmake 中仅在 `QtInitProject.cmake`（项目模板）中出现，实际实现在 `qtdeclarative` 仓库中（本地无源码）。OHOS 特定行为无法从 qtbase 源码验证 |
| 6 | Qt 6 最低 SDK API Level 是否仍为 20 | ✅ 已更新：Qt5 wiki 记载 API 20；Qt6 源码无硬编码最低 API；本地 SDK 为 **API 24**（HarmonyOS 6.1.1 Beta1） |
| 7 | `AppLocalDataLocation` 映射变更 | ✅ 已验证：Qt5 `filesDir` → Qt6 `preferencesDir`（破坏性变更） |
| 8 | 关闭事件公开 API 缺失 | ✅ 已验证：Qt6 `CloseRootCause` 为私有 API，无公开 `getCloseEventRootCause()` |
| 9 | qtbase Test/Sql/Concurrent/OpenGL 模块在 OHOS 上的状态 | ✅ 已验证：Test 有 OHOS hilog 集成（`qOhosLogMessage`），Sql/Concurrent/OpenGL 无需 OHOS 特定代码 |
| 10 | Qt 6.12 在 Windows+OHOS NDK musl 是否可构建 | ✅ **已验证（2026-07-13）**：6.12.0 superbuild + MinGW g++ 13.1.0 host 可编译，无需源码补丁。gallery demo 真机运行通过。原 -isystem musl BLOCKER（llvm-mingw clang 22 + API 24 + per-module 路径，见 [build-fail-qt6-libcpp-musl-isystem]）在此组合下未复现，三变量未逐一隔离 |
| 11 | Qt6 `.so` 的 `DT_NEEDED` 含 Windows 绝对路径 | ✅ 已验证：**源码 superbuild（策略 B）**：Qt6 `.so` 无 SONAME + `-developer-build` imported target 以绝对路径参与链接 → NEEDED 记录绝对 Windows 路径 → 设备 dlopen 失败，**必须用 `patch_needed.py` 改裸名**（业务库 + Qt 库自身）。**预构建安装器（策略 B'）无此问题**：libQt6Core.so NEEDED 已全裸名，业务 .so 链接后也裸名，第 1+2 批 14 成功项目均 0 patch 脚本。`llvm-readelf -d` 验证（见 problems/_lookup.md 速查表）|
| 12 | Qt6 业务库 `main` 的动态可见性 | ✅ 已验证：target 用 `CXX_VISIBILITY_PRESET hidden` 时 `main` 是 local symbol，`dlsym("main")` 失败。**给 `main` 加 `__attribute__((visibility("default")))`**，`llvm-readelf --dyn-syms` 验证 `GLOBAL DEFAULT`（见 problems/_lookup.md 速查表）|
| 13 | Qt6 OHOS native file picker 的初始 URI 与文件筛选 | ✅ 已验证：`DocumentViewPicker` 的 `defaultFilePathUri` 和 `fileSuffixFilters` 均为可选字段；不可传入应用私有目录或 `qmake*` 这类无扩展名 glob。空初始路径/无可表示的后缀筛选时必须省略对应字段（见 [runtime-fail-file-dialog-invalid-default-uri]）|
| 14 | 预构建安装器是否含 Quick/Multimedia/3D/Charts 等"非 qtbase"模块 | ✅ **已验证（2026-07-25 ground-truth）**：预构建是**完整 Qt6.12 发行版**。libQt6Quick.so(7.8MB)/Multimedia/Charts/3DCore/3DRender/OpenGL/OpenGLWidgets/DataVisualization/Bluetooth/Location/Positioning/Sensors/SerialBus/UiTools/Core5Compat/WebSockets/SerialPort/Svg/SvgWidgets/Help/Designer/NetworkAuth/TextToSpeech/HttpServer/ShaderTools/Qml/QuickWidgets/QuickControls2/Quick3D 全在，QtQuick qml runtime(Controls/Dialogs/Layouts)全在。**仅 WebEngine/DBus/Wayland/Pdf/Script 缺失**。KB 旧记"Quick .so absent""Multimedia missing""3D 未开始"是源码 superbuild 时代过时记录，对预构建不成立（第 2 批编译复盘 决策 1）|
| 15 | 编译边界（compile-only）stub 模式是否可行 | ✅ **已验证（2026-07-25）**：功能阻断应用（Qt 模块全在，运行时非功能，如 QPS /proc process-control、Veyon VNC/X11 注入）用 no-op stub（header-only INTERFACE + no-op cmake 模块 + STATIC IMPORTED .a）让 .so 链接 load 干净，产出 `编译✓/运行✗` HAP。stubs 必须加 `CMAKE_FIND_ROOT_PATH`（`ohos.toolchain` 的 `MODE_PACKAGE=ONLY` 要求），非仅 CMAKE_PREFIX_PATH（第 2 批编译复盘 决策 3）|
| 16 | Qt5→6 移植的 QRegExp 兼容方案 | ✅ **已验证（2026-07-25，LibreCAD）**：Qt6 移除 QRegExp，多文件用 QRegExp 自身 API（indexIn/cap/pos/setPatternSyntax）时，写 `QRegExp` 作 `QRegularExpression` 子类的 forwarding header，经 `-I` **前置**于 Qt5Compat 的 -isystem，免逐文件 API 改写。配套 8 个机械 Qt5→6 fix（setCodec→setEncoding、DataLocation→AppDataLocation、QPrinter paper→QPageSize、QActionGroup include、modifier operator+→\|、setMargin→setContentsMargins、QTabletEvent PointerType→QPointingDevice、int/char→QChar 包裹）（第 2 批编译复盘 决策 4）|
| 17 | harmonydeployqt6 `--hvigor` 参数路径要求 | ✅ **已验证（2026-07-25）**：`--hvigor <wrapper.bat>` 必须传**绝对路径**——相对路径报 'Failed to start hvigorw'（harmonydeployqt6 从生成的 project dir cwd 调 hvigor）。`harmonydeployqt6` 无 `--sdk-root` flag，stale sdk-root 在 deployment json input 里手改（第 2 批编译复盘 翻车点 1/3）|
| 18 | DBus 缺失是预构建确定性硬墙 | ✅ **已验证（2026-07-27 第 3 批，flameshot/Contour/deepin-terminal）**：预构建缺 Qt6DBus。**无条件 REQUIRED DBus 的应用不可编译**——不可 stub（QDBusAbstractAdaptor/Interface 是 Q_OBJECT 基类需 moc + 全 QDBus API）、不可 `-DCMAKE_DISABLE_FIND_PACKAGE_Qt6DBus`（对 component `find_package` 无效）。flameshot（request.h 顶层无条件 `#include <QtDBus>` + Q_OBJECT 继承 + `!MACOS&&!WIN` 路径触发）、Contour（`find_package(Qt6 DBus REQUIRED)` 无 option 守护）、deepin-terminal（DBus core 源）。**对比可选 DBus 可编译**：Open-Typer/Serial-Studio/qlementine 用 `Q_OS_OHOS` 守护跳过 DBus，编译成功。判定规则：grep 源码 `#include <QtDBus>` 顶层无条件 + Q_OBJECT 继承 + find_package DBus REQUIRED 无守护 → 三者命中任一即不可编译（第 3 批编译复盘 决策 2）|
| 19 | OHOS clang 是否支持 C++23 deducing-this/ranges 适配器 | ✅ **已验证（2026-07-27 第 3 批，creeper-qt）**：OHOS native clang **15.0.4 不实现 C++23 deducing-this（P0847R7）**（需 Clang 18.0+），无 -std flag 可在 15 上开启（实测 `-std=gnu++2b` 下 `auto f(this auto& self)` 报 expected parameter declarator，20 errors）；libc++ 同样缺 C++23 ranges 适配器（`std::views::zip`/`cartesian_product`）。用这些特性的应用需等 OHOS NDK 升级 Clang18+/libc++19+ 或源码层降级（deducing-this→CRTP、ranges→手写循环）。**编译器能力缺口**，非 Qt 模块/平台限制，非 stub 可解（第 3 批编译复盘 决策 3）|
| 20 | Qt6 OHOS Q_OS_LINUX 守护是否可靠 | ✅ **已验证（2026-07-27 第 3 批，Open-Typer/Serial-Studio）**：Qt6 `qsystemdetection.h` 在 OHOS 上**同时定义 `Q_OS_OHOS` 和 `Q_OS_LINUX`**。源码用裸 `#ifdef Q_OS_LINUX` 守护 desktop-only 功能（DBus/systemd/X11/procfs）时，OHOS 上也触发 → 编译失败（DBus 预构建缺失）。**正确守护**：`#if defined(Q_OS_LINUX) && !defined(Q_OS_OHOS)`。Qt6 OHOS 独有（Qt5 qsystemdetection 可能不双定义）。grep `Q_OS_LINUX` 是 DBus 类阻断的早期信号（第 3 批编译复盘 决策 5）|

| 21 | Qt6.12 IoT addon 模块（Mqtt/Coap/Opcua/Knx）的鸿蒙支持 | ✅ **已验证（2026-08-03，qtmqtt `v6.12.0-beta2`）**：这些是 Qt **source-only 附加模块**，**不在预构建安装器**（开源版 installer 无此组件可勾选、商业版以源码形式提供），与"发行版缺 WebEngine/DBus"性质不同——需自编。但**预构建 OHOS kit 带 `Qt6BuildInternalsConfig.cmake`**（`lib/cmake/Qt6BuildInternals/`），设计上支持编译 Qt addon 模块。流程：clone `qt/qtmqtt` checkout 对应 tag → `qt-cmake.bat`+`ohos.toolchain.cmake` 交叉编译（`-DQT_BUILD_EXAMPLES=OFF -DQT_BUILD_TESTS=OFF`）→ `CMAKE_INSTALL_PREFIX=<QT6_OHOS_KIT>` **装进 OHOS kit**（关键招：libQt6Mqtt.so 进 kit `lib/`、cmake config 进 `lib/cmake/Qt6Mqtt/`、headers 进 `include/QtMqtt/`，业务 demo `find_package(Qt6 Mqtt)` 与 harmonydeployqt6 拷库两头顺，无需额外配路径）→ 业务用 `qt_add_executable` 正常编。验证：libQt6Mqtt.so(395KB)+libsimplemqttclient.so+HAP(36MB) 全产出，NEEDED 全裸名（libQt6Mqtt.so NEEDED 含 libQt6WebSockets.so，harmonydeployqt6 递归拖依赖正确），0 patch。⚠️ 许可：QtMqtt 开源版 **GPLv3**（非 LGPL），闭源商业发行需买 Qt 商业许可或换 Paho.mqtt-c/mosquitto（EPL/EDL 不传染）。同法可编 CoAP/Opcua/Knx（待验证）。详见 [[qt-harmonyos-third-party-libs]] §9 QtMqtt。⚠️ **2026-08-04 runtime 补正**：#21 原仅验证 build 产物（lib+HAP+NEEDED 裸名），未端到端跑设备。实跑（mqttclient-ohos demo）发现：Qt6 预构建 kit 的 Qt .so 带 HARD DT_NEEDED 三方库（libQt6Core→libicui18n/uc/data、libQt6Gui→libfontconfig/png16/freetype、libQt6Network→libbrotlidec/common、libfontconfig→libexpat），既不在 kit `lib/`、也不属 OHOS 系统库，harmonydeployqt6 不自动拷 → HAP 装得上但启动即崩 dlopen(libQt6Core)→libicui18n not found。修：手动 stage 9 个三方 .so 进 `hap/entry/libs/arm64-v8a/`（从 additional-packages 或已跑通的 gallery-ohos demo 拷）+ `hvigorw assembleHap` 重打 → HAP 34MB→73MB，依赖链完整。完整根因与修复步骤见 KB 错误库（problems/）与鸿蒙 Qt 应用开发指南 §6 陷阱 #12（均 KB 内部页，公开版不可达），此处不展开。 |

## 参考来源

- [Building Qt6 for HarmonyOS](https://wiki.qt.io/Building_Qt6_for_HarmonyOS) — Qt 6 构建指南
- [Qt for HarmonyOS](https://wiki.qt.io/Qt_for_HarmonyOS) — 主页（含 Qt5/Qt6 模块适配状态）
- [Building Qt for HarmonyOS (Qt5)](https://wiki.qt.io/Building_Qt_for_HarmonyOS) — Qt 5 构建指南（对比参考）
- [HarmonyOS Platform Limitations](https://wiki.qt.io/Qt_for_HarmonyOS/platform_limitations) — 平台限制（Qt5/Qt6 共用）
- [Long live Qt for HarmonyOS! (Reddit)](https://www.reddit.com/r/QtFramework/comments/1te37o5/long_live_qt_for_harmonyos/) — Gerrit 733351 合并公告
- [Qt 6 Build System (Qt Blog)](https://www.qt.io/blog/qt-6-build-system) — Qt 6 CMake 构建系统介绍
- **Qt 6 qtbase 源码**（本地验证）：
  - `<LOCAL_PATH>` — QStandardPaths OHOS 映射
  - `<LOCAL_PATH>` — 关闭事件 API（私有）
  - `<LOCAL_PATH>` — 窗口标记 API
  - `<LOCAL_PATH>` — QPA 函数（ShareKit/FloatWindow）

## 变更史

| 日期 | 变更 |
|------|------|
| 2026-07-06 | 创建页面，Qt6 鸿蒙化状态初始记录（qtbase dev 已合并 Gerrit 733351，最低 SDK API 20） |
| 2026-07-13 | 策略 B 源码 superbuild Windows 验证（MinGW host + OHOS Clang target，gallery 真机运行通过）→ Qt6 Windows 源码 superbuild 工作流（内部） |
| 2026-07-23 | Qt Creator Kit 配置验证（预构建安装器 + QtC IDE，samegame demo）→ Qt Creator Kit 配置工作流（内部） |
| 2026-07-25 | 策略 B' 预构建安装器 ground-truth 复核：完整 Qt6.12 发行版（50+ 模块 .so + qml runtime），第 1+2 批 15 应用 14 成功 |
| 2026-07-27 | 第 3 批 16 应用 8 成功 8 阻断，补 DBus 硬墙 / C++23 天花板 / Q_OS_LINUX 双定义三条经验 |
| 2026-08-02 | 策略 B' 预构建 CLI 端到端验证（Qt6 预构建 CLI 端到端工作流，内部）：widgets/gallery demo configure→build→package HAP ~33MB 成功，固化 11 陷阱 + hvigor-wrapper.bat 占位符模板 |
| 2026-08-03 | Qt6+CEF 鸿蒙集成验证（Qt6+CEF 集成工作流，内部）：OpenQtCef Qt5→Qt6 迁移，HAP 真机启动通过；IoT addon（qtmqtt）鸿蒙交叉编译验证（已知问题 \#21） |
| 2026-08-25 | beta3 ground-truth 复核（本地 `${QT6_INSTALLER_ROOT}/6.12.0/harmonyos_arm64_v8a`）：`Qt6HarmonyExtras` 重新独立成模块（`libQt6HarmonyExtras.so` + cmake，公开头仅 exports/version 桩，16 功能头全私有 `_p.h`）→ 翻 beta2「不作为独立模块存在」结论（修正已知问题 #2 + 模块适配状态表 + QPA 变更节）；新增「Qt6 beta3 文件权限授予接口」节（`QPermissions` 公开 API 无文件类权限类型 + `QtHarmonyExtras::FileShare::persistPermission` 私有 + picker 未封装，走鸿蒙原生 `@ohos.file.picker`/`@ohos.fileshare`） |

---
id: semantic-qt-harmonyos-project-structure
type: semantic
domain: tech
tags: [qt, harmonyos, cmake, project-structure, project-creation, template, glue-code, deveco]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-build, semantic-qt-harmonyos-modules]
summary: >
  Qt 鸿蒙工程结构详解：OHOS 模板（胶水代码）目录布局、CMake 交叉编译配置、
  库名规则（QtAppConstants.ets ↔ add_library）、两种场景（从零创建 / 已有工程鸿蒙化）。
---

# Qt 鸿蒙工程结构详解

> 模板、胶水代码、CMake 配置、库名规则——一站式掌握 Qt for HarmonyOS 工程骨架。
> AppScope、module、product、native libs 与 signingConfig 的平台层级关系，以 common 的 [[ohos-common-kb/semantic/hap-native-project-structure|HAP 原生工程结构与签名关系]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/hap-native-project-structure.md)）为准。本页只解释 Qt 模板、QAbility 胶水、`QtAppConstants.ets`、Qt CMake 目标与部署规则。

## 1. 两种使用场景

| 场景 | 说明 | 核心差异 |
|------|------|----------|
| **场景一：从零创建** | 生成全新 Qt 鸿蒙应用工程 | Qt 源码放在 `entry/src/main/cpp/` |
| **场景二：已有工程鸿蒙化** | 将已有 Qt 工程转换为鸿蒙应用 | 胶水代码放入 `HarmonyOS/` 子目录，`build-profile.json5` 用绝对路径指向根目录 CMakeLists.txt |

## 2. 胶水代码模板获取

### 2.1 新版方式（推荐）：Qt 源码内置模板

新版 Qt 鸿蒙分支已将胶水模板**内置于源码树**，路径统一为 `<QT_SRC>/qtbase/src/harmonyos/templates`，无需再从 Gerrit 下载 ZIP。

| Qt 版本 | 模板路径 |
|---------|--------|
| Qt 5.15.16 (`tqtc/harmonyos-5.15.16`) | `<QT5_15_SRC>/qtbase/src/harmonyos/templates` |
| Qt 5.12.12 (`tqtc/harmonyos-5.12.12`) | `<QT5_12_SRC>/qtbase/src/harmonyos/templates` |

```bash
# 直接从 Qt 源码树复制模板目录到工程目录
cp -r <QT5_15_SRC>/qtbase/src/harmonyos/templates/. <工程目录>/
```

模板目录结构：
```
templates/
├── AppScope/
├── entry/
├── hvigor/
├── qEmbeddedUiExtensionHost/
├── build-profile.json5
├── hvigorfile.ts
├── oh-package.json5
└── README.md
```

### 2.2 独立模板归档（无 Qt 源码场景）

当仅有预编译 SDK 而无完整 Qt 源码树时（如鸿蒙 PC 编译构建场景），需从 GitCode releases 页面单独下载模板归档。

**下载地址**：https://gitcode.com/ohos-qt/qt-harmonyos-src/releases
**归档名称**：`templates-0625.zip`

```bash
# 使用 kb-init 脚本自动下载到 BitFun 用户级共享资源目录
bash skills/kb-init/scripts/download-template.sh
```

解压后目录结构与源码内置模板一致（`AppScope/`、`entry/`、`build-profile.json5` 等）。
`ENV.local.md` 中 `OHOS_TEMPLATE_SRC` 应使用脚本输出的路径。

### 2.3 旧方式（已退役）：从 Gerrit 下载 ZIP

> **此方式已退役**：新版 Qt 鸿蒙分支已将胶水模板内置于源码树（见 §2.1），无需再从 Gerrit 下载 ZIP。
> 旧的外部 ZIP 模板变量在 `ENV.md` 中保留仅为兼容旧 `ENV.md`，不应再使用。
> 模板统一从 `<QT_SRC>/qtbase/src/harmonyos/templates` 复制（有源码时）或从独立归档下载（无源码时，见 §2.2）。

## 3. 目录结构

### 3.1 场景一：从零创建

```
<工程目录>/                           # 模板解压后的根目录
├── entry/
│   ├── src/main/
│   │   ├── cpp/                      # ★ Qt 应用代码位置
│   │   │   ├── main.cpp              # QWidget 或 QML 入口
│   │   │   ├── main.qml              # (QML 应用) QML 界面文件
│   │   │   ├── qml.qrc               # (QML 应用) 资源映射文件
│   │   │   └── CMakeLists.txt        # ★ CMake 配置（关键！）
│   │   └── ets/
│   │       └── common/
│   │           └── QtAppConstants.ets # ★ 配置 APP_LIBRARY_NAME
│   ├── build-profile.json5           # ★ 模块级构建配置
│   └── libs/arm64-v8a/               # Qt 运行时库
│       ├── libqohos.so               # OHOS 平台插件（自动部署）
│       ├── styles/
│       │   └── libqohosstyle.so      # OHOS 样式插件（手动复制）
│       └── libQtHarmonyApp.so        # 应用库（构建生成）
├── qEmbeddedUiExtensionHost/
├── build-profile.json5               # 项目级构建配置
├── AppScope/app.json5                # 应用包名 bundleName
└── local.properties                  # SDK 路径
```

### 3.2 场景二：已有工程鸿蒙化

> **设计理念**：鸿蒙是众多平台之一，胶水代码独立存放于 `HarmonyOS/` 目录，保持原有工程结构整洁。

```
<已有工程根目录>/
├── CMakeLists.txt                    # ★ 原有工程 CMake（需添加 OHOS 配置）
├── src/                              # 原有源码
└── HarmonyOS/                        # ★ 新增：鸿蒙胶水代码目录
    ├── entry/
    │   ├── src/main/
    │   │   ├── cpp/                  # 空目录（不使用）
    │   │   └── ets/common/QtAppConstants.ets
    │   ├── build-profile.json5       # ★ path 用绝对路径指向根目录 CMakeLists.txt
    │   └── libs/arm64-v8a/
    ├── qEmbeddedUiExtensionHost/
    ├── build-profile.json5
    └── local.properties
```

**关键**：用 DevEco Studio 打开 **`HarmonyOS/` 目录**，而非工程根目录。

## 4. CMake 配置（核心）

### 4.1 模块级 build-profile.json5

`entry/build-profile.json5`（场景一）或 `HarmonyOS/entry/build-profile.json5`（场景二）：

```json5
{
  "apiType": 'stageMode',
  "buildOption": {
    "externalNativeOptions": {
      // 场景一：相对路径
      "path": "./src/main/cpp/CMakeLists.txt",
      // 场景二：绝对路径指向工程根目录 CMakeLists.txt
      // "path": "C:\\code\\MyQtApp\\CMakeLists.txt",
      "arguments": "-DCMAKE_PREFIX_PATH=<Qt SDK路径>",  // ★ 开发者填写
      "abiFilters": ["arm64-v8a"]
    }
  }
}
```

**关键参数**：
- `path`：场景一用相对路径；场景二必须用**绝对路径**（反斜杠需转义 `\\`）
- `arguments`：`-DCMAKE_PREFIX_PATH` 指向 Qt SDK（如 `<LOCAL_PATH>`）
- `abiFilters`：必须匹配目标设备 ABI（`arm64-v8a`）

### 4.2 CMakeLists.txt 模板

#### 交叉编译 find_package 问题（铁律级）

OHOS 工具链默认设置 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY`，阻止 CMake 通过 `CMAKE_PREFIX_PATH` 找到 Qt。**必须在 find_package 前临时改为 BOTH**：

```cmake
if(CMAKE_CROSSCOMPILING)
  set(_saved_root_path_mode_package "${CMAKE_FIND_ROOT_PATH_MODE_PACKAGE}")
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
endif()

find_package(QT NAMES Qt5 Qt6 REQUIRED COMPONENTS Core)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Widgets)  # 按需添加模块

if(CMAKE_CROSSCOMPILING)
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE "${_saved_root_path_mode_package}")
  unset(_saved_root_path_mode_package)
endif()
```

#### QWidget 应用 CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.5)
project(QtHarmonyApp)

set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

# （交叉编译 find_package 修复，见上方代码块）

find_package(QT NAMES Qt5 Qt6 REQUIRED COMPONENTS Core)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Widgets)

set(PROJECT_SOURCES main.cpp)

# ★ 库名必须与 QtAppConstants.ets 中的 APP_LIBRARY_NAME 匹配
add_library(QtHarmonyApp SHARED ${PROJECT_SOURCES})

target_link_libraries(QtHarmonyApp PRIVATE
  Qt${QT_VERSION_MAJOR}::Core
  Qt${QT_VERSION_MAJOR}::Widgets
)

# ★ OHOS 平台插件（自动部署 libqohos.so）
target_link_libraries(QtHarmonyApp PRIVATE
  Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin
)
```

#### QML 应用 CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.5)
project(QtHarmonyApp)

set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)  # ★ QML 应用必须启用，编译 qml.qrc

# （交叉编译 find_package 修复，同上）

find_package(QT NAMES Qt5 Qt6 REQUIRED COMPONENTS Core)
find_package(Qt${QT_VERSION_MAJOR} REQUIRED COMPONENTS Core Gui Qml Quick)

set(PROJECT_SOURCES
  main.cpp
  main.qml       # QML 界面文件
  qml.qrc        # 资源映射文件
)

add_library(QtHarmonyApp SHARED ${PROJECT_SOURCES})

target_link_libraries(QtHarmonyApp PRIVATE
  Qt${QT_VERSION_MAJOR}::Core
  Qt${QT_VERSION_MAJOR}::Gui
  Qt${QT_VERSION_MAJOR}::Qml
  Qt${QT_VERSION_MAJOR}::Quick
)

target_link_libraries(QtHarmonyApp PRIVATE
  Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin
)
```

### 4.3 项目级 build-profile.json5

```json5
{
  "app": {
    "products": [{
      "name": "default",
      "signingConfig": "default",
      "compatibleSdkVersion": "5.0.0(12)",
      "runtimeOS": "HarmonyOS"    // ★ 必须是 "HarmonyOS"
    }],
    "buildModeSet": [
      {"name": "debug"},
      {"name": "release"}
    ]
  },
  "modules": [
    {"name": "entry", "srcPath": "./entry"},
    {"name": "qEmbeddedUiExtensionHost", "srcPath": "./qEmbeddedUiExtensionHost"}
  ]
}
```

**铁律**：不要设置 `compileSdkVersion` 和 `targetSdkVersion`。

## 5. 库名规则（关键！）

### 5.1 三方对应关系

```
CMakeLists.txt:
  add_library(QtHarmonyApp SHARED ...)  →  目标名: QtHarmonyApp

编译产物（构建后生成）:
  entry/libs/arm64-v8a/libQtHarmonyApp.so  →  lib + 目标名 + .so

QtAppConstants.ets:
  APP_LIBRARY_NAME = 'libQtHarmonyApp.so'  →  ★ 必须与实际文件名完全一致
```

### 5.2 QtAppConstants.ets 配置

路径：`entry/src/main/ets/common/QtAppConstants.ets`

```typescript
export const APP_LIBRARY_NAME = 'libQtHarmonyApp.so';
```

### 5.3 常见错误

| 错误示例 | 正确示例 | 问题 |
|----------|----------|------|
| `'QtHarmonyApp.so'` | `'libQtHarmonyApp.so'` | 缺少 `lib` 前缀 |
| `'libQtHarmonyApp'` | `'libQtHarmonyApp.so'` | 缺少 `.so` 后缀 |
| `'libqtharmonyapp.so'` | `'libQtHarmonyApp.so'` | 大小写不一致 |
| `'libMyApp.so'` | `'libQtHarmonyApp.so'` | 与实际编译产物不符 |

**验证方式**：编译后执行 `ls entry/libs/arm64-v8a/*.so` 查看实际库名。

## 6. Qt 运行时库部署

### 6.1 自动部署

| 库 | 部署方式 | 目标路径 |
|----|----------|----------|
| `libqohos.so` | 链接 `Qt5::QOhosPlatformIntegrationPlugin` | `libs/${ABI_DIR}/libqohos.so` |
| Qt 核心库 | `find_package` + `target_link_libraries` | `libs/${ABI_DIR}/` |

### 6.2 手动复制

| 库 | 来源 | 目标路径 |
|----|------|----------|
| `libqohosstyle.so` | `<Qt_SDK>/plugins/styles/libqohosstyle.so` | `libs/${ABI_DIR}/styles/libqohosstyle.so` |
| `libqsvg.so`（SVG 图像格式插件） | `<Qt_SDK>/plugins/imageformats/libqsvg.so` | `libs/${ABI_DIR}/imageformats/libqsvg.so` |
| `libqsqlite.so`（SQL 驱动插件，QSqlDatabase） | `<Qt_SDK>/plugins/sqldrivers/libqsqlite.so` | `libs/${ABI_DIR}/sqldrivers/libqsqlite.so` |

```bash
TARGET_DIR=<工程目录>/entry/libs/arm64-v8a/styles/
mkdir -p "$TARGET_DIR"
cp <Qt_SDK路径>/plugins/styles/libqohosstyle.so "$TARGET_DIR"

# SVG 图像格式插件：QML Image / QImageReader 加载 .svg 必需
mkdir -p <工程目录>/entry/libs/arm64-v8a/imageformats/
cp <Qt_SDK路径>/plugins/imageformats/libqsvg.so <工程目录>/entry/libs/arm64-v8a/imageformats/
```

> `libqohosstyle.so` 无法通过 `target_link_libraries` 部署，因为它需要放在 `styles/` 子目录下。
>
> **⚠️ `libqsvg.so` 同理且更隐蔽**——它是**图像格式插件**（`QSvgPlugin:QImageIOPlugin`），运行时由 `QImageReader` 动态加载，必须放在 `imageformats/` 子目录下，无法通过 `target_link_libraries` 部署。**漏部署后果**：`QML Image { source: "*.svg" }` 与 `QImageReader`/`QPixmap::loadFromData(bytes,"SVG")` **静默失败**（`Image.status=Error`、`sourceSize=0x0`、不抛异常），而直接用 `QSvgRenderer`/`QSvgWidget`（编译进 `libQt5Svg`）却正常——极易误判为 QtSvg 损坏。诊断：`QImageReader::supportedImageFormats()` 不含 `"svg"` 即插件未加载。验证工程可使用 SVG 显示验证 QML OHOS demo。

> **⚠️ `libqsqlite.so` 同理且更易误判**——它是 **SQL 驱动插件**（`QSQLiteDriverPlugin`，`MODULE IMPORTED` 动态插件），运行时由 `QFactoryLoader` 按 `sqldrivers/` 子目录 dlopen 加载，**无法通过 `target_link_libraries` 部署**（链接 `Qt5::Sql` 只部署 `libQt5Sql.so` 主库，驱动插件是独立的运行时 dlopen 插件，非 NEEDED 依赖，HVigor 不会自动打包）。**漏部署后果**：`QSqlDatabase::addDatabase("QSQLITE")` 拿到 null driver，`db->open()` 在检查 `d->driver` 为空时**直接返回 false（根本不调用 `sqlite3_open`、不碰文件系统）**，`lastError()` = `"Driver not loaded"`。注意 OHOS SDK 驱动文件名是 **`libqsqlite.so`**（非桌面 `libqsqlsqlite.so`）。诊断：`addDatabase` 后检查 `db->lastError().text()` 含 "Driver not loaded"，或设备 `hdc shell find /data/storage/el1/bundle -name 'libqsqlite*'` 无命中。详见 [runtime-fail-sqlite-open-database](../problems/runtime-fail-sqlite-open-database.md)。

## 7. QML 应用特殊配置

### 7.1 QML 文件位置

QML 文件放在 `cpp/` 目录，通过 `qml.qrc` 编译进应用库：

```
entry/src/main/cpp/
├── main.cpp       # QML 引擎初始化
├── main.qml       # QML 界面（通过 qrc 编译）
└── qml.qrc        # 资源映射
```

### 7.2 qml.qrc 配置

```xml
<!DOCTYPE RCC>
<RCC version="1.0">
    <qresource prefix="/">
        <file>main.qml</file>
    </qresource>
</RCC>
```

**路径对应**：`qml.qrc` prefix `/` + file `main.qml` → 资源路径 `:/main.qml` → `main.cpp` 加载 `qrc:/main.qml`

### 7.3 QML 注意事项

- Qt SDK for HarmonyOS 是精简版，**不包含 QtQuick.Controls** 模块
- 使用 `Rectangle` + `MouseArea` 替代 Button 控件
- `Window` 没有 `focus` 属性，键盘事件需放在内部 `Item` 或 `FocusScope` 中：
  ```qml
  Window {
      Item {
          anchors.fill: parent
          focus: true
          Keys.onPressed: { console.log("Key:", event.key) }
      }
  }
  ```

### 7.4 QML 模块部署到 resfile/qml（运行时 import 模块必需）

QML 应用若 `import` 了 Qt SDK 自带 QML 模块（Qt3D / QtQuick.Controls / QtQuick.Layouts / QtDataVisualization / QtQuick.Scene3D 等），编译期 `find_package` + `target_link_libraries` 只部署 Qt C++ 库到 HAP `libs/`，**不部署 QML 类型插件**（`qml/<Module>/` 下的 .so + qmldir）。运行时 QQmlEngine 找不到模块 → hilog 报 `module "Qt3D"/"QtQuick" is not installed` → QML 树加载失败 → 黑屏（进程存活不崩溃）。

**机制**（源码 `qtbase/src/plugins/platforms/ohos/qohosjsmain.cpp`）：
- QPA 启动设环境变量 `QML2_IMPORT_PATH = resourceDir + "/qml"`（:1784）
- `resourceDir` 默认 = `bundleCodeDir + "/entry/resources/resfile"`（:1731-1733）

即 QPA 期望 QML 模块在 HAP 的 `entry/src/main/resources/resfile/qml/`（设备路径 `bundle/entry/resources/resfile/qml/`）。

**部署**：复制 Qt OHOS SDK 的整个 `qml/` 目录到工程 `entry/src/main/resources/resfile/qml/`：

```bash
mkdir -p "<工程>/entry/src/main/resources/resfile/qml"
cp -r "<QT_OHOS_SDK>/qml/." "<工程>/entry/src/main/resources/resfile/qml/"
```

- hvigor 自动打包 `entry/src/main/resources/resfile/` 下所有文件作为 resfile 资源进 HAP
- resfile 是 OHOS **只读**资源目录，dlopen 允许（P3 铁律 dlopen 拒可写路径，resfile 只读 OK），QML 插件 .so 能正常 dlopen 加载
- 全量复制最简（SDK `qml/` ~15MB，866 文件）；裁剪需覆盖应用所有 `import` 模块子目录 + 传递依赖（如 Qt3D/Core|Render|Input|Extras|Logic|Animation、QtQuick、QtQuick.2、QtQml、Qt、builtins.qmltypes）
- 重新构建 HAP + 安装启动，hilog 不再报 "not installed"，QML 树正常加载渲染

> **注意**：resfile ≠ rawfile。Qt6 OHOS（qtcreator postmortem）曾用 `rawfile/` 部署 + 运行时读 resfile 路径；但 Qt5.12 QPA `resourceDir` 默认直接是 `resfile`，故 Qt5 应放 `resfile/qml/`。若 `appStartupObj.resourceDir` 被显式设置则用设置值。

详见 problems/_lookup.md 错误速查表。

## 8. 应用包名配置

编辑 `AppScope/app.json5`：

```json5
{
  "app": {
    "bundleName": "com.example.<AppName>",  // ★ 全局唯一标识
    "vendor": {"name": "YourName", "code": "000"},
    "version": {"code": 1000000, "name": "1.0.0"}
  }
}
```

**bundleName 规范**：格式 `com.<公司>.<应用名>` 或 `org.<组织>.<应用名>`，禁止中文、空格、特殊字符。

## 9. 铁律约束清单

### 禁止

- 修改 DevEco SDK 或 Qt SDK 目录中的任何文件
- 设置 `compileSdkVersion` 或 `targetSdkVersion`
- 修改 `OhosExportModules.ts`
- 将用户提示词直接用作文件名/目录名

### 必须

- CMakeLists.txt 交叉编译时设置 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH`
- 链接 `Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin`（平台插件）
- 手动复制 `libqohosstyle.so` 到 `libs/${ABI_DIR}/styles/`
- `APP_LIBRARY_NAME` 与编译产物库名**完全一致**（含 `lib` 前缀和 `.so` 后缀）
- `runtimeOS` 设置为 `"HarmonyOS"`
- 场景二：`build-profile.json5` 的 `path` 使用**绝对路径**

## 10. 常见问题速查

| 问题 | 解决方案 |
|------|----------|
| `find_package(Qt5)` 失败 | 交叉编译时设置 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH` |
| Schema validate failed | 不要设置 `compileSdkVersion` |
| dlopen failed / cannot locate symbol | 链接 `Qt5::QOhosPlatformIntegrationPlugin` |
| 平台插件加载失败 | 确认 `libqohos.so` 在 `libs/${ABI_DIR}/` |
| 样式插件加载失败 | 确认 `libqohosstyle.so` 在 `libs/${ABI_DIR}/styles/` |
| QML Image / QImageReader 加载 SVG 静默失败（`Image.status=Error`、`sourceSize=0x0`），但 `QSvgRenderer`/`QSvgWidget` 正常 | 部署 `libqsvg.so` 到 `libs/${ABI_DIR}/imageformats/`（见 §6.2） |
| `QSqlDatabase: QSQLITE driver not loaded` / `db->open()` 返回 false / "无法创建本地数据库" | 部署 `libqsqlite.so` 到 `libs/${ABI_DIR}/sqldrivers/`（见 §6.2，OHOS 文件名 `libqsqlite.so`）；同时 `setDatabaseName` 用 `QStandardPaths::writableLocation(AppLocalDataLocation)` 绝对路径（OHOS CWD 不可写） |
| 库名不匹配 | 编译后 `ls libs/arm64-v8a/*.so` 检查实际文件名 |
| QML module not installed | 检查 `CMAKE_PREFIX_PATH` 配置 |
| QML 应用黑屏 | 检查 Qt 模块链接和 `CMAKE_PREFIX_PATH` |
| QML Window 无 focus 属性 | 键盘事件放在内部 `Item` 中 |
| 场景二构建找不到源文件 | `path` 必须用绝对路径指向根目录 CMakeLists.txt |
| lazy import 语法错误（`OhosExportModules.ts` 报 `does not support using lazy import`） | 项目级 `build-profile.json5` 的 product 加 `"compatibleSdkVersionStage": "beta3"`（**不要**改 `OhosExportModules.ts`——§9 铁律禁止；改 beta3 让 API 12 支持该语法） |
| `spawn java ENOENT`（PackageHap 阶段） | 命令行构建需 `export PATH="<DevEco>/jbr/bin:$PATH"`（IDE 内置 JBR；详见 `episodic/postmortems/coin3d-quarter-ohos.md` 坑6） |

## 参考来源

- [Qt for HarmonyOS CMake 交叉编译指南](https://wiki.qt.io/Qt_for_HarmonyOS/user_development/deveco_cmake_guide_cross_compile)
- [QML 应用部署指南](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_deply_qml_app_zh)
- [Qt for HarmonyOS 用户开发指南](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide)
- 内部 Skill：`<INTERNAL_SKILL>`
- 内部文档：`<INTERNAL_DOC>`

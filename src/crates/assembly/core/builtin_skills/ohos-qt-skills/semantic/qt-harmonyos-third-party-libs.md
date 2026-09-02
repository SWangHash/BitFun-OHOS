---
id: semantic-qt-harmonyos-third-party-libs
type: semantic
domain: tech
tags: [qt, harmonyos, third-party, cross-compile, cmake, vcpkg, dependency]
created: 2026-06-03
updated: 2026-08-15
status: active
audience: public
refs: [semantic-qt-harmonyos-build, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-platform-limits, semantic-qt-ohos-project-analyzer-workflow]
summary: >
  Qt 应用接入 OHOS 三方库的 adapter：Qt find_package/CMake、Qt 模块与插件部署、
  静态/动态链接选择、Qt 项目迁移检查和实测兼容清单；平台 NDK、ABI、sysroot、
  HAP native 部署与 loader 契约由 common 维护。
---

# 三方库鸿蒙化指南

> 将 Qt 应用移植到鸿蒙时，除了 Qt 模块本身的适配，还需要处理应用依赖的第三方 C/C++ 库。
> 平台通用的 NDK/toolchain、ABI、sysroot、产物检查、HAP native 部署与 loader 契约，以 common 的 [[ohos-common-kb/semantic/ohos-native-third-party-libraries|OHOS 原生三方库接入契约]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/ohos-native-third-party-libraries.md)）为准。本页只维护 Qt 包发现、目标链接、Qt plugin/module 部署与 Qt 应用验证。

---

## 1. 总体策略

| 策略 | 适用场景 | 复杂度 |
|------|---------|--------|
| **Header-only 库** | Eigen、nlohmann/json、spdlog（header-only 模式）等 | 🟢 低 — 直接包含头文件即可 |
| **源码交叉编译** | 有 CMake/autotools 构建系统的 C/C++ 库 | 🟡 中 — 需配置 OHOS 工具链 |
| **预编译 .so 集成** | 供应商提供 arm64 预编译二进制 | 🟡 中 — 需确认 ABI 兼容并正确部署 |
| **静态链接** | 希望避免 .so 部署问题的库 | 🟡 中 — 编译时链接，运行时无额外 .so |
| **系统库直链** | OHOS 系统自带的库（如 libz、libcrypto） | 🟢 低 — 直接链接，无需部署 |
| **替换/降级** | 不兼容且无法 patch 的库 | 🔴 高 — 需要寻找替代方案 |

---

> **📦 arm64 OHOS 预编译 bottle 来源 = Harmonybrew**：若某三方库已有 arm64_ohos 预编译包，可直接下载 .so 跳过本节交叉编译——见 [[fetch-ohos-third-party-lib]] 的一键拉取脚本（含依赖递归、sha256 校验、qmake/CMake 链接片段）。无 bottle 时继续按下文源码交叉编译。

## 2. Qt 消费的平台输入契约

先按 common 页面产出并验收目标 ABI 的 headers、静态库或共享库及其完整 `NEEDED` 闭包。Qt adapter 不规定 NDK、sysroot、autotools/Meson 参数或系统库可用性，只消费已经通过平台验收的产物。

动态库随 Qt HAP 部署时，还要同时确认 Qt runtime、QPA/style plugin 与三方依赖均进入最终包；不要只检查业务 target 的直接依赖。

---

## 3. CMake 集成三方库

### 3.1 在应用 CMakeLists.txt 中链接三方库

> **铁律**：与 Qt 应用交叉编译相同，三方库的 CMake 构建也需要设置 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH`，否则 `find_package` 无法找到依赖。完整的 save/restore 代码模式详见 [[qt-harmonyos-project-structure]] §4.2。

```cmake
# 1. 设置交叉编译 find_package 修复（同 Qt，详见 project-structure §4.2）
if(CMAKE_CROSSCOMPILING)
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
endif()

# 2. 查找三方库（如果库提供了 CMake config）
find_package(ZLIB REQUIRED)

# 3. 或者手动指定（如果库没有 CMake config）
set(THIRD_PARTY_PREFIX "$ENV{HOME}/ohos-libs")
include_directories(${THIRD_PARTY_PREFIX}/zlib/include)
link_directories(${THIRD_PARTY_PREFIX}/zlib/lib)

# 4. 链接到目标
target_link_libraries(QtHarmonyApp PRIVATE z ssl crypto)
```

### 3.2 使用 CMAKE_PREFIX_PATH

如果三方库安装时使用了标准目录结构（`lib/`、`include/`、`lib/cmake/`），可以通过 `CMAKE_PREFIX_PATH` 让 `find_package` 自动找到：

```cmake
# 在 DevEco 的 build-profile.json5 中设置：
# "arguments": "-DCMAKE_PREFIX_PATH=<Qt_SDK>;$ENV{HOME}/ohos-libs/zlib;$ENV{HOME}/ohos-libs/openssl"
```

### 3.3 静态链接三方库

如果三方库编译为静态库（`.a`），直接链接即可，无需部署 .so：

```cmake
target_link_libraries(QtHarmonyApp PRIVATE
    ${THIRD_PARTY_PREFIX}/zlib/lib/libz.a    # 静态链接
)
```

**优势**：避免 .so 部署问题，减少运行时依赖。
**劣势**：增大应用 .so 体积，多个模块使用同一静态库时可能符号冲突。

---

## 4. 平台限制在 Qt 项目中的检查点

平台限制及错误码不在本页维护。Qt 项目只记录受影响的消费点：

- `QPluginLoader` 或插件框架是否能从最终 HAP 的 native library 集合解析完整依赖；
- `QFile`/`QFileInfo` 包装的三方代码是否依赖 common 限制页列出的权限、链接或系统路径行为；
- `QThread` 上运行的三方 worker 是否依赖目标 libc 不提供的取消语义；
- `QTimeZone` 或库内时区逻辑是否需要 Qt ICU 后端；
- 静态链接是否引入重复符号、PIC 或许可证问题。

具体 Qt 症状和 workaround 见 [[qt-harmonyos-platform-limits]]，平台原因与状态以 common 为准。

---

## 5. 已知 Qt 应用兼容清单

> 此清单随实践积累。每次移植新三方库时，更新此表。

| 库 | 版本 | 引入方式 | OHOS 兼容性 | 备注 |
|----|------|---------|-------------|------|
| zlib | 系统自带 | 系统库 `-lz` | 🟢 可用 | 系统自带 |
| OpenSSL (crypto/ssl) | 系统自带 | 系统库 `-lcrypto -lssl` | 🟢 可用 | 系统自带；Qt 编译需额外配置头文件 |
| Eigen | 任意 | Header-only | 🟢 可用 | 纯头文件 |
| nlohmann/json | 任意 | Header-only | 🟢 可用 | 纯头文件 |
| SQLite | 3.x | 源码编译 / 系统 | 🟡 需 patch | 内部可能调用 `chmod()`，需 `#ifndef __OHOS__` 守卫 |
| ICU | 系统自带 | 系统库 | 🟢 可用 | Qt 时区后端依赖 |
| Boost (header-only) | 任意 | Header-only | 🟢 可用 | 纯头文件部分 |
| Boost.Filesystem | 任意 | 源码编译 | ⚠️ 确认有风险 | 使用 `chmod()`/`symlink()`，两者在 OHOS 均受限（详见 [[qt-harmonyos-platform-limits]]） |
| protobuf | 任意 | 源码编译 | 🟡 需验证 | 基础功能应可用（无 OHOS 特定限制），但未实际编译测试 |
| libcurl | 任意 | 源码编译 | 🟡 需验证 | 依赖 OpenSSL（OHOS 系统自带），网络 API 应兼容，但未实际编译测试 |
| freetype | — | Qt 内置 | 🟢 无需关注 | Qt 6 在 `src/3rdparty/freetype` 中内置 freetype，随 Qt GUI 一起编译 |
| Coin3D 4.0 | — | 预编译 .so | ✅ 已验证 | `libCoin.so.80` (ARM aarch64) 可直接集成，需 `-DCOIN_DLL` + 链接 `libGLv4.so` + `libEGL.so`。详见 [[coin3d-quarter-ohos]] |
| Quarter 1.2.3 | — | 源码编译 | ✅ 已验证 | 依赖 Coin3D + Qt5::Widgets/OpenGL，需移除 UiTools、自定义 FindOpenGL.cmake。详见 [[coin3d-quarter-ohos]] |
| QScintilla | 2.11.6 | 源码编译 (qmake) | ✅ 已验证 | 代码编辑器组件（含语法高亮），纯 QtCore/Gui/Widgets/PrintSupport 依赖，OHOS 交叉编译需自定义 mkspec (ohos-clang-win) 和短路径。无需源码修改 |
| QtMqtt | 6.12.0 (v6.12.0-beta2) | 源码编译 (qt-cmake 交叉) | ✅ 已验证 | Qt 官方 MQTT addon（MQTT 3.1/3.1.1/5.0 客户端）。**source-only 附加模块**，不在预构建安装器（开源版无组件可勾选），GPLv3（非 LGPL，闭源发行需商业许可或换 Paho/mosquitto）。流程：clone `qt/qtmqtt` checkout 对应 tag → `qt-cmake.bat`+`ohos.toolchain.cmake` 交叉编译 → `CMAKE_INSTALL_PREFIX=<QT6_OHOS_KIT>` **装进 OHOS kit**（关键招：libQt6Mqtt.so 进 kit `lib/`、cmake config 进 `lib/cmake/Qt6Mqtt/`、headers 进 `include/QtMqtt/`，demo `find_package(Qt6 Mqtt)` 与 harmonydeployqt6 拷库两头顺）。预构建 OHOS kit 带 `Qt6BuildInternalsConfig.cmake`，支持编 Qt addon。验证产出 libQt6Mqtt.so(395KB)+libsimplemqttclient.so+HAP(36MB)，NEEDED 全裸名（libQt6Mqtt.so NEEDED 含 libQt6WebSockets.so，harmonydeployqt6 递归拖依赖正确）。详见 [[qt-harmonyos-qt6-status]] \#21 |

---

## 6. 迁移评估检查清单

移植 Qt 应用时，在 [[qt-ohos-project-analyzer-workflow]] §3.4 的基础上，对每个三方库逐项确认：

- [ ] **列出所有三方库**：库名、版本、功能、引入方式
- [ ] **分类**：header-only / 源码编译 / 预编译 / 系统库
- [ ] **源码编译的库**：是否使用 CMake？是否可配置 OHOS 工具链？
- [ ] **平台限制检查**：源码中是否使用了 `chmod()`/`symlink()`/`dlopen()`/`pthread_cancel()`？
- [ ] **交叉编译**：使用 OHOS NDK 工具链编译通过？
- [ ] **.so 部署**：编译产出的 .so 已复制到 `entry/libs/arm64-v8a/`？
- [ ] **CMake 集成**：`CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH` 已设置？
- [ ] **系统库**：是否可以直接使用系统版本，无需自带？
- [ ] **静态链接**：是否可以用静态链接避免 .so 部署问题？
- [ ] **验证**：编译通过 + 运行时 .so 加载成功 + 功能正常？

---

## 参考来源

- [Building Qt for HarmonyOS](https://wiki.qt.io/Building_Qt_for_HarmonyOS) — Qt 交叉编译工具链配置（可复用于三方库）
- [Building C/C++ libraries for HarmonyOS with vcpkg (Qt Blog)](https://www.qt.io/blog/building-libraries-for-harmonyos-with-vcpkg) — vcpkg 三方库编译参考
- [HarmonyOS Platform Limitations](https://wiki.qt.io/Qt_for_HarmonyOS/platform_limitations) — 平台限制详情（影响三方库兼容性）
- [Qt for HarmonyOS Project Structure](../semantic/qt-harmonyos-project-structure.md) — .so 部署目录和 CMake 配置

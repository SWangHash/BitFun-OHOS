---
updated: 2026-09-19
total_problems: 46
description: >
  错误速查索引（从 problem 页 frontmatter 重建）。
---

# 错误速查表

> 遇到执行错误时，先在此搜索 error_message / error_code。
> Qt 平台已知限制在 semantic/qt-harmonyos-platform-limits.md。

## 按错误码速查

| 错误码 | 问题文件 | 简述 |
|--------|---------|------|
| N/A | [build-fail-bash-path-escape](build-fail-bash-path-escape.md) | C:PROGRA~1HuaweiDEVECO~1sdkdefaultOPENHA~1native/llvm/bin/clang++: No such file or directory |
| 00306049 | [build-fail-duplicate-so](build-fail-duplicate-so.md) | hvigor 构建在 ProcessLibs 阶段失败，报 Duplicated files found |
| 00308018 | [build-fail-hvigor-spawn-java-enoent](build-fail-hvigor-spawn-java-enoent.md) | Qt5 鸿蒙 demo 用 bash 跑 `node hvigorw.js assembleHap`,CMake/ninja 编 C++ 通过、ArkTS 编译通过, 但最后 PackageHap 步骤报 `spawn java ENOENT` 失败。`which java` 在 bash 里即使把 DevEco jbr/bin 加进 PATH 也找不到(或找到但 node spawn 仍 ENOENT)。 |
| N/A | [build-fail-qtohosextras-camelcase-headers](build-fail-qtohosextras-camelcase-headers.md) | fatal error: 'QtOhosExtras/QOhosAppContext' file not found |
| N/A | [runtime-curl-chinese-garbled](runtime-curl-chinese-garbled.md) | curl POST/PATCH 请求体中的中文字符在 API 端显示为乱码（如 Cyrillic 字符 ֪ʶ⽻） |
| errno=22 (EINVAL) | [runtime-fail-dlopen-writable-path](runtime-fail-dlopen-writable-path.md) | 运行时加载 .so 插件失败，dlopen 返回 EINVAL，路径在 /data/storage/el2/ 下 |
| N/A | [build-qt612-qos-harmony-macro](build-qt612-qos-harmony-macro.md) | Qt 6.12 kit 平台宏是 Q_OS_HARMONY 非 Q_OS_OHOS；nice_target_sources 标记 not_linux 会静默排除全部 ohos 实现文件，链接集中爆 undefined |
| N/A | [build-clang15-libcpp15-cpp20-gaps](build-clang15-libcpp15-cpp20-gaps.md) | clang15/libc++15 的 8 类 C++20 缺口：lambda 捕获结构化绑定/P0960 聚合圆括号/P0634 省略 typename/stop_token/atomic_ref/ranges/shared_ptr<=>/variant QString |
| N/A | [runtime-hap-missing-so-closure](runtime-hap-missing-so-closure.md) | HAP 启动 64ms 即死无 cppcrash、jscrash TypeError handleAbilityStageOnCreate of undefined——libqohos 依赖 .so 闭包缺失（libbz2/libz/libdav1d/libaom）+ aom 源码编译/dav1d 静态转 so |
| N/A | [build-qt612-ohos-plugin-rebuild](build-qt612-ohos-plugin-rebuild.md) | 重编 Qt 6.12 ohos 平台插件五连坑：qt-cmake 拒绝构建 qtbase 本体→cmake BUILD_SUBMODULES；缺 NODE_ADDON_API_ROOT；FIND_ROOT_PATH_MODE_INCLUDE=ONLY 重根化致 find 失败→预填 cache 变量；缺 OHOS_SDK_ROOT→QtPriHelpers TO_CMAKE_PATH 报错；QT_FEATURE_fontconfig 条件作用域看不到 Fontconfig_FOUND→patch gui CMakeLists；产物须替换 kit（deploy 从 kit 复制） |
| N/A | [runtime-ohos-ime-reset-detach](runtime-ohos-ime-reset-detach.md) | Qt ohos 插件 QOhosInputContext::reset() 的 Detach/Attach 使拼音组合中键盘收起+拼音字母污染文本；修复=只 finalize preedit；含 IMF 探针排查法（IMEPROBE）与「中文搜索无结果」三角验证定性（服务器不索引中文短词，非移植 bug） |
| N/A | [build-fail-configure-exec-bit-crlf](build-fail-configure-exec-bit-crlf.md) | Linux/macOS 下 sh configure 报 Permission denied / bad interpreter ^M：开源镜像初始导入丢执行位 + CRLF；src-clone 已默认 POSIX 构建分支并自动恢复执行位（QOH037） |
| N/A | [build-fail-python-not-found](build-fail-python-not-found.md) | qtdeclarative 报 `sh: 1: python: not found` / Building QtQml requires Python：Linux 无 python 别名；CLI 已内置 .qtsdk/pyshim 自动 shim（QOH038） |
| N/A | [build-fail-qtdbus-deprecated-copy](build-fail-qtdbus-deprecated-copy.md) | qdbusreply.h -Wdeprecated-copy 类警告被 -Werror 拦下：鸿蒙无 DBus，configure 必须 -no-dbus（CLI 已内置，QOH039） |
| N/A | [build-fail-stale-build-state](build-fail-stale-build-state.md) | 改 -no-dbus / 换 SDK 后 ibus 插件仍构建报 unknown type name QDBusArgument：旧模块 pri 残留，qtHaveModule 误判；CLI 已加 configure 指纹防护自动清目录（QOH040） |
| N/A | [build-fail-ohos-sdk-api-too-old](build-fail-ohos-sdk-api-too-old.md) | qarkui/input.cpp 报 no member named OH_ArkUI_PointerEvent_GetGlobalDisplayX 等：SDK API 版本过旧，需 OpenHarmony ≥ 6.1（API 23，QOH041） |
| N/A | [runtime-harmonydeployqt-deploy-gaps](runtime-harmonydeployqt-deploy-gaps.md) | 签名 HAP 设备侧 dlopen 连环失败：QPA 插件 fontconfig 链不部署、无 SONAME bottle 截断依赖解析、libz namespace 外、设备系统库非标路径、bottle 缺无版本名（QOH042，5 条检查清单） |

## 按症状速查

| 症状关键字 | 问题文件 | 简述 |
|-----------|---------|------|
| `C:PROGRA~1HuaweiDEVECO~1sdkdefaultOPENHA~1native` | [build-fail-bash-path-escape](build-fail-bash-path-escape.md) | C:PROGRA~1HuaweiDEVECO~1sdkdefaultOPENHA~1native/llvm/bin/clang++: No such file or directory |
| `编译报错：QtOhosExtras::AbilityClose 等枚举值找不到` | [build-fail-closeeventrootcause-path](build-fail-closeeventrootcause-path.md) | 编译报错：QtOhosExtras::AbilityClose 等枚举值找不到 |
| `CMake configure 阶段报错 find_package 找不到 OhosExtras` | [build-fail-cmake-ohosextras](build-fail-cmake-ohosextras.md) | CMake configure 阶段报错 find_package 找不到 OhosExtras 包 |
| `hvigor 构建在 ProcessLibs 阶段失败，报 Duplicated files f` | [build-fail-duplicate-so](build-fail-duplicate-so.md) | hvigor 构建在 ProcessLibs 阶段失败，报 Duplicated files found |
| `编译 FFmpeg 相关代码时报 undeclared identifier` | [build-fail-ffmpeg9-removed-api](build-fail-ffmpeg9-removed-api.md) | 编译 FFmpeg 相关代码时报 undeclared identifier |
| `Linux 应用移植 OHOS，编译报 unknown type name '__pid_t'/` | [build-fail-glibc-internal-symbols-ohos-musl](build-fail-glibc-internal-symbols-ohos-musl.md) | Linux 应用移植 OHOS，编译报 unknown type name '__pid_t'/'__uid_t' 或 in6_addr no member 's6_addr32' |
| `Qt5 鸿蒙 demo 用 bash 跑 `node hvigorw.js assembleHa` | [build-fail-hvigor-spawn-java-enoent](build-fail-hvigor-spawn-java-enoent.md) | Qt5 鸿蒙 demo 用 bash 跑 `node hvigorw.js assembleHap`,CMake/ninja 编 C++ 通过、ArkTS 编译通过, 但最后 PackageHap 步骤报 `spawn java ENOENT` 失败。`which java` 在 bash 里即使把 DevEco jbr/bin 加进 PATH 也找不到(或找到但 node spawn 仍 ENOENT)。 |
| `Linux Qt 应用移植 OHOS，编译报找不到 uuid/uuid.h 或链接找不到 -lu` | [build-fail-libuuid-missing-ohos-musl](build-fail-libuuid-missing-ohos-musl.md) | Linux Qt 应用移植 OHOS，编译报找不到 uuid/uuid.h 或链接找不到 -luuid |
| `编译含 magic_enum 的源文件时报 bracket depth exceeded` | [build-fail-magic-enum-bracket-depth](build-fail-magic-enum-bracket-depth.md) | 编译含 magic_enum 的源文件时报 bracket depth exceeded |
| `Qt OHOS app 入口 shim 用 extern "C" main + 有 .qrc 资` | [build-fail-qinitresource-extern-c-main](build-fail-qinitresource-extern-c-main.md) | Qt OHOS app 入口 shim 用 extern "C" main + 有 .qrc 资源，链接报 undefined symbol: qInitResources_<name> |
| `unable to find library -licui18n / ICU=no / ures` | [build-fail-qt515-icu-detection](build-fail-qt515-icu-detection.md) | unable to find library -licui18n / ICU=no / ures.h not found / UCNV_FROM_U_CALLBACK_SUBSTITUTE undeclared |
| `no member named 'nullptr_t' in the global namesp` | [build-fail-qt6-libcpp-musl-isystem](build-fail-qt6-libcpp-musl-isystem.md) | no member named 'nullptr_t' in the global namespace; use of undeclared identifier '__promote'; call to 'hypot' is ambiguous (libcxx-ohos c++/v1/cstddef, cmath; -isystem sysroot/usr/include 注入致 musl 遮蔽 clang builtin) |
| `fatal error: 'QtOhosExtras/QOhosAppContext' file` | [build-fail-qtohosextras-camelcase-headers](build-fail-qtohosextras-camelcase-headers.md) | fatal error: 'QtOhosExtras/QOhosAppContext' file not found |
| `spawn java ENOENT; BuildNativeWithCmake finished` | [build-hvigor-native-skip](build-hvigor-native-skip.md) | spawn java ENOENT; BuildNativeWithCmake finished after 1ms with no .so artifact (DEVECO_SDK_HOME missing) |
| `CMake Error: find_package(Qt5 COMPONENTS Widgets` | [build-missing-qt5uitools-ohos](build-missing-qt5uitools-ohos.md) | CMake Error: find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET) 失败 (OHOS Qt5 SDK 缺 Qt5UiTools 模块) |
| `hvigor CLI 打包 HAP 安装后启动崩溃，DevEco Studio IDE Run ` | [deploy-fail-hvigor-cli-hap-crash](deploy-fail-hvigor-cli-hap-crash.md) | hvigor CLI 打包 HAP 安装后启动崩溃，DevEco Studio IDE Run 正常 |
| `Q_ASSERT(receiver->d_func()->threadData.loadAcqu` | [ohos-mainthread-mismatch](ohos-mainthread-mismatch.md) | Q_ASSERT(receiver->d_func()->threadData.loadAcquire()->thread.loadRelaxed() == mainThread()) in QCoreApplicationPrivate::sendThroughApplicationEventFilters (Debug 构建鼠标点击事件触发) |
| `开发者误以为 QFileDialog 在 OHOS 需 \#ifdef Q_OS_OHOS 替代` | [ohos-qfiledialog-native-support](ohos-qfiledialog-native-support.md) | 开发者误以为 QFileDialog 在 OHOS 需 \#ifdef Q_OS_OHOS 替代方案（QInputDialog/硬编码路径）， 添加不必要守卫代码导致维护负担与原生支持冲突；实际 QOhosPlatformIntegrationPlugin 已内置原生支持， 标准 QFileDialog API 可直接使用。 |
| `Qt3D 实体贴图纯黑（cloud 球壳 / saturn 星环 / uranus 星环），光照` | [render-black-rgba8-zink-mipmap](render-black-rgba8-zink-mipmap.md) | Qt3D 实体贴图纯黑（cloud 球壳 / saturn 星环 / uranus 星环），光照与阴影正常； 同 effect 下用 RGB8 JPG 的实体贴图正常；唯一判别变量是贴图格式 RGBA8(alpha) vs RGB8(JPG)。 |
| `QDialog 关不掉 + 不能滚动（同时出现），尤其在 matplotlib 三级窗口场景` | [runtime-blocked-by-modal-window-no-parent](runtime-blocked-by-modal-window-no-parent.md) | QDialog 关不掉 + 不能滚动（同时出现），尤其在 matplotlib 三级窗口场景 |
| `HAP 安装成功但点击启动崩溃，报 QAbilityStage.ets 中 handleAbil` | [runtime-crash-arkts-template-modules-mismatch](runtime-crash-arkts-template-modules-mismatch.md) | HAP 安装成功但点击启动崩溃，报 QAbilityStage.ets 中 handleAbilityStageOnCreate undefined |
| `签名 HAP 安装成功,aa start 后进程 1-9s 内消失。faultlog 显示 js` | [runtime-crash-libqohos-libqt5core-version-mismatch](runtime-crash-libqohos-libqt5core-version-mismatch.md) | 签名 HAP 安装成功,aa start 后进程 1-9s 内消失。faultlog 显示 jscrash TypeError (handleAbilityStageOnCreate of undefined 或 deviceType property 缺失)。 |
| `签名 HAP 安装成功,aa start 启动后进程 1-2 秒内消失(启动即崩),桌面不显示应` | [runtime-crash-libqohos-modules-mismatch](runtime-crash-libqohos-modules-mismatch.md) | 签名 HAP 安装成功,aa start 启动后进程 1-2 秒内消失(启动即崩),桌面不显示应用窗口或一闪即退。 |
| `用户在 Load File 路径输入框输入路径时应用闪退（还没点 Load 按钮）` | [runtime-crash-loadfile-textchanged-no-debounce](runtime-crash-loadfile-textchanged-no-debounce.md) | 用户在 Load File 路径输入框输入路径时应用闪退（还没点 Load 按钮） |
| `应用启动后约1秒崩溃（C++ SIGSEGV），QtMainThread栈帧显示空指针解引用` | [runtime-crash-null-pointer-entry-shim](runtime-crash-null-pointer-entry-shim.md) | 应用启动后约1秒崩溃（C++ SIGSEGV），QtMainThread栈帧显示空指针解引用 |
| `签名 HAP 安装成功,aa start 后应用能启动(Qt 窗口出现、QtWatchdog 运` | [runtime-crash-ohos-deviceinfo-global-expression](runtime-crash-ohos-deviceinfo-global-expression.md) | 签名 HAP 安装成功,aa start 后应用能启动(Qt 窗口出现、QtWatchdog 运行),但触发 onAcceptWant (多实例/窗口 recreate/QApplication 二次构造)时进程崩溃;faultlog LAST_FATAL_MESSAGE 即上述 Napi::Error。 注意:本错误与"object has no property named 'deviceType'"是 @ohos.deviceInfo 崩溃谱的两个不同代际错误(见下)。 |
| `应用启动后延迟崩溃（SIGABRT），崩溃栈显示配置文件写入失败后调用 exit(1)` | [runtime-crash-sandbox-readonly-path](runtime-crash-sandbox-readonly-path.md) | 应用启动后延迟崩溃（SIGABRT），崩溃栈显示配置文件写入失败后调用 exit(1) |
| `curl POST/PATCH 请求体中的中文字符在 API 端显示为乱码（如 Cyrillic` | [runtime-curl-chinese-garbled](runtime-curl-chinese-garbled.md) | curl POST/PATCH 请求体中的中文字符在 API 端显示为乱码（如 Cyrillic 字符 ֪ʶ⽻） |
| `运行时加载 .so 插件失败，dlopen 返回 EINVAL，路径在 /data/storag` | [runtime-fail-dlopen-writable-path](runtime-fail-dlopen-writable-path.md) | 运行时加载 .so 插件失败，dlopen 返回 EINVAL，路径在 /data/storage/el2/ 下 |
| `Opening Add Qt Versions shows an invalid-path po` | [runtime-fail-file-dialog-invalid-default-uri](runtime-fail-file-dialog-invalid-default-uri.md) | Opening Add Qt Versions shows an invalid-path popup, or the system picker does not list a qmake file without an extension. |
| `应用启动后立即崩溃（JSCrash TypeError），日志显示 libQt5DBus.so ` | [runtime-fail-libqtdbus-missing](runtime-fail-libqtdbus-missing.md) | 应用启动后立即崩溃（JSCrash TypeError），日志显示 libQt5DBus.so 加载失败 |
| `应用启动后立即崩溃，日志报 dlopen failed 或 platform plugin no` | [runtime-fail-qpa-plugin-not-found](runtime-fail-qpa-plugin-not-found.md) | 应用启动后立即崩溃，日志报 dlopen failed 或 platform plugin not found |
| `应用启动即弹 QMessageBox '无法创建本地数据库 !' 后崩溃退出（实为 native` | [runtime-fail-sqlite-open-database](runtime-fail-sqlite-open-database.md) | 应用启动即弹 QMessageBox '无法创建本地数据库 !' 后崩溃退出（实为 native cppcrash），Login 窗口未显示 |
| `应用启动后立即崩溃，hilog 显示 dlopen failed 或 symbol not fo` | [runtime-ffmpeg-versioned-soname-transitive-deps](runtime-ffmpeg-versioned-soname-transitive-deps.md) | 应用启动后立即崩溃，hilog 显示 dlopen failed 或 symbol not found |
| `Qt QML 应用在 OHOS 暗主题设备运行，按钮和输入框默认背景纯黑，控件与背景融为一片看不` | [runtime-style-dark-palette-pure-black](runtime-style-dark-palette-pure-black.md) | Qt QML 应用在 OHOS 暗主题设备运行，按钮和输入框默认背景纯黑，控件与背景融为一片看不清边界(文字可见)。 |
| `设置 XComponent surface opaque 时 SurfaceHolder_Cre` | [surfaceholder-nativexcomponent-incompatibility](surfaceholder-nativexcomponent-incompatibility.md) | 设置 XComponent surface opaque 时 SurfaceHolder_Create 返回 null； 或 GetNativeXComponent 在节点挂载前返回 null 导致启动崩溃。 |

## 按领域分组

### 编译构建

| 严重度 | 问题文件 | 简述 |
|:------:|---------|------|
| 🟡 medium | [build-fail-bash-path-escape](build-fail-bash-path-escape.md) | C:PROGRA~1HuaweiDEVECO~1sdkdefaultOPENHA~1native/llvm/bin/clang++: No such file or directory |
| 🟠 high | [build-fail-closeeventrootcause-path](build-fail-closeeventrootcause-path.md) | 编译报错：QtOhosExtras::AbilityClose 等枚举值找不到 |
| 🟠 high | [build-fail-cmake-ohosextras](build-fail-cmake-ohosextras.md) | CMake configure 阶段报错 find_package 找不到 OhosExtras 包 |
| 🟡 medium | [build-fail-duplicate-so](build-fail-duplicate-so.md) | hvigor 构建在 ProcessLibs 阶段失败，报 Duplicated files found |
| 🟡 medium | [build-fail-ffmpeg9-removed-api](build-fail-ffmpeg9-removed-api.md) | 编译 FFmpeg 相关代码时报 undeclared identifier |
| 🟡 medium | [build-fail-glibc-internal-symbols-ohos-musl](build-fail-glibc-internal-symbols-ohos-musl.md) | Linux 应用移植 OHOS，编译报 unknown type name '__pid_t'/'__uid_t' 或 in6_addr no member 's6_addr32' |
| 🟠 high | [build-fail-hvigor-spawn-java-enoent](build-fail-hvigor-spawn-java-enoent.md) | Qt5 鸿蒙 demo 用 bash 跑 `node hvigorw.js assembleHap`,CMake/ninja 编 C++ 通过、ArkTS 编译通过, 但最后 PackageHap 步骤报 `spawn java ENOENT` 失败。`which java` 在 bash 里即使把 DevEco jbr/bin 加进 PATH 也找不到(或找到但 node spawn 仍 ENOENT)。 |
| 🟠 high | [build-fail-libuuid-missing-ohos-musl](build-fail-libuuid-missing-ohos-musl.md) | Linux Qt 应用移植 OHOS，编译报找不到 uuid/uuid.h 或链接找不到 -luuid |
| 🟡 medium | [build-fail-magic-enum-bracket-depth](build-fail-magic-enum-bracket-depth.md) | 编译含 magic_enum 的源文件时报 bracket depth exceeded |
| 🟡 medium | [build-fail-qinitresource-extern-c-main](build-fail-qinitresource-extern-c-main.md) | Qt OHOS app 入口 shim 用 extern "C" main + 有 .qrc 资源，链接报 undefined symbol: qInitResources_<name> |
| 🟠 high | [build-fail-qt515-icu-detection](build-fail-qt515-icu-detection.md) | unable to find library -licui18n / ICU=no / ures.h not found / UCNV_FROM_U_CALLBACK_SUBSTITUTE undeclared |
| ⬜ blocker | [build-fail-qt6-libcpp-musl-isystem](build-fail-qt6-libcpp-musl-isystem.md) | no member named 'nullptr_t' in the global namespace; use of undeclared identifier '__promote'; call to 'hypot' is ambiguous (libcxx-ohos c++/v1/cstddef, cmath; -isystem sysroot/usr/include 注入致 musl 遮蔽 clang builtin) |
| 🟡 medium | [build-fail-qtohosextras-camelcase-headers](build-fail-qtohosextras-camelcase-headers.md) | fatal error: 'QtOhosExtras/QOhosAppContext' file not found |
| 🟠 high | [build-hvigor-native-skip](build-hvigor-native-skip.md) | spawn java ENOENT; BuildNativeWithCmake finished after 1ms with no .so artifact (DEVECO_SDK_HOME missing) |
| 🟡 medium | [build-missing-qt5uitools-ohos](build-missing-qt5uitools-ohos.md) | CMake Error: find_package(Qt5 COMPONENTS Widgets UiTools OpenGL QUIET) 失败 (OHOS Qt5 SDK 缺 Qt5UiTools 模块) |

### caveat

| 严重度 | 问题文件 | 简述 |
|:------:|---------|------|
| 🟢 low | [ohos-qfiledialog-native-support](ohos-qfiledialog-native-support.md) | 开发者误以为 QFileDialog 在 OHOS 需 \#ifdef Q_OS_OHOS 替代方案（QInputDialog/硬编码路径）， 添加不必要守卫代码导致维护负担与原生支持冲突；实际 QOhosPlatformIntegrationPlugin 已内置原生支持， 标准 QFileDialog API 可直接使用。 |

### 部署安装

| 严重度 | 问题文件 | 简述 |
|:------:|---------|------|
| 🟡 medium | [deploy-fail-hvigor-cli-hap-crash](deploy-fail-hvigor-cli-hap-crash.md) | hvigor CLI 打包 HAP 安装后启动崩溃，DevEco Studio IDE Run 正常 |

### errors

| 严重度 | 问题文件 | 简述 |
|:------:|---------|------|
| 🟠 high | [surfaceholder-nativexcomponent-incompatibility](surfaceholder-nativexcomponent-incompatibility.md) | 设置 XComponent surface opaque 时 SurfaceHolder_Create 返回 null； 或 GetNativeXComponent 在节点挂载前返回 null 导致启动崩溃。 |

### 运行时

| 严重度 | 问题文件 | 简述 |
|:------:|---------|------|
| 🟠 high | [ohos-mainthread-mismatch](ohos-mainthread-mismatch.md) | Q_ASSERT(receiver->d_func()->threadData.loadAcquire()->thread.loadRelaxed() == mainThread()) in QCoreApplicationPrivate::sendThroughApplicationEventFilters (Debug 构建鼠标点击事件触发) |
| 🟠 high | [render-black-rgba8-zink-mipmap](render-black-rgba8-zink-mipmap.md) | Qt3D 实体贴图纯黑（cloud 球壳 / saturn 星环 / uranus 星环），光照与阴影正常； 同 effect 下用 RGB8 JPG 的实体贴图正常；唯一判别变量是贴图格式 RGBA8(alpha) vs RGB8(JPG)。 |
| 🟠 high | [runtime-blocked-by-modal-window-no-parent](runtime-blocked-by-modal-window-no-parent.md) | QDialog 关不掉 + 不能滚动（同时出现），尤其在 matplotlib 三级窗口场景 |
| 🟠 high | [runtime-crash-arkts-template-modules-mismatch](runtime-crash-arkts-template-modules-mismatch.md) | HAP 安装成功但点击启动崩溃，报 QAbilityStage.ets 中 handleAbilityStageOnCreate undefined |
| 🔴 critical | [runtime-crash-libqohos-libqt5core-version-mismatch](runtime-crash-libqohos-libqt5core-version-mismatch.md) | 签名 HAP 安装成功,aa start 后进程 1-9s 内消失。faultlog 显示 jscrash TypeError (handleAbilityStageOnCreate of undefined 或 deviceType property 缺失)。 |
| 🔴 critical | [runtime-crash-libqohos-modules-mismatch](runtime-crash-libqohos-modules-mismatch.md) | 签名 HAP 安装成功,aa start 启动后进程 1-2 秒内消失(启动即崩),桌面不显示应用窗口或一闪即退。 |
| 🟠 high | [runtime-crash-loadfile-textchanged-no-debounce](runtime-crash-loadfile-textchanged-no-debounce.md) | 用户在 Load File 路径输入框输入路径时应用闪退（还没点 Load 按钮） |
| 🔴 critical | [runtime-crash-null-pointer-entry-shim](runtime-crash-null-pointer-entry-shim.md) | 应用启动后约1秒崩溃（C++ SIGSEGV），QtMainThread栈帧显示空指针解引用 |
| 🔴 critical | [runtime-crash-ohos-deviceinfo-global-expression](runtime-crash-ohos-deviceinfo-global-expression.md) | 签名 HAP 安装成功,aa start 后应用能启动(Qt 窗口出现、QtWatchdog 运行),但触发 onAcceptWant (多实例/窗口 recreate/QApplication 二次构造)时进程崩溃;faultlog LAST_FATAL_MESSAGE 即上述 Napi::Error。 注意:本错误与"object has no property named 'deviceType'"是 @ohos.deviceInfo 崩溃谱的两个不同代际错误(见下)。 |
| 🔴 critical | [runtime-crash-sandbox-readonly-path](runtime-crash-sandbox-readonly-path.md) | 应用启动后延迟崩溃（SIGABRT），崩溃栈显示配置文件写入失败后调用 exit(1) |
| 🟡 medium | [runtime-curl-chinese-garbled](runtime-curl-chinese-garbled.md) | curl POST/PATCH 请求体中的中文字符在 API 端显示为乱码（如 Cyrillic 字符 ֪ʶ⽻） |
| 🟠 high | [runtime-fail-dlopen-writable-path](runtime-fail-dlopen-writable-path.md) | 运行时加载 .so 插件失败，dlopen 返回 EINVAL，路径在 /data/storage/el2/ 下 |
| 🟠 high | [runtime-fail-file-dialog-invalid-default-uri](runtime-fail-file-dialog-invalid-default-uri.md) | Opening Add Qt Versions shows an invalid-path popup, or the system picker does not list a qmake file without an extension. |
| 🔴 critical | [runtime-fail-libqtdbus-missing](runtime-fail-libqtdbus-missing.md) | 应用启动后立即崩溃（JSCrash TypeError），日志显示 libQt5DBus.so 加载失败 |
| 🔴 critical | [runtime-fail-qpa-plugin-not-found](runtime-fail-qpa-plugin-not-found.md) | 应用启动后立即崩溃，日志报 dlopen failed 或 platform plugin not found |
| 🟠 high | [runtime-fail-sqlite-open-database](runtime-fail-sqlite-open-database.md) | 应用启动即弹 QMessageBox '无法创建本地数据库 !' 后崩溃退出（实为 native cppcrash），Login 窗口未显示 |
| 🔴 critical | [runtime-ffmpeg-versioned-soname-transitive-deps](runtime-ffmpeg-versioned-soname-transitive-deps.md) | 应用启动后立即崩溃，hilog 显示 dlopen failed 或 symbol not found |
| 🟡 medium | [runtime-style-dark-palette-pure-black](runtime-style-dark-palette-pure-black.md) | Qt QML 应用在 OHOS 暗主题设备运行，按钮和输入框默认背景纯黑，控件与背景融为一片看不清边界(文字可见)。 |

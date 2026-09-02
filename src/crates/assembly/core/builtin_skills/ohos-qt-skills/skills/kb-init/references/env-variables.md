# ENV.md 变量参考

本文件说明 `ENV.local.md` 中每个变量的含义和用途。

## IDE 与工具路径

| 变量名 | 含义 | 示例值 |
|--------|------|--------|
| `DEVECO_PATH` | DevEco Studio 安装路径 | macOS: `/Applications/DevEco-Studio.app`<br>Windows: `C:\Program Files\Huawei\DevEco Studio` |
| `OHOS_SDK_NATIVE` | OHOS SDK native 工具链路径（含 clang/sysroot） | macOS: `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native` |

## DevEco 自带工具

以下工具随 DevEco Studio 安装，无需单独安装。它们位于 `DEVECO_PATH` 下的子目录中。

> **macOS 注意**：macOS 的 `.app` 包结构中，工具在 `Contents/` 子目录下。
> 下表路径以 Windows/Linux 为基准，macOS 用户需在 `DEVECO_PATH` 后加 `/Contents`。

| 工具 | Windows/Linux 路径 | macOS 路径 | 用途 | 引用次数 |
|------|-------------------|------------|------|----------|
| **devecocli** | `<DEVECO>/tools/devecocli.bat` | `<DEVECO>/Contents/tools/devecocli` | DevEco 命令行工具（构建、安装、日志） | 13 次 |
| **hvigorw** | `<DEVECO>/tools/hvigor/bin/hvigorw.js` | `<DEVECO>/Contents/tools/hvigor/bin/hvigorw.js` | HarmonyOS 项目构建工具（类似 Gradle） | 41 次 |
| **ohpm** | `<DEVECO>/sdk/default/openharmony/ohpm/bin/ohpm` | `<DEVECO>/Contents/sdk/default/openharmony/ohpm/bin/ohpm` | HarmonyOS 包管理器（安装依赖） | 3 次 |
| **hdc** | `<DEVECO>/sdk/default/openharmony/toolchains/hdc.exe` | `<DEVECO>/Contents/sdk/default/openharmony/toolchains/hdc` | 设备连接器（安装应用、日志、调试） | 95 次 |
| **clang/clang++** | `<DEVECO>/sdk/default/openharmony/native/llvm/bin/clang.exe` | `<DEVECO>/Contents/sdk/default/openharmony/native/llvm/bin/clang` | 交叉编译器（编译 C/C++ 代码） | 54+48 次 |

> **提示**：建议将工具目录加入系统 PATH，这样可以直接在终端使用 `devecocli`、`hdc` 等命令。
> - macOS: `echo 'export PATH="/Applications/DevEco-Studio.app/Contents/tools:$PATH"' >> ~/.zshrc`
> - Windows: 系统设置 → 环境变量 → Path → 添加 `C:\Program Files\Huawei\DevEco Studio\tools`

## Qt 源码路径

仅当你 clone 了 Qt 源码时需要配置。使用预编译 SDK 的用户不需要。

| 变量名 | 含义 | 示例值 |
|--------|------|--------|
| `QT5_12_SRC` | Qt 5.12.12 源码目录 | `/Users/you/dev/qt-src/qt5.12` |
| `QT5_15_SRC` | Qt 5.15.16 源码目录 | `/Users/you/dev/qt-src/qt5.15` |
| `QT6_DEV_SRC` | Qt 6 dev 主干源码（鸿蒙化进行中，仅 qtbase） | `/Users/you/dev/qt6-work/qt6-src` |

## 编译产物与 SDK

| 变量名 | 含义 | 示例值 |
|--------|------|--------|
| `QT_BUILD_ROOT` | Qt 编译输出目录（仅编译 Qt 框架时需要） | `/Users/you/dev/qt-build` |
| `QT5_12_OHOS_SDK` | Qt 5.12 OHOS SDK 路径（CMake 的 CMAKE_PREFIX_PATH） | `/Users/you/dev/qt-sdk/Qt5.12.12-arm64-v8a` |
| `QT5_15_OHOS_SDK` | Qt 5.15 OHOS SDK 路径 | `/Users/you/dev/qt-sdk/Qt5.15.16-arm64-v8a` |

## 模板

| 变量名 | 含义 | 示例值 |
|--------|------|--------|
| `OHOS_TEMPLATE_SRC` | Qt 鸿蒙胶水模板路径 | 有源码: `/Users/you/dev/qt-src/qt5.12/qtbase/src/harmonyos/templates`<br>无源码: BitFun 用户级 `data/qt-migration/templates/<Qt版本>/<模板版本>` |
| `OHOS_TEMPLATE_STANDALONE` | 独立模板归档路径（无 Qt 源码时使用，文档概念，不写入 ENV.local.md） | BitFun 用户级 `data/qt-migration/templates/<Qt版本>/<模板版本>` |

**有 Qt 源码时**：模板内置在源码树中，`generate-env-local.sh` 自动从 `QT5_15_SRC` 或 `QT5_12_SRC` 计算。

**无 Qt 源码时（仅预编译 SDK 或鸿蒙 PC）**：运行 `bash skills/kb-init/scripts/download-template.sh`。脚本默认下载到 BitFun 用户级共享资源目录，并输出 `OHOS_TEMPLATE_SRC`；只有用户明确要求自定义位置时才传 `--dest`。

## 构建工具链（仅 Windows 编译 Qt 框架时需要）

| 变量名 | 含义 | 示例值 |
|--------|------|--------|
| `MINGW_ROOT` | MinGW 工具链路径 | `C:\mingw64` |
| `PERL_ROOT` | Strawberry Perl 路径 | `C:\Strawberry` |

> 应用开发者不需要这些变量。

## 知识库内嵌内容

| 变量名 | 含义 | 值 |
|--------|------|-----|
| `OHOS_COMMON_KB_PUBLIC` | 内嵌的 HarmonyOS 平台通用知识库 | `ohos-common-kb-public/`（相对路径，无需配置） |

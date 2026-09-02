---
id: procedural-qt6-ohos-windows-cli-deploy
type: procedural
domain: deploy
tags: [qt6, qt6.12, harmonyos, ohos, cmake, hvigor, harmonydeployqt, hap, windows, cli, installer, beta2]
created: 2026-08-01
updated: 2026-08-01
status: active
audience: public
refs: [semantic-qt-harmonyos-qt6-status, semantic-qt-harmonyos-build, semantic-qt-harmonyos-build-run-workflow, semantic-qt-harmonyos-project-structure]
summary: >
  用预构建安装器装的 Qt 6.12.0 Beta2 在 Windows 命令行端到端编译 Qt 项目并生成鸿蒙 DevEco 工程：
  官方 wiki CLI 工作流（qt-cmake → cmake --build → harmonydeployqt6 → DevEco 签名装设备）
  + 本机实际路径（${QT6_INSTALL_ROOT}、${DEVECO_STUDIO} junction、API 23 native）+
  预构建省 patch（NEEDED 已裸名、qt_add_executable 自动 main GLOBAL DEFAULT）。补 wiki 未覆盖的
  QT_CHAINLOAD_TOOLCHAIN_FILE 必填、DevEco 空格陷阱、_make_hap 一键目标、签名六件套。
---

# Qt 6.12.0 Beta2 预构建 + Windows CLI：编译 Qt 项目到生成鸿蒙 DevEco 工程

> 基于官方 wiki [Qt for HarmonyOS development with 6.12.0 Beta2](https://wiki.qt.io/Qt_for_HarmonyOS_development_with_6.12.0_Beta2#Windows) 的 Windows 段，
> 替换为本机实际路径，注入 KB 实测踩坑。**CLI 命令行工作流**（非 Qt Creator IDE）。
>
> **三种工作流形态**（本页是其一）：
> - **预构建 + CLI 命令行**（本页）— 最简路径，适合脚本化/CI。
> - **预构建 + Qt Creator IDE** — Kit 配置图形化开发。
> - **源码 superbuild** — 自己编译 Qt6.12（需额外 patch），仅当预构建缺模块时才用。
>
> 验证基准：本机 `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a`（150 个 libQt6*.so、37 个顶层仓库、27 个 QML 模块、24 类插件，仅缺 WebEngine/DBus/Wayland/Pdf）。

---

## 0. 前置与适用

| 项 | 要求 | 本机状态 |
|----|------|---------|
| Qt 6.12.0 Beta2 预构建 | Qt 在线安装器勾选 `Qt 6.12.0 → HarmonyOS arm64_v8a` + `MinGW 64-bit`(host) + `CMake + Ninja`(Tools) | ✅ `${QT6_INSTALL_ROOT}` |
| DevEco Studio | 装在**无空格**路径（wiki 警告空格致 hvigor spawn 失败） | ⚠️ 实装 `C:\Program Files\Huawei\DevEco Studio`（带空格），用 junction 见 §1.1 |
| OHOS native SDK | DevEco 自带，API 23（HarmonyOS 6.1.0），Clang 15.0.4 | ✅ DevEco 目录下 |
| additional-packages | **预构建工作流非必需**（预构建自带 fontconfig/freetype 等；源码 superbuild 才必须） | 本机未装，省略 `CMAKE_FIND_ROOT_PATH` 也能 configure 通过 |
| 目标示例 | 安装器自带 `${QT6_INSTALLER_ROOT}/Examples/Qt-6.12.0/widgets/gallery` | ✅ |

> **关键区别**：预构建工作流**不需要**源码 superbuild 必须的两道运行时 patch——
> ① Qt6 `.so` 的 `DT_NEEDED` 已是裸名（libicui18n/libz/libc++_shared 等，无 Windows 绝对路径前缀）；
> ② `qt_add_executable` 自动 `MODULE .so` + `CXX_VISIBILITY_PRESET=default`（`main` 自动 `GLOBAL DEFAULT`，无需手动 `__attribute__((visibility("default")))`）。
> （上述两道 patch 问题仅源码 superbuild 触发，预构建不成立。）

---

## 1. 环境清单（本机实际路径）

### 1.1 DevEco 无空格路径（必做一次）

wiki + 2026-07-23 本机实测：DevEco 路径含空格会导致 hvigor 的 node workers spawn `java`/`hvigorw` 失败。本机实装带空格，用 junction 建无空格别名（不重装）：

```cmd
:: 以管理员运行 cmd
mklink /J C:\DevecoStudio "C:\Program Files\Huawei\DevEco Studio"
```

> 之后所有 Qt6.12 工作流路径用 `${DEVECO_STUDIO}`（正斜杠，CMake 友好）。**勿用** `C:/Program Files/...`。
> 若 2026-07-23 已建过此 junction，跳过本步。

### 1.2 路径清单

| 项 | 路径 | 用途 |
|----|------|------|
| Qt6.12 安装根 | `${QT6_INSTALL_ROOT}` | 安装器装 |
| Qt6 harmonyos 目标 | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a` | `CMAKE_PREFIX_PATH`（qt-cmake 自动设） |
| Qt6 host 构建 | `${QT6_INSTALL_ROOT}/mingw_64` | `QT_HOST_PATH`；**harmonydeployqt6.exe 在此** |
| qt-cmake.bat | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/bin/qt-cmake.bat` | 第 10 行自动设 `CMAKE_TOOLCHAIN_FILE` |
| qt.toolchain.cmake | `${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/lib/cmake/Qt6/qt.toolchain.cmake` | Qt 侧工具链 |
| DevEco 根（无空格） | `${DEVECO_STUDIO}` | `DEVECO_SDK_HOME` |
| OHOS native SDK | `${DEVECO_STUDIO}/sdk/default/openharmony/native` | `OHOS_SDK_NATIVE`，含 `llvm/` `sysroot/` `build/cmake/ohos.toolchain.cmake` |
| ohos.toolchain.cmake | `${DEVECO_STUDIO}/sdk/default/openharmony/native/build/cmake/ohos.toolchain.cmake` | `QT_CHAINLOAD_TOOLCHAIN_FILE`（**必填**） |
| hvigorw.bat | `${DEVECO_STUDIO}/tools/hvigor/bin/hvigorw.bat` | HAP 打包（`--hvigor` / `QT_HARMONYOS_HVIGOR`） |
| node | `${DEVECO_STUDIO}/tools/node` | `NODE_HOME` |
| java (jbr) | `${DEVECO_STUDIO}/jbr/bin` | `JAVA_HOME` |
| **harmonydeployqt6.exe** | `${QT6_INSTALL_ROOT}/mingw_64/bin/harmonydeployqt6.exe` | host 工具，**不在 harmonyos 目标 `harmonyos_arm64_v8a/bin/`** |

> ⚠️ `ENV.local.md` 的 `DEVECO_PATH`/`OHOS_SDK_NATIVE` 是带空格的 Qt5 工作流值；Qt6.12 工作流**另用无空格** `${DEVECO_STUDIO}`，别混用。

---

## 2. 环境变量

### 2.1 构建期（qt-cmake + cmake --build 用）

```cmd
SET HARMONY_OS_API_VER=23
SET OHOS_SDK_ROOT=%USERPROFILE%/AppData/Local/OpenHarmony/Sdk
SET NATIVE_OHOS_SDK=${DEVECO_STUDIO}/sdk/default/openharmony/native
SET ARCH=arm64-v8a
:: 预构建工作流 OHOS_ADDITIONAL_PACKAGES 可不设；若装了 additional-packages 再设：
:: SET OHOS_ADDITIONAL_PACKAGES=C:/Dev/ohos-additional-packages
SET PATH=%NATIVE_OHOS_SDK%\build-tools\cmake\bin;%PATH%
```

> wiki 用 `%USERPROFILE%/AppData/Local/OpenHarmony/Sdk/23` 的独立下载 SDK。本机直接用 DevEco 自带的 native（`${DEVECO_STUDIO}/.../native`，API 23），等价且无需额外下载。`OHOS_SDK_ROOT` 仅作占位，实际取 `NATIVE_OHOS_SDK`。

### 2.2 部署期（harmonydeployqt6 用，node/jbr 随 DevEco 自带）

```cmd
SET NODE_HOME=${DEVECO_STUDIO}/tools/node
SET JAVA_HOME=${DEVECO_STUDIO}/jbr/bin
SET DEVECO_SDK_HOME=${DEVECO_STUDIO}
SET QT_HARMONYOS_HVIGOR=${DEVECO_STUDIO}/tools/hvigor/bin/hvigorw.bat
SET PATH=%PATH%;%NODE_HOME%;%JAVA_HOME%;${DEVECO_STUDIO}/tools/hvigor/bin;${DEVECO_STUDIO}/tools/ohpm/bin
```

> `QT_HARMONYOS_HVIGOR` 设了之后，harmonydeployqt6 不传 `--hvigor` 也能找到 hvigorw。

---

## 3. 配置（qt-cmake configure）

切到示例目录，用 `qt-cmake.bat` 配置（它自动设 `CMAKE_TOOLCHAIN_FILE` 指向 `qt.toolchain.cmake`）：

```cmd
cd ${QT6_INSTALLER_ROOT}\Examples\Qt-6.12.0\widgets\gallery

${QT6_INSTALL_ROOT}\harmonyos_arm64_v8a\bin\qt-cmake.bat -B build -S . -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE="${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/lib/cmake/Qt6/qt.toolchain.cmake" ^
  -DQT_HOST_PATH="${QT6_INSTALL_ROOT}/mingw_64" ^
  -DQT_CHAINLOAD_TOOLCHAIN_FILE="%NATIVE_OHOS_SDK%/build/cmake/ohos.toolchain.cmake" ^
  -DOHOS_ARCH=%ARCH% ^
  -DOHOS_SDK_NATIVE="%NATIVE_OHOS_SDK%" ^
  -DCMAKE_FIND_ROOT_PATH="%OHOS_ADDITIONAL_PACKAGES%"
```

> 最后一行 `-DCMAKE_FIND_ROOT_PATH` 在预构建工作流**可省**（未装 additional-packages 时 `ohos.toolchain.cmake` 自设 sysroot）。省略后实测仍 `Configuring done`。

### 3.1 CMake 变量说明

| 变量 | 作用 | 省略后果 |
|------|------|---------|
| `CMAKE_TOOLCHAIN_FILE` | Qt 侧工具链（qt-cmake.bat 第 10 行本会自设，显式给也对） | qt-cmake 自动补 |
| `QT_HOST_PATH` | host Qt（mingw_64），提供 moc/rcc/uic/qsb/harmonydeployqt6 | **必填**，缺则找不到 host 工具 |
| `QT_CHAINLOAD_TOOLCHAIN_FILE` | OHOS native 工具链（ohos.toolchain.cmake） | **必填**！缺则 `qt.toolchain.cmake` 第 135 行回退 Qt 编译时烤进去的 Linux 默认路径 `/opt/harmonyos/.../ohos.toolchain.cmake`（不存在）→ OHOS 工具链没加载 → clang 当 host 链 Windows 库 → `Check for working CXX compiler - broken` |
| `OHOS_ARCH` | 目标架构 `arm64-v8a`（仅此一种） | 默认可能不对 |
| `OHOS_SDK_NATIVE` | native SDK 路径，须与工具链同源 | sysroot 找不到 |
| `CMAKE_FIND_ROOT_PATH` | additional-packages 根 | 预构建可省 |

### 3.2 成功标志

```
-- Configuring done
-- Generating done
-- Build files written to .../build
```

识别到 `Clang 15.0.4`、找到 `EGL`/`GLESv3`/`sysroot`。本机干净配置 `Configuring done (9.4s)`。

---

## 4. 编译（cmake --build）

```cmd
cmake --build build --parallel
```

**产物**：`build/libgallery.so`（业务库，`qt_add_executable` 自动 `MODULE` + `main GLOBAL DEFAULT`）。

> 链接 Qt6 库较慢（gallery 实测 51/52 对象编译后链接耗时数分钟，非配置问题）。若超时，重跑 `cmake --build build` 增量续编。

### 4.1 预构建工作流无需 patch（与源码 superbuild 的关键差异）

预构建 `libQt6Core.so` 的 `DT_NEEDED` 已全裸名（`libicui18n`/`libicuuc`/`libicudata`/`libz`/`libc++_shared`/`libc`），业务 `.so` 链接 Qt 库后 NEEDED 也裸名 → 设备 `dlopen` 成功，**无需 `patch_needed.py`**。
业务 `main` 由 `qt_add_executable` 自动 `GLOBAL DEFAULT` → `dlsym("main")` 成功，**无需手动 `__attribute__((visibility("default")))`**。

验证（可选）：

```cmd
:: NEEDED 应无 C:/ 绝对路径
${DEVECO_STUDIO}/sdk/default/openharmony/native/llvm/bin/llvm-readelf -d build\libgallery.so | findstr "NEEDED"
:: main 应为 GLOBAL DEFAULT
${DEVECO_STUDIO}/sdk/default/openharmony/native/llvm/bin/llvm-readelf --dyn-syms build\libgallery.so | findstr " main"
```

> 仅当你的 CMake 用裸 `add_executable`（非 `qt_add_executable`）时，才需手动给 `main` 加 `visibility("default")`。

---

## 5. 生成 DevEco 工程（harmonydeployqt6）

configure + build 产出 `libgallery.so` 后，调 `harmonydeployqt6` 生成 DevEco/hvigor 工程：

```cmd
${QT6_INSTALL_ROOT}\mingw_64\bin\harmonydeployqt6.exe ^
  --input build/gallery-harmony-deployment-settings.json ^
  --output build/hap ^
  --hvigor ${DEVECO_STUDIO}/tools/hvigor/bin/hvigorw.bat ^
  --verbose
```

> `<target>-harmony-deployment-settings.json` 由 `qt_add_executable` configure 时自动生成（换项目时改 target 名，如 `gallery-harmony-deployment-settings.json`）。

### 5.1 harmonydeployqt6 权威参数（`--help` 实测）

| 参数 | 作用 |
|------|------|
| `--input <file>` | JSON 配置（**必填**），即 `<target>-harmony-deployment-settings.json` |
| `--output <dir>` | 生成的 DevEco/hvigor 工程输出目录 |
| `--hvigor <path>` | hvigorw.bat 路径（或 env `QT_HARMONYOS_HVIGOR`）；**必须绝对路径**，相对报 `Failed to start hvigorw` |
| `--no-build` | 跳过 hvigor 打 HAP（仅生成工程；验证命令用） |
| `--install` | 装到已连设备（via hdc；需连设备+签名） |
| `--release` | 发布配置（默认 debug） |
| `--verbose` | 详细输出 |
| `--signing-* ×6` | 命令行签名（见 §7） |

### 5.2 成功标志

`build/hap/` 下生成完整 DevEco 工程：

```
build/hap/
├── AppScope/              app.json5 + 资源
├── entry/                 模块（含 ets 胶水、libs/arm64-v8a/ 业务 .so + Qt 运行时 .so）
├── hvigor/                构建脚本
├── oh-package.json5
└── build-profile.json5
```

`--no-build` 验证模式本机实测：exit 0，3.9s，插件依赖检查通过。

---

## 6. DevEco 打开 / 签名 / 装设备

1. **打开**：DevEco Studio → Open → 选 `build/hap/` 目录。
2. **签名**：DevEco → File → Project Structure → Signing Configs → 勾 `Automatically generate signature`（DevEco 自动生成调试证书）。**不带** `--signing-*` 参数时 HAP 留未签名，走此官方推荐流程。
3. **构建/装设备**：DevEco 点 Run → 编 HAP → 经 hdc 装到真机/模拟器。

> 也可命令行装未签名 HAP 后用 hdc 推（需自备签名），但官方推荐 DevEco 签名装设备。

---

## 7. 可选：`<target>_make_hap` 一键目标（官方推荐）

设好 §2.2 环境变量（尤其 `QT_HARMONYOS_HVIGOR`）后，可跳过 §5 手动调 harmonydeployqt6，直接：

```cmd
cmake --build build --target gallery_make_hap
```

等价于「自动先编 `libgallery.so` 再调 harmonydeployqt6 打 HAP」，一步到位。官方文档 [harmonyos-building-deploying-apps](https://doc.qt.io/qt-6.12/harmonyos-building-deploying-apps.html) 推荐此法。

### 7.1 命令行签名（可选，替代 DevEco 签名）

须六件套同时给全，否则 HAP 留未签名：

```cmd
harmonydeployqt6 --input ... --output ... --hvigor ... ^
  --signing-cert-path <.cer> ^
  --signing-profile <.p7b> ^
  --signing-store-file <.p12> ^
  --signing-key-alias <alias> ^
  --signing-key-password <密文> ^
  --signing-store-password <密文>
```

> 密码须是 **hvigor 加密串**（非明文），用 DevEco 生成。

---

## 8. 踩坑速查（本机实测）

| 症状 | 根因 | 修复 |
|------|------|------|
| `Check for working CXX compiler - broken` / `program not executable` | 缺 `QT_CHAINLOAD_TOOLCHAIN_FILE` → 回退 Linux 默认路径 → clang 当 host 链 Windows 库 | 必填 `-DQT_CHAINLOAD_TOOLCHAIN_FILE` 指向真实 `ohos.toolchain.cmake` |
| `Could not find toolchain file`（文件实存） | （QtC 场景）Initial 配置值带首尾 `"` + `:UNINITIALIZED` → cmake 收到带字面引号的路径 | CLI 命令行带引号 cmake 能正确解析；此坑仅 Qt Creator Kit 配置表有 |
| 找不到 `harmonydeployqt6.exe`（在 `harmonyos_arm64_v8a/bin` 找） | 它是 host 工具，不在交叉目标里 | 用 `mingw_64/bin/harmonydeployqt6.exe` |
| `Failed to start hvigorw` | `--hvigor` 传了相对路径 | `--hvigor` 必传绝对路径，或设 `QT_HARMONYOS_HVIGOR` env |
| harmonydeployqt6 spawn `java` ENOENT | hvigorw 的 node workers spawn `java`（跑 app_packing_tool.jar）丢 env | 确认 `JAVA_HOME` + `jbr/bin` 在 PATH；§2.2 已含 |
| 部署报找不到 `libgallery.so` | 只 configure 没 build | 先 `cmake --build build` |
| DevEco 路径含空格 → 各种莫名失败 | wiki 已警告空格致 hvigor spawn 失败 | 用 §1.1 junction 无空格别名 `${DEVECO_STUDIO}` |
| 设备 `dlopen failed: ...C:/...` 绝对路径 | 源码 superbuild 的 developer-build 写绝对 NEEDED | **预构建不触发**；若触发说明误用 superbuild 产物，换预构建或跑 `patch_needed.py` |
| 设备 `dlsym("main")` 失败 | 业务 `main` 是 local symbol | 用 `qt_add_executable`（自动 GLOBAL DEFAULT）；或手动加 `visibility("default")` |

---

## 9. 端到端验证清单

| # | 步骤 | 命令 | 期望 |
|---|------|------|------|
| 1 | junction | `mklink /J C:\DevecoStudio "C:\Program Files\Huawei\DevEco Studio"` | 已存在则跳 |
| 2 | 设环境变量 | §2.1 + §2.2 | — |
| 3 | configure | `qt-cmake.bat -B build -S . -G Ninja ...`（§3） | `Configuring done`，识别 Clang 15.0.4 |
| 4 | build | `cmake --build build --parallel` | `libgallery.so` 产出 |
| 5 | NEEDED 裸名 | `llvm-readelf -d build\libgallery.so \| findstr NEEDED` | 无 `C:/` 绝对路径 |
| 6 | main 可见 | `llvm-readelf --dyn-syms build\libgallery.so \| findstr " main"` | `GLOBAL DEFAULT` |
| 7 | 生成 DevEco 工程 | `harmonydeployqt6 --input ... --output build/hap --hvigor ... --verbose` | `build/hap/` 含 `AppScope/ entry/ hvigor/` |
| 8 | DevEco 打开签名装设备 | DevEco → Open `build/hap/` → 自动签名 → Run | 设备上 gallery 跑起来 |

---

## 10. 操作顺序（速览）

```cmd
:: 1. junction（一次性）
mklink /J C:\DevecoStudio "C:\Program Files\Huawei\DevEco Studio"

:: 2. 环境变量（每个 cmd 窗口重设）
SET NATIVE_OHOS_SDK=${DEVECO_STUDIO}/sdk/default/openharmony/native
SET ARCH=arm64-v8a
SET NODE_HOME=${DEVECO_STUDIO}/tools/node
SET JAVA_HOME=${DEVECO_STUDIO}/jbr/bin
SET DEVECO_SDK_HOME=${DEVECO_STUDIO}
SET QT_HARMONYOS_HVIGOR=${DEVECO_STUDIO}/tools/hvigor/bin/hvigorw.bat
SET PATH=%NATIVE_OHOS_SDK%\build-tools\cmake\bin;%PATH%;%NODE_HOME%;%JAVA_HOME%;${DEVECO_STUDIO}/tools/hvigor/bin;${DEVECO_STUDIO}/tools/ohpm/bin

:: 3. configure
cd ${QT6_INSTALLER_ROOT}\Examples\Qt-6.12.0\widgets\gallery
${QT6_INSTALL_ROOT}\harmonyos_arm64_v8a\bin\qt-cmake.bat -B build -S . -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE="${QT6_INSTALL_ROOT}/harmonyos_arm64_v8a/lib/cmake/Qt6/qt.toolchain.cmake" ^
  -DQT_HOST_PATH="${QT6_INSTALL_ROOT}/mingw_64" ^
  -DQT_CHAINLOAD_TOOLCHAIN_FILE="%NATIVE_OHOS_SDK%/build/cmake/ohos.toolchain.cmake" ^
  -DOHOS_ARCH=%ARCH% -DOHOS_SDK_NATIVE="%NATIVE_OHOS_SDK%"

:: 4. build
cmake --build build --parallel

:: 5. 生成 DevEco 工程（或 §7 的 gallery_make_hap 一键）
cmake --build build --target gallery_make_hap

:: 6. DevEco 打开 build/hap/ → 自动签名 → Run
```

---

## 11. 相关上下文

- [[qt-harmonyos-qt6-status]] — Qt6 鸿蒙化状态（预构建策略 B'、模块清单、Qt5→Qt6 差异）
- [[qt-harmonyos-build]] — Qt OHOS 构建环境与工具链
- [[qt-harmonyos-build-run-workflow]] — DevEco MCP 构建/启动/日志/UI 测试
- [[qt-harmonyos-project-structure]] — 工程结构 / CMake 关键配置 / .so 部署
- 📖 [Qt for HarmonyOS development with 6.12.0 Beta2](https://wiki.qt.io/Qt_for_HarmonyOS_development_with_6.12.0_Beta2#Windows) — 官方 wiki（Windows 段）
- 📖 [Building and Deploying Qt Applications for HarmonyOS](https://doc.qt.io/qt-6.12/harmonyos-building-deploying-apps.html) — 官方文档（`_make_hap` 目标）

## 内容来源

| 来源 | 说明 |
|------|------|
| 📖 Qt Wiki | 官方 6.12 Beta2 Windows 段（CMake 参数、环境变量、harmonydeployqt6 调用） |
| 🛠️ 工作经验 | 2026-07-23 本机端到端验证（configure + harmonydeployqt6 `--no-build`）；2026-08-01 预构建 SDK 模块实测（150 .so / 37 仓库） |
| 🔍 工具实测 | `harmonydeployqt6 --help`、`qt-cmake.bat`、`llvm-readelf -d/--dyn-syms` 验证 |
| 🔍 框架源码 | `qt.toolchain.cmake` 第 135 行 Linux 默认路径回退（缺 `QT_CHAINLOAD_TOOLCHAIN_FILE` 时） |

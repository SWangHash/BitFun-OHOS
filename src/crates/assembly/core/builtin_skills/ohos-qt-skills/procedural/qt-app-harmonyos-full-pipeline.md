---
id: procedural-qt-app-harmonyos-full-pipeline
title: Qt 应用鸿蒙化端到端流程
summary: 把 Qt 应用鸿蒙化分散工作流缝合为一份端到端编排：公共库提供 HarmonyOS 生命周期、窗口与平台限制的规范事实，本页负责将其落到 Qt 迁移、构建、签名、部署、测试和上库的 8 个阶段。覆盖 Qt5.12/5.15/6.12，并标注 Qt6 端到端 run+test 与应用分发缺口。
type: procedural
domain: procedural
status: active
audience: public
tags: [应用鸿蒙化, 端到端, 编译, 签名, 部署, 测试]
refs:
  - procedural-qt-app-harmonyos-migration
  - procedural-qt6-ohos-windows-build
  - procedural-qt6-qtcreator-harmonyos-setup
  - procedural-qt6-ohos-windows-app-dev-guide
  - procedural-qt6-ohos-qtmqtt-build
  - procedural-qt6-cef-ohos-integration-guide
  - procedural-fetch-ohos-third-party-lib
  - procedural-qt-ohos-concrete-build-recipe
  - procedural-qt-ohos-run-test
  - procedural-qt-app-harmonyos-completion
  - procedural-demo-generation
  - procedural-demo-archive-cleancode-upload
  - procedural-fork-qt-app-to-ohos-qt-org
  - semantic-qt-harmonyos-build
  - semantic-qt-harmonyos-build-run-workflow
  - semantic-qt-harmonyos-project-structure
  - semantic-qt-harmonyos-qt6-status
  - semantic-qt-harmonyos-modules
  - semantic-qt-harmonyos-platform-limits
  - semantic-qt-harmonyos-api-mapping
  - semantic-qt-harmonyos-code-patterns
  - semantic-qt-harmonyos-porting-workflow
  - semantic-qt-harmonyos-third-party-libs
  - semantic-qt-ohos-extras
  - semantic-qt-ohos-extras-examples
  - semantic-qt-harmonyos-window-model
  - semantic-qt-harmonyos-lifecycle
  - semantic-qt-harmonyos-api
  - semantic-qt-ohos-project-analyzer-workflow
  - semantic-qt-harmonyos-golden-rules
  - semantic-qt515-vs-qt512-api-diff
  - semantic-qt-harmonyos-accessibility
  - semantic-qt-harmonyos-system-tray
  - semantic-qt-ohos-js-thread-gateway
  - semantic-qt-harmonyos-overview
  - semantic-qt-huawei-cleancode-rules
created: 2026-08-04
updated: 2026-08-15
---

# Qt 应用鸿蒙化端到端流程

本页是 **Qt 交付层的内部编排枢纽**，把 Qt KB 中分散的工作流缝合为一条从源码/SDK 获取到最终上库发布的链路。HarmonyOS 平台事实不在这里重复维护，执行前以 common KB 的以下页面为准：

- Stage/UIAbility 生命周期：[[ohos-common-kb/semantic/stage-uiability-lifecycle|公共库：Stage/UIAbility 生命周期]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）
- ArkUI 窗口与 XComponent 模型：[[ohos-common-kb/semantic/arkui-window-xcomponent-model|公共库：ArkUI 窗口与 XComponent 模型]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/arkui-window-xcomponent-model.md)）
- HarmonyOS 平台限制：[[ohos-common-kb/semantic/harmonyos-platform-limits|公共库：HarmonyOS 平台限制]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）

流程按 8 个阶段组织：

```
阶段一 下载/获取  →  阶段二 环境准备  →  阶段三 迁移适配  →  阶段四 编译构建
→  阶段五 签名  →  阶段六 部署运行  →  阶段七 测试验证  →  阶段八 上传/上库
```

> **阶段映射说明**：KB 原始 6 阶段模型为 `download → compile → sign → run → test → upload`。本流程在 `download` 与 `compile` 之间显式插入"迁移适配"阶段（承载 8 步决策树/14 组代码模式/13 类 API 映射/平台限制处理），并把 `deploy`（装机）从 `run` 中独立为"部署运行"阶段。缺口见各阶段末尾"⚠️ KB 未覆盖"标注。
>
> **时序总览（重要）**：静态预检（DT_NEEDED/main 可见性/QML 部署）是 compile→install 之间的**硬门控**，必须在装机前完成。run-test 七阶段的内部时序为 §2（构建+静态预检）→ §3（签名+装机）→ §4（启动+运行时验证），即预检先于装机。本页把 deploy/run 列为阶段六、test 列为阶段七是按"首次部署冒烟 / 正式验证闭环"切分，**不**意味着预检在装机之后（详见阶段四产出与时序澄清）。

---

## 阶段一：下载/获取（download）

### 目标
获取 Qt 鸿蒙化所需的全部输入：Qt 源码树或预构建 SDK（arm64-v8a 目标 kit + MinGW host kit）、三方库 .so、DevEco Studio 及其 OHOS SDK（native sysroot + clang + hvigor + node + jbr）。

### 前置（上游交付）
- 上游：华为 HarmonyOS 系统 + Qt Project Gerrit（codereview.qt-project.org）提供 tqtc-qt5 源码 + 华为官方 IDE/SDK
- 上游来源（业务侧）：商业 Qt 客户的鸿蒙化迁移需求 / 内部宣传 demo 需求 / 自驱动（评估新场景可行性）

### 步骤

#### 1.1 获取 Qt5 源码（Gerrit 克隆）
来源：`qt-harmonyos-overview` / `qt-harmonyos-build`

1. 登录 Gerrit（https://codereview.qt-project.org）→ Settings → HTTP Credentials → GENERATE NEW PASSWORD
2. 克隆 + 切分支 + 初始化子模块：
```bash
git clone https://codereview.qt-project.org/qt/tqtc-qt5
cd tqtc-qt5
git checkout tqtc/harmonyos-5.12.12   # 或 tqtc/harmonyos-5.15.16
git submodule update --init --recursive
```

#### 1.2 获取 Qt6 源码（源码 superbuild，策略 B）
来源：`qt6-ohos-windows-build`

```bash
cd <QT6_SRC_ROOT>          # 自选无空格根目录
git clone git://code.qt.io/qt/qt5.git
cd qt5
git reset --hard c7581743be5270fbf4343508123a0897487cca87   # Qt 6.12.0
git submodule update --init qtbase qtsvg qtimageformats qtshadertools qtlanguageserver qtdeclarative
```

#### 1.3 获取 Qt6 预构建安装器（策略 B'，推荐）
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-qtcreator-harmonyos-setup`

在 Qt 在线安装器（maintenance tool）的 Qt 6.12.0 下至少勾选：
- **HarmonyOS arm64_v8a**（必选，=`<QT6_OHOS_KIT>`，bin/ 下无任何 .exe，只有 .bat 包装器、少量工具 .so 和 shell 脚本）
- **MinGW 64-bit**（必选宿主套件 =`<QT6_HOST>`，含 qmake.exe、harmonydeployqt6.exe、qt-cmake.bat）
- **CMake + Ninja**（可不勾，用 OHOS SDK 自带 cmake 3.28.2 + ninja 1.12.0）
- **Src 源码组件**（含 Src/qtmqtt 等 addon，或后续 git clone 补）

> 关键认知：OHOS kit bin/ 无 .exe，所有需执行的 .exe（moc/rcc/uic/qmake/harmonydeployqt6）都在 HOST kit mingw_64/bin/。

> **⚠️ KB 未覆盖**：本步骤仅描述性（勾选组件表 + DevEco 安装），无 `maintenance-tool.exe --install ...` CLI，与阶段四 §4.3 B' compile 的命令行密度不对称。**最小可行建议**：补充 maintenance-tool CLI 或记录勾选清单截图归档（当前勾选清单即操作替代）。

#### 1.4 安装 DevEco Studio + OHOS SDK
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-ohos-qtmqtt-build` / `qt6-cef-ohos-integration-guide`

- 安装到**无空格根目录**（推荐 `D:/DevEco` =`<DEVECO>`，不要用默认 `C:/Program Files/Huawei/DevEco Studio`，含空格会断构建/打包）
- OHOS SDK 落点 `<DEVECO>/sdk/default/openharmony/native` =`<NATIVE_OHOS_SDK>`（native sysroot + clang + cmake/ninja + ohos.toolchain.cmake）
- 验证 API level：读 `<NATIVE_OHOS_SDK>/oh-uni-package.json` 的 `apiVersion` 字段（本机 =24，HarmonyOS 6.1.1）
- DevEco 提供 HAP 打包链（hvigor + node + jbr + ohpm）

#### 1.5 获取三方库预编译包（Harmonybrew bottle）
来源：`fetch-ohos-third-party-lib`

当应用依赖的 C/C++ 三方库在 Harmonybrew（atomgit.com/Harmonybrew/homebrew-core）有 arm64_ohos 预编译 bottle 时，一键拉取免交叉编译：

```bash
bash _scripts/fetch-ohos-bottle.sh -f abseil -o ${DELIVERABLES_ROOT}/ohos-libs
```

脚本递归拉取运行时依赖、sha256 校验、解压、Windows NTFS 自动拷贝补建缺失 .so 符号链接，产出 `<out-dir>/<formula>/<version>/{lib,include,lib/cmake}` + qmake/CMake 链接片段。无 bottle 则回退源码交叉编译（见独立小节"三方库构建"）。

#### 1.6 获取附加第三方库包（Qt6 源码 superbuild 用）
来源：`qt6-ohos-windows-build`

从官方 wiki（wiki.qt.io/Building_Qt6_for_HarmonyOS）链接下载 `ohos-additional-packages-20260415.zip`（Google Drive / 百度网盘），解压到 `<ADDITIONAL_PACKAGES>`（如 `<QT6_SRC_ROOT>/additional-packages/`），含 fontconfig/freetype/openssl/unicode/node/uuid/brotli/libpng 等第三方预编译库（include/、lib/、node-addon-api/、share/）。

### 产出（下游交付）
- Qt 源码树（tqtc-qt5 鸿蒙分支）/ Qt6 预构建 kit（`<QT6_OHOS_KIT>` + `<QT6_HOST>`）
- 三方库 .so（含 CMake config/headers，位于 `${DELIVERABLES_ROOT}/ohos-libs/<formula>/<version>/`）
- DevEco SDK（native sysroot + clang + hvigor + node + jbr + ohpm）

供阶段二配置 `CMAKE_PREFIX_PATH` / `CMAKE_TOOLCHAIN_FILE` / `QT_CHAINLOAD_TOOLCHAIN_FILE`。

### 注意事项/陷阱
来源：`qt-harmonyos-overview` / `qt6-ohos-windows-build` / `fetch-ohos-third-party-lib`

- 子模块必须 `--init --recursive`，否则源码不完整
- 不要用 llvm-mingw clang 22（触发 NTSYSCALLAPI 重声明、D3D12MemAlloc -Werror），策略 B host 编译器用 MinGW g++ 13.1.0（Qt SDK 自带）
- 目标架构仅 arm64-v8a
- bottle URL 名与版本间是**单短横线**（`<formula>-<version>.arm64_ohos.bottle[.rebuild].tar.gz`），非 Homebrew 默认双短横线
- bottle 内 .so 是 arm64-OpenHarmony ABI，Windows 只能链接不能运行，运行需部署到设备
- CloudWAF 拦截：脚本用 `git clone --sparse` 读 formula，不能 curl raw .rb

---

## 阶段二：环境准备（env）

### 目标
配置编译/构建/打包所需的全部环境变量、工具链路径与工程骨架，使后续编译能一次性找到 Qt SDK 与 OHOS 工具链。

### 前置（上游交付）
- 阶段一产出的 SDK 路径、三方库路径、DevEco 安装路径
- `${PROJECTS_ROOT}` 工作根目录（迁移项目在此下独立建文件夹）

### 步骤

#### 2.1 设置 DevEco 工具链环境变量
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-ohos-qtmqtt-build` / `qt6-cef-ohos-integration-guide`

每次新开 shell 都要设（shell state 不持久）。

**cmd 形式**（`qt6-ohos-windows-app-dev-guide`）：
```bat
set JAVA_HOME=<DEVECO>/jbr
set NODE_HOME=<DEVECO>/tools/node
set DEVECO_SDK_HOME=<DEVECO>
set QT_HARMONYOS_HVIGOR=<DEVECO>/tools/hvigor/bin/hvigorw.bat
set PATH=<NATIVE_OHOS_SDK>/build-tools/cmake/bin;<DEVECO>/tools/node;<DEVECO>/jbr/bin;<DEVECO>/tools/hvigor/bin;<DEVECO>/tools/ohpm/bin;<DEVECO>/sdk/default/openharmony/toolchains;%PATH%
```

**bash 形式**（`qt6-ohos-qtmqtt-build`，git-bash 验证）：
```bash
export NODE_HOME=<DEVECO>/tools/node
export JAVA_HOME=<DEVECO>/jbr
export DEVECO_SDK_HOME=<DEVECO>/sdk
export QT_HARMONYOS_HVIGOR=<DEVECO>/tools/hvigor/bin/hvigorw.bat
export PATH="<NATIVE_OHOS_SDK>/build-tools/cmake/bin:<DEVECO>/tools/node:<DEVECO>/jbr/bin:<DEVECO>/tools/hvigor/bin:<DEVECO>/tools/ohpm/bin:$PATH"
```

**PowerShell 形式**（`qt-ohos-run-test`）：
```powershell
$env:DEVECO_SDK_HOME = "${env:DEVECO_PATH}\sdk"
$env:PATH = "${env:DEVECO_PATH}\jbr\bin;" + $env:PATH
```

工具路径速查：hvigorw.js=`${DEVECO_PATH}\tools\hvigor\bin\hvigorw.js`，node=`${DEVECO_PATH}\tools\node\node.exe`，java=`${DEVECO_PATH}\jbr\bin\java.exe`，hdc=`${DEVECO_PATH}\sdk\default\openharmony\toolchains\hdc.exe`，clang=`${DEVECO_PATH}\sdk\default\openharmony\native\llvm\bin\clang.exe`。

> **⚠️ 源级不一致（DEVECO_SDK_HOME）**：cmd 形式取 `<DEVECO>`（无 `/sdk`，源 qt6-ohos-windows-app-dev-guide §3.1）；bash 与 PowerShell 形式取 `<DEVECO>/sdk`（带 `/sdk`，源 qt6-ohos-qtmqtt-build §4.1 / qt-ohos-run-test §1.3）。DevEco SDK 结构为 `<DEVECO>/sdk/default/openharmony/...`，hvigor 的 `DEVECO_SDK_HOME` 通常应指向含 `default/openharmony` 的 sdk 目录（即 `<DEVECO>/sdk`）。**建议**：优先用 `<DEVECO>/sdk`（bash/PS 形式一致）；若 hvigor 找不到 SDK 再试 `<DEVECO>`（cmd 源形式），以 `hvigorw --sync` 能否解析 SDK 为准。
>
> **⚠️ 路径完备性（bash 形式）**：本页已将 bash 形式 PATH 的 node 目录从源文的 `tools/node/bin` 修正为 `tools/node`（与上方速查表 `node.exe` 实际落点一致），并补入 `<NATIVE_OHOS_SDK>/build-tools/cmake/bin`（qt-cmake.bat 依赖 PATH 中的 cmake，见阶段四 §4.3）；与 cmd 形式对齐。

#### 2.2 配置 Qt6 项目鸿蒙化三策略决策
来源：`qt-harmonyos-qt6-status`

收到 Qt6 项目鸿蒙化需求时三策略择一：
- **策略 A**：降级到 Qt5（当前可行，用 `QT_VERSION_CHECK` 宏条件编译，详见 `qt-ohos-project-analyzer-workflow` §3.1）
- **策略 B**：源码 superbuild（Windows 已验证，MinGW host + OHOS Clang target，需 4 项 Windows 额外配置 + DT_NEEDED patch，详见阶段四 §4.1-4.2）
- **策略 B'**：预构建安装器 SDK（**推荐**，比源码更省事，消除 patch_dt_needed / shim-trim / Qt6_DIR junction 三大坑，详见阶段四 §4.3-4.4）

#### 2.3 创建项目目录结构
来源：`qt-app-harmonyos-migration` / `qt-ohos-concrete-build-recipe`

```bash
mkdir -p "${PROJECTS_ROOT}/<app-name>-ohos"
```
命名规范：格式 `<原始应用名>-ohos`（如 calculator-ohos），全部小写，空格替换为短横线。

#### 2.4 复制 Qt 源码内置胶水模板
来源：`qt-app-harmonyos-migration` / `qt-harmonyos-project-structure` / `qt-ohos-concrete-build-recipe` / `qt6-ohos-windows-app-dev-guide`

**铁律**：鸿蒙工程必须从 Qt 源码内置胶水代码模板复制生成，禁止手动创建目录结构。模板含完整 ArkTS 胶水/build-profile/qEmbeddedUiExtensionHost，手动创建极易遗漏关键文件。

**Qt5 路径（手动 cp）**：
```bash
cp -r <QT5_15_SRC>/qtbase/src/harmonyos/templates/. "${PROJECTS_ROOT}/<app-name>-ohos/"
# Qt 5.12 对应：<QT5_12_SRC>/qtbase/src/harmonyos/templates
```
旧 Gerrit ZIP 模板方式已退役。

**无 Qt 源码时**：下载独立模板归档到 BitFun 用户级共享资源目录：
```bash
bash skills/kb-init/scripts/download-template.sh
cp -r "${OHOS_TEMPLATE_SRC}/." "${PROJECTS_ROOT}/<app-name>-ohos/"
```
下载地址：https://gitcode.com/ohos-qt/qt-harmonyos-src/releases

**Qt6 策略 B' 路径（无需手动 cp）**：预构建 OHOS kit 内置模板在 `<QT6_OHOS_KIT>/src/harmonyos/templates`，由 `harmonydeployqt6` 在 package 阶段（阶段四 §4.3 Step 3b）自动拷贝到 hap-out 并改写 `app.json5`/`module.json5`/`QtAppConstants.ets`，无需手动 cp。策略 B 源码 superbuild 仍走源码树 `<QT6_SRC>/qtbase/src/harmonyos/templates` 手动 cp。

复制后需（Qt5/策略 B）：
1. 在 `entry/src/main/cpp/` 编写 Qt C++ 源码和 CMakeLists.txt
2. 配置 `QtAppConstants.ets` 的 `APP_LIBRARY_NAME`
3. 配置 `entry/build-profile.json5` 的 `CMAKE_PREFIX_PATH`
4. 填充 Qt 运行时库 `libqohos.so` 到 `entry/libs/arm64-v8a/`
5. 手动复制 `libqohosstyle.so` 到 `libs/arm64-v8a/styles/`
6. 修改应用显示名称

场景二（已有工程鸿蒙化）：模板放 `HarmonyOS/` 子目录，`build-profile.json5` 的 path 用绝对路径指向根 CMakeLists.txt。

#### 2.5 修改应用显示名称（必做）
来源：`qt-app-harmonyos-migration` / `qt-ohos-concrete-build-recipe`

模板默认显示名是占位值（`app_name=ohosQtTemplate`、`QAbility_label=label`），不改桌面图标和任务管理器显示占位值。**改 string.json 的 value，不要改 app.json5/module.json5 的 label 引用**（鸿蒙规范要求 label 通过资源引用）：

- `AppScope/resources/base/element/string.json`：`app_name` value → 应用名（桌面图标名）
- `entry/src/main/resources/{base,en_US,zh_CN}/element/string.json`：`QAbility_label` value → 应用名（三语言目录都改，`zh_CN` 可填中文）

#### 2.6 DevEco CLI 工具速查（本流程全程用 CLI，不用 MCP）
平台通用命令能力以 common 的 [[ohos-common-kb/procedural/deveco-cli-usage-rules|DevEco CLI 使用规则]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/deveco-cli-usage-rules.md)）为准。

本流程全程用命令行，不依赖 DevEco MCP。正常项目操作优先使用 devecocli；下表保留的 hvigor/hdc 是 Qt 交付需要精确控制 unsigned HAP、Ability 参数、a11y Want 与底层日志时的可审计调用，使用后仍以完整 Qt 门禁收口：

| 阶段 | CLI 命令 | 对照的历史 MCP 名称（不可调用） |
|------|---------|----------------|
| 编译打包 | `hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon` | build_project |
| 装机启动 | `hdc install <signed.hap>` / `hdc shell aa start -b <bundle> -a <ability>` | start_app |
| 日志 | `hdc shell "hilog -x -e '<bundle>'"` | get_hilog_or_faultlog_recent |
| 截图 | `hdc shell uitest screenCap -p <path>` | perform_ui_action(screenshot) |
| UI 控件树（无障碍通道） | `hdc shell uitest dumpLayout -b <bundle>`（须开 `aa start --pb io.qt.experimental.enableA11ySupport true`，见 `qt-harmonyos-accessibility`） | get_app_ui_tree |
| UI 交互 | `hdc shell uitest uiInput click <x> <y>`（控件 bounds 中心点） | perform_ui_action(click) |
| 签名 | `java -jar <hap-sign-tool.jar> sign ...` 或 build-profile signingConfig | — |

> 历史 MCP 的 `get_app_ui_tree` 只到 XComponent，且不属于当前 deveco-mcp 工具集。取 Qt 控件树使用 `uitest dumpLayout`（无障碍通道）并先开 Want 参数。当前 MCP 仅用于 check/restart，能力边界见 [[ohos-common-kb/semantic/deveco-mcp-capabilities|DevEco MCP 能力与使用边界]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/deveco-mcp-capabilities.md)）；本流程不用 MCP 执行 build/run/UI。

### 产出（下游交付）
- 可用的 Qt6.12 HarmonyOS Kit 配置（CMake Initial Configuration + 环境变量）
- 鸿蒙工程骨架（含 HarmonyOS/ 工程目录 + OhosExampleApp/CMakeLists.txt + Qt OHOS SDK 路径）
- `local.properties`：`sdk.dir=<DEVECO>\sdk`

供阶段三迁移适配与阶段四编译。

### 注意事项/陷阱
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-qtcreator-harmonyos-setup` / `qt-ohos-run-test`

- DevEco 路径必须无空格（默认 `C:/Program Files/Huawei/DevEco Studio` 含空格会断构建/打包）
- hvigor 项目路径必须 ASCII、无空格、无中文（hvigor 路径白名单拒绝非 ASCII/空格/特殊符号）
- cmd 默认 GBK(936) 代码页，hvigor 中文输出显示为 ??? 乱码，脚本首行 `chcp 65001 >nul` 切 UTF-8
- `.bat` 的 set 只在当前 cmd 进程生效；`setlocal/endlocal` 退出后失效；手动重跑须同会话重新 set
- ENV.local.md 登记的 `DEVECO_PATH`/`OHOS_SDK_NATIVE` 可能是带空格的 `C:\Program Files\...`（Qt5 工作流用）；Qt6.12 工作流另用无空格 `C:/DevecoStudio`，别混用

### ⚠️ KB 未覆盖
- 无统一"环境准备检查清单"页（分散在各 compile 工作流首步）。**最小可行建议**：以本页 §2.1 + §2.4 为基线，新建 `procedural/env-checklist.md` 汇总 Qt5/Qt6/策略 B/B' 环境检查表。

---

## 阶段三：迁移适配（migration）

> **KB 缺口命名阶段**：原 6 阶段模型 `download → compile` 直接衔接，但 Qt 鸿蒙化的核心活动——源码扫描/API 映射/窗口适配/生命周期适配/平台限制处理/构建系统适配——发生在 download 与 compile 之间，被归入 compile 或 migration 但无命名阶段承载。本阶段显式承载这部分。

### 目标
把其他平台（Windows/Linux/macOS/Android/iOS）的 Qt 应用源码适配为鸿蒙感知代码：预检判定可行性 → 扫描平台绑定 API → 按 API 映射替换 → 窗口/生命周期/平台限制适配 → 构建系统适配。

### 前置（上游交付）
- 原始 Qt 工程/源码（来自上游来源）
- 目标功能需求
- Qt 版本信息（按代码实际 API 判定，非 .pro 声明）
- 阶段二产出的鸿蒙工程骨架

### 步骤

#### 3.1 预检（Pre-flight，写任何 CMake 之前）
来源：`qt-app-harmonyos-migration`

正式动手移植前用 grep/源码扫描做 7 项预检：

```bash
# ① Qt 版本（按代码非声明，grep Qt6-only C++ API）
grep -rn "QList::emplace_back\|std::as_const\|QVariant::toModelIndex\|std::ranges\|std::views" src/
# ② Qt SDK 选型（Qt5.15.16 现成 vs Qt6 6.12 superbuild）— 决策项，由 ① Qt 版本 + ③ 模块可用性共同决定
# ③ 模块可用性（对照模块矩阵，Qt5 SDK 缺 Multimedia/D-Bus/WebEngine/Charts/SerialBus/QuickControls2/Quick3D/WebSockets 等）
#    live-verify（勿信静态矩阵表，直接 ls 验证本地 SDK 实际可用模块）：
ls <QT5_15_OHOS_SDK>/lib/cmake/                       # Qt5：CMake config 齐全度
ls <QT5_15_OHOS_SDK>/lib/libQt5*.so                   # Qt5：模块 .so 存在性
ls <QT6_OHOS_KIT>/lib/cmake/                          # Qt6：CMake config
ls <QT6_OHOS_KIT>/lib/libQt6*.so                      # Qt6：模块 .so
# ④ 项目类型
grep -rn "int main(" src/   # → Playbook A/B；source-only 看 .cpp/.h
# ⑤ 平台绑定
grep -rn "X11\|xcb\|windows.h\|HWND\|WM_\|QDBus\|Cocoa" src/
# ⑥ foreach 用法
grep -rn "foreach(\|Q_FOREACH" src/   # 用了要 OMIT QT_NO_FOREACH（定义会编译失败）
# ⑦ 三方依赖（bundled vs system，交叉编译可行性）
grep -rn "vcpkg\|conan\|find_package.*REQUIRED\|add_subdirectory.*third_party\|FetchContent" CMakeLists.txt .pro 2>/dev/null
find . -type d \( -name "third_party" -o -name "3rdparty" -o -name "vendor" \) 2>/dev/null   # 内嵌三方源码树
```

输出预检报告决定是否进入正式迁移。**预检的目的是在写任何 CMake 之前拦下必然失败的项目**（三批次实战 207 应用证明缺预检会让 agent 在 Qt6 代码上浪费 3-4 次编译 attempt）。

#### 3.2 可行性评估 + 落实 Playbook
来源：`qt-app-harmonyos-migration` / `qt-ohos-concrete-build-recipe`

评估 Qt 版本/模块依赖/平台 API/UI 复杂度/子进程/三方库六项，输出可行性报告（可迁移 / 有风险项 / 不可迁移）。按项目类型落实 Playbook：

| 项目类型 | Playbook | 产物 | 构建方式 |
|---------|---------|------|---------|
| application/example（有 `int main()`） | A | `entry-default-unsigned.hap` | hvigorw assembleHap + OhosExampleApp + HarmonyOS 模板 |
| library/plugin/header-only（无 main） | B | `libOhos<Slug>.a`/`.so` | cmake + ninja + ohos.toolchain.cmake + ohos-build |

Qt5/Qt6 是正交轴，A/B 均可配。

#### 3.3 建立 Qt 适配决策的前置认知
来源：`qt-harmonyos-porting-workflow`

先阅读上方 common 规范页，再把公共约束落到五类 Qt 适配决策：

1. 审查 `Q_OS_LINUX` 与 `Q_OS_OHOS` 重叠命中的 Qt 条件分支；
2. 区分 Qt 事件循环、QPA 与 ArkUI/Ability 回调的线程归属，优先使用已有 QtOhosExtras/QPA 桥接；
3. 把 Stage/UIAbility 事件映射到 Qt 入口、信号、Want 处理与关闭事件；
4. 显式确认每个 `QWindow` / `QWidget` 经 QPA 映射为系统主窗口还是子窗口；
5. 审查 `QFile`、`QStandardPaths`、`QPluginLoader` 和第三方库路径如何服从沙箱。

完整的 Qt 侧 8 步编排见 [[qt-harmonyos-porting-workflow]]；公共页负责平台事实，本页只负责把检查项放进端到端交付顺序。

#### 3.4 扫描平台相关代码（8 步决策树 Step 1）
来源：`qt-harmonyos-porting-workflow` / `qt-app-harmonyos-completion`

```bash
# 平台宏
grep -rn "Q_OS_WIN\|Q_OS_LINUX\|Q_OS_ANDROID\|Q_OS_MAC" src/
# 平台相关 API
grep -rn "QProcess\|QDesktopServices\|QFileDialog\|QSystemTrayIcon\|setMask()\|showFullScreen()\|chmod()\|symlink()\|dlopen()" src/
# 构建配置平台分支
grep -rn "win32 {\|unix {\|android {\|macx {\|if(WIN32)\|if(UNIX AND NOT APPLE)\|if(ANDROID)" .pro CMakeLists.txt
```

#### 3.5 API 映射替换（Step 2，13 大类）
来源：`qt-harmonyos-api-mapping` / `qt-harmonyos-code-patterns`

按 12 大类逐一替换（+ 参数解析共 13 类）。关键决策树：

**进程管理（不能一刀切）**：
- 无界面 QProcess → 原样可用（鸿蒙沙箱内可 fork/exec 无界面二进制）
- 有界面 Qt 程序 → `QtOhosExtras::startAppProcess()` / `startNewAbilityInstance()`
- 有界面非 Qt 程序 → `startAbility(want)`
- 无界面需鸿蒙原生托管 → `QOhosAppContext::startNoUiChildProcess(libName, args)`（.so 形式经 Child Process Manager 托管，无 QApplication/GUI 管线）

```cpp
// 应用间通信：QDesktopServices::openUrl → startAbility(want)
QtOhosExtras::QOhosWant want;
want.uri = "https://example.com";
want.action = "ohos.want.action.viewData";
QtOhosExtras::startAbility(want);
```

**文件系统**：
```cpp
#ifndef Q_OS_OHOS
file.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
#endif
// symlink → 文件拷贝替代；dlopen → 仅从应用 lib 目录加载 .so
```

**参数解析**：`argv[0]` 是 .so 库路径非可执行文件路径，`want.uri` 可能占 `argv[1]`，永远不要直接索引 `argv[N]`，改用 `QCommandLineParser`。

#### 3.6 窗口适配（Step 3）
来源：`qt-harmonyos-window-model` / `qt-harmonyos-code-patterns`

先以公共 ArkUI 窗口模型确定系统约束，再用 Qt 窗口模型页确认 QPA 映射和调用时序：

```cpp
#include <QtPlatformHeaders/QOhosFunctions>
QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(dlg, mainWindow->windowHandle());
dlg->exec();   // tagging 在 show()/winId() 之前
```

**铁律 W1**：`tagWindowOrWidgetAsSubWindowOf()` 必须在主窗口创建后、子窗口 `show()` 与 `winId()` 之前调用；一旦窗口显示或原生句柄创建，标签固化失效。

**铁律 W4**：首个窗口不能直接全屏，必须 `show()` → `showFullScreen()` 两步。

#### 3.7 生命周期适配（Step 4，3 级关闭拦截）
来源：`qt-harmonyos-lifecycle` / `qt-harmonyos-code-patterns`

Stage/UIAbility 的事件语义以公共生命周期页为准；以下代码只展示 Qt `closeEvent()` 如何消费已经映射的关闭根因：

```cpp
void MainWindow::closeEvent(QCloseEvent *event) {
    auto cause = QtOhosExtras::getCloseEventRootCause(event);
    if (cause == QtOhosExtras::CloseEventRootCause::WindowStageClose) {
        // 用户关窗口 → 完整交互可弹 QMessageBox
    } else if (cause == QtOhosExtras::CloseEventRootCause::AbilityClose) {
        // 系统回收 Ability → 静默 autoSave，禁止弹窗（弹 UI 会被系统强杀）
        if (unsavedChanges()) autoSave();
        event->accept();
    } else {
        event->accept();   // InternalClose
    }
}
```
枚举必须用完整路径 `QtOhosExtras::CloseEventRootCause::AbilityClose`（enum class 短路径编译不过）。

#### 3.8 平台限制的 Qt 影响处理（Step 5）
来源：`qt-harmonyos-platform-limits` / `qt-harmonyos-third-party-libs`

限制本身及其依据以公共平台限制页为准；在 Qt 交付中逐项记录受影响的包装层和验收结果：

- `QFile` / `QFileInfo`：权限、链接和系统路径探测是否需要守卫或替代；
- `QPluginLoader` / 三方 `.so`：库是否随 HAP 放入允许的只读加载位置，是否保留加载所需 ELF 信息；
- `QTimeZone`：是否使用可用的 ICU 后端；
- `QFontDatabase`：应用是否需要自带等宽字体；
- 线程封装：是否仍依赖目标 libc 未提供的取消语义。

Qt API 的已知表现、替代写法和 QTBUG 追踪见 [[qt-harmonyos-platform-limits]]，不要在本流程复制维护平台结论。

**Qt6 特有**：`Q_OS_LINUX` 守卫不可信——Qt6 OHOS 同时定义 `Q_OS_OHOS` 和 `Q_OS_LINUX`，裸 `#ifdef Q_OS_LINUX` 守护 desktop-only 功能会在 OHOS 误触发，正确写法 `#if defined(Q_OS_LINUX) && !defined(Q_OS_OHOS)`。

#### 3.9 构建系统适配（Step 6）
来源：`qt-harmonyos-porting-workflow` / `qt-harmonyos-project-structure` / `qt-ohos-concrete-build-recipe`

**qmake（Qt5 专属；Qt6 模块不再独立存在，见铁律 B6，CMake 无 find_package）**：`unix` 分支必须追加 `:!ohos`（`unix:!android:!macx:!ohos`），否则 ohos 同时命中 unix 编译错误 Linux 代码；新增 `ohos {}` 分支必须加 `QT += ohosextras`。

**CMake（Qt5/Qt6 通用）**：四项关键配置
```cmake
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)   # ① 交叉编译搜索路径（铁律 B1）
find_package(Qt5 REQUIRED COMPONENTS Core Gui Widgets)   # ② 链接 Qt 模块
add_library(myapp SHARED ${SOURCES})          # ③ 生成共享库（鸿蒙要求）
target_link_libraries(myapp PRIVATE Qt5::QOhosPlatformIntegrationPlugin)   # ④ 链接 QPA 插件（铁律 B2）
```

#### 3.10 迁移完成检查清单（12 项）
来源：`qt-harmonyos-porting-workflow`

所有 Q_OS_* 宏分支已添加 Q_OS_OHOS 处理 / 子进程已按场景处理 / 所有无 parent 顶层窗口已标记子窗口 / 窗口标记函数在 show()/winId() 之前调用 / closeEvent 已通过 getCloseEventRootCause 处理 / 不依赖 chmod/symlink/可写路径 dlopen / .pro/CMake 已添加 ohos 条件和 QT+=ohosextras / 所有 Qt 模块在 OHOS 受支持 / argv[0] 未作为可执行文件路径 / 拖放数据获取仅在 dropEvent 中 / 首个主窗口启动时未直接全屏 / 主窗口 hide() 行为已验证。

### 产出（下游交付）
- 预检报告（Qt 版本 + SDK 选型 + Playbook + 模块缺口 + 平台绑定 + foreach + 三方依赖）
- 可行性评估报告（可迁移 / 有风险项 / 不可迁移）
- 已适配的项目源码与工程结构

供阶段四编译。

### 注意事项/陷阱
来源：`qt-app-harmonyos-migration` / `qt-harmonyos-api-mapping` / `qt-harmonyos-code-patterns`

- **Qt5 声明但实为 Qt6 代码陷阱**：Qt 版本按代码实际 API 判定，不按 .pro/`QT +=`/xlsx 声明（canonic/B23Downloader 翻车，3-4 次编译 attempt 才确认）
- `QFileDialog` 在 OHOS 上原生可用，无需 `#ifdef` 替代（平台插件 QOhosPlatformIntegrationPlugin 已内置原生文件对话框支持）
- 独立 QDialog 无 parent 会被系统视为新主窗口，需设 parent 或 `tagWindowOrWidgetAsSubWindowOf()`
- 拖放 `dragEnterEvent`/`dragMoveEvent` 阶段仅 MIME types 可用，完整 QMimeData 数据仅在 `dropEvent` 中可用
- OHOS Qt Network 无 OpenSSL，SSL 分支需 `#ifndef QT_NO_SSL` 守卫
- OHOS clang 15 不支持 C++23 P0847(deducing-this)，需改 CRTP；clang 严拒 MSVC 允许的双重隐式转换需改显式构造
- Qt6 OHOS 无 DBus（硬墙）：无条件 `#include <QtDBus>` + Q_OBJECT 继承 / `find_package(Qt6 DBus REQUIRED)` 无守护 → 不可编译、不可 stub、不可 `-DCMAKE_DISABLE`
- 子进程选型不能一刀切（2026-07-21 修正旧版"QProcess 不可用"断言）

### ⚠️ KB 未覆盖
- migration 阶段无统一命名工作流页承载完整 8 步 + 13 类映射 + 14 组模式（分散在 `qt-harmonyos-porting-workflow` / `qt-harmonyos-api-mapping` / `qt-harmonyos-code-patterns`）。**最小可行建议**：本阶段即为缝合后的统一迁移参考。

---

## 阶段四：编译构建（compile）

### 目标
产出未签名 HAP（`entry-default-unsigned.hap`，`BUILD SUCCESSFUL`）+ 业务 .so + `harmony-deployment-settings.json` + 静态预检报告。

> **KB 一致性约束**：多个 compile 工作流（`qt-app-harmonyos-migration` / `qt-ohos-concrete-build-recipe` / `qt6-ohos-qtmqtt-build`）明确声明"编译验证目标=未签名 HAP，签名是独立后续步骤不在本工作流范围"，`build-profile.json5` 不配签名。compile→sign handoff 需用户自行跳转到阶段五签名。

> **占位符约定**：本阶段占位符 `<QT6_SRC>` = Qt6 superbuild 源码根（qt5 仓库目录）；`<QT6_HOST_BUILD>` = host 构建输出目录；`<NATIVE_OHOS_SDK>` = `<DEVECO>/sdk/default/openharmony/native`（见阶段一 §1.4）；`<ADDITIONAL_PACKAGES>` = 附加第三方库包解压目录（见阶段一 §1.6）。策略 B/B' 路径风格统一用占位符，禁止硬编码个人绝对路径。

### 前置（上游交付）
- 阶段三产出的已适配项目源码与工程结构
- Qt OHOS SDK（`CMAKE_PREFIX_PATH` 指向正确 Qt SDK）
- `entry/build-profile.json5` 的 `externalNativeOptions.path` 指向 CMakeLists.txt
- `HarmonyOS/local.properties`：`sdk.dir=...`

### 步骤（按 Qt 版本/策略分路径）

#### 4.1 Qt6 源码 superbuild（策略 B）
来源：`qt6-ohos-windows-build`

**Host Build**（编译主机工具）：
```powershell
mkdir <QT6_HOST_BUILD>; cd <QT6_HOST_BUILD>
<QT6_SRC>/configure.bat -release -developer-build -opensource -confirm-license `
  -nomake examples -nomake tests -verbose `
  -submodules qtbase,qtsvg,qtimageformats,qtshadertools,qtlanguageserver,qtdeclarative
cmake --build . --parallel -j14
```
产出 41 exe + 68 dll（moc/rcc/uic/qsb/harmonydeployqt/qmlcachegen）。

**Target Build**（交叉编译 OHOS 版本，+ Windows 额外 7 个 CMake 变量）：
```powershell
<QT6_SRC>/configure.bat -developer-build -nomake tests -debug `
  -no-dbus -no-use-gold-linker -no-pch -no-openssl `
  -ohos-sdk "<DEVECO>/sdk/default/openharmony" `
  -qt-host-path "<QT6_HOST_BUILD>/qtbase" -verbose `
  -submodules qtbase,qtsvg,qtimageformats,qtshadertools,qtlanguageserver,qtdeclarative `
  -- `
  "-DCMAKE_PREFIX_PATH=<ADDITIONAL_PACKAGES>" `
  "-DNodeAddonApi_INCLUDE_DIR=<ADDITIONAL_PACKAGES>/node-addon-api" `
  "-DGLESv2_INCLUDE_DIR=<NATIVE_OHOS_SDK>/sysroot/usr/include" `
  "-DGLESv2_LIBRARY=<NATIVE_OHOS_SDK>/sysroot/usr/lib/aarch64-linux-ohos/libGLESv2.so" `
  "-DEGL_INCLUDE_DIR=<NATIVE_OHOS_SDK>/sysroot/usr/include" `
  "-DEGL_LIBRARY=<NATIVE_OHOS_SDK>/sysroot/usr/lib/aarch64-linux-ohos/libEGL.so" `
  "-DFontconfig_INCLUDE_DIR=<ADDITIONAL_PACKAGES>/include" `
  "-DFontconfig_LIBRARY=<ADDITIONAL_PACKAGES>/lib/libfontconfig.so"
cmake --build . --parallel -j8
```
> EGL 路径按 GLESv2 同 sysroot 模式填入（include 同目录、lib 同 `aarch64-linux-ohos/libEGL.so`）。
产出 65 .so + 7 平台插件（含 libqohos.so QPA）。

#### 4.2 Qt6 OHOS 特有运行时 patch（仅策略 B 源码 superbuild）
来源：`qt6-ohos-windows-build` / `qt-harmonyos-qt6-status` / `qt-ohos-concrete-build-recipe` [Qt6 变体]

策略 B superbuild（§4.1）仍用 `-developer-build` → 仍写绝对 NEEDED 路径，**两道检查仍必做**（部署设备前）：

```bash
patch_needed.py   # 把所有 .so（业务库 + Qt 库自身）的 DT_NEEDED 改裸名
llvm-readelf -d <lib.so>          # 验证 NEEDED 无 C:/ 绝对路径
llvm-readelf --dyn-syms <lib.so>  # 验证 main 为 GLOBAL DEFAULT
# 给 main 加 __attribute__((visibility("default")))  # 仅 OHOS 下
```
patch NEEDED 时字节长度必须不变（裸名 + null 填充）→ ELF 偏移不变才安全。

> **策略 B' 预构建无此问题**：预构建 .so NEEDED 已裸名，`qt_add_executable` 已让 main 自动 GLOBAL DEFAULT，无需手写 visibility 属性或 patch（见 §4.3）。

#### 4.3 Qt6 预构建 CLI（策略 B'，推荐）
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-ohos-qtmqtt-build` / `qt6-cef-ohos-integration-guide`

**Step 1 configure（qt-cmake.bat 生成 ninja 工程）**：
```bat
call "<QT6_OHOS_KIT>/bin/qt-cmake.bat" -S "%SRC%" -B "%BUILD%" -G Ninja ^
  -DCMAKE_TOOLCHAIN_FILE="<QT6_OHOS_KIT>/lib/cmake/Qt6/qt.toolchain.cmake" ^
  -DQT_HOST_PATH="<QT6_HOST>" ^
  -DQT_CHAINLOAD_TOOLCHAIN_FILE="<NATIVE_OHOS_SDK>/build/cmake/ohos.toolchain.cmake" ^
  -DOHOS_ARCH=arm64-v8a ^
  -DOHOS_SDK_NATIVE="<NATIVE_OHOS_SDK>" ^
  -DCMAKE_PREFIX_PATH="<QT6_OHOS_KIT>"
```
**陷阱#1**：从 .bat 调 qt-cmake.bat 必须用 `call`，否则控制权转给被调 .bat 不返回，后续 build/package 全不执行且 errorlevel=0 假成功。
**陷阱#3**：`-DQT_CHAINLOAD_TOOLCHAIN_FILE` 不可省——覆盖 qt.toolchain.cmake 里硬编码的 Linux 路径，否则 OHOS 工具链没加载、clang 当 host 链 Windows 库。
**陷阱#8**：configure 打印 Qt6GrpcTools/Protobuf not found 可忽略（可选插件依赖警告）。
> qt-cmake.bat 依赖 PATH 中的 cmake（须将 `<NATIVE_OHOS_SDK>/build-tools/cmake/bin` 置 PATH，见阶段二 §2.1）。
成功标志：`-- Configuring done` / `-- Generating done`。qt_add_executable 在 configure 时自动生成 `<target>-harmony-deployment-settings.json`。

**Step 2 build（交叉编译出业务 .so）**：
```bash
cmake --build "%BUILD%" --parallel
```

**Step 3a 创建 hvigor-wrapper.bat 注入 java**（修 spawn java ENOENT，陷阱#5）：
```bat
:: hvigor-wrapper.bat — re-inject jbr/bin + JAVA_HOME for hvigorw's node workers
@echo off
set JAVA_HOME=<DEVECO>/jbr
set PATH=<DEVECO>/jbr/bin;<DEVECO>/tools/node;<DEVECO>/tools/hvigor/bin;<NATIVE_OHOS_SDK>/build-tools/cmake/bin;%PATH%
"<DEVECO>/tools/hvigor/bin/hvigorw.bat" %*
```
注释必须用 `::` 英文或 `rem` 英文，切勿中文 rem——cmd 在 GBK 代码页把中文 rem 乱码当命令执行。

**Step 3b package HAP（harmonydeployqt6）**：
```bat
"<QT6_HOST>/bin/harmonydeployqt6.exe" ^
  --input "%BUILD%/<target>-harmony-deployment-settings.json" ^
  --output "%HAP%" ^
  --hvigor "<WORK>/hvigor-wrapper.bat" ^
  --verbose
```
**陷阱#2**：harmonydeployqt6.exe 在 HOST kit bin（不在 OHOS kit bin）。
**陷阱#6**：`--hvigor` 必须传绝对路径（相对路径报 Failed to start hvigorw）。

harmonydeployqt6 会：拷贝 HAP 模板（`<QT6_OHOS_KIT>/src/harmonyos/templates`）→ 改写 `app.json5`/`module.json5`/`QtAppConstants.ets`（注入 `APP_LIBRARY_NAME`）→ 拷贝业务 `.so` + Qt 库 + 插件 + `libc++_shared.so` → 调 hvigor `assembleHap`。

成功标志：`HAP build completed successfully` + `Generated HAP: <HAP>/entry/build/default/outputs/default/entry-default-unsigned.hap`。

#### 4.4 Qt6 IDE 配置（策略 B' + Qt Creator）
来源：`qt6-qtcreator-harmonyos-setup`

Qt Creator → Edit → Preferences → Kits → harmonyOS kit → CMake → Initial Configuration，清空全部现有条目后粘贴 9 条 CMake 配置（值不带引号 + 正确类型 FILEPATH/PATH/STRING）：
```
-DCMAKE_CXX_COMPILER:FILEPATH=%{Compiler:Executable:Cxx}
-DCMAKE_C_COMPILER:FILEPATH=%{Compiler:Executable:C}
-DCMAKE_PREFIX_PATH:PATH=%{Qt:QT_INSTALL_PREFIX}
-DCMAKE_GENERATOR:STRING=Ninja
-DCMAKE_TOOLCHAIN_FILE:FILEPATH=<QT6_OHOS_KIT>/lib/cmake/Qt6/qt.toolchain.cmake
-DQT_CHAINLOAD_TOOLCHAIN_FILE:FILEPATH=C:/DevecoStudio/sdk/default/openharmony/native/build/cmake/ohos.toolchain.cmake
-DOHOS_SDK_NATIVE:PATH=C:/DevecoStudio/sdk/default/openharmony/native
-DOHOS_ARCH:STRING=arm64-v8a
-DQT_HOST_PATH:PATH=<QT6_HOST_BUILD>
```
+ Kit Environment 设 5 项环境变量（NODE_HOME/JAVA_HOME/DEVECO_SDK_HOME/QT_HARMONYOS_HVIGOR/PATH）。

**三条铁律**：
1. CMake 初始配置值不带首尾引号 + 用正确类型，不要 `:UNINITIALIZED`
2. `QT_CHAINLOAD_TOOLCHAIN_FILE` 必须在、且指向真实 Windows 路径（缺它 → 回退 Linux 默认路径 → clang++ 当 host → broken）
3. `OHOS_SDK_NATIVE` 与编译器同源（都用 `<DEVECO>/sdk/default/openharmony/native`）；`CMAKE_TOOLCHAIN_FILE` 只留一条

打包用方式二 `_make_hap` 目标（Qt CMake 自动生成，自动先编 .so 再调 harmonydeployqt6）：
```
cmake --build . --target samegame_make_hap
```

#### 4.5 Qt5 Playbook A（应用 → HAP）
来源：`qt-ohos-concrete-build-recipe` / `qt-app-harmonyos-migration`

**[A1] 编写 OhosExampleApp/CMakeLists.txt**：
```cmake
project(Ohos<Slug> LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)
if(CMAKE_CROSSCOMPILING)
  set(_saved "${CMAKE_FIND_ROOT_PATH_MODE_PACKAGE}")
  set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)
endif()
find_package(Qt5 5.15 REQUIRED COMPONENTS <Core Gui Widgets Network …>)
set(APP_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../<srcsubdir>")
add_library(Ohos<Slug> SHARED main.cpp ${APP_SOURCES} ${APP_HEADERS} ${APP_FORMS} ${APP_RESOURCES})
target_compile_definitions(Ohos<Slug> PRIVATE QT_DEPRECATED_WARNINGS NO_X11)
target_link_libraries(Ohos<Slug> PRIVATE Qt5::Core Qt5::Gui Qt5::Widgets Qt5::QOhosPlatformIntegrationPlugin)
```
APP_SOURCES 从 .pro 的 SOURCES 来，排除 `*win32*/*x11*/*cocoa*/*osx*/*android*`。`QT_NO_FOREACH` 仅当确认项目不用 Qt foreach 宏时才定义，否则 OMIT。

**[A2] 编写 OhosExampleApp/main.cpp（OHOS 入口 shim）**：
```cpp
#include <QApplication>
#include "<mainwindow header>"
extern "C" int main(int argc, char *argv[]) {   // QPA 通过 dlsym("main") 查找入口点
    QApplication app(argc, argv);
    MainWindow w;
    w.show();
    return app.exec();
}
```
从项目原始 main.cpp 改造：保留 org/app name、高 DPI、命令行解析；排除原始 main.cpp 不进 APP_SOURCES（用 shim 替代避免重复符号）。Qt6 去掉 `AA_EnableHighDpiScaling` 分支。

**[A3-A5] 配置 HarmonyOS/ 7 个文件 + 拷贝 styles/libqohosstyle.so**：
1. `entry/build-profile.json5`：externalNativeOptions.path（绝对路径）、arguments=`-DCMAKE_PREFIX_PATH=...`、abiFilters=`["arm64-v8a"]`
2. `AppScope/app.json5`：bundleName=`com.example.<slug-lower>`
3. `QtAppConstants.ets`：APP_LIBRARY_NAME=`libOhos<Slug>.so`、LOG_TAG
4. `string.json`：app_name → 应用名
5. `entry/src/main/resources/{base,en_US,zh_CN}/element/string.json`：QAbility_label → 应用名
6. 根 `build-profile.json5` 覆盖为未签名配置（`signingConfigs: []`，模板自带 signingConfig:"default" 无效必须改）
7. `local.properties`：sdk.dir

拷贝：`cp <QT_SDK>/plugins/styles/libqohosstyle.so <工程>/HarmonyOS/entry/libs/arm64-v8a/styles/`（其余 Qt 运行时 .so 由 CMake/hvigorw 自动链接打包，无需手拷）。

**[A6] hvigorw 构建 → 未签名 HAP**：
```bash
export PATH="/c/Program Files/Huawei/DevEco Studio/jbr/bin:/c/Program Files/Huawei/DevEco Studio/tools/node:$PATH"
export DEVECO_SDK_HOME='C:\Program Files\Huawei\DevEco Studio\sdk'
cd "<…>/HarmonyOS"
node ".../tools/hvigor/bin/hvigorw.js" assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```
成功标志：`entry/build/default/outputs/default/entry-default-unsigned.hap` 存在 + `BUILD SUCCESSFUL`。

#### 4.6 Qt5 Playbook B（库 → .a/.so）
来源：`qt-ohos-concrete-build-recipe`

```bash
OHOS_NATIVE="C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/native"
CMAKE="$OHOS_NATIVE/build-tools/cmake/bin/cmake.exe"
NINJA="$OHOS_NATIVE/build-tools/cmake/bin/ninja.exe"
cd "<…>/ohos-build"
"$CMAKE" -S . -B build -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
  -DCMAKE_TOOLCHAIN_FILE="$OHOS_NATIVE/build/cmake/ohos.toolchain.cmake" \
  -DOHOS_ARCH=arm64-v8a -DCMAKE_PREFIX_PATH="${QT5_15_OHOS_SDK}" \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
"$CMAKE" --build build
```
成功标志：`build/libOhos<Slug>.a`（或 .so）存在。库不需要 QPA 插件。优先写全新极简 CMakeLists 直接列源码，不要 `add_subdirectory` 原始 CMake（常含 Qt6 find_package、install/export、CPack 会污染交叉编译）。

#### 4.7 Qt6 addon 模块交叉编译（如 qtmqtt）
来源：`qt6-ohos-qtmqtt-build`

```bash
QTMQTT_SRC=<QTMQTT_SRC>; KIT=<QT6_OHOS_KIT>; MINGW64=<QT6_HOST>; NATIVE=<NATIVE_OHOS_SDK>
BD=<QTMQTT_SRC>-build-ohos
mkdir -p "$BD" && cd "$BD"
cmd //c "$KIT/bin/qt-cmake.bat" -G Ninja \
  -DQT_HOST_PATH="$MINGW64" -DOHOS_SDK_NATIVE="$NATIVE" \
  -DQT_CHAINLOAD_TOOLCHAIN_FILE="$NATIVE/build/cmake/ohos.toolchain.cmake" \
  -DOHOS_ARCH=arm64-v8a -DCMAKE_PREFIX_PATH="$KIT" \
  -DCMAKE_INSTALL_PREFIX="$KIT" \   # 关键招：装进 kit
  -DQT_BUILD_EXAMPLES=OFF -DQT_BUILD_TESTS=OFF "$QTMQTT_SRC"
cmake --build . -j8
cmake --install .   # 装进 kit（libQt6Mqtt.so 进 kit lib/、cmake config 进 lib/cmake/Qt6Mqtt/、headers 进 include/QtMqtt/）
```

验证：`libQt6Mqtt.so`（~395KB）NEEDED 全裸名 + `$KIT/lib/cmake/Qt6Mqtt/` 下 10 个 .cmake + `$KIT/include/QtMqtt/` 含头文件。

#### 4.8 Qt6 + CEF 集成（复杂三方引擎）
来源：`qt6-cef-ohos-integration-guide`

12 步迁移路径（复用 Qt5 预编译 CEF 内核 + native adapter + CEF 客户端层，改造面收敛到 CMake + Ability 启动胶水 + Inject IoC 初始化 + CEF 库手动部署）：

1. 环境准备（`export DEVECO_PATH/OHOS_SDK_NATIVE/QT6_SDK/QT_HOST_PATH`）
2. 复制 OpenQtCef 工程到 workspace
3. 写 Qt6 CMakeLists（`qt_add_executable` 替代 `add_library(SHARED)`）
4. `qt-cmake.bat` 编译 `libqtmodule.so`
5. `harmonydeployqt6` 生成 hap-out Qt6 模板工程
6. 写 hvigor-wrapper.bat 修 spawn java ENOENT（踩坑#1）
7. CEF 库手动部署到 hap-out/entry/libs/arm64-v8a/（踩坑#2，harmonydeployqt6 不收集 CMakeLists 直接链接的绝对路径 .so）
8. 迁移 web_engine har 模块
9. QAbility 融合（extends WebQtAbility，踩坑#4）
10. QAbilityStage 融合 + Inject IoC 初始化（踩坑#5 核心）
11. CEF 权限（user_grant 必配 reason+usedScene，踩坑#6）
12. 打签名 HAP（`hvigor-wrapper.bat assembleHap --mode module -p product=default --no-daemon`）

产出 `entry-default-signed.hap`（~261M，含 libcef.so 163M）。

### 产出（下游交付）
- 未签名 HAP：`entry/build/default/outputs/default/entry-default-unsigned.hap`（gallery ~33MB；手动 stage 三方 .so 后 ~70MB）
- 业务库 `.so`（`<BUILD>/`，OHOS clang 交叉编译的 MODULE 共享库）
- `<target>-harmony-deployment-settings.json`（package 步骤的输入）
- 一键脚本 `build-<app>-ohos.bat` + `hvigor-wrapper.bat`
- **静态预检报告**（DT_NEEDED 裸名 + main GLOBAL DEFAULT + 插件部署清单）——策略 B 在 §4.2 完成 `patch_needed.py` + readelf 验证；完整静态预检（native 库完整性 / DT_NEEDED / 符号可见性 / QML 插件部署）在 run-test §2 形式化（见阶段七 §7.1 表"阶段二 构建+静态预检"行），作为装机硬门控

> **⚠️ 时序澄清（静态预检 vs 装机）**：静态预检是 compile→install 之间的**硬门控**，必须在装机前完成。run-test 的内部时序是 §2（构建+静态预检）→ §3（签名+装机）→ §4（启动+运行时验证），即预检先于装机。本页把 deploy/run 列为阶段六、test 列为阶段七是按"首次部署冒烟 / 正式验证闭环"切分，**不**意味着预检在装机之后。装机前须已通过：策略 B 经 §4.2 `patch_needed.py` + readelf；全路径经 run-test §2 静态预检门控（先于 §3 装机）。

### 注意事项/陷阱
来源：`qt6-ohos-windows-app-dev-guide` / `qt6-ohos-qtmqtt-build` / `qt-ohos-concrete-build-recipe` / `qt-app-harmonyos-migration`

- **ABI**：预构建只有 arm64-v8a 目标套件（无 x86_64 kit）。DevEco 默认模拟器常为 x86_64，无法加载产出的 arm64 .so——要么用 arm64 模拟器，要么用真机
- **陷阱#12（最关键运行时坑）**：HAP hdc install 成功但 aa start 闪退/hilog 报 `dlopen failed: library 'libicui18n.so' not found`。根因：Qt6 kit 的 Qt .so 带 HARD DT_NEEDED 三方库，harmonydeployqt6 只按 deployment-settings.json 从 kit 拷 Qt .so+插件不递归拷三方 NEEDED。修复：手动 stage 9 个三方 .so 进 `<HAP>/entry/libs/arm64-v8a/` 再 `hvigorw assembleHap --no-daemon` 重打（不要重跑 harmonydeployqt6）。HAP 从 ~33MB 涨到 ~70MB（libicudata ~33MB）
- **autouic 跨目录陷阱**：.ui 与 .cpp 分目录时 AUTOUIC 不会自动按 .ui 目录搜，须显式 `list CMAKE_AUTOUIC_SEARCH_PATHS`
- **x86 内联禁用**：arm64 不支持 AESNI/SSE/AVX，不定义 `USE_INTEL_AES_IF_AVAILABLE` 等宏
- **不可行判据**（直接 defer 不进编译批次）：核心功能绑 X11/Win32/D-Bus（QHotkey/qxtglobalshortcut 等）；专有/重型原生引擎（VLC/CEF/Skia 等）；网络抓包/系统级（WinPcap/Winsock2）
- **hvigorw ArkTS WARN 非错误**：模板层 deprecated NODE/getShared、napi verification、SDK 5.0.5 on 5.0.0(12)——构建仍成功
- **B' 路线无需 B 的三大坑**：DT_NEEDED patch 脚本（预构建 .so NEEDED 已裸名）/ shim-trim 第三方库（完整 50+ 模块发行版，仅缺 WebEngine/DBus/Wayland/Pdf/Script）/ Qt6_DIR junction 转发头

### ⚠️ KB 未覆盖
- compile 阶段 8+ 工作流多路径重叠，CMake 配置在多页重复，无统一"编译配方索引页"按 SDK 来源/Playbook 路由。**最小可行建议**：以本阶段 §4.1-4.8 为索引表，按 (Qt5/Qt6) × (Playbook A/B) × (策略 B/B') 三维查表。
- **Qt6 变体两种 CMake 模式混用风险**：`qt-ohos-concrete-build-recipe` Qt6 变体用 `add_library` + 手写 `main __attribute__((visibility(default)))`，`qt6-ohos-windows-app-dev-guide` 用 `qt_add_executable`（自动 main GLOBAL DEFAULT），两种模式面向不同 SDK 来源不冲突但混用会致 main 可见性问题。**最小可行建议**：策略 B（§4.1-4.2）源码 superbuild 用前者，策略 B'（§4.3-4.4）预构建用后者，禁止跨策略混用。

---

## 阶段五：签名（sign）

### 目标
产出签名 HAP（`entry-default-signed.hap`），`.p7b` Profile 绑定的 bundleName 已与 `AppScope/app.json5` 校验一致，`products[]` 已引用 `signingConfig`。

> 本阶段合并 KB 中分散的 4 种签名方法为统一步骤（原分散在 `qt-ohos-run-test` §3、`qt6-qtcreator-harmonyos-setup` §3.6/§5、common DevEco CLI 规则、`qt6-ohos-windows-app-dev-guide` §6.3）。

### 前置（上游交付）
- 阶段四产出的未签名 HAP（`entry-default-unsigned.hap`）
- 调试签名材料（.p12 密钥库 + .p7b Profile + .cer，从 `~/.ohos/config/` 或已有项目提取）

> **签名材料获取前置（必读）**：调试签名材料（.p12 + .p7b + .cer）的生成**依赖 DevEco Studio 至少用一次**——纯 CLI"不依赖 IDE"承诺的唯一例外。材料生成入口是下方方法一（Auto Signing）：首次在 DevEco 里 sign 一次，Auto Signing 会用自带调试密钥库 + Profile 生成调试 .p12/.p7b/.cer，之后命令行 hvigor 复用同一套配置。未跑过方法一则方法二/三/四无材料可用。

### 步骤（4 种方法合并）

#### 方法一：DevEco Auto Signing（推荐首次，材料生成入口）
来源：`qt6-qtcreator-harmonyos-setup` §3.6 / `qt6-ohos-windows-app-dev-guide` §6.3 / `qt6-cef-ohos-integration-guide`

用 DevEco Studio 打开 harmonydeployqt6 的 `--output`（hap-out）目录，DevEco Auto Signing 用自带调试密钥库 + Profile 自动签 debug HAP：首次会引导登录华为开发者账号并生成调试 .p12 + .p7b + .cer（存入 `~/.ohos/config/`），自动签 debug HAP；之后命令行 hvigor 复用同一套配置。hap-out 的 `build-profile.json5` 自动配好签名。

> **⚠️ KB 未覆盖**：方法一的具体菜单导航（File → Project Structure → Signing Configs → 勾选 Automatically generate signature 的精确路径）未在源工作流显式记录，无法据此盲操作。建议首次操作时记录菜单路径截图归档，或参照 DevEco 官方"签名配置"文档。

#### 方法二：build-profile.json5 signingConfig + products[] 引用
来源：`qt-ohos-run-test` §3.1 / `qt6-ohos-windows-app-dev-guide` §6.3/§12

在 `<HAP>/build-profile.json5` 配 signingConfigs + **必须在 products[] 加 signingConfig 引用**：
```json
"signingConfigs": [
  {
    "name": "default",
    "type": "HarmonyOS",
    "material": {
      "storeFile": "<KEYS_DIR>/debug.p12",
      "storePassword": "***",
      "keyAlias": "debug",
      "keyPassword": "***",
      "signAlg": "SHA256withECDSA",
      "profile": "<KEYS_DIR>/debug.p7b",
      "certPath": "<KEYS_DIR>/debug.cer"
    }
  }
],
"products": [
  { "name": "default", "signingConfig": "default", ... }
]
```
hvigor 的 SignHap 任务签。不配则 hvigor `WARN: Will skip sign 'hos_hap'`，产出仍是 unsigned。

#### 方法三：hap-sign-tool.jar 命令行独立签
来源：common DevEco CLI 使用规则

```bash
java -jar "<DEVECO>/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar" sign ...
```
命令独立于 hvigor 签名配置。纯 CLI 也可用 DevEco 自带 `OpenHarmony.p12`/`OpenHarmonyProfileDebug.pem` 自签。

> **⚠️ KB 未覆盖**：上方 `sign ...` 的完整子参数/flags 在既有资料中即被截断为 `...`（源级缺口），本页无法补全。完整 sign 子参数见华为官方 [hap-sign-tool 说明](https://developer.huawei.com/)（`--keystore`/`--store-pass`/`--key-alias`/`--key-pass`/`--profile`/`--cert`/`--sign-alg` 等），配置较繁。

#### 方法四：harmonydeployqt6 命令行六件套
来源：`qt6-qtcreator-harmonyos-setup` §3.6/§5

```bash
harmonydeployqt6 --signing-cert-path <.cer> --signing-profile <.p7b> \
  --signing-store-file <.p12> --signing-key-alias <alias> \
  --signing-key-password <密文> --signing-store-password <密文>
```
六件套须同时给全（否则 HAP 留未签名），且密码须是 hvigor 加密串（非明文）。装设备用 `harmonydeployqt6 --install`（via hdc，需连设备 + 签名）。

> **⚠️ KB 未覆盖**：方法四的"密码须是 hvigor 加密串（非明文）"，但源工作流未说明如何从明文生成该加密串。生成机制待补充（疑为 hvigor/keystore 工具的 `encrypt` 子命令，KB 未收录）。

### 产出（下游交付）
- 签名 HAP：`entry/build/default/outputs/default/entry-default-signed.hap`

供阶段六部署运行。

### 注意事项/陷阱
来源：`qt-ohos-run-test` §3 / `qt6-ohos-windows-app-dev-guide` §6.3/§12 / common DevEco CLI 使用规则

- **必做**：仅在 `app.signingConfigs` 定义证书不够，必须在 `app.products[]` 里加 `signingConfig` 引用，否则 hvigor 仍产 unsigned HAP，真机拒装 `code:9568320`
- **.p7b Profile 绑定特定 bundleName**：`AppScope/app.json5` 的 bundleName 必须改为与证书一致值，否则 SignHap 失败
- 正常打包不加 `--no-build`（验证用）、不加 `--install`（装设备才用）；发布才加 `--release`
- 调试签名材料（.p12 + .p7b）生成通常需 DevEco Studio 至少用一次——纯 CLI"不依赖 IDE"承诺的唯一例外

---

## 阶段六：部署运行（deploy/run）

> **KB 缺口命名阶段**：deploy（装机）是 sign→run 之间物理必需步骤，但原 6 阶段模型无 deploy 阶段。`qt-ohos-run-test` 将 deploy 归入 §3.2（签名后 hdc install），`qt6-ohos-windows-app-dev-guide` 将 deploy 并入 step 10（与 run 合并）。本阶段合并 deploy+run。
>
> **边界说明（阶段六 vs 阶段七）**：本阶段 §6.2-6.5 的运行时验证（进程存活/三类黑屏/生命周期/窗口/输入/平台限制回归）对应 run-test §4（阶段七 §7.1 表"阶段四 启动+运行时验证"行）。阶段六是**首次部署+运行冒烟**（拿到"能跑起来"），阶段七 §7.1 是**带门控的正式验证闭环**（重跑 build→precheck→sign→install→start→verify 并逐阶段门控）。两者内容重叠是设计使然——阶段六为首次快速验证，阶段七为形式化闭环。

### 目标
把签名 HAP 部署到真机/模拟器、启动应用、验证进程存活与渲染非黑屏，产出运行日志与截图。

### 前置（上游交付）
- 阶段五产出的签名 HAP
- 目标设备（真机，hdc 可连接；或 arm64 模拟器）
- **静态预检已通过**（见阶段四产出与时序澄清）——装机硬门控，须已通过：策略 B 经 §4.2 `patch_needed.py` + readelf 验证；全路径经 run-test §2 静态预检（native 库完整性/DT_NEEDED/符号可见性/QML 部署），该阶段先于 run-test §3 装机

### 步骤

#### 6.1 安装 HAP 到设备
来源：`qt-ohos-run-test` §3.2 / `qt6-ohos-windows-app-dev-guide` §10 / `qt6-cef-ohos-integration-guide` step13

```bash
HDC="<DEVECO>/sdk/default/openharmony/toolchains/hdc.exe"
"$HDC" list targets                          # 确认设备连接
"$HDC" uninstall <bundleName>                # 卸载旧版
"$HDC" install "entry/build/default/outputs/default/entry-default-signed.hap"
# 多模块逐个安装
"$HDC" install "<module>/build/default/outputs/default/<module>-default-signed.hap"
```
真机需开发者模式 + 允许调试安装 + 信任计算机；模拟器由 DevEco 管理，hdc 自动识别。

#### 6.2 启动应用 + 验证进程存活
来源：`qt-ohos-run-test` §4.1 / `qt6-ohos-windows-app-dev-guide` §10

```bash
"$HDC" shell aa start -a <AbilityName> -b <bundleName>   # 通常 QAbility 或 EntryAbility
sleep 5
"$HDC" shell "ps -ef" | grep "<bundleName>"
```
有输出 → 进程存活进入渲染验证；无输出 → 进程崩溃直接进入崩溃分析。bundle name 见 deployment-settings.json 的 harmonyos-app-bundle-name；启动 ability 见 module.json5 的 mainElement（Qt OHOS 模板固定为 QAbility，非 MainAbility）。

#### 6.3 渲染正确性验证（三类黑屏区分）
来源：`qt-ohos-run-test` §4.2

```bash
"$HDC" shell uitest screenCap -p /data/local/tmp/screenshot.png
"$HDC" file recv /data/local/tmp/screenshot.png <本地路径>
```

**截图"存在"≠"渲染正确"**，三类黑屏须按矩阵区分：
1. **Qt3D RGBA8 mipmap 静默纯黑**（无 GL 错误，alpha-PNG 实体纯黑，ZINK glGenerateMipmap 对 RGBA8 alpha 失败）→ 关 mipmap + 守卫用 `Qt.platform.pluginName`（os 在 OHOS 返回 linux 致守卫不触发）
2. **EGL_BAD_CONFIG 黑屏**（12293，setSamples(4) 4x MSAA 无匹配 config）→ 加 Q_OS_OHOS 守卫去 samples
3. **QML 模块未部署黑屏**（module not installed）→ 复制 SDK qml/ 到 `entry/src/main/resources/resfile/qml/`

#### 6.4 生命周期/窗口/输入/平台限制回归
来源：`qt-ohos-run-test` §4.3-4.6

```bash
"$HDC" shell "hilog -x -e '<bundleName>'"
```
- 生命周期：closeEvent 3 级关闭（L1 可弹对话框 / L2 禁弹 UI 仅 autoSave）、`qApp->quit()` 退出（死锁 ~2min 见 episodic-quit-deadlock-tsfn）、theMainThread 匹配（Debug 下 Q_ASSERT 崩，Release 静默须 Debug 验证）
- 窗口：subwindow tagging 顺序（W1）、Dialog-as-main-window（W3）、首窗口全屏顺序（W4）、hide→最小化（W5）、跨屏拖拽无闪烁
- 输入：点击/触摸/hover/Leave（hover/Leave 不可靠双重盲区）
- 平台限制回归：以 common 平台限制清单为输入，验证 [[qt-harmonyos-platform-limits]] 中对应的 Qt API、QPA/QML 症状与 workaround；本页不复制平台规则矩阵

#### 6.5 查看运行日志
来源：`qt6-ohos-windows-app-dev-guide` §11 / `qt-harmonyos-build-run-workflow`

```bash
"$HDC" shell "hilog -x -e '<bundleName>'" | grep "Error\|FATAL\|SIGSEGV\|TypeError"
"$HDC" shell hilog | findstr gallery   # Qt 日志经 hilog 路由（qOhosLogMessage）
```
Qt 特有运行时日志关键字：`dlopen failed: library "libqohos.so" not found`（平台插件未部署）、`libQt5Core.so not found`、`Cannot load Qt platform plugin`、`module "QtQuick" is not installed`。

### 产出（下游交付）
- 真机运行中应用（进程存活 + 渲染非黑屏 + 生命周期/窗口/输入/平台限制回归全通过）
- hilog 运行日志
- 截图
- 静态预检报告（DT_NEEDED 裸名 + main GLOBAL DEFAULT + 插件部署清单，来自阶段四）

供阶段七测试验证。

### 注意事项/陷阱
来源：`qt-ohos-run-test` / `qt6-ohos-windows-app-dev-guide` / `qt6-cef-ohos-integration-guide`

- **中文路径陷阱**：setup.ps1 内部 Resolve-Path 对中文路径编码可能损坏，遇乱码须手动 Write 重写 build-profile.json5
- **hvigor 路径白名单**：hvigor 拒绝包含中文/特殊字符的工程路径，须复制到纯 ASCII 路径（如 `$env:TEMP\opencode`）
- **元教训**：不要信 KB 静态矩阵表（modules 页的"已适配"标记），必须 live-verify——默认 SDK 与全量 SDK 模块齐全度不同
- **元教训**：必须在部署前静态预检 DT_NEEDED/符号可见性，避免真机 dlopen 失败再回头查；Qt6 OHOS Windows 交叉编译产物要遍历 HAP 内全部 native .so（不只业务库）
- **元教训**：libqohos.so 的 NAPI setupQtApplicationImpl 在不同源码版本读字段名不同（5.12 读 modulesFactories，5.15 读 modules），SDK 的 libqohos 与 .ets 模板必须同源版本，否则启动即崩 `jscrash object has no property named 'modules'`
- **编译产出 HAP ≠ 能跑**，须真机验证（qView 用 QT5_15_OHOS_SDK + 5.12 模板能跑；误用 FULL SDK + 5.12 模板编译成功但运行崩）
- **Debug vs Release**：Q_ASSERT 在 Release 静默编译消失；首次端到端用 Debug 暴露断言，通过后补一轮 Release 回归
- **closeEvent L2 禁弹 UI**：弹对话框会卡在关闭流程被系统强杀
- **qApp->quit() 退出死锁**：Ability 销毁阶段不处理 NAPI TSFN 回调致 Promise 永不 resolve，~2min 不退出

### ⚠️ KB 未覆盖
- **Qt6 无统一 run+test 端到端工作流**（gap）：现有 `qt-ohos-run-test` 七阶段闭环基于 Qt5 SDK/模板，Qt6 的 run+test 验证分散在 `qt6-cef-ohos-integration-guide`（真机启动验证）、`qt6-ohos-qtmqtt-build`（broker 回环验证）等个案。`qt6-ohos-windows-app-dev-guide` 明确标注 hdc install/aa start/签名"未在本机端到端实跑（未连接设备）"为操作指引。**最小可行建议**：新建 `procedural/qt6-ohos-run-test.md`，镜像 `qt-ohos-run-test` 七阶段但改 Qt6 HAP 生成链（harmonydeployqt6 + hvigor-wrapper.bat + 手动 stage 三方 .so）。

---

## 阶段七：测试验证（test）

### 目标
从"应用能跑起来"推进到"核心功能全验证通过"：运行测试七阶段闭环 + 功能级 10 用例闭环。

### 前置（上游交付）
- 阶段六产出的真机运行中应用
- 应用源码可读
- 真机/模拟器可用

### 步骤

#### 7.1 运行测试七阶段闭环（qt-ohos-run-test）
来源：`qt-ohos-run-test`

| 阶段 | 内容 | 门控 |
|------|------|------|
| 一 环境/SDK 预检 | setup.ps1 替换占位符 + local.properties + 环境变量 + SDK 模块 live-verify | 阶段一未通过禁入二 |
| 二 构建 + 静态预检 | debug HAP 构建 + native 库完整性 + DT_NEEDED/main 符号静态预检 + QML/插件部署 | 静态预检未全通过禁安装真机 |
| 三 签名 + 安装 | build-profile signingConfig + bundleName 校验 + products[] 引用 + hdc install | hdc install 成功 |
| 四 启动 + 运行时验证 | aa start + 进程存活 + 三类黑屏区分 + 生命周期/窗口/输入/平台限制回归 | 全通过 |
| 五 崩溃日志分析 | JSCrash(TypeError)/SIGSEGV/SIGABRT/dlopen 失败分类 + 14 条 problem 速查表 | 根因定位 |
| 六 修复与回归 | 改源码→重构建→卸装+安装→启动验证→日志确认 | 原异常消除 + 未引入新问题 |
| 七 Playbook B Demo（可选） | 纯库项目编 Playbook A 风格 demo 链接静态库端到端验证 | — |

**门控铁律**：阶段一未通过退出条件前禁止进入阶段二；静态预检未全通过前禁止安装真机；运行时验证未全通过则进入阶段五崩溃分析。

> **时序说明**：上表阶段二（静态预检）→阶段三（签名+装机）→阶段四（启动+运行时验证）是 run-test 内部时序，预检先于装机。本页阶段六（deploy/run）的首次部署冒烟即对应上表阶段三+阶段四的首次执行；阶段七的正式闭环则按上表七阶段逐一门控重跑。

#### 7.2 功能级 10 用例闭环（qt-app-harmonyos-completion）
来源：`qt-app-harmonyos-completion`

**前置**：`qt-ohos-run-test` 七阶段全 pass（进程存活 + 渲染 + 生命周期 + 窗口 + 输入 + 平台限制回归）。

| 阶段 | 内容 | 门控 |
|------|------|------|
| 一 源码定位与核心功能点扫描 | 入口链梳理 + grep 识别 P0/P1/P2 功能点 + 平台相关 API 标注（15-20 项） | 未完成扫描禁生成用例 |
| 二 AI 生成 10 用例初稿 + 人工 review 固化 | 每用例含功能点/前置/操作步骤/预期/实际/状态 | 未固化禁人工测试 |
| 三 执行用例 + 判定 + 定位修复 + 回归 | hdc aa start + 人工交互 + 截图/hilog + 修复重构建回归 | 10 全 pass 闭合 |
| 四 测试报告 + 问题沉淀 + 闭合确认 | 表格 TC#/用例名/状态/修复次数/关联 problem | 10 全 ✅ |

**循环退出铁律**：10 核心用例必须全部 ✅pass（非 9/10），每个 fail 用例的修复须回归验证（非口头修复），flaky 用例须多次复现确认稳定 pass。

#### 7.3 构建失败/运行时错误排查四步法
来源：`qt-harmonyos-build-run-workflow` / `qt-ohos-project-analyzer-workflow`

```
Step A 知识库优先查询：检查 compile_fix_pro.md，存在则先搜已知方案
Step B 错误分类：预处理(#include not found) / 编译(error:/undefined reference) / 链接(undefined symbol/cannot find -l) / 打包(BUILD FAILED/hap/sign)
Step C 修复与重试：同一错误最多重试 3 次、每次必须用不同方案、超限立即停止向用户求助
Step D 修复沉淀：成功→记入 compile_fix_pro.md；失败→向用户提供错误信息+根因分析+N 种方案及失败原因
```

### 产出（下游交付）
- 测试报告（10 核心用例全 pass / 运行时验证七阶段全 pass / 对抗式验证通过）
- 问题沉淀（`problems/` 新条目用 `_templates/qt-problem.md` + 同步 `problems/_lookup.md` 索引）
- 修复回归结论

供阶段八上传/上库。

### 注意事项/陷阱
来源：`qt-ohos-run-test` / `qt-app-harmonyos-completion` / `qt-ohos-project-analyzer-workflow`

- **元教训**：修正一个文件 ≠ 修正一个知识点，沉淀前 grep 全引用点避免跨文件传播遗漏（本工作流页曾因逐文件修正模式 67% 遗漏）
- **知识库优先铁律**：遇问题第一步在 `compile_fix_pro.md` 搜匹配方案；跳过知识库直接分析=违规
- **平台隔离铁律**：OHOS 适配必须用条件分支隔离（`Q_OS_OHOS` / CMake `if(OHOS)` / qmake `ohos:{}`），禁止直接改通用逻辑
- **源头优先铁律**：只改源头（CMakeLists.txt/.pro/源码）不改生成物（build 目录 Makefile/中间产物）
- **门禁失败铁律**：编译产物缺失/HAP 未生成/安装失败/启动失败/Qt .so 缺失 → 禁止标记成功
- **双重交验协议**：只有 ✅(AI 日志审查)+✅(用户人工确认)才算通过；第一轮关键词（ERROR/FAILED/fatal/undefined reference/cannot find/No such file/BUILD FAILED/Install Failed/crash/SIGSEGV/SIGABRT）必须逐个搜索

### ⚠️ KB 未覆盖
- **§6.4 与 §7.1（run-test §4）内容重叠**：阶段六 §6.2-6.5 与本阶段 §7.1 表"阶段四 启动+运行时验证"均为运行时验证（进程存活/三类黑屏/生命周期/窗口/输入/平台限制回归）。边界：阶段六=首次部署冒烟（拿到"能跑起来"），阶段七 §7.1=带门控正式验证闭环。**最小可行建议**：首次部署用阶段六快速验证，问题排查/回归用阶段七闭环。
- test 阶段 `qt-ohos-run-test` §5 崩溃分析与 `qt-app-harmonyos-completion` §3.5 定位与修复存在 hilog 日志分析/崩溃定位知识重叠。边界已定义（run-test=能跑起来 / completion=功能正确），但交叉引用密集。**最小可行建议**：明确两者边界为"run-test §5 = 进程级崩溃（SIGSEGV/dlopen/JSCrash）" vs "completion §3.5 = 功能级失败（pass/fail/flaky）"。

---

## 阶段八：上传/上库（upload）

### 目标
把已验证的鸿蒙化应用/demo 源码发布到外部仓库或归档上库。

### 前置（上游交付）
- 阶段七产出的测试报告 + 问题沉淀 + 修复回归结论

> **交付对接路由**：completion §4 闭合确认（10 用例全 ✅）后进入本阶段。开源 Qt 应用走 §8.1；本月问题复现/验证 demo 走 §8.2。**面向最终用户/客户的客户应用分发（AppGallery/应用市场）无 KB 工作流承接**（见末尾 ⚠️）。

#### 8.0 人工审核门（必做，上传前）
来源：本流程新增（对齐 demo-generation 人工确认 gate + 双重交验协议）

> **铁律**：上传/上库前必须经人工审核 ✅，未经人工确认禁止 push/commit 上库。AI 不代劳最终发布决定——发布到外部仓库不可逆、可能被索引/缓存。

上传前必须人工逐项确认：

| 审核项 | 确认内容 | 命令/方法 |
|--------|---------|---------|
| 测试结论 | 阶段七测试报告：run-test 七阶段全 pass + completion 10 用例全 ✅ | 查测试报告 |
| HAP 有效性 | 签名 HAP 可装机可启动（fresh-clone 构建验证见 §8.1 step 11） | `hdc install` + `aa start` |
| 源码清洗 | 无签名密钥/绝对路径/产物/缓存泄露 | secret grep（`C:/Users`、`keyPassword`、`.p12`/`.p7b`/`.cer`、`.so`、`local.properties`、`/build/`）必空 |
| 公开安全 | 无个人路径/人名/token；公开页无私有内容 | 25 项门禁 §19/§20 |
| 截图/文档 | 运行截图 + README 齐全 | 人工核对 |

人工审核 ✅ 全通过 → 进入 §8.1（开源 fork）或 §8.2（demo 归档）。任一未通过 → 回阶段四/六/七修复，**禁止上库**。

### 步骤（按场景分路径）

#### 8.1 开源 fork 发布到 AtomGit ohos-qt 组织
来源：`fork-qt-app-to-ohos-qt-org`

把已鸿蒙化（场景二 OhosExampleApp 模式，已编出 unsigned HAP）的 Qt 开源应用 fork 上传到 AtomGit（= GitCode 改名），让外部 Qt 开发者伙伴能 clone 后自行构建。

12 步：
1. Fresh full clone 上游（不用 `--depth=1`）
2. 选择性覆盖 OHOS 文件（OhosExampleApp/ + HarmonyOS/ 各子集，不拷产物/缓存/local.properties/entry/libs/）
3. 清洗配置 4 处（根 build-profile.json5 覆盖为未签名模板；entry/build-profile.json5 模板化；PORT_RESULT.json hap_path 改相对路径；CMakeLists.txt 末尾追加自动拷 .so 片段）
4. .gitignore 合并（追加 OHOS 段；上游 `*.ts` 必加 `!HarmonyOS/**/*.ts` 否定；上游 `*build-*` 需加 `!HarmonyOS/build-profile.json5` 否定）
5. 新 README.md + 原文改名 `README_original.md`
6. setup 脚本（setup.ps1 + setup.sh，填 `<REPO_ROOT>`+`<YOUR_QT_OHOS_SDK>` 占位符）
7. 预提交验证（防泄密/防产物）：`git grep -nE 'C:\\Users|C:/Users|keyPassword|storePassword|\.p12|\.p7b|\.cer'` 必须空；`git ls-files | grep -E '\.(so|p12|p7b|cer)$|local\.properties|/build/'` 必须空
8. commit（不加 AI 署名）
9. AtomGit API 建组织仓（`Authorization: Bearer $TOKEN`）
10. push（token-in-URL + `-c credential.helper=` 禁用 GCM；force 用 `--force` 非 `--force-with-lease`）
11. fresh-clone 构建验证（清洁 + setup 填占位符 + hvigorw assembleHap 产 HAP）
12. 更新运行截图到 README（可选，运行验证后）

#### 8.2 Demo 源码 CleanCode 归档打包
来源：`demo-archive-cleancode-upload` / `qt-huawei-cleancode-rules`

把本月问题处理产生的复现/验证 demo 源码，汇总到归档文件夹，按华为 CleanCode（18 条规则）整理、保留复现逻辑、对抗式验证后，写 README 并打包 git commit 上库。

八步：
1. 定位本月问题 demo 源码（扫 WORKLOG.md + 交付目录）
2. 筛选 Qt 相关 .cpp/.h（排除构建产物/三方 vendored/非 Qt 原生）
3. 汇总到归档文件夹（同名文件用子目录隔离）
4. 按华为 CleanCode 整理（18 条规则：版权头/无魔数/行宽≤120/函数≤50行/嵌套≤4/花括号同行/控制流加花括号/一行一声明/C++ 转换/显式 lambda 捕获/命名/Qt5 函数指针信号槽/override+nullptr/tr()/include 顺序/头文件禁文件作用域 static/内联函数≤10 行）
5. **保留复现逻辑铁律**：不删除泄漏对象、不加遗漏 delete、不改连接语义、不改数值、保留根因注释、保留 `#include "main.moc"`、保留公开 API 不变
6. 对抗式验证（CleanCode + 复现逻辑保留 + 跨文件一致性，三维度）
7. 行数校准（可选）
8. README + 打包上库（`zip -r qt-demos-cleancode.zip qt-demos-cleancode` + `git commit`，无 AI 署名）

### 产出（下游交付）
- 已发布的 AtomGit ohos-qt 组织仓库（外部开发者可 clone 自行构建）
- CleanCode 归档 zip（demo 源码上库）
- 流程终点

### 注意事项/陷阱
来源：`fork-qt-app-to-ohos-qt-org` / `demo-archive-cleancode-upload`

- **铁律**：只提交源码/配置，绝不提交构建产物/缓存/二进制/密钥（~1MB 源码 vs ~430-500MB 产物）
- **教训1**：上游 `*.ts`（Qt 翻译文件）会误伤 DevEco 的 hvigorfile.ts → 加 `!HarmonyOS/**/*.ts` 否定
- **教训2/22**：签名密钥泄露——根 build-profile.json5 可能含真实 keyPassword/storePassword → 覆盖未签名模板；secret grep 必须双斜杠都查 `C:\\Users|C:/Users`
- **教训4**：git push 默认走 GCM GUI 弹窗，非交互环境挂死 → 必用 `git -c credential.helper= push 'https://oauth2:<token>@...'`
- **教训10**：bash setup.sh 必须 `cygpath -m` 转 C:/ 混合路径
- **教训16**：LFS pointer 文件陷阱——用真实文件覆盖 pointer + amend + 预提交 `git grep -l 'version https://git-lfs'`
- **CleanCode**：本地 clangd 会报 `QApplication file not found` / `Q_OBJECT unknown`——属环境噪声（无 Qt 头路径、未跑 moc），非代码缺陷；上库不要求可编译
- **行数校准**禁止用空行或废话注释凑数；低于目标只能补真实 helper/命名常量块

### ⚠️ KB 未覆盖
- **upload 阶段覆盖极薄**（gap）：仅 2 个工作流（开源 fork 发布 / demo 源码归档），无面向最终 HAP 分发（AppGallery/应用市场）或 Qt6 SDK/addon 模块发布给团队复用的工作流；completion 功能验证通过后无客户应用分发工作流承接。**最小可行建议**：新建 `procedural/hap-distribute-appgallery.md`（AppGallery 上架流程）和 `procedural/qt6-addon-publish.md`（addon 模块装进团队共享 kit 的发布流程）；在 completion §4 闭合确认后增加"交付对接"小节路由到本阶段（本页已在阶段八前置补"交付对接路由"提示）。

---

## 独立小节：三方库构建

> 首次引用见阶段一 §1.5（bottle 获取）/ 阶段三 §3.8（平台限制检查）/ 阶段四 §4.6（CMake 交叉编译集成）/ §4.7（Qt6 addon）。

来源：`qt-harmonyos-third-party-libs` / `fetch-ohos-third-party-lib`

平台 NDK、ABI、sysroot、构建和 HAP native 部署契约以 [[ohos-common-kb/semantic/ohos-native-third-party-libraries|common：OHOS 原生三方库接入契约]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/ohos-native-third-party-libraries.md)）为准。本流程只编排 Qt 消费动作：

1. 取得已经通过 common 产物检查的 headers、静态库或共享库及完整依赖闭包；
2. 在 Qt target 中通过 `find_package`/imported target 接入，不把 host metadata 混入交叉构建；
3. 检查 Qt runtime、QPA/plugin 与三方库是否一起进入最终 HAP；
4. 用 [[qt-harmonyos-third-party-libs]] 的 Qt 兼容清单和应用回归验证实际消费结果；
5. 平台限制失败路由到 common，Qt 症状和 workaround 路由到 [[qt-harmonyos-platform-limits]]。

预编译 bottle 获取仍见阶段一 §1.5；本节不再维护 CMake/autotools 的第二份平台交叉编译命令。

### Qt6 IoT addon（如 qtmqtt）
source-only 附加模块不在预构建安装器，但预构建 OHOS kit 带 `Qt6BuildInternalsConfig.cmake` 支持编译 addon。流程见阶段四 §4.7。QtMqtt 开源版 GPLv3（非 LGPL），闭源商业发行需买 Qt 商业许可或换 Paho.mqtt-c/mosquitto（EPL/EDL 不传染）。

---

## 独立小节：Demo 生成

> 适用场景判断见阶段三（迁移可行性预检）/ 阶段七（测试用例生成）；非 bug 复现场景（后者用 `framework-issue-analysis`）。

来源：`demo-generation`

### 适用场景
用户直接要求"写一个 demo"/"生成测试工程"等独立 demo 创建场景（非 bug 复现场景，后者用 `framework-issue-analysis`）。

### 六步闭环
1. **需求理解**：明确 demo 目标（功能验证/渲染效果/API 用法展示/性能测试）、核心功能、目标平台（桌面/OHOS）、Qt 版本、特殊要求
2. **技术设计**：Qt 模块选择、构建系统选择（桌面 qmake / 鸿蒙 CMake / 跨平台 CMake 统一）、工程结构、技术方案
3. **工程创建**：鸿蒙工程必须从 Qt 源码内置胶水模板创建（`<QT_SRC>/qtbase/src/harmonyos/templates`）。**⚠️陷阱**：源码树模板的 OhosExportModules.ts 是陈旧最小版，直接用必崩（缺所有 @ohos.* eager import，libqohos 启动时裸 eval "@ohos.deviceInfo" 会被 ArkTS 拒 → SIGABRT）。必做检查点：`strings <SDK>/plugins/platforms/libqohos.so | grep -E "^modules$|^modulesFactories$"` 定 API（modules=objects / modulesFactories=factories），用 qView-ohos 钦定完整版替换
4. **代码编写**：单文件优先、Qt 5.12 兼容 API、中文注释、文件头注释含用途/结构图/兼容版本/用法、有意义的视觉输出
5. **编译验证**：桌面 `qmake && mingw32-make.exe -j8`；鸿蒙 DevEco 或 hdc 命令行构建部署。编译失败查 `problems/_lookup.md`
6. **文档与知识沉淀**：README 可选但推荐；提交 `git commit`（消息格式 `<type>: <简述>`）；新发现沉淀到 `episodic/` 或 `problems/`

---

## 独立小节：Qt5→Qt6 迁移差异

> 首次引用见阶段二 §2.2 三策略决策 / 阶段三 §3.5-3.8（API 映射/窗口/生命周期/平台限制）/ 阶段四 §4.1-4.2（策略 B superbuild + patch）。

来源：`qt-harmonyos-qt6-status` / `qt515-vs-qt512-api-diff`

### Qt5→Qt6 OHOS 关键差异
- **CloseRootCause 私有化**：Qt6 在 `_p.h` 头文件为私有内部 API，Qt5 `QtOhosExtras::getCloseEventRootCause()` 公开 API 无法直接迁移，需等待公开 API 或 QtOhosExtras Qt6 版本
- **AppLocalDataLocation 破坏性变更**：Qt5 映射 filesDir，Qt6 映射 preferencesDir，迁移需注意路径差异
- **CMake 全面变更**：`find_package(Qt6 ...)`、`qt_add_executable`（非 `add_executable`，自动 MODULE .so + main GLOBAL DEFAULT + 生成 deployment-settings.json + bundle ets glue）、`qt_add_resources()`、`qt_add_qml_modules()`（去版本号前缀）
- **QML import 无版本号**：`import QtQuick` 非 `import QtQuick 2.15`
- **QRegExp 移除**：用 QRegularExpression 或 Qt5Compat forwarding header（多文件用 QRegExp 自身 API 时写 QRegExp 作 QRegularExpression 子类的 forwarding header，经 `-I` 前置于 Qt5Compat 的 `-isystem`）
- **C++ 最低标准 C++17**（Qt5 为 C++14）
- **main 动态可见性**：target 用 `CXX_VISIBILITY_PRESET hidden` 时 main 是 local symbol，`dlsym(main)` 失败，需加 `__attribute__((visibility("default")))`（策略 B）；策略 B' 用 `qt_add_executable` 自动 main GLOBAL DEFAULT 无需手写
- **DT_NEEDED 绝对路径**（仅策略 B）：Qt6 .so 无 SONAME + `-developer-build` imported target 以绝对路径参与链接 → 设备 dlopen 失败，用 `patch_needed.py` 改裸名
- **DBus 硬墙**：预构建不含 Qt6DBus，无条件 REQUIRED DBus 不可编译、不可 stub
- **C++23 天花板**：OHOS native clang 15.0.4 不实现 P0847R7（需 Clang 18.0+），libc++ 缺 ranges 适配器，需源码层降级（deducing-this→CRTP、ranges→手写循环）
- **8 个机械 fix**：setCodec→setEncoding、DataLocation→AppDataLocation、QPrinter paper→QPageSize 等

### Qt 5.15 vs 5.12 OHOS SDK API 差异（QtWidgets 模块）
来源：`qt515-vs-qt512-api-diff`

- **降级 5.15→5.12 🔴高风险**：QSystemTrayIcon/QFileDialog OHOS 专有 API、QTextBrowser::doSetSource、QCalendar 方法完全不存在，编译失败
- **升级 5.12→5.15 🟡低风险**：所有 5.12 API 均保留（可能废弃但仍可编译），约 50+ 产生废弃警告，QDirModel 应迁移到 QFileSystemModel
- 校验基准：Qt 5.15.16 (962aa625, 2026-04-19) vs Qt 5.12.12 (613336de, 2026-05-25)

---

## 铁律速查（执行任何任务前扫描）

> 本速查是端到端流程中的 Qt 导航快照，不是独立权威来源。规则正文与冲突裁决以 [[qt-harmonyos-golden-rules]] 为准；HarmonyOS 平台事实以 common 为准。

来源：`qt-harmonyos-golden-rules`（35 条，基于 Qt 5.12/5.15；Qt6 重大变更见 `qt-harmonyos-qt6-status`）

严重度图例：🔴 编译/部署阻断 | 🟠 静默失败 | 🟡 行为异常 | 🟢 信息/最佳实践

### 构建部署 B1-B12
- B1(🔴) CMake `find_package` 前必须设 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH`（默认 ONLY 阻止找 Qt/三方库）
- B2(🔴) 必须链接 `Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin`，否则 `dlopen failed: libqohos.so not found`
- B3(🔴) `APP_LIBRARY_NAME`（QtAppConstants.ets）必须与产物库名完全一致（含 lib 前缀和 .so 后缀）
- B4(🔴) 禁止设 `compileSdkVersion`/`targetSdkVersion`（Schema validate failed）
- B5(🟡) `runtimeOS` 必须设 `"HarmonyOS"` 非 `"OpenHarmony"`
- B6(🟡) QtOhosExtras 仅支持 qmake（`CONFIG -= create_cmake`），CMake 无 find_package；Qt6 模块不再独立存在
- B7(🟡) `libqohosstyle.so` 必须手动复制到 `libs/${ABI_DIR}/styles/`
- B8(🟡) 场景二 build-profile.json5 的 path 必须用绝对路径
- B9(🔴) qmake unix 分支必须加 `:!ohos`（`unix:!android:!macx:!ohos`）
- B10(🔴) QML 应用必须启用 `CMAKE_AUTORCC ON`，否则 qml.qrc 不编译运行时黑屏
- B11(🔴) bundleName 使用目标 SDK schema 接受的稳定点分标识，并与生成工程、签名 profile、安装/启动命令保持一致
- B12(🟠) `libqsqlite.so` 必须手动复制到 `libs/${ABI_DIR}/sqldrivers/`（OHOS 文件名是 libqsqlite.so 非桌面 libqsqlsqlite.so）；漏部署则 `addDatabase("QSQLITE")` driver 为 null，`open()` 返回 false，`lastError="Driver not loaded"`

### 窗口管理 W1-W6
- W1(🟡) `tagWindowOrWidgetAsSubWindowOf()` 必须在 `show()` 和 `winId()` 之前调用
- W2(🟢) 首个 QWindow/QWidget 自动绑定系统主窗口无需 tagging
- W3(🟡) 无 parent 的 QDialog 会被视为新主窗口必须 tagging 或传 parent
- W4(🟡) 首窗口不能启动直接全屏，必须先 `show()` 再 `showFullScreen()`
- W5(🟡) 主窗口 `hide()` 回退为最小化（无系统托盘时）
- W6(🟠) 不要依赖 WINDOW_HIDDEN/WINDOW_SHOWN 事件作为状态同步唯一触发源（文件加速/预加载场景下不触发）

### API 名称与枚举路径 A1-A6
- A1(🟠) 关闭事件枚举必须用完整路径 `QtOhosExtras::CloseEventRootCause::AbilityClose`（enum class 短路径编译不过）；Qt6 枚举重命名 CloseRootCause 且已私有化
- A2(🟠) 主题枚举必须完整路径 `QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting`
- A3(🟠) UI 信号在 QOhosUiAbilityContext 上（非 QOhosAbilityContext）
- A4(🟢) 工厂方法在 QOhosAbilityContext 上：`getDefaultInstance()`/`getInstanceForMainWindow()`
- A5(🟠) qtohosextras 头文件只有小写，`#include` 必须小写 `<QtOhosExtras/qohosappcontext.h>`（不安装 CamelCase 转发头）
- A6(🟠) `getCloseEventRootCause()` 是自由函数 `QtOhosExtras::getCloseEventRootCause(event)`（非成员方法）；Qt6 已私有化

### 平台限制 P1-P5
- 平台限制内容不在本速查复制；先读 [[ohos-common-kb/semantic/harmonyos-platform-limits|common 平台限制]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）。
- P1-P5 在本流程中的含义仅是：检查 `QFile`/`QStandardPaths`、`QPluginLoader`、Qt worker cancellation 与 `QTimeZone` adapter，并把结果记录到 Qt 应用回归。

### 生命周期 L1-L4
- L1(🟠) closeEvent 必须检查 CloseEventRootCause；Level 2（AbilityClose）绝对不能弹 UI
- L2(🟢) argv[0] 是库路径（.so），不是可执行文件路径
- L3(🟢) Qt for HarmonyOS 使用 Stage 模型，FA 模型自 API 9 已弃用
- L4(🟢) 子进程按场景选不一刀切（无界面 QProcess / 有界面 Qt startAppProcess / 有界面非 Qt startAbility / 无界面需托管 startNoUiChildProcess）

### 跨平台守卫 G1-G2
- G1(🟢) `Q_OS_OHOS` 隐含 `Q_OS_LINUX`，`#ifdef Q_OS_LINUX` 在鸿蒙上也会命中
- G2(🟢) 拖放事件数据只能在 dropEvent 中读取

---

## 供应链视图

```
上游对接人                      本流程                          下游交付件
─────────────────────────────────────────────────────────────────────────────────
Qt Project Gerrit           ┐
(codereview.qt-project.org) │ 阶段一 下载/获取              → Qt 源码树 / 预构建 kit
华为官方 IDE/SDK            │   阶段二 环境准备            → 工程骨架 + Kit 配置
Harmonybrew 社区仓库        ┘   阶段三 迁移适配              → 已适配源码
                              │ 阶段四 编译构建              → 未签名 HAP + 业务 .so + 静态预检报告
商业 Qt 客户                  │   阶段五 签名                → 签名 HAP
（鸿蒙化迁移需求）            │   阶段六 部署运行            → 真机运行中应用 + 日志
内部宣传 demo 需求           │   阶段七 测试验证            → 测试报告 + 问题沉淀
自驱动（评估新场景）          │   阶段八 上传/上库           → AtomGit 仓库 / CleanCode zip
                              │   独立小节：三方库/demo/Qt5→6
                              ┘
```

**端到端交付链**：
- 阶段一 → 阶段四：交付 Qt 源码树/预构建 SDK + 三方库 .so + DevEco SDK，供 compile 配置 CMAKE_PREFIX_PATH/CMAKE_TOOLCHAIN_FILE/QT_CHAINLOAD_TOOLCHAIN_FILE
- 阶段四 → 阶段五：交付未签名 HAP + 业务 .so + harmony-deployment-settings.json + 静态预检报告，供签名（静态预检报告同时作为阶段六装机前置门控）
- 阶段五 → 阶段六：交付签名 HAP，.p7b Profile 绑定的 bundleName 已校验，products[] 已引用 signingConfig，供 hdc install 装机
- 阶段六 → 阶段七：交付真机运行中应用 + hilog + 截图 + 静态预检报告，供功能验证与崩溃分析
- 阶段七 → 阶段八：交付测试报告 + 问题沉淀 + 修复回归结论，供发布或归档
- 阶段八 → 终点：交付已发布的 AtomGit ohos-qt 组织仓库或 CleanCode 归档 zip

---

## 源工作流清单

本页缝合的源文件（KB 相对路径）：

**Procedural（13）**：
- `procedural/qt-app-harmonyos-migration.md` — Qt 应用鸿蒙化迁移（主工作流）
- `procedural/qt6-ohos-windows-build.md` — Qt 6.12 for OHOS Windows 构建（Superbuild）
- `procedural/qt6-qtcreator-harmonyos-setup.md` — Qt Creator 配置 Qt 6.12 鸿蒙开发环境
- `procedural/qt6-ohos-windows-app-dev-guide.md` — Windows Qt6.12 预构建端到端 CLI 开发指南
- `procedural/qt6-ohos-qtmqtt-build.md` — Qt6.12 qtmqtt addon 鸿蒙交叉编译
- `procedural/qt6-cef-ohos-integration-guide.md` — Qt6 + CEF 鸿蒙集成（12 步迁移）
- `procedural/fetch-ohos-third-party-lib.md` — 从 Harmonybrew 获取 arm64-OpenHarmony 三方库预编译包
- `procedural/qt-ohos-concrete-build-recipe.md` — Qt→OHOS 落地编译配方（Playbook A/B）
- `procedural/qt-ohos-run-test.md` — 鸿蒙化运行测试工作流（七阶段闭环）
- `procedural/qt-app-harmonyos-completion.md` — 应用鸿蒙化完善（功能级测试用例闭环）
- `procedural/demo-generation.md` — Demo 生成工作流（六步闭环）
- `procedural/demo-archive-cleancode-upload.md` — Demo 上库归档工作流（八步闭环）
- `procedural/fork-qt-app-to-ohos-qt-org.md` — Fork 鸿蒙化 Qt 应用到 AtomGit ohos-qt 组织

**Semantic（23）**：
- `semantic/qt-harmonyos-overview.md` — Qt for HarmonyOS 总览
- `semantic/qt-harmonyos-build.md` — Qt for HarmonyOS 构建指南
- `semantic/qt-harmonyos-build-run-workflow.md` — Qt 鸿蒙编译运行全流程
- `semantic/qt-harmonyos-project-structure.md` — Qt 鸿蒙工程结构详解
- `semantic/qt-harmonyos-qt6-status.md` — Qt6 鸿蒙化状态
- `semantic/qt-harmonyos-modules.md` — Qt 鸿蒙模块适配状态速查
- `semantic/qt-harmonyos-platform-limits.md` — Qt 鸿蒙平台限制
- `semantic/qt-harmonyos-api-mapping.md` — API 迁移映射表
- `semantic/qt-harmonyos-code-patterns.md` — 移植代码模式速查
- `semantic/qt-harmonyos-porting-workflow.md` — Qt 鸿蒙移植 8 步决策树工作流
- `semantic/qt-harmonyos-third-party-libs.md` — 三方库鸿蒙化指南
- `semantic/qt-ohos-extras.md` — QtOhosExtras 模块（145+ API）
- `semantic/qt-ohos-extras-examples.md` — QtOhosExtras 官方示例菜谱
- `semantic/qt-harmonyos-window-model.md` — Qt 鸿蒙窗口模型详解
- `semantic/qt-harmonyos-lifecycle.md` — Qt 鸿蒙应用生命周期详解
- `semantic/qt-harmonyos-api.md` — Qt 鸿蒙 API 兼容性
- `semantic/qt-ohos-project-analyzer-workflow.md` — Qt-OHOS 项目分析器工作流
- `semantic/qt-harmonyos-golden-rules.md` — Qt 鸿蒙铁律速查（35 条）
- `semantic/qt515-vs-qt512-api-diff.md` — Qt 5.15 vs 5.12 OHOS SDK API 差异
- `semantic/qt-harmonyos-accessibility.md` — Qt for HarmonyOS 无障碍桥与 Want 参数启用
- `semantic/qt-harmonyos-system-tray.md` — Qt 鸿蒙系统托盘
- `semantic/qt-ohos-js-thread-gateway.md` — Qt↔JS 线程桥接
- `semantic/qt-huawei-cleancode-rules.md` — 华为 Qt CleanCode 规范（18 条）
- [[ohos-common-kb/procedural/deveco-cli-usage-rules|DevEco CLI 使用规则]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/deveco-cli-usage-rules.md)）
- [[ohos-common-kb/semantic/harmonyos-development-fundamentals|HarmonyOS 开发基础]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-development-fundamentals.md)）

---

## ⚠️ KB 未覆盖汇总

| 缺口 | 位置 | 状态 / 最小可行建议 |
|------|------|-------------|
| download 侧命令行密度不对称（B' 仅描述性无 CLI） | 阶段一 §1.3 | ⚠️ 仍存；补 `maintenance-tool.exe --install` CLI 或记录勾选清单截图归档（当前勾选清单即操作替代） |
| 无统一环境准备检查清单页 | 阶段二 | ⚠️ 仍存；以本页 §2.1 + §2.4 为基线，新建 `procedural/env-checklist.md` 汇总 Qt5/Qt6/策略 B/B' 环境检查表 |
| DEVECO_SDK_HOME 三 shell 形式源级不一致 | 阶段二 §2.1 | 已标注 ⚠️ 并建议优先 `<DEVECO>/sdk`（bash/PS 一致），以 `hvigorw --sync` 能否解析 SDK 为准 |
| Qt6 B' 模板来源缺失 | 阶段二 §2.4 | 已补：B' 模板在 `<QT6_OHOS_KIT>/src/harmonyos/templates`，由 harmonydeployqt6 自动拷贝，无需手动 cp |
| migration 无统一命名工作流页 | 阶段三 | 本阶段即为缝合后的统一迁移参考 |
| §3.1 嵌套阶段号冲突 | 阶段三 §3.1 | 已修：去掉内部"阶段零/一"命名，统一 §3.x 编号；补 ②③⑦ ls/grep 扫描命令 |
| §3.9 qmake 部分未标 Qt5 专属 | 阶段三 §3.9 | 已补"qmake（Qt5 专属）"标注 |
| compile 无统一编译配方索引页 | 阶段四 | 以 §4.1-4.8 为索引表按 (Qt5/Qt6)×(Playbook A/B)×(策略 B/B') 三维查表 |
| §4.1 硬编码个人绝对路径 + EGL 留 `...` | 阶段四 §4.1 | 已修：占位符化 + EGL 按 GLESv2 同 sysroot 模式填入 |
| §4.6 顺序割裂叙事 | 阶段四 | 已修：patch 节紧接 §4.1 superbuild 重排为 §4.2，原 §4.2-4.5 顺延为 §4.3-4.6 |
| 静态预检报告归属矛盾 + 时序倒置 | 阶段四→六 | 已修：阶段四产出显式列静态预检报告 + 时序澄清 callout；阶段六前置改为引用阶段四产出，明确 run-test §2 先于 §3 装机 |
| §6.4 与 §7.1（run-test §4）内容重叠 | 阶段六/七 | 已标注边界：阶段六=首次部署冒烟，阶段七 §7.1=带门控正式验证闭环 |
| Qt6 变体两种 CMake 模式混用风险 | 阶段四 | 策略 B（§4.1-4.2）用 `add_library`+手写 visibility，策略 B'（§4.3-4.4）用 `qt_add_executable`，禁止跨策略混用 |
| sign 无统一签名工作流页 | 阶段五 | 本阶段合并 4 种方法为统一参考；方法一菜单导航 + 方法三 sign 子参数 + 加密串生成仍 ⚠️ 源级截断 |
| 签名材料获取前置未显式化 | 阶段五 | 已补前置：材料生成依赖 DevEco Auto Signing（方法一）首次运行 |
| deploy 无命名阶段 | 阶段六 | 本阶段合并 deploy+run |
| Qt6 无统一 run+test 端到端工作流 | 阶段六/七 | ⚠️ 仍存；新建 `procedural/qt6-ohos-run-test.md` 镜像 `qt-ohos-run-test` 七阶段但改 Qt6 HAP 生成链 |
| test run-test §5 与 completion §3.5 知识重叠 | 阶段七 | 明确边界：run-test §5=进程级崩溃 / completion §3.5=功能级失败 |
| upload 仅 2 工作流覆盖极薄 + test→upload 通用场景断裂 | 阶段八 | ⚠️ 仍存；新建 `procedural/hap-distribute-appgallery.md` + `procedural/qt6-addon-publish.md`；completion §4 闭合后增加"交付对接"路由（本页已在阶段八前置补提示） |

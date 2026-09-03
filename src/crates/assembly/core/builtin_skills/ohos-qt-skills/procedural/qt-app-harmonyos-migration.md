---
id: procedural-qt-app-harmonyos-migration
type: procedural
domain: workflow
tags: [workflow, qt, harmonyos, porting, migration, ohos]
created: 2026-06-02
updated: 2026-07-21
status: active
audience: public
refs: [semantic-qt-harmonyos-api-mapping,semantic-qt-harmonyos-build-run-workflow,semantic-qt-harmonyos-code-patterns,semantic-qt-harmonyos-lifecycle,semantic-qt-harmonyos-porting-workflow,semantic-qt-harmonyos-project-structure,semantic-qt-harmonyos-window-model,procedural-fetch-qt-ohos-sdk]
summary: >
  Qt应用鸿蒙化迁移工作流：评估可行性→创建工程结构→按8步决策树逐步迁移→编译验证→知识积累。
  将其他平台的Qt应用迁移到HarmonyOS平台的端到端流程。
---

# Qt 应用鸿蒙化迁移

> 将其他平台（Windows/Linux/macOS/Android/iOS）的 Qt 应用迁移到 HarmonyOS 平台的端到端流程。

---

## 触发条件

- 收到新的 Qt 应用鸿蒙化迁移任务
- 需要将已有 Qt 项目移植到鸿蒙平台
- 评估某个 Qt 应用的鸿蒙化可行性

---

## 阶段零：预检（Pre-flight）

> 进入阶段一前，用 grep/源码扫描做 7 项预检。预检的目的是**在写任何 CMake 之前**就把"必然失败的项目"拦下、把"Qt5/Qt6 路径"选对、把"应用/库 Playbook"定下来。
> 三批次实战（10apps / rows 300-399 / rows 400-499，共 207 应用）证明：缺预检会让 agent 在 Qt6 代码上浪费 3-4 次编译 attempt（canonic、B23Downloader）。

| 预检项 | 方法（grep/扫描） | 判定 |
|--------|-------------------|------|
| **Qt 版本（按代码非声明）** | grep Qt6-only C++ API：`QList::emplace_back`/`push_back`、`std::as_const`、`QVariant::toModelIndex`、`QQuickRenderControl::beginFrame`/`endFrame`、`QEvent::isInputEvent`、Qt6 ctor 签名、`std::ranges`/`std::views` | 命中→**Qt6 代码**（即使 `.pro`/`QT +=` 标 Qt5）|
| **Qt SDK 选型** | Qt5.15.16（现成、无补丁）vs Qt6 6.12 superbuild（MinGW host + API 23，无需源码补丁；部署前仍需 `patch_needed.py` + main 可见性，见 §1.6）| Qt5 优先；Qt6-only 项目走 Qt6（非不可行，见 §1.6）|
| **模块可用性** | 对照 [[qt-harmonyos-modules]] 矩阵：Qt5 SDK 缺 Multimedia/D-Bus/WebEngine/Charts/SerialBus/QuickControls2/Quick3D/WebSockets/UiTools/SvgWidgets/Core5Compat；Qt6 dev 仅 qtbase + 子模块集 | 命中缺失且不可弃→blocked |
| **项目类型** | grep `int main(` → application/example（Playbook A）；无 → library/plugin/header-only（B）；**source-only 无构建文件**看 `.cpp`/`.h` 存在（QtCustomControls 教训）| 决定 Playbook（见 §1.0a）|
| **平台绑定** | grep `X11`/`xcb`/`windows.h`/`HWND`/`WM_`/`QDBus`/`Cocoa` 是否为**核心功能**（非可选分支）| 核心绑定→infeasible（如 QHotkey/Qt-Nice-Frameless-Window）|
| **foreach 用法** | grep `foreach(`/`Q_FOREACH` | 用了→**OMIT** `QT_NO_FOREACH`（定义会编译失败）|
| **三方依赖** | bundled（仓内）vs system；交叉编译可行性：header-only=ok、纯 C 小库=maybe、FFmpeg/Skia/Boost/OpenCV/PCL=no | 系统重型库→blocked 或单独交叉编译 |

**输出**：预检报告（Qt 版本 + SDK 选型 + Playbook + 模块缺口 + 平台绑定 + foreach + 三方依赖），决定是否进入阶段一。

### ⚠️ 陷阱：Qt5 声明但实为 Qt6 代码

两批次实战翻车案例：
- **canonic**（rows 400-499, row 405）：`.pro` 用 Qt5 语法、xlsx 标 Qt5，但 C++ 全用 Qt6-only API（`beginFrame/endFrame`、`QEvent::isInputEvent`、Qt6 `QHoverEvent`/`QQmlListProperty` ctor）→ 3 次编译 attempt 逐层剥开才确认，还缺 Quick3D/QuickControls2/WebSockets 三模块。
- **B23Downloader**（rows 300-399, row 394）：`.pro` 标 Qt5 但用 `QList::emplace_back`（Qt6 API）→ 4 次重试。

**规则**：Qt 版本按**代码实际 API** 判定，不按 `.pro`/`QT +=`/xlsx 声明。grep 清单见上表第 1 行。`.pro` 标 Qt5 只说明作者**打算**用 Qt5，不保证代码没混入 Qt6 API（常见于"从 Qt5 迁到 Qt6 后又回退声明"或"用 Qt6 头文件但 .pro 写 Qt5"）。

---

## 阶段一：评估与准备

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段一完成：可行性评估已通过，项目目录和工程已创建`

### 1.1 可行性评估

| 评估项 | 检查内容 | 参考 |
|--------|----------|------|
| Qt 版本 | 应用使用的 Qt 版本（5.12 / 5.15） | [[qt-harmonyos-modules]] |
| 模块依赖 | 检查使用的 Qt 模块是否在鸿蒙支持 | [[qt-harmonyos-modules]] |
| 平台 API | 是否有深度平台绑定（如 D-Bus, Win32 API） | [[qt-harmonyos-api-mapping]] |
| UI 复杂度 | 窗口数量、模态对话框、全屏需求 | [[qt-harmonyos-window-model]] |
| 子进程 | 是否依赖 QProcess 或 system() | [[qt-harmonyos-api-mapping]] 第1节 |
| 三方库 | 是否依赖需要交叉编译的 C/C++ 库 | [[qt-harmonyos-third-party-libs]] |

**输出**：可行性报告（可迁移 / 有风险项 / 不可迁移）

> **💡 三方库预编译捷径**：若依赖的 C/C++ 三方库在 Harmonybrew 已有 arm64_ohos 预编译 bottle，可一键下载 .so 免交叉编译——见 [[fetch-ohos-third-party-lib]]。无 bottle 时再走下方源码交叉编译路径。

> **🎮 Playbook 选择**（阶段零已定项目类型，此处落实）
>
> | 项目类型 | Playbook | 产物 | 构建方式 |
> |----------|----------|------|----------|
> | application / example（有 `int main()`） | **A** | `entry-default-unsigned.hap` | `hvigorw assembleHap` + OhosExampleApp + HarmonyOS 模板 |
> | library / plugin / header-only（无 main） | **B** | `libOhos<Slug>.a`/`.so` | `cmake + ninja + ohos.toolchain.cmake` + ohos-build |
>
> **Qt5/Qt6 是正交轴**：A/B 均可配 Qt5（现成 SDK，无补丁）或 Qt6（6.12 superbuild，无需源码补丁；部署前 NEEDED/main 处理，见 §1.6）。阶段零已选好 SDK，此处只定 A/B。

### 1.2 创建项目目录

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段一进行中：项目目录已创建，模板解压中`

**每个迁移项目在 `${PROJECTS_ROOT}` 下独立建文件夹**（路径见 `ENV.md`）：

```bash
# 创建项目目录（以原始应用名 + -ohos 命名）
mkdir -p "<MIGRATION_PROJECT_ROOT>/<app-name>-ohos"
```

**目录命名规范**：
- 格式：`<原始应用名>-ohos`（如 `calculator-ohos`、`notepad-ohos`）
- 全部小写，空格替换为短横线
- 项目文件夹内即为完整的鸿蒙工程结构

### 1.3 准备工程结构（复制源码内置胶水模板）

> **⚠️ 核心原则：鸿蒙工程必须从 Qt 源码内置的胶水代码模板复制生成，禁止手动创建目录结构。**
> 模板包含完整的 ArkTS 胶水代码、build-profile 配置、qEmbeddedUiExtensionHost 模块等，
> 手动创建极易遗漏关键文件或配置错误。
>
> 新版 Qt 鸿蒙分支已将胶水模板**内置于源码树** `qtbase/src/harmonyos/templates`，
> 无需再从 Gerrit 下载 ZIP（旧 ZIP 方式已退役为备用）。

#### 前置检查：Qt OHOS SDK 与模板是否就绪

进入本步骤前，先确认本地是否有 **Qt OHOS SDK**（`CMAKE_PREFIX_PATH` 要指向它）和 **模板工程**：

| 产物 | 检测方法 | 有 → 正常路径 | 无 → 下载路径 |
|------|---------|-------------|--------------|
| **Qt OHOS SDK** | 检查 `ENV.local.md` 的 `QT5_12_OHOS_SDK` / `QT5_15_OHOS_SDK` 路径是否存在且有 `lib/cmake/Qt5/Qt5Config.cmake` | 直接用于 `CMAKE_PREFIX_PATH` | 走 [[fetch-qt-ohos-sdk]] 直接 HTTP 下载预编译 SDK |
| **鸿蒙工程模板** | 检查 Qt 源码树 `<QT_SRC>/qtbase/src/harmonyos/templates` 是否存在 | 从源码树复制（见下方） | 走 [[fetch-qt-ohos-sdk]] 下载 `templates-0625.zip` |

> **无 Qt 源码 / 无预编译 SDK 时的快速路径**：从 GitCode releases 直接 HTTP 下载预编译 Qt OHOS SDK（Win/Mac/HarmonyOS 三平台）和模板归档，无需 git clone 源码、无需本地编译。详见 [[fetch-qt-ohos-sdk]]。
>
> 下载链接（Qt 5.12.12, GLES, arm64-v8a）：
> - Windows: `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip`
> - macOS: `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-macos-gles.zip`
> - HarmonyOS: `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-harmonyos-gles.zip`
> - 模板: `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/templates-0625.zip`
>
> ⚠️ GitCode 要求请求带浏览器 User-Agent，否则返回 401。curl 加 `-A "Mozilla/5.0"`，PowerShell 加 `-Headers @{ "User-Agent" = "Mozilla/5.0" }`。详见 [[fetch-qt-ohos-sdk]] §下载注意事项。

**获取模板**（模板路径见 `ENV.md` 的 `OHOS_TEMPLATE_SRC`，即 `<QT_SRC>/qtbase/src/harmonyos/templates`），复制到项目目录 `${PROJECTS_ROOT}/<app-name>-ohos/`：

```bash
# 从 Qt 源码树复制内置模板到项目目录（推荐，5.15 / 5.12 源码树内均有，内容相同）
cp -r <QT5_15_SRC>/qtbase/src/harmonyos/templates/. "${PROJECTS_ROOT}/<app-name>-ohos/"
# Qt 5.12 对应：<QT5_12_SRC>/qtbase/src/harmonyos/templates
```

**无 Qt 源码时**（如仅使用预编译 SDK 或鸿蒙 PC）：下载独立模板归档到 BitFun 用户级共享资源目录，然后复制：
```bash
bash skills/kb-init/scripts/download-template.sh
# 使用脚本输出的 OHOS_TEMPLATE_SRC
cp -r "${OHOS_TEMPLATE_SRC}/." "${PROJECTS_ROOT}/<app-name>-ohos/"
```
> 如需同时下载 Qt OHOS 预编译 SDK，详见 [[fetch-qt-ohos-sdk]]。

**解压后得到的工程结构**（场景一：从零创建）：

```
<解压后的工程根目录>/
├── entry/
│   ├── src/main/
│   │   ├── cpp/                      # ★ 在此编写 Qt C++ 代码和 CMakeLists.txt
│   │   └── ets/
│   │       ├── entryability/         # ArkTS 胶水代码（模板已生成，勿动）
│   │       ├── pages/                # ArkTS 页面
│   │       └── common/
│   │           └── QtAppConstants.ets # ★ 配置 APP_LIBRARY_NAME
│   ├── build-profile.json5           # 模块级构建配置
│   └── libs/arm64-v8a/               # Qt 运行时库（需填充）
├── qEmbeddedUiExtensionHost/         # 跨进程嵌入模块（模板已生成）
├── build-profile.json5               # 项目级构建配置
├── AppScope/app.json5                # 应用包名 bundleName
└── local.properties                  # SDK 路径
```

**解压后还需要做的事情**：
1. 在 `entry/src/main/cpp/` 中编写 Qt C++ 源码和 `CMakeLists.txt`
2. 配置 `QtAppConstants.ets` 的 `APP_LIBRARY_NAME`（必须与编译产物库名一致）
3. 配置 `entry/build-profile.json5` 的 `CMAKE_PREFIX_PATH`（指向 Qt SDK）
4. 将 Qt 运行时库（`libqohos.so` 等）填充到 `entry/libs/arm64-v8a/`
5. 手动复制 `libqohosstyle.so` 到 `libs/arm64-v8a/styles/`
6. 修改应用显示名称（`app_name` + `QAbility_label`，见 §1.4）

**场景二（已有工程鸿蒙化）**：将解压后的模板放入 `HarmonyOS/` 子目录，`entry/build-profile.json5` 的 `path` 用**绝对路径**指向根目录 CMakeLists.txt。

> 详细目录结构和配置说明见 [[qt-harmonyos-project-structure]]。

### 1.4 修改应用显示名称

> **⚠️ 必做**：模板默认显示名是占位值（`app_name`=`ohosQtTemplate`、`QAbility_label`=`label`），不改的话桌面图标和任务管理器会显示 "label" / "ohosQtTemplate" 而非实际应用名。

鸿蒙的显示名通过资源引用配置——`app.json5` / `module.json5` 的 `label` 字段写的是 `$string:<资源名>`，实际显示文本在 `string.json` 的 `value` 里。**改 value，不要改引用**。需改两处资源：

| 资源名 | 模板默认 value | 文件 | 作用 |
|--------|---------------|------|------|
| `app_name` | `ohosQtTemplate` | `AppScope/resources/base/element/string.json` | 桌面图标下的应用名 |
| `QAbility_label` | `label` | `entry/src/main/resources/{base,en_US,zh_CN}/element/string.json` | 任务管理器/最近任务里的 Ability 名 |

把两个资源的 `value` 改为实际应用名（如 `Calculator`）。三个语言目录（`base` / `en_US` / `zh_CN`）的 `QAbility_label` 都要改保持一致；`zh_CN` 可填中文应用名。

```json5
// AppScope/resources/base/element/string.json
{ "string": [ { "name": "app_name", "value": "<应用名>" } ] }

// entry/src/main/resources/base/element/string.json（en_US 同结构，zh_CN 可用中文）
{
  "string": [
    { "name": "module_desc", "value": "module description" },
    { "name": "QAbility_desc", "value": "description" },
    { "name": "QAbility_label", "value": "<应用名>" }
  ]
}
```

> **不要**直接改 `app.json5` / `module.json5` 里 `"label": "$string:..."` 的引用——鸿蒙规范要求 label 通过资源引用，只改 `string.json` 的 `value` 即可。

### 1.5 关键 CMake 配置

```cmake
# 1. 交叉编译搜索路径
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)

# 2. 链接 Qt 模块
find_package(Qt5 REQUIRED COMPONENTS Core Gui Widgets)

# 3. 生成共享库（鸿蒙要求）
add_library(myapp SHARED ${SOURCES})

# 4. 链接 QPA 插件
target_link_libraries(myapp PRIVATE Qt5::QOhosPlatformIntegrationPlugin)
```

---

### 1.6 Qt6 OHOS 特有注意事项

> 仅当阶段零选了 **Qt6 SDK** 时适用。Qt5.15.16 SDK 现成无补丁，跳过本节。
> 2026-07-13 验证 Qt 6.12.0 superbuild 在 Windows + MinGW host + OHOS Clang target + API 23 可编译、gallery 真机通过，无需源码补丁；Qt6 SDK 使用有 8 个已知坑。详见 [[qt-harmonyos-qt6-status]]。

**Qt6 SDK 构建前提**（Qt 6.12.0 superbuild）：

| 项 | 要求 |
|----|------|
| 版本/路径 | Qt **6.12.0**（`c7581743`）superbuild（`qt5/configure.bat -submodules qtbase,qtsvg,qtimageformats,qtshadertools,qtlanguageserver,qtdeclarative`），无需源码补丁。 |
| Host 编译器 | MinGW g++ 13.1.0（Qt SDK 自带）。**不用 llvm-mingw clang 22**（NTSYSCALLAPI 重声明、D3D12MemAlloc `-Werror` 等兼容问题） |
| Windows 额外配置 | wiki 仅 macOS 指令；Windows 需手补 7 个 CMake 变量（`NodeAddonApi_INCLUDE_DIR` + `EGL`/`GLESv2`/`Fontconfig` 的 `_INCLUDE_DIR` + `_LIBRARY`）+ `DEVECO_SDK_HOME` + `JAVA_HOME` 环境变量 |
| 运行时必做 | 部署设备前：DT_NEEDED 改裸名 + `main` 加 `visibility("default")`（见下方「运行时两道必须检查」） |

> 原 dev 分支 + 6 补丁 + 6.12 BLOCKER 路径已弃用（BLOCKER 在 superbuild + MinGW g++ + API 23 下已绕过，三变量未逐一隔离，见 [build-fail-qt6-libcpp-musl-isystem]）。

**Qt6 OHOS 运行时两道必须检查**（不检则设备崩溃）：

1. **DT_NEEDED 绝对 Windows 路径** → 设备 `dlopen` 失败。Qt6 `.so` 无 SONAME + Windows 交叉编译 imported target 以绝对路径参与链接 → `DT_NEEDED` 记录绝对 Windows 路径（如 `<Qt6-build-dir>/libQt6Widgets.so`）。**必须用 `patch_needed.py` 把所有 `.so`（业务库 + Qt 库自身）的 NEEDED 改裸名**。打包后用 `llvm-readelf -d` 检查 HAP 内全部 native `.so` 无绝对路径。
2. **`main` 必须 `GLOBAL DEFAULT`** → 否则 `dlsym("main")` 失败。Qt6 OHOS 胶水通过 `dlsym("main")` 找入口，只查动态符号表。若 target 用 `CXX_VISIBILITY_PRESET hidden`，源码里的 `main` 是 local 不可见。**解决**：给 `main` 加 `__attribute__((visibility("default")))`（仅 OHOS 下，不改整个 target 的隐藏策略）。用 `llvm-readelf --dyn-syms` 验证 `main` 为 `GLOBAL DEFAULT`。

**其他 Qt6 OHOS 坑**：

| 坑 | 表现 | 解决 |
|----|------|------|
| C++20 ranges/libc++ 缺口 | `std::ranges::find`/`std::views::reverse`/`std::views::cache_latest`/`std::string_view <=>` 编译失败 | 局部替换为 `std::find_if`/反向迭代器/手写 `std::strong_ordering`；`Utils::views::cache_latest` 降级 no-op |
| CMake 不识 OHOS 平台 | `CMAKE_LINK_LIBRARY_USING_WHOLE_ARCHIVE` 未初始化（静态插件导入报链接特性不支持）| 显式定义 `CMAKE_LINK_LIBRARY_USING_WHOLE_ARCHIVE` + C/CXX supported 标志 |
| 资源部署 | `share/xxx` 运行时数据（如 Qt Creator 的 themes/fonts）放 `entry/libs/` 被 Hvigor 过滤；放 `rawfile/` 设备找不到 | 放 `entry/src/main/resources/resfile/share/xxx`；应用经 `QOhosAppContext::resourceDir()+"/share/xxx"` 定位 |
| hvigor env | `Invalid DEVECO_SDK_HOME` / `spawn java ENOENT` | `DEVECO_SDK_HOME` + `JAVA_HOME` + JBR `bin` PATH 经 `cmake -E env` 注入；用 `--no-daemon` wrapper 避 daemon 缓存旧 env |
| 平台探测误判 | 三方库（如 libarchive）走 Unix 配置后用 OHOS 不支持的接口 | 新增 `config_ohos.h`（基于 `config_unix.h` undef `HAVE_CLOSEFROM`/`HAVE_CLOSE_RANGE`/`HAVE_LCHMOD`）|
| 模块缺口 | D-Bus / OpenSSL / WebEngine / MCP / QML Designer 在 Qt6 OHOS 当前不可用 | 剪枝（`FEATURE_dbus=OFF`、`INPUT_openssl=no`、跳过相关子目录）|

> **Qt5→Qt6 API 差异**（关闭事件 API 私有化、QStandardPaths 映射变更、CMake API `qt_add_executable` 等）详见 [[qt-harmonyos-qt6-status]]。

---

## 阶段二：逐步迁移（8 步决策树）

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段二进行中：8步迁移第N步`（每完成一步更新一次）

按 [[qt-harmonyos-porting-workflow]] 的 8 步决策树逐项处理：

### Step 1：平台 API 扫描

```bash
# 扫描源码中的平台绑定 API
grep -rn "QProcess\|QDesktopServices\|system(\|exec(" src/
grep -rn "chmod\|symlink\|dlopen" src/
grep -rn "winId\|setMask\|showFullScreen" src/
```

对扫描结果进行分类，确定每个 API 的替换方案。

### Step 2：API 映射替换

按 [[qt-harmonyos-api-mapping]] 的 12 大类逐一替换：

1. **进程管理**：`QProcess` 按场景选 — 无界面保留不改；有界面 Qt 用 `startAppProcess`，有界面非 Qt 用 `startAbility`；需原生托管用 `startNoUiChildProcess`（见 [[qt-harmonyos-api-mapping]] §1 决策树）
2. **应用间通信**：`QDesktopServices::openUrl` → `startAbility(want)`
3. **窗口管理**：独立 QDialog → 设置 parent 或 tagSubWindow
4. **文件系统**：移除 `setPermissions`、`symlink` 调用
5. ... 逐项处理

### Step 3：窗口适配

- 所有独立 QDialog 设置 transientParent
- 检查模态对话框使用方式
- 处理全屏/浮窗/最小化等特殊需求
- 参考 [[qt-harmonyos-window-model]]

### Step 4：生命周期适配

- 实现 `closeEvent()` 的 3 级关闭拦截
- 处理 Ability 前后台切换
- 实现状态保存/恢复（如需要接续）
- 参考 [[qt-harmonyos-lifecycle]]

### Step 5：平台限制处理

检查 [[qt-harmonyos-platform-limits]]，确保代码不触碰：
- chmod / fchmod（用 `#ifndef Q_OS_OHOS` 守卫）
- symlink（用文件拷贝替代）
- pthread_cancel（改用协作式终止）
- 系统路径访问（沙箱限制）

### Step 6：构建系统适配（配置已解压模板）

> 工程模板已在阶段 1.2 解压生成，本步骤聚焦于**配置**而非创建。

- 编写 `entry/src/main/cpp/CMakeLists.txt`（交叉编译配置、Qt 模块链接、QPA 插件）
- 配置 `entry/build-profile.json5` 的 `CMAKE_PREFIX_PATH`（指向 Qt SDK）
- 配置 `QtAppConstants.ets` 的 `APP_LIBRARY_NAME`（与 CMake `add_library` 目标名对应）
- 填充 Qt 运行时库到 `entry/libs/arm64-v8a/`（`libqohos.so` + `libqohosstyle.so`）
- 配置 `AppScope/app.json5` 的 `bundleName`
- 参考 [[qt-harmonyos-project-structure]]

### Step 7：鸿蒙增强功能（可选）

- 深色模式适配：`setColorThemeMode(FollowSystemSetting)`
- 分享功能：`ShareKit::shareDataWithShareKit()`
- 应用接续：`continueRequestReceived` 信号
- Want 交互：处理外部传入的 URI/参数

### Step 8：模块级验证

- 逐模块编译验证
- 逐功能运行验证
- 参考 [[qt-ohos-project-analyzer-workflow]]

---

## 阶段三：编译验证

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段三完成：编译验证通过`

### 3.1 构建

> **🎯 编译验证目标 = 未签名 HAP**：`bundleName` 用应用自身名（`com.example.<appslug>`），`build-profile.json5` 不配签名。**完成标志 = `entry-default-unsigned.hap` 存在 + `BUILD SUCCESSFUL`**。签名是独立的后续步骤（真机安装时才需独立配置签名，不在本编译工作流范围），不阻塞编译验证。

参考 [[qt-harmonyos-build-run-workflow]]：

1. 通过 DevEco MCP 工具链构建（或 hvigorw CLI 法，见该页 §hvigorw CLI 替代法）
2. 解决编译错误（参考构建失败排查四步法）
3. 生成 .hap 包（未签名即可）

### 3.2 部署运行

1. 部署到模拟器或真机
2. 功能逐项验证
3. 性能基本测试

### 3.3 常见问题

| 问题 | 排查方向 |
|------|----------|
| 编译找不到头文件 | CMAKE_FIND_ROOT_PATH_MODE_PACKAGE |
| 链接未定义符号 | 缺少 Qt 模块依赖 |
| 运行时黑屏 | XComponent 初始化 / 窗口 tagging |
| 崩溃 | 生命周期时序 / 空指针 |
| `no member named 'SslConnection'` / QSslSocket 不可用 | OHOS Qt Network 无 OpenSSL，SSL 分支需 `#ifndef QT_NO_SSL` 守卫 |
| `Could NOT find Qt5QuickControls2Config.cmake` | OHOS Qt5 SDK 缺 QuickControls2/Quick3D/WebSockets，QML Controls 应用 defer 或走 Qt6 |
| `no viable conversion from 'const char[]' to 'QPixmap'` | clang 严拒 MSVC 允许的双重隐式转换，改显式构造 |
| `expected '(' after "this"` / deducing-this | OHOS clang 15 不支持 C++23 P0847，改 CRTP 或 defer |
| `no member named 'emplace_back' in QList` | Qt5 QList 无 emplace_back（Qt6 API），改 `append({...})` brace-init；**Qt5 声明但代码 Qt6 的标志**（见阶段零陷阱）|
| Qt6 设备 `dlopen` 失败（NEEDED 含绝对路径）| DT_NEEDED 含 Windows 绝对路径，用 `patch_needed.py` 改裸名（§1.6）|
| Qt6 设备 `dlsym() failed to find 'main'` | `main` 被 hidden visibility 隐藏，加 `__attribute__((visibility("default")))`（§1.6）|
| Qt6 `no member named 'nullptr_t'` / `__promote` | [build-fail-qt6-libcpp-musl-isystem] — 6.12 `-isystem` 注入致 musl 遮蔽 clang builtin；**已绕过（2026-07-13）**：superbuild + MinGW g++ + API 23 下未复现（§1.6）|

---

## 阶段四：知识积累

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` — 将此任务从「📌 进行中」移至「✅ 已完成」，填写完成日期和迁移结果摘要

### 4.1 记录迁移经验

**每次迁移后**，总结以下内容：

1. **遇到的新问题**：知识库中没有覆盖的场景
2. **有效的解决方案**：验证有效的代码模式
3. **踩过的坑**：浪费时间的错误方向
4. **更新的映射关系**：新发现的 API 替换

### 4.2 更新知识库

- 新的 API 映射 → 更新 [[qt-harmonyos-api-mapping]]
- 新的代码模式 → 更新 [[qt-harmonyos-code-patterns]]
- 新的平台限制 → 更新 [[qt-harmonyos-platform-limits]]
- 执行错误 → 创建 `problems/` 条目
- 项目经验 → 创建 `episodic/` 条目

---

## 阶段五：批量迁移（可选）

> 当需一次性迁移一批（N≥10）Qt 应用时，在单应用工作流（阶段零~四）之上加这层批量编排。
> 经验蒸馏自三批次实战（共 207 应用、117 编译成功，见 `episodic/` 域 `qt-opensource-apps-batch-port-*` 复盘）。

### 5.1 批量前：采样定路径

读 xlsx `qt_modules` 列采样前 20 行，判 app/lib 比例：
- **绝大多数 GUI 应用**（core+gui+widgets）→ 单 HAP 路径（只 Playbook A），如 rows 300-399。
- **混合 app+lib** → 双路径 A/B，如 rows 400-499（17 HAP + 53 库）。
- **绝大多数库** → 单 .a 路径（只 Playbook B）。

### 5.2 Triage → Port 用 pipeline 非 barrier

`pipeline(items, triageStage, portStage)`：triage（clone+扫描，快）完成一个即刻进 port（写文件+编译，慢），不等全部 triage 结束。triage 慢尾与 port 快头重叠，wall-clock 比串行两阶段省 ~30%。Port 阶段对 feasible 子集用 `parallel`（~16 并发）。

### 5.3 模块矩阵预筛（阻断模块不进编译批次）

triage agent 读 [[qt-harmonyos-modules]] 模块矩阵，命中阻断模块（multimedia/dbus/webengine/charts/serialbus/core5compat/quickcontrols2/svgwidgets 等）且无法直接弃用的，标 `feasibility=blocked`，不进 Port 阶段。rows 300-399 批次由此省掉 55 次必然失败的编译。**模块矩阵零误判**已经验证。

### 5.4 克隆失败 fallback（CGNAT 网络）

本机家宽 CGNAT（无公网 IP），github.com `git clone` 频繁 TCP reset。fallback 顺序：
1. `git clone --depth 1 <url>` 失败 → 重试一次不带 `--depth`。
2. 仍失败 → `https://codeload.github.com/<owner>/<repo>/zip/refs/heads/<default-branch>` tarball（unzip 即用，无 .git）。
3. triage-only（不需本地源码）→ GitHub REST API `api.github.com/repos/<owner>/<repo>/contents/<path>` 读构建文件列表 + 模块声明。

### 5.5 安全分类器故障期

glm-5.2 安全分类器间歇不可用时，主循环的 Bash/Write/Agent 调用被阻塞，但 Workflow 工具的内部 spawn 不走主循环分类器。**所有批量 spawn 经 Workflow 工具承载**（clone-retry、triage、port 均用 Workflow 启动），可绕过故障。

### 5.6 agent prompt 规范

- **禁建共享 TaskList 子任务**：agent 在自己的上下文跟踪进度，不要调用 `TaskCreate` 建 per-app 子任务（会污染主任务表，两批次均被污染过 60+ 条）。
- **评估读代码非构建文件**：triage 必须按阶段零预检表 grep Qt6-only API，不能只看 `.pro`/`QT +=`（canonic/B23Downloader 翻车案例）。
- **每项目最多 3 次编译 attempt**：读 error tail → 修最可能原因 → 重建。3 次未过则标 failed，附错误，不强转 success。

### 5.7 批量交付件

- `${PROJECTS_ROOT}/<batch>/_BATCH_REPORT.md` — 全量结果表（row × 状态 × 产物 × 错误）。
- `${PROJECTS_ROOT}/<batch>/_results/<row>.json` — 每项目迁移+编译报告。
- `${PROJECTS_ROOT}/<batch>/_assessments/<row>.json` — 每项目 triage 评估。
- `${PROJECTS_ROOT}/<batch>/_RUNBOOK.md` / `_playbook.md` — 批次用的迁移配方（供所有 port agent 遵循）。

---

## 检查清单

- [ ] **阶段零预检完成**（Qt 版本按代码非声明、SDK 选型 Qt5/Qt6、模块可用性、项目类型→Playbook A/B、平台绑定、foreach、三方依赖）
- [ ] 可行性评估完成（模块依赖、平台 API、UI 复杂度）
- [ ] 项目目录已创建于 `${PROJECTS_ROOT}/<app-name>-ohos/`
- [ ] 胶水代码模板已从源码内置路径（`<QT_SRC>/qtbase/src/harmonyos/templates`）复制至项目目录
- [ ] 应用显示名称已修改（`app_name` + `QAbility_label` 改为应用名）
- [ ] 8 步决策树逐项处理
- [ ] 编译通过
- [ ] **若用 Qt6**：DT_NEEDED 改裸名（`patch_needed.py`）+ `main` 为 `GLOBAL DEFAULT` 已验证（§1.6）
- [ ] 部署运行验证通过
- [ ] 迁移经验已记录到知识库

---

## 供应链

> 详见 工作流供应链「应用移植」一节

| 维度 | 详情 |
|------|------|
| **上游来源** | ① 商业 Qt 客户的鸿蒙化迁移需求 ② 内部宣传 demo 需求 ③ 自驱动（评估新场景可行性） |
| **上游输入** | 原始 Qt 工程/源码、目标功能需求、Qt 版本信息 |
| **下游接收方** | **商业 Qt 客户** / 内部（宣传 demo） |
| **交付件** | 可行性评估报告 → 迁移后的鸿蒙工程 → 编译产物 (.hap) |
| **交付件路径** | `${PROJECTS_ROOT}/<app-name>-ohos/`（见 `ENV.md`） |
| **分流规则** | 无；**知识积累**：每次迁移后更新 KB（API 映射 → `api-mapping.md`、代码模式 → `code-patterns.md`、问题经验 → `problems/`） |

---

## 相关上下文

- [[qt-harmonyos-porting-workflow]] — 8 步决策树详细版
- [[fetch-qt-ohos-sdk]] — 无 Qt SDK/模板时直接 HTTP 下载预编译 SDK 和模板
- [[qt-harmonyos-api-mapping]] — 12 大类 API 映射表
- [[qt-harmonyos-code-patterns]] — Before/After 代码模式
- [[qt-harmonyos-lifecycle]] — 生命周期处理
- [[qt-harmonyos-window-model]] — 窗口模型
- [[qt-harmonyos-project-structure]] — 工程结构
- [[qt-harmonyos-build-run-workflow]] — 构建运行
- [[qt-harmonyos-platform-limits]] — 平台限制
- 工作流供应链 — 工作流供应链总览（上下游关系和对接人清单）

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | Workflow design, checklists, grep patterns, debugging table, knowledge accumulation process — all from practical Qt-for-HarmonyOS migration experience |
| 📖 Wiki | Qt Wiki pages (wiki.qt.io/Qt_for_HarmonyOS/*): module support lists, CMake cross-compile guide, user development guide, API compatibility notes — accessed indirectly through referenced semantic pages |
| 🔍 框架源码 | Qt framework internals: QOhosPlatformIntegrationPlugin CMake target, QPA plugin architecture, closeEvent root cause mechanism, QOhosAbilityContext signal names |
| 📦 导出接口 | QtOhosExtras public API surface: startNoUiChildProcess, startAbility, setColorThemeMode, ShareKit::shareDataWithShareKit, continueRequestReceived, tagWindowOrWidgetAsSubWindowOf |
| 📄 华为官方文档 | HarmonyOS platform concepts: Ability/Want model, sandbox constraints, ShareKit framework, application continuation — underlying platform context |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |
| QtOhosExtras 5.15 | tqtc/harmonyos-5.15.16 | b60937d5 | 2026-04-19 |
| QtOhosExtras 5.12 | tqtc/harmonyos-5.12.12 | a802177c | 2026-05-25 |

---

## 参考来源

- [Qt for HarmonyOS (Qt Wiki)](https://wiki.qt.io/Qt_for_HarmonyOS) — 整体架构和模块状态
- [API Compatibility Notes (Qt Wiki)](https://wiki.qt.io/Qt_for_HarmonyOS/api_inconsistencies_on_harmonyos) — API 差异详情
- [User Development Guide (Qt Wiki)](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide) — 开发指南系列
- [Building Qt for HarmonyOS (Qt Wiki)](https://wiki.qt.io/Building_Qt_for_HarmonyOS) — 构建配置

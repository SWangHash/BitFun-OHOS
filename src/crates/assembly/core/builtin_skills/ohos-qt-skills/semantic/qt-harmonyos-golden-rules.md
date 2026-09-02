---
id: semantic-qt-harmonyos-golden-rules
type: semantic
domain: tech
tags: [qt, harmonyos, golden-rules, quick-reference, porting, checklist]
created: 2026-06-03
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-porting-workflow, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-lifecycle, semantic-qt-harmonyos-api-mapping, semantic-qt-harmonyos-code-patterns, semantic-qt-harmonyos-window-model, semantic-qt-ohos-extras, semantic-qt-harmonyos-build, semantic-qt-harmonyos-third-party-libs]
summary: >
  Qt 鸿蒙化铁律速查：35 条黄金规则覆盖构建部署、窗口管理、API/枚举路径、
  平台限制对 Qt 的影响、生命周期 adapter、跨平台守卫。每条含严重度（🔴🟠🟡🟢）、"为什么"和出处。
  Agent 执行任何 Qt for HarmonyOS 任务前应先扫描此页。
---

# Qt 鸿蒙化铁律速查（Golden Rules）

> **Agent 操作指引**：执行任何 Qt for HarmonyOS 相关任务前，先扫描此页。
> 每条规则标注出处，需要细节时沿链接深入。
> 本页是 Qt 快速决策 hub，不是平台事实的第二 canonical source。HAP/签名见 [[ohos-common-kb/semantic/hap-native-project-structure|HAP 原生工程结构与签名关系]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/hap-native-project-structure.md)）；平台限制见 [[ohos-common-kb/semantic/harmonyos-platform-limits|HarmonyOS 平台限制]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）；Stage/UIAbility 见 [[ohos-common-kb/semantic/stage-uiability-lifecycle|Stage 模型与 UIAbility 生命周期]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）。下表只保留这些事实会怎样影响 Qt，以及 Qt 侧必须做什么。
>
> **⚠️ 版本适用范围**：本规则集基于 **Qt 5.12/5.15**。Qt 6 for OHOS 有以下重大变更：
> - **QtOhosExtras 模块不再独立存在** — 功能已内联到 QPA 插件中作为私有 API（`_p.h`），规则 B6/A3/A4/A5/A6 在 Qt6 中不适用
> - **关闭事件 API 私有化** — `CloseEventRootCause` → `CloseRootCause`（私有），枚举值变更（`AbilityClose`→`OnPrepareToTerminate`）
> - **CMake API 全面变更** — `find_package(Qt6...)`、`qt_add_resources()`、`qt_add_qml_modules()` 等
>
> Qt6 详细差异见 [[qt-harmonyos-qt6-status]]。
>
> **严重度图例**：🔴 编译/部署阻断 | 🟠 静默失败（难调试） | 🟡 行为异常（可恢复） | 🟢 信息/最佳实践

---

## 一、构建与部署（12 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| B1 | 🔴 | CMakeLists.txt 交叉编译时**必须**在 `find_package` 前设置 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH`（三方库同理） | OHOS 工具链默认 `ONLY`，阻止找到 Qt 和三方库 | [[qt-harmonyos-project-structure]] §4.2, [[qt-harmonyos-third-party-libs]] §2.2 |
| B2 | 🔴 | **必须**链接 `Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin`（QPA 平台插件） | 不链接则 `dlopen failed: libqohos.so not found` | [[qt-harmonyos-project-structure]] §4.2 |
| B3 | 🔴 | `APP_LIBRARY_NAME`（QtAppConstants.ets）**必须**与编译产物库名完全一致（含 `lib` 前缀和 `.so` 后缀） | 不一致则 ArkTS 层无法加载 .so | [[qt-harmonyos-project-structure]] §5 |
| B4 | 🔴 | **禁止**设置 `compileSdkVersion` 和 `targetSdkVersion` | 设置后 Schema validate failed | [[qt-harmonyos-project-structure]] §9 |
| B5 | 🟡 | `runtimeOS` **必须**设置为 `"HarmonyOS"`（不是 `"OpenHarmony"`） | 影响应用打包和签名 | [[qt-harmonyos-project-structure]] §4.3 |
| B6 | 🟡 | QtOhosExtras 模块**仅支持 qmake**（`CONFIG -= create_cmake`），CMake 无 find_package 支持。**Qt6**：模块不再独立存在，功能已内联到 QPA 插件 | 源码中禁用了 CMake config 生成 | [[qt-ohos-extras]] §使用方式, [[qt-harmonyos-qt6-status]] |
| B7 | 🟡 | `libqohosstyle.so` **必须**手动复制到 `libs/${ABI_DIR}/styles/` 子目录 | 无法通过 target_link_libraries 部署到子目录 | [[qt-harmonyos-project-structure]] §6.2 |
| B8 | 🟡 | 场景二（已有工程鸿蒙化）`build-profile.json5` 的 `path` **必须**用绝对路径 | 相对路径找不到源文件 | [[qt-harmonyos-project-structure]] §9 |
| B9 | 🔴 | qmake 的 `unix` 分支**必须**追加 `:!ohos`（`unix:!android:!macx:!ohos`） | 否则 ohos 同时命中 unix 分支，编译出错误的 Linux 代码 | [[qt-harmonyos-code-patterns]] §模式7 |
| B10 | 🔴 | QML 应用**必须**启用 `CMAKE_AUTORCC ON` | 不启用则 qml.qrc 不编译，QML 文件不打包，运行时黑屏 | [[qt-harmonyos-project-structure]] §4.2 |
| B11 | 🔴 | `bundleName` 必须使用目标 SDK schema 接受的稳定点分标识，并与最终生成工程、签名 profile、安装/启动命令一致 | 身份不一致会导致校验、签名、安装或启动失败；精确字符范围由目标 SDK 判定 | [[qt-harmonyos-project-structure]] §8 |
| B12 | 🟠 | SQL 驱动插件 `libqsqlite.so`**必须**手动复制到 `libs/${ABI_DIR}/sqldrivers/`（与 B7 `libqohosstyle.so`→`styles/`、`libqsvg.so`→`imageformats/` 同类） | 动态分类插件无法靠 `target_link_libraries` 部署，`QFactoryLoader` 按子目录 dlopen 加载；漏部署则 `addDatabase("QSQLITE")` driver 为 null，`open()` 在碰文件系统前即返回 false（`lastError="Driver not loaded"`）。注意 OHOS SDK 文件名是 `libqsqlite.so`（非桌面 `libqsqlsqlite.so`） | [[qt-harmonyos-project-structure]] §6.2, [runtime-fail-sqlite-open-database](../problems/runtime-fail-sqlite-open-database.md) |

---

## 二、窗口管理（6 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| W1 | 🟡 | `tagWindowOrWidgetAsSubWindowOf()` **必须**在 `show()` 和 `winId()` 之前调用 | 之后调用标签不生效，窗口已被绑定为主窗口 | [[qt-harmonyos-window-model]] §Tagging |
| W2 | 🟢 | 首个 `QWindow`/`QWidget` 自动绑定到系统主窗口，**无需** tagging | First Window Rule | [[qt-harmonyos-window-model]] §First Window Rule |
| W3 | 🟡 | 无 parent 的 `QDialog` 会被系统视为**新主窗口**，必须 tagging 或传 parent。**关键概念**：Subwindow 的"子"是系统层面的归属关系（Dock/任务栏可见性），**不是** Qt widget 的父子关系——即使 `QWidget` 没有 Qt parent，也可以通过 tagging 成为 subwindow | 否则出现独立 Dock 图标和 Alt+Tab 条目 | [[qt-harmonyos-window-model]] §概念, §Pattern 3 |
| W4 | 🟡 | 首个窗口**不能**启动时直接全屏，必须先 `show()` 再 `showFullScreen()` | 鸿蒙要求先完成 Ability 初始化 | [[qt-harmonyos-window-model]] §全屏 |
| W5 | 🟡 | 主窗口 `hide()` 回退为最小化（无系统托盘时） | 与桌面平台行为不同 | [[qt-harmonyos-api]] §hide |
| W6 | 🟠 | **不要依赖 `WINDOW_HIDDEN`/`WINDOW_SHOWN` 事件作为窗口状态同步的唯一触发源**——这些事件在文件加速/预加载场景下不触发（设备日志实证 0 次匹配）。系统可通过 WMS 直接管理窗口可见性，不走 Qt 窗口事件回调 | WMS 与 Qt 可见性状态机独立，系统推送窗口到前台时 Qt 侧 Hidden 标志可能未清除→白屏 | [[qt-harmonyos-window-model]] §WMS与Qt可见性状态机独立性, 白屏问题复盘 |

---

## 三、API 名称与枚举路径（6 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| A1 | 🟠 | 关闭事件枚举**必须**用完整路径：`QtOhosExtras::CloseEventRootCause::AbilityClose`（不是 `QtOhosExtras::AbilityClose`）。**Qt6**：枚举重命名为 `CloseRootCause` 且已私有化 | 是 enum class，短路径编译不过 | [[qt-harmonyos-lifecycle]] §关闭事件, [[qt-harmonyos-qt6-status]] |
| A2 | 🟠 | 主题枚举**必须**用完整路径：`QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting`（缺 `QOhosAppContext::` 层级编译不过）。**Qt6**：枚举可能已移动或私有化 | 嵌套于 `QOhosAppContext` 的 enum class，短路径编译不过 | [[qt-harmonyos-lifecycle]] §主题, [[qt-harmonyos-qt6-status]] |
| A3 | 🟠 | UI 信号在 `QOhosUiAbilityContext` 上（不是 `QOhosAbilityContext`）：`newWantReceived`、`continueRequestReceived`、`newWantInfoReceived`。**Qt6**：信号类可能已重构 | 基类 `QOhosAbilityContext` 无这些信号 | [[qt-harmonyos-lifecycle]] §接续/分享, [[qt-harmonyos-qt6-status]] |
| A4 | 🟢 | 工厂方法在 `QOhosAbilityContext` 上：`getDefaultInstance()`、`getInstanceForMainWindow()`。**Qt6**：类可能已不存在 | 这些是基类的静态方法 | [[qt-harmonyos-lifecycle]] §接续, [[qt-harmonyos-qt6-status]] |
| A5 | 🟠 | qtohosextras 头文件**只有小写**，`#include` **必须**用小写：`<QtOhosExtras/qohosappcontext.h>`（**不是** CamelCase `<QtOhosExtras/QOhosAppContext>`）。注意：与 QtCore 不同，qtohosextras **不安装 CamelCase 转发头**（实测 2026-07-23：install 后 `include/QtOhosExtras/` 下只有 `qohos*.h`，无 `QOhos*` 转发头 → CamelCase 编译报 `file not found`）。QtCore 等核心模块有 CamelCase 转发头（`QString` 等），qtohosextras 无。**Qt6**：模块不存在，头文件路径无效 | 实测：qtohosextras install 不生成 CamelCase 转发头；旧版 A5 "统一 CamelCase" 对 qtohosextras **不成立**，已修正 | [[qt-harmonyos-lifecycle]], [[qt-harmonyos-qt6-status]] |
| A6 | 🟠 | `getCloseEventRootCause()` 是**自由函数**（`QtOhosExtras::getCloseEventRootCause(event)`），不是成员方法。**Qt6**：函数已私有化（`_p.h`） | 位于 QOhosWindowUtils 头文件 | [[qt-ohos-extras]] §关闭事件, [[qt-harmonyos-qt6-status]] |

---

## 四、平台限制的 Qt 响应（5 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| P1 | 🟠 | 不把 `QFile::setPermissions()` 成功作为流程前提；随包文件权限在打包/安装阶段解决 | Qt wrapper 不能绕过平台权限模型 | [[qt-harmonyos-platform-limits]] §chmod |
| P2 | 🟠 | `QFile::link()` 或依赖 symlink 的库必须提供复制/直接路径方案 | Qt 文件 API 仍受平台沙箱约束 | [[qt-harmonyos-platform-limits]] §symlink |
| P3 | 🟠 | `QPluginLoader`/`QLibrary` 的代码产物随 HAP 放入合规 native 目录，不从普通可写数据目录加载 | Qt loader 最终仍调用平台动态加载器 | [[qt-harmonyos-platform-limits]] §dlopen |
| P4 | 🟢 | 使用 Qt 协作式线程停止/中断，不为 OHOS 路径引入 `pthread_cancel` 假设 | Qt adapter 应保持可移植的停止语义 | [[qt-harmonyos-platform-limits]] §pthread |
| P5 | 🟢 | Qt 时区功能走已验证的 ICU 后端，不直接扫描系统 tzdata 路径 | 框架后端必须适配平台资源可见性 | [[qt-harmonyos-platform-limits]] §时区 |

---

## 五、生命周期与 Ability（4 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| L1 | 🟠 | `closeEvent()` **必须**检查 `CloseEventRootCause` 区分关闭来源。**⚠️ Level 2（AbilityClose）绝对不能弹 UI**——弹对话框会导致应用卡在关闭流程中被系统强杀。Level 1（WindowStageClose）可弹对话框，Level 2 只能静默 autoSave。**Qt6 注意**：此 API 已私有化，枚举值变更（`AbilityClose`→`OnPrepareToTerminate`），详见 [[qt-harmonyos-qt6-status]] | Level 1（用户关窗口）可弹对话框，Level 2（系统回收）**禁止弹 UI** | [[qt-harmonyos-lifecycle]] §3级关闭 |
| L2 | 🟢 | `argv[0]` 是**库路径**（.so），不是可执行文件路径 | 鸿蒙以共享库方式加载 Qt 应用 | [[qt-harmonyos-lifecycle]] §参数传递 |
| L3 | 🟢 | Qt event loop 由 **Stage/UIAbility** adapter 启动，不另建旧 FA 模型入口 | Qt `main()` 是被平台组件桥接的 native 入口 | [[qt-harmonyos-lifecycle]] §启动桥接 |
| L4 | 🟢 | 子进程**按场景选**，不一刀切：无界面 `QProcess` 可用 / 有界面 Qt 用 `startAppProcess()`、`startNewAbilityInstance()` / 有界面非 Qt 用 `startAbility(want)` / 无界面需托管用 `startNoUiChildProcess()` | 不要用裸 QProcess 起带界面的子进程（GUI 须经 Ability 框架）；无界面计算保留 QProcess 即可（2026-07-21 修正，旧版"QProcess 不可用"不准确） | [[qt-harmonyos-lifecycle]] §子进程、[[qt-harmonyos-api-mapping]] §1 |

---

## 六、跨平台守卫（2 条）

| # | 严重度 | 规则 | 为什么 | 出处 |
|---|:------:|------|--------|------|
| G1 | 🟢 | `Q_OS_OHOS` **隐含** `Q_OS_LINUX` — `#ifdef Q_OS_LINUX` 在鸿蒙上也会命中 | 必须检查所有 Q_OS_LINUX 分支是否兼容鸿蒙 | [[qt-harmonyos-porting-workflow]] §原则1 |
| G2 | 🟢 | 拖放事件数据**只能**在 `dropEvent` 中读取，`dragEnterEvent`/`dragMoveEvent` 中只有 MIME 类型 | 鸿蒙拖放协议数据传输是异步的 | [[qt-harmonyos-code-patterns]] §模式9 |

---

## 快速决策流

> 完整路由详见 [[_task-routing|任务路由表]]。以下为紧凑版：

```
收到 Qt for HarmonyOS 任务
    │
    ├─ 移植整个应用？        → porting-workflow（8 步） + 本页全部
    ├─ API 怎么替换？        → api-mapping（12 类映射）
    ├─ 模块是否支持？        → modules
    ├─ 平台限制？            → platform-limits
    ├─ 构建/部署出问题？     → 本页 B1-B12 + project-structure
    ├─ 窗口行为异常？        → 本页 W1-W6 + window-model
    ├─ 编译报 API 不存在？   → 本页 A1-A6 + ohos-extras
    ├─ 生命周期/closeEvent？ → 本页 L1-L4 + lifecycle
    ├─ QtOhosExtras 怎么用？ → ohos-extras
    ├─ Qt 6 相关？           → qt6-status
    ├─ 三方库/依赖？         → third-party-libs
    └─ DevEco/MCP/工具链？   → common DevEco CLI/MCP 页面 + qt-harmonyos-build-run-workflow
```

---

## 参考来源

本页蒸馏自以下知识页，需要细节时沿链接深入：

- [[qt-harmonyos-porting-workflow]] — 8 步决策树
- [[qt-harmonyos-project-structure]] — 工程结构与铁律清单
- [[qt-harmonyos-platform-limits]] — 平台限制的 Qt/QML/QPA 影响 + QTBUG 编号
- [[qt-harmonyos-lifecycle]] — Stage/UIAbility 的 Qt adapter 与 Qt API 参考
- [[qt-harmonyos-api-mapping]] — API 迁移映射表
- [[qt-harmonyos-code-patterns]] — 14 组 Before/After 代码模式
- [[qt-harmonyos-window-model]] — 窗口模型详解
- [[qt-ohos-extras]] — QtOhosExtras 模块 API
- [[qt-harmonyos-build]] — 构建指南
- [[qt-harmonyos-third-party-libs]] — 三方库鸿蒙化指南
- [[qt-harmonyos-qt6-status]] — Qt 6 鸿蒙化状态

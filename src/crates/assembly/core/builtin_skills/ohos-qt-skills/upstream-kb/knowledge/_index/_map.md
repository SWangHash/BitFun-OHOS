---
updated: 2026-08-29
total_pages: 46
description: >
  知识地图（从 frontmatter summary 自动生成）。按 summary 判断相关性；沿 refs 追深度上下文。
---

# 知识地图

> 按 summary 判断相关性；沿 refs 追深度上下文。

## semantic

- [qdrag-cancel-cross-platform](../semantic/qdrag-cancel-cross-platform.md) — QDrag::cancel() 编程式拖拽取消的跨平台适配现状：Windows 和 X11 已实现（OLE flag / QBasicDrag 事件循环）， macOS (Cocoa) 和 OHOS 均未实现（cancelDrag 落到 Q_UNIMPLEMENTED 空操作）。OHOS 上调用不会崩溃/卡死但静默无效， 原生 drag 自然结束后 exec 返回。含官方 draggableicons 示例扩展 demo 和各平台 file:line 证据链。
- [qt-harmonyos-accessibility](../semantic/qt-harmonyos-accessibility.md) — Qt OHOS 无障碍(a11y)桥机制与启用: libqohos 内置 QOhosPlatformAccessibility(QPlatformAccessibility 子类), 把 Qt 的 QAccessible 控件树经每个 QWindow 的 XComponent 原生 ArkUI_AccessibilityProvider 发布到 OHOS 无障碍框架 (findAccessibilityNodeInfosById 等回调)。桥默认关, 由【启动 Want 布尔参数 io.qt.experimental.enableA11ySupport】开启 (aa start --pb io.qt.experimental.enableA11ySupport true), 非 env 变量/非 appArg/非系统读屏自动触发。 开启后 uitest dumpLayout -b <bundle> 可取完整 Qt 控件树(QApplication/QWidget/QPushButton/QLabel+text+bounds); DevEco MCP get_app_ui_tree 走 ArkUI inspector 只到 XComponent 节点(不含 Qt 控件)。
- [qt-harmonyos-api-mapping](../semantic/qt-harmonyos-api-mapping.md) — HarmonyOS 平台能力的 Qt API adapter 映射表：13大类 Before/After 对照——进程管理、应用间通信、 窗口管理、关闭事件、文件系统、启动参数、拖放、主题外观、时区、线程、 分享、应用接续、触摸长按上下文菜单。每类含映射表和代码示例。
- [qt-harmonyos-api](../semantic/qt-harmonyos-api.md) — Qt 鸿蒙化 API 兼容性要点：argv 参数差异、子进程按场景选（无界面 QProcess 可用/有界面 Qt 用 startAppProcess/有界面非Qt 用 startAbility）、 窗口模型差异（QDialog/Popup 为子窗口）、 modality 仅子窗口有效、winId() 非原生句柄、setSurfaceConsumer 获取 OHNativeWindow* 的公开路径、hide() 语义不同、 setMask() 仅子窗口、closeEvent 可能来自系统生命周期。 平台判断：Qt.platform.os 在鸿蒙返回 "linux"（上游 os() 缺 Q_OS_OHOS 分支），临时用 pluginName，建议上游修复。 设备类型判断：Qt 不导出公开设备类型接口；私有层 QtCore 的 QOhosDeviceInfo（Q_CORE_EXPORT，可 include 可 link，但仅 2in1/tablet/phone 三档、本质是 @ohos.deviceInfo 缓存）可用，应用层推荐直接走 Node-API 调 @ohos.deviceInfo。
- [qt-harmonyos-build-run-workflow](../semantic/qt-harmonyos-build-run-workflow.md) — Qt HarmonyOS 编译运行工作流：devecocli 优先完成构建、安装、启动、日志和 UI 操作； 封装未覆盖或诊断封装时使用可审计的 hvigor/hdc 最小调用，并保留 Qt 工程检查与失败排查闭环。
- [qt-harmonyos-build](../semantic/qt-harmonyos-build.md) — Qt for HarmonyOS 构建指南：macOS/Windows 编译环境搭建、configure 参数、 Qt Creator Kit 配置、DevEco Studio 集成、OpenSSL/OpenGL 配置、Qt 5.15 skip 列表。
- [qt-harmonyos-code-patterns](../semantic/qt-harmonyos-code-patterns.md) — HarmonyOS 平台能力的 Qt adapter 代码速查：14 组 Before/After，覆盖子进程、Want、 独立对话框→tagged子窗口、关闭事件处理、文件权限守卫、参数解析、 平台构建配置、深色模式、拖放、等宽字体、浮窗、分享数据、Qt6→Qt5 shim移植(不改原src)、 数据库文件路径。
- [qt-harmonyos-golden-rules](../semantic/qt-harmonyos-golden-rules.md) — Qt 鸿蒙化铁律速查：35 条黄金规则覆盖构建部署、窗口管理、API/枚举路径、 平台限制对 Qt 的影响、生命周期 adapter、跨平台守卫。每条含严重度（🔴🟠🟡🟢）、"为什么"和出处。 Agent 执行任何 Qt for HarmonyOS 任务前应先扫描此页。
- [qt-harmonyos-lifecycle](../semantic/qt-harmonyos-lifecycle.md) — Stage/UIAbility 生命周期的 Qt adapter：平台回调到 Qt main/event loop 的桥接、启动其他应用 (显式/隐式Want)、被其他应用启动(module.json5 skills)、多实例管理、 3级关闭拦截(WindowStageClose/AbilityClose/InternalClose)、 应用接续(跨设备迁移)、分享(ShareKit)、无UI子进程、argv组装规则、主题管理。
- [qt-harmonyos-modules](../semantic/qt-harmonyos-modules.md) — Qt 5.12/5.15 鸿蒙模块适配状态速查（对照 wiki 矩阵 2026-09-18 刷新）：核心模块全部 Completed；QtMultimedia wiki Completed 但官方 Qt5 SDK 未含、Qt-full 全量构建已含；不支持(QtWebEngine/D-Bus/RemoteObjects/SerialBus/VirtualKeyboard 等)；仅 5.15：QtPDF/QuickTimeline/Lottie/Quick3D；仅 5.12：QtXmlPatterns。
- [qt-harmonyos-overview](../semantic/qt-harmonyos-overview.md) — Qt for HarmonyOS 总览：鸿蒙系统简介、Qt 鸿蒙化架构（QPA 插件机制）、 适配进展（Qt 5.12.12/5.15.16，适配率约90%）、 支持设备（手机/平板/PC/2in1）、源码获取方式（Gerrit tqtc-qt5）。
- [qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md) — HarmonyOS 平台限制的 Qt/QPA/QML adapter：记录 QFile/QStandardPaths/QPluginLoader/QTimeZone、 字体、XComponent、ZINK 与 Qt.platform 的可观察症状、Qt workaround 和 QTBUG；平台状态与原因由 common 维护。
- [qt-harmonyos-porting-workflow](../semantic/qt-harmonyos-porting-workflow.md) — 面向 Qt 应用的 HarmonyOS 移植编排：将公共库中的生命周期、窗口模型与平台限制 落到 Qt/QPA、QtOhosExtras、构建系统和模块验收的 8 步适配流程。
- [qt-harmonyos-project-structure](../semantic/qt-harmonyos-project-structure.md) — Qt 鸿蒙工程结构详解：OHOS 模板（胶水代码）目录布局、CMake 交叉编译配置、 库名规则（QtAppConstants.ets ↔ add_library）、两种场景（从零创建 / 已有工程鸿蒙化）。
- [qt-harmonyos-pyqt-status](../semantic/qt-harmonyos-pyqt-status.md) — PyQt5 for HarmonyOS 可行性状态：已通过 pyqt5-demo 验证可行（Qt 5.15.16）。 架构与标准 C++ Qt 完全一致（libqohos.so QPA 插件），差异仅在 C++ launcher 层 嵌入 CPython 3.12 运行时解释执行 Python 脚本。依赖 DevPython-OH（CPython 交叉编译） 和 PythonForArkUI（PyQt5 site-packages）。已知坑：openblas 需二进制补丁、 sys.exit() 触发 appspawn 崩溃日志、仅支持 tablet/2in1。
- [qt-harmonyos-qt6-status](../semantic/qt-harmonyos-qt6-status.md) — Qt 6 鸿蒙化状态：qtbase dev 已合并 HarmonyOS 支持（Gerrit 733351）， 最低 SDK API 20（HarmonyOS 6.0.0），CMake 构建系统。 **Qt 6.12.0 Windows superbuild 已验证（2026-07-13）**：MinGW host + OHOS Clang target， gallery demo 真机运行通过（"Widget Gallery Qt 6.12.0"）。 **⚠️ 2026-07-25 重大修正：Qt 6.12 预构建安装器 SDK 是完整发行版**（libQt6Quick.so/Multimedia/ Charts/3D/OpenGL/DataVisualization/Bluetooth/Location/Sensors/SerialBus/UiTools/Core5Compat 全在, QtQuick qml runtime 全在），仅缺 WebEngine/DBus/Wayland/Pdf/Script。本文旧记"非 qtbase 未开始" "Quick .so absent""Multimedia missing"是**源码 superbuild（策略 B）**时代过时记录，对**预构建（策略 B'）**不成立。 第 2 批 10 应用（扩展 opengl/qml/uitools 等模块）全编译成功佐证。 **⚠️ 2026-08-25 beta3 复核**：Qt6HarmonyExtras 重新独立成模块（libQt6HarmonyExtras.so + cmake，公开头仅 exports/version 桩，16 个功能头全私有 `_p.h`）——翻 beta2「不作为独立模块存在」结论；文件权限授予=QtCore `QPermissions` 公开 API（无文件类权限类型，仅定位/日历/联系人/蓝牙/相机/麦克风）+ `QtHarmonyExtras::FileShare::persistPermission` 私有 API（对应鸿蒙 `@ohos.fileshare`）。 Qt5→Qt6 关键差异（QStandardPaths、CMake API、QML、QPA API）。
- [qt-harmonyos-system-tray](../semantic/qt-harmonyos-system-tray.md) — Qt 鸿蒙系统托盘(QSystemTrayIcon)实现与行为:底层 QOhosSystemTrayIcon(qohossystemtrayicon.cpp)经 @kit.StatusBarExtensionKit.statusBarManager 把图标放进鸿蒙状态栏(addToStatusBar/updateIcon/updateMenu/ removeFromStatusBar/updateStatusBarHoverTips),菜单走 QOhosStatusBarMenuImpl(rightMenuClick/menuCode), showMessage 走 @ohos.notificationManager.publish。列全 stub/坑(geometry 恒值/messageClicked 永不/ activated 仅 Trigger/菜单仅 text+顶层 separator+一层子菜单/图标强转单色 mask/tooltip 需 API≥22)。
- [qt-harmonyos-third-party-libs](../semantic/qt-harmonyos-third-party-libs.md) — Qt 应用接入 OHOS 三方库的 adapter：Qt find_package/CMake、Qt 模块与插件部署、 静态/动态链接选择、Qt 项目迁移检查和实测兼容清单；平台 NDK、ABI、sysroot、 HAP native 部署与 loader 契约由 common 维护。
- [qt-harmonyos-window-model](../semantic/qt-harmonyos-window-model.md) — ArkUI Window/XComponent 的 Qt QPA adapter：MainWindow(有Dock/任务图标/独立生命周期) vs Subwindow(无Dock/属于主窗口/随主窗口关闭最小化恢复)。核心规则： 首个窗口自动绑定、后续窗口默认新主窗口、tagging必须在show/winId之前。 QOhosFunctions API、6种代码模式、浮窗、全屏规则、嵌入式子窗口、跨进程嵌入。 含【QPA层】visible的来源（QWindowPrivate::visible）、OHOS系统回调链 （window.on('windowEvent')→WINDOW_SHOWN/HIDDEN/ACTIVE/INACTIVE）、 所有修改visible的7个位置、QOhosFloatingWindow命名陷阱、浮窗hide销毁链(setOrResetWindowProxy→destroyWindow)。 含【激活语义】activateWindow()→@ohos.window.shiftAppWindowFocus(非 showWindow!)异步~94ms、 D1 no-op 缺口(无focus_window时静默无效)、焦点状态≠激活态(标题灰⇒未获焦⇒Tab不响应)。 详见 episodic/postmortems/ 下复盘(内部文档)。
- [qt-ohos-extras-examples](../semantic/qt-ohos-extras-examples.md) — QtOhosExtras 官方示例菜谱：把 24 个 example 按"开发者问题"组织，每条给出一句话用途、所用 API、 最小代码模式与源文件路径。直接回答"如何在鸿蒙 Qt 上实现（其他平台上的）xxx 功能？" 索引覆盖：打开链接/启动应用/启动并取结果/启动选项/预加载/应用续接/权限申请(含串口)/系统分享(发送+接收)/ 文件共享权限/文件回收站/常亮/圆角/拖拽缩放/深浅主题/长按上下文菜单/native窗口id/显示器id/应用版本/重启/ 音频流场景/嵌入式UIExtension/文件描述符传递(Want FD 发送+接收)。所有 API 签名源自 Qt 5.12.12 源码 (commit 613336de)，与 5.15.16 逐字一致；示例源码位于 qtohosextras/examples/qtohosextras/。
- [qt-ohos-extras](../semantic/qt-ohos-extras.md) — QtOhosExtras 模块：Qt 与鸿蒙系统交互的桥梁。Qt5 公开 API 145+ 个（2026-07-15 源码全扫补全，此前仅录 ~9 个）。 覆盖：窗口（setWindowCornerRadius/tryGetNativeWindowId/setShowWindowAsFloatWindowHint/隐私模式/常亮/拖拽缩放）、 Ability 启动（startAbility/startAbilityForResult★异步/startAppProcess/startNoUiChildProcess/startAbilityByType）、 权限申请、系统分享(ShareKit)、文件共享(FileShare)、设备迁移续接、启动选项(QOhosStartOptions)、 Want/WantInfo、剪贴板/文件/多媒体工具。使用：QT += ohosextras。Qt6 私有化。
- [qt-ohos-js-thread-gateway](../semantic/qt-ohos-js-thread-gateway.md) — Qt↔ArkTS/JS 线程桥接的私有 API：QOhosJsThreadGateway 命名空间（invoke/runAndWait/eval/ evalWithPromise/invokeAndWaitForContinue）是把 Qt 线程的调用安全 marshal 到唯一 JS 主线程的入口， QOhosJsThreadOps 是其背后的抽象接口（QPA 插件用 JsThreadOpsImpl 注册实现）。位于 QtCore 私有头 qcore_ohos_p.h，非公共 API。开发者用命名空间自由函数，不直接碰 QOhosJsThreadOps。
- [qt-ohos-project-analyzer-workflow](../semantic/qt-ohos-project-analyzer-workflow.md) — Qt项目移植OHOS的核心工作流：铁律约束、依赖梳理方法、编译编排流程、双重交验协议
- [qt515-vs-qt512-api-diff](../semantic/qt515-vs-qt512-api-diff.md) — QtWidgets 模块 Qt 5.15.16 vs 5.12.12 (OHOS SDK) 公共 API 完整差异报告： 1 个新头文件、67 个头文件有差异、~50 个新 API（QStyleOptionTabV4/QCalendar/Markdown/ExclusionPolicy/ OHOS 专有 QSystemTrayIcon/QFileDialog）、50+ 个废弃 API、Qt6 预备双重签名、迁移风险评估。

## procedural

- [demo-generation](../procedural/demo-generation.md) — 独立 Demo 生成工作流（六步闭环）：需求理解→技术设计→工程创建→代码编写→编译验证→文档沉淀。 适用于用户直接要求"写一个 demo"/"生成测试工程"等独立 demo 创建场景。 区别于框架问题分析中嵌入的复现 demo 生成。
- [fetch-ohos-third-party-lib](../procedural/fetch-ohos-third-party-lib.md) — 从 Harmonybrew 一键下载 arm64-OpenHarmony 预编译 bottle（.so）并校验解压， 免交叉编译即可链接到 Qt 鸿蒙工程。含依赖递归、qmake/CMake 链接片段、版本解析陷阱。
- [framework-fix-verification](../procedural/framework-fix-verification.md) — 框架问题修复验证工作流：获取验证清单→编写验证工程→人工手动验证→记录验证结果。 用于系统性地验证Qt框架bug修复的有效性。
- [framework-issue-analysis](../procedural/framework-issue-analysis.md) — 框架内部问题分析工作流（四阶段闭环）：复现demo生成→编译修复迭代→问题定位(日志法)→根因分析(框架代码调用链)→系统接口验证→上游issue打包提交（工作流最终步骤）。 阶段四为工作流闭合点：生成clean patch、整理issue说明单、输出纯Qt复现demo、更新知识库索引。 适用于Qt框架在鸿蒙平台的bug分析。
- [llvm-ohos-cross-compile](../procedural/llvm-ohos-cross-compile.md) — Qt/QLogo 接入 OHOS arm64 LLVM 15 静态库的 adapter：保留 Qt 目标链接、QLogo JIT 所需库闭包、部署与回归检查；通用 OHOS NDK/LLVM 交叉编译流程由 common 维护。
- [qt-app-harmonyos-completion](../procedural/qt-app-harmonyos-completion.md) — 应用鸿蒙化完善工作流（功能级测试用例闭环,四阶段）：扫描应用源码识别核心功能点→生成10核心测试用例（AI扫源码+人工review）→ 人工测试/反馈问题/修复/回归循环→10用例全pass闭合。前置：运行测试(qt-ohos-run-test)通过。 含三件套(ASCII循环图/循环退出条件✅10用例全pass/门控检查⚠️)。
- [qt-app-harmonyos-full-pipeline](../procedural/qt-app-harmonyos-full-pipeline.md) — 把 Qt 应用鸿蒙化分散工作流缝合为一份端到端编排：公共库提供 HarmonyOS 生命周期、窗口与平台限制的规范事实，本页负责将其落到 Qt 迁移、构建、签名、部署、测试和上库的 8 个阶段。覆盖 Qt5.12/5.15/6.12，并标注 Qt6 端到端 run+test 与应用分发缺口。
- [qt-app-harmonyos-migration](../procedural/qt-app-harmonyos-migration.md) — Qt应用鸿蒙化迁移工作流：评估可行性→创建工程结构→按8步决策树逐步迁移→编译验证→知识积累。 将其他平台的Qt应用迁移到HarmonyOS平台的端到端流程。
- [qt-bug-report-generation](../procedural/qt-bug-report-generation.md) — Bug report 生成工作流：从对话上下文或已有 problem 页提取信息→填内嵌模板→自检可复现性（HARD 闸门）→ 产出两种形态（form A 完整交付件交付华为 / form B 精简版贴 issue tracker）。外部伙伴只看本页 + 样例页即可学会写 bug report，模板结构内嵌于本页，不依赖任何内部模板文件。
- [qt-bug-report-sample](../procedural/qt-bug-report-sample.md) — 样例（形态 A）：Qt5.15 鸿蒙应用触发 onAcceptWant 时 @ohos.deviceInfo 裸 eval 被 ArkTS 运行时拒致崩溃； triage 结论 Qt 框架（陈旧胶水模板未 eager-import 注册模块），已 Qt 侧修复。
- [qt-cef-ohos-dev-guide](../procedural/qt-cef-ohos-dev-guide.md) — Qt + CEF 鸿蒙开发指导（公开·自含·版本中立）：鸿蒙 Qt 无 QtWebEngine（Out of scope），CEF for OpenHarmony （chromium_cef）是完整 Chromium 内核的 web 嵌入平替。**不绑定特定 Qt 版本**（Qt5.12/5.15/Qt6 通用，按 §5.1 读你 Qt OHOS SDK 头适配）。CEF 以**去版本化的组件包**提供——维护者从 chromium_cef 版本化下载剥离内核层（libcef.so+ wrapper+include+cmake+OHOS adapter）、按版本标注、与应用/胶水解耦，放指定位置供开发者下载；集成版本中立 （find_package(CEF)+CEF_ROOT，读组件 include/ 找该版本 API）。Part 1 版本稳定核心 + Part 2 集成实例（给定 CEF 组件包 + 你的 Qt OHOS SDK）。WebEngine→CEF API 映射 + 迁移步骤 + §5 版本升级适配方法论。
- [qt-ohos-run-test](../procedural/qt-ohos-run-test.md) — 鸿蒙化运行测试工作流（CLI全流程,七阶段闭环）：环境SDK预检→构建静态预检(DT_NEEDED/符号可见性/QML插件部署)→ 签名安装→启动运行时测试(渲染黑屏三类定位/Ability生命周期退出/窗口行为回归/输入事件/平台限制回归)→ 崩溃日志分析→修复回归→Playbook B Demo。聚焦让应用在真机跑起来,非全量功能验证(功能用例闭环见应用鸿蒙化完善)。 含三件套(ASCII循环图/循环退出条件✅/门控检查⚠️)。被应用移植/构建排障/修复验证复用。
- [qt6-ohos-manual-deploy](../procedural/qt6-ohos-manual-deploy.md) — 规避 harmonydeployqt6（Qt6.12 Beta2）5 个部署缺陷的手动部署流程：从 SDK templates 复制 DevEco 工程骨架 + 手动部署业务 .so + libqohos + Qt6 运行时 + QML 模块 qmldir + QML 插件 .so + QML 插件 Qt6 依赖 到正确位置（libs/ vs resfile/qml/）+ 配置 APP_LIBRARY_NAME + 签名 build。完全不调 harmonydeployqt6。
- [qt6-ohos-windows-cli-deploy](../procedural/qt6-ohos-windows-cli-deploy.md) — 用预构建安装器装的 Qt 6.12.0 Beta2 在 Windows 命令行端到端编译 Qt 项目并生成鸿蒙 DevEco 工程： 官方 wiki CLI 工作流（qt-cmake → cmake --build → harmonydeployqt6 → DevEco 签名装设备） + 本机实际路径（${QT6_INSTALL_ROOT}、${DEVECO_STUDIO} junction、API 23 native）+ 预构建省 patch（NEEDED 已裸名、qt_add_executable 自动 main GLOBAL DEFAULT）。补 wiki 未覆盖的 QT_CHAINLOAD_TOOLCHAIN_FILE 必填、DevEco 空格陷阱、_make_hap 一键目标、签名六件套。

## episodic

- [coin3d-quarter-ohos](../episodic/postmortems/coin3d-quarter-ohos.md) — Coin3D Quarter 鸿蒙化完整迁移：交叉编译 libQuarter.so (ARM aarch64) + Demo 应用构建 (37MB HAP) + 3D 渲染验证通过。关键发现：OHOS Qt5 不含 UiTools 模块、FindOpenGL 需自定义（OHOS 用 GLES/EGL）、 CMAKE_FIND_ROOT_PATH_MODE ONLY 需绝对路径绕过、hvigor 需 DEVECO_SDK_HOME。 可复用：OHOS 交叉编译 CMake 模板 + FindOpenGL 映射模式 + 预编译库集成模式。
- [ohostemplate-blockedbymodal-patch](../episodic/postmortems/ohostemplate-blockedbymodal-patch.md) — ohostemplate matplotlib 三级窗口(Configure subplots->Export values)关不掉。根因：无 parent 的 QDialog 经 syntheticParent fallback 分类为 SubWindow，但 OHOS QPA 从不调 setTransientParent() 反写 Qt 层， 导致 blockedByModalWindow=1 拦截 close()。Qt 源码修复：showImmediate() 在 fallback 后反写 transientParent（约8 行 qohosview.cpp），设备日志验证 blockedByModalWindow=0、close()=1。 同时发现并修复 ArkTS 模板版本不匹配崩溃（modules->modulesFactories）。
- [quit-deadlock-tsfn](../episodic/postmortems/quit-deadlock-tsfn.md) — 退出死锁复盘：<STAKEHOLDER>(<PRODUCT>) qApp->quit()后应用卡死~2分钟。 根因：HarmonyOS在Ability销毁阶段不处理N-API ThreadSafeFunction回调， 导致qWindowDestroyPromise的resolve回调永远不被执行，Promise永不resolve。 修复：外部补丁通过原子变量+并行轮询绕过TSFN机制，已验证有效。 关联确认：退出流程中sensor插件触发崩溃，伙伴确认移除即规避（2026-07-13）。
- [saribbon-ohos](../episodic/postmortems/saribbon-ohos.md) — SARibbon v2.5.5 鸿蒙化完整迁移：独立构建文件 + MainWindowExample 应用编译 (48MB HAP) + 两个编译问题修复（QDesktopWidget::screen 类型不匹配 + lazy import 语法不兼容）。 关键发现：SARibbon 源码内 QDesktopWidget API 在 Qt 5.12 OHOS 下返回 QWidget* 而非 QScreen*、 模板 lazy import 语法需 API 12 beta3、需为项目创建独立 CMakeLists.txt 避免改源码。 可复用：三方 Qt 库鸿蒙化时保持源码完整性的独立构建文件模式。
- [toolwindow-crossscreen-flicker](../episodic/postmortems/toolwindow-crossscreen-flicker.md) — ToolWindow跨屏闪烁系统问题分析：moveWindowToGlobalDisplay与resizeAsync在跨屏拖拽场景冲突， screenIdChanged仅拖拽结束时触发，Qt已通过完整调用链追踪定位根因，归属鸿蒙系统接口。
- [wa-nativewindow-leave-bug](../episodic/postmortems/wa-nativewindow-leave-bug.md) — WA_NativeWindow Leave 事件不灵敏 Bug 完整分析：双重盲区根因（Qt Widget 层 internalWinId() 跳过 + OHOS QPA hover 回调不可靠）、完整调用链追踪、 修复策略评估（3 种方案对比）、10 场景风险矩阵、时序图。Qt 5.12 OHOS。 ✅ 手动验证通过，交付件已输出至 <WORK_DIR>/leave-event-fix/（2026-06-09 最终整理）。

## preference

_（本域无活跃页）_

## problems

- [_lookup](../problems/_lookup.md) — 错误速查表（41 条）

## faults

- [_index](../faults/_index.md) — 故障库规范（四实体图模型）：症状 S × 根因 C（defect/limitation）× 临时方案 W × 跟踪单 T；三类状态机、单一真源与派生物、录入复核规则、tools/faults-build.py 用法。
- [_registry](../faults/_registry.md) — 故障登记总表（派生物，build 自动重建）：症状索引（主入口）、按处置分类（鸿蒙必须适配/Qt 问题/系统问题/应用使用问题）、缺陷/限制/方案/跟踪单清单、关系速览、按版本基线升级检查、复核到期。
- [_graph.yaml](../faults/_graph.yaml) — 机读全量故障图（派生物：节点+边+聚合+反查索引，单文件一次加载）。真源在 `_data/*.yaml` + C 页。


---

## 快速查找指南

| 我想知道... | 去看哪类知识 |
|------------|------------|
| 某个技术/概念是什么 | semantic |
| 某件事怎么操作 | procedural |
| 某个项目经验 | episodic |
| 遇到某个错误怎么办 | problems → _lookup.md |
| 某个问题修了没/未解决清单/临时方案 | faults → _registry.md |
| Qt 鸿蒙化的某个方面 | semantic → qt-harmonyos-* |
| 某个 Qt 模块是否在鸿蒙支持 | semantic → qt-harmonyos-modules |
| 鸿蒙平台有什么限制 | semantic → qt-harmonyos-platform-limits |
| 分析 Qt 应用 bug / 定位问题 | procedural → framework-issue-analysis |
| 验证修复是否生效 | procedural → framework-fix-verification |
| 把 Qt 应用迁移到鸿蒙 | procedural → qt-app-harmonyos-migration |
| 让工具自动执行迁移/验证 | skills → qt-app-porting + tools/qt-ohos-run.py |
| 创建独立 demo / 测试工程 | procedural → demo-generation |

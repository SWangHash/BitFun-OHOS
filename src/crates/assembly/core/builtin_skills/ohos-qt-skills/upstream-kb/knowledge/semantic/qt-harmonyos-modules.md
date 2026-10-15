---
id: semantic-qt-harmonyos-modules
type: semantic
domain: tech
tags: [qt, harmonyos, modules, qt5, adaptation-status]
created: 2026-06-02
updated: 2026-09-18
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, problem-ohos-missing-qt5uitools]
summary: >
  Qt 5.12/5.15 鸿蒙模块适配状态速查（对照 wiki 矩阵，2026-09-18 刷新）：
  核心模块全部 Completed；QtMultimedia wiki 标 Completed 但官方 Qt5 SDK 未含
  CMake/QML 模块，Qt-full 全量构建已含（含 QOhosAudio/QOhosMediaService 插件）；
  不支持的模块(QtWebEngine/D-Bus/RemoteObjects/SerialBus/VirtualKeyboard 等)；
  仅 5.15：QtPDF/QtQuickTimeline/Lottie/Quick3D；仅 5.12：QtXmlPatterns。
---

# Qt 模块鸿蒙适配状态

> 来源：[Qt5 Module Adaptation Status](https://wiki.qt.io/Qt_for_HarmonyOS/support_modules)（矩阵基准 Qt 5.12.12 / Qt 5.15.15，2026-09-18 检索）
>
> 表内 ✅/❌ 为 **wiki 适配状态**；「Qt-full 实测」指本地全量构建 SDK（`QT5_15_OHOS_SDK`，基于 tqtc/harmonyos-5.15.16 @ 962aa625）的核对结果。两者不一致时先读备注。

## 快速查找

> **生态面统计**（2026-06 对 229 个开源 Qt 桌面应用的抽样普查）：D-Bus（107 个）、
> QtMultimedia（76 个）、QtWebEngine（62 个）是出现频率最高的三大阻断模块——
> 评估任何 Qt 应用时优先核查这三项。

| 我想确认... | 看下表哪行 |
|------------|-----------|
| 某个核心模块是否支持 | Essentials 区域 |
| WebEngine 是否可用 | Add-Ons → Qt WebEngine（Out of scope） |
| 3D 渲染是否支持 | Add-Ons → Qt 3D（Completed）；Qt Quick 3D 仅 5.15 |
| 数据库是否支持 | Essentials → Qt SQL（Completed） |
| 多媒体能不能用 | Essentials → Qt Multimedia（wiki Completed；官方 SDK 未含，Qt-full 已含） |
| 图表是否可用 | Add-Ons → Qt Charts（Completed） |

## Essentials（核心模块）

| 模块 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt Core | ✅ | ✅ | 信号槽、对象树、属性系统 |
| Qt GUI | ✅ | ✅ | 窗口集成、事件、OpenGL/ES、2D 图形、字体文本 |
| Qt Widgets | ✅ | ✅ | C++ 经典桌面风格 UI |
| Qt QML | ✅ | ✅ | QML 语言和引擎基础设施 |
| Qt Quick | ✅ | ✅ | QML 声明式 UI 标准库 |
| Qt Quick Controls | ✅ | ✅ | 轻量 QML 控件（Qt-full 实测含 Controls 1 QML 与 Controls 2 四种样式） |
| Qt Quick Dialogs | ✅ | ✅ | 系统对话框 |
| Qt Quick Layouts | ✅ | ✅ | QML 布局 |
| Qt Quick Test | ✅ | ✅ | QML 单元测试 |
| Qt Network | ✅ | ✅ | TCP/IP、HTTP、Cookie（Qt-full 含 QOhosBearerEnginePlugin） |
| Qt SQL | ✅ | ✅ | 数据库集成（SQLite 驱动在） |
| Qt Test | ✅ | ✅ | 单元测试 |
| Qt Multimedia | ✅ | ✅ | wiki Completed；**官方 Qt5 SDK 未含 CMake/QML 模块（2026-06-11 验证），需自行编译**；Qt-full 全量构建已含 libQt5Multimedia.so + QOhosAudioPlugin/QOhosMediaServicePlugin + QtMultimedia QML（2026-09-18 复核） |
| Qt Multimedia Widgets | ✅ | ✅ | 随 Qt Multimedia：官方 SDK 未含；Qt-full 已含（2026-09-18 复核） |

## Add-Ons — 已完成 ✅

| 模块 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt 3D (全子模块) | ✅ | ✅ | 近实时 2D/3D 渲染（Qt-full 实测 Core/Input/Logic/Render/Animation/Extras/Quick 全套在） |
| Qt Bluetooth | ✅ | ✅ | 蓝牙硬件访问 |
| Qt Charts | ✅ | ✅ | 图表组件（Qt-full 实测含 libQt5Charts.so + QtCharts QML） |
| Qt Concurrent | ✅ | ✅ | 多线程（不用底层原语） |
| Qt Data Visualization | ✅ | ✅ | 3D 数据可视化（wiki 标 Completed；5.15.16 源码无 ohos{} scope + warning_clean，需补 `ohos{ -Wno-deprecated-declarations -Wno-misleading-indentation }` patch 才能在 API 26 SDK 编，同 qt3d/qtcharts 警告抑制模式；Qt-full 构建未含） |
| Qt Graphical Effects | ✅ | ✅ | Quick 2 图形效果（Qt-full 实测含 QML 插件） |
| Qt Help | ✅ | ✅ | 文档集成；qttools 在鸿蒙上仅能 PC 主机编译，官方 SDK 与 Qt-full 均未含 → `problems/build-missing-qt5uitools-ohos.md` |
| Qt Image Formats | ✅ | ✅ | TIFF/MNG/TGA/WBMP |
| Qt Lottie Animation | ❌ | ✅ | **仅 5.15 支持**；Qt-full 实测含 libQt5Bodymovin.so |
| Qt Location | ✅ | ✅ | 地图导航（Qt-full 含 OhosMapKit 地图服务插件） |
| Qt Network Authorization | ✅ | ✅ | OAuth 授权；**Qt-full 5.15.16 全量构建未含 libQt5NetworkAuthorization.so（2026-09-18 核）**，用前先确认 kit |
| Qt PDF | ❌ | ✅ | **仅 5.15 支持**；Qt-full 全量构建亦未含 libQt5Pdf.so（2026-09-18 核） |
| Qt Platform Headers | ✅ | ✅ | 平台特定信息封装 |
| Qt Positioning | ✅ | ✅ | 定位/卫星/区域（Qt-full 含 OHOS 定位后端） |
| Qt Print Support | ✅ | ✅ | 打印（Qt-full 含 QOhosPrinterSupportPlugin） |
| Qt Quick 3D | ❌ | ✅ | **仅 5.15 支持**；Qt-full 实测含 Quick3D 全套 C++ 库与 QML（Effects/Materials/Helpers） |
| Qt Quick Extras | ✅ | ✅ | 专用控件 |
| Qt Quick Timeline | ❌ | ✅ | **仅 5.15 支持**；Qt-full 构建未含 libQt5QuickTimeline.so（2026-09-18 核） |
| Qt Quick WebGL | ✅ | ✅ | Quick UI 经 WebGL 网络串流；Qt-full 构建未见 QWebGL 平台插件（2026-09-18 核） |
| Qt Quick Widgets | ✅ | ✅ | Widget 中显示 Quick UI |
| Qt SCXML | ✅ | ✅ | SCXML 状态机 |
| Qt Sensors | ✅ | ✅ | 传感器硬件（Qt-full 含 QOhosSensorPlugin） |
| Qt Serial Port | ✅ | ✅ | 物理/虚拟串口 |
| Qt Speech | ✅ | ✅ | 文字转语音（Qt-full 含 QTextToSpeechEngineOhos） |
| Qt SVG | ✅ | ✅ | SVG 渲染 |
| Qt UI Tools | ✅ | ✅ | 运行时加载 Designer 表单；同 Qt Help 仅鸿蒙PC主机编译，SDK/Qt-full 均未含 → `problems/build-missing-qt5uitools-ohos.md` |
| Qt WebChannel | ✅ | ✅ | Qt↔HTML/JS 集成 |
| Qt WebSockets | ✅ | ✅ | RFC 6455 WebSocket |
| Qt WebView | ✅ | ✅ | 原生 WebView（Qt-full 含 QOhosWebViewPlugin）；完整浏览器内核用 CEF for OpenHarmony |
| Qt XML | ✅ | ✅ | SAX/DOM C++ 实现（QXmlStreamReader/Writer 属 Qt Core） |
| Qt XML Patterns | ✅ | ❌ | **仅 5.12 支持**（wiki：5.12 Completed / 5.15 Out of scope）；XPath/XQuery/XSLT |

## Add-Ons — 不在范围内 ❌ (Out of scope)

| 模块 | 原因 |
|------|------|
| Active Qt | Windows 专属（ActiveX/COM） |
| Qt Android Extras | Android 专属 |
| Qt D-Bus | 鸿蒙无 D-Bus |
| Qt Gamepad | wiki 目标平台 Android/iOS/macOS/tvOS/Linux/Windows，不含鸿蒙 |
| Qt Mac Extras | macOS 专属 |
| Qt NFC | wiki 目标平台仅 Android/Linux；**Qt-full 全量构建实测含 libQt5Nfc.so + QtNfc QML（2026-09-18）**，适配未经验证，按受限对待 |
| Qt Purchasing | Android/iOS/macOS 应用内购买 |
| Qt Remote Objects | 不在范围内（Qt6 预构建已含，见 qt-harmonyos-qt6-status） |
| Qt Serial Bus | Windows/Linux/Boot to Qt 专属 |
| Qt Virtual Keyboard | wiki Out of scope；**Qt-full 全量构建实测含 libQt5VirtualKeyboard.so + 拼音/OpenWnn/Hangul 等输入法插件（2026-09-18）**——软键盘需求用 Qt-full 或自行编译 |
| Qt WebEngine (全子模块) | Windows/Linux/macOS 专属（Chromium）；替代方案 CEF for OpenHarmony |
| Qt Win Extras | Windows 专属 |
| Qt X11 Extras | X11 专属 |
| Qt Wayland Compositor | Linux/Wayland 合成器框架，鸿蒙窗口模型非 Wayland |
| Qt for WebAssembly | 浏览器平台目标，与鸿蒙设备形态无关 |
| Qt Automotive Suite | 车载产品套件（Value-Add） |
| Qt for Automation | 自动化产品（KNX/OPC UA/MQTT，Value-Add） |
| Qt for MCUs | MCU 平台产品（Value-Add） |

## Tools（Qt 工具）

| 模块 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt Designer | ✅ | ✅ | Designer 扩展类；qttools 同受鸿蒙PC主机编译限制，Qt-full 未含 |
| Qt Distance Field Generator | ❌ | ✅ | 仅 5.15；文本距离场生成工具 |

## Value-Add（增值产品）

| 产品 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt for Device Creation | ✅ | ✅ | 嵌入式设备应用开发产品（Boot to Qt 类工具链） |

## 本地验证记录（Qt-full 5.15.16，2026-09-18）

验证对象：`QT5_15_OHOS_SDK`（Qt-full 全量构建，arm64-v8a，tqtc/harmonyos-5.15.16 @ 962aa625）；方法：lib/cmake、lib/libQt5*.so、qml/ 三层核对。

- **wiki Completed 且实测在**：Charts、XML、Lottie(Bodymovin)、Quick 3D 全套、Multimedia（含 QOhosAudio/QOhosMediaService 插件）、Bluetooth、Location（含 OhosMapKit）、Positioning/Sensors/TextToSpeech/WebView/PrintSupport（含 OHOS 后端插件）、Quick Controls 1+2、GraphicalEffects、QuickWidgets、QuickShapes/Particles、Scxml、WebSockets、WebChannel、SerialPort、Concurrent、OpenGL、OhosExtras。
- **wiki Completed 但实测缺**：DataVisualization（需警告抑制 patch）、Help/UiTools（仅鸿蒙PC主机编译）、Pdf、QuickTimeline、NetworkAuthorization、Quick WebGL（QWebGL 平台插件未见）。
- **wiki Out of scope 但实测在（适配未验证，慎用）**：Nfc、VirtualKeyboard。
- 注意：wiki 矩阵基准为 5.15.15，本地验证为 5.15.16；wiki「Completed」指适配完成，不等于官方 SDK 二进制必含（Multimedia 为先例）。

## 参考来源

- [Qt for HarmonyOS Module Adaptation Status](https://wiki.qt.io/Qt_for_HarmonyOS/support_modules)（英文，检索 2026-09-18）
- [中文版镜像](https://wiki.qt.io/Qt_for_HarmonyOS/support_modules_zh)

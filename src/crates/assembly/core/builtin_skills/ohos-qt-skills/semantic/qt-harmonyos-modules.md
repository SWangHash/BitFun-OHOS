---
id: semantic-qt-harmonyos-modules
type: semantic
domain: tech
tags: [qt, harmonyos, modules, qt5, adaptation-status]
created: 2026-06-02
updated: 2026-06-11
status: active
audience: public
refs: [semantic-qt-harmonyos-overview]
summary: >
  Qt 5.12/5.15 鸿蒙模块适配状态速查：核心模块(QtCore/GUI/Widgets/QML/Quick/
  Network/SQL)全部完成；**QtMultimedia 未包含在 SDK 中**（需自行编译）；
  不支持的模块(QtWebEngine/D-Bus/RemoteObjects/SerialBus)；
  部分支持的模块(QtPDF/QtQuickTimeline 仅5.15)。
---

# Qt 模块鸿蒙适配状态

> 来源：[Qt5 Module Adaptation Status](https://wiki.qt.io/Qt_for_HarmonyOS/support_modules)

## 快速查找

| 我想确认... | 看下表哪行 |
|------------|-----------|
| 某个核心模块是否支持 | Essentials 区域 |
| WebEngine 是否可用 | Add-Ons → Qt WebEngine（Out of scope） |
| 3D 渲染是否支持 | Add-Ons → Qt 3D（Completed） |
| 数据库是否支持 | Essentials → Qt SQL（Completed） |

## Essentials（核心模块）

| 模块 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt Core | ✅ | ✅ | 信号槽、对象树、属性系统 |
| Qt GUI | ✅ | ✅ | 窗口集成、事件、OpenGL/ES、2D 图形、字体文本 |
| Qt Widgets | ✅ | ✅ | C++ 经典桌面风格 UI |
| Qt QML | ✅ | ✅ | QML 语言和引擎基础设施 |
| Qt Quick | ✅ | ✅ | QML 声明式 UI 标准库 |
| Qt Quick Controls | ✅ | ✅ | 轻量 QML 控件 |
| Qt Quick Dialogs | ✅ | ✅ | 系统对话框 |
| Qt Quick Layouts | ✅ | ✅ | QML 布局 |
| Qt Quick Test | ✅ | ✅ | QML 单元测试 |
| Qt Network | ✅ | ✅ | TCP/IP、HTTP、Cookie |
| Qt SQL | ✅ | ✅ | 数据库集成 |
| Qt Test | ✅ | ✅ | 单元测试 |
| Qt Multimedia | ❌ | ❌ | **SDK 未包含**，wiki 标注 Completed 但实际 SDK 无 CMake/QML 模块（2026-06-11 验证） |
| Qt Multimedia Widgets | ❌ | ❌ | **SDK 未包含**，随 Qt Multimedia 一起缺失 |

## Add-Ons — 已完成 ✅

| 模块 | 5.12 | 5.15 | 备注 |
|------|------|------|------|
| Qt 3D (全子模块) | ✅ | ✅ | 近实时 2D/3D 渲染 |
| Qt Data Visualization | ✅ | ✅ | 3D 数据可视化（wiki 标 Completed；5.15.16 源码无 ohos{} scope + warning_clean，需补 `ohos{ -Wno-deprecated-declarations -Wno-misleading-indentation }` patch 才能在 API 26 SDK 编，同 qt3d/qtcharts 警告抑制模式） |
| Qt Bluetooth | ✅ | ✅ | 蓝牙硬件访问 |
| Qt Concurrent | ✅ | ✅ | 多线程（不用底层原语） |
| Qt Graphical Effects | ✅ | ✅ | Quick 2 图形效果 |
| Qt Help | ✅ | ✅ | 文档集成 |
| Qt Image Formats | ✅ | ✅ | TIFF/MNG/TGA/WBMP |
| Qt Location | ✅ | ✅ | 地图导航 |
| Qt PDF | ❌ | ✅ | **仅 5.15 支持** |
| Qt Platform Headers | ✅ | ✅ | 平台特定信息封装 |
| Qt Positioning | ✅ | ✅ | 定位/卫星/区域 |
| Qt Print Support | ✅ | ✅ | 打印 |
| Qt Quick Extras | ✅ | ✅ | 专用控件 |
| Qt Quick Timeline | ❌ | ✅ | **仅 5.15 支持** |
| Qt Quick Widgets | ✅ | ✅ | Widget 中显示 Quick UI |
| Qt SCXML | ✅ | ✅ | SCXML 状态机 |
| Qt Sensors | ✅ | ✅ | 传感器硬件 |
| Qt Serial Port | ✅ | ✅ | 物理/虚拟串口 |
| Qt Speech | ✅ | ✅ | 文字转语音 |
| Qt SVG | ✅ | ✅ | SVG 渲染 |
| Qt UI Tools | ✅ | ✅ | 运行时加载 Designer 表单 |
| Qt WebChannel | ✅ | ✅ | Qt↔HTML/JS 集成 |
| Qt WebSockets | ✅ | ✅ | RFC 6455 WebSocket |
| Qt WebView | ✅ | ✅ | 原生 WebView |

## Add-Ons — 不在范围内 ❌ (Out of scope)

| 模块 | 原因 |
|------|------|
| Active Qt | Windows 专属（ActiveX/COM） |
| Qt Android Extras | Android 专属 |
| Qt D-Bus | 鸿蒙无 D-Bus |
| Qt Gamepad | 无手柄支持 |
| Qt Mac Extras | macOS 专属 |
| Qt NFC | 无 NFC 支持 |
| Qt Purchasing | Android/iOS/macOS 应用内购买 |
| Qt Remote Objects | 不在范围内 |
| Qt Serial Bus | Windows/Linux 专属 |
| Qt WebEngine (全子模块) | Windows/Linux/macOS 专属（Chromium） |
| Qt Win Extras | Windows 专属 |
| Qt X11 Extras | X11 专属 |

## 参考来源

- [Qt for HarmonyOS Module Adaptation Status](https://wiki.qt.io/Qt_for_HarmonyOS/support_modules)

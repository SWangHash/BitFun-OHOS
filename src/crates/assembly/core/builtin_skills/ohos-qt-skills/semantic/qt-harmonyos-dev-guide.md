---
id: semantic-qt-harmonyos-dev-guide
type: semantic
domain: tech
tags: [qt, harmonyos, dev-guide, lifecycle, window, qml, deployment, floating, continuation, sharing]
created: 2026-06-02
updated: 2026-06-02
status: archived
audience: public
archive_date: 2026-06-03
archive_reason: 纯链接索引页，12/13 主题已在 lifecycle/window-model/build 等页蒸馏，wiki URL 路径已变更
superseded_by: semantic-qt-harmonyos-lifecycle
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-api, semantic-qt-ohos-extras]
summary: >
  Qt 鸿蒙化开发指南索引：涵盖应用生命周期、主窗口/子窗口开发、嵌入式子窗口、
  后台子进程、QOhosWant 用法、参数传递、QML 部署、深色/浅色模式、全屏启动、
  浮窗、接续流转、分享功能、DevEco CMake 交叉编译。
---

# Qt for HarmonyOS 开发指南索引

> 来源：[User Development Guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide)

## 指南列表

| 主题 | Wiki 链接 | 简述 |
|------|----------|------|
| DevEco CMake 交叉编译 | [deveco_cmake_guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/deveco_cmake_guide_cross_compile) | 在 DevEco Studio 中用 CMake 构建 Qt 应用 |
| 应用生命周期与交互 | [application_lifecycle_guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_lifecycle_guide) | Ability 生命周期、启动/退出、Want 交互 |
| 主窗口与子窗口 | [mainwindow_subwindow](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/mainwindow_and_subwindow_guide) | 主窗口/子窗口开发规范 |
| 嵌入式子窗口 | [embedded_subwindow](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/embedded_subwindow_guide) | 嵌入式子窗口开发指南 |
| 后台子进程 | [uiless_child_process](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_start_uiless_child_process) | 启动无 UI 后台子进程 |
| QOhosWant 用法 | [QOhosWant](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_use_QOhosWant) | 使用 Want 进行跨 Ability 通信 |
| 参数传递到 main() | [pass_args_to_main](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_pass_args_to_main_guide) | 如何向 Qt main() 传递参数 |
| QML 应用部署 | [deploy_qml_app](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_deply_qml_app) | QML 应用的部署方式 |
| 深色/浅色模式 | [color_theme](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/qt_for_harmonyos_color_theme) | 适配系统深色/浅色主题 |
| 全屏主窗口启动 | [fullscreen_main_window](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/qt_for_harmonyos_fullscreen_main_window) | 全屏启动主窗口 |
| 浮窗开发 | [floating_window](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/floating_window_guide) | 浮窗功能开发指南 |
| 应用接续流转 | [continuation](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_continuation_guild) | 跨设备应用接续 |
| 应用分享 | [sharing](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_share_guild) | 应用分享功能开发 |

## 关键注意事项

### 设备类型配置
项目 `entry/src/main/module.json5` 中的 `module.deviceTypes` 需要调整：
- 示例项目通常只有 `"phone"`
- 如需支持平板/PC，需添加 `"tablet"`, `"2in1"`

### 主窗口 vs 子窗口
- **主窗口**：对应鸿蒙 Ability 的主界面，有系统级生命周期
- **子窗口**：Qt 内部创建的弹出窗口、对话框等，生命周期依赖主窗口
- 两者在模态、最小化、全屏、hide() 等方面行为差异很大

## 参考来源

- [User Development Guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide)
- [HarmonyOS Development Fundamentals](https://wiki.qt.io/HarmonyOS_Development_Fundamentals)

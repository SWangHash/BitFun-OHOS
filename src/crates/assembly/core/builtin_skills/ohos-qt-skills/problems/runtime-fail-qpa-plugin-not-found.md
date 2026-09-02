---
id: problem-runtime-qpa-plugin-not-found
type: problem
domain: runtime
tags: [runtime, QPA, libqohos, dlopen, platform-plugin]
created: 2026-06-03
updated: 2026-06-03
status: solved
audience: public
summary: "应用启动即崩溃，报 dlopen libqohos.so not found / QPA plugin qohos 加载失败"
severity: critical

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  dlopen failed: library "libqohos.so" not found
  Cannot load Qt platform plugin "qohos"
  This application failed to start because it could not find or load the Qt platform plugin "qohos"
error_code: ""
keywords: [libqohos, QPA, platform plugin, dlopen, QOhosPlatformIntegrationPlugin]
symptoms: "应用启动后立即崩溃，日志报 dlopen failed 或 platform plugin not found"

# ====== 问题详情 ======
environment: "Qt 5.12/5.15 for HarmonyOS, 真机或模拟器"
refs: [semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-build, semantic-qt-harmonyos-golden-rules]
related_problems: [problem-cmake-findpackage-ohosextras-fail, problem-runtime-dlopen-writable-path]
---

# QPA 平台插件未部署导致启动崩溃

## 错误信息

```
E Qt      : dlopen failed: library "libqohos.so" not found
F Qt      : Cannot load Qt platform plugin "qohos"
F Qt      : This application failed to start because it could not find or load the Qt platform plugin "qohos"
```

或通过 hdc 日志查看：

```
$ hdc shell hilog | grep -i "qohos\|platform"
E Qt: dlopen failed: library "libqohos.so" not found
```

## 场景

应用编译成功，HAP 安装到设备/模拟器后启动，立即崩溃（黑屏后闪退）。日志显示找不到 `libqohos.so`。

## 原因

`libqohos.so` 是 Qt for HarmonyOS 的 QPA（Qt Platform Abstraction）平台插件，负责将 Qt 窗口系统桥接到鸿蒙的 ArkUI 框架。如果 CMakeLists.txt 中没有链接 `QOhosPlatformIntegrationPlugin`，构建系统不会将 `libqohos.so` 复制到应用的 `entry/libs/arm64-v8a/` 目录。

运行时 Qt 核心库尝试 `dlopen("libqohos.so")` 加载平台插件，在应用 lib 目录中找不到，导致崩溃。

## 解决方案

### 1. CMakeLists.txt 中添加 QPA 插件链接

```cmake
target_link_libraries(QtHarmonyApp PRIVATE
    Qt${QT_VERSION_MAJOR}::Core
    Qt${QT_VERSION_MAJOR}::Widgets
    # ★ 必须链接 QPA 平台插件
    Qt${QT_VERSION_MAJOR}::QOhosPlatformIntegrationPlugin
)
```

### 2. 验证 .so 已部署

```bash
ls entry/libs/arm64-v8a/libqohos.so
# 应该输出文件路径
```

### 3. 同时检查样式插件

`libqohosstyle.so` 需要手动复制到子目录：

```bash
mkdir -p entry/libs/arm64-v8a/styles/
cp <Qt_SDK>/lib/styles/libqohosstyle.so entry/libs/arm64-v8a/styles/
```

## 注意事项

- 这是黄金法则 B2：**必须链接 QOhosPlatformIntegrationPlugin**
- `libqohos.so` 的部署是**自动的**（通过 CMake target_link_libraries），但 `libqohosstyle.so` 需要**手动**复制到 `styles/` 子目录
- 如果还看到 `dlopen failed: library "libQt5Core.so" not found`，说明 Qt 核心库也没有正确部署——检查 `find_package` 和 `target_link_libraries` 配置
- `dlopen()` 只能从应用 lib 目录（只读）加载 .so，不能从可写路径加载（平台限制 P3）

## 相关

- [[qt-harmonyos-project-structure]] — §6 Qt 运行时库部署
- [[qt-harmonyos-build]] — 构建配置
- [[qt-harmonyos-golden-rules]] — 规则 B2/B7
- [[qt-harmonyos-platform-limits]] — dlopen 限制

### 相关问题

- [build-fail-cmake-ohosextras](build-fail-cmake-ohosextras.md) — 上游原因：CMake 配置错误可能导致 QPA 插件未链接
- [runtime-fail-dlopen-writable-path](runtime-fail-dlopen-writable-path.md) — 同类 dlopen 失败，但原因是可写路径而非缺失文件

> 📋 返回 [错误速查表](_lookup.md)

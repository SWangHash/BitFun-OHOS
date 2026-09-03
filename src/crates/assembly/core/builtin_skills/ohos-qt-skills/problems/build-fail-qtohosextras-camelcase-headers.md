---
id: build-fail-qtohosextras-camelcase-headers
type: problem
domain: build
tags: [cmake, qtohosextras, include, qt5.12, camelcase, harmonyos]
created: 2026-06-03
updated: 2026-06-03
status: solved
audience: public
summary: "Qt5.12 SDK 编译报 QtOhosExtras CamelCase 头文件不存在（如 QOhosAppContext）"
severity: medium
error_code: N/A
error_message: "fatal error: 'QtOhosExtras/QOhosAppContext' file not found"
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-project-structure]
---

# QtOhosExtras CamelCase 头文件不存在（Qt5.12 SDK）

## 错误信息

```
mainwindow.cpp:12:10: fatal error: 'QtOhosExtras/QOhosAppContext' file not found
#include <QtOhosExtras/QOhosAppContext>
         ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## 场景

在 DevEco Studio 构建环境中编译 Qt for HarmonyOS 项目时，使用 CamelCase 风格的 `#include` 路径（如 `<QtOhosExtras/QOhosAppContext>`）会导致头文件找不到。

## 根因

**DevEco 构建系统使用的是 Qt5.12.12 SDK**（而非 `entry/build-profile.json5` 中 `CMAKE_PREFIX_PATH` 指定的 Qt5.15.16）。

Qt5.12 SDK 中 QtOhosExtras 模块**没有 CamelCase 前向头文件**（如 `QOhosAppContext`、`QOhosWindowUtils`），只有小写的 `.h` 文件：

| CamelCase（Qt5.15+） | 小写（Qt5.12） |
|----------------------|---------------|
| `<QtOhosExtras/QOhosAppContext>` | `<QtOhosExtras/qohosappcontext.h>` |
| `<QtOhosExtras/QOhosWindowUtils>` | `<QtOhosExtras/qohoswindowutils.h>` |
| `<QtOhosExtras/QOhosUiAbilityContext>` | `<QtOhosExtras/qohosuiabilitycontext.h>` |
| `<QtPlatformHeaders/QOhosFunctions>` | `<QtPlatformHeaders/QOhosFunctions>` ✅ 两者都有 |

**注意**：命名空间不变，Qt5.12 和 Qt5.15 都在 `QtOhosExtras::` 命名空间中。

## 解决方案

### 方案 1：使用小写头文件路径（兼容 Qt5.12 + Qt5.15）

```cpp
#ifdef Q_OS_OHOS
#include <QtOhosExtras/qohosappcontext.h>
#include <QtOhosExtras/qohoswindowutils.h>
#include <QtPlatformHeaders/QOhosFunctions>
#endif
```

### 方案 2：确保使用 Qt5.15 SDK

如果必须使用 CamelCase 路径，需确保 DevEco 构建系统使用 Qt5.15 SDK（可能需要更新 DevEco Studio 或手动配置 SDK 路径）。

## 改动文件

- `entry/src/main/cpp/mainwindow.cpp` — 修改 `#include` 路径为小写
- `entry/src/main/cpp/CMakeLists.txt` — 添加 `find_package(Qt5 COMPONENTS OhosExtras)` + fallback

## 额外发现

1. **DevEco 构建系统覆盖 CMAKE_PREFIX_PATH**：`entry/build-profile.json5` 中设置的 `-DCMAKE_PREFIX_PATH=<LOCAL_PATH>` 被 DevEco 构建系统覆盖，实际使用的是 Qt5.12.12 SDK
2. **`compatibleSdkVersion` 需升级**：模板中的 `import lazy` 语法需要 `"compatibleSdkVersion": "5.0.5(17)"`，原来的 `"5.0.0(12)"` 不支持

## 验证

修改后重新 `hvigorw assembleHap` 编译成功，生成 `entry-default-unsigned.hap`。

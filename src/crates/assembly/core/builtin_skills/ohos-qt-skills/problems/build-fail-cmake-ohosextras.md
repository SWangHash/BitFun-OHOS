---
id: problem-cmake-findpackage-ohosextras-fail
type: problem
domain: build
tags: [cmake, ohosextras, find_package, qmake, build-failure]
created: 2026-06-03
updated: 2026-06-03
status: solved
audience: public
summary: "CMake configure 报 find_package 找不到 OhosExtras/Qt5OhosExtras 包（缺 FindOhosExtras.cmake）"
severity: high

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  CMake Error: By not providing "FindOhosExtras.cmake" in CMAKE_MODULE_PATH
  this project has asked CMake to find a package configuration file provided by
  "OhosExtras", but CMake did not find one.
  Could not find a package configuration file provided by "Qt5OhosExtras"
error_code: ""
keywords: [find_package, OhosExtras, Qt5OhosExtras, CMake, CONFIG-=create_cmake]
symptoms: "CMake configure 阶段报错 find_package 找不到 OhosExtras 包"

# ====== 问题详情 ======
environment: "Qt 5.12/5.15 for HarmonyOS, CMake 交叉编译"
refs: [semantic-qt-ohos-extras, semantic-qt-harmonyos-build, semantic-qt-harmonyos-golden-rules]
related_problems: [problem-runtime-qpa-plugin-not-found]
---

# CMake find_package(OhosExtras) 失败

## 错误信息

```
CMake Error at CMakeLists.txt:XX (find_package):
  By not providing "FindOhosExtras.cmake" in CMAKE_MODULE_PATH this project
  has asked CMake to find a package configuration file provided by
  "OhosExtras", but CMake did not find one.

  Could not find a package configuration file provided by "Qt5OhosExtras"
  with any of the following names:

    Qt5OhosExtrasConfig.cmake
    qt5ohosextras-config.cmake
```

## 场景

在 CMakeLists.txt 中写了 `find_package(Qt5 COMPONENTS OhosExtras REQUIRED)`，期望 CMake 自动找到 QtOhosExtras 模块。CMake configure 阶段直接报错。

## 原因

QtOhosExtras 模块的 `.pro` 文件中包含 `CONFIG -= create_cmake`，这意味着 Qt 构建系统**不会**为 OhosExtras 生成 CMake config 文件（`Qt5OhosExtrasConfig.cmake`）。因此 `find_package` 无法找到此模块。

这是 Qt for HarmonyOS 的一个已知限制：**QtOhosExtras 仅支持 qmake**。

## 解决方案

### 方案 A：改用 qmake（推荐）

在 `.pro` 文件中：
```qmake
ohos {
    QT += ohosextras
}
```

### 方案 B：CMake 手动链接（workaround）

不使用 `find_package`，直接指定库名：
```cmake
if(OHOS)
    # 手动链接 QtOhosExtras（无 find_package 支持）
    # 注意：库名需根据实际 Qt for OHOS 构建产物确认
    target_link_libraries(${PROJECT_NAME} PRIVATE Qt5OhosExtras)
endif()
```

> ⚠️ 方案 B 的库名 `Qt5OhosExtras` 尚未经过实际构建验证，可能需要调整为 `Qt5OhosExtrasd`（debug）或其他名称。

## 注意事项

- 这是 审计中发现的 **知识不一致** 问题：`porting-workflow.md` 曾推荐 CMake `find_package` 方式，但 `ohos-extras.md` 明确标注 qmake-only
- 已修正 `porting-workflow.md`，删除了 CMake `find_package` 推荐
- 黄金法则 B6：**QtOhosExtras 模块仅支持 qmake**

## 相关

- [[qt-ohos-extras]] — qmake-only 说明
- [[qt-harmonyos-golden-rules]] — 规则 B6
- [[qt-harmonyos-build]] — CMake 构建配置

### 相关问题

- [runtime-fail-qpa-plugin-not-found](runtime-fail-qpa-plugin-not-found.md) — 同属构建/部署链：CMake 配置错误 → libqohos.so 未部署 → 运行时崩溃

> 📋 返回 [错误速查表](_lookup.md)

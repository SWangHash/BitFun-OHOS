---
id: problem-runtime-fail-libqtdbus-missing
type: problem
domain: runtime
tags: [qt, harmonyos, dbus, dlopen, libqohos, runtime, missing-so]
created: 2026-07-08
updated: 2026-07-08
status: solved
severity: critical
audience: public
refs: [semantic-qt-harmonyos-build-run-workflow, procedural-qt-ohos-run-test]
summary: >
  libqohos.so 运行时依赖 libQt5DBus.so，但 CMakeLists.txt 未链接 Qt5::DBus 导致该库未部署到 HAP，
  设备端 dlopen 失败 → QPA 插件加载失败 → JSCrash。修复：CMake 添加 Qt5::DBus。
leader_summary: >
  解决 Qt 鸿蒙应用因 DBus 库缺失导致的启动崩溃，沉淀为可复用的 CMake 配置检查项。
impact: [迁移提效, 框架支撑]
deliverables: [problem记录, CMake修复]
evidence: [RedisView真机验证commit, 崩溃日志]
error_message: >
  W MUSL-LDSO: load libQt5DBus.so failed, namespace=ndk no inherits, errno=2
  W MUSL-LDSO: load libQt5DBus.so failed, namespace=moduleNs_default, errno=2
  W MUSL-LDSO: Error loading shared library libQt5DBus.so: (needed by /data/storage/el1/bundle/libs/arm64/libqohos.so)
  E ArkCompiler: [ecmascript] export objects of native so is undefined, so name is @app:<bundleName>/entry/qohos
  TypeError: Cannot read property handleAbilityStageOnCreate of undefined
error_code: ""
keywords: [libQt5DBus, libqohos, dlopen, MUSL-LDSO, QPA, Qt5::DBus, find_package]
symptoms: "应用启动后立即崩溃（JSCrash TypeError），日志显示 libQt5DBus.so 加载失败"
environment: "Qt 5.15.16 OHOS / HarmonyOS 6.0 / HUAWEI MateBook 14"
---

# libQt5DBus.so 未部署导致 QPA 插件加载失败

## 错误信息

```
W C03F07/MUSL-LDSO: load libQt5DBus.so failed, namespace=ndk no inherits, errno=2
W C03F07/MUSL-LDSO: load libQt5DBus.so failed, namespace=moduleNs_default, errno=2
W C03F07/MUSL-LDSO: Error loading shared library libQt5DBus.so: (needed by /data/storage/el1/bundle/libs/arm64/libqohos.so)
W C03F04/com.xxx/MMG: [NMM:1377]key:default/qohos First: failed Error loading shared library libQt5DBus.so
E C03F00/com.xxx/ArkCompiler: [ecmascript] export objects of native so is undefined, so name is @app:xxx/entry/qohos
E C03F00/com.xxx/ArkCompiler: TypeError: Cannot read property handleAbilityStageOnCreate of undefined
    at onCreate entry (entry/src/main/ets/qabilitystage/QAbilityStage.ets:47:9)
```

## 场景

Qt 鸿蒙化应用构建成功、安装成功，但启动后立即崩溃。崩溃类型为 JSCrash（TypeError），不是 C++ 崩溃。

## 原因

`libqohos.so`（Qt OHOS QPA 平台插件）在编译时链接了 `libQt5DBus.so`，但应用的 `CMakeLists.txt` 中 `find_package` 和 `target_link_libraries` 未包含 `DBus` 模块。

构建系统只部署了 `target_link_libraries` 中显式声明的 Qt 模块 .so 到 HAP 中，`libQt5DBus.so` 未被拷贝到 `entry/build/default/intermediates/cmake/default/obj/arm64-v8a/`，因此不在最终 HAP 的 `libs/arm64/` 目录中。

设备端 `dlopen("libqohos.so")` 时，动态链接器尝试解析 `libQt5DBus.so` 依赖失败，导致整个 `libqohos.so` 加载失败。ArkTS 侧的 native 模块 `qohos` 导出为 `undefined`，后续调用 `handleAbilityStageOnCreate` 时触发 TypeError。

## 解决方案

在 `OhosExampleApp/CMakeLists.txt` 中添加 `DBus` 模块：

```cmake
# 修改前
find_package(Qt5 5.15 REQUIRED COMPONENTS Core Gui Widgets Network Sql Xml)

# 修改后
find_package(Qt5 5.15 REQUIRED COMPONENTS Core Gui Widgets Network Sql Xml DBus)
```

```cmake
# 修改前
target_link_libraries(OhosRedisView PRIVATE
    Qt5::Core Qt5::Gui Qt5::Widgets Qt5::Network
    Qt5::Sql Qt5::Xml
    Qt5::QOhosPlatformIntegrationPlugin
)

# 修改后
target_link_libraries(OhosRedisView PRIVATE
    Qt5::Core Qt5::Gui Qt5::Widgets Qt5::Network
    Qt5::Sql Qt5::Xml Qt5::DBus
    Qt5::QOhosPlatformIntegrationPlugin
)
```

## 验证方法

构建后检查 native 库目录：

```powershell
Get-ChildItem "entry\build\default\intermediates\cmake\default\obj\arm64-v8a" -Filter "*.so" | Select-Object Name
# 确认 libQt5DBus.so 存在
```

## 注意事项

- `libqohos.so` 的 DT_NEEDED 列表取决于 Qt 编译时的配置，不同 Qt 版本可能依赖不同的模块集合
- 通用排查方法：用 `readelf -d libqohos.so | grep NEEDED` 检查所有运行时依赖，确保每个都在 `target_link_libraries` 中
- 此问题在编译阶段不会报错（因为 `libqohos.so` 是预编译的，不参与当前 CMake 的链接检查），只在设备运行时暴露

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 解决 Qt 鸿蒙应用因 DBus 库缺失导致的启动崩溃，形成通用 .so 依赖检查方法 |
| 影响面 | 所有使用 Playbook A 编译的 Qt 鸿蒙应用 |
| 交付物 | problem 记录 + CMake 修复 |
| 证据 | RedisView 真机验证 commit |
| 可复用方式 | 遇到 `Error loading shared library libQt5DBus.so` 时直接复用 |

## 相关

- [[runtime-fail-qpa-plugin-not-found]] — 类似的 QPA 插件加载失败
- [[qt-harmonyos-build-run-workflow]] — 构建运行工作流

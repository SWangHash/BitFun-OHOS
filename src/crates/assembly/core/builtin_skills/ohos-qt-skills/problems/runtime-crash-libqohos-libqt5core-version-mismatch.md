---
id: problem-runtime-crash-libqohos-libqt5core-version-mismatch
type: problem
domain: runtime
tags: [runtime, crash, libqohos, libQt5Core, symbol, version-mismatch, runInJsThreadAndWait, runAndWait, deviceType, OhosExportModules, ArkTS, napi, global-expression]
created: 2026-07-17
updated: 2026-07-23
status: solved
severity: critical
audience: public
refs: [procedural-qt-ohos-run-test, problem-runtime-crash-libqohos-modules-mismatch, problem-runtime-crash-ohos-deviceinfo-global-expression, semantic-qt-harmonyos-build-run-workflow]
summary: >
  Qt5 鸿蒙应用启动崩: libqohos.so 与 libQt5Core.so 的 NEW/OLD 构建版本内部不一致。
  默认 SDK 的 libqohos(NEW, 7/14, 引用 QtOhos::runInJsThreadAndWait@Qt_5) vs libQt5Core(OLD, 6/10, 只定义 QOhosJsThreadGateway::runAndWait@Qt_5_PRIVATE_API) → libqohos 加载失败(symbol not found)。
  -full SDK 的 libQt5Core(NEW, 7/14, 有 runInJsThreadAndWait) 但 libqohos 是 stray OLD(170MB debug, 引用 runAndWait) → 同样不匹配。
  修复: -full NEW libQt5Core + 默认 NEW libqohos 组合; 并修 @ohos.deviceInfo 模块解析(OhosExportModules.ts)。
leader_summary: >
  沉淀 Qt OHOS SDK 内部 NEW/OLD 构建版本不一致导致 libqohos 加载崩溃的排障方案,含符号级诊断+SDK 组合修复+@ohos.* 模块解析
impact: [迁移提效, 框架支撑]
deliverables: [problem 记录, veles 真机运行通过]
evidence: [faultlog jscrash-com.example.sqt, veles_run.png, kb_status.json(veles run_success)]

error_message: >
  jscrash: TypeError: Cannot read property handleAbilityStageOnCreate of undefined
  at onCreate (QAbilityStage.ets:47:9)
  先兆: MUSL-LDSO: relocating failed: symbol not found
  _ZN6QtOhos20runInJsThreadAndWait...@Qt_5 (or @Qt_5_PRIVATE_API for runAndWait)
  dso=libqohos.so → napi module @app:.../qohos undefined → qpa undefined → TypeError → exit
  或(修复符号后): object has no property named 'deviceType'
  at initQtAppContextImpl (QAbilityStage.ets:22) — libqohos 通过 QNapi global-expression 解析 @ohos.deviceInfo 失败
error_code: ""
keywords: [libqohos, libQt5Core, runInJsThreadAndWait, runAndWait, symbol not found, NEW OLD mismatch, deviceType, OhosExportModules, global-expression, @ohos.deviceInfo, ArkTS-engine]
symptoms: >
  签名 HAP 安装成功,aa start 后进程 1-9s 内消失。faultlog 显示 jscrash TypeError
  (handleAbilityStageOnCreate of undefined 或 deviceType property 缺失)。

environment: >
  Qt5.15.16 OHOS SDK 两套(默认 ${QT5_15_OHOS_SDK} + 全量 ${QT5_15_OHOS_SDK_FULL}), 各自内部 libqohos/libQt5Core 构建版本不一致。
  OHOS 真机(HUAWEI MateBook Fold, UDID 9BFAF107...)。
---

## 根因(两层)

### 第一层: libqohos/libQt5Core 符号级 NEW/OLD 不匹配

Qt OHOS SDK 内部 libqohos.so 与 libQt5Core.so 的构建日期/API 不一致:

| SDK | libqohos | libQt5Core | 匹配? |
|-----|----------|-----------|-------|
| 默认(${QT5_15_OHOS_SDK}) | NEW(7/14, 5.5MB, 引用 `QtOhos::runInJsThreadAndWait@Qt_5`) | OLD(6/10, 37MB, 只定义 `QOhosJsThreadGateway::runAndWait@Qt_5_PRIVATE_API`) | ✗ 符号名+版本标签都不同 |
| -full(${QT5_15_OHOS_SDK_FULL}) | stray OLD(170MB debug, 引用 `runAndWait@Qt_5_PRIVATE_API`) | NEW(7/14, 有 `runInJsThreadAndWait@Qt_5`) | ✗ libqohos 是旧 stray |

**关键**: `runInJsThreadAndWait`(NEW API, @Qt_5 版本标签) ≠ `runAndWait`(OLD API, @Qt_5_PRIVATE_API 版本标签)。libqohos(NEW) 引用前者, libQt5Core(OLD) 只定义后者 → dynamic linker `symbol not found` → libqohos 加载失败 → NAPI 模块 undefined → jscrash。

### 第二层: @ohos.deviceInfo 模块解析(libqohos-vs-ArkTS-engine)

修复第一层后(libqohos 能加载), libqohos(NEW, 7/14) 通过 QNapi "global-expression" 机制解析 @ohos.* 模块(deviceInfo/display/window 等)。这些 @ohos.* 模块的解析**不查阅 modulesFactories map**(只查 @kit.* + TS 模块), 而是直接从 ArkTS engine 获取。若 ArkTS engine 返回的是模块命名空间对象(只有 `default` 导出)而非 default 导出的命名空间 → `napi_get_named_property(obj, "deviceType")` 抛 "object has no property named 'deviceType'"。

7/10 的 OhosExportModules.ts 模板 predates 7/14 libqohos → 缺 @ohos.* 模块的正确映射 → crash。

## 验证方法

1. `hdc install + aa start`, faultlog 含 `symbol not found ... runInJsThreadAndWait` 或 `object has no property named 'deviceType'`
2. `llvm-readelf --dyn-syms libqohos.so | grep runInJsThreadAndWait` → 若 UND(undefined), 查 libQt5Core 是否 DEFINES
3. `llvm-readelf --dyn-syms libQt5Core.so | grep runInJsThreadAndWait` → 若不定义, SDK 内部不匹配

## 解决方案

### 第一层修复: SDK 组合

用 **-full 的 NEW libQt5Core/Gui/Network/Widgets**(7/14, 有 runInJsThreadAndWait + SSL) + **默认的 NEW libqohos**(7/14, 5.5MB, 匹配 NEW libQt5Core)。替换 -full/plugins/platforms/libqohos.so(170MB stray OLD) 为默认的(5.5MB NEW)。

### 第二层修复: @ohos.* 模块解析

更新 OhosExportModules.ts 为匹配 7/14 libqohos 的版本(为 @ohos.deviceInfo/display/window/font/resourceManager/i18n/intl/settings/abilityAccessCtrl 等添加正确的 eager default-imports + modulesFactories entries)。

## 关键判据

- `llvm-readelf --dyn-syms` 检查 libqohos 的 UND 符号 + libQt5Core 的 DEFINED 符号: 版本标签(@Qt_5 vs @Qt_5_PRIVATE_API)+ 符号名(runInJsThreadAndWait vs runAndWait)必须一致。
- libqohos 的构建日期(mtime) 与 libQt5Core 的构建日期应接近(同批次构建)。
- OhosExportModules.ts 的日期应 ≥ libqohos 的日期(模板需匹配 libqohos 版本)。

## 关联

- [[qt-ohos-run-test]] §5 崩溃分析表
- [[problem-runtime-crash-libqohos-modules-mismatch]] (前序: libqohos/.ets modulesFactories/modules 字段名错配)
- [[problem-runtime-crash-ohos-deviceinfo-global-expression]] (@ohos.deviceInfo 崩溃谱的另一代际分支: 515 代际裸 eval 抛 "global expression doesn't start with known module path"——本页第二层是 7/14 代际 napi_get_named_property 抛 "object has no property named 'deviceType'";同款 eager import 修复)
- ENV.local: 默认 SDK(${QT5_15_OHOS_SDK}) + -full SDK(${QT5_15_OHOS_SDK_FULL}) 的 libqohos/libQt5Core 构建版本差异

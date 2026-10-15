---
id: fault-C-0010
cid: C-0010
type: cause
title: "陈旧胶水模板缺 @ohos.* eager import 注册，libqohos 裸 eval 被 ArkTS 运行时拒（onAcceptWant 崩溃）"
nature: defect
domain: runtime
fault_type: crash
responsible: qt-port
co_responsible: []
component: "qtbase/src/harmonyos/templates OhosExportModules.ts / QtUtils.ets（陈旧最小版）× libqohos 515 代际 qohosjsmain.cpp initDeviceInfo × ArkTS 运行时 libark_jsruntime.so"
severity: critical
evidence_type: both
status: workaround
fix_route: "Qt 侧模板与 libqohos 同批次更新（eager default-import 清单对齐 + objects API），随 harmonyos-5.15.16 分支 / 下一版 Qt OHOS SDK 到达"
review_note: "查 harmonyos-5.15.16 模板是否已换完整版 OhosExportModules（eager import 清单对齐 libqohos）；7/14 代际姊妹问题是否连边本 C 待裁决；提单外发前补纯鸿蒙对照 demo 运行日志"
depends_on: []
affects_qt: ["Qt 5.15.16（libqohos 515 代际 2026-07-17 构建；源码树模板 2026-04-21 版）"]
affects_ohos: ["HarmonyOS 6.0.0.29（HUAWEI MateBook Fold HPR-W72 真机）"]
qoh: [QOH009]
first_seen: 2026-07-23
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [qt, harmonyos, crash, arkts, ohos-deviceinfo, bare-eval, known-module-path, OhosExportModules, QtUtils, stale-template, eager-import, onAcceptWant, objects-api, workaround]
audience: public
refs: [problem-runtime-crash-ohos-deviceinfo-global-expression, procedural-qt-bug-report-sample, problem-runtime-crash-libqohos-libqt5core-version-mismatch, procedural-demo-generation, semantic-qt-harmonyos-project-structure]
summary: >
  源码树模板（4/21）陈旧于 libqohos（7/17），OhosExportModules.ts 仅 5 个 @kit.* lazy
  import、无任何 @ohos.* eager import，libqohos 启动期 jsState.eval("@ohos.deviceInfo")
  裸全局表达式 eval 被 ArkTS 运行时以"非已知模块路径"拒绝，Napi::Error 未捕获致
  onAcceptWant 崩溃（连带 factories/objects API 错配静默丢 @kit.* 模块）。defect/
  qt-port（triage 已人工判定，非系统 bug）；W-0008（完整版参考模板 4 文件替换）
  已真机验证，暂无跟踪单。
---

# C-0010 陈旧胶水模板缺 @ohos.* eager import

> nature: defect ｜ 责任: qt-port ｜ 状态: workaround ｜ 表现: S-0009 ｜ 方案: W-0008 ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0009 Qt5 鸿蒙应用触发 onAcceptWant 崩溃（@ohos.deviceInfo 裸 eval 被拒）

- 签名 HAP 安装成功，`aa start` 后应用正常启动（Qt 窗口出现、QtWatchdog 运行），进程可存活数分钟——**非启动即崩**；
- 触发 `onAcceptWant`（多实例拉起 / 窗口 recreate / QApplication 二次构造）时进程崩溃，触发条件满足时必现；
- faultlog `LAST_FATAL_MESSAGE`：`terminating due to uncaught exception of type Napi::Error: global expression doesn't start with known module path: '@ohos.deviceInfo'`（SIGABRT）；
- 崩溃栈：`MainThread::HandleScheduleAcceptWant → JsAbilityStage::OnAcceptWant → initQtAppContextIfNeeded → initQtAppContextImpl（QAbilityStage.ets）→ qpa.setupQtApplication({modules}) → libqohos initAppData → initDeviceInfo → jsState.eval("@ohos.deviceInfo")`。

## 根因 / 定性依据（faultlog + strings 判据 + 纯鸿蒙对照，triage 已判定）

三层根因（由表及里）：

1. **错误出自 ArkTS 运行时（libark_jsruntime.so），不是 libqohos**——`global expression doesn't start with known module path` 文本在 libqohos.so 里 strings 查无。ArkTS 运行时对以 `@ohos.` 开头的**裸全局表达式 eval** 仅放行已被 eager import 注册为"已知模块路径"的模块，否则抛 Napi::Error；libqohos（515 代际，`qohosjsmain.cpp:1677`）启动期为填 QOhosDeviceInfo 缓存执行 `jsState.eval<QNapi::Object>("@ohos.deviceInfo")`，异常未捕获 → SIGABRT。
2. **陈旧最小版模板缺注册**——从 `qtbase/src/harmonyos/templates`（源码树 4/21）拷出的 `OhosExportModules.ts` 仅 5 个 `@kit.*` **lazy** import、无任何 `@ohos.*` import；模板日期早于 libqohos（7/17）→ `@ohos.deviceInfo` 等未注册 → 裸 eval 被拒。注意 `import lazy` 延迟加载同样不注册启动期已知路径，修复必须 **eager default-import**。
3. **API 形式错配（连带坏 @kit.*）**——陈旧模板 `QtUtils.ets` 用 factories API（`getOhosExportModulesFactories()` 返回箭头工厂、存函数引用），而 515 代际 libqohos 用 objects API（读 `"modules"` 字段，`makeJsModulesMap` 对每个值 `IsObject()` 校验）→ 箭头函数是 napi_function 非 napi_object → 条目被**静默丢弃**，@kit.* + LocalStorage + QEmbeddedComponentCreator 全部丢失（UI Extension / LocalStorage 潜在故障）。

诊断判据（复用）：

- 判代际：`strings libqohos.so | grep "global expression"`——查无 = 515 代际（ArkTS 抛，本页）；查有 = 7/14 新代际（libqohos 抛，姊妹问题，错误文本 `object has no property named 'deviceType'`）；
- 判 API：`strings libqohos.so | grep -E "^modules$|^modulesFactories$"`——`modules`=objects / `modulesFactories`=factories，.ets 侧必须一致。

triage 结论（bug report 样例，已按人工签署口径沉淀）：**Qt 框架归属，非系统 bug**——①错误文本出自 ArkTS 运行时，纯鸿蒙对照 demo（对照 A/B）设计证明"拒未注册裸 eval"与 Qt 无关且符合模块解析安全限制（官方文档只提供 eager import 用法）；②实际缺陷在 Qt 侧模板陈旧（4/21 早于 7/17）。

证据形态：`both`——Qt 复现工程（qapp-recreate-test，bug report 样例含 3 步编号复现步骤与编译运行命令）+ faultlog（cppcrash-60469：LAST_FATAL_MESSAGE + 栈）+ strings 二进制判据。注：纯鸿蒙对照 demo（ohos-repro/）对照设计已定、**尚未落地编译运行**（样例自检留痕），提单外发前需补运行日志。

## 责任判定

`qt-port`——缺陷在 Qt 鸿蒙移植侧交付物：`qtbase/src/harmonyos/templates` 胶水模板与 libqohos 不同批次更新，未随 libqohos 的启动期裸 eval 需求提供 `@ohos.*` eager import 注册。修复到达路径：harmonyos-5.15.16 分支模板更新 / 下一版 Qt OHOS SDK。ArkTS 运行时拒未注册裸 eval 属规格行为（bug report 中对华为侧仅为文档增强建议，非缺陷单）。

## 根治方案（defect）

对 Qt 上游（tqtc）的建议：

1. 模板 `OhosExportModules.ts` / `QtUtils.ets` 与 libqohos 构建**同批次更新**，eager default-import 清单覆盖 libqohos 实际 eval 的全部 `@ohos.*` / `@kit.*` 模块根；
2. 构建期脚本 `strings libqohos.so | grep -E "^@ohos\.|^@kit\."` 自动生成清单对齐模板，防再陈旧；
3. 模板默认 API 形式与 libqohos 消费字段一致（`modules`=objects / `modulesFactories`=factories）。

## 临时方案（Workarounds）

- **W-0008（adopted，已验证 2026-07-23 真机）**：用钦定完整版参考模板替换胶水 4 文件：
  1. `entry/src/main/ets/qability/OhosExportModules.ts` ← 完整版参考模板：26 个 `import __ohos__X from '@ohos.X'`（eager default-import，覆盖 deviceInfo/display/window/font/resourceManager/i18n/intl/settings/...）+ 13 个 `@kit.*` eager import；`getOhosExportModules()` 返回**直接对象**（非箭头工厂）；
  2. `entry/src/main/ets/qability/QtUtils.ets` ← 完整版参考模板：`getModulesMapForQt()` 调 `getOhosExportModules()` + `getLocalStorageTsInterface()` + `getQEmbeddedComponentCreatorTsInterface()`（**调用取对象**，非存函数引用）；
  3. `QAbilityStage.ets` / `QChildProcess.ets`：`getModulesFactoriesMapForQt()` → `getModulesMapForQt()`（2 处调用点改名，保留 QAbilityStage 的 resourceDir）；
  4. 重建 `build_project(entry@default, debug)` → 装机 → 触发 onAcceptWant → 不崩、QtWatchdog 持续运行 = 修复生效。

  代价：libqohos 代际变更（重建）后需重新 `strings libqohos.so` 对齐 `@ohos.*`/`@kit.*` 清单，否则新增模块 eval 仍崩；每个从源码树模板生成的工程都要替换。
  退役条件：Qt 源码树模板与 libqohos 同批次更新（eager import 清单对齐）后，恢复直接使用官方模板，移除 4 文件替换流程。

## 跟踪单（Tickets）

- 暂无（无实证单号）。bug report 已成稿（[qt-bug-report-sample](../procedural/qt-bug-report-sample.md)，triage 结论 Qt 框架归属）：对华为侧降级为文档增强建议（是否外发待人工签署，非缺陷单）；对 tqtc 的模板修复建议未提交。提单前按可复现性 HARD 闸门补纯鸿蒙对照 demo 运行日志。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-07-23 | Qt 5.15.16（515 代际 libqohos，7/17 构建）/ HarmonyOS 6.0.0.29（MateBook Fold 真机） | qapp-recreate-test 触发 onAcceptWant 复现，取 faultlog + strings 判据 | cppcrash-60469：LAST_FATAL_MESSAGE 命中，栈到 `jsState.eval("@ohos.deviceInfo")`；strings 查无错误文本 → 判 515 代际 | → open |
| 2026-07-23 | 同上 | 完整版参考模板 4 文件替换，重建装机，再触发 onAcceptWant | 不崩、QtWatchdog 持续运行（shot-after-fix.png） | → workaround |

（历史事实来源：[runtime-crash-ohos-deviceinfo-global-expression](../problems/runtime-crash-ohos-deviceinfo-global-expression.md) evidence/deliverables 与 [qt-bug-report-sample](../procedural/qt-bug-report-sample.md)；主编合入时按门禁在本表首行登记审核复现。）

## 关联

- 症状（S）：S-0009
- 临时方案（W）：W-0008
- 跟踪单（T）：暂无
- problems：[runtime-crash-ohos-deviceinfo-global-expression](../problems/runtime-crash-ohos-deviceinfo-global-expression.md)、[runtime-crash-libqohos-libqt5core-version-mismatch](../problems/runtime-crash-libqohos-libqt5core-version-mismatch.md)（7/14 代际姊妹问题，同修复方向）
- procedural：[qt-bug-report-sample](../procedural/qt-bug-report-sample.md)（triage 论证链与交付件清单）、[demo-generation](../procedural/demo-generation.md) 阶段三 3.2（源码树模板陷阱检查点）
- semantic：[qt-harmonyos-project-structure](../semantic/qt-harmonyos-project-structure.md)（鸿蒙工程模板来源）
- QOH（机器层）：QOH009（ohos_deviceinfo_global_expression）
- 相关根因（C）：无（姊妹问题 7/14 代际未入图；是否连边本 C 或另建 C 待主编裁决）

---
id: problem-runtime-crash-libqohos-modules-mismatch
type: problem
domain: runtime
tags: [runtime, crash, libqohos, qpa, ets, template, sdk-version, modulesFactories, modules, signing, jscrash]
created: 2026-07-16
updated: 2026-07-16
status: solved
severity: critical
audience: public
refs: [procedural-qt-ohos-run-test, semantic-qt-harmonyos-build-run-workflow, semantic-qt-harmonyos-project-structure]
summary: >
  Qt5 鸿蒙应用启动即崩 jscrash "object has no property named 'modules'" at QAbilityStage.ets:22。
  根因: .ets 胶水模板(5.12, 传 modulesFactories) 与所链 libqohos.so(5.15, 读 modules) 版本错配。
  修复: 用与模板版本一致的 Qt OHOS SDK(5.12 模板→${QT5_15_OHOS_SDK} 旧 SDK libqohos 读 modulesFactories；或更新 .ets 到 5.15 传 modules)。
leader_summary: >
  沉淀 Qt5 鸿蒙应用启动崩溃的 SDK/模板版本错配排障方案,批量移植产 HAP 后真机必跑验证的关键拦路问题
impact: [迁移提效, 框架支撑]
deliverables: [problem 记录, 修复 HAP(sqt 真机通过)]
evidence: [faultlog jscrash-com.example.sqt, sqt_run.png, kb_status.json(sqt run_success)]

# ====== 检索关键字 ======
error_message: >
  jscrash: Error: object has no property named 'modules'
  at initQtAppContextImpl entry (entry/src/main/ets/qabilitystage/QAbilityStage.ets:22:11)
  at initQtAppContextIfNeeded entry (QAbilityStage.ets:38:19)
  at onAcceptWant entry (QAbilityStage.ets:60:19)
  HybridStack: .../libqohos.so ... napi_create_type_error
  AppKit: com.example.<app> is about to exit due to RuntimeError
  先兆日志: hapModuleInfo null + Context.resourceDir is empty + resfile not exist
error_code: ""
keywords: [modulesFactories, modules, libqohos, QAbilityStage, setupQtApplication, initQtAppContextImpl, jscrash, 模板版本错配, ${QT5_15_OHOS_SDK_FULL}]
symptoms: >
  签名 HAP 安装成功,aa start 启动后进程 1-2 秒内消失(启动即崩),桌面不显示应用窗口或一闪即退。

# ====== 问题详情 ======
environment: >
  Windows 交叉编译 + OHOS 真机(OHOS 真机).
  Qt5.15.16 OHOS SDK 两套: ${QT5_15_OHOS_SDK}(旧,libqohos 读 modulesFactories)
  与 ${QT5_15_OHOS_SDK_FULL}(全量,libqohos 读 modules).
  .ets 胶水模板来源 ${QT5_15_SRC}(实为脏 5.12 树,传 modulesFactories).
---

## 根因

libqohos.so 的 NAPI `setupQtApplicationImpl` 在不同源码版本读取的字段名不同:
- 5.12 源(${QT5_15_SRC}, qohosjsmain.cpp:1736): `appStartupObj.get<Object>("modulesFactories")`
- 5.15 源(${QT5_15_SRC_FULL}, qohosjsmain.cpp:1735): `appStartupObj.get<Object>("modules")`

而 OHOS 胶水模板 `QAbilityStage.ets`(从 `${QT5_15_SRC}/qtbase/src/harmonyos/templates` 复制, 5.12 版)的 `qpa.setupQtApplication({...})` 调用传 `modulesFactories: QtUtils.getModulesFactoriesMapForQt()`(无 `modules` 字段)。

若应用用 **${QT5_15_OHOS_SDK_FULL}**(5.15 libqohos 读 `modules`)构建,而 .ets 是 5.12(传 `modulesFactories`)→ 运行时 `appStartupObj.get<Object>("modules")` 抛 "object has no property named 'modules'" → AbilityStage.onAcceptWant 崩 → 进程退出。

先兆日志(非直接根因,是 framework 在 NAPI 崩前的上下文查询): `hapModuleInfo null` + `Context.resourceDir is empty` + `dir:.../resources/resfile not exist`。真正崩溃点是 QNapi 读 `modules` 属性缺失。

## 验证方法

1. `hdc install entry-default-signed.hap && hdc shell aa start -b <bundle> -a <ability>`
2. `sleep 3; hdc shell ps -ef | grep <bundle>` —— 进程消失=启动崩
3. MCP `get_hilog_or_faultlog_recent`(bundle_name, is_crash_log=true) 或 `hdc shell` 拉 faultlog
4. faultlog 含 "object has no property named 'modules'" + stack 到 QAbilityStage.ets:22 + libqohos.so napi_create_type_error = 本问题

## 解决方案(首选: 对齐版本)

**首选**: 用与 .ets 模板版本一致的 Qt OHOS SDK 重建。5.12 .ets 模板(传 modulesFactories)→ 用 `${QT5_15_OHOS_SDK}`(旧 libqohos 读 modulesFactories,与模板一致,qView 同款能跑):
```json5
// entry/build-profile.json5 的 externalNativeOptions.arguments
"-DCMAKE_PREFIX_PATH=${QT5_15_OHOS_SDK}"   // 不是 ${QT5_15_OHOS_SDK_FULL}
```
改后 `node hvigorw.js assembleHap --no-daemon` 重建(signingConfigs 已配则自动重签),重装重测。

**备选(需 5.15 模板)**: 若必须用 ${QT5_15_OHOS_SDK_FULL}(需全量 SDK 独有模块如 Multimedia),则 .ets 模板也需 5.15 版(传 `modules`)——但 5.15 源码树(${QT5_15_SRC_FULL})未含 templates/.ets,需另行获取 5.15 模板,且要同步改 `QtApplicationSetupParams`/`QtChildProcessParams` 类型定义字段名。成本高,首选方案更稳。

## 关键判据

- qView(参考实现)用 ${QT5_15_OHOS_SDK} + 5.12 模板 → 一致 → 能跑。
- 批量移植若 port agent 误用 ${QT5_15_OHOS_SDK_FULL} + 5.12 模板 → **全部 HAP 运行时崩同样错误**(编译成功≠能跑)。
- 故「编译产出 HAP」后必须真机跑一次(见 [[qt-ohos-run-test]])才能确认非本崩溃。

## 关联

- [[qt-ohos-run-test]] §5 崩溃分析表已收录本行
- ENV.md：SDK 与模板的源码版本不一致是根因；OHOS_TEMPLATE_SRC 派生自 5.12 源码树故模板为 5.12 版。

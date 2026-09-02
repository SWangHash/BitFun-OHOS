---
id: problem-runtime-crash-ohos-deviceinfo-global-expression
type: problem
domain: runtime
tags: [runtime, crash, @ohos.deviceInfo, global-expression, ArkTS, bare-eval, known-module-path, OhosExportModules, QtUtils, demo-gen, stale-template, objects-api, qView]
created: 2026-07-23
updated: 2026-07-23
status: solved
severity: critical
audience: public
refs: [problem-runtime-crash-libqohos-libqt5core-version-mismatch, procedural-demo-generation, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-build-run-workflow]
summary: >
  Qt5 鸿蒙应用运行崩:Napi::Error "global expression doesn't start with known module path: '@ohos.deviceInfo'"。
  根因:libqohos(515 代际) 启动时 jsState.eval("@ohos.deviceInfo") 做裸全局表达式 eval,ArkTS 运行时拒绝裸 @ohos.* eval
  除非该模块路径已被 eager import 注册为"已知"。从 Qt 源码树模板(qtbase/src/harmonyos/templates)生成的 demo
  带的是陈旧最小版 OhosExportModules.ts(仅 5 个 @kit.* lazy import + factories API),无任何 @ohos.* import
  → deviceInfo 未注册 → 裸 eval 被拒 → 崩。修复:用 qView-ohos 钦定完整版 OhosExportModules.ts + QtUtils.ets
  (26 个 @ohos.* + 13 个 @kit.* eager default-import + objects API + getModulesMapForQt)替换。
leader_summary: >
  沉淀 Qt 鸿蒙 demo 生成时"陈旧胶水模板导致 @ohos.deviceInfo 裸 eval 崩"的根因与修复(qView-ohos 完整版对齐),
  补全 @ohos.deviceInfo 崩溃谱的另一代际错误(515 裸 eval vs 7/14 napi_get_named_property)。
impact: [迁移提效, 框架支撑, demo 生成]
deliverables: [problem 记录, qapp-recreate-test 修复(4 文件), 真机运行通过]
evidence: [faultlog cppcrash-60469(com.example.qapprecreatetest), shot-after-fix.png, hilog QtWatchdog 存活]

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  jscrash/cppcrash: terminating due to uncaught exception of type Napi::Error:
  global expression doesn't start with known module path: '@ohos.deviceInfo'
  REASON: Signal: SIGABRT(SI_TKILL)
  PNAME: com.example.<app>
  调用栈: MainThread::HandleScheduleAcceptWant → JsAbilityStage::OnAcceptWant
    → initQtAppContextIfNeeded → initQtAppContextImpl (entry/src/main/ets/qabilitystage/QAbilityStage.ets)
    → qpa.setupQtApplication({modules}) → libqohos initAppData → initDeviceInfo
    → jsState.eval<QNapi::Object>("@ohos.deviceInfo")  ← ArkTS 运行时此处抛 Napi::Error
  栈底 .so: libqohos.so (515 代际, 无 qohosplugincore.cpp 回退) + libQt5Core.so + libark_jsruntime.so
  先兆: 进程存活数分钟后(或 recreate/二次构造触发 onAcceptWant 时)才崩,非启动即崩。
error_code: ""
keywords: [global expression doesn't start with known module path, @ohos.deviceInfo, Napi::Error, bare eval, known module path, ArkTS runtime, OhosExportModules, getOhosExportModulesFactories, getModulesMapForQt, objects api vs factories api, stale template, demo 生成, qView-ohos, eager default-import, onAcceptWant, initQtAppContextImpl, setupQtApplication]
symptoms: >
  签名 HAP 安装成功,aa start 后应用能启动(Qt 窗口出现、QtWatchdog 运行),但触发 onAcceptWant
  (多实例/窗口 recreate/QApplication 二次构造)时进程崩溃;faultlog LAST_FATAL_MESSAGE 即上述 Napi::Error。
  注意:本错误与"object has no property named 'deviceType'"是 @ohos.deviceInfo 崩溃谱的两个不同代际错误(见下)。

# ====== 问题详情 ======
environment: >
  Qt5.15.16 OHOS SDK(${QT5_15_OHOS_SDK_FULL}),libqohos.so 5.3MB(7/17,515 代际:读 "modules" 字段、
  makeJsModulesMap 期望 object 值、无 qohosplugincore.cpp 的 napi_load_module 回退)。
  OHOS 真机 HUAWEI MateBook Fold(HPR-W72 6.0.0.29)。
  demo: ${DEMOS_ROOT}/qapp-recreate-test(QApplication 二次构造验证),胶水模板来自 qtbase/src/harmonyos/templates。
---

## 根因(三层,由表及里)

### 第一层:错误来源是 ArkTS 运行时,不是 libqohos

`global expression doesn't start with known module path: '@ohos.deviceInfo'` 这串错误文本**不在 libqohos.so 里**
(strings libqohos.so 查无)。它由 **ArkTS 运行时(libark_jsruntime.so)在拒绝裸 @ohos.* 全局 eval 时抛出**。
libqohos(515 代际, qohosjsmain.cpp:1677) 执行:

```cpp
auto deviceInfoObj = jsState.eval<QNapi::Object>("@ohos.deviceInfo");  // 裸全局表达式 eval
```

ArkTS 运行时对"以 `@ohos.` 开头的裸全局表达式 eval"有严格校验:**只有已被 import 注册为"已知模块路径"的 @ohos.* 才允许裸 eval**,否则抛 `global expression doesn't start with known module path`。这是鸿蒙 6.0 ArkTS 的安全限制(README immersive-subwindow §258 与 qohosplugincore.cpp:652-654 注释均证实"bare @ohos.* global script evals are rejected by the ArkTS runtime")。

> **关键判据**:若 libqohos.so 二进制里**查不到**这串错误文本,但 faultlog 报它 → 是 ArkTS 运行时抛的(libqohos 只是把异常透传/未捕获)。若能在 libqohos.so 里查到 → 是 libqohos 的 extractModuleFromEvalExpr 抛的(见 [[problem-runtime-crash-libqohos-libqt5core-version-mismatch]] 第二层,那是 7/14 新代际机制)。

### 第二层:陈旧最小版 OhosExportModules.ts 缺 @ohos.* eager import

从 `qtbase/src/harmonyos/templates`(OHOS_TEMPLATE_SRC)拷出的胶水模板带的是**陈旧最小版** `OhosExportModules.ts`:

```ts
// ❌ 模板原版(仅 5 个 @kit.* lazy import, 无任何 @ohos.* import)
import lazy { textToSpeech as __kit__CoreSpeechKit__textToSpeech } from '@kit.CoreSpeechKit';
// ... 4 个 @kit.* ...
export function getOhosExportModulesFactories(): object {
  return { '@kit.CoreSpeechKit.textToSpeech': () => __kit__CoreSpeechKit__textToSpeech, ... };
}
```

模板日期(源码树 4/21)早于 libqohos(7/17) → 缺 `@ohos.deviceInfo/display/window/font/resourceManager/i18n/intl/settings/...` 等 eager import → `@ohos.deviceInfo` 未被注册为"已知模块路径" → 第一层裸 eval 被拒 → 崩。

**只有 eager(非 lazy)的 `import X from '@ohos.X'` 才会在 bundle 加载时把模块路径注册为全局已知**;`import lazy` 延迟加载,启动期裸 eval 时模块尚未注册 → 同样会崩。故修复必须用 **eager default-import**。

### 第三层:API 形式错配(factories vs objects)——@kit.* 也连带坏

陈旧模板的 `QtUtils.ets` 用 **factories API**:`getModulesFactoriesMapForQt()` → `getOhosExportModulesFactories()` 返回 `() => 值`(箭头工厂),且 LocalStorage/QEmbeddedComponentCreator 存的是**函数引用**(未调用)。

但 515 代际 libqohos 用 **objects API**:`makeJsModulesMap`(qohosjsmain.cpp:861)返回 `map<string, Reference<Object>>`,对每个值 `propValue.IsObject()` 校验 —— **箭头函数是 napi_function 不是 napi_object,IsObject() 返回 false → 条目被静默丢弃**。即 @kit.* + LocalStorage + QEmbeddedComponentCreator 全部丢失(潜在 bug,UI Extension/LocalStorage 会坏)。

| API | .ets 函数 | 返回值 | libqohos 消费 | 对应代际 |
|-----|---------|--------|-------------|---------|
| factories(旧/错) | getOhosExportModulesFactories | `() => 值` | makeJsModulesFactoriesMap(map<string,Function>) + 读 "modulesFactories" | 7/14 新代际 |
| **objects(对)** | **getOhosExportModules** | `值`(直接对象) | **makeJsModulesMap(map<string,Object>) + 读 "modules"** | **515 代际** |

**判据**:查 libqohos.so 的 strings,字段名是 `modules`(objects)还是 `modulesFactories`(factories),据此选 API。本项目 .so 是 `modules` → objects。

## 与"object has no property named 'deviceType'"的区分(@ohos.deviceInfo 崩溃谱)

| 错误 | libqohos 代际 | 机制 | 修复 |
|------|------------|------|------|
| **global expression doesn't start with known module path**(本页) | 515(裸 jsState.eval) | ArkTS 运行时拒裸 @ohos.* eval(未注册) | eager import 注册模块路径 |
| object has no property named 'deviceType'(第二层) | 7/14 新(extractModuleFromEvalExpr + napi_load_module 回退) | 模块已解析但返回 namespace wrapper,取 .deviceType 失败 | eager **default** import 暴露 default 导出 |

两者**同一类问题(@ohos.* 解析失败)、同一修复方向(eager import)、不同代际不同错误文本**。eager default-import 对两者都有效(既注册路径又暴露 default 导出)。

## 验证方法

1. `hdc install <hap> && hdc shell aa start -b <bundle> -a QAbility`,触发 onAcceptWant(多实例/recreate/二次构造)
2. 崩后 `hdc shell ls -t /data/log/faultlog/temp/` 取最新 cppcrash-*.json
3. `LAST_FATAL_MESSAGE` 含 `global expression doesn't start with known module path: '@ohos.deviceInfo'` + 栈到 `initQtAppContextImpl` + `.so` 含 libqohos.so = 本问题
4. **判代际**:`strings <SDK>/plugins/platforms/libqohos.so | grep "global expression"` —— 查无 = 515 代际(ArkTS 抛);查有 = 7/14 代际(libqohos 抛,走第二层)
5. **判 API**:`strings libqohos.so | grep -E "^modules$|^modulesFactories$"` → modules=objects / modulesFactories=factories

## 解决方案

**用 qView-ohos 钦定完整版替换 4 个文件**(KB 钦定参考实现,见 [[problem-runtime-crash-libqohos-libqt5core-version-mismatch]] 也指向同款修复):

1. `entry/src/main/ets/qability/OhosExportModules.ts` ← qView-ohos 版:
   - 26 个 `import __ohos__X from '@ohos.X'`(eager default-import,覆盖 deviceInfo/display/window/font/resourceManager/i18n/intl/settings/abilityAccessCtrl/bundle.bundleManager/... )
   - 13 个 `import { Y as __kit__... } from '@kit.Z'`(eager,覆盖 .so 实际 eval 的 @kit.* 根)
   - `export function getOhosExportModules(): object` 返回**直接对象**(非箭头工厂)
2. `entry/src/main/ets/qability/QtUtils.ets` ← qView-ohos 版:`getModulesMapForQt()` 调 `getOhosExportModules()` + `getLocalStorageTsInterface()` + `getQEmbeddedComponentCreatorTsInterface()`(**调用取对象**,非存函数)
3. `QAbilityStage.ets` / `QChildProcess.ets`:`getModulesFactoriesMapForQt()` → `getModulesMapForQt()`(2 处调用点改名;保留 QAbilityStage 的 resourceDir)
4. 重建 `build_project(entry@default, debug)` → 装机 → 触发 onAcceptWant → 不崩、QtWatchdog 持续运行 = 修复生效

> **@ohos.* / @kit.* 清单来源**:以 `strings libqohos.so | grep -E "^@ohos\.|^@kit\."` 取本 libqohos 实际 eval 的模块根(去重),确保每个都有 eager import。qView-ohos 的 26+13 是经验证的超集,可直接套用。

## 关键判据

- 源码树模板(qtbase/src/harmonyos/templates)日期 < libqohos 日期 → 模板必陈旧,OhosExportModules.ts 缺 @ohos.* 映射。
- libqohos.so strings 查无 "global expression" → 515 代际裸 eval 机制(本页);查有 → 7/14 代际(第二层)。
- libqohos.so strings 字段名 `modules` → objects API(直接值);`modulesFactories` → factories API(箭头工厂)。.ets 必须与之一致。
- ArkTS-Check 报 `getOhosExportModules` "no exported member" + `arkts-no-any-unknown` 多为 LSP 索引陈旧(检查器跳过 .ts),以 hvigor build 为准(build 编译器重读 .ts 即通过)。

## 关联

- [[problem-runtime-crash-libqohos-libqt5core-version-mismatch]] — @ohos.deviceInfo 崩溃谱的 7/14 新代际分支("object has no property named 'deviceType'");同款 eager import 修复。
- [[procedural-demo-generation]] 阶段三 3.2 — 源码树模板陷阱检查点(本次新增)。
- [[semantic-qt-harmonyos-project-structure]] — 鸿蒙工程模板来源。
- qView-ohos(参考实现,见 ENV.local 路径)— 钦定完整版 OhosExportModules.ts/QtUtils.ets 参考实现。

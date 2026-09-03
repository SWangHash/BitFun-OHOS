---
id: problem-runtime-crash-arkts-template-modules-mismatch
type: problem
domain: runtime
tags: [arkts-template, modulesFactories, modules, libqohos, napi, crash, ohos-build, qt, harmonyos]
created: 2026-08-06
updated: 2026-08-06
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-window-model, semantic-qt-harmonyos-project-structure]
summary: >
  新编译的 libqohos.so 读 modulesFactories 属性，旧 ArkTS 模板传 modules->NAPI 抛异常->启动崩溃。
  根因：Qt 源码树的 ArkTS 模板已升级 API（modules->modulesFactories），旧工程的 QAbilityStage.ets 未同步更新。
  修复：从 Qt 源码树 entry/src/main/ets/ 替换 19 个文件。
leader_summary: >
  定位 ArkTS 模板版本不匹配崩溃根因，从 Qt 源码树同步模板解决，沉淀为已知坑点
impact: [框架支撑, 运行时排障]
deliverables: [problem记录]
evidence: [ohos-qt-patch-delivery/template/]

error_message: >
  Cannot read property 'handleAbilityStageOnCreate' of undefined
  at QAbilityStage.ets:47
  import qpa from 'libqohos.so' returns undefined
  NAPI module not registered
error_code: ""
keywords: [modulesFactories, modules, libqohos.so, QAbilityStage, ArkTS模板, 启动崩溃, NAPI]
symptoms: "HAP 安装成功但点击启动崩溃，报 QAbilityStage.ets 中 handleAbilityStageOnCreate undefined"

environment: "OHOS + Qt 5.15.16 + 新编译 libqohos.so + 旧 ArkTS 工程"
---

# ArkTS 模板版本不匹配 -> NAPI 启动崩溃

## 错误信息

```
Cannot read property 'handleAbilityStageOnCreate' of undefined
at QAbilityStage.ets:47
```

## 场景

重新编译 libqohos.so（含新 patch 或更新 Qt 源码）后部署到旧的 ohostemplate 工程，启动崩溃。
回退 libqohos.so 到旧版本也同样崩溃 -> 证明非 libqohos.so 本身问题。

## 原因

Qt 源码树中的 ArkTS 模板已升级 API：
- 旧：`modules: QtUtils.getModulesMapForQt()`
- 新：`modulesFactories: QtUtils.getModulesFactoriesMapForQt()`

新编译的 libqohos.so C++ 代码读 `modulesFactories` 属性，旧 ArkTS 工程传的是 `modules`。
属性名不匹配导致 NAPI 模块未正确注册，`import qpa from 'libqohos.so'` 返回 undefined。

## 解决方案

从 Qt 源码树替换 ArkTS 模板文件：

```
源: qtbase/src/harmonyos/templates/entry/src/main/ets/
目标: <工程>/entry/src/main/ets/
```

替换 19 个文件：
- 16 个 entry .ets/.ts 文件
- 3 个 qEmbeddedUiExtensionHost .ets 文件

关键变更：`modules` -> `modulesFactories`，`getModulesMapForQt()` -> `getModulesFactoriesMapForQt()`。

保留工程自定义部分：cpp、resources、libs、配置文件（build-profile 含签名）。

## 注意事项

- 每次更新 libqohos.so 都应检查是否需要更新 ArkTS 模板
- `import lazy` 语法需要 `compatibleSdkVersionStage: "beta3"` 加到 build-profile.json5
- `APP_LIBRARY_NAME` 需与 CMake `add_library` 名一致

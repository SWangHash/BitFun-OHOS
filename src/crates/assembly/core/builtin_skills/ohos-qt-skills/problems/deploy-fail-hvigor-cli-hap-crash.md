---
id: problem-deploy-fail-hvigor-cli-hap-crash
type: problem
domain: deploy
tags: [hvigor, cli, hap-packaging, napi, crash, deveco-ide, modules, qt, harmonyos]
created: 2026-08-06
updated: 2026-08-06
status: workaround
severity: medium
audience: public
refs: [semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-build-run-workflow]
summary: >
  hvigor 命令行(--mode module)打包的 HAP 启动崩溃：Cannot read property handleAbilityStageOnCreate of undefined。
  回退到无 patch 的 libqohos.so 也同样崩溃->非 Qt 代码问题，是 CLI 打包与 DevEco Studio IDE 打包的差异。
  Workaround：用 DevEco Studio IDE 直接 Run 部署。
leader_summary: >
  定位 hvigor CLI 打包 HAP 崩溃为 CLI vs IDE 打包差异，非 Qt 代码问题
impact: [框架支撑, 运行时排障]
deliverables: [problem记录]
evidence: [ohos-qt-patch-delivery]

error_message: >
  Cannot read property 'handleAbilityStageOnCreate' of undefined
  at QAbilityStage.ets
  (hvigor --mode module 打包)
error_code: ""
keywords: [hvigor, CLI, HAP打包, NAPI, DevEco Studio, IDE, 启动崩溃]
symptoms: "hvigor CLI 打包 HAP 安装后启动崩溃，DevEco Studio IDE Run 正常"

environment: "OHOS + hvigor CLI (--mode module) + Qt 5.15.16"
---

# hvigor CLI 打包 HAP 启动崩溃

## 错误信息

```
Cannot read property 'handleAbilityStageOnCreate' of undefined
at QAbilityStage.ets
```

## 场景

用 `hvigor --mode module` 命令行打包 HAP 后安装到设备，启动崩溃。
回退 libqohos.so 到无 patch 版本也同样崩溃 -> 排除 Qt 代码变更。

## 原因

hvigor CLI 打包流程与 DevEco Studio IDE 打包流程存在差异：
- CLI 打包时 NAPI 模块注册不完整
- IDE 打包正确处理 NAPI 模块注册和 .so 依赖链

具体差异待进一步调查。

## 解决方案

**Workaround**：用 DevEco Studio IDE 直接 Run 部署（Build -> Run），IDE 打包流程正确处理所有模块注册。

## 注意事项

- 命令行打包和 IDE 打包**不等价**，CI/CD 场景需注意
- 回退 .so 后仍崩溃可排除代码变更因素

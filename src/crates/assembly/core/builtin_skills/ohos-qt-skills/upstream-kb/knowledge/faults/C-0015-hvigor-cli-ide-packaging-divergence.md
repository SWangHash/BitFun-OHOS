---
id: fault-C-0015
cid: C-0015
type: cause
title: hvigor CLI (--mode module) 打包与 DevEco IDE 打包不等价（NAPI 模块注册不完整致 HAP 启动崩溃）
nature: undetermined
domain: deploy
fault_type: crash
responsible: ohos-toolchain
co_responsible: []
component: "hvigor CLI (--mode module) 打包流程 × DevEco Studio IDE 打包流程（NAPI 模块注册 / .so 依赖链）"
severity: medium
evidence_type: logs
status: diagnosed
fix_route: "若定性 defect：DevEco 工具链修复 CLI 打包的 NAPI 模块注册与依赖链处理，随 DevEco / hvigor 版本更新到达；若定性 limitation：查明官方 CLI 打包契约，命令行流程按契约补齐配置"
review_note: "CLI vs IDE 差异的具体机制待调查（NAPI 模块注册环节）；定性改判（defect 工具链缺陷 / limitation 打包契约 / app CLI 用法）；CI/CD 场景影响评估"
depends_on: []
affects_qt: ["Qt 5.15.16（源页环境；回退无 patch libqohos.so 仍崩，已排除 Qt 代码因素）"]
affects_ohos: ["未记录（hvigor CLI / DevEco Studio 版本源页未记录）"]
qoh: []
first_seen: 2026-08-06
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [harmonyos, hvigor, cli, hap, packaging, napi, deveco, ide, undetermined, workaround, cicd]
audience: public
refs: [problem-deploy-fail-hvigor-cli-hap-crash, semantic-qt-harmonyos-build-run-workflow, semantic-qt-harmonyos-project-structure]
summary: >
  hvigor CLI (--mode module) 打包的 HAP 启动即崩溃（Cannot read property
  'handleAbilityStageOnCreate' of undefined），DevEco Studio IDE Run 正常；回退无
  patch 的 libqohos.so 仍崩，排除 Qt 代码变更。根因方向：CLI 与 IDE 打包流程
  差异（CLI 侧 NAPI 模块注册不完整，具体差异待查）。undetermined/ohos-toolchain
  （diagnosed，等 defect/limitation 定性）；临时方案 W-0013（改用 IDE Run）已
  验证；跟踪单暂无（占位 T-0008）。
---

# C-0015 hvigor CLI 打包与 DevEco IDE 打包不等价

> nature: undetermined（倾向工具链侧）｜ 责任: ohos-toolchain ｜ 状态: diagnosed ｜ 表现: S-0014 ｜ 方案: W-0013 ｜ 跟踪: 暂无（占位 T-0008）｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0014 hvigor CLI (--mode module) 打包的 HAP 启动崩溃，DevEco IDE Run 正常

错误原文（源页 [deploy-fail-hvigor-cli-hap-crash](../problems/deploy-fail-hvigor-cli-hap-crash.md)）：

```
Cannot read property 'handleAbilityStageOnCreate' of undefined
at QAbilityStage.ets
```

`hvigor --mode module` 命令行打包 HAP → 安装 → 启动崩溃；同一工程用 DevEco
Studio IDE Run 部署正常。

## 根因 / 定性依据

对照实验（源页记录）：
1. CLI 打包 HAP 启动崩溃（错误原文如上）；
2. **回退 libqohos.so 到无 patch 版本 → 仍崩溃**——排除 Qt 代码变更因素；
3. DevEco Studio IDE Run 部署 → 正常。

→ 根因方向：**hvigor CLI 打包流程与 DevEco Studio IDE 打包流程存在差异**——CLI
打包时 NAPI 模块注册不完整；IDE 打包正确处理 NAPI 模块注册和 .so 依赖链。
**具体差异环节待进一步调查**（源页明示）。

**定性状态**：行为实证成立（CLI 崩 / 回退仍崩 / IDE 正常）；"这是工具链缺陷
（defect：CLI 应正确处理却未处理）还是命令行打包的官方契约/用法要求
（limitation：CLI 需额外配置）"未取得定性依据（源页无官方文档佐证）。
倾向工具链侧——同一工程两通道产物不等价且 CLI 产物崩溃。待查证官方 CLI 打包
契约后改判，CID 不变。

## 责任判定

`ohos-toolchain`（hvigor CLI / DevEco Studio 打包链，初判）。已排除 Qt 代码变更
（回退实验）；Qt 侧无动作。若查明为 CLI 用法/配置要求，则改判 responsible=app
（应用使用问题，处置相应变为"改用法"）。

## 根治方案（若定性为 defect）

DevEco 工具链修复 CLI 打包的 NAPI 模块注册与 .so 依赖链处理，使 CLI 与 IDE
产物等价——随 DevEco Studio / hvigor 版本更新到达（需向华为侧提单跟踪）。

## 替代方案与演进（若定性为 limitation）

查明 CLI 打包契约要求的配置项（模块注册 / 依赖声明），命令行打包流程按契约
补齐并在 CI/CD 文档化该差异。演进观察：DevEco 工具链对"CLI 与 IDE 打包等价性"
的官方说明。

## 临时方案（Workarounds）

- **W-0013（tested，已验证 2026-08-06）**：放弃 hvigor CLI 打包，改用 DevEco
  Studio IDE 直接 Run 部署（Build → Run）——IDE 打包流程正确处理所有模块注册。

  代价：**CI/CD 自动化场景不可用**（命令行打包是流水线标配）；日常开发流程
  绑定 IDE。
  退役条件：hvigor CLI 打包差异查明并修复（或 CLI 提供等价 IDE 打包的正确
  配置项）后，恢复命令行打包并回归启动测试。

## 跟踪单（Tickets）

暂无（源页无单号）。**占位 T-0008**：若查明差异属工具链缺陷并向华为/DevEco
提交 issue，以 T-0008 立案（tracker=ohos-issue 或 gitee）；若属 CLI 用法契约，
无需提单，本节改记官方文档链接。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-08-06 | OHOS + hvigor CLI (--mode module) + Qt 5.15.16 | CLI 打包 HAP 启动崩溃（错误原文）；回退无 patch libqohos.so 仍崩；IDE Run 正常（对照） | 排除 Qt 代码变更，锁定 CLI vs IDE 打包差异（NAPI 模块注册不完整） | → diagnosed |

## 关联

- 症状（S）：S-0014
- 临时方案（W）：W-0013
- 跟踪单（T）：暂无（占位 T-0008）
- problems：[deploy-fail-hvigor-cli-hap-crash](../problems/deploy-fail-hvigor-cli-hap-crash.md)（错误检索、对照实验记录）
- semantic：[qt-harmonyos-build-run-workflow](../semantic/qt-harmonyos-build-run-workflow.md)、[qt-harmonyos-project-structure](../semantic/qt-harmonyos-project-structure.md)
- 相关根因（C，含 depends_on 说明）：无

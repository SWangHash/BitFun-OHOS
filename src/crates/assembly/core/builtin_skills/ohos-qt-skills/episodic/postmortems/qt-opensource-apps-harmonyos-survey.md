---
id: episodic-qt-opensource-apps-harmonyos-survey
type: episodic
domain: project
tags: [qt, harmonyos, opensource, survey, porting-assessment, multi-agent-workflow]
created: 2026-06-25
updated: 2026-06-26
status: active
audience: public
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-third-party-libs, semantic-qt-harmonyos-qt6-status, semantic-qt-harmonyos-modules]
summary: >
  2026-06-25 多 agent 工作流扫描 GitHub/KDE Apps/Gitee/SourceForge/Wikipedia，筛选 229 个 Qt
  开源桌面应用并逐个评估鸿蒙化难度。难度分布：低 3 / 中 23 / 高 126 / 阻断 77；D-Bus(107)、
  QtMultimedia(76)、QtWebEngine(62) 为三大阻断模块。产出清单在 <INTERNAL_OUTPUT>。沉淀"大 schema
  输出失败→主循环生成"的工作流教训。
---

# Qt 开源应用鸿蒙化难度调研 — 经验总结

## 项目概览

| 字段 | 内容 |
|------|------|
| 时间 | 2026-06-25 |
| 角色 | Qt for HarmonyOS 开发者 |
| 技术栈 | Qt 5.12/5.15 for OHOS（评估基准）、多 agent 工作流、Node.js 报告生成 |
| 规模 | 扫描 18 类别 → 去重 230 → 确认 229 个 Qt 应用，逐个难度评估 |
| 状态 | 已完成 |
| 产出 | `<INTERNAL_OUTPUT>` + `.csv`（不纳入知识页索引） |

## 背景与目标

为体现知识库能力 + 为鸿蒙 PC 生态筛选可适配的开源 Qt 应用，需在知名开源代码网站扫描 150+ 个 Qt 桌面应用，梳理清单并评估每个应用的鸿蒙化难度（依赖鸿蒙化难度为主）。评估字段：应用类别、网站、Qt 版本、Qt 模块、应用价值、鸿蒙化难度+说明。

## 方法论（关键决策）

### 决策 1: 多 agent 工作流编排（Discovery → Enrich → 主循环生成）
- **背景**：150+ 应用逐个 fetch 仓库+评估，单 context 无法承载，需并行编排。
- **选择**：18 类别 discovery agent 并行搜索（GitHub/KDE/Gitee/SourceForge/Wikipedia 多源）→ 去重 → 逐应用 enrich agent（fetch README+构建文件，提取 Qt 版本/模块/依赖，按 7 维度评分）→ 主循环生成报告。
- **理由**：pipeline+barrier 编排，难度评估标准从 KB 4 个核心页（golden-rules/platform-limits/third-party-libs/qt6-status/modules）提炼注入每个 enrich agent prompt，确保评估有据可依。
- **结果**：248 个 agent，319k tokens，产出 229 条结构化评估。质量高——难度判断与 KB 平台限制知识一致（如 JIT 类模拟器因 W^X/dlopen 阻断 = 5）。

### 决策 2: 难度评估 7 维度 + 1-5 分
- **维度**：qt_version_fit / qt_module_availability / deps_ohos_difficulty / platform_specific_code / build_system / hardware_deps / architecture_fit
- **标尺**：Qt 模块可用性是第一标尺——WebEngine/DBus/RemoteObjects/SerialBus/NFC/Gamepad 不可用，Multimedia 需自编译，Qt6 仅 qtbase。

## 关键发现（可复用经验）

### Qt 桌面应用鸿蒙化难度普遍偏高
- **229 个应用难度分布**：🟢低 3 ｜ 🟡中 23 ｜ 🟠高 126 ｜ 🔴阻断 77（**高+阻断占 89%**）
- **三大阻断模块**（应用数）：Qt D-Bus 107 ｜ QtMultimedia 76 ｜ QtWebEngine 62
- **其他不可用模块**：X11Extras 15、AndroidExtras 6、WinExtras 6、MacExtras 5、Gamepad 2、RemoteObjects 1、SerialBus 1
- **根因**：Qt 桌面应用普遍依赖 Linux 桌面生态（D-Bus 通知/媒体键、X11 窗口管理、PulseAudio/ALSA 音频、WebEngine 内嵌网页），这些在鸿蒙均不可用或需替换为 OHOS 原生 API。

### 仅 3 个低难度应用（score≤2）
都是纯 Qt 跨平台 UI + 少依赖 + Qt5 + CMake + 单窗口的应用（如 DB Browser for SQLite，仅需 SQLite chmod patch）。**移植选型应优先从这 3 个 + 23 个中难度中筛选。**

### 高频移植路径模式（enrich agent 反复给出的建议）
1. **Qt6 → Qt5.15 for OHOS 降级**（多数现代 Qt 应用用 Qt6，而 OHOS 主力是 Qt5）
2. **QtMultimedia 替换**：用 OHOS NDK 自行交叉编译，或改接 OHOS OHAudio/MediaPlayer
3. **D-Bus 移除**：通知/媒体键改用鸿蒙输入事件或 AVSession
4. **FFmpeg 交叉编译**：媒体类应用几乎都依赖，需 OHOS NDK 验证 chmod/symlink/dlopen 兼容性
5. **X11/Win32/Cocoa 平台后端重写**：合成器/音频输出/窗口管理需为 OHOS 重写
6. **SQLite chmod patch**：DB 类应用复用 KB 已有方案

### JIT 类应用根本阻断
Dolphin/PCSX2/RPCS3 等模拟器依赖 JIT 动态重编译（需可写+可执行内存），受鸿蒙 W^X 执行保护 + dlopen 拒绝可写路径限制，**架构级阻断**，非替换模块可解。退回解释器性能不可用。

## 踩过的坑

### 坑 1: synthesis agent 通过 schema 输出巨型 JSON 失败
- **现象**：让单个 agent 通过 StructuredOutput schema 输出 150+ 行 markdown 表格 + CSV + stats 的巨型 JSON，连续 5 次 schema 验证失败（retry cap exceeded），工作流整体 failed。
- **根因**：输出过长 + JSON 转义（markdown 换行/引号/反斜杠）导致 schema 反复验证不通过。
- **解决**：删除 synthesis 阶段，工作流只返回结构化 apps 数组（discovery/enrich 的 agent 调用不变 → resume 时缓存命中，0 token 重跑）；markdown/CSV 改由主循环用 Node.js 脚本从 JSON 生成。
- **教训**：**永远不要让 agent 通过 schema 输出大段格式化文本（markdown/CSV/代码）**。应让 agent 输出结构化小对象，格式化文本由主循环代码生成。这是 multi-agent 工作流的关键设计原则。

### 坑 2: enrich agent 返回的 category 字符串碎片化
- **现象**：18 类别 discovery 给的是规范大类，但 enrich agent 自由发挥了 category 字段，导致 79 个碎片类别（很多只含 1 个应用）。
- **解决**：报告生成脚本加类别归一化映射（CAT_MAP 关键词匹配 → 18 大类），注意关键词冲突（"编辑器"被开发工具抢走办公的 Markdown 编辑器、"数据可视化"被数据库抢走科学类）——靠调整 CAT_MAP 顺序和 key 归属解决。
- **教训**：agent 自由文本字段需在下游做归一化，不能假设 agent 严格遵守枚举。

## 可复用的经验

- **多 agent 调研工作流模板**：discovery（按领域 fan-out 多源搜索）→ 去重 → enrich（逐项 fetch+评估，难度标准注入 prompt）→ 主循环生成报告。可复用于任何"大规模清单+逐项评估"任务。
- **难度评估标准应来自 KB**：把 golden-rules/platform-limits/third-party-libs/qt6-status/modules 提炼成评估维度注入 agent prompt，保证评估一致性且可追溯。
- **resume + 最小改动修复**：工作流失败时，只改失败部分（删除 synthesis），前面 agent 调用不变 → resume 缓存命中，0 token 重跑。这是修复失败工作流的最经济方式。
- **报告生成脚本**：`<INTERNAL_OUTPUT>` 可作为"JSON → markdown+CSV"生成器的参考模板。

## 相关资源

- 产出清单：`<INTERNAL_OUTPUT>` + `.csv`（229 应用完整评估）
- 报告生成脚本：`<INTERNAL_OUTPUT>`
- 工作流脚本：`.../workflows/scripts/qt-opensource-harmonyos-survey-wf_f8c299ff-12d.js`
- 评估标准来源：[[qt-harmonyos-golden-rules]]、[[qt-harmonyos-platform-limits]]、[[qt-harmonyos-third-party-libs]]、[[qt-harmonyos-qt6-status]]、[[qt-harmonyos-modules]]

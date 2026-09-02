---
id: procedural-qt-app-harmonyos-completion
type: procedural
domain: workflow
tags: [workflow, qt, harmonyos, completion, functional-test, test-case, source-scan, human-test-loop, app-harmonyos]
created: 2026-07-16
updated: 2026-08-12
status: active
audience: public
refs: [procedural-qt-ohos-run-test, procedural-qt-app-harmonyos-migration, procedural-framework-fix-verification, procedural-framework-issue-analysis, procedural-demo-generation, semantic-qt-ohos-project-analyzer-workflow, semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-api-mapping]
summary: >
  应用鸿蒙化完善工作流（功能级测试用例闭环,四阶段）：扫描应用源码识别核心功能点→生成10核心测试用例（AI扫源码+人工review）→
  人工测试/反馈问题/修复/回归循环→10用例全pass闭合。前置：运行测试(qt-ohos-run-test)通过。
  含三件套(ASCII循环图/循环退出条件✅10用例全pass/门控检查⚠️)。
leader_summary: >
  把"应用能跑起来"推进到"核心功能全验证通过",通过AI扫源码生成10核心用例+人工测试反馈修复闭环,沉淀功能级测试资产。
impact: [迁移提效, 框架支撑]
deliverables: [工作流, 测试用例清单, 问题沉淀]
evidence: [<APP_NAME>完善测试报告, <WORKLOG>]
---

# 应用鸿蒙化完善工作流

> **适用场景**：Qt 鸿蒙化应用已通过运行测试（[[qt-ohos-run-test]]）跑起来，需对核心功能做端到端验证闭环（非仅"能跑"，而是"核心功能全通过"）。
> **前置条件**：① 运行测试工作流七阶段已全 pass（进程存活+渲染+生命周期+窗口+输入+平台限制回归） ② 应用源码可读 ③ 真机/模拟器可用。
> **预期耗时**：2-6 小时（视应用复杂度与缺陷密度）。

---

## 触发条件

- 应用已通过 [[qt-ohos-run-test]]（运行测试），需进入功能级验证
- 客户/业务方要求"核心功能全验证通过"而非仅"能启动"
- 迁移后需沉淀功能测试资产（10 核心用例清单可复用）

> **与运行测试的边界**：run-test 聚焦"让应用在真机跑起来"（部署/启动/渲染/崩溃），本工作流聚焦"核心功能行为正确"（按用例操作验证预期）。run-test 是本工作流的前置。

---

## 流程总览

```
§1 扫描应用源码 → §2 生成10核心用例 → §3 人工测试/反馈/修复循环 → §4 闭合(10全pass)
                                                │
                                                └─ 循环退出条件：10用例全✅
```

> **📋 TODO 同步点**：本工作流为多步骤任务，每个阶段转换时更新 `<LOCAL_TODO>` 该任务「进展」列；任务完成时同会话移至「✅ 已完成」并追加 `<WORKLOG>`。

---

## 阶段一：扫描应用源码

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段一进行中：扫描应用源码`

### 1.1 源码定位与入口识别

- 定位应用源码根目录（`OhosExampleApp/` + `main.cpp` + 业务源码）
- 识别入口链：`extern "C" int main()` shim → QApplication → 主窗口构造
- 参见 [[qt-ohos-project-analyzer-workflow]]（工程分析工作流，双重验证）

### 1.2 核心功能点扫描

用 grep/源码阅读识别核心功能，按优先级：

| 优先级 | 功能类型 | grep/识别关键词 |
|--------|---------|----------------|
| P0 | 主窗口与菜单 | `QMainWindow`/`QMenuBar`/`QToolBar`/`addAction` |
| P0 | 核心业务交互 | `QPushButton::clicked`/`QDialog`/`QInputDialog`/`exec()` |
| P1 | 文件操作 | `QFileDialog`/`QFile`/`save`/`open` |
| P1 | 数据模型 | `QTableView`/`QListView`/`QSql*Model` |
| P2 | 设置/配置 | `QSettings`/`QComboBox`/`QCheckBox` |
| P2 | 平台相关 API | `QProcess`(按场景:无界面保留/有界面改 startAppProcess 或 startAbility)/`chmod`/`symlink`（见 [[qt-harmonyos-api-mapping]]） |

> **⚠️ 元教训**：扫描时识别平台相关 API（QProcess/chmod/symlink 等），这些在鸿蒙需替换（见 [[qt-harmonyos-golden-rules]] P1-P5 + [[qt-harmonyos-api-mapping]]），纳入测试用例重点验证。

### 循环退出条件（必须全部满足）

- ✅ 入口链梳理完成（main→QApp→主窗口）
- ✅ 15-20 候选核心功能点识别（含平台相关 API 标注）
- ✅ 平台限制/铁律相关功能点已标注（参见 [[qt-harmonyos-golden-rules]]）

### 输出物

- 核心功能点清单（15-20 项，标注优先级 P0/P1/P2 + 平台相关标记）

> **⚠️ 门控检查**：未完成源码扫描前，**禁止生成测试用例**（无源码依据的用例是凭空臆测）。

---

## 阶段二：生成 10 核心测试用例

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段二进行中：生成10核心测试用例`

### 2.1 AI 生成用例初稿

基于阶段一功能点清单，AI/Agent 生成 10 核心测试用例初稿（选 P0 优先，覆盖主路径）。

**用例模板**：

```
### 用例 TC-NN：<用例名>
- **功能点**：<对应源码功能>
- **前置**：<运行测试通过 + 特定初始状态>
- **操作步骤**：
  1. <操作1>
  2. <操作2>
  3. <操作3>
- **预期结果**：<可观察的正确行为>
- **实际结果**：<待人工填写：pass/fail + 现象>
- **状态**：<待填写：✅pass / ❌fail / 🟡flaky>
```

### 2.2 人工 review 与固化

- 人工 review 10 用例初稿：覆盖主路径？操作可执行？预期可观察？
- 调整：合并/拆分/补充，确保 10 用例覆盖应用最核心 10 个功能
- 固化为测试用例清单（表格 + 每用例详情）

**10 用例清单表**（示例骨架，按应用实际填充）：

| TC# | 用例名 | 优先级 | 状态 |
|-----|--------|:------:|:----:|
| TC-01 | 主窗口启动显示 | P0 | 🟡待测 |
| TC-02 | 菜单/工具栏操作 | P0 | 🟡待测 |
| TC-03 | 核心业务对话框 | P0 | 🟡待测 |
| ... | ... | ... | ... |
| TC-10 | 核心业务闭环 | P0 | 🟡待测 |

> 参见 [[framework-fix-verification]] 验证用例编写规范（每问题一用例、复用 Qt Examples、README 模板）。

### 循环退出条件（必须全部满足）

- ✅ 10 核心测试用例已生成（含操作步骤+预期）
- ✅ 人工 review 通过（覆盖主路径、操作可执行、预期可观察）
- ✅ 用例清单已固化为文档

### 输出物

- 10 核心测试用例清单（表格 + 每用例详情模板）

> **⚠️ 门控检查**：用例未固化前，**禁止进入人工测试**（无清单的测试是随机操作）。

---

## 阶段三：人工测试 / 反馈 / 修复循环 ★核心

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段三进行中：人工测试循环（X/10 pass）`

> **本阶段为循环过程，必须 10 用例全 pass 后才能进入阶段四。**

```
┌──────────────────────────────────────────────────────────┐
│  测试循环开始                                             │
│  ↓                                                       │
│  3.1 取下一个待测用例（或回归失败的用例）                  │
│  ↓                                                       │
│  3.2 人工真机操作，按用例步骤执行                          │
│  ↓                                                       │
│  3.3 实际结果 == 预期 ?                                   │
│  ├─ 是 → 标记 ✅pass → 该用例闭合                        │
│  └─ 否 ↓                                                 │
│  3.4 反馈问题（现象+截图+hilog+栈帧）                     │
│  ↓                                                       │
│  3.5 定位根因（参见 [[qt-ohos-run-test]] §5 崩溃分析 +  │
│       [[framework-issue-analysis]] 调用链）              │
│  ↓                                                       │
│  3.6 修复源码（应用层/API 替换/平台限制规避）             │
│  ↓                                                       │
│  3.7 回归：重新构建+安装+重测该用例 → 回到 3.3           │
│  ↓                                                       │
│  10 用例全 ✅pass ?                                       │
│  ├─ 否 → 取下一用例 → 回到 3.1                          │
│  └─ 是 → 退出循环 ✓                                      │
│                                                           │
│  退出条件：10 核心用例全部 ✅pass                        │
└──────────────────────────────────────────────────────────┘
```

### 3.1-3.2 执行用例

- 真机/模拟器按用例步骤操作（`hdc shell aa start` + 手动交互）
- 截图/hilog 记录实际行为

### 3.3-3.4 结果判定与反馈

| 实际 vs 预期 | 状态 | 动作 |
|-------------|------|------|
| 一致 | ✅pass | 用例闭合，取下一用例 |
| 不一致 | ❌fail | 反馈问题（现象+截图+hilog+栈帧）进 3.5 |
| 部分一致/不稳定 | 🟡flaky | 多次复现确认是 fail 还是时序 |

### 3.5-3.6 定位与修复

- 崩溃/异常 → [[qt-ohos-run-test]] §5 崩溃分析循环 + [[framework-issue-analysis]] 调用链
- 平台限制触发 → [[qt-harmonyos-golden-rules]] P1-P5 + [[qt-harmonyos-api-mapping]] 替换
- 应用层逻辑 bug → 改源码
- 修复后回归（3.7）：重新构建+安装+重测该用例

### 循环退出条件（必须全部满足）

- ✅ 10 核心用例**全部** ✅pass（非 9/10，必须全 pass）
- ✅ 每个 fail 用例的修复已经回归验证（非口头修复）
- ✅ flaky 用例已多次复现确认稳定 pass

### 输出物

- 测试报告（10 用例 pass/fail 记录 + 截图对照）
- 修复清单（每用例修复的源码改动 + 关联 problem）

> **⚠️ 门控检查**：未达 10 用例全 pass 前，**禁止进入阶段四闭合**。有未解决 fail 的工作流视为未完成。

---

## 阶段四：闭合与沉淀

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` — 将此任务从「📌 进行中」移至「✅ 已完成」，填写完成日期和结果摘要

### 4.1 测试报告

| TC# | 用例名 | 最终状态 | 修复次数 | 关联 problem |
|-----|--------|:--------:|:--------:|-------------|
| TC-01..10 | ... | ✅ | N | ... |

### 4.2 问题沉淀

- 修复中遇到的新错误 → `problems/`（用 `_templates/qt-problem.md`）+ 运行 `bash _scripts/kb-regen-indexes.sh` 重生 `problems/_lookup.md` 等派生索引
- 新 API 差异 → [[qt-harmonyos-api-mapping]]
- 新平台限制 → `qt-harmonyos-platform-limits`（内部沉淀）

### 4.3 工作流闭合确认

- [ ] 10 核心用例全 ✅pass
- [ ] 测试报告已输出
- [ ] 问题已沉淀到 `problems/` + 索引同步
- [ ] `<LOCAL_TODO>` 移至「✅ 已完成」
- [ ] `<WORKLOG>` 追加记录
- [ ] 已提交 git commit

---

## 检查清单

- [ ] 前置：运行测试（[[qt-ohos-run-test]]）已通过
- [ ] 阶段一：源码扫描完成，15-20 功能点清单
- [ ] 阶段二：10 核心用例生成+人工 review+固化
- [ ] 阶段三：10 用例全 ✅pass（含 fail 修复回归）
- [ ] 阶段四：测试报告+问题沉淀+索引同步

---

## 常见问题模式

| 模式 | 表现 | 排查方向 | 关联 |
|------|------|----------|------|
| 用例 fail-崩溃 | 操作触发 SIGSEGV/SIGABRT | [[qt-ohos-run-test]] §5 崩溃分析 | run-test |
| 用例 fail-平台限制 | chmod/symlink/dlopen 失败 | [[qt-harmonyos-golden-rules]] P1-P5 | golden-rules |
| 用例 fail-API 不可用 | QtWebEngine 等鸿蒙缺；QProcess 有界面子进程须改 startAppProcess/startAbility | [[qt-harmonyos-api-mapping]] §1 | api-mapping |
| 用例 flaky | 时序/竞态致间歇 fail | 多次复现+[[framework-issue-analysis]] 调用链 | framework-issue-analysis |
| 用例无法执行 | 前置功能未实现/阻塞 | 标记阻塞，回到 [[qt-ohos-run-test]] 补或转入迁移 | run-test |

---

## 供应链

> 详见 工作流供应链 §应用移植（本工作流为迁移后续的功能级完善环节）

| 维度 | 详情 |
|------|------|
| **上游来源** | 应用移植完成 + qt-ohos-run-test 运行测试通过的应用 |
| **上游输入** | 能跑起来的鸿蒙应用 + 应用源码 + 真机/模拟器 |
| **下游接收方** | 商业 Qt 客户 / 内部（核心功能验证通过的可交付应用） |
| **交付件** | 10 核心用例清单 + 测试报告 + 问题沉淀 |
| **交付件路径** | 无固定目录（测试资产随应用工程） |
| **分流规则** | 发现框架 bug → framework-issue-analysis 工作流；已知问题 → 查 `_lookup` |

---

## 相关上下文

- [[qt-ohos-run-test]] — 运行测试工作流（前置，跑起来才能完善）
- [[qt-app-harmonyos-migration]] — 应用鸿蒙化迁移（完善的前序）
- [[framework-fix-verification]] — 验证用例编写规范参考
- [[framework-issue-analysis]] — 框架问题分析（fail 用例定位调用链）
- [[qt-ohos-project-analyzer-workflow]] — 工程分析（源码扫描）
- [[qt-harmonyos-golden-rules]] — 35 条铁律（P1-P5 平台限制验证）
- [[qt-harmonyos-api-mapping]] — API 替换（源码扫描识别需测 API）
- [[demo-generation]] — Demo 生成（用例工程可复用 demo 模板）
- 工作流供应链 — 工作流供应链总览

---

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 10 核心用例生成方法论、人工测试反馈修复循环、用例模板 |
| 🔍 框架源码 | 源码扫描关键词（QMainWindow/QDialog/QProcess 等） |
| 📖 官方文档 | Qt 测试实践、HarmonyOS 功能验证 |
| 📦 KB 工作流 | run-test（前置）/framework-fix-verification（用例规范）/framework-issue-analysis（定位） |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

---

## 参考来源

- 基于 Qt 鸿蒙化应用完善工作经验开发的工作流
- 方法论参考 Qt 内部 QA 流程 + 本库 run-test/framework-fix-verification 工作流

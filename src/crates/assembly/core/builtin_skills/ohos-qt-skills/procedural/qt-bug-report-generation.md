---
id: procedural-qt-bug-report-generation
type: procedural
domain: tools
tags: [bug-report, workflow]
created: 2026-08-01
updated: 2026-08-12
status: active
audience: public
refs: [procedural-qt-bug-report-sample, procedural-framework-issue-analysis, semantic-qt-harmonyos-golden-rules]
summary: >
  Bug report 生成工作流：从对话上下文或已有 problem 页提取信息→填内嵌模板→自检可复现性（HARD 闸门）→
  产出两种形态（form A 完整交付件交付华为 / form B 精简版贴 issue tracker）。外部伙伴只看本页 +
  样例页即可学会写 bug report，模板结构内嵌于本页，不依赖任何内部模板文件。
---

# Qt for HarmonyOS Bug Report 生成

> 当 Qt 开发者/伙伴遇到 SDK 问题（崩溃 / 行为异常 / 接口与文档不符）需要上报，或内部团队要把已确认的鸿蒙系统问题正式交付华为时，按此流程生成结构化 bug report。
> **本页自洽**：外部伙伴只看本页 + [[procedural-qt-bug-report-sample]] 样例页即可学会写 bug report。模板结构内嵌于 §模板结构 段，不依赖任何内部模板文件。

---

## 触发场景

- **外部上报**：Qt 开发者/伙伴遇到 SDK 问题（崩溃 / 行为异常 / 接口不符），想上报给 Qt for HarmonyOS 维护团队——在对话中识别到 Qt 框架问题或鸿蒙系统问题，选 **form B**（精简版，复制即填，贴 issue tracker 或邮件）
- **内部交付**：维护团队已通过 bug-triage 工作流完成分析，要把已确认的鸿蒙系统问题正式交付华为——选 **form A**（完整交付件，含深度分析段 + 纯鸿蒙 demo + 日志目录）
- **KB 沉淀推广**：KB 中已有 problem 页（`problems/<type>-<slug>.md`），需推广为可上报的 bug report——机械复制 problem 字段到模板 + 补分析段，产出后可双向回流

---

## 输入

### 报告方提供（必填 5 项）

| # | 必填项 | 说明 | 难度 |
|---|--------|------|:----:|
| 1 | **Qt 复现 demo** | 本就有的工程，能触发问题即可，不必最小化 | 易 |
| 2 | **faultlog** | 用 §模板结构 给的 hdc 一条命令抓取 | 易 |
| 3 | **复现环境（六项）** | OS 版本 / SDK 版本 / Qt 版本+commit / 设备型号 / 工具链版本 / 构建模式 | 易 |
| 4 | **复现步骤** | ≤3 步，从应用启动到问题出现 | 易 |
| 5 | **紧急度** | P0 阻塞 / P1 严重 / P2 一般 / P3 轻微 | 易 |

### 报告方可选

| 可选项 | 说明 | 拿不准时 |
|--------|------|---------|
| 初步判定 | 问题归属（Qt 框架 / 鸿蒙系统 / 应用层） | 写"不清楚"即可，不卡 |
| 已尝试排查 | 已经做过哪些排查尝试 | 留空即可 |
| 官方文档差异 | 发现的文档与实际行为不符之处 | 留空即可 |

> **原则**：难字段（问题归属、文档对比）写"不清楚"即可，不卡。这些由内部团队在 form A 深度段补全。

### 内部团队补全（来自 bug-triage 阶段二/三）

| 深度段 | 内容 | 来源 |
|--------|------|------|
| 调用链追踪 | 从 Qt 层到系统接口的完整调用链 | bug-triage 阶段三 §3.1 |
| 系统接口表现 | 系统接口的输入参数、返回值、与文档预期的对比 | bug-triage §3.4 |
| 直接调用验证 | 绕过 Qt 直接调用系统接口的结果；含**回调内同步查询法 match=0 铁证**（见下） | bug-triage §3.8 |
| 官方文档对比表 | 文档描述 vs 实际表现的逐维度对比 | bug-triage §3.5 |
| 纯鸿蒙复现 demo | `ohos-repro/` 目录，证明问题与 Qt 无关 | bug-triage §4.3 |

> **回调内同步查询法（match=0 铁证）**：当系统回调报告值可疑与实际状态不一致时，在该回调**内、同步**用系统自身 API 查询实际状态并比对报告值。三层交叉验证使其无懈可击：①**同步性**——查询在回调内紧跟报告值日志，同一时间戳，无延迟，排除"调用方调晚了"；②**同一对象**——查询的是回调传入的那个对象指针；③**独立回调交叉**——另一个独立系统回调的报告值对照，若它与本回调报告值不一致、却与同步查询的实际值一致，证明同步查询正确。`match=0`（报告值≠实际状态）= **铁证系统 bug**：系统在回调里报的值，对象当时就没有。

### KB problem 页机械复制（如已沉淀）

如 KB 中已有对应 problem 页，以下字段可机械复制到模板，无需重新编写：

| problem 页字段 | 对应模板位置 |
|---------------|-------------|
| `summary` | → 问题概述 |
| `environment` | → 复现环境 |
| `error_message` | → 错误日志 |
| `error_code` | → 错误日志（附在日志后） |
| `symptoms` | → 实际行为 |
| `severity` | → 紧急度（映射 critical→P0, high→P1, medium→P2, low→P3） |
| `keywords` | → 问题概述（关键词标注） |
| 正文 `## 错误信息` | → 错误日志 |
| 正文 `## 场景` | → 复现步骤 |
| 正文 `## 验证方法` | → 预期行为 / 实际行为 |

---

## 输出（两种形态）

> 模板分两个段：**(A) 段** = 报告方必填的基本信息段；**(B) 段** = 内部团队补全的深度分析段。

### form A — 完整交付件

渲染 (A) + (B) 两段全部内容，输出为交付目录：

```
${DELIVERABLES_ROOT}/<issue-name>/
├── SYSTEM_ISSUE_REPORT.md    → 完整报告（(A)+(B) 全段渲染）
├── ohos-repro/               → 纯鸿蒙复现 demo（核心交付件）
├── qt-repro/                 → Qt 复现 demo（辅助证据）
├── logs/                     → 关键日志文件
└── README.md                 → 交付物概览
```

交付对象：**华为鸿蒙系统团队**。对应 bug-triage §4.2 的重版本。

### form B — issue 精简版

仅渲染 (A) 段 + (B) 段压缩成一段初步分析，输出为单文档：

- 贴入 issue tracker（GitCode / Gitee / GitHub）正文
- 或作为邮件正文发送

交付对象：**外部伙伴快速提单**或**维护团队初步流转**。

---

## 步骤

### 1. 选形态

| 场景 | 形态 | 理由 |
|------|------|------|
| 外部伙伴上报，复制即填 | **form B** | 精简，不要求深度分析能力 |
| 内部已分析完，交付华为 | **form A** | 完整，含深度段 + 纯鸿蒙 demo |

### 2. 报告方填必填 5 项

按 §模板结构 的字段表逐项填写：

- **复现环境（六项）**：照表填，缺哪项标"未知"
- **故障现象**：预期行为 + 实际行为，有截图附截图
- **错误日志**：用模板给的 hdc 命令一条抓取（见 §模板结构 → faultlog 抓取）
- **复现步骤 + Qt demo**：≤3 步，附 demo 工程或代码片段
- **紧急度**：P0/P1/P2/P3

> 难字段（问题归属、文档对比）写"不清楚"即可，不卡——这些在 form A step 5 由内部团队补全。

### 3. 跑完整性自检（HARD 闸门）

以下四项全部勾选才能进入下游，**任一未勾退回补全**：

- [ ] **HARD** 六项环境齐全（OS/SDK/Qt commit/设备/工具链/构建模式）
- [ ] **HARD** 复现步骤 ≤3 步
- [ ] **HARD** 预期 / 实际 / 日志三项完整（不能只有"出错了"无具体现象）
- [ ] **HARD** demo 已附（工程或代码片段）

> 此闸门不通过 = 下游无法判断可复现性，必须退回。不进入 step 4。

### 4. 填缺失信息与澄清点（内控后闸门）

把模板中所有模糊处**显式列出**，送出前清零，实现"**不回头追问**"：

| 检查项 | 处理 |
|--------|------|
| 环境某项标"未知" | 补全或标注"不影响复现" |
| 复现步骤有歧义 | 追问触发条件，写明确 |
| 预期/实际描述模糊 | 具体化（"窗口不显示"→"调用 setSize 后窗口仍为 0x0"） |
| 日志与现象不对应 | 标注哪行日志对应哪个现象 |

> **原则**：送出前所有"不清楚"和歧义点清零。form B 可保留少量"不清楚"（精简版容忍度高），form A 必须全部澄清。

### 5.（A）接收方补全深度段

form A 专属。以下深度段需 Qt 源码与 N-API 直调能力，来自 bug-triage 阶段二/三：

| 深度段 | 做什么 | 关键方法 |
|--------|--------|---------|
| **调用链追踪** | 从 demo 入口 API 沿 Qt 源码追到系统接口调用点 | 重点关注 `src/plugins/platforms/ohos/`（QPA 插件层）和 `qtohosextras/` |
| **系统接口表现** | 在系统接口调用前后加日志，记录输入参数和返回值 | 统一 `[OHOS-BUG-TRIAGE]` 前缀，`hdc shell hilog \| grep "[OHOS-BUG-TRIAGE]"` 过滤 |
| **官方文档对比** | 逐维度对比文档描述 vs 实际表现 | 文档源：[HarmonyOS Native API](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/native-apis-overview)、[Ability 框架](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ability-kit) |
| **直接调用验证** | 绕过 Qt 直接调用系统接口，确认问题独立于 Qt 复现 | 含**回调内同步查询法 match=0 铁证**（见 §输入 → 内部团队补全 中的说明） |
| **纯鸿蒙 demo** | 用最少的鸿蒙原生代码复现问题 | 四原则：①最小化 ②独立化 ③可运行 ④对照化（见下） |

> **纯鸿蒙 demo 四原则**：
> 1. **最小化**——只包含触发问题所必需的系统接口调用
> 2. **独立化**——不依赖 Qt 或任何第三方库
> 3. **可运行**——提供完整 DevEco Studio 工程，可直接编译部署
> 4. **对照化**——如有正确预期行为，在 demo 中同时展示正确和异常的对比

### 6.（A）跑交付件检查清单 + ★人工校验

form A 专属。交付件经**人工 review** 后才能提交华为：

- [ ] SYSTEM_ISSUE_REPORT.md 已创建，(A)+(B) 全段完整
- [ ] 纯鸿蒙复现 demo（ohos-repro/）可独立编译运行
- [ ] Qt 复现 demo（qt-repro/）已整理
- [ ] 关键日志已收集并标注（关键行用 `>>>` 标记异常点）
- [ ] 所有文件已放入 `${DELIVERABLES_ROOT}/<issue-name>/`
- [ ] README.md 交付物概览已创建
- [ ] ★ **人工校验已完成**：交付件经人工 review，根因判定由人工签署

> **issue #774 教训**：AI 产出的交付件——复现 demo、诊断补丁、根因判定——都必须经人工确认后才能对外交付。AI 自检不能替代人工校验：AI 可能误报"复现成功"、漏看 patch 中的拼写错误、或在日志未实际出现时声称已确认。**提交动作（向外发送）由人工执行，不由 AI 自动提交。**

### 7. 推广为 KB problem 页（如需沉淀）

如需将 bug report 沉淀回 KB problem 页，做以下机械转换：

| 转换项 | bug report | problem 页 |
|--------|-----------|-----------|
| type | `bugreport` | `problem` |
| id 前缀 | `bug-report-<slug>` | `problem-<slug>` |
| bug 专属字段 | 报告编号/报告人/紧急度等 | 删除（problem 无此字段） |
| frontmatter 注释 | 可能有 `# 说明` 注释 | 填裸值，删注释 |
| 存放位置 | 交付目录 | `problems/` |

转换后：
1. 移入 `problems/` 目录
2. 运行 `bash _scripts/kb-regen-indexes.sh` 重生 `problems/_lookup.md` + `_index/_map.md` 等派生索引（自动从 frontmatter 重建，无需手补条目/summary）
3. 其余字段（summary/environment/error_message/symptoms/severity/keywords + 正文段）原样保留

> 转换后的 problem 页 8 字段（id/summary/refs/tags/audience/status/type/updated）对齐 `_templates/qt-problem.md` 基准，即过 25 项门禁。

---

## 模板结构（内嵌，自洽）

> 以下模板结构直接内嵌于本页。外部伙伴无需访问任何内部模板文件，照此填写即可。

### 元数据（报告顶部）

| 字段 | form A | form B | 说明 |
|------|:------:|:------:|------|
| 报告编号 | ✅ | 可选 | form A: `OHOS-ISSUE-YYYY-NNN`；form B: issue tracker 自动编号 |
| 报告日期 | ✅ | ✅ | `YYYY-MM-DD` |
| 报告人 | ✅ | ✅ | 姓名 / ID |
| 紧急度 | ✅ | ✅ | P0 阻塞 / P1 严重 / P2 一般 / P3 轻微 |

### 复现环境（六项，两种形态均必填）

| 项 | 示例值 |
|----|--------|
| ① OS 版本 | HarmonyOS 5.0.1 |
| ② SDK 版本 | HarmonyOS SDK 5.0.0 (API Level 12) |
| ③ Qt 版本 + commit | Qt 5.15.16 @ 962aa625 |
| ④ 设备型号 | Mate 60 Pro / 模拟器 |
| ⑤ 工具链版本 | DevEco Studio 5.0 / hvigor 4.0 / clang 15 |
| ⑥ 构建模式 | debug / release |

### faultlog 抓取（一条命令）

```bash
hdc shell hilog -x | grep -iE "fatal|crash|exception|<bundleName>" > faultlog.txt
```

> 如需 native crash dump 文件：
> ```bash
> hdc shell ls -lt /data/log/faultlog/temp/ | head -5
> hdc file recv /data/log/faultlog/temp/<最新文件> ./
> ```

### 段落骨架

**form A 完整结构**（(A)+(B) 全段）：

```
# 鸿蒙系统问题报告

## 基本信息
[元数据表：报告编号/日期/报告人/紧急度]

## 复现环境
[六项环境表]

## 问题概述
[一段话简述：什么操作 → 什么异常]

## 预期行为
[根据官方文档/常识，该接口/功能应该如何表现]

## 实际行为
[观察到的异常，含日志/截图证据]

## 复现步骤
1. [步骤 1]
2. [步骤 2]
3. [步骤 3]
（≤3 步）

## 错误日志
[hdc 抓取的 faultlog，关键行用 >>> 标注异常点]

## 初步判定
[问题归属判断，拿不准写"不清楚"]

--- 以下为 (B) 深度分析段，form A 专属 ---

## 根因分析

### 调用链追踪
[从 Qt 层到系统接口的完整调用链，标注每环节的参数转换]

### 系统接口表现
[系统接口的输入参数、返回值、与文档预期的对比]
[加日志后的 hilog 输出，过滤 [OHOS-BUG-TRIAGE] 前缀]

### 直接调用验证
[绕过 Qt 直接调用系统接口的结果]
[含回调内同步查询法 match=0 铁证（如适用）：
 同步性 + 同一对象 + 独立回调交叉验证 → match=0 = 铁证系统 bug]

## 官方文档对比
| 维度 | 文档描述 | 实际表现 | 差异 |
|------|----------|----------|------|
| [维度1] | [文档怎么说] | [实际是什么] | [差异说明] |

## 纯鸿蒙复现 Demo
[ohos-repro/ 目录说明：编译运行步骤 + 预期 vs 实际]
[四原则：最小化/独立化/可运行/对照化]

## 影响评估
[该问题对 Qt for HarmonyOS 的影响范围和严重性]

## 建议
[对华为的建议：期望的修复方向或临时 workaround]
```

**form B 精简结构**（(A) 段完整 + (B) 段压一段）：

```
## 复现环境
[六项环境表]

## 问题概述
[一段话简述]

## 预期行为
[应该怎样]

## 实际行为
[实际异常 + 日志/截图]

## 复现步骤
1. [步骤 1]
2. [步骤 2]
3. [步骤 3]
（≤3 步）

## 错误日志
[faultlog，关键行 >>> 标注]

## 初步分析
[(B) 深度段压缩成一段：调用链要点 + 系统接口表现要点 +
 直接调用验证结论 + 文档差异要点。无深度分析则写"不清楚"。]
```

---

## 检查清单

### 通用检查（两种形态）

- [ ] 形态已选定（A 或 B）
- [ ] 必填 5 项已填（环境六项 / 故障现象 / 日志 / 步骤+demo / 紧急度）
- [ ] **HARD 闸门通过**：六项齐全 + 步骤≤3 + 预期/实际/日志完整 + demo 已附
- [ ] 模糊点和"不清楚"已显式列出
- [ ] 模板结构完整（照 §模板结构 段落骨架填写）

### form A 附加检查

- [ ] 深度段已补全（调用链 / 系统接口表现 / 直接调用验证 / 文档对比 / 纯鸿蒙 demo）
- [ ] 交付目录结构完整（SYSTEM_ISSUE_REPORT.md + ohos-repro/ + qt-repro/ + logs/ + README.md）
- [ ] ★ 人工校验已完成，提交动作由人工执行

### form B 附加检查

- [ ] 初步分析已压缩成一段（或写"不清楚"）
- [ ] 可直接贴入 issue tracker / 邮件正文

---

## 相关上下文

- [[procedural-qt-bug-report-sample]] — bug report 样例页（完整 form A 示例，照着学）
- [[framework-issue-analysis]] — Qt 框架内部问题分析工作流（step 5 调用链追踪方法来源；判定为 Qt 框架问题时转入此流程）
- 内部 triage 工作流 — 商业 Qt 鸿蒙系统问题验证分析（form A 深度分析段的来源；§4.2 SYSTEM_ISSUE_REPORT.md 规格、§4.6 检查清单、§3.8 回调内同步查询法铁证）
- [[qt-harmonyos-golden-rules]] — 铁律速查（上报前扫描，避免已知陷阱）

---

## 供应链

| 维度 | 详情 |
|------|------|
| **上游来源** | ① 外部 Qt 开发者/伙伴反馈的 SDK 问题 ② 内部 bug-triage 工作流已确认的系统问题 ③ KB 已有 problem 页 |
| **上游输入** | 对话上下文（问题描述/截图/代码片段）+ faultlog + 复现环境 + Qt demo + 可选 problem 页字段 |
| **下游接收方** | form A → 华为鸿蒙系统团队；form B → issue tracker / 邮件 |
| **交付件** | form A: `<issue-name>/` 完整目录；form B: 单文档（.md 或 issue 正文） |
| **交付件路径** | form A: `${DELIVERABLES_ROOT}`；form B: issue tracker 或邮件 |

---

## 与其他工作流的关系

| 场景 | 使用工作流 |
|------|-----------|
| 外部上报 SDK 问题，需生成 bug report | **本流程** form B |
| 内部已分析完系统问题，交付华为 | **本流程** form A（深度段来自 内部 triage 工作流） |
| 判定为 Qt 框架问题（非系统问题） | 转入 [[framework-issue-analysis]]（上游 issue 打包提交） |
| 判定为应用层问题 | 反馈客户修复建议 |
| KB 已有 problem 页，需推广为 bug report | **本流程** step 7 机械转换 |

---

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 💼 工作经验 | 工作流设计、HARD 闸门、不回头追问原则、issue #774 人工校验教训 |
| 🛠️ 框架源码 | 调用链追踪方法（继承自 framework-issue-analysis）、系统接口日志规范（继承自 bug-triage） |
| 📄 华为官方文档 | HarmonyOS API 文档参考（[developer.huawei.com](https://developer.huawei.com/consumer/cn/doc/)） |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

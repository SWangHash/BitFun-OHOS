---
domain: faults
updated: 2026-09-14
counts:
  symptoms: 7
  causes: 8
  workarounds: 6
  tickets: 4
description: >
  问题故障库（图模型）：症状 S × 根因 C（defect/limitation）× 临时方案 W × 上游跟踪单 T。
  单一真源在 _data/*.yaml 与 C 页；_graph.yaml 与 _registry.md 由
  tools/faults-build.py 自动重建（自动演进）。本页是规范：实体/边/状态机、字段、
  录入与复核规则、工具用法。
---

# faults — 问题故障库（图模型，自动演进）

> 一句话定位：`problems/` 回答"这个报错怎么解"；`faults/` 回答"这个现象根因是什么、
> 归谁、是会修的缺陷还是绕不开的规格、修没修、根治/替代前怎么活、上游单跟到哪了"。
> **问题的本质是图**：一个应用层表现（S）可能挂在一个 Qt SDK 缺陷（C-defect，等修复，
> 由 T 跟踪单与 fix_version 跟进）上，也可能挂在一个鸿蒙规格限制（C-limitation，没有
> "修复"，只有 W 替代方案）上，还可能由多个根因叠加产生。

## 一、定位与分工

| 载体 | 记什么 | 粒度 | 检索方式 |
|------|--------|------|---------|
| `problems/` | 单个报错的现象→根因→解法（一错一页） | 错误信息 | 按错误码/报错文本查 `_lookup.md` |
| `faults/`（本库） | **症状×根因×方案×跟踪单图** | 见 §二 | 按**表现**查 `_registry.md` §症状索引 或 `_graph.yaml` |
| `semantic/qt-harmonyos-platform-limits.md` | Qt 官方已确认的平台限制（带 QTBUG） | 平台能力 | 按限制条目 |
| `knowledge/adaptation/blockers.yaml` | 模块/能力级阻断分类（assess 判定用） | 分类法 | 机器层 |
| `episodic/postmortems/` | 问题分析的完整过程复盘 | 事件 | 按 summary |
| `TODO.local.md` | "我要做的事" | 任务 | 个人待办（gitignored） |

关系：报错文本命中 problems 页后，若根因属外部，沿该页 `refs` 里的 `fault-C-xxxx`
进入故障图；反向，C 页经 `refs` 指回深度内容。**problems 不重复记录跟踪状态，
faults 不重复记录解法步骤（详细步骤在 C 页正文或 problems 页，W 记录用 detail 指针引用）。**

## 二、图模型（四类实体 + 四类边）

### 实体

| 实体 | ID | 形态（真源） | 内容 |
|------|----|-------------|------|
| **症状 symptom** | `S-xxxx` | 内联记录：`_data/symptoms.yaml` | 开发者可观察的现象聚类：title/domain/severity/status/causes/first_seen/refs |
| **根因 cause** | `C-xxxx` | 独立页：`C-xxxx-slug.md`（frontmatter 为源，正文为深档案） | 根因证据链、责任判定、根治/替代方案、版本验证记录 |
| **临时方案 workaround** | `W-xxxx` | 内联记录：`_data/workarounds.yaml` | 方案、代价、验证（date+env）、**退役条件**、详细步骤指针（detail） |
| **跟踪单 ticket** | `T-xxxx` | 内联记录：`_data/tickets.yaml` | 上游单（QTBUG-xxx / 华为 issue / 伙伴交付件）、状态、**修复版本号 fix_version**、修复 commit |

limitation 的"替代方案"即 W（`targets` 指向该 C）；defect 的"临时方案"也是 W。
一个 C 可挂多个 W（可选方案），一个 C 可挂多个 T（Qt 侧 + 华为侧各一）。

### 边

| 边 | 方向 | 真源声明处 | 语义 |
|----|------|-----------|------|
| `causes` | S→C | symptoms.yaml 的 `causes` | 症状由根因产生；多根因时 `cause_relation`：`any_of`（默认）/ `all_of`（叠加才致病） |
| `targets` | W→C | workarounds.yaml 的 `targets` | 方案作用于该根因 |
| `tracks` | T→C | tickets.yaml 的 `tracks` | 跟踪单跟进该根因 |
| `depends_on` | C→C | C 页 frontmatter 的 `depends_on` | 本根因的解除被另一根因/限制阻塞（**仅实证可连**，禁止推测） |
| `manifests` | C→S | **派生**（build 从 causes 反推） | 反查索引，自动生成于 _graph.yaml |

### 根因定性（nature）——"修"还是"绕"的分水岭

| nature | 含义 | 解决路径 | 关键字段 |
|--------|------|---------|---------|
| `defect` | 缺陷，**会修** | fix 生命周期：T 上报 → T.fix_version → fix-confirmed → 本地验证 → W 退役 | `fix_route`、T.fix_version |
| `limitation` | 鸿蒙规格/平台限制，**不会"修"** | 替代方案（W）+ 演进观察 | `evidence`（定性证据）、`evolution`（演进方向） |
| `undetermined` | 待定性 | 上游答复后改判，**CID 不变**（历史不抹），条目记录改判证据 | — |

判定规则：以**根因所在层的行为是否可变**为准——Qt 适配层/SDK/编译器的实现错误是
defect；平台规格如此（沙箱、权限模型、API 弃用、能力不提供）是 limitation。
拿不准先记 `undetermined`，定性证据到位后改判。

## 三、责任领域（C.responsible）

| 值 | 含义 | 修复到达路径 |
|----|------|-------------|
| `qt-port` | Qt 鸿蒙适配层（tqtc/harmonyos 分支、libqohos QPA、QtOhosExtras、胶水模板） | 下一版 Qt OHOS SDK / harmonyos 分支 |
| `qt-upstream` | Qt 官方主线缺陷（跨平台存在） | Qt 官方版本（先修主干，再 cherry-pick 到 harmonyos 分支） |
| `ohos-runtime` | HarmonyOS 系统行为（ArkTS runtime、NAPI、窗口管理、IMF、图形） | 系统 OTA / 新 API 版本 |
| `ohos-toolchain` | DevEco Studio / hvigor / hdc / 签名工具 | DevEco 版本更新 |
| `ohos-ndk` | OHOS LLVM/clang、musl、libcxx-ohos、sysroot | SDK/NDK 版本更新 |
| `third-party` | 三方库/图形栈自身（Mesa/ZINK 等） | 三方库版本 |
| `app` | 应用侧代码问题 | 自己修（原则上不建 C，仅作对照） |
| `undetermined` | 未定责 | — |

责任归属以**根因所在层**为准；`co_responsible` 记叠加责任次要方（如 C-0005 × C-0006）。

### 处置分类（disposition，派生视图——开发者视角"遇到该怎么办"）

由 nature × responsible **自动计算**（`faults-build.py` 派生，不入真源、无双写），
输出于 `_registry.md` §按处置分类 与 `_graph.yaml` 的 `disposition` 字段：

| disposition | 标签 | 计算规则 | 含义 |
|---|---|---|---|
| `must-adapt` | **鸿蒙必须适配** | nature=limitation | 平台/SDK 规格如此（沙箱、权限模型、API 弃用、loader 限制、模块范围），改自己的代码，无上游修复可等 |
| `qt-defect` | **Qt 问题** | nature=defect 且 responsible ∈ qt-port/qt-upstream | 等 Qt 修复 / 本地补丁 / 提 QTBUG |
| `system-defect` | **系统问题** | nature=defect 且 responsible ∈ ohos-runtime/ohos-ndk/ohos-toolchain | 等系统/SDK/工具链版本或提华为侧单 |
| `app-usage` | **应用使用问题** | responsible=app | 应用误用/自身代码问题，非框架问题——改应用代码 |
| `third-party` | **三方库问题** | nature=defect 且 responsible=third-party | 三方库自身缺陷（等三方版本/换库） |
| `undetermined` | 待定性 | 其余（nature=undetermined 等） | 上游定性后自动落入上述类别 |

## 四、状态机（三类实体各一套）

### C.status（根因流转，单值、只进不退，回归除外）

```
open → diagnosed → workaround → reported → fix-confirmed → verified → closed
         │             │
         └──► wontfix ─┘   （上游明确不修/设计如此 → limitation 的常态终态）
limitation 专用：watching（已定性 + 演进方向明确，观察平台/上游节奏，无本地修复动作）
任意状态 ──► closed（重复 / 失效 / 范围外）
回归：verified / wontfix → open（版本验证记录注明 regression，CID 不变）
```

| status | defect 语义 | limitation 语义 |
|--------|------------|----------------|
| `open` | 已发现，根因/责任未定 | 已发现，未取得规格证据 |
| `diagnosed` | 根因与责任已判定 | 已确认规格如此（evidence 就位） |
| `workaround` | 临时方案（W）已验证可用 | 替代方案（W）已沉淀并验证 |
| `reported` | 已有 T 在跟上游 | —（演进诉求可记 T） |
| `fix-confirmed` | T.released/fix_version 就位，待本地验证 | —（平台演进提供新路径时用 watching 过渡） |
| `verified` | 本地用含修复版本验证通过 | 已按演进方向迁移、替代方案转正 |
| `wontfix` | 上游明确不修 | **常态终态**：规格如此，长期依赖替代方案 |
| `watching` | —（defect 不用） | 演进观察 |
| `closed` | 档案关闭（退役动作完成） | 同左 |

### W.status（方案生命周期）

```
proposed（提出未验证）→ tested（已验证）→ adopted（已采用为主案）→ retired（已退役）
```

- `verified` 字段（date + env）记录最近验证；无记录可省略（不编造）。
- `retire_when` 必填：官方修复/迁移完成后要撤销什么——是"自动演进"退役检查的依据。

### T.status（跟踪单生命周期）

```
draft（草稿）→ submitted（已提交）→ accepted（已受理）→ fixed（已合入）
             → released（已随版本发布，fix_version 必填）→ closed
分支：dup（重复单）/ wontfix（被拒）
```

- `fix_version` 是**修复版本号**的权威来源（如 "Qt 6.12-beta4"、"API 25"）；
  build 会把 released 单的 fix_version 聚合进 `_graph.yaml` 的 C.fixed_in。
- `tracker`：`qt-bug` / `ohos-issue` / `gitee` / `partner`（伙伴交付件）/ `forum`。

### S.status（症状，独立可观察）

`active`（未采取方案仍会遇到）/ `mitigated`（方案后消失）/ `resolved`（根因修复或已迁移）。

### 链路完备性（闭环规则）——"临时解决"的判定与缺口向上传播

一个根因要算**临时了结（不需要进一步处理）**，按定性/责任必须满足（`faults-build.py`
派生 `chain_state` + `gaps`，机器强制）：

| 定性/责任 | 临时了结条件 | 缺口判定 |
|---|---|---|
| defect × 外部责任（qt-port/qt-upstream/ohos-*/third-party） | **W(adopted) 且 T(在跟)**——两者缺一不可 | 有方案没单 = `missing-ticket`；有单没方案 = `missing-workaround`；双缺 = `both-missing` |
| limitation（鸿蒙必须适配） | **W(adopted)**——必须有采用中的适配/替代方案 | 无上游单可跟（记录性 T 不影响判定） |
| defect × app（应用使用问题） | **W(adopted)** | 修复在自己，无需单；改用法验证后可直接 closed（根治） |
| undetermined | **W(adopted)**（先绕过等定性） | 定性为外部 defect 后 T 转为硬要求（review 提醒） |

**根治**（`root-resolved`）：C.status 进入 fix-confirmed/verified/closed——无需 W/T 完备性
（此时 W 应按 retire_when 退役）。

**缺口向上传播**：S 的了结宣称受 causes 聚合约束——任一 cause 有缺口，症状即未闭环
（S 的 `gaps` = 各 cause 缺口并集；`chain_state` 取最差）。机器强制（check）：

- S.status=resolved 但链路有缺口 → **ERROR**（下游未闭环，上游不得宣称彻底了结，降级
  mitigated/active）；
- S.status=mitigated 但背后无 adopted W → **ERROR**（缓解宣称必须有采用中方案支撑，
  否则应标 active）；
- C.status=workaround 但链路未闭环 → **WARN**（宣称了临时解决，按闭环规则待补——
  多为缺 T：方案已就位，待提单/在跟）。

输出口径：`_graph.yaml` S/C 节点 `chain_state`/`gaps`；`_registry.md` 统计行"链路闭环" +
症状索引"闭环"列 + **§未闭环清单**（缺单/缺方案/双缺分组，含 W/T/症状）；`review`
子命令"未闭环（待补齐）"段。

## 五、文件布局与字段（单一真源 → 派生物）

```
faults/
├── _data/
│   ├── symptoms.yaml      真源：S 记录 + causes 边
│   ├── workarounds.yaml   真源：W 记录 + targets 边
│   └── tickets.yaml       真源：T 记录 + tracks 边
├── C-xxxx-slug.md         真源：C 页（frontmatter 全字段 + depends_on 边；正文深档案）
├── _drafts/               协作草稿区（不入图，check 不校验）：_template.md 提交清单
│   └── draft-YYYYMMDD-slug.md   协作者投稿（待主编审核，见 §六）
├── _graph.yaml            派生物：机读全量图（build 重建，勿手改）
├── _registry.md           派生物：登记总表（build 重建，勿手改）
├── _index.md / _template.md   本规范 / C 页模板
```

**修改任何真源后跑 `python tools/faults-build.py build`**——图、登记表、计数、反查
索引（manifests）、聚合概览（workaround_state / fixed_in / tickets）全部自动重建。

### C 页 frontmatter 字段

| 字段 | 必填 | 说明 |
|------|:---:|------|
| `id` / `cid` | ✅ | `fault-C-XXXX` / `C-XXXX`（文件名须以 `C-XXXX-` 开头） |
| `type` | ✅ | 固定 `cause` |
| `title` | ✅ | 一句话**根因**标题（不是现象） |
| `nature` | ✅ | `defect / limitation / undetermined` |
| `domain` | ✅ | `build / deploy / runtime / render / api / input / lifecycle / toolchain / filesystem` |
| `fault_type` | ✅ | `bug / crash / build-blocker / hang / gap / regression / caveat / deprecation` |
| `responsible` / `co_responsible` | ✅/ | 见 §三 |
| `component` | ✅ | 具体组件/文件 |
| `severity` | ✅ | `blocker / critical / high / medium / low` |
| `evidence_type` | ✅ | `demo / logs / both / source / docs`（§六·证据标准，check 强制） |
| `status` | ✅ | 见 §四 |
| `fix_route` | defect | 修复到达路径一句话（登记表用） |
| `evidence` / `evolution` | limitation | 定性证据 / 演进方向（至少其一，check 强制） |
| `review_note` | ✅ | 复核要点（review 输出用） |
| `depends_on` | ✅ | 依赖的其他 C（无则 `[]`，仅实证） |
| `affects_qt` / `affects_ohos` | ✅ | 影响版本（对齐根文档校验基准；不确定写"未记录"） |
| `qoh` |  | 关联机器层错误模式 |
| `first_seen` / `review_due` | ✅ | 首次发现 / 复核到期 |
| `created` / `updated` / `tags` / `audience` / `refs` / `summary` | ✅ | 全库约定 |

**不再有** `workaround / upstream_* / fixed_in_* / manifests` 字段——分别由 W、T 实体
表达、由 build 聚合（避免双写漂移）。

### S / W / T 记录字段

见 `_data/*.yaml` 文件头注释（含完整字段说明与状态机），格式遵守仓库
`tools/qt_ohos/yaml_lite.py` 子集（2 空格缩进、flow list、**不用 inline dict**）。

### C 页正文小节

表现（symptoms，按 S 分小节）→ 根因/定性依据 → 责任判定 → 根治方案（defect）或
替代方案与演进（limitation）→ 临时方案（引用 W + 最优方案详细步骤）→ 跟踪单
（引用 T）→ **版本验证记录**（追加式表格）→ 关联（S/W/T/problems/semantic/C）。

## 六、录入规则（图感知流程）

### 证据标准与复现 demo 编写原则（问题确认门禁）

**没有证据的转述/猜测不得定性为 Qt 框架问题。** 凡定性为外部根因（尤其
`nature=defect` 且 `responsible ∈ {qt-port, qt-upstream}` 的 Qt 框架侧问题），必须持有
下表证据之一，由 C 页必填字段 **`evidence_type`** 声明、`check` 机器强制：

| evidence_type | 含义 | 适用 |
|---|---|---|
| `demo` | **复现 demo**：最小可复现 ohos 工程（编写七原则见下） | 运行时行为异常首选 |
| `logs` | **调试日志 + 栈**：hilog 关键行、cppcrash/jscrash faultlog 栈回溯、探针日志、构建错误原文、隔离测试输出 | 无法产出 demo 时必须；或与 demo 配套 |
| `both` | demo + 日志 | 最强证据 |
| `source` | **源码 file:line 引用链**（静态证据） | **仅限静态可判定类**（API 语义/宏分支/头文件缺失等，源码即确凿）；Qt 框架侧 defect 用 source 收 WARN：提上游前须补 demo/日志 |
| `docs` | 官方文档/规格链接 | **limitation 专用**——defect 不允许仅凭文档定性 |

**机器强制（`check`，ERROR）**：

1. `defect` 的 evidence_type 不得为 `docs`；
2. `limitation` 的 evidence_type ∈ {docs, source, logs}（demo 不是规格的定性证据）；
3. **在跟上游单**（T.status ∈ 已提交在跟，且 tracker ∈ qt-bug / ohos-issue / gitee /
   partner）的 `defect`/`undetermined` 根因，evidence_type 必须 ∈ {demo, logs, both}
   ——对齐 `procedural/qt-bug-report-generation.md` 的**可复现性 HARD 闸门**：
   无可复现材料的单据不提交；
4. Qt 框架侧 defect 用 `source` → WARN（提上游前补最小 demo 或运行日志）。

**复现 demo 编写七原则**（工程编排参照 `procedural/demo-generation.md`；框架问题
分析场景参照 `procedural/framework-issue-analysis.md` 阶段一·复现 demo 生成）：

1. **最小化**：只含触发问题的最小代码路径，单文件 main 优先；剥离业务代码、
   三方依赖与资源。
2. **自包含可构建**：完整 ohos 工程，提交前自验四连——可构建、可安装、可启动、
   现象出现。
3. **确定性优先**：稳定复现 > 偶发；偶发问题写明触发循环与出现概率（如"焦点切换
   50 次出现 1-2 次"），并配日志佐证。
4. **对照性**：写明"预期 vs 实际"；条件允许时附桌面平台（Linux/Windows）同代码
   正常行为的对照，证明是平台差异而非代码 bug。
5. **纯净根因**：不依赖未鸿蒙化的三方库；必须依赖时，先用隔离测试/探针把问题
   收敛到最小单元（参照 IMEPROBE 探针法、隔离测试法）。
6. **携带诊断输出**：demo 内置关键日志点（qDebug/探针），把"现象出现"变成
   "日志可判读"——同时满足 logs 证据要求。
7. **版本留痕**：README 注明 Qt kit 来源与 commit、OHOS API/设备、构建命令、
   复现步骤（与草稿"环境三件套"一致）。

**Qt 框架侧问题的 demo 硬性要求**（`nature=defect` 且 `responsible ∈ qt-port /
qt-upstream`，提上游单前必查；对齐 `procedural/qt-bug-report-generation.md` 交付物规范）：

1. **单文件 main.cpp**：全部复现逻辑集中在**一个 main.cpp**——ohos 工程模板
   （QAbility 胶水壳）不含任何业务代码，问题代码一眼可见、可直接粘贴进 qt-bug
   报告；桌面可复现的跨平台缺陷，同一 main.cpp 即桌面版（qmake/cmake 直接编译
   运行，供 Qt 审查者快速验证）。
2. **复现步骤写明**：demo 附 README（或草稿 §三），给出**编号步骤到操作级**
   （如"①启动 → ②点击输入框 → ③连续输入拼音 ji → ④选词上屏"）+ 每步预期
   现象 + 最终 expected vs actual。**无复现步骤的 demo 视为未完成**——主编/
   上游按步骤逐条执行才能确认复现。

**无 demo 的降级通道**：确实无法产出 demo（偶发、依赖特定硬件/账号、系统级窗口）
→ `logs` 证据必须齐"日志 + 栈 + 采集环境"三件套，C 页正文注明"无 demo，依据日志
定性"；主编复核时可要求补充。

### 直接录入流程（维护者本人）

1. **先查/建症状 S**：按表现检索 `_registry.md` §症状索引——已有 S 则复用
   （一图多因很常见）；无则在 `_data/symptoms.yaml` 追加记录。
2. **定位根因 C**：检索现有 C（同根因多表现连边即可，**禁止重复建档**）；确属新
   根因才复制 `_template.md` 建 C 页，分配下一 CID。
3. **定性 nature**：defect / limitation / undetermined；limitation 必须给 W（替代方案）
   或 evolution 之一。
4. **登记方案 W**：在 `_data/workarounds.yaml` 追加（含 retire_when）；详细步骤写在
   C 页正文，W.detail 指过去。
5. **登记跟踪单 T**：已提交上游的，在 `_data/tickets.yaml` 追加（单号/链接/状态）；
   Qt 单号形如 QTBUG-xxxxxx，华为侧按 tracker 类型记。
6. **连边 + 回填**：S.causes / W.targets / T.tracks 在各自真源文件里写；C 页 depends_on
   仅实证时填；关联 problems/semantic 页 `refs` 加 `fault-C-XXXX`。
7. **跑 `python tools/faults-build.py build`**：派生物重建；**check 报 ERROR 必须先修**
   （ID/枚举/边/日期/refs/limitation 证据等全量校验）。
8. **不编造**：版本号、单号、日期不确定就写"未记录"/留空。

**不建节点**：环境配置错误；纯环境安装类问题。
**应用使用问题**（"用法不对"/应用自身 bug）：允许建**薄 C 页**（`responsible=app` →
处置=应用使用问题）——frontmatter 完整、正文精简（根因=误用点、fix_route=改用法），
深度内容留在 problems 页；目的：让"这不是框架问题"成为可检索、可复核的结论。
**孤儿症状**：根因未定位的表现可先建 S（causes 暂空），驱动后续分析。

### 协作草稿模式（协作者投稿 → 主编合入）

维护者本人按上述流程直接录入；**协作者**（团队成员，或公开仓 issue 由维护者转录）
走草稿通道：`faults/_drafts/draft-YYYYMMDD-slug.md`（模板即提交清单，见
`_drafts/_template.md`）。草稿格式宽松、**不占 S/C/W/T 编号**——编号与四实体拆分由
主编合入时完成；`check`/`build` 不校验 `_drafts/`（`_` 前缀文件为模板/说明，非草稿）。

**协作者提交清单**（必填项缺失主编直接退回）：

| 级别 | 内容 |
|------|------|
| 必填 | ① **现象原文**：错误信息/日志关键行（不转述）+ 触发/复现步骤 + 首次发现日期与场景 |
| 必填 | ② **环境三件套**：Qt 版本与 kit 来源（commit/安装器）/ OHOS API·系统·设备 / 构建方式 |
| 必填* | ③ **证据（问题确认门禁，见 §六·证据标准）**：复现 demo（defect/undetermined 行为异常类必附，按七原则编写）**或**调试日志+栈（hilog / cppcrash·jscrash faultlog / 探针日志 / 构建错误原文）——*limitation（规格/弃用类）以官方文档/规格链接替代 |
| 必填 | ④ **查重声明**：已查 `problems/_lookup.md`（报错）与 `_registry.md` §症状索引（现象），说明查重结论 |
| 建议 | ⑤ 初步根因（源码定位/日志推论）⑥ 临时方案与代价 ⑦ 上游单号链接 ⑧ 附件（faultlog/截图）⑨ 严重度自评 |

**主编合入门禁**（六步，全部留痕；"复现 demo 必测 + 人工审核"是硬性要求）：

1. **查重**：现象/根因已有 S/C → 退回改写为"对现有节点的补充"（连边/加 W/加 T/加验证
   记录），**不重复建档**；
2. **复现测试**（按 nature 分级）：
   - `defect` / `undetermined`（行为异常类）：**必测**——构建并运行草稿 demo，确认现象
     存在。demo 无法构建 → `returned`（退回修 demo）；构建运行但现象未出现 →
     `returned`（退回补环境信息；**未复现不合入**）；
   - `limitation`（规格/弃用类）：核验官方文档/规格链接与适用版本（demo 可选）；
3. **人工核验**：根因证据链（源码引用属实/日志支持）、nature 定性、responsible 归层、
   severity 校准、版本/日期/单号事实（宁缺勿造）、W 可用性与 retire_when、
   **脱敏**（公开版：公司/项目名、内部路径，对齐 `audience: public`）；
4. **复现留痕**：合入的 C 页"版本验证记录"**第一行登记主编复现**（日期/环境/
   动作=审核复现 demo/结论）；协作者提供的方案经主编验证的 W 记 `tested`，未验证
   记 `proposed`；
5. **promote**：拆分草稿 → S/C/W/T 真源记录（分配编号）→ 删除草稿文件
   （git 历史 + 验证记录即存档）；rejected/returned 草稿保留并回填
   `reviewer`/`review_result`；
6. **build 门禁**：`python tools/faults-build.py build`（ERROR 清零）+ 关联
   problems/semantic 页 `refs` 回填 `fault-C-XXXX`。

**草稿状态机**（草稿 frontmatter `status`，独立于四实体状态机）：

```
draft（新投）→ in-review（主编审核中）→ promoted（已合入，删文件）
                                    ├→ returned（退回：缺必填项/demo 不可构建/复现失败/查重命中）
                                    └→ rejected（不收：app 自身 bug/用法不对/重复；文件保留防重复投稿）
```

## 七、自动演进（工具：`tools/faults-build.py`）

| 命令 | 作用 |
|------|------|
| `python tools/faults-build.py build` | 校验真源 → 重建 `_graph.yaml` + `_registry.md`（含反查索引与聚合概览）；有 ERROR 拒绝生成 |
| `python tools/faults-build.py check` | 一致性门禁（exit 1 = 有 ERROR）：ID 格式/唯一、枚举、边目标存在、C 页必填字段与文件名、日期格式、refs 中 fault-* 存在、limitation 证据、**证据标准**（defect 禁 docs、limitation 限定 docs/source/logs、在跟上游单的 defect 必须 demo/logs/both、Qt 侧 source 警告） |
| `python tools/faults-build.py review` | 复核扫描：按 review_due 列出到期/逾期条目 + 复核要点 + 随行方案 + 跟踪单 + 状态推进提醒 + **待审草稿清单（_drafts/）** |
| `python tools/faults-build.py all` | build + check |

**状态推进 lint（WARN，事实由人定，工具只提醒）**：

- C.status=workaround 但无 tested/adopted W → 提醒；
- C.status=reported 但无在跟的 T → 提醒；
- T 已 fixed/released 但 C 未推进到 fix-confirmed → **提醒推进**；
- T.released 但 fix_version 空 → ERROR；
- S.status=mitigated 但背后无 adopted W / released T → 提醒；
- Qt 框架侧 defect 仅 source 证据 → 提醒补 demo/日志（提上游前必备）。

**复核触发**（任一）：Qt OHOS SDK / harmonyos 分支更新（根文档校验基准表 bump）；
HarmonyOS SDK / DevEco 更新；季度例行跑 `review` 扫到期。

**复核动作**：按 `procedural/framework-fix-verification.md` 验证 → 结果追加进 C 页
"版本验证记录" → 更新 C.status / T.status / W.status（retired）/ S.status →
`build` 重建 → defect `verified` 后执行**退役动作**（移除应用侧方案、关联页加
"已于 X 版本修复"注记、W 置 retired）→ `closed`。

**升级检查**：换 Qt/OHOS 版本前查 `_registry.md` §按版本基线——目标版本下仍活跃的
根因 + 必须随行携带的 W 清单。

**定性改判**（undetermined → defect/limitation）：CID 不变，C 页"定性依据"追加证据，
`build` 同步 `_graph.yaml` 的 nature 字段。

## 八、索引与联动

- `_registry.md`（派生物）：症状索引主入口（含**闭环缺口列**）/ **未闭环清单（链路完备性待补齐）** / **按处置分类（鸿蒙必须适配·Qt 问题·系统问题·应用使用问题…）** /
  缺陷 / 未定 / 限制 / W 清单 / T 清单 / 关系速览 / 按版本基线 / 复核到期 / 已了结。
- `_graph.yaml`（派生物）：机读全量图（节点 + 边 + 聚合 + 反查索引，单文件一次加载，
  解析器 `tools/qt_ohos/yaml_lite.py`）。
- `_design.html`：故障库设计总览一页图（展示用，非知识页，build 不涉及）。
- 索引层：`_map.md`、`_dashboard.md`、`_task-routing.md`（路由码 **[R]**）已挂接；
  `_tags.md` 随索引再生成纳入（C 页 tags）。
- 机器层扩展：`knowledge/errors/QOH*.yaml` 命中且存在关联 C 时，诊断输出可附
  "已知根因 C-XXXX（nature），方案见 W-xxxx"；C 页用 `qoh: [QOH001]` 反向登记。
- 上游 issue 产出走 `procedural/qt-bug-report-generation.md`，提交后回填 T 记录。
- 协作入口：公开仓协作者经 issue 提供与 `_drafts/_template.md` 同等清单的信息，维护者
  转录为草稿后走 §六·协作草稿模式（见 `CONTRIBUTING.md`）。

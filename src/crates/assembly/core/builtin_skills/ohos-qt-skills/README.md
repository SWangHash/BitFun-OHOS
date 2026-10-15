# qt-harmonyos-migration

将一个现有 C++/QML Qt 应用迁移到 HarmonyOS（鸿蒙 PC）的 Agent Skill。保留 C++/QML 与既有宿主平台行为，只叠加鸿蒙所需的构建、打包、生命周期、窗口、API、依赖、插件与资源适配；等价移植完成后，还可按特性目录为应用增加鸿蒙特有特性（碰一碰、接续、分享等）。

## 目录结构

```
SKILL.md                        # Agent 入口：知识基线、台账、门控阶段、红线
AGENTS.md / CLAUDE.md           # 维护本 skill 的 agent 须知（"同步上游知识库"路由到 upstream-kb/AGENTS.md）
agents/openai.yaml              # Agent 元信息
assets/templates/migration/ohos/ # 迁移台账模板
features/                       # 外部 feature 包（鸿蒙能力 / 外部验收流程，以 skill 交付，外加 hook.json 与接入说明）与接入规范
references/                     # 规则文档（knowledge-sync、persistence-model、migration-workflow、external-features…）
scripts/                        # 迁移侧脚本：init_migration / next_step / sync_knowledge / mark_knowledge_used / validate_ledgers / phase_gate / gate_state / record_diagnostic / batch_checks / scan_qt_api_gap / queue_status / feature_hooks / feature_gate
tests/                          # 外部 feature 机制的单元与端到端测试
upstream-kb/                    # 与上游 ohos_qt-skills 的唯一接口（维护者）
  AGENTS.md                     # 同步指南：参数映射、plan→审阅→apply→verify、纳入/排除标准
  upstream.json                 # 默认上游仓库/分支 + 最近同步的 commit
  knowledge/                    # 发布基线：上游原始字节，禁止手改
  manifest.tsv                  # skill 级基线清单（整表哈希 = 基线 ID）
  exclusions.tsv                # 排除清单：路径 + 理由 + 决定日期
  required-paths.txt            # skill 文档依赖、同步时不得消失的上游页
  SYNC_LOG.md                   # 同步历史（只追加）
  scripts/                      # sync_upstream.py（plan/apply/status）、verify_kb.py、kb_common.py
```

---

## 一、8 阶段门控工作流

这一章回答"迁移怎么跑"。三个关键保证：**编译链路保通**（阶段 1 的环境门禁 + 阶段 7 的诊断止损，评测里旧 skill 三个编译失败任务在这里被结构性避免）、**能力切片**（阶段 2 定义、阶段 5 关闭，工作单元不是文件而是能力）、**可恢复**（全部状态在磁盘台账上，不依赖对话记忆）。

总原则：每个阶段都是"**动作 → 证据落盘 → gate 判定**"三段式，下一阶段的进入条件写在上一阶段的退出产物里。

```
①环境准备 → ②迁移项盘点 → ③迁移方案确认 → ④先行验证 → ⑤功能迁移 → ⑥鸿蒙特性接入 → ⑦构建与问题修复 → ⑧验收与交付
```

### 阶段 1：Environment preparation（环境准备，`baseline`）

**做什么**：搞清楚"要迁移的是什么、用什么工具链迁"。

- 检视仓库：README/构建入口/测试入口、git revision、脏文件状态；
- 扫描判定 Qt 版本——**按代码实际 API 判定而非 .pro 声明**（上游踩坑：.pro 标 Qt5 但代码全是 Qt6 API）；
- 确定 Qt-for-HarmonyOS 发行版（Qt5.15.16 现成 vs Qt6 superbuild）、OHOS native 工具链、ABI、模板树来源、签名/设备；
- 用 `upstream-kb/knowledge/skills/kb-init/` 的脚本实际获取并**整目录验证**外部二进制。

**产出**：`assessment.md`（预检 7 项 + 可行性初判）、`environment.tsv`（每个工具链输入一行实测证据：路径/版本/验证命令）、`baseline.tsv`（宿主构建/冒烟结果，作为之后回归的对照）。

**出口条件（硬门禁）**：`environment.tsv` 对 Qt 发行版、OHOS 工具链、host 构建/打包工具、完整模板树**四项都有证据**，否则永远停在阶段 1。这是编译链路保通的第一道闸——评测里旧 skill 的 DEVECO_SDK_HOME 设错死循环，就是这个门缺失的症状。

**设计意图**：把"环境没搞清就动手"这类必然失败提前拦下。

### 阶段 2：Migration inventory（迁移项盘点，`inventory`）

**做什么**：机械扫描，把"这个应用与鸿蒙的所有差异"变成一张带证据的清单。

- 扫描构建文件与源码：Qt 模块/QML/插件、平台分支（`Q_OS_WIN`/`Q_OS_UNIX` 与鸿蒙重叠点）、OS API（QProcess/注册表/文件管理器调用）、窗口/生命周期、存储/权限、三方库、包身份；
- 每个命中**看上下文核实**（不是 grep 到就算），判定是核心绑定还是可选分支；
- 应用声明或使用的 Qt 版本高于 SDK 时（如 Qt 5.15 代码对 Qt 5.12 SDK），跑 `scan_qt_api_gap.py` 扫出高版本 API，记为一条 `qt-api-gap` CAP 行，在一个切片内集中修，而不是一次编译发现一个；
- 空/低命中扫描必须留范围、排除项——零命中没有排除记录不可信。

**产出**：`inventory.tsv` 的扫描证据字段（扫描留痕）、`inventory.tsv` 的 source_location/files 字段（每个路径的归属 target、是否生成物——防止以后改错文件）、`inventory.tsv`（CAP-\* 行：现状/鸿蒙约束/处置/风险/关联验证）、`inventory.tsv` 的 prerequisites/dependency 字段（能力依赖边）、`work-queue.tsv`（按依赖序排好的切片）。

**出口条件**：每个 CAP 行有证据和 VAL 链接，工作队列就绪；每个未关闭的 inventory 行都被某个队列行的 `inventory_ids` 引用（保持/无改动的能力也要有一条验证切片）。

`BOOT` 行只证明初始化完成，不计入真实 CAP/VAL；必须运行
`python scripts/validate_ledgers.py <app>/migration/ohos --phase inventory`，输出 `BLOCKED`/`INVALID` 时不能进入合同或实现。

**设计意图**：工作单元是"能力切片"而非文件；范围在这里定死，之后的实现只是逐行关闭。

### 阶段 3：Migration plan contract（迁移方案确认，`contract`）

**做什么**：人类决策点。

- 汇总阶段 1/2 证据，给出 verdict：`ready` / `ready-with-decisions` / `blocked` / `not-recommended`——只有前两种能进实现；
- **冻结合同**（`PORTING_CONTRACT.md`）：钉死 Qt/SDK/ABI/模板、平台隔离姿态、模块取舍、降级清单、目标行为；
- **外部 feature 选择**：`feature_hooks.py candidates` 列出所有已登记的鸿蒙能力 feature 与外部验收 feature（触发词只用于排序），由用户人工选择（默认不选），写进合同 + `decisions.tsv`（`feature_or_scope=external-features`），再 `feature_hooks.py activate` 生成 FEAT 行（此时只选不做）；
- 材料性决策（去功能、降级、改包身份）全部进 `decisions.tsv` 留痕；降级/stub 类决策必须 `owner=user` 且 evidence 以 `user:` 引用用户原话（任务 prompt 也算），agent 自批的降级会被合同门拒绝；已批准决策同样约束实现，改走 stub 需要新的用户决策行。

**出口条件**：verdict=ready、合同冻结、验收场景（VAL）定义完毕。

**设计意图**：把"范围变更"和"实现"在时间上隔开——之后修复循环期间合同只读，杜绝边改边扩需求。

### 阶段 4：Pilot verification（先行验证，`pilot`）

**做什么**：在动应用源码之前，先用模板把**应用信封**跑通一次：入口目标、Qt 链接方式、打包生成、一个最险的运行时边界（如第一个窗口能显示）。

- 用选定的模板/部署生成器做一次端到端：configure → build → HAP → 安装 → 启动；
- 记录假设与结果，并由独立视角评审。

**产出**：`pilot.tsv` 的 `PILOT-*` 行（假设/输入/结果/评审，`batch_checks.py --phase pilot` 自动写入）+ 关联的 `package-manifest.tsv` 证据。

**出口条件**：试点结论明确（成功，或失败原因已定位并进决策）。

**设计意图**：模板错、入口错、库名错、QPA 插件缺失这类**系统性错误**在广改之前暴露——此时返工成本几乎为零。试点产物可以扔，假设与证据必须留。

### 阶段 5：Capability migration（功能迁移，`implementation`）

**做什么**：按 `work-queue.tsv` 的依赖序逐行关闭 CAP-\*：
- **先编译再读代码**：试点后立即加最小守卫，先构建内置库 target，再对应用 target 做第一次 keep-going 编译，按编译错误决定读哪些文件；大范围只读探索交给只读子代理；预算过半仍无应用 `.so` 时停止探索、全力进入构建诊断循环；
- 应用 `.so` 写出回执之前保留试点信封（native 源码与入口配置），切换 `build-profile.json5`/`APP_LIBRARY_NAME` 与打包放在同一批次；
- 每行：重读该行证据与合同决策 → **最小守卫改动**（`Q_OS_OHOS` 等平台守卫内）→ `work-queue.tsv` 的 change/evidence 字段 记前后哈希 → 跑最便宜的相关检查 → 更新 inventory/validation 状态（队列行关闭时，把它 `inventory_ids` 里的 inventory 行同时改为 passed/verified 等并写证据；门禁会拦住"队列已完成但 inventory 仍 planned"的行，交付门禁要求 inventory 全部关闭）；
- 并行只允许不相交的源码范围；合同/清单/信封级改动由单一 owner 合并；
- 内置三方库/子模块（如 QScintilla、图片/取色控件）先作为**独立 target** 单独构建并通过 OHOS 编译链接（每个库一条 CAP 行，优先复用上游 CMake/qmake 工程），再被应用 target 链接；禁止把三方源码并入应用单体 target（否则 AUTOMOC、宏与 include 作用域互相污染，如 `SCN_*` 宏撞 moc 信号名）；
- 已验证或已写回执的产物（试点或应用）在清理构建目录前必须先归档并登记 `package-manifest.tsv`；
- 共享代码（根构建文件、公共适配器）改后要触发宿主回归对照 `baseline.tsv`。

**产出**：`work-queue.tsv` 的 change/evidence 字段（每个修改一行：前后哈希/理由/关联行）、`validation.tsv` 的 reviewer/evidence 字段（高爆炸半径改动的独立评审）、inventory 行逐步 `passed`。

**出口条件**：核心能力行全部关闭（或显式降级批准），应用可安装、启动。

**设计意图**：机械化的下一步——agent 每次从队列取行，不自由发挥；每个修改可审计、可回溯。

### 阶段 6：HarmonyOS feature adaptation（鸿蒙特性接入，`features`）

**做什么**：给已经能跑的应用叠加系统能力特性（碰一碰、接续、分享等），即本阶段激活的 `capability` 类外部 feature。
- 逐个串行执行：`feature_gate.py enter`（准入：阶段已开放、依赖已关闭、包哈希未变、`entry.requires` 满足）→ 按包内 `feature.md` 展开成 CAP-\*/VAL-\* 行并按普通切片实现 → `feature_gate.py exit`（准出：显式条件 + 隐式条件，记录证据摘要）；
- 设备依赖类特性（NFC 对端等）隐式要求 `device-runs.tsv` 真机证据；做不完时 `feature_hooks.py close` 走 `deferred-approved`/`blocked` 终态（需决策）；
- **未登记、未激活的 feature 不做**——缺特性记 blocker 申请目录新增，不许自由发挥。

**出口条件**：本阶段每个 FEAT-\* 行都由脚本写成 `passed`（证据摘要仍一致）或 `deferred-approved`/`blocked`；未选 feature 时台账为空（`validate_ledgers.py --phase features`）。

**设计意图**：主流程是宿主、feature 是钩子：主 skill 只管登记、激活、准入、准出，feature 内部是灰盒；包哈希钉版与知识钉版同一套冻结规则。开发者接入说明见 `features/README.md`，包规则见 `features/RULES.md`。

### 阶段 7：Build and diagnostics（构建与问题修复，`diagnostics`）

**做什么**：构建/打包/装机的失败处理机制，贯穿实现期但在此时集中运转：

- **单一 build owner** 串行执行，每轮在 `diagnostics.tsv` 的 attempt/build/log 字段 记编号、树/环境哈希、命令、错误数、日志摘要——可观察错误是否收敛；
- 失败进 `diagnostics.tsv`，**按根因一行**（不是按日志行），先比对已知失败签名（含所用 feature 的接入说明与 skill 中列出的）；必须在下一次尝试前写入；
- 失败行是历史，不会被覆盖：每次尝试一行，后续通过的批次把同一条目的失败行改为 `resolved`（保留签名、根因、修复和日志），失败行不能改成 `passed`；批次外解决的问题（工具链/SDK 文件、宿主 DLL、部署路径等）用 `record_diagnostic.py --id new ... --status resolved` 补记；
- 构建用 keep-going（Ninja `-- -k 0`），一次尝试暴露全部失败编译单元；批次摘要给出 `error_count` 与去重 `errors`，按根因分组、每轮修一整组；诊断门拒绝没有 `batch_checks.py` 回执或 `work-queue.tsv` 从未更新的循环；
- 上下文压缩后的摘要不是证据：只在摘要里出现的错误，必须先在最新诊断行的 `log_path` 与磁盘文件中核实，找不到就丢弃；
- 具体失败签名和最终产物检查见 `references/build-diagnostics.md`；验证器摘要不能替代首个编译/链接/打包根因；
- **止损规则**：同一 blocker 在 3 次真正不同的尝试后强制停止，升级为用户决策；重复出现的失败写 `diagnostics.tsv` 的 recurrence/next_action 字段 修流程（比如某类坑该进 playbook），而不是堆补丁。

**产出**：`diagnostics.tsv` 的 attempt/build/log 字段（编号轮次）、`diagnostics.tsv`（根因账本）、`diagnostics.tsv` 的 recurrence/next_action 字段（流程修正）。

**设计意图**：评测里旧 skill 的 74 分钟/660 步死循环（同一错误环境变量反复构建），在这里结构性不可能发生。

### 阶段 8：Acceptance and handoff（验收与交付，`handoff`）

**做什么**：爬证据阶梯 + 诚实交底。

- 按**实际达到的最强层**定级：`implemented-unverified` → configure 过 → 编译链接过 → 包内容正确 → 安装/启动过 → 设备场景过 → 行为验证（`behavior-verified`）；
- 包检查独立于构建成功（`package-manifest.tsv`：native 库闭包、ABI、DT_NEEDED、权限声明）；设备观测分五层记录（安装/启动/存活/渲染/行为，`device-runs.tsv`）；
- 共享代码改动后重跑宿主回归；审计所有 unknown/TODO/降级行；
- 运行本阶段激活的 `verification` 类外部 feature（其他团队的验收流程），同样走 enter/exit 门禁；它不得改源码，发现缺陷回主流程修复后 `feature_gate.py enter --restart` 重跑；
- 写 `report.md`：结论、每条结论映射到台账证据、可复现命令、limitations（未验证的明说）、`## External features` 逐行列出每个 FEAT 及状态、下一步命令。

**出口条件**：`STATE.md`、`decisions.tsv` 与 `validation.tsv` 全部关闭或带失效说明，report 完成。

**设计意图**："构建成功 ≠ 能跑 ≠ 行为正确"——每层独立证明，交付永不夸大。Notepad-- 实例就是 `implemented-unverified` 层交付：编译/打包/安装/启动全绿，功能场景因无设备如实标 blocked。

### 横切规则（贯穿 8 个阶段）

1. **材料变更必须用户决策**：范围、降级、签名、破坏性设备操作 → `decisions.tsv`，agent 不得自作主张；
2. **可恢复性**：任何时刻中断，新会话 = `validate_ledgers.py`（先验证台账没坏）→ 读 STATE.md/decisions.tsv/work-queue.tsv → 从第一个未关闭行继续；
3. **漂移即报告**：知识 baseline 或外部 feature 包在迁移中途变化 → 报告用户 → 用户决定是否重迁移，绝不静默续跑；
4. **平台隔离红线**：所有 C++ 改动置于 `Q_OS_OHOS`/qmake `ohos` scope/平台守卫内，保持其他宿主平台行为不变（`baseline.tsv` 宿主回归佐证）；只改 source-of-truth，不改生成物/SDK，不为模仿语言迁移建平行树；不静默 stub——记 `blocked`/`unknown` 或经批准的 `degraded-approved`；凭据、签名密钥、完整设备标识不入任何台账。

---

## 二、同步上游知识库，下发到项目知识库

这一章回答"知识从哪来、怎么钉版、怎么更新"。知识经过**两条信任边界**流动，任何一侧都不可跨越：

```
上游 ohos_qt-skills（git commit，只读源）
   │  维护者专用 upstream-kb/scripts/sync_upstream.py（plan → 逐条审阅新增/变更 → apply → verify）
   ▼
skill 发布基线：upstream-kb/knowledge/ + upstream-kb/manifest.tsv（本仓库）
   │  项目专用 sync_knowledge.py（校验 + 钉版，零复制）
   ▼
项目证据链：<app>/migration/ohos/knowledge-manifest.tsv
```

上游知识库为 [ohos_qt-skills](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills)：本 skill 按**"知识尽量保留、上游新增逐条审阅、裁剪需充分理由"**的原则同步上游知识并钉版为**已评审的发布基线**，迁移过程中以"证据链 manifest + 原地引用"的方式消费，不整包复制。

### 版本钉死的证据链（U/B/P 三哈希）

一个知识页最多存在三个字节版本，项目 manifest 的每一行都记录全部三个：

- **U** = `source_sha256`：上游 ohos_qt-skills 的字节；
- **B** = `skill_snapshot_sha256`：skill 发布基线的字节（agent 实际读取的版本）；
- **P** = `snapshot_sha256`：项目本地适配页字节（未适配则为空，即 P=B）。

两级 manifest 中 `modified` 列语义不同：**项目级** `modified = (P ≠ B)`（agent 侧适配）；**skill 级** `modified = (B ≠ U)`（维护者侧分叉）。validate_ledgers 会把"钉版基线与上游分叉"作为警告显式报告，双重分叉（U≠B 且 P≠B）合法且可审计。

**项目不复制知识库**：agent 迁移中直接读 `upstream-kb/knowledge/` 下的基线页，读过的页用 `mark_knowledge_used.py` 标 `used=yes`。唯一例外是目标确实需要适配某页：把副本放到 `<app>/migration/ohos/knowledge/<源路径>` 后用 `--register-modified` 注册，manifest 记录本地文件哈希及其依据的基线页哈希（lineage）；项目 `knowledge/` 下其他任何文件都是错误。

### 更新知识库（上游 → 新基线，维护者）

完整流程与判断标准见 [`upstream-kb/AGENTS.md`](upstream-kb/AGENTS.md)。在本仓库中对 agent 说"同步上游知识库，知识库本地路径为 xxx（或 git 路径为 xxx），分支为 xxx"即可按该指南完成同步；不给参数时使用 `upstream-kb/upstream.json` 中的仓库与分支（当前为 `bitfun-release`）。

```bash
python upstream-kb/scripts/sync_upstream.py plan [--source <本地检出> | --repo <url>] [--branch <分支>] [--ref <commit>]
#   → upstream-kb/.sync/review.tsv：new 行必须逐条 include/exclude（exclude 写理由），changed 行默认 update
python upstream-kb/scripts/sync_upstream.py apply [--prune-stale-exclusions]
python upstream-kb/scripts/verify_kb.py --smoke
```

1. **只读 git commit**：脚本用 `git ls-tree`/`git cat-file` 读取指定 commit，不读上游工作区，每个文件都能追溯到 commit + 哈希；远程模式使用 `~/.cache/qt-harmonyos-migration/upstream/` 镜像缓存；
2. **新增文件逐条审阅**：`plan` 把新增/变更文件放进 `.sync/incoming/` 和 `.sync/diffs/`，并给出启发式提示（仓库元数据、草稿模板、测试、竞争性工作流、二进制、疑似密钥）与同目录先例；agent 读内容后决定纳入或排除，排除理由写入 `exclusions.tsv`；
3. **阻断项**：基线文件被手改（`blocked-local-edit`）、keep-local 页上游又变（`blocked-diverged`）需显式选 `take-upstream`/`keep-local`；`required-paths.txt` 中的页将消失或 `knowledge/` 下出现未登记文件时 `apply` 拒绝执行；
4. **原子应用**：`apply` 先完成全部校验再写文件，写页面、manifest、exclusions、`upstream.json` 并追加 `SYNC_LOG.md`，最后自动校验；
5. **评估影响**：`used=yes` 的页若有变更，进行中项目将判漂移——是否重迁移由用户决定；
6. **发布**：用户确认后，`upstream-kb/` 的改动**同一提交**推送（`Sync upstream KB to <short-rev>`）。manifest 整表哈希变化即等于发布新基线。

### 下发到项目与冻结规则

- `sync_knowledge.py` 播种前**逐文件校验基线哈希**——损坏或被篡改的基线不可能进入项目；之后写项目 manifest 钉版；
- **迁移期间基线冻结**：钉版后基线再变化，sync/validate 报告漂移（警告），**由用户决定**是否删除 manifest/整个迁移目录重迁移；agent 绝不静默续跑、绝不手改 manifest 行向新基线看齐；
- 项目侧本地适配页被再修改 → validate 报哈希 mismatch 错误，须重新注册刷新记录；
- 外部 feature 包同一套规则：激活时钉版 `package_sha256`（整个包），之后变更 → 准入/准出拒绝并警告 → 用户决策后 `feature_hooks.py repin`。

### 更新红线（维护者）

- `upstream-kb/scripts/` 下的脚本是维护者专属，**迁移 Agent 不得执行**；项目不得直连上游 checkout/URL 补知识；
- **不绕过脚本**：不从上游工作区复制文件，不手改 `upstream-kb/knowledge/`；`verify_kb.py` 不通过不发布；
- **不手编 manifest**：哈希/revision/时间戳由脚本维护，手改制造校验不过的伪状态；
- **裁剪纪律**：知识默认保留，排除必须有充分理由（`upstream-kb/exclusions.tsv`，理由缺失脚本直接拒绝）；上游新增文件逐条审阅后纳入或排除，排除条目随基线一同评审；
- **外部二进制不入库**：Qt/DevEco/OHOS SDK 与模板树永远是外部输入（见 `references/toolchain-template-inputs.md`），知识页只描述获取与校验方法。

---

## 三、迁移过程可视化（十二个核心台账）

迁移项目只保留十二个核心台账，覆盖知识版本、环境基线、兼容性差异、用户决策、先行验证、执行队列、特性接入、失败诊断、包内容和真机验收。八个阶段各对应一个台账：环境准备 `environment.tsv`、迁移项盘点 `inventory.tsv`、迁移方案确认 `decisions.tsv`、先行验证 `pilot.tsv`、功能迁移 `work-queue.tsv`、鸿蒙特性接入 `feature-adoption.tsv`（也记录第 8 阶段的外部验收 feature）、构建与问题修复 `diagnostics.tsv`、验收与交付 `validation.tsv`；`baseline.tsv`、`package-manifest.tsv`、`device-runs.tsv` 是多个阶段共用的参考证据。`STATE.md`、`PORTING_CONTRACT.md`、`assessment.md`、`report.md` 是导航、合同、评估和交付文档，不计入台账数量。

- **`knowledge-manifest.tsv`**：钉住知识基线、来源和哈希，记录使用状态。
- **`environment.tsv`**：记录 Qt、HarmonyOS SDK/API、ABI、工具、模板、签名和设备环境。
- **`baseline.tsv`**：记录源版本、脏状态及宿主构建/冒烟基线。
- **`inventory.tsv`**：记录每个兼容缺口/能力、源码位置、风险、前置依赖、扫描证据和关联验证；`status` 是该能力的迁移状态，盘点时为 `planned`，对应队列工作完成后关闭。
- **`decisions.tsv`**：记录用户批准的范围、模块取舍、降级、包身份和外部 feature 选择。
- **`pilot.tsv`**：记录先行验证的每次尝试（`PILOT-*`，列与 `diagnostics.tsv` 相同）：用最小工程证明应用外壳、入口、Qt 链接、打包和一个高风险点能走通。
- **`work-queue.tsv`**：按 prerequisites 排列待实施能力切片，并记录负责人、改动、证据和验证关联；`inventory_ids` 列写明该切片关闭哪些 `inventory.tsv` 行（纯构建切片写 `none`）。
- **`feature-adoption.tsv`**：记录用户激活的外部 feature（`FEAT-*`）：类型、挂载阶段、钉住的包哈希、状态、尝试次数、准入/准出记录及关联的能力/验证行；状态只由脚本写入，未选时只有表头。
- **`diagnostics.tsv`**：按根因记录应用构建、打包、安装、启动和运行时失败，包含尝试次数、日志和下一动作。
- **`package-manifest.tsv`**：记录最终 HAP 入口、native 库、ABI、依赖、插件、QML、资源和权限闭包。
- **`device-runs.tsv`**：分层记录安装、启动、进程存活、渲染、日志和行为观察。
- **`validation.tsv`**：记录 host/OHOS 验收场景、预期、结果、证据、评审和负向校准。

被移除台账的信息进入这些保留文件：扫描范围和源码拓扑写入 `inventory.tsv`，能力依赖写入 `inventory.tsv`/`work-queue.tsv`，试点轮次写入 `pilot.tsv`，构建轮次写入 `diagnostics.tsv`，改动和评审写入 `work-queue.tsv`/`validation.tsv`，阶段门状态写入 `STATE.md`/`decisions.tsv`/`validation.tsv`，知识引用和漂移使用 `knowledge-manifest.tsv`，成本和流程复盘写入 `report.md`。

`validate_ledgers.py` 只校验上述十二个台账及其交叉 ID；`queue_status.py` 只从 `work-queue.tsv` 选择下一步。脚本不再要求被删除的专项台账存在。
## 性能优化执行规则

迁移恢复时先读 `STATE.md`，再用 `scripts/ledger_query.py` 查询当前
`work-queue.tsv` 行及其关联的 `inventory.tsv`、`validation.tsv` 和
`environment.tsv` 行。不要把十二个台账整表反复注入上下文。

配置、构建、打包和设备证据一律通过 `scripts/batch_checks.py --diagnostics`
运行：一次调用写出完整日志、`batch-summary.json`（`steps` + `artifact_receipts`）
和 `diagnostics.tsv` 回执行；树与计划未变的失败重跑会被拒绝；计划中的
`artifact_receipts` 在产物出现时立即写 `so-path.txt`/`hap-path.txt` 并归档。详见 `references/performance-optimized-workflow.md`。
## 使用速查（迁移项目，Agent 执行）

第一步永远是初始化台账：`<app>/migration/ohos/STATE.md` 不存在时，先运行 `init_migration.py`，之后才能读知识库、探测环境或执行任何构建/部署命令（SKILL.md 第 0 节）。`--target` 是 Qt 应用根目录（.pro/CMakeLists 所在处或仓库根），不是用户指定的鸿蒙输出工程目录；`init_migration.py` 会拒绝鸿蒙工程目录，并把项目名写入 STATE.md。阶段严格按 SKILL.md 第 0.1 节顺序推进：agent 的 todo 固定为初始化 + 8 个阶段项，阶段项只在该阶段 `validate_ledgers.py --phase <id>` 输出 READY 后才能完成；不确定下一步时运行 `next_step.py`。台账目录未初始化时，`batch_checks.py --diagnostics` 会直接拒绝运行。

```bash
# 1. 初始化 <app>/migration/ohos/ 台账，并写入知识证据链 manifest（不复制知识文件）
python scripts/init_migration.py --target <app> \
  --template-root <skill>/assets/templates/migration/ohos

# 1.1 每次初始化、门禁之后、上下文压缩之后：打印当前唯一可做的阶段、允许/暂缓的工作、未满足的门禁条件和门禁命令（只读）
python scripts/next_step.py <app>/migration/ohos

# 2. 迁移中直接读 skill baseline 页（upstream-kb/knowledge/ 下），读过的页打标
python scripts/mark_knowledge_used.py <app>/migration/ohos/knowledge-manifest.tsv \
  semantic/qt-harmonyos-golden-rules.md

# 3. 仅当目标确实需要适配某页：把副本放到 <app>/migration/ohos/knowledge/<源路径> 再注册
python scripts/sync_knowledge.py --target <app>/migration/ohos \
  --register-modified semantic/qt-harmonyos-window-model.md

# 4. 任意时刻校验台账完整性、修改页哈希、baseline/外部 feature 包钉版是否漂移
python scripts/validate_ledgers.py <app>/migration/ohos

# 4.1 清单阶段：应用依赖的 Qt 高于 SDK 时，扫描高版本 API 缺口
python scripts/scan_qt_api_gap.py <app> --target-qt 5.12.12

# 5. 每个阶段出口：一条命令同时校验台账结构与阶段门禁（INVALID/BLOCKED 时停止）
#    phase 取 baseline / inventory / contract / pilot / implementation / features / diagnostics / handoff
#    结果自动写回 STATE.md：Last gate；READY 时推进 Current phase 与 Progress 行（--no-record 只读校验）
python scripts/validate_ledgers.py <app>/migration/ohos --phase pilot

# 6. 构建/打包尝试走 batch_checks：自动写 diagnostics 回执与产物回执文件
python scripts/batch_checks.py <plan>.json --output-dir <evidence>/batch-003 --cwd <app> \
  --diagnostics <app>/migration/ohos/diagnostics.tsv \
  --affected-ids "CAP-001,VAL-002" --phase build

#    失败回执为 unclassified，下一轮之前用同一 id 补充分类（未给的字段保持原值；未分类时 batch_checks 拒绝下一轮）
python scripts/record_diagnostic.py <app>/migration/ohos/diagnostics.tsv \
  --id DIAG-003 --category include/dependency \
  --root-cause "target source tree does not provide Position.h" \
  --next-action "add the owning source/dependency to the target and reconfigure"

# 7. 查看能力队列状态与就绪项（参数是 work-queue.tsv 文件，不是目录）
python scripts/queue_status.py <app>/migration/ohos/work-queue.tsv status
python scripts/queue_status.py <app>/migration/ohos/work-queue.tsv next

# 8. 外部 feature：合同阶段列候选、按用户决定激活；宿主阶段内逐个准入/准出
python scripts/feature_hooks.py candidates <app>/migration/ohos --request "<用户需求>"
python scripts/feature_hooks.py activate <app>/migration/ohos --decision DEC-004 --select <feature-id>
python scripts/feature_gate.py enter <app>/migration/ohos FEAT-001
python scripts/feature_gate.py exit <app>/migration/ohos FEAT-001
python scripts/feature_register.py inspect <skill-dir>   # 登记 skill：读出候选项（见 features/REGISTER.md）
python scripts/feature_register.py scaffold --skill <skill-dir> --id <feature-id> ...  # 按问答结果生成包
python scripts/feature_hooks.py lint            # feature 开发者：登记前自检
```

字段级台账定义见 `references/persistence-model.md`；信任边界与 manifest 协议见 `references/knowledge-sync.md`；外部 feature 规则见 `references/external-features.md`，开发者接入说明见 `features/README.md`，包规则见 `features/RULES.md`，登记流程见 `features/REGISTER.md`。

## 效果

基于 9 个真实 Qt 应用（4 fix + 5 trans）的对比评测（旧 skill = 上游知识库直接使用，新 skill = 本工程）：

| 指标 | 旧 skill | 新 skill |
|---|---|---|
| 平均得分 | 0.59 | **0.85** |
| so + hap + 安装成功 | 6/9 | **9/9** |
| 启动成功且 a11y 可用 | 6/9 | **8/9** |

最大收益在编译链路保通（3 个旧 skill 编译失败/放弃的任务全部走通）。详见 `D:\code\qt\IMPROVEMENTS-VS-UPSTREAM.md`。

## 边界（不做什么）

- 不编译 Qt 本身、不批量移植多个应用、不把应用改写成 ArkTS；
- 不再分发 Qt/DevEco/OHOS 二进制或模板树——`upstream-kb/knowledge/skills/kb-init/` 只提供获取与校验方法，真实工具链是外部输入，须整目录验证后使用；
- 迁移只做框架/平台移植，不做逐文件语言翻译，不建平行应用树。





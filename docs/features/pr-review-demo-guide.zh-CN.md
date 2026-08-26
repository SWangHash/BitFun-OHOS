# PR 审核功能验证与演示操作指南

本文档面向准备录制 BitFun PR 审核功能演示视频的同学。先简要说明当前审核功能的真实形态（基于代码现状），再给出从零准备到完整跑通一条演示视频脚本，最后列出"故障态"演示片段，让视频能完整展示功能边界。

> 范围：仅覆盖「设置 → 智慧化配置 → 审核」+ `/review` 命令 + ReviewPlatformPanel（PR 面板）这一条用户可触达的审核链路。文档不展开内部 ReviewTeam、Manifest 等实现细节。

---

## 一、当前 PR 审核功能长什么样（必读，避免录错视频）

### 1.1 命令入口（聊天框）

| 命令 | 含义 | 走的执行路径 |
|---|---|---|
| `/review` | 自适应审核（普通 Review） | ≤80 个文件时启动 1 个只读 `CodeReview` 子会话；更大或供应商截断时自动进入 managed L1（最多 8 个 ≤40 文件的包，最多 2 并发） |
| `/review strict` | 严格审核（深度 Review） | 启动 1 个 `DeepReview` 子会话；最多再调用 1 个专家 + 1 个 `ReviewJudge` 质量检查 |
| `/DeepReview` | 历史兼容别名 | 等同 `/review strict` |

源码位置：`src/web-ui/src/flow_chat/utils/deepReviewConstants.ts`、`src/web-ui/src/flow_chat/deep-review/launch/commandParser.ts`。

> `/DeepReview` 已经是过渡别名，**视频里请直接演示 `/review` 与 `/review strict`**。

### 1.2 非命令入口

- **会话文件变更条**（`SessionFilesBadge`）：当 AI 在会话里改过文件后，条上会出现「审核 / 严格审核」下拉菜单，无需敲命令即可启动审核。
- **PR 面板**（`ReviewPlatformPanel`）：聊天窗口顶栏右侧的 PR 图标按钮，点开后选择某个 PR，在 PR 详情页点「Open Review」即可对该 PR 发起审核。

源码位置：`src/web-ui/src/flow_chat/components/modern/SessionFilesBadge.tsx`、`src/web-ui/src/app/components/panels/review-platform/ReviewPlatformPanel.tsx`。

### 1.3 容量设置入口（设置 → 智慧化配置 → 审核）

当前「审核」设置页已大幅简化，**只保留两个数值**，且**桌面端独占**：

| 设置项 | 作用 | 取值 |
|---|---|---|
| 最大并行审核工作 | 严格 Review 同时运行的审核工作上限 | 1–16 |
| 容量等待窗口 | 审核工作等待供应商容量的时长（秒） | 0–3600，步长 60 |

源码位置：`src/web-ui/src/infrastructure/config/components/ReviewConfig.tsx`、`src/web-ui/src/locales/zh-CN/settings/review.json`。

> 历史版本里的「审核策略（快速/标准/深度）」「审核员阵容」「额外 Sub-Agent」等设置**已从该页移除**，视频里不要再去这些 Section 找。

### 1.4 PR 面板支持的远端

- GitHub：通过 `gh auth login` 完成认证（无需保存 Token）。
- GitLab / GitCode：通过粘贴 Personal Access Token 认证。

源码位置：`ReviewPlatformPanel.tsx` 中 `handleOpenGithubAuthTerminal` / `updateAuthToken`。

### 1.5 平台限制

- **桌面应用（Tauri）**：可以发起审核、看到容量设置、看到完整 ReviewPlatformPanel。
- **网页/服务端**：所有发起审核的动作（包括修复后的重试）都会被隐藏或拒绝；只能查看已有审核结果。视频演示请使用桌面应用。

源码位置：`docs/architecture/deep-review.md` Launch Flow 段、`ReviewConfig.tsx` `desktopOnly` 分支。

### 1.6 运行中的 UI（Action Bar）

`DeepReviewActionBar` 在审核运行期间会显示：

- 进度聚合（reviewer 进度摘要）；
- **容量排队通知**（`CapacityQueueNotice`）；
- **部分结果面板**（`PartialResultsPanel`）——若审核被中断/部分失败，仍能展示已得结果；
- **恢复计划预览**（`RecoveryPlanPreview`）——失败后的可恢复计划；
- **修复选项面板**（`RemediationSelectionPanel`）——选中某些发现项让 `ReviewFixer` 去修；
- 顶部状态徽章：进行中 / 已完成 / 失败 / 已取消；可点「在审核设置中打开」跳到设置页。

源码位置：`src/web-ui/src/flow_chat/deep-review/action-bar/DeepReviewActionBar.tsx`、`src/web-ui/src/locales/zh-CN/flow-chat.json` 的 `sessionFilesBadge`、`deepReview` 段。

---

## 二、演示前的环境准备清单

> 录视频前请逐项打勾，避免录制途中才发现缺东西。

### 2.1 软件环境
- [ ] BitFun **桌面应用**最新构建（`pnpm run desktop:dev` 或安装的 release 版本）。
- [ ] 工作区：一个真实的 Git 仓库，**已有若干未提交改动**（建议 3–8 个文件，既有新增也有修改，便于审核员产出有意义的发现）。
- [ ] 模型：在「设置 → 模型」里至少配置了一个可用主力模型和一个快速模型。
- [ ] 权限：「设置 → 智慧化配置 → 权限管理 → 工具执行行为」里临时**关闭「自动执行」**，这样审核员每次调用工具都会弹确认框，方便视频展示"AI 在做什么"。

### 2.2 PR 面板演示（可选但推荐）
二选一：
- **GitHub**：本机已安装 `gh` CLI，且 `gh auth status` 已登录（或视频里现场跑一次 `gh auth login`）。
- **GitLab / GitCode**：准备好一个 Personal Access Token（read_api + read_repository 足够）。

> 如果不想暴露真实仓库，可以临时建一个私有 demo 仓库，推 1-2 个 PR 上去。

### 2.3 容量设置演示样本
- [ ] 把「设置 → 智慧化配置 → 审核」打开一次，确认两个数值可改可保存。

### 2.4 录屏环境
- [ ] 屏幕分辨率 ≥ 1920×1080，建议字体放大到 14–16pt 以保证录屏可读。
- [ ] 关闭与 BitFun 无关的通知（IM、邮件）。
- [ ] 准备好一个文本编辑器，把演示用的命令、PR URL 等贴好备用。
- [ ] BitFun 界面语言切换为简体中文（设置 → 通用 → 外观 → 语言）。

---

## 三、完整演示视频脚本（建议 8–12 分钟）

下面这条脚本能覆盖"设置 → 命令审核 → PR 审核 → 容量调节 → 故障演示"完整链路。每段标注预计时长，可按需裁剪。

### 场景 1：开场与设置入口（约 1 分钟）

1. 打开 BitFun 桌面应用，打开准备好的工作区。
2. 顶部菜单进入「设置」→ 左侧「智慧化配置」分类 → 点「审核」。
3. 镜头对准页面：
   - 说明当前审核设置只保留「容量」一个区块；
   - 念出两个数值的含义：「最大并行审核工作」「容量等待窗口」；
   - 强调**网页端会显示"仅桌面端可用"**（可切到网页版截图佐证，或口述）。
4. 把「最大并行审核工作」改为 `2`，「容量等待窗口」改为 `120` 秒 → 弹「审核设置已保存」。
5. 退出设置回到工作区。

### 场景 2：本地变更审核（`/review`）（约 2.5 分钟）

1. 在工作区里用编辑器随便改 3 个文件，每个文件改 5–10 行，让 Git status 显示有未提交改动。
2. 切回 BitFun 聊天窗口，在输入框敲：
   ```
   /review
   ```
   按 Enter 发送。
3. 镜头对准聊天流：
   - 第一条消息是审核启动提示，列出将被审核的文件清单（带"已跳过 X 个命中排除规则的文件"的过滤提示，如果有锁文件等）。
   - 接着是 AI 调用 `GetFileDiff` 等工具的过程，由于关闭了「自动执行」，可逐个点「允许一次」让用户看清审核员在读取什么。
4. 等审核跑完，展示**结构化审核报告**：
   - 文件分组、每个发现项的位置 / 严重程度 / 描述 / 建议；
   - 顶部状态徽章变为「已完成」。
5. 点报告里的「导出 Markdown」按钮（如有）演示导出功能。
6. 在底部 Action Bar 演示「重试」「打开审核设置」按钮（即使没失败也演示按钮存在）。

### 场景 3：严格审核（`/review strict`）（约 2 分钟）

1. 在同一个会话或新会话输入：
   ```
   /review strict
   ```
2. 强调**会弹一次确认**（DeepReviewConsentDialog），文案：「严格审核会运行更广的审核覆盖，可能更耗时并消耗更多 Token」。点确认继续。
3. 让其跑完。展示与场景 2 的区别：
   - 严格审核会**额外调用专家与质量检查员**（在 Action Bar 的进度摘要里能看到 reviewer 子项）；
   - 报告更详细，可能包含跨文件/架构层面的发现。
4. 在 Action Bar 选 1–2 个发现项，点「让 ReviewFixer 修复」（即 RemediationSelectionPanel 的修复选项）→ 演示一次**修复后自动发起 follow-up 审核**（同一个 record 的下一个 revision）。

### 场景 4：PR 审核（ReviewPlatformPanel）（约 3 分钟）

1. 点击聊天顶栏右侧的 **PR 图标**按钮（tooltip：拉取请求）。
2. 第一次进入会要求选择远端：
   - 如果是 GitHub：点「通过 GitHub CLI 登录」→ 弹出终端，自动复制 `gh auth login --hostname <host>` 到剪贴板 → 粘贴回车完成 OAuth。
   - 如果是 GitLab / GitCode：点「使用 Token」→ 粘贴 Token → 保存。
3. 远端认证成功后，PR 列表加载出来。镜头展示列表：每条 PR 显示标题、作者、分支、CI 状态、最新更新时间。
4. 选中其中一个 PR，进入详情页，演示三个 Tab：
   - **Overview**：PR 描述、CI Checks 摘要、Review Threads；
   - **Changes**：分页文件 diff；
   - **Commits**：提交列表。
5. 在详情页右上角点 **「Open Review」** 按钮 → BitFun 在聊天里拉起一个针对该 PR 的审核会话。
6. 审核跑完后回到 PR 详情页，PR 头部应出现「BitFun Review」徽章，显示：发现数、风险等级、新鲜度（current / stale）、覆盖率（complete / limited）。
7. 点徽章 → 跳转回聊天里看完整报告；点 PR 列表里的「Add to chat」可把 PR 上下文加到聊天里继续追问。

### 场景 5：容量影响演示（约 1.5 分钟）

> 这一段主要展示「容量设置真的会影响审核行为」。

1. 进入「设置 → 审核」，把「最大并行审核工作」改成 `1`。
2. 回到聊天对一个改动较大的工作区跑 `/review strict`。
3. 镜头对准 Action Bar 的进度摘要：**只看到 1 个审核工作在跑**，没有并行。
4. 中途切回设置改成 `4`，再发起新一次 `/review strict` → 这次能看到多个审核工作并行启动。
5. 把「容量等待窗口」改成 `5` 秒，再人为让模型 API 触发限流（最简单办法：临时把模型 BaseURL 改成不存在的地址，让供应商返回 429/容量错误）→ 5 秒后审核工作被自动跳过，Action Bar 出现 **CapacityQueueNotice**，并显示部分结果面板（PartialResultsPanel）。

### 场景 6：故障与边界演示（约 1.5 分钟，可选但强烈推荐）

故障态比"全部跑通"更能体现产品成熟度，建议都录进去：

1. **审核被中断**：审核运行中点 Action Bar 的「停止」按钮 → 状态变「已取消」；展示 PartialResultsPanel 仍能看到已得的部分发现。
2. **目标已过期（stale）**：在审核进行中，去工作区改同一批文件并 commit；审核跑完后回到聊天，PR 面板（或本地 Badge）应显示「stale target」并提供「Review current version」按钮 → 点它会创建同一 record 的新 revision。
3. **网络中断**：审核运行中拔网线 / 关闭 Wi-Fi → Action Bar 出现错误状态、`RecoveryPlanPreview` 显示可恢复计划、点「重试」按钮。
4. **网页端不可用演示**：切到 `pnpm run dev:web` 启动的网页版 → 进入「设置 → 审核」看到「仅桌面端可用」；聊天框输入 `/review` 应被拒绝并给出明确的"网页端不支持"提示。
5. **未授权 PR 远端**：在 PR 面板选一个未配置 Token 的 GitLab 远端 → 点「连接」应弹认证 Modal，并明确提示需要 Token。

---

## 四、镜头与解说建议

### 4.1 重点画面一定要给特写
- 「设置 → 审核」整页（含两个数值）；
- 聊天输入框里的 `/review` / `/review strict` 命令；
- 严格审核的同意弹窗（DeepReviewConsentDialog）；
- Action Bar 的进度聚合区，特别是 reviewer 并发那一行；
- PR 面板的「Open Review」按钮和审核完成后的「BitFun Review」徽章；
- 故障态下的 CapacityQueueNotice 与 PartialResultsPanel。

### 4.2 解说关键句模板（可照念）
- "BitFun 的审核是只读子会话，永远不会直接修改你的代码。"
- "普通审核走 `/review`，深度审核走 `/review strict`，两者都从聊天框触发。"
- "PR 审核不是另一个引擎，而是把同一套 Review 结果按 provider 仓库 + PR id + base/head 关联到 PR 详情页。"
- "AI 给出的发现永远是建议，不是合并门禁；'无发现'也不等于'可以安全合并'。"
- "容量设置只控制并行与排队等待，不影响审核深度；深度由是否带 `strict` 决定。"

### 4.3 避坑提示
- 不要在视频里使用 `/DeepReview` —— 这是过渡兼容别名，会被用户误以为是另一个功能。
- 不要承诺「PR 审核会自动评论 / 自动批准 / 自动合并」 —— 这些是显式非目标（见 `docs/architecture/review-lifecycle.md` Non-goals 段）。
- 不要展示真实的 Token 或真实私有仓地址；用临时仓库或马赛克。
- 录 PR 面板时不要把"Add page / Refresh / Search"等按钮当作重点 —— 它们是分页/搜索辅助，不是审核核心。

---

## 五、最小烟雾测试清单（如果只想录 3 分钟短视频）

按以下顺序跑一遍即可展示主要能力：

- [ ] 设置 → 审核：改两个数值并保存成功。
- [ ] 工作区改 2 个文件 → `/review` → 看到结构化报告 + Action Bar 状态。
- [ ] 同一会话 → `/review strict` → 同意弹窗 → 跑完看到专家 + 质量检查参与。
- [ ] 顶栏 PR 图标 → 选远端（GitHub 用 `gh auth login`）→ 选 PR → 「Open Review」→ PR 详情页出现 BitFun Review 徽章。
- [ ] 设置 → 审核 → 把最大并行改为 1 → 再跑一次 `/review strict`，对比并行差异。
- [ ] 网页端打开 BitFun → 设置 → 审核 看到「仅桌面端可用」。

---

## 六、参考代码与文档位置

| 关注点 | 文件 / 链接 |
|---|---|
| 命令解析 | `src/web-ui/src/flow_chat/deep-review/launch/commandParser.ts`、`src/web-ui/src/flow_chat/utils/deepReviewConstants.ts` |
| 审核启动服务 | `src/web-ui/src/flow_chat/services/ReviewService.ts`、`src/web-ui/src/flow_chat/deep-review/launch/DeepReviewService.ts` |
| 运行中 Action Bar | `src/web-ui/src/flow_chat/deep-review/action-bar/DeepReviewActionBar.tsx` 与同目录 `CapacityQueueNotice.tsx`、`PartialResultsPanel.tsx`、`RecoveryPlanPreview.tsx`、`RemediationSelectionPanel.tsx` |
| PR 面板 | `src/web-ui/src/app/components/panels/review-platform/ReviewPlatformPanel.tsx` |
| 文件变更条入口 | `src/web-ui/src/flow_chat/components/modern/SessionFilesBadge.tsx` |
| 审核容量设置 | `src/web-ui/src/infrastructure/config/components/ReviewConfig.tsx` |
| 中文文案 | `src/web-ui/src/locales/zh-CN/settings/review.json`、`src/web-ui/src/locales/zh-CN/flow-chat.json`（`sessionFilesBadge` / `deepReview` 段） |
| 架构基线 | `docs/architecture/deep-review.md`（当前实现）、`docs/architecture/review-lifecycle.md`（已采用但部分尚未实现的目标设计） |

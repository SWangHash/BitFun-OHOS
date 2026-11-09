# BitFun HarmonyOS PC Release Notes

本仓库是 [BitFun](https://github.com/GCWing/BitFun) 在 HarmonyOS PC 上的移植版本。每个版本由 `release/1.0.x`、`release/2.0.x` 分支维护,并同步对应的上游 BitFun 产品版本。下方按时间倒序列出各版本的 HarmonyOS PC 适配进展与同步进入的关键特性/修复。

---

## v2.0.2 (2026-11-05) — 基于 BitFun 2.0.0

### HarmonyOS PC 适配

- **窗口管理**:支持按住标题栏拖动最大化窗口并在拖动时跟踪指针;宿主 move 循环可恢复最大化窗口状态。
- **后台保活**:定时任务(scheduled jobs)在应用退到后台后保持运行。
- **文件拖拽**:跨应用拖入文件改为暂存中转,不再猜测沙箱路径。

### 重要修复

- **ACP 智能体协同**:展示独立权限请求;表单式问题展示并回传答案;图片附件转发给智能体;历史操作间保持会话身份。
- **QT 迁移**:候选准入统一到单一入口并以此驱动 intake 决策;过滤模型提及的构建脚本目录,允许工作区作为输出目录;只提供与自身描述相符的候选目录;intake 卡片重放走同一候选过滤。
- **会话与工作区**:子会话创建/恢复与 worktree 绑定时保持项目归属;快照在执行工作区记录 worktree 历史;会话内容在执行工作区打开。
- **Git**:远程分支 checkout 保持附着状态并安全 fast-forward。
- **Review**:超时错误本地化展示。
- **Web UI**:降低长会话图片导出开销;窗口缩放后保持右面板比例;反馈收件箱关注提示与回复焦点。
- **内嵌浏览器**:修复后台浏览器 reveal 流程;跟踪 browser-control 连接问题。
- **剪贴板**:粘贴板复制失败时经文档路径形式重试(issue #473)。

---

## v2.0.1 (2026-11-03) — 基于 BitFun 2.0.0

2.0.1 是 2.0.0 的紧急修复版本,重点解决从 1.0.9 升级到 2.0.0 后应用无法打开的问题:

### 重要修复

- **升级启动兼容(重点)**:桌面端可在已发布的 1.0.x 配置与工作区注册表上正常启动;不再因旧版本写入的配置阻塞启动;读取时丢弃配置文档中不可解析的值,并补充发布版注册表封套的端到端测试。
- **Windows 窗口**:修复窗口控制按钮与重复标题栏问题。
- **Web UI 交互**:修复灯箱关闭按钮重叠、选区翻译回填、boost 菜单重置与状态槽对齐;上下文菜单图标标注与 boost 菜单跨上下文持久化;ModelSelector 子菜单度量;会话切换后恢复输入历史导航。

---

## v2.0.0 (2026-10-31) — 基于 BitFun 2.0.0

### 版本概览

2.0.0 是一次大版本升级,与 1.0.9 差异显著,建议升级前先阅读下方「破坏性变更与升级说明」:

- **Agent 引擎重构**:新增 Ultra/Swarm 多智能体编排(planner/worker/reviewer 分工,最多 128 个 Agent、5 层深度)、权限系统 V2(三档模式 + 批量批准)、记忆提取/整合流水线、跨客户端 Steering 与持久化回合日志。
- **鸿蒙 PC 生态**:ACP 智能体一键配置(DevEco Code、Claude Code、Codex、DeepSeek Harness、Kimi、Qwen、CodeBuddy、OpenCode);行业智能体阵容(Qt→HarmonyOS 迁移专家、鸿蒙构建专家、鸿蒙上架预检助手);鸿蒙手机端账号远程控制与折叠屏适配。
- **产品面**:皮肤/外观市场、审核制 MiniApp 市场、OpenHarmony Matrix 技能市场、编辑器升级(Markdown 富文本预览、PDF 查看器、HTML 预览)、键盘快捷键中心、繁体中文支持、AI 桌宠、自动更新。
- **账号与远程**:账号体系迁移为 GitHub 身份 + 多设备同步 + Peer Device Mode;SSH 远程工作区(多跳/容器/SFTP)、离线任务分发(Detached Dispatch)、微信/飞书/Telegram 机器人控制、原生 iOS/Android 客户端。

### 破坏性变更与升级说明

**Agent 工具与模式**

- Bash、Git、TerminalControl 不再注册为 Agent 工具:执行 shell 命令与本地 Git 操作改用 **ExecCommand**,终端生命周期控制改用 **ControlHub**。依赖旧工具的自定义智能体/提示词需调整;旧会话记录做了兼容清理,历史回放不受影响 (`refactor(agent): remove legacy command tools`)。
- Plan 模式与 Multitask 模式退役,规划能力改为内置 plan 技能(产出 `.plan.md` 工件);旧的模式选择自动回退到 agentic 模式 (`feat(agent): replace Plan mode with skill`)。
- 权限系统迁移到 V2:旧的 `ai.skip_tool_confirmation` 自动迁移为 `tool_permissions`;`skip-confirmation`、`confirmation-timeout` 等旧配置已删除,需在新三档模式(询问确认/自动批准/完全访问)中重新选择 (`feat(permissions): unify permission modes and migrate legacy config`)。

**账号与远程**

- 账号云同步被替换为 GitHub 身份 + 设备自主的远程控制:同账号多设备注册/路由、会话与设置加密云同步;移动端配对改为账号密码方式 (`feat: account sync, multi-device control, and Peer Device Mode`)。
- SSH 移除 Agent 认证,旧 Agent 认证迁移为私钥认证 (`feat(remote-ssh): remove SSH Agent auth; migrate legacy Agent to private key`)。
- 旧版本自部署 Relay 服务端将被拒答(410 relay_version_retired),需升级 Relay;官方端点迁移,旧端点需重新认证 (`feat(relay): answer retired Relay versions with an actionable 410`)。
- 远程控制要求客户端构建版本与主版本匹配 (`feat(account): gate remote control on matching client builds`)。

**编辑器与 UI**

- Markdown 编辑器预览精简:移除「分屏」「预览」模式,富文本成为唯一渲染视图;Mermaid 交互式编辑器移除(Markdown 内 Mermaid 块渲染保留) (`fix(editor): make rich text the only Markdown preview mode`)。
- Review 从聊天「附加模式」列表移除,改为独立场景入口;语音能力收拢为输入框语音控件,语音设置页入口不再展示。

**HarmonyOS 专项**

- 品牌统一为 BitFun:数据目录 `~/.openbitfun` → `~/.bitfun`,bundle id 更新为 `com.bitfun.*`;旧安装数据保留在 `~/.openbitfun`,不做自动迁移,需要保留历史数据的用户请手动处理 (`refactor(brand): rename crates, paths, and identity to BitFun`)。
- 鸿蒙上应用内更新停用,更新由 AppGallery 负责;About 手动检查跳转 AppGallery (`Fix HarmonyOS version sync and update gating`)。

**生态开发者**

- Task 工具每次调用必须提供 `agent_id`,不再接受 `description`;AgentSpawn 同样要求 `agent_id` (`feat(agent): require caller-defined Task ids`)。
- 派发协议升级到 v4(每回合模型/审批策略覆盖),旧 SSH 目标需通过一键安装升级 CLI 后才能派发 (`feat(dispatch): protocol v4 per-turn model and approval-policy overrides`)。

### 重点新特性

**Agent 引擎**

- **Ultra/Swarm 多智能体编排**:Ultra 模式作为递归规划 Swarm 执行入口,内置 planner/worker/reviewer 角色分工,子 Agent 生命周期工具、后台结果等待与批量执行、可配置子 Agent 模型 (`feat(agent): add Ultra swarm orchestration`)。
- **权限系统 V2**:统一文件/命令/MCP/MiniApp/Computer Use 审批,支持「本轮及后续」原子批量批准、按会话隔离的权限模式、子 Agent 请求路由到父会话并展示委派沿袭 (`feat(permission): add v2 rule contracts and evaluator`)。
- **记忆与上下文**:端到端记忆提取/整合流水线(敏感信息脱敏、启动注入与引用记录);上下文压缩交接重构、手动压缩入口、会话级 prompt cache (`feat(memory): add end-to-end memory extraction and consolidation workflow`)。
- **跨客户端 Steering 与持久化回合**:活跃回合可跨客户端统一转向;运行中回合事件写入持久日志,回合投影可超越 Host 进程存活;SDK 支持持久化会话恢复 (`feat(runtime): unify active-turn steering across clients`)。
- **MCP 扩展**:远程服务器 OAuth(含重新认证)、prompt 命令与资源访问、MCP APPS、按模式/工作区作用域的聊天内目录与 @ 服务器提及胶囊 (`feat: add MCP OAuth support for remote servers`)。
- **模型与订阅生态**:接入 models.dev 作为内置 Provider/模型权威目录;新增 Hermes、SuperGrok、OpenCode Zen/Go、TokenDance 等订阅,应用内订阅 OAuth 取代本地凭据扫描 (`feat(ai): integrate models.dev provider catalog`)。

**产品面**

- **皮肤/外观市场**:GitHub 账号共享登录提交、审核管理、内置皮肤创作技能;外观类型化包运行时,选择持久化并在桌面启动与嵌入表面间投影 (`feat: add Skin marketplace with shared GitHub account`)。
- **编辑器升级**:Markdown 富文本预览(支持 frontmatter)、集成 PDF 查看器(缩放/旋转/页导航/文本选择)、HTML/HTM 在内置浏览器预览并保留源码编辑 (`feat(editor): add PDF viewer`)。
- **键盘快捷键中心**:设置新增快捷键 Tab,画布/Git/FlowChat/文件等场景级快捷键与快捷键参考面板 (`feat(web-ui): keyboard shortcuts hub, ShortcutManager, settings reference`)。
- **多语言**:统一 locale 注册表并新增繁体中文(zh-TW);会话标题按用户语言生成 (`feat(i18n): unify locale registry and add zh-TW support`)。
- **AI 桌宠**:默认接入 Bifang 吉祥物,新增宠物气泡输入器、宠物切换设置、Petdex 导入,提问待答复时宠物提示关注 (`feat(web-ui): add Bitfun Bifang mascot as default companion pet`)。
- **自动更新**:应用自动更新与每日后台静默下载,更新源增加 openbitfun.com 兜底端点 (`feat(auto-update): add auto-update`)。

**远程与多设备**

- **SSH 远程工作区**:多跳 ProxyJump、容器工作区、SFTP 文件浏览/传输、端口转发;新增原生 Windows WSL 工作区 (`feat(remote-ssh): complete multi-hop and container workspaces`)。
- **离线任务分发(Detached Dispatch)**:任务派发到 SSH 目标机离线执行,基于 Git worktree 隔离,支持多设备工作流与事件回放 (`feat(dispatch): add detached SSH task execution`)。
- **IM 机器人控制**:微信/飞书/Telegram 机器人驱动桌面会话;Relay 提供一键自部署向导 (`feat(remote-connect): WeChat bot, router, desktop and web-ui integration`)。
- **原生移动客户端**:全新 iOS 与 Android 客户端,与鸿蒙手机端对齐远程控制、会话、账号体验 (`feat(mobile): add native iOS client surface`)。

**内容生态与会话**

- **MiniApp 市场**:审核制小程序市场(提交/审核/下载排行),Agent 可经 PublishMiniApp 一键发布,鸿蒙端以可视化库呈现并支持原生 ArkWeb 预览 (`feat(miniapp): add reviewed MiniApp marketplace`)。
- **OpenHarmony Matrix 技能市场**:技能中心按设计稿重构(卡片画廊、详情弹窗、无限滚动),接入 Matrix 市场源 (`feat(skills): add OpenHarmony Matrix market integration`)。
- **会话与工作区**:递归 Agent 会话树、会话归档/恢复、回合页脚分支新会话、托管 worktree 会话(自动清理)、批量管理器 (`feat(flow-chat): add recursive agent session tree`)。
- **设计系统**:独立 UI 基础库落地(Menu/Modal/Tooltip/ScrollArea/Field 等数十个组件与 Design Lab),产品侧大面积迁移,交互与视觉一致性重构 (`feat(design-system): establish independent UI foundation`)。

### HarmonyOS PC 适配

- **Qt→HarmonyOS 迁移专家**:全新 QtMigration 智能体模式——intake 卡片收集源项目/输出容器/工具链/模板绑定输入,官方 Qt 工具链一键下载配置,迁移进度面板实时展示阶段,配套 ohos-qt-skills 知识库 (`feat(qt-migration): register the QtMigration agent mode and surface it in the UI`)。
- **ACP 智能体生态**:DevEco Code(原生 npm 预设)、Claude Code、Codex、DeepSeek Harness(含 dsh-acp IDE 桥接、每会话模型选择、历史续聊)一键配置;Kimi Code、Qwen Code、CodeBuddy、OpenCode 经 HarmonyBrew 托管安装并复用已检测安装 (`feat(acp): add DevEco Code support on HarmonyOS`)。
- **行业智能体**:注册 HarmonyBuild 鸿蒙构建专家及子智能体、鸿蒙功能增强智能体、鸿蒙上架预检助手(对比度/完整性/隐私同意检查,支持选择修复与复检);Agent 选择器新增行业分类 (`feat(agents): register HarmonyBuild industry agent and its subagents`)。
- **鸿蒙原生能力**:会话产物经系统 Share Kit 分享到附近设备、系统截屏、状态栏托盘图标(左键恢复主窗口、右键宠物开关)、任务运行锁阻止自动休眠、窗口失焦即推送完成/待审批通知、开机自启显示系统托管状态 (`feat(ohos): add status bar tray menu with desktop pet toggle`)。
- **手机端**:原生鸿蒙手机 App 架构重构,接入账号远程控制(侧边栏按设备组织、查看每台桌面的工作区),折叠屏折痕感知布局与三折叠适配,界面中英文切换 (`feat(harmonyos): integrate account remote control`)。
- **ArkWeb 适配**:主窗口启用 DOM Storage(修复重启后输入历史/i18n/工作区状态丢失);修复内嵌浏览器白屏、滚动条不可拖拽、PDF worker;mailto 链接改跳系统应用 (`fix(ohos): enable domStorageAccess on ArkWeb main webview`)。
- **文件交互**:OHOS 原生文件拖拽入聊天、文件树剪贴板与系统粘贴板缓存复制、图片/评审报告独立下载走 OHOS 保存对话框、写下载目录前主动申请权限 (`feat(drag-drop): wire useNativeFileDrop for OHOS native file drag-drop support`)。
- **性能**:启动路径削减与前端包瘦身;会话切换防抖降至 50ms 并丢弃过期响应;Git 轮询降频至 10 秒且仅刷新活动工作区;请求队列隔离与会话初始化恢复 (`perf(ohos): speed up HarmonyOS PC startup and shrink the frontend bundle`)。
- **订阅与凭据**:修复鸿蒙订阅登录与模型发现(不再依赖 D-Bus keyring,DNS 经 netmanager);Codex 登录适配 AssetStore 密钥长度限制并展示 GPT-5.6;保留旧版市场凭据 (`fix(ohos): keep subscription login and model discovery working`)。
- **打包与交付**:GitCode 统一三平台打包流水线(OHOS 签名 HAP/.app 默认构建)与每日定时签名包;LAN 控制器资源单独打包进 HAP 并校验;新增 beta 打包渠道 (`ci: add and harden the unified GitCode package pipeline`)。
- **权限与设备**:新增平板设备类型,移除无效的 `WINDOW_TOPMOST` 权限,新增 `ALLOW_USE_BM` 权限申请 (`feat(ohos): add tablet device type and drop invalid WINDOW_TOPMOST permission`)。

### 变更与新特性(同步上游)

- **语音输入重做**:输入框语音录入与识别链路整体重构,录音控件新增实时电平条,浮动对话与语音历史统一整合 (`fix(voice-input): rework composer voice input and speech pipeline`)。
- **聊天导出**:新增多种图片导出模式(紧凑图、带思考图、详尽模式含完整推理),修复导出中断与思考图标丢失 (`feat(flow-chat): Add image export modes`)。
- **DeepReview**:多角色评审 Agent 团队与自适应编排、证据收集与容量/成本控制、可指定评审模型;评审平台新增 Gitee 支持(Pull Requests、issue 证据、评论与审批)与跨页 PR 检索 (`feat(deep-review): add review agents and policy`)。
- **终端与输入法**:修复 ArkWeb/Chromium 下 IME 激活时方向键丢失(keyCode 229)导致的历史翻页失效,组合键交还输入法 (`fix(terminal): rebuild keys xterm drops on IME key codes`)。
- **文件历史**:按文件粒度的提交历史与 Agent 变更时间线,并绑定工作区作用域 (`feat(git): add per-file commit history and agent change timeline to file history view`)。
- **工作区**:多工作区、会话级托管 worktree(隔离到首次提问、自动清理、工作区管理器)、仓库信任确认与相关目录支持 (`feat(worktrees): add managed worktree sessions`)。
- **扩展兼容**:OpenCode 插件 hooks/子代理/workspace 引用兼容,Claude/Codex 配置导入,Codex 兼容的 Agent 生命周期 hooks (`feat(extensions): add OpenCode subagent compatibility`)。
- **反馈**:反馈收件箱恢复并接入共享登录认证,界面对齐设计系统 (`feat(feedback): restore feedback inbox and shared authentication`)。
- **FlowChat 打磨**:用户消息时间戳与并排操作、大段粘贴胶囊可编辑、MCP 工具入参展示、深度研究协议渲染为结构化 UI (`feat(flow-chat): show user message send time`)。

### 重要修复

- 修复 OHOS 请求队列争用与会话初始化失败后不可恢复的问题 (`fix(ohos): isolate requests and recover session initialization`)。
- 修复系统深浅色「跟随系统」切换延迟 1-2 秒的问题 (`fix(ohos): apply system theme changes without the follow-system delay`)。
- 修复原生文件拖拽白屏、图片重复与文件丢失 (`fix(drag-drop): fix OHOS native file drag-drop white screen, duplicate images, and missing files`)。
- 修复 Share Kit 分享取消被误报为成功 (`fix(ui): share cancel title, session reuse, global file dialog`)。
- 修复鸿蒙上订阅登录与模型发现失败的问题 (`fix(ohos): keep subscription login and model discovery working`)。
- 大量交互与视觉打磨:滚动锚定、tooltip 时序、弹窗层级、会话切换卡顿、i18n 文案治理等。

---

## v1.0.9 (2026-10-16) — 基于 BitFun 1.0.9

### HarmonyOS PC 适配

- **启动画面**:开屏体验对齐原生:webview 启动期间镜像原生启动窗口(StartWindow),在页面加载结束或接管帧准时释放镜像;跳过 OpenHarmony 主机上的静态启动页;开屏品牌与图标尺寸对齐原生绘制规则并固定启动窗口背景;webview 与开屏镜像跟随系统深浅色模式;窗口装饰在开屏镜像呈现前应用(保留延迟 40ms 应用)。
- **构建**:注册 `ohos_rs_ability` 模块进 HarmonyOS 构建(补齐 `BuildProfile.ets`、`build-profile.json5`、`hvigorfile.ts` 与混淆规则,模块 `@ohos-rs/ability` 更名为 `ohos_rs_ability`)。
- **ACP/HAP 打包**:HAP 组装期间经 Hvigor 入口插件准备并同步内置 bitfun-acp profile,签名前校验打包内容完整性。
- **ACP OpenCode 供给**:OpenCode 改为经 HarmonyBrew core formula 托管安装,替换原第三方手动安装指引。
- **内置技能**:`hmos-dev-env-setup` Step 1 拆分为"命令行工具 / DevEco Studio"两种方式选择。

### 重要修复

- 修复 Antigravity 连接与账号模型发现:使用有效平台元数据并经服务端 wire ID 拉取已认证账号的模型目录;按凭据与提供方隔离托管项目缓存,保留旧预览别名;发现失败按可重试错误呈现,不再回退静态预设模型。
- 修复 Antigravity 请求与流式对齐:处理包装流事件与 pending 项目 onboarding,翻译模型特定推理设置,保持工具 schema 约束与多轮调用;仅在连接失败与选定 HTTP 错误时切换兼容 Code Assist 端点。
- 修复 DeepReview:渲染前校验报告字段,缺失内容显示为不可用而不改变已持久化记录;保留可选摘要与既有字符串标签。
- 修复错误信息本地化:ACP、Review、SSH、Remote Connect 等桌面模块的授权错误在展示层本地化并保留参数与外部诊断;保持执行错误分类、提供方过滤与原始诊断输出。
- 修正 agentic mode 系统提示词中 BitFun 的角色描述。

---

## v1.0.8 (2026-09-28) — 基于 BitFun 1.0.8

### HarmonyOS PC 适配

- **开发工具链重构**:`check_arkts_files` 更名为 `arkts_check` 并改为直接调用 DevEco Studio 自带 Node + SDK checker,不再依赖 `deveco-mcp` MCP server;旧会话 transcript 历史引用自动归一化,无需手动迁移;`arkts_check` 自动发现 DevEco Studio 安装路径(`DEVECO_HOME` 环境变量 + 平台默认路径,仅发现失败时提示设置);build/search/cpp 工具收敛进 `devecocli`;Harmony Agent 对齐 harness 工作流,为 Harmony agents 启用 HarmonyOS 技能并清理权限规则。
- **内置技能**:新增 `hmos-dev-env-setup` 内置技能(HarmonyOS 开发环境前置检查);HarmonyOS 技能整体对齐 deveco-code bundle 并从上游同步(arkts-grammar-standards 等);移除 `deveco-create-project`。
- **QT 迁移**:修复工具链配置写入环境变量后卡片候选未识别;原始工程探测对齐 ohos-qt-skills 阶段零预检;修复迁移产物直写输出容器根目录(跳过 `<app-name>-ohos` 子目录);防止二次迁移覆盖历史迁移产物;修复问题卡片选项偶现需点击两次选中。
- **DeepSeek on HarmonyOS**:ACP 使用兼容的 DeepSeek profiles。

### 变更与新特性(同步上游)

- **Review Platform**:支持 Gitee Pull Requests。
- **Relay**:信任改名后的 `openbitfun-relay-server` 镜像仓库(修复一键自部署在镜像改名后整体失效的问题)。
- **Review 本地化**:错误与完整诊断本地化、动作启动失败本地化、缺失显式目标报告、未信任仓库错误、缺失 Git 场景区分。
- **Review 流程**:PR Tab 内容滚动约束、拒绝不匹配的工作区目标、评审期间导出控件保持可见、审批模式继承与轮次准入保留、全选时保持计划可见、GitCode PR 文件单次有界加载。
- **Skills/Matrix**:陈旧请求清理加载标志防止卡死;Matrix ZIP 下载改为流式落盘并对解码错误重试。
- **FlowChat**:权限请求路由到单一所有者;窄会话面板内保持搜索可用。
- **Web UI**:浏览器 webview 背景跟随主题并修复编辑器/光晕/菜单回归;Remote Connect 移除已退役的 BitFun Server 入口;外观包安装移除版本检查。
- **遥测**:托管接入对齐 schema v1。

### 重要修复

- 修复命令输出的二进制/超限内容经 xterm 渲染导致 webview 卡死。

---

## v1.0.7 (2026-09-17) — 基于 BitFun 1.0.7

### HarmonyOS PC 适配

- **遥测与隐私**:引入可移植观测运行时并为 Agent 运行时事实埋点;OHOS 遥测接主机并按隐私门控加固;重新恢复 PrivacyGate(撤销移除);OHOS 反馈认证状态同步无需重启;遥测在禁用态避免无效开销。
- **QT 迁移增强**:引入 LLM 语义识别迁移意图,prompt 路径直通迁移候选,问题卡片候选确定性注入 prompt 解析(不再依赖模型回传),迁移候选优先级调整,迁移产物路径过滤修复;修复问题卡片焦点丢失与回看不回显已提交输入;放开 `ohos-qt-skills` 加载限制。
- **工具链与工作区**:鸿蒙工具链探测改用登录 shell 会话 PATH,工具链候选优先工作区并移除 skill 目录保底;OHOS 构建链路的工作区目录选择适配。
- **内嵌浏览器**:适配外观模式。

### 变更与新特性(同步上游)

- **设置**:移除外部 AI 设置项。
- **Skills**:Matrix 与 skills.sh 同名技能可独立共存;技能卡与 Matrix 芯片接入外观主题令牌。
- **Web UI**:add-model UI 打磨、导航拖拽展开、滚动条可见性;文件树与终端工具栏改用 Tooltip 组件并锚定指针;导航面板可折叠分组头增加折叠指示箭头;聊天发送/停止按钮接入外观主按钮令牌;外观包允许在 registry 漂移时安装;终端工具栏与状态栏国际化。
- **通知中心**:success 类通知纳入 info 过滤,修复搜索后 All 过滤计数。
- **反馈**:反馈交互与鼠标光晕叠加改进;反馈收件箱条目分页。
- **ACP**:提升深层嵌套 runtime futures 的递归上限。

### 重要修复

- 修复 DeepReview:读取 GitCode 对象 patch 并保留刷新统计;恢复被中断的 remediation 与会话提交;决策 tooltip 适配应用主题。
- 修复 web UI 外观问题与 ADE 交互回归(release 分支同步携带)。

---

## v1.0.6 (2026-09-10) — 基于 BitFun 0.2.19

### HarmonyOS PC 适配

- **ACP 外部 Agent 供给**:新增平台感知的 ACP Agent 供给:Kimi Code、Qwen Code 经 HarmonyBrew 安装,CodeBuddy 经 HarmonyBrew 托管的 Node/npm 安装;复用已检测的安装,在 ACP 设置 UI 中暴露需求与供给状态。新增 HarmonyOS 版 Claude Code(HarmonyBrew Node/npm)与 Codex(HarmonyBrew formula)Agent 并绑定上游 ACP 适配器;DeepSeek Harness 经官方 HarmonyBrew formula 安装并打包进 HarmonyOS 资源,OpenCode 以手动获取链接提供 (`feat(acp): add platform-aware agent provisioning`、`feat(acp): support HarmonyOS agent provisioning`、`feat(acp): add HarmonyOS Claude and Codex agents`、`feat(ohos): enable DeepSeek Harness ACP setup`)。
- **QT 工程迁移**:新增 QT 工程迁移鸿蒙能力:内置 `ohos-qt-skills` 技能组与 `qt_migration` Agent;Intake 工具注册分组并支持管理页启停;迁移问题卡片支持国际化并放宽模板问题 header 长度校验;迁移绑定输入注入与官方工具链下载语义;修复鸿蒙模板下载脚本安装根判定 (`QT工程迁移鸿蒙功能`、`QT迁移Intake工具注册分组并支持管理页启停`、`QT迁移问题卡片支持国际化`、`迁移绑定输入注入与官方工具链下载语义`)。
- **Skills 中心与 Matrix 市场**:按设计稿重构技能中心 UI(卡片画廊、详情弹窗),市场 Tab 由分页改为无限滚动并支持加载失败重试;接入 OpenHarmony Matrix 市场,支持 Matrix 技能删除与安装失败提示 i18n;技能下载改为 Rust 原生实现,支持代理感知列表与偏移分页;按 installId 匹配安装、同级冲突报错,并接入 `saveFileToDownloadsOhos` API (`feat(skills): redesign skills center UI with Matrix market refinements`、`feat(skills): add OpenHarmony Matrix market integration`、`feat(skills): native Rust download + proxy-aware listing and offset pagination`、`fix(skills): installId-based matching, same-level conflict error, and saveFileToDownloadsOhos API`)。
- **浏览器**:OHOS 内置 ArkWeb 支持 CDP 控制,新增海泰 TCP CDP 通道,OHOS 默认优先使用内置浏览器;支持 `file://` 协议在内置浏览器打开 HTML;海泰浏览器未安装时回退系统浏览器;隔离内嵌 webview 表面;经 ArkTS webview 桥暴露 `browser_get_url` (`feat(browser): control OHOS built-in ArkWeb via CDP`、`feat(browser): add OHOS Haitai TCP CDP control`、`feat(browser): prefer built-in browser on OHOS`、`fix(browser): isolate embedded webview surfaces`)。
- **桌面宠物**:桌面宠物以应用内 overlay 形式适配 HarmonyOS;应用最小化时经 pet-only 窗口形变保持宠物可见 (`feat(agent-companion): adapt desktop pet to HarmonyOS as in-app overlay`、`feat(agent-companion): keep pet visible on HarmonyOS minimize via pet-only window morph`)。
- **平台与构建**:新增平板(tablet)设备类型并移除无效的 `WINDOW_TOPMOST` 权限;OHOS SDK 升级到 6.0.1;显示版本号更新为 1.0.6 (`feat(ohos): add tablet device type and drop invalid WINDOW_TOPMOST permission`、`Adjust the SDK version to 6.0.1`、`update display version to 1.0.6`)。

### 新特性(同步上游)

- **Matrix 市场可靠性**:HTTP 重试与 5xx 重试、失败 facet 自动重载、facet 错误 i18n;ZIP 下载上限提升到 64 MiB 并移除冗余安装错误横幅 (`fix(matrix): add HTTP retry, 5xx retry, auto-reload failed facets, and i18n facet errors`、`fix(matrix): raise ZIP download limit to 64 MiB and remove redundant install error banner`)。
- **行业智能体**:行业智能体卡片显示后端英文原名 (`行业智能体卡片显示后端英文原名`)。

### 重要修复

- 修复 ADE 交互回归:slash 命令浮层保持锚定且可关闭、通知展开互斥、搜索控件不再遮挡轮次上下文 (`fix(web-ui): resolve ADE interaction regressions`);修复左侧面板与会话窗口之间的拖拽区域 (`fix(web-ui) 修复左侧面板和会话窗口之间的拖拽区域`);修复 web UI 外观问题与普通问题卡片在其他输入框键入时被卸载 (`fix web UI appearance issues`)。
- 修复 DeepReview:流式期间保持操作栏开关状态;评审画布跟随活动工作区切换;Other 分组复选框可选;评审平台从运行时环境解析 Git (`fix(review): preserve action bar toggles during streaming`、`fix(review): switch review canvas with the active workspace`、`fix(review): enable Other group checkbox selection`、`fix(review-platform): resolve Git from the runtime environment`)。
- 修复 ACP:prompt 错误与传输终止正确传播;遗留权限迁移需显式保存;权限设置移除自动拒绝;禁用 Agent 显示为 inactive (`fix(acp): propagate prompt errors and transport termination`、`fix(acp): make legacy permission migration explicitly saveable`、`fix(acp): remove automatic rejection from permission settings`、`fix(acp): show disabled agents as inactive`)。
- 修复快照大文件流式快照与恢复以限制内存占用 (`fix(snapshot): stream large file snapshots and restores to bound memory`);修复权限在显式授权范围内重复弹窗 (`fix(permission): reduce repeated prompts within explicit grant scopes`);修复 OHOS 凭据保留与市场登录绑定 (`fix(auth): preserve OHOS credentials and bound market sign-in`)。
- 其他:反馈收件箱条目分页 (`fix(feedback): paginate feedback inbox entries`);桌面应用最小化时触发对话框完成通知 (`fix(ohos): fire dialog-completion notification when the desktop app is minimized`);移除重复的 OHOS downloads API (`fix(web-ui): remove duplicate OHOS downloads API`);非 OHOS 平台 guard profile 调试函数;反馈输入框使用 `useImeOwnedKeyGuard`。

---

## v1.0.5 (2026-09-03) — 基于 BitFun 0.2.19

### HarmonyOS PC 适配

- **本地 AI 模型**:新增本地 AI 模型支持,并为本地模型管理器补齐 Appearance 契约 (`feat: add local AI model support`、`fix(appearance): add local model manager Appearance contract`)。
- **实时语音输入**:支持实时语音输入;修复语音录入权限状态与输入框闪烁、关闭确认弹窗误触最小化、文件 Tab 未即时同步,并改善跟随系统外观切换 (`支持实时语音输入`、`fix(web-ui): stabilize voice, dialogs, tabs and appearance`)。
- **会话分享与侧栏**:通过系统 Share Kit 将生成文件分享到附近设备(Markdown/PNG 导出接入分享面板);FlowChat 头部新增会话文件列表;接入 OHOS 屏幕截取;侧栏会话支持置顶切换 (`feat(ohos): aggregate session file share, screen capture, sidebar pin toggle`)。
- **MCP**:支持可配置 location、working_directory 与 project store;容忍未实现 ping 的 MCP 服务器 (`feat(mcp): configurable location, working_directory, and project store support`、`fix(mcp): tolerate MCP servers that do not implement ping`)。
- **凭据与隐私**:统一安全凭据存储到 `SecureCredentialVault`;恢复 PrivacyGate;更新检查接入 AppGallery 桥;About 平台判断改用 `isOpenHarmonyRuntime` (`refactor(creds): unify secure credential storage behind SecureCredentialVault`、`fix(ohos): wire update check to the AppGallery bridge`、`fix(about): use isOpenHarmonyRuntime for platform check instead of try-catch`)。
- **构建与运行时**:原生 ELF 模块自动签名;恢复 tar.xz 解压;HarmonyOS 硬编码路径替换为跨平台目录查找;适配窗口关闭按钮 (`feat(ohos): auto-sign native ELF modules for HarmonyOS PC`、`fix(ohos): restore tar.xz decompression on HarmonyOS PC`、`fix(path): replace HarmonyOS-hardcoded paths with cross-platform dirs lookups`)。
- **Skills 市场**:搜索与分组管理 UX 改进;详情链接改用系统浏览器打开;助手工作区激活时禁用项目级安装;分页 hasMore 守卫与按钮失焦 (`fix(skills): skill market search + group manager UX improvements`、`fix(skills): pagination hasMore guard and button blur`)。
- **DeepReview**:支持在 HarmonyOS 上导出 Markdown 评审报告;规范化畸形评审结果避免崩溃;未信任仓库错误与动作启动失败本地化;评审权限面板路由修复 (`fix(review): export markdown reports on HarmonyOS`、`fix(review): normalize malformed review results`)。
- **Codex 订阅**:修复 OHOS 上 Codex 订阅登录的稳定性:OAuth 凭据长度控制在 HarmonyOS AssetStore 密钥上限内;初始模型发现暴露 GPT-5.6;OHOS 目标关闭 MSVC 链接器标志;恢复 web UI 所需的 OHOS downloads API (`fix(ohos): stabilize Codex subscription login`)。
- **其他**:对齐 libgit2 与 Git CLI 全局配置;浏览器默认打开 URL 改为 `https://www.bitfun.work`;改进反馈输入与会话行为;文件 i18n 适配;Skills 详情页跳转系统浏览器;为受审计页面的交互元素补充 `data-testid`。

### 新特性(同步上游)

- **ACP/DSH**:IDE-facing DeepSeek Harness ACP 桥与 dsh 插件源适配;支持重开存储的 DSH 会话;ACP 模式独立模型选择器 (`feat(acp): ship an IDE-facing ACP bridge for DeepSeek Harness`、`feat(dsh-acp): offer a per-session model picker`)。
- **Peer 设备模式**:运行中 Turn 事件写入持久日志,投影可跨 Host 进程存活;CLI Host 成为账号对等设备;投影响应交付缺口可探测并补齐;设备切换稳定性系列修复 (`feat(runtime): append the executing Turn's events to a durable log`、`feat(peer): make the CLI Host a peer of the account, not a controller's proxy`)。
- **用量统计**:新增历史模型调用统计页,支持 provider/模型过滤、每模型缓存命中率与 token 用量记录 (`feat(usage): add historical model call statistics page`)。
- **Agent**:任务级模型设置;中断对话轮恢复;已加载的延迟工具可被直接调用并规范化畸形调用 (`feat(ai): add task-specific model settings`、`feat(agent): resume interrupted dialog turns`)。
- **Todos**:为每个计划任务新增 Todos 场景;原生日期选择器替换为应用内实现 (`feat(todos): add a Todos scene for every scheduled task`)。
- **Steering**:任意排队消息可引导运行中的 turn (`feat(steering): let any queued message steer a running turn`)。
- **浏览器 CDP**:连接真实用户浏览器配置;启动重连改为 opt-in (`feat(browser): connect CDP to real user profiles`)。
- **AI 重试**:覆盖所有 provider 错误的重试;瞬态网关模型丢失重试;统一实时模型重试预算 (`fix(ai): retry every provider error`、`fix(agent): unify live model retry budget`)。
- **Git**:不信任仓库可通过信任确认恢复 (`fix(git): recover untrusted repositories via trust consent`)。
- **SDK 与插件**:托管 TypeScript SDK 与共享传输核心;托管 OpenCode 插件宿主集成,并 gating 执行与生命周期 (`feat(sdk): add managed TypeScript SDK and shared transport core`、`feat: integrate managed opencode plugin host`)。
- **移动端/折叠屏**:手机 UI 支持中英文切换;三折态宽屏会话布局;统一会话 MVVM 并恢复双折主从布局;侧栏按账号展示各桌面工作区与设备目录;overlay 按折叠几何布局、折痕保持同轴 (`feat(harmonyos): switch the phone UI between Chinese and English`、`feat(harmonyos): keep tri-fold conversation on remaining screens`、`feat(harmonyos): show every account desktop's workspaces in the sidebar`)。
- **其他**:Markdown frontmatter 支持;工作区索引策略可见且正确;引导用户配置 AI 模型;MiniApp 市场展示提交人与提交时间、无 BitFun 访客引导至下载页;FlowChat 基于 TanStack Virtual 的虚拟化重构与视口稳定性系列修复。

### 重要修复

- 修复 Ollama provider 目录崩溃;评审 GitCode PR 变更统计与截断文件响应;DeepReview 在 admission 失败后恢复 remediation。
- 修复 MCP 状态处理与错误报告:远端连接创建失败置为 Failed 而不再卡在 Starting;重连监视期间显示 Reconnecting,首次失败需手动重试;本地模型不可用提示附带系统设置路径 (`fix(mcp): improve status handling and error reporting`)。
- 修复 Codex 订阅令牌手动刷新改走 OAuth 续期;Codex 模型目录瞬时失败重试一次后回退内置目录 (`fix(ai): force manual subscription token refresh`、`fix(ai): retry Codex model discovery`)。
- 修复语音输入问题;打磨 web UI 布局与外观行为 (`fix voice input`、`fix: polish web UI layout and appearance behavior`)。
- 修复权限请求路由到单一 owner;权限模式在子 Agent 中继承;按轮次应用模式变更。
- 修复回滚时本地工作区身份消歧;Tauri 事件只路由一次;评审团队并发配置持久化;日志级别双向切换与敏感诊断过滤;portaled overlay 独立堆叠层。
- 修复 FlowChat 稳定性:会话视口跨切换/窗口恢复、模型菜单保持在视口内、ExecCommand 卡片折叠布局、Todo 卡片保持折叠、探索分组延迟到轮次完成。

---

## v1.0.4 (2026-08-25) — 基于 BitFun 0.2.17

### HarmonyOS PC 适配

- **浮动窗口与 WebDriver**:适配 webdriver 与浮动窗口特性,工具栏模式桥接到原生窗口 API,并保留原生窗口控件 (`feat(ohos): adapt webdriver and floating window features`、`feat(ohos): bridge toolbar mode to native window APIs`)。
- **隐私与匿名反馈**:实现隐私策略与匿名反馈入口 (`feat(ohos): implement privacy and anonymous feedback`)。
- **窗口与外观**:恢复 `WindowHostService`、修复 `MarketCredentialStore` 异常;恢复 MiniApp 市场访问;皮肤市场凭证改走 OHOS asset store;恢复系统外观跟随;规避状态栏遮挡并隐藏冗余工具栏按钮;原生窗口控件保留。
- **MVVM 重构**:将 App Shell 拆分为 MVVM 分层;统一本地与远程会话 Shell;新增架构边界检查脚本 (`refactor(harmonyos): split the app shell into MVVM layers`、`chore(scripts): check HarmonyOS architecture boundaries`)。
- **会话与账号**:精化远程会话创建与控制;改进自适应聊天与文件预览;统一宽屏会话导航;分离 BitFun 账号登录页;集成账号远程控制;对齐登出 UI;修复登录回退、设备刷新、登录页骨架等。
- **导出**:导出的图片保存到 HarmonyOS 下载目录 (`feat(chat-export): save exported image to Downloads on HarmonyOS`)。

### 新特性(同步上游)

- **模型与推理**:接入 models.dev 作为内置服务商目录的权威来源;新增 GLM、DeepSeek、TokenDance 推理支持;支持 OpenCode Zen 与 Go 订阅;重构模型推理配置并补齐 reasoning preset 投递面。
- **Agent 能力**:新增 anydoc 文档读取、DeepResearch 会话工具;主助手选择与会话选择器。
- **外观系统**:引入 typed package runtime 与 surface contracts 的主题包机制。
- **Skin 市场**:带共享 GitHub 账号的皮肤市场,支持手动提交与审核管控。
- **外部集成**:新增外部 AI 应用接入控制面;收敛默认接入体验;OpenCode 静态技能与 Codex MCP 导入对齐。
- **FlowChat**:reasoning preset 控制;递归 Agent 会话树;窗口化历史与 turn 导航栏。
- **Dispatch**:协议 v4 按轮次覆盖 model/approval;SSH 目标账号守护引导;子 Agent 会话投影。
- **CLI**:app server 进入 CLI;TUI 会话控制与上下文压缩;OpenCode 会话 fork/undo-redo;TUI 图片附件、编辑器与转录工作流。
- **权限**:按会话作用域的工具权限模式。

### 重要修复

- 修复会话回滚的事务性 (`fix(flow-chat)!: make session rollback transactional`);修复 ACP 远端 Agent 退出原因与遗言、远端 SSH 控制句柄误判为 kill;会话切换后保留运行中会话;远端工作区文件提及可靠性;文件浏览器滚动稳定性;场景过渡重叠。

---

## v1.0.3 (2026-08-14) — 基于 BitFun 0.2.14

### HarmonyOS PC 适配

- **语音输入**:通过系统 `speechRecognizer` 实现语音输入,并本地化麦克风权限说明 (`feat(ohos): voice input via system speechRecognizer on HarmonyOS`、`i18n(ohos): localize microphone permission reason to zh-CN`)。
- **HarmonyOS 开发工具**:新增 `build_project`、`start_app`、`hdc_log`、`arkts_knowledge_search` 等工具;`start_app` 在 devecocli 失败时自动回退到 hdc;新增 `verify_ui`、`get_ui_verification_log`、`save_ui_screenshot` UI 校验工具集;从 deveco-code 迁入 `check_arkts_files`、`check_cpp_files`、`switch_cwd`。
- **内置技能组**:注册 HarmonyOS 内置技能组,并从 deveco-code 迁入相关 Skills。
- **PC 内嵌浏览器**:在 HarmonyOS PC 上启用内嵌浏览器 (`feat(browser): enable embedded browser on HarmonyOS PC`)。
- **桌面窗口与依赖**:gate 桌面窗口操作并裁剪不支持的依赖;禁用 Canvas provider 组以避免 OHOS 启动 panic;调度器改用 `tauri::async_runtime::spawn` 修复第二轮卡死。
- **移动端**:精化 HarmonyOS 聊天与会话操作。
- **文档**:定义 HarmonyOS PC CLI 守则 (`docs(architecture): define HarmonyOS PC CLI guardrails`)。

### 新特性(同步上游)

- **扩展兼容**:新增 Claude Code、Codex 配置来源;OpenCode 子 Agent、独立工具与 prompt 命令来源兼容。
- **远程工作区**:SSH 多跳与容器工作区、ProxyJump;`remote-ssh` 连接对话框搜索与配置解析改进。
- **Relay 自部署**:一键自部署 relay 向导;中国区自动镜像检测与部署镜像。
- **发布**:发布 Linux CLI 与 relay 二进制;Linux 归档按速度排序下载源、断点续传与签名。
- **桌面**:防睡眠偏好;指针跟随光晕。
- **权限 V2**:统一权限模式并迁移历史配置;项目权限控制;全局工具规则;V2 审批面板与批量聚合审批;子 Agent 请求投影与审批传播;运行时上限。
- **SDK**:独立 Agent SDK Host 基线。
- **Remote Connect**:账号密码移动配对与弹性设备列表。
- **Pages**:Page Functions、PagePublish 工具与 Write 流式打字机。
- **PPT Live**:单原生场景管线导出可编辑 PPTX。
- **Agent**:编辑约束守卫("不要修改 X");延迟工具加载与延迟执行。

### 重要修复

- 修复 429 限流指数退避;Argon2 默认内存成本下调;account 登录 finalize、peer hydrate、relay deploy 加固;account `This device` 徽章漂移修复。

---

## v1.0.2 (2026-07-30) — 基于 BitFun 0.2.12

### HarmonyOS PC 适配

- **应用更新检查**:通过 Rust-ArkTS 桥将 AppGallery 更新检查接入 AboutDialog;以策略模式重构更新逻辑;`app.auto_update` 配置控制自动更新;共享更新检查逻辑并改进错误处理。
- **终端剪贴板**:声明 `READ_PASTEBOARD` 权限以桥接终端剪贴板。
- **浏览器与依赖**:OHOS 上 webview API 不可用时回退到 iframe;`rmcp` 依赖隔离到 ohos target guard 之后;`reveal_in_explorer` 参数补 `file://` 前缀;HarmonyOS 上禁用 ComputerUse Agent。
- **桌面**:在 Tauri 插件初始化前解析运行时日志级别。

### 新特性(同步上游)

- **记忆**:端到端记忆抽取与整合工作流。
- **文件浏览器**:压缩与解压归档操作。
- **远程工作区**:传输进度、取消与目录支持。
- **Canvas**:Web 运行时与面板;核心工具与存储;产品域契约。
- **Computer Use**:`describe_screen` 文本-only 桌面自动化;集成 `cua-driver-rs` v0.6.8;Windows 捕获与桌面宿主重构。
- **Agent**:图片理解工具;InitMiniApp 默认值与助手配置简化;自定义模式与自定义 Agent 管理。
- **Skills**:内联技能引用与选择器;恢复内置 `miniapp-dev` 技能。
- **读取工具**:tail 模式。
- **MiniApp / PPT Live**:内置 PPT Live 应用,带 Agent 桥与 deck 导出;分阶段 deck 生成;阻塞 headless 不兼容工具并展示子 Agent 进度。
- **FlowChat**:后台子 Agent 活动跟踪与控件;同一轮重试分组与尝试元数据持久化;异常完成以稳定 finalize 语义呈现;专用 ExecControl 工具卡。
- **ExecCommand**:远端会话;流式卡片;本地 shell 配置与 Windows 回退。
- **工具**:exec 命令会话工具;`view_image` 工具;Write 追加模式与内容清理放宽。
- **ChatInput**:可定制换行快捷键(默认 Ctrl+Enter);boost 菜单自定义模式入口。
- **可观测**:展示响应计时与 token 使用;模型交换 tracing;上下文压缩模型交换捕获;请求 trace 用量分析工具。
- **终端**:终端与 Agent 命令可配置环境变量。
- **ControlHub**:增强浏览器。
- **Web UI**:底部面板终端;工作区会话批量管理器;AskUserQuestion 伴随宠物注意力;会话 ID 复制;`/reload-skills` slash 命令。
- **调度**:跨会话与工作区统一调度任务管理。

### 重要修复

- 工具审批与快捷键收紧;工具拒绝与审批状态处理;`ask-user-question` multiSelect 默认 false;Write 工具载荷异常时存到 `.bitfun/tmp`。

---

## v1.0.1 (2026-06-05) — 基于 BitFun 0.2.7

首个面向 HarmonyOS PC 的移植版本,在 BitFun 0.2.7 桌面端基础上完成基础适配。

### HarmonyOS PC 适配

- **权限说明**:为 HarmonyOS 补齐权限原因描述,并提供中文本地化 (`feat(ohos): add permission reason descriptions for HarmonyOS`、`feat(ohos): add Chinese localization for permission reasons`)。

### 关键特性(随 0.2.7 基线落地)

- **Agentic**:`/goal` 模式、文件读取编辑护栏与工作区文件传输改进;目标验证 UI、子 Agent 取消与文件工具引导。
- **CLI**:管理命令与拆分的根处理器;无头会话恢复与结构化执行输出;`/usage` slash 命令。
- **工作区**:相关目录支持。
- **聊天**:对话框 turn 页脚的 AI 免责声明文本。
- **Web UI**:页脚反馈菜单项;移动 Web 滚动到底部浮动按钮。
- **ACP**:展示会话上下文用量。
- **核心**:持久化超大工具结果;bash 命令失败时的 DevBox 下载提示;bash 工具后台任务结果自动交付与补全。

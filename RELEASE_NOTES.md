# BitFun HarmonyOS PC Release Notes

本仓库是 [BitFun](https://github.com/GCWing/BitFun) 在 HarmonyOS PC 上的移植版本。每个版本由 `release/1.0.x` 分支维护,并同步对应的上游 BitFun 产品版本。下方按时间倒序列出各版本的 HarmonyOS PC 适配进展与同步进入的关键特性/修复。

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

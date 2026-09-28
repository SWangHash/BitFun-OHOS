# HarmonyOS UI Test ID 短测指导

本文面向 HarmonyOS/OpenHarmony HAP 中运行的 BitFun WebView UI 短测。它把
[UI Test IDs](ui-testids-CN.md) 作为 Web 侧 ID 契约来源，把
[E2E Testing Guide](../../tests/e2e/E2E-TESTING-GUIDE.zh-CN.md) 作为测试组织参考。

## 1. 适用边界

- 测试对象是 ArkWeb/WebView 内的 `src/web-ui` DOM，不是原生 ArkUI 控件本体。
- `data-testid` 只用于 WebView 内 DOM 定位；窗口生命周期、系统文件选择器、权限、更新、输入法等宿主能力必须单独记录原生验证证据。
- `src/apps/ohos` 是平台宿主，不因 UI 测试新造第二套 Web UI 或产品逻辑。
- 坐标、截图、OCR、XPath、CSS class、本地化文案都不是稳定主定位方式。
- HarmonyOS PC 原生 CLI/TUI 是独立产品形态，不适用本文的 WebView ID 规则。

## 2. 短测定位

短测只验证一条可发布链路是否存活，不追求全量功能回归：

1. 应用能启动，WebView 加载共享 UI；
2. Shell 和导航可用；
3. Welcome、Settings、Session/Chat 的核心入口可用；
4. Agents/Skills 高频入口和空/加载/错误状态可用；
5. 宿主不支持的能力显式降级，不伪装成功。

任何一项失败时，先记录当前 UI ID、宿主版本、WebView 版本、网络/模型/工作区状态，再判断是测试环境问题、Web UI 回归还是 OHOS 宿主能力缺失。

## 3. Test ID 契约

### 使用现有 ID

优先使用 [UI Test IDs](ui-testids-CN.md) 中已登记的值。短测必须覆盖的 ID 如下：

| 领域 | 主锚点 | 交互锚点 |
|---|---|---|
| App Shell | `app-layout`、`app-main-content`、`scene-viewport` | `scene-viewport-scene[data-scene-active="true"]` |
| Welcome | `welcome-scene` | `welcome-open-project-btn`、`welcome-new-project-btn`、`welcome-recent-workspace-row` |
| Navigation | `nav-panel`、`nav-sections` | `nav-search-trigger`、`nav-assistant-btn`、`agent-skill-entry`、`nav-footer-settings-item` |
| Workspaces/Sessions | `nav-workspace-list`、`nav-session-list` | `nav-workspace-item`、`nav-session-item`、`nav-new-code-session-btn` |
| Settings | `settings-scene`、`settings-nav` | `settings-nav-tab`、`settings-model-list` |
| Appearance | `appearance-config` | `appearance-language-select`、`appearance-language-option`、`appearance-theme-select`、`appearance-palette-option` |
| Session/Chat | `session-scene`、`session-chat-pane`、`flowchat-container`、`flowchat-message-list` | `chat-input-textarea`、`chat-input-send-btn`、`chat-input-cancel-btn`、`chat-user-message`、`chat-assistant-message` |
| Model 选择 | `chat-model-selector-btn` | `chat-model-selector-menu`、`chat-model-selector-option`、`chat-model-selector-back` |
| Notifications | `notification-center` | `notification-button`、`notification-center-close-btn`、`notification-center-active-section` |
| Agents | `agent-list`、`agent-detail-panel` | `agent-tab`、`agent-list-item`、`agents-search-btn` |
| Skills | `skills-installed-panel`、`skills-discover-panel` | `skill-tab`、`skills-installed-card`、`skills-discover-search`、`skills-market-card` |

### 新增 ID 规则

1. 先确认现有文档没有等价锚点；确有自动化需要才新增。
2. `data-testid` 保持小写、连字符分隔、语义稳定，例如 `area-element` 或 `area-action`。
3. 重复列表使用共享 ID，并用稳定产品属性区分：`data-workspace-id`、`data-session-id`、`data-agent-id`、`data-skill-key`、`data-skill-install-id` 等。
4. 不给装饰元素、每个文本节点、生成内容、i18n 文案、静态 label 打 ID。
5. 不让产品逻辑读取或分支 `data-testid`；它只属于测试和诊断。
6. 新增、删除或改名 `data-testid` 时，同一变更必须同步更新 `docs/development/ui-testids.md` 和 `ui-testids-CN.md`，并在 PR 中说明影响面。
7. ID 变更视为兼容契约变更。已发布的自动化分支可能仍在使用旧 ID，除非确认无消费者，否则先双写过渡，不要直接改名。

## 4. 建议短测用例点

### P0：启动与 Shell

| 用例 | 步骤 | 断言 | 主要 ID |
|---|---|---|---|
| 冷启动 | 安装 HAP 后冷启动，等待 WebView 首帧 | `app-layout` 可见，`app-main-content` 存在，无宿主错误页或 WebView 白屏 | `app-layout`、`app-main-content` |
| 场景容器就绪 | 读取当前激活场景 | `scene-viewport` 可见；有场景时激活 wrapper 的 `data-scene-active="true"` | `scene-viewport`、`scene-viewport-scene` |
| 导航就绪 | 展开左侧导航 | `nav-panel` 可见，`nav-sections` 存在 | `nav-panel`、`nav-sections` |

### P1：Welcome 与导航

| 用例 | 步骤 | 断言 | 主要 ID |
|---|---|---|---|
| 默认欢迎页 | 清理状态后冷启动 | `welcome-scene` 可见；无最近工作区时存在 `welcome-recent-workspace-empty` | `welcome-scene`、`welcome-recent-workspace-empty` |
| 最近工作区 | 准备一个已存在的工作区并回到 Welcome | `welcome-recent-workspace-row` 可见，配合 `data-workspace-id` 断言目标行；点击后进入对应场景 | `welcome-recent-workspace-row`、`welcome-recent-workspace-open` |
| 打开系统选择器 | 点击打开项目 | ArkTS 宿主收到请求；选择器可打开/取消，取消后 UI 无崩溃 | `welcome-open-project-btn` |
| 新建项目入口 | 点击新建项目 | 新建流程或明确的 unsupported 状态出现，不产生静默失败 | `welcome-new-project-btn` |
| 新 Code 会话 | 准备活动项目工作区后点击新建 | `session-scene`、`session-chat-pane`、`chat-input-textarea` 可见 | `nav-new-code-session-btn`、`session-scene`、`chat-input-textarea` |

### P1：Settings 与外观

| 用例 | 步骤 | 断言 | 主要 ID |
|---|---|---|---|
| 打开 Settings | 从底部导航打开设置 | `settings-scene`、`settings-nav` 可见 | `nav-footer-settings-item`、`settings-scene`、`settings-nav` |
| Tab 切换 | 逐个点击可用的导航 tab | 激活 tab 状态变化，内容区不残留上一个面板 | `settings-nav-tab` |
| 外观主题 | 打开主题选择并切换主题 | `appearance-theme-select` 可用，选中 palette 后 UI 颜色语义变化 | `appearance-theme-select`、`appearance-palette-option` |
| 语言切换 | 切换界面语言 | 文案变化，`data-testid` 不随 locale 变化 | `appearance-language-select`、`appearance-language-option` |

### P1：Session 与 Chat

| 用例 | 步骤 | 断言 | 主要 ID |
|---|---|---|---|
| 会话列表 | 展开工作区会话 | `nav-session-list` 可见，`nav-session-item` 携带 `data-session-id` 和激活状态 | `nav-session-list`、`nav-session-item` |
| 输入和发送 | 输入短文本并发送 | 用户消息出现；无网络/模型时取消或错误状态明确，不悬挂在发送中 | `chat-input-textarea`、`chat-input-send-btn`、`chat-user-message` |
| 中断 | 在可中断轮次中点击取消 | 取消按钮消失或中断恢复入口出现，输入框可再次编辑 | `chat-input-cancel-btn`、`chat-input-continue-interrupted-btn` |
| 模型菜单 | 打开模型选择 | 菜单出现；选择或返回不关闭 Session | `chat-model-selector-btn`、`chat-model-selector-menu`、`chat-model-selector-back` |
| 消息区域 | 完成一次短回复或注入 mock turn | `flowchat-message-list` 有内容，消息项可定位 | `flowchat-message-list`、`flowchat-message-item` |

### P2：Agents、Skills 和通知

| 用例 | 步骤 | 断言 | 主要 ID |
|---|---|---|---|
| Agent 列表 | 打开 Agents 发现页 | `agent-list` 可见；列表/空/加载/错误状态只出现一种主状态 | `agent-tab`、`agent-list`、`agent-list-item`、`agent-list-empty` |
| Agent 详情 | 点击一个 agent | `agent-detail-panel` 打开且关闭后回到列表 | `agent-list-item`、`agent-detail-panel`、`agent-detail-close` |
| Skill 已安装区 | 打开 Skills | `skills-installed-panel` 可见；空态或卡片可定位 | `skill-tab`、`skills-installed-panel`、`skills-installed-card`、`skills-installed-empty` |
| Skill 搜索 | 在 Discover 输入关键字 | 结果区出现；空结果不崩溃 | `skills-discover-search`、`skills-discover-grid`、`skills-discover-empty` |
| 通知中心 | 打开和关闭通知中心 | `notification-center` 可见并可关闭 | `notification-button`、`notification-center`、`notification-center-close-btn` |

## 5. 执行与证据

### 环境

1. 在桌面环境先通过 `pnpm --dir src/web-ui run type-check` 和 `pnpm run build:web` 排除普通 Web 回归。
2. 运行 `pnpm run harmony:architecture` 检查鸿蒙边界没有回退。
3. 将共享 Web 构建产物接入当前 OHOS HAP 构建，使用目标真机或模拟器，不要用普通浏览器成功替代 WebView 成功。
4. 记录设备型号、系统版本、HAP 版本、WebView 版本、网络条件、账号/模型可用性和工作区准备方式。

### 失败取证

失败时至少保留：

- 失败用例名、期望 ID、实际 DOM 快照或页面标题；
- WebView console/日志中英文错误；
- ArkTS 宿主日志中命令、结果码和耗时；
- 是否有权限弹窗、系统选择器、离线、模型不可用等外部条件。

不要在公共仓库提交配对 URL、账号 ID、token、完整模型回复或包含敏感路径的截图。

### 通过标准

- P0 全部通过；
- P1 中与本次验证目标相关的用例全部通过；
- 宿主能力缺失时表现为明确 unsupported、禁用或错误态，而不是白屏、无限 loading、假成功或本地 fallback；
- 重启或断网后，会话、工作区、设置与通知入口不会进入不可恢复状态；
- 所有断言只依赖已登记或本 PR 已同步登记的 `data-testid` 与稳定 `data-*`。

## 6. 补 ID 的工作流

1. 写下用例和最小区别条件，先检查现有 Page Object 是否已封装该元素。
2. 从 [UI Test IDs](ui-testids-CN.md) 选择 ID；没有则提出最小新增。
3. 在 React 组件上添加 `data-testid`，在配套属性中携带稳定业务 ID。
4. 同步更新中英文 ID 清单，避免自动化和文档漂移。
5. 用 Web E2E 或单元测试验证选择器；能不上传环境截图就不要上传截图。
6. 在 HarmonyOS WebView 真机/模拟器复验一次，记录设备与系统版本。
7. 对旧 ID 使用者做影响面检查；必要时保留兼容 ID 并说明移除条件。


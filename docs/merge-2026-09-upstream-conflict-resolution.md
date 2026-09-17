# 冲突解决报告 — merge upstream/main (57ceb3e3c) into wc/2.0.0

- **Merge 对象**：`57ceb3e3c Merge pull request #2924 from kev1n77/fmy/ui-main`
- **冲突文件总数**：22 个，35 个冲突块
- **解决结果**：全部手动解决，`pnpm run type-check:web` 通过（0 error），merge 已提交为 `059c72631`
- **解决总原则**：上游 PR #2924 (fmy/ui-main) 是设计系统主线演进（SearchField/Input focus 契约重构、
  NavigationPanelItem 组件化、交互能力目录按工作区搜索可用性降级、SkillsScene 分页/骨架屏），
  以**采纳上游新功能**为默认；**wc 侧 OHOS 专属适配**（`target_env="ohos"`、host chrome 占位、
  matrix 市场、market_install_id）**必须保留**；wc 侧上轮已将 Select 改为原生 `<select>`，
  因此**所有依赖自绘 popover 的上游样式/状态一律丢弃**。

---

## 1. design-system/packages/ui/src/components/Select/Select.module.css（2 块）

背景：wc 侧上一轮已将 Select 从自绘 combobox 重写为原生 `<select>`（root span + select + indicator 的
inline-grid 布局）。上游在本文件继续演进**自绘版**样式。

| 冲突块 | ours | theirs | 决策 |
|---|---|---|---|
| `.leading/.indicator` 属性 | `z-index:1; grid-area:1/1`（grid 叠放，原生布局必需） | `--bitfun-opacity-icon-artwork:1` | **融合**：两者都保留。上游同时把颜色从 `content-muted` 改为 `color-field-placeholder`（token 语义化，light.tokens.json:184 有定义），已随自动合并生效 |
| `.value/.placeholder/.popoverHeader/.popover` + 两个 popover keyframes | （空） | 自绘 trigger 文本类 + 整个 popover 面板样式 + 弹出动画 | **保留 ours（删除）**：原生 select 的下拉由系统渲染，DOM 中不存在这些类 |
| 同上延伸至 `>>>>>>>`（136–280 行整段） | （空） | 自绘版专属样式续 | 同上，整段删除 |

验证：解决后文件 153 行，无 `Listbox`/`popover` 残留；`--bitfun-color-field-placeholder` 在
theme 中有定义。

## 2. design-system/apps/design-lab/src/pages/ComponentDetailPage.tsx（1 块）

Design Lab 组件详情页的 states 映射表：

- ours：`case "Input": case "SearchField":` 落空（无 return，fall through）
- theirs：新增 `return ["default","filled","hover","focus-visible","read-only","invalid","disabled"]`

**决策**：取 theirs —— 上游为 Input/SearchField 新增了状态预览列表，ours 无对应改动。

## 3. design-system/apps/design-lab/vite/component-detail-contract.test.mjs（1 块）

配套契约测试，断言 ComponentDetailPage 中 states 映射的形状：

- ours 断言旧合并形态（Input/SearchField/Select 共用一组 states）
- theirs 断言拆分后的新形态，但其中 Select 断言**含 `"open"` 状态**——wc 已改原生 select，无 open 弹出态

**决策（融合）**：采纳 theirs 的 Input/SearchField 断言（新 filled 列表）；**Select 的断言改用 ours
实际值** `["default","hover","focus-visible","invalid","disabled"]`（去掉 `"open"`），与文件 2 的实际
代码保持一致。

## 4. design-system/packages/theme-bitfun/src/light.tokens.json（1 块）

light 主题 `field.border / borderHover / borderFocus` 的取值冲突：

| token | base | ours | theirs |
|---|---|---|---|
| border | rgba(16,26,39,0.15) | 同 base | **rgba(0,0,0,0.08)** |
| borderHover | rgba(16,26,39,0.24) | 同 base | **rgba(0,0,0,0.20)** |
| borderFocus | {ref.color.neutral.550} | **{ref.color.navy.950}** | {ref.color.neutral.550} |

两边改了**不同字段**：ours 只改了 borderFocus（换成 navy.950 深色聚焦），theirs 只改了
border/borderHover（中性化调色）。

**决策（融合）**：border/borderHover 取 theirs（上游调色），borderFocus 取 ours（wc 侧的聚焦色
决策，不影响上游改动）。

## 5. design-system/packages/ui/tests/search-field.test.mjs（1 块）

SearchField focus 契约测试：

- ours：断言旧契约（`border-color: content-primary`，选择器 `.root .field:not([data-invalid])...`）
- theirs：完全重写（`border-active` token、default/panel 双 variant 断言、Input focus 契约分离）

配套的 SearchField.module.css / Input.module.css 均已按上游自动合并，测试必须与新实现匹配。

**决策**：取 theirs 整个测试函数。

## 6. src/apps/desktop/src/api/commands.rs（1 块，Windows reveal file）

- ours：`explorer /select,` + 路径（走 `process_manager::create_command`）
- theirs：改用 `tauri_plugin_opener::reveal_item_in_dir(path)`，注释说明 `/select` 的空格路径
  argv 引号 bug（Command 会把整个 switch+path 引成一个参数导致选中失败）

**决策**：取 theirs。上游修复了真实 bug（explorer 引号问题），`reveal_item_in_dir` 使用 Shell
item IDs 避开命令行引号问题；该插件是桌面端既有依赖。OHOS 分支在冲突块之前已提前 return，
不影响鸿蒙。

## 7. src/apps/desktop/src/appearance.rs（3 块）⚠️ 本轮最复杂的融合

### 冲突 1：main window 的 dev URL 决策
- ours：`cfg!(debug_assertions)` + 硬编码 `http://localhost:1422`
- theirs：`use_development_frontend()` + `app_url(app_handle, "")`（从 tauri config 的
  `build.devUrl` 读取，不再硬编码；并修复了 debug 构建下 E2E 打包模式误指向 dev server 的 bug）

**决策**：取 theirs。

### 冲突 2：`app_url` 函数定义
- ours：`fn app_url(path: &str)`（无 AppHandle 参数、硬编码 URL）
- theirs：新增 `fn development_frontend_url(dev_url, path)` + `fn app_url(app, path)`（读
  config、错误回退 App URL）

**决策**：取 theirs。

### 冲突 3：agent-companion 窗口的 `app_url` 调用
- 两边都是同一调用，仅签名与缩进不同

**决策**：取 theirs（`app_url(&app, "?bitfunWindow=agent-companion")`）。

### 关键补救
上游引入的 `fn use_development_frontend()` 定义位于 tests 模块与 `create_main_window` 之间，
该区域被 ours 的大改覆盖导致**定义丢失而调用被合并**（会出现“只有引用没有定义”的断裂）。
已手工补插原定义（debug 下默认 true、`BITFUN_E2E_PACKAGED_FRONTEND` +
`BITFUN_E2E_STORAGE_GUARD` 双变量时 false；release 下 false）。

## 8. src/apps/desktop/src/generated/bootstrap_theme.css（1 块）

生成文件（bootstrap 主题 CSS）。上游新增 `--bitfun-color-field-border-active` token 并把
`border-focus` 从 `#60a5fa` 改为 `#858585`。

**决策**：取 theirs（与已合并的 tokens 源一致）；下次构建时生成器会再校正。

## 9. src/crates/assembly/core/.../skills/registry.rs + registry/discovery.rs（1 块）⚠️

上游将 `scan_skills_in_dir` / `scan_skills_in_dir_with_status` 的实现**拆分到新文件
`skills/registry/discovery.rs`**（registry.rs 仅保留 `mod discovery;` 声明与调用）。ours 侧在
同区域没有独立改动（diff 确认），但 **ours 在旧 scan 实现中有一段 wc 独有逻辑**：

```rust
// 读 .market-source 标记文件 → 填充 skill_data.market_install_id（matrix 市场溯源）
if let Ok(market_source) = fs::read_to_string(path.join(".market-source")).await { ... }
```

**决策**：
1. registry.rs 冲突区取 theirs（旧定义移除）
2. `mod discovery;` 声明确认存在（checkout theirs 后自动带出）
3. **将 market-source 逻辑移植到 discovery.rs** 的 `scan_skills_in_dir` 主循环中
   `apply_local_openai_policy` 之后、`SkillCandidate::from_data` 之前（与旧行为等价：
   读 `<skill>/.market-source` → 填 `market_install_id`）

## 10. src/crates/execution/agent-runtime/src/skills/types.rs（2 块）

`SkillCandidate` / `SkillData` 两个 struct 的字段冲突：

- ours：新增 `market_install_id: Option<String>`（matrix 市场溯源）
- theirs：新增 `compatibility_warnings: Vec<String>`（SKILL.md 兼容性警告，配套
  discovery.rs 中的诊断输出）

**决策（融合，两个都保留）**：struct 定义与构造处均同时保留两个字段；构造处
`market_install_id: None`、`compatibility_warnings`（由解析逻辑填充）。

## 11. src/crates/services/services-integrations/src/remote_ssh/remote_exec.rs（1 块）

本地 workspace PTY 的 shell 类型与尺寸：

- ours：`ShellType::Custom("Docker")` 硬编码 + 固定 80×24
- theirs：`shell_type` 按 executable 判断（wsl.exe → "WSL"，否则 "Docker"）+
  `EXEC_TERMINAL_SIZE` 常量；错误信息改为 "local workspace PTY"

**决策**：取 theirs 的 shell_type 判断与尺寸常量（配套上游 WSL 功能，`super::wsl::EXECUTABLE`
已合并）；**保留 ours 的函数名** `spawn_local_container_pty_process` 与调用点（上游同名重构
`spawn_local_workspace_pty_process` 未采纳，避免牵连调用链）。

## 12. src/web-ui/src/app/components/NewProjectDialog/NewProjectDialog.tsx（1 块）

- ours：手写 footer div + onClick 提交 + 图标按钮
- theirs：`<form id={formId}>` + `DialogFooter` + `type="submit" form={formId}` 表单语义化提交

确认 ours 相对 base 的 210 行改动中**无 OHOS 内容**。**决策**：整个文件取 theirs（规范化重构）。

## 13. src/web-ui/src/app/global-search/generated/interactive-capabilities.json（2 块）

生成文件（digest + 统计数字）。catalog 源（src/shared/interactive-capabilities/catalog.json）
已自动合并为上游版本（+43 行）。

**决策**：两块都取 theirs（digest `409e6d…`、documentedItems 322、interactive 213），
与源文件一致。

## 14. src/web-ui/src/app/global-search/interactiveCapabilityCatalog.ts（1 块）

- ours：简单导出 `INTERACTIVE_CAPABILITY_CATALOG`
- theirs：新增 `getInteractiveCapabilityCatalog(workspaceSearchAvailable)` 工厂——工作区搜索
  不可用时从目录中过滤 accelerated-search / search-index / workspace-search 条目

**决策**：取 theirs；并**补上丢失的 import** `WORKSPACE_SEARCH_AVAILABLE`（来自
`@/infrastructure/config/workspaceSearchAvailability`，文件存在）。

## 15. .../providers/interactiveCapabilitySearchProvider.test.ts（1 块）

上游新增 2 个测试（catalog 恢复 accelerated-search；远程工作区隐藏 Flashgrep 条目），与 14 的
工厂逻辑配套。**取 theirs**。

## 16. src/web-ui/src/app/scenes/session/AuxPane.tsx（1 块）

agent canvas 工作区快照同步：

- ours：`syncAgentCanvasWorkspace` 依赖 `[syncSessionOwnedBrowserTabs, workspaceId]`，
  并**额外订阅 flowChatStore 的 activeSessionId**（会话切换同步，wc 增强）
- theirs：依赖 `[]` + 简单 workspaceId effect（无会话级订阅）

**决策**：取 ours（保留 wc 的会话订阅增强；callback 闭包需要该依赖数组）。

## 17. src/web-ui/src/app/scenes/skills/SkillsScene.tsx（6 块）⚠️ 结构最复杂

上游对 SkillsScene 做了组件化重构；wc 侧有 matrix 市场功能。逐块决策：

| 块 | 内容 | 决策 |
|---|---|---|
| GalleryPageHeader | ours 简单标题 vs theirs 带 "添加技能" actions 按钮 | **取 theirs**（toggleAddForm 依赖已存在） |
| sidebar nav 循环 | ours `CATEGORIES` vs theirs `installedCategories` + `?? 0` 兜底 + aria-label | **取 theirs**（变量已存在） |
| sidebar item 结构 | ours 手写 button（含 wc 的 `—` 破折号修复）vs theirs `NavigationPanelItem` 组件 | **取 theirs**（组件化），并补 import NavigationPanelItem、useI18n 的 formatNumber |
| 卡片 name | ours 纯文本 vs theirs `OverflowText behavior="marquee"` | **取 theirs** |
| status-badges 区 | 两边相似导致 git 错位对齐，出现重复的 globallyDisabled/shadowed pill | **取 ours 结构**（避免重复渲染；上游侧是错位副本） |
| level 行 | ours `<FolderOpen size={12}/>` + `<span>` vs theirs `<Icon glyph={FolderOpen}/>` + `<OverflowText>` | **取 theirs**（配合上游 Icon glyph 与 marquee） |

后续修复的连带结构错误（tsc 发现）：
1. sidebar 外层 `<button>` 与内层 `NavigationPanelItem` 错配 → 按上游改为 `<div className="skills-sidebar__item">`
2. shadowed StatusPill 重复渲染 → 删除重复
3. `</span>`/`</OverflowText>` 闭合标签不匹配 → 修正
4. 补齐 import：`NavigationPanelItem`、`OverflowText`（@bitfun/ui）；`formatNumber`（
   经验证 `useTranslation` 不提供，改从 `useI18n('components')` 解构）

## 18. src/web-ui/src/app/scenes/skills/hooks/useInstalledSkills.ts（1 块）

import 并集：ours 的 `workspaceAPI`（体内 2 处调用）+ theirs 的
`SkillScanDiagnostic` / `getSkillSourceId` / `getSkillSourceLabel`（体内均有使用）。

**决策**：取并集——保留 workspaceAPI + 采纳上游新类型与函数。

## 19. .../modern/FLOWCHAT_VIRTUALIZATION.md（1 块）

纯文档：上游新增"用户消息字体角色"与"时间戳/操作行"两段虚拟化契约说明。**取 theirs**。

## 20. src/web-ui/src/infrastructure/api/generated/productControl.ts（1 块）

生成文件的 digest 冲突。catalog 源已合并为上游版本，**取 theirs**
（`409e6dbef7eb...`，与 interactive-capabilities.json 一致）。

## 21. src/web-ui/src/infrastructure/config/components/RuntimeSettingsPages.tsx（2 块）

- import 块：上游新增 `DefaultHarnessConfig` / `useCurrentWorkspace` / `isRemoteWorkspace` /
  `WORKSPACE_SEARCH_AVAILABLE` —— **取 theirs**
- session-workspace 页：ours 无条件搜索区块 vs theirs `DefaultHarnessConfig` + 条件化搜索
  （`WORKSPACE_SEARCH_AVAILABLE && !isRemoteWorkspace(workspace)`）—— **取 theirs**

## 22. src/web-ui/src/tools/file-explorer/search/useWorkspaceSearchIndex.ts（1 块）

上游引入 `isRemote` 选项并使 `enabled = WORKSPACE_SEARCH_AVAILABLE && !isRemote &&
requestedEnabled`（远程工作区禁用搜索，与 catalog 降级逻辑呼应）。

**决策**：取 theirs，并**补上丢失的 import** `WORKSPACE_SEARCH_AVAILABLE`。

---

## 验证

| 检查 | 结果 |
|---|---|
| `git diff --name-only --diff-filter=U` | 0 |
| 全仓冲突标记（`<<<<<<<`/`=======`/`>>>>>>>`）扫描 | 0 |
| `pnpm run type-check:web`（含 design-system build） | **通过**（0 error TS） |

## 遗留提示

1. **SkillsConfig.tsx** 的 `NavigationPanelItem` import 若实际未被使用，下一次 lint 会提示
   （本轮已按 type-check 结果修正为不引入）。
2. `@xterm/headless` 依赖曾缺失（backgroundTerminalReplay.ts 需要），已通过
   `pnpm install --frozen-lockfile` 补齐；若 CI 仍报缺失请确认 lockfile。
3. `bootstrap_theme.css` 为生成文件，下次执行主题生成脚本时会被自动校正。

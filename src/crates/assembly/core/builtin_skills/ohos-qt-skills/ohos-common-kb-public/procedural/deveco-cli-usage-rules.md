---
id: deveco-cli-usage-rules
title: deveco-cli (devecocli) 使用规则
status: active
confidence: 0.9
sources:
  - type: official
    name: "deveco-cli 仓库 AGENTS.md / SKILL.md"
    date: 2026-08-03
    uri: "https://gitcode.com/openharmony-sig/deveco-cli"
  - type: experience
    name: "NeoHtop 真机部署 2026-08-03（signature generate 首测）"
    date: 2026-08-03
  - type: experience
    name: "open-pencil 真机部署 2026-08-06（signature generate 复测）"
    date: 2026-08-06
created: 2026-08-03
updated: 2026-08-15
last_confirmed: 2026-08-06
superseded_by: null
tags: [deveco-cli, devecocli, toolchain, golden-rules, ohos-common]
refs: [deveco-mcp-capabilities]
summary: "devecocli 优先入口、底层 DevEco CLI 能力边界与 headless 诊断；封装未覆盖或诊断封装本身时允许可审计的最小底层调用。"
audience: public
---

# deveco-cli (devecocli) 使用规则

> `devecocli` 封装 DevEco Studio 工具链（`ohpm`/`hvigor`/`hdc`/`emulator`/`hilog` + bundled node/JBR/SDK）+ HarmonyOS skills 安装器 + 项目脚手架模板，统一在单一二进制下。源：[openharmony-sig/deveco-cli](https://gitcode.com/openharmony-sig/deveco-cli)。

## Why:

devecocli 把 DevEco 工具链封装为单一入口，可统一签名解析、产物定位和错误归因。直接调用 hdc/hvigor/ohpm 仍是有效的底层能力，但应限于封装未覆盖的动作、维护封装或构造最小诊断复现。本页描述本知识生态的工具选择策略，不把它误写成 HarmonyOS 平台 invariant。

## How to apply:

workspace 有 `build-profile.json5`/`oh-package.json5` 时，优先按「能力→场景映射表」选 devecocli 命令。若封装没有对应能力或正在诊断封装层，可使用最小底层调用，并在操作记录中说明原因和回归到 devecocli 的验证结果。改完 `.ets`/`.ts`/`.cpp` 后，在当前 MCP server 已安装且支持时运行 `deveco-mcp check`；LSP 卡死用 `deveco-mcp restart`。详见 [[deveco-mcp-capabilities]]。

## 使用策略

| 严重度 | 规则 | 为什么 |
|---|---|---|
| 默认 | workspace 有 `build-profile.json5`/`oh-package.json5` 且 devecocli 已覆盖目标能力时，优先使用封装命令。 | 封装可统一签名、产物和错误归因；这是工具生态策略，不是平台限制。 |
| 例外 | devecocli 未覆盖目标动作，或正在维护/诊断封装层时，可最小化调用 `hdc`/`hvigor`/`ohpm`/`emulator`；记录原因，完成后回到封装做端到端验证。 | 保留底层可诊断性，同时避免把临时绕行扩散为默认流程。 |
| 质量门 | 当前环境已安装 deveco-mcp 且目标文件受其支持时，AI 修改 `.ets`/`.ts`/`.cpp` 后运行 `deveco-mcp check`；MCP 不可用时使用项目既有编译/lint/typecheck 门禁，不得把“缺少 MCP”误判为代码失败。 | 静态 diagnostics 能缩短反馈链，但工具可用性与代码正确性是两件事。见 [[deveco-mcp-capabilities]]。 |
| 行为异常 | 调试迭代时，小改优先 `devecocli run --apply`（增量部署）或 `--hotreload`（热重载），不每次全量 `run`。 | 全量 build+install+launch 耗时长；增量只重建改动文件→`bm quickfix` 安装→重启，或热重载不重启应用。 |
| 行为异常 | `--hotreload` 仅对**非状态代码**生效（UI 属性值/文字/方法体/表达式）；`@State` 装饰器/native/资源/feature-hsp 依赖变更必须全量 `run`。 | 热重载不重新初始化状态；native/资源/依赖模块变更热重载无法覆盖。 |
| 行为异常 | deveco-mcp 进 ERROR/卡死时用 `deveco-mcp restart`（target=arkts/cpp/all），不重启 IDE。 | restart 原地重同步项目 + 重初始化 LSP；重启 IDE 成本高且丢会话。 |

## 能力 → 调试调测场景映射

| 场景 | 命令 | 替代的底层操作 |
|---|---|---|
| 新建鸿蒙工程 | `devecocli create --app-name <n> --bundle-name <b> --api-level <l>` | 手拼模板 |
| 签名配置 | `devecocli auth login` → `devecocli signature generate --product <p>`（自动生成 p12/csr/cer/profile + 写入 `build-profile.json5` signingConfigs + 关联 product.signingConfig；材料存 `~/.ohos/config/`） | DevEco Studio GUI 自动签名（Project Structure → Signing Configs → Automatically generate signature）|
| 编译构建 | `devecocli build [--modules ...] [--product ...] [--build-mode debug\|release]` | 裸 hvigor/ohpm |
| 安装运行 | `devecocli run [--module ...] [--device ...]` | 裸 hdc install + aa start |
| 增量部署 | `devecocli run --apply <fileName>` | 每次全量 run |
| 热重载 | 后台 `devecocli run --module <m> --hotreload` → `devecocli run --module <m> --hotreload-apply <file>` → 结束 kill + `--hotreload stop` | 每次全量 run |
| 设备查询 | `devecocli device list` / `device view -t <name\|serial>` | hdc list targets |
| 模拟器 | `devecocli emulator list/start/stop/create/delete/image` | 裸 emulator 二进制 |
| UI 布局诊断 | `devecocli ui layout [--id ...] [--depth ...] [--format json]` | 手写 hdc snapshot |
| 截图 | `devecocli ui screenshot --path <png>` | hdc snapshot_display + file recv |
| UI 交互自动化 | `devecocli ui click/swipe/text/longclick/drag ...` | 手写 hdc input |
| 窗口列表 | `devecocli ui window list` | hdc dumpsys window |
| 运行日志 | `devecocli log [--level ...] [--bundle-name ...] [--keyword ...] [--from 5m] [--tail N] [--follow]` | hdc shell hilog |
| 崩溃分析 | `devecocli log --crash --bundle-name <b>` | 手找 crash 文件 |
| 代码规范 | `devecocli check lint [--fix] [--format json]` | 裸 codelinter |
| API 兼容性（升 SDK） | `devecocli check compat --source-version <v> --target-version <v> [--output-path ./report]` | 无对标（仅 IDE 内） |
| 文档检索 | `devecocli docs search <kw>` / `docs read <id>` / `docs catalog` | 仅在线搜索 |

## 常用 Recipes

- **全新 checkout 到模拟器**：`devecocli build` → `devecocli emulator list` → `devecocli emulator start "Name"` → `devecocli run`
- **诊断崩溃**：`devecocli log --crash --bundle-name <bundle>`
- **首次签名（全程 CLI，无需 DevEco Studio IDE）**：`devecocli auth login`（用户私有终端）→ `devecocli signature generate --product default`（生成 p12/csr/cer/profile + 写 `signingConfigs` + 关联 `product.signingConfig`，材料存 `~/.ohos/config/`）→ `devecocli build` → `devecocli run`。等价 GUI 的 "Automatically generate signature" 勾选，但可在 agent/脚本中无 GUI 完成。已由 NeoHtop（2026-08-03 首测）+ open-pencil（2026-08-06 复测）两次独立验证；框架特定陷阱（如 Tauri 的 daemon env 缓存 / `TAURI_OHOS_SKIP_DEVECO_SCRIPT`）见各领域 KB 部署流程页。
- **迭代调试 UI 属性**：`devecocli run`（首次）→ 改 `.fontColor` → 写 `.hvigor/changes.txt` → `devecocli run --hotreload-apply changes.txt`（UI 即时更新，不重启）

## 边界（devecocli 不替代）

- **Profiler 性能泳道分析**（内存/组件/网络/启动/卡顿）→ DevEco Studio Profiler 或 `hiperf` 命令行
- **AppAnalyzer 应用体检** → DevEco Studio AppAnalyzer
- **跨语言断点调试**（ArkTS&C++、汇编、反向调试）→ DevEco Studio 调试器或 `lldb`
- **增量调试的 IDE 集成** → DevEco Studio 增量调试（devecocli 的 `--apply`/`--hotreload` 是命令行等价物）

> 静态语法检查见 [[deveco-mcp-capabilities]]——deveco-mcp 是 `devecocli serve mcp` 的子能力，供 AI agent 做 ArkTS/C++ LSP 检查。

## 底层 DevEco CLI 能力边界

`devecocli` 是本生态的稳定操作入口，但排查封装层或维护构建脚本时仍需理解底层职责：

| 底层入口 | 职责 | 关键边界 |
|---|---|---|
| `devecostudio format/inspect` | 格式化、离线检查、打开工程 | 基于 IDE/IntelliJ 启动器，不负责编译；GUI 单实例锁可能阻止 headless 调用 |
| `hvigorw` | 列任务、clean、构建 HAP/HAR/HSP | Node 脚本；任务名应由 `tasks` 确认，自动化使用 `--no-daemon` |
| `ohpm` | 安装 HarmonyOS/OpenHarmony 工程依赖 | 只管包依赖，不编译应用 |
| `hdc` | 设备、安装、shell、文件和日志底层通道 | devecocli 已覆盖时优先用封装；未覆盖的 key/uitest/诊断动作可最小调用并记录原因 |
| `hap-sign-tool` | 独立 HAP 签名工具 | 不替代正确的 profile、bundleName 和 product signingConfig |
| `hnpcli` | HNP 原生软件包工具 | 只在明确采用 HNP 分发模型时使用 |

常见误判是把 `devecostudio` 启动器的命令行选项当成构建 CLI；真正的工程构建由 hvigor 执行。底层命令及选项随 DevEco Studio 版本变化，先运行目标安装版本的 `--help`/`tasks`，不要从旧版本页面猜任务名。

### 封装层故障的最小诊断

当 `devecocli` 报错指向底层工具、正在维护封装本身，或目标动作尚无封装命令时：

1. 用 `devecocli` 的详细日志确认失败阶段；
2. 核对 bundled Node/JBR/SDK 是否来自同一 DevEco 安装；
3. 对 hvigor 只执行 `tasks --no-daemon` 或等价的最小失败复现；
4. 检查 `NODE_HOME`、Java 可执行文件和工程路径，但不把本地绝对路径写入知识库；
5. 若属于未覆盖能力，记录底层命令的最小范围和退出条件；
6. 修复或操作完成后，回到 `devecocli build/run` 或项目既有端到端门禁验证。

`signingConfigs` 只有被目标 `products[].signingConfig` 引用时才参与构建；profile 还必须与应用身份及所需权限匹配。签名材料始终保留在本地安全位置，不进入命令日志、知识页或提交。

### `hvigorw` / `java` 找不到

若日志出现 `hvigorw not found`、`java not found` 或“`hvigorw` / `java` 找不到”，先确认当前终端是否使用 DevEco 配套的 JBR、Node 与 SDK。优先通过 `devecocli` 使用 bundled toolchain；诊断底层脚本时，检查 `JAVA_HOME`、`OHOS_HOME` 以及它们的可执行目录是否进入当前进程的 `PATH`，并用目标安装版本的最小 `hvigorw --help` 或 `tasks --no-daemon` 验证。不要把本机绝对路径固化到知识页或工程模板。

## 前提

- `devecocli` 在 PATH：`npm i -g @deveco-test/deveco-cli`
- 装 skill 到 AI agent：`devecocli init --skill`（或 `--mcp` 配置 deveco-mcp server）
- DevEco Studio ≥6.1.0（`--apply` 需 ≥6.1.1 支持 hvigor `assembleDevHqf`）
- zsh 下 `check compat` 的版本号需引号包裹

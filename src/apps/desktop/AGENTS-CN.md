**中文** | [English](AGENTS.md)

# AGENTS-CN.md

## 适用范围

本文件适用于 `src/apps/desktop`。仓库级规则请看顶层 `AGENTS.md`。

## 这里最重要的内容

`src/apps/desktop` 是 Tauri 宿主 / 集成层。

主要区域：

- `src/api/`：Tauri commands
- `src/api/peer_host_invoke.rs`：Peer Device Mode host-invoke bridge 与 control attach；
  允许/拒绝与能力来自 Product Operation Registry（`bitfun_product_domains::remote_surface`），
  不再有本地表
- `src/api/remote_workspace_policy.rs`：证明每个已注册 Tauri 命令在注册表中恰有一行的闭包测试
- `src/lib.rs`、`src/main.rs`：应用启动与装配
- `src/computer_use/`：操作系统相关自动化支持

Peer Device Mode 的所有权和边界见 `docs/architecture/peer-device-mode.md`。
前端防回归清单见 `src/web-ui/src/infrastructure/peer-device/README.md`。

BitFun 账号身份（GitHub 或邮箱验证码登录）统一由 `account_identity_api.rs` 提供；Relay 设备注册和生命周期位于
`src/api/remote_connect_api.rs`。设置留在所属设备，不再提供云端/本地同步选择。
Relay 部署向导已移除。保留 `src/apps/relay-server` 下供开发者使用的脚本和
[运维文档](../relay-server/README.md)，不要重新加入产品 UI。

如果改动影响多个运行时共享的行为，应把稳定契约、执行策略和服务放在各自的下层 owner
crate；`src/crates/assembly/core` 只保留产品装配与兼容桥接。

## 本模块规则

- 桌面端专属集成留在这里，不要下沉到共享 core
- 在 OHOS 目标上，主进程启动代码运行在没有进入 tokio runtime 上下文的主线程，
  裸 `tokio::spawn` 会 panic。启动/恢复装配路径必须用 `tauri::async_runtime::spawn`
  启动异步任务。
- 窗口 lifecycle 行为（包括 close/minimize-to-tray 默认值）属于桌面端 surface；修改时必须保留用户已保存偏好。
- `window_state_support` 负责主窗口布局校验，并沿用旧 `.window-state.json` 格式原子保存。
  不要同时注册 window-state 插件，其退出时写入的缓存可能覆盖修复结果。

### 鸿蒙（OHOS）适配保护

OHOS 产品目标由本目录与 `src/apps/ohos` 维护，上游仓库不包含它。合并
`upstream/main` 时必须保留鸿蒙侧实现，不能直接采用上游版本：

- `src/api/ohos/` 和 `src/apps/ohos/` 是 OHOS 专属目录。上游合并不会包含它们，
  不得删除或整体替换。`origin/release/2.0.x` 是鸿蒙参考发布线，合并丢失的内容
  从该分支恢复。
- 共享文件中的 `#[cfg(target_env = "ohos")]` / `#[cfg(not(target_env = "ohos"))]`
  分支必须保留。风险最高的区域是浏览器（`api/browser_api.rs`、
  `api/ohos/browser.rs`、`api/browser_control_api.rs`、`builtin_browser_host.rs`）、
  内置浏览器链路（`lib.rs` 中的 ArkWeb 宿主注册、
  `services-integrations/src/browser_control/arkweb_host.rs` 及其 `mod.rs` 门控、
  `src/apps/ohos/.../BrowserWebviewService.ets`）、隐私启动装配
  （`lib.rs` 中的 `PrivacyServiceState::enabled`）以及应用更新
  （`api/ohos/update.rs`、`check_for_updates_ohos`、`DailyAppUpdateGate.tsx`）。
- 应用内更新入口目前只在鸿蒙上开放。Windows 和 macOS 保留已实现的分阶段更新
  逻辑，但不得暴露任何更新按钮、菜单项、角标、通知或自动检查：
  `src/web-ui/src/infrastructure/update/tauriEnv.ts` 中的
  `canShowAppUpdateEntry()` 是唯一门控，必须保持
  `canCheckForAppUpdates() && isOpenHarmonyRuntime()`。没有明确的产品决定前，
  不要恢复桌面端更新入口。
- 内置浏览器在 OHOS 上有两条路径：展示走 `browser_webview_*` → ArkTS
  `BrowserWebviewService`；自动化走 `lib.rs` 中注册的 `ArkWebBrowserHost` /
  `HaitaiBrowserLaunchHost`。`arkweb_host.rs` 只有通过 `mod.rs` 的门控才会被编译，
  合并时若整体采用上游 `mod.rs`，它会变成孤儿文件而编译仍然通过。
- Skill 市场安装不得回退到 `npx -y skills add`。`skills` npm CLI 自带预编译 bun
  二进制，在 OHOS PC 上会崩溃，且鸿蒙沙箱禁止 `node_modules/.bin` 所需的符号链接。
  因此 `api/skill_api.rs` 的 `download_skill_market` 必须调用纯 Rust 实现
  `api/skill_market_downloader.rs`（`install_skill_from_market`，reqwest +
  flate2 + tar，并透传 AI 代理）。若合并时整体采用上游
  `download_skill_market`，npx 路径会静默回归，而原生下载器仍参与编译却无人调用；
  请保留原生调用及其代理装配。
- 固定的 Tauri fork 把 `target_env = "ohos"` 当作 mobile，因此
  `#[cfg(desktop)]` 窗口 API 在 OHOS 上不存在。必须保留
  `cfg(not(target_env = "ohos"))` 门控并提供 OHOS 分支，不能为了编译通过直接删掉
  该分支。
- 触碰这些文件的合并完成后，重新执行 `cargo tauri ohos build --debug`（或 OHOS
  目标检查）。

## 鸿蒙宿主集成

OHOS Rust 命令适配位于 `src/api/ohos`；ArkUI 窗口和 WebView 实现属于
[`src/apps/ohos`](../ohos/AGENTS.md)。合并上游时保留该项目内维护的 ability 模块和命令桥。
Tauri 窗口元数据存在，不代表鸿蒙支持桌面 window/WebView 插件接口；浏览器命令通过原生
label 定位 ArkTS 管理的页面。

构建 OHOS HAP 时，先完成最终桌面前端构建，再编译 Rust，最后把这次编译的原生库放入实际
组装项目。原生库内嵌 `build.frontendDist`；仅向 HAP 资源目录复制新文件不会更新它。
构建顺序与安装后资源版本核验见鸿蒙指南。

AppState 初始化可能在 Tauri 创建主 WebView 之前失败。先检查 early-startup 日志和启动
trace 阶段，再判断黑屏是否属于前端渲染问题。非 Windows 的 `show_fatal_startup_error`
当前只写 stderr，不能据此认为鸿蒙已经显示错误弹窗。保留持久化记录，按鸿蒙指南恢复数据。

## 命令

以下命令用于桌面开发循环；验证命令只在下方“验证”章节维护。

```bash
pnpm run desktop:dev
pnpm run desktop:preview:debug
pnpm run prepare:dsh-profile   # 可选：本地 DeepSeek Harness 会话
```

## 快速构建

| 命令 | 使用场景 |
|---|---|
| `pnpm run desktop:build:fast` | Debug 构建，不打包；手动测试时编译最快 |
| `pnpm run desktop:build:release-fast` | 类 Release 构建，降低 LTO；需要 release 行为但无法等待完整 LTO 时使用 |
| `pnpm run desktop:build:nsis:fast` | Windows 安装器，使用 `release-fast` profile；快速验证安装器 |

需要完整断点调试信息时设置 `CARGO_PROFILE_DEV_DEBUG=2`。默认 dev profile 保留行号信息，
同时减少 PDB 体积。

## Target 缓存 GC

`desktop:dev`（退出时）、`desktop:preview:debug`（关闭时）以及 `desktop:build*` 会裁剪过期的 `target/<profile>` 缓存代际。`incremental` 每个 crate/session 保留最新项；GC 根据 Cargo fingerprint JSON 区分 lib、test、bin、build-script 等构建单元，每个单元保留最新代际，并保留 Cargo 管理的 `invoked.timestamp` 在最近 24 小时内刷新过的全部代际，随后删除失去 fingerprint 的 `deps` 文件和 `build` 目录。忙碌检测只检查所选 profile 的 Cargo 锁文件，因此其他 worktree 的编译不会再阻止清理。手动执行：`pnpm run target:gc -- --profile debug`。禁用：`BITFUN_TARGET_GC=0`；演练：`BITFUN_TARGET_GC_DRY_RUN=1`；可用 `BITFUN_TARGET_GC_MIN_AGE_HOURS` 调整安全窗口。

`release-fast` profile（`Cargo.toml`）：继承 `release`，但关闭 LTO、`codegen-units` 提高到 16、启用增量编译。编译速度显著提升，代价是二进制体积增大和边际运行时性能下降。

## DevTools feature（模型规则）

`devtools` Cargo feature 用于桌面端 UI/UX 调试。添加或修改调试相关代码时：

- 所有调试专用 API 和 command 必须用 `#[cfg(any(debug_assertions, feature = "devtools"))]` 保护
- 在 `#[cfg(not(any(debug_assertions, feature = "devtools")))]` 下提供 no-op stub，确保 command 始终可以注册到 `invoke_handler`
- 该 feature 通过 `--features devtools` 在 `dev` 构建和 `release-fast` profile 构建中自动启用
- 面向最终用户的 `release` profile 构建中永不启用

## 验证

```bash
cargo check -p bitfun-desktop && cargo test -p bitfun-desktop
```

窗口布局恢复、旧状态兼容和快照保存使用：

```bash
cargo test -p bitfun-desktop --lib window_state_support::tests
pnpm --dir src/web-ui run test:run src/app/startup/startupPerformanceContract.test.ts
```

macOS 浏览器空 URL 和原生导航失败使用
[`third_party/wry/BITFUN-PATCH.md`](../../../third_party/wry/BITFUN-PATCH.md)
中的 `wkwebview_url` 原生回归测试，并运行下方 Desktop 构建。测试覆盖原生 URL
读取、页面加载回调、导航失败和手动导航恢复，不覆盖远程主机。panic hook 返回不代表捕获了 panic，日志不能宣称恢复成功。

如果改动影响启动、WebDriver、browser/computer-use 或打包行为，还需要运行：

```bash
cargo build -p bitfun-desktop
```

# OpenBitFun 存储路径清单

本文记录 OpenBitFun 当前各产品表面的存储路径、数据边界和路径覆盖规则。内容以本仓库当前实现为准。当前 HarmonyOS PC 定制构建的主路径恢复为应用沙箱路径；与上游 `D:\workspace\wc\github\OpenBitFun` 的 `main` 分支存在明确的平台差异。

本文中的“路径”分为两类：

- **物理路径**：由操作系统、Tauri、浏览器或 HarmonyOS 分配的真实目录。
- **逻辑路径**：OpenBitFun 在其数据根下定义的稳定目录和文件名，例如 `projects/<workspace-slug>/sessions`。

除特别说明外，下面的路径均为模板，不代表某个用户机器上的固定绝对路径。

## 1. 统一路径模型

桌面和 CLI 的主路径由 [`PathManager`](../../src/crates/assembly/core/src/infrastructure/app_paths/path_manager.rs) 提供：

| 符号 | 默认值 | 作用 | 覆盖变量 |
| --- | --- | --- | --- |
| `U` | `/data/storage/el2/base/files/openbitfun` | 用户配置、缓存、模型、日志、临时文件 | 当前实现不覆盖 |
| `H` | `dirs::home_dir()/.openbitfun` | 助手工作区、跨工作区运行时、远程镜像、派发任务 | `OPENBITFUN_HOME`、`OPENBITFUN_E2E_HOME` |
| `P` | `<workspace>/.openbitfun` | 项目级配置、规则、插件和搜索索引 | 无 |
| `R` | `H/projects/<workspace-slug>` | 工作区级会话、计划、快照和插件信任 | 间接受 `H` 影响 |

当前定制构建默认值：

```text
U = /data/storage/el2/base/files/openbitfun
H = dirs::home_dir()/.openbitfun
```

当前构建仅将 `U` 固定到应用沙箱路径；`H` 仍保持跨平台实现，并支持 `OPENBITFUN_HOME` / `OPENBITFUN_E2E_HOME` 覆盖。`OPENBITFUN_USER_ROOT` / `OPENBITFUN_E2E_USER_ROOT` 当前不会改写 `U`，相关 E2E 隔离逻辑需要后续单独校正。

## 2. 用户配置根 `U`

```text
U/
├── config/
│   ├── app.json
│   ├── hooks.json
│   └── logs/
├── agents/
├── cache/
│   └── model-downloads/
│       └── speech/
├── data/
│   ├── models/
│   │   └── speech/<model_id>/<version>/
│   ├── memories/
│   │   └── memories.sqlite
│   ├── agent-runtime/
│   │   ├── coordination.sqlite
│   │   └── ownership/
│   ├── cron/
│   │   └── jobs.json
│   ├── miniapps/
│   │   └── <app_id>/
│   ├── rules/
│   └── plugins/
├── runtimes/
└── temp/
    └── speech-input/
```

| 路径 | 生命周期 | 说明 |
| --- | --- | --- |
| `U/config` | 长期 | 应用配置、用户 Hook 和日志 |
| `U/agents` | 长期 | 用户级 Agent 内容 |
| `U/cache` | 可清理 | 托管模型下载等缓存；不应作为唯一数据副本 |
| `U/data/models` | 长期 | 跨工作区共享的模型资源 |
| `U/data/memories` | 长期 | 用户记忆 SQLite 数据库 |
| `U/data/agent-runtime` | 运行时及可恢复状态 | Agent 协调数据库和进程归属锁 |
| `U/data/cron` | 长期 | 定时任务定义 |
| `U/data/miniapps` | 长期 | 用户 MiniApp 数据 |
| `U/data/rules`、`U/data/plugins` | 长期 | 用户级规则和插件包 |
| `U/runtimes` | 长期、可升级 | OpenBitFun 管理的 Node/Python/Office 等运行时 |
| `U/temp` | 临时 | 语音输入分片等短期文件 |

路径 owner 主要是 `PathManager` 以及 services 层对应的持久化模块。清理逻辑必须区分 `cache`/`temp` 与用户数据，不能用“删除整个 `U`”恢复错误状态。

### 2.1 技能目录例外

`PathManager::user_skills_dir()` 当前仍直接根据 `dirs::data_dir()`、`dirs::data_local_dir()` 和平台条件计算：

```text
Windows: dirs::data_dir()/OpenBitFun/skills/
macOS:   ~/Library/Application Support/OpenBitFun/skills/
Linux:   dirs::data_local_dir()/OpenBitFun/skills/
```

因此它不一定落在 `U` 下，也不能完全通过 `OPENBITFUN_USER_ROOT` 隔离。内置技能位于该目录的 `.system/` 子目录。

## 3. 助手根 `H`

```text
H/
├── personal_assistant/
│   ├── workspace/
│   └── workspace-<assistant_id>/
├── projects/
│   └── <workspace-slug>/
│       ├── sessions/
│       ├── plans/
│       ├── snapshots/
│       └── plugin-runtime/
│           └── <path_digest>/
│               └── trust.json
├── worktrees/
├── memories/
├── remote_ssh/
├── dispatch/
├── account_session.enc
├── account_session.key
├── device_identity.json
└── ...
```

说明：

- `personal_assistant/workspace` 是默认助手工作区。
- `personal_assistant/workspace-<assistant_id>` 是命名助手工作区。
- 旧版本的 `H/workspace` 和 `H/workspace-<assistant_id>` 仍需兼容读取，不能直接删除。
- `projects/<workspace-slug>` 是工作区运行时根，slug 由规范化工作区路径生成。
- `plugin-runtime/<path_digest>/trust.json` 保存工作区插件信任状态。
- `worktrees` 是 OpenBitFun 管理的 Git worktree 根。
- `memories` 是助手级记忆工作区；SQLite 主库位于 `U/data/memories`。
- `remote_ssh` 保存远程 SSH 工作区对应的本地会话镜像。
- `dispatch` 是 Detached Dispatch 控制端的持久化根。
- `account_session.*` 和 `device_identity.json` 属于账户/设备身份材料，必须按密钥文件的权限要求保护。

## 4. 项目根 `P`

对工作区 `<workspace>`，项目路径为 `<workspace>/.openbitfun`：

```text
<workspace>/.openbitfun/
├── config/
│   ├── agent_profiles.json
│   ├── tool_permissions.json
│   ├── mode_skills.json
│   ├── agent_subagents.json
│   └── hooks.json
├── agents/
├── rules/
├── plugins/
├── search/
│   └── flashgrep-index/
│       ├── base-snapshot/
│       └── workspace-overlay/
├── computer_use_debug/
└── tmp/
```

| 路径 | 生命周期 | 是否应提交到项目 Git |
| --- | --- | --- |
| `.openbitfun/config` | 长期 | 取决于项目策略；可能包含用户本地设置 |
| `.openbitfun/agents` | 长期 | 取决于项目是否共享 Agent |
| `.openbitfun/rules` | 长期 | 可作为项目规则共享 |
| `.openbitfun/plugins` | 长期 | 取决于插件来源和安全策略 |
| `.openbitfun/search/flashgrep-index` | 可重建缓存 | 通常不应提交 |
| `.openbitfun/computer_use_debug` | 调试期 | 通常不应提交 |
| `.openbitfun/tmp` | 临时 | 不应提交 |

项目路径不应被替换为控制端本地路径。远程工作区必须在实际执行端使用其自己的项目根和临时目录。

## 5. 项目运行时和 Session

项目运行时根：

```text
R = H/projects/<workspace-slug>/
```

由 [`SessionStorageLayout`](../../src/crates/services/services-core/src/session/layout.rs) 管理的会话结构如下：

```text
R/sessions/
├── index.json
└── <session_id>/
    ├── metadata.json
    ├── state.json
    ├── prompt_cache.json
    ├── turn-catalog.json
    ├── request-traces/
    │   └── request-000001.json
    ├── turns/
    │   └── turn-0000.json
    ├── snapshots/
    │   ├── context-0000.json
    │   ├── skill-agent-0000.json
    │   └── skill-agent-baseline-override.json
    └── artifacts/
        ├── transcript.txt
        ├── transcript.meta.json
        ├── compression-transcripts/
        └── session-references/
```

文件职责：

- `metadata.json`、`state.json`：会话元数据和可恢复状态。
- `prompt_cache.json`：会话级提示缓存保护状态。
- `turn-catalog.json`、`turns/`：Turn 索引及逐 Turn 持久化内容。
- `request-traces/`：请求级诊断记录。
- `snapshots/`：上下文和 Skill Agent 快照。
- `artifacts/`：转录、压缩转录、引用会话的只读副本及用户可下载产物。

Session 是长期用户数据。解析失败、凭据缺失、远端离线或断开连接都不能触发静默删除；应保留目录并返回可诊断状态。

## 6. 远程 SSH 工作区

远程工作区的本地会话镜像约定为：

```text
H/remote_ssh/<sanitized-host>/<remote-path-segments>/sessions/<session_id>/
```

远程路径必须使用 POSIX 语义。Windows 控制端不能用 `std::path` 的 Windows 分隔符替代远程路径，也不能把控制端工作区路径直接传给远端。

### 6.1 SSH 连接配置的未统一路径

Desktop/Server 的 SSH 管理器当前仍使用另一套目录：

```text
dirs::data_local_dir()/OpenBitFun/ssh/
├── ssh_connections.json
├── known_hosts
└── remote_workspace.json
```

Desktop E2E 场景可能使用 `U/ssh/`。这部分尚未完全收敛到 `PathManager`，因此迁移或清理用户数据时必须同时检查两套位置。

## 7. Detached Dispatch

控制端的派发根为：

```text
H/dispatch/
├── outbound/
├── repos/
├── worktrees/
├── jobs/
└── ...
```

目标端 job store 的逻辑结构为：

```text
<dispatch_root>/
├── jobs/<job_id>/
│   ├── job.json
│   ├── state
│   ├── events.ndjson
│   ├── events.meta.json
│   ├── permissions/
│   ├── messages/
│   └── turns/
├── repos/
├── worktrees/
└── workspaces/
```

目标端拥有任务、会话、worktree、事件日志和权限邮箱。控制端只是提交者和观察者，不能假定控制端仍在线，也不能把控制端文件系统当成目标端工作区。

## 8. Desktop WebView 和 Web UI

### 8.1 Tauri 原生恢复文件

Desktop WebView 恢复状态使用：

```text
app.path().app_data_dir()/webview-recovery.json
```

owner：[webview_recovery.rs](../../src/apps/desktop/src/webview_recovery.rs)。这是 WebView 恢复用途的短期持久化文件，不等同于 `U/config` 或 Session 目录。

### 8.2 浏览器存储

Web UI 运行在 WebView 浏览器沙箱中，使用以下存储：

- `localStorage`：更新提示、模型配置、UI 偏好、待发送队列、Review/设置偏好等。
- `sessionStorage`：当前页面恢复标记、导航状态、临时模式选择等。
- IndexedDB：数据库 `openbitfun-appearance`，object stores 为 `packages` 和 `catalog`。

IndexedDB owner：[AppearanceStorage.ts](../../src/web-ui/src/infrastructure/appearance/storage/AppearanceStorage.ts)。这些数据不经过 Rust `PathManager`，也不受统一的文件清理和 E2E 根目录控制；清除 WebView 站点数据会使其丢失。

## 9. Mobile Web

Mobile Web 使用浏览器 `localStorage`，典型键包括：

```text
openbitfun-mobile-language
openbitfun-mobile-theme
openbitfun.mobile.install_id
openbitfun.mobile.user_id
openbitfun.mobile.failure_count
openbitfun.mobile.lock_until
openbitfun.mobile.last_selected_model_id
```

主要 owner：

- [`I18nProvider.tsx`](../../src/mobile-web/src/i18n/I18nProvider.tsx)
- [`ThemeProvider.tsx`](../../src/mobile-web/src/theme/ThemeProvider.tsx)
- [`PairingPage.tsx`](../../src/mobile-web/src/pages/PairingPage.tsx)
- [`ChatPage.tsx`](../../src/mobile-web/src/pages/ChatPage.tsx)

这些键属于浏览器站点，不属于 Desktop/CLI 的 `U` 或 `H`。浏览器站点清理、隐私模式或设备更换都会导致其丢失。

## 10. HarmonyOS

HarmonyOS Mobile 使用应用沙箱中的 ArkData；真实物理目录由系统分配，OpenBitFun 只持有逻辑名称和 URI 转换规则。

### 10.1 Preferences

```text
openbitfun_remote_identity
openbitfun_cloud_account
openbitfun_general_chat_config
openbitfun_app_locale
```

### 10.2 RelationalStore

```text
openbitfun_remote_chat.db
openbitfun_remote_sessions.db
openbitfun_general_chat.db
```

当前代码中涉及的 URI/路径转换前缀：

```text
/storage/Users/currentUser/appdata
/data/storage
file://docs/storage/Users/currentUser
```

相关代码入口：

- [`CommonUtils.ets`](../../src/apps/ohos/entry/src/main/ets/utils/CommonUtils.ets)
- [`DefaultWebview.ets`](../../src/apps/ohos/oh-rs-ability/src/main/ets/webview/DefaultWebview.ets)

路径常量和转换逻辑可能由其他 HarmonyOS 模块或生成产物提供；新增实现时应集中到一个明确的平台适配器，并补充源码级契约测试。

HarmonyOS 的 URI 转换目前存在多处实现，后续应集中到一个平台适配器，避免不同模块把同一逻辑路径映射到不同物理目录。

## 11. Relay Server

默认配置：

```text
静态资源目录：由 RELAY_STATIC_DIR 指定
Room Web 目录：/tmp/openbitfun-room-web
Page 数据：<room_web_dir>/page-data/
账户数据库：由 RELAY_DB_PATH 指定，未设置时不启用账户功能
```

Docker Compose 默认值：

```text
/app/static
/app/room-web
/app/data/openbitfun_relay.db
```

Docker volumes：

```text
relay-server_room-web
relay-server_relay-db
```

相关 owner：

- [`config.rs`](../../src/apps/relay-server/src/config.rs)
- [`main.rs`](../../src/apps/relay-server/src/main.rs)
- [`docker-compose.yml`](../../src/apps/relay-server/docker-compose.yml)

`/tmp/openbitfun-room-web` 是非持久化默认值；生产部署应显式设置 `RELAY_ROOM_WEB_DIR` 和 `RELAY_DB_PATH` 到持久化卷。`RELAY_DB_PATH` 未设置时，Relay 只提供房间配对和桥接，不提供账户、设备路由和同步数据库。

## 12. 路径统一性和迁移注意事项

当前仍绕过或部分绕过 `PathManager` 的位置：

| 优先级 | 位置 | 风险 |
| --- | --- | --- |
| 高 | `user_skills_dir()` 使用 `dirs::*` | E2E 隔离、备份和清理无法覆盖全部技能数据 |
| 高 | Desktop/Server SSH 使用 `data_local_dir()/OpenBitFun/ssh` | SSH 配置与其他用户数据分散 |
| 中 | 部分 Remote Connect 代码直接拼接 `home_dir()/.openbitfun` | `OPENBITFUN_HOME` 覆盖可能不完整 |
| 中 | WebView local/session storage 与 IndexedDB | 不受 Rust 存储统计、迁移和清理控制 |
| 中 | Relay 默认 `/tmp/openbitfun-room-web` | 重启或系统清理可能丢失 page data |
| 中 | HarmonyOS URI 转换重复 | 逻辑路径与物理路径可能不一致 |
| 低 | OHOS Desktop 隐私/反馈固定 `/data/storage/...` | 仅平台适配层，不能作为跨平台规范 |
| 低 | 旧助手工作区路径 | 升级时不能删除旧目录或强制改写引用 |

建议的后续收敛顺序：

1. 把技能目录和 SSH 配置路径纳入 `PathManager`，保留旧路径只读迁移和兼容读取。
2. 清点所有 `dirs::home_dir()`、`dirs::data_*()` 和 `.join(".openbitfun")` 调用，改为注入 `PathManager` 或明确的平台 adapter。
3. 为 WebView/移动端存储建立命名空间、版本号和导出/清除策略；不要把浏览器键值假设成 Rust 文件已持久化。
4. Relay 生产配置禁止使用 `/tmp` 作为 page data 根，部署检查应要求显式持久化路径。
5. 合并 HarmonyOS URI 转换实现，并为 `/storage/Users/currentUser/appdata` 与 `/data/storage` 建立转换契约测试。

## 13. 变更检查清单

新增或修改存储路径时，至少检查：

- 是否属于 `U`、`H`、`P`、`R` 中的某一层；如果不属于，是否有明确的 owner 和理由。
- 是否支持 `OPENBITFUN_USER_ROOT` / `OPENBITFUN_HOME` 的 E2E 隔离。
- 是否区分长期数据、缓存、临时文件和密钥材料。
- 是否影响 Remote workspace、Remote control、Peer Device Mode 或 Detached Dispatch。
- 是否需要旧路径读取、字段默认值和迁移测试。
- 是否在对应模块的 `AGENTS.md` 要求的范围内完成验证。

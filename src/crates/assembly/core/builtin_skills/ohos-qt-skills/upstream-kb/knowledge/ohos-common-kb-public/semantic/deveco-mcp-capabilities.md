---
id: deveco-mcp-capabilities
title: deveco-mcp 能力与使用边界
status: active
confidence: 0.7
sources: [{type: official, name: "deveco-cli 仓库 mcp/src-server + SKILL.md", date: 2026-08-03, uri: "https://gitcode.com/openharmony-sig/deveco-cli"}]
created: 2026-08-03
updated: 2026-08-15
last_confirmed: 2026-08-03
superseded_by: null
tags: [deveco-mcp, mcp, lsp, arkts, cpp, golden-rules, ohos-common]
refs: [deveco-cli-usage-rules]
summary: "deveco-mcp 的安装、客户端配置、check/restart 能力和边界；构建、运行、UI 与日志操作由 devecocli 或明确的底层诊断承担。"
audience: public
---

# deveco-mcp 能力与使用边界

> `deveco-mcp` 是 `devecocli serve mcp` 启动的 stdio MCP server（npm 包 `@deveco-codegenie/mcp`），基于 LSP 为 AI 编码工具提供鸿蒙工程静态语法分析。它是 [[deveco-cli-usage-rules]] 的子能力，不是独立工具链。

## 工具清单

| MCP 工具 | 能力 | 适用语言 |
|---|---|---|
| `deveco-mcp_check` | 对 HarmonyOS 工程源文件做静态语法分析，返回结构化 diagnostics（severity/file/line/message） | ArkTS、C/C++ |
| `deveco-mcp_restart` | 原地重启 MCP server：重同步项目 + 重初始化 LSP（arkts/cpp/all 三档） | — |

## 使用要求

| 严重度 | 规则 | 为什么 |
|---|---|---|
| 质量门 | 当前环境已安装该 MCP 且目标文件受支持时，AI 修改 `.ets`/`.ts`/`.cpp` 后运行 `deveco-mcp check`。MCP 不可用时改跑项目既有编译/lint/typecheck 门禁。 | LSP 检查能缩短反馈链，但 MCP 可用性不应成为平台或代码的伪阻断。 |
| 行为异常 | deveco-mcp 进 ERROR/卡死（大改后符号未更新、LSP 索引过时）时，用 `deveco-mcp restart`，不重启 IDE。 | restart 原地重同步项目 + 重初始化 LSP；重启 IDE 成本高且丢会话状态。 |
| 行为异常 | `restart` 失败后**不连续重试**——大概率是项目/SDK 配置问题，先排查根因。 | 工具描述明示："if initialization fails again after a restart, the cause is likely a persistent project/SDK configuration issue"。 |

## check 的返回与用法

- 入参：文件路径列表（相对项目根或绝对，ArkTS `.ets`/`.ts` + C/C++ `.c`/`.cpp`/`.h`）
- 返回：按 `relative_path → severity → name_path → diagnostics_results` 分组的结构化结果
- severity：1=Error / 2=Warning / 3=Information / 4=Hint
- 用法：AI 改完代码 → `deveco-mcp check` → 有 Error 必修 → 修完 recheck → 全过方进 commit

## 边界（deveco-mcp 不做）

- **不做运行时调试**：断点、变量查看、调用栈、反向调试 → 用 DevEco Studio 调试器或 `lldb`
- **不做代码规范检查**：lint（TS/ArkTS 规范）→ 用 `devecocli check lint`
- **不做 API 兼容性扫描**：SDK 版本间 breaking changes → 用 `devecocli check compat`
- **不做性能/内存分析**：Profiler 泳道 → 用 DevEco Studio Profiler 或 `hiperf`
- **不做崩溃解析**：Release 混淆堆栈还原 → 用 `hstack`

> deveco-mcp 是"AI 生成代码后的语法守门员"，不是全功能调试器。完整鸿蒙开发工具用法见 [[deveco-cli-usage-rules]]。

## 前提

- `devecocli init --mcp`（或手动在 AI 工具配置 `@deveco-codegenie/mcp@beta`，需 `DEVECO_PATH` 环境变量指向 DevEco Studio 路径）
- 本地有 `node`（npx 启动依赖）
- 验证生效：AI 工具 `/mcps` 应见 deveco-mcp 为 Connected

## 安装与客户端配置

首选由 `devecocli init --mcp` 写入当前 Agent/IDE 支持的配置。需要手工配置时，stdio server 的最小形式为：

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "DEVECO_PATH": "<DevEco Studio installation>"
      }
    }
  }
}
```

不同客户端可能使用 `mcpServers`、`servers` 或其他本地 server schema；字段名以客户端当前文档为准，不复制一组容易过期的客户端专用模板。工程无法自动发现时再设置 `PROJECT_PATH`，并保持它为本地配置，不写入共享知识页或仓库。

离线或受限网络环境可使用官方发布的本地 server 包；二进制名称、下载地址和系统隔离处理随版本变化，安装前检查对应 release 说明。

## 两代工具名称

历史工具链曾暴露 `check_ets_files`、`check_cpp_files`、`build_project`、`start_app`、`project_sync`、`get_app_ui_tree` 等多个动作；当前 common 规则以实际已连接 server 返回的工具清单为准，并把静态检查与重启抽象为 `deveco-mcp check/restart`。

因此：

1. 不根据旧截图或旧页面硬编码“必须正好有 11 个工具”；
2. 当前 MCP 只从实际工具描述中选择 `check`/`restart`；build/run/UI/log 转到 [[deveco-cli-usage-rules]] 的 devecocli 能力；
3. `check`/`restart` 缺失时先确认项目与 LSP 初始化状态，再执行一次 restart；持续失败则排查 SDK/工程配置。

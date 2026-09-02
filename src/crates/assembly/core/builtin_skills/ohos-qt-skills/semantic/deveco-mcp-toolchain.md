---
id: semantic-deveco-mcp-toolchain
type: semantic
domain: tech
tags: [deveco, mcp, toolchain, ide, build, harmonyos, trae, cursor, vscode]
created: 2026-06-02
updated: 2026-06-02
status: active
audience: public
refs: [semantic-qt-harmonyos-build, semantic-harmonyos-dev-fundamentals]
summary: >
  DevEco MCP工具链安装配置：三种安装方式(npx推荐/二进制/Toolbox可视化)、
  七种IDE配置模板(Trae CN/国际版/Cursor/VS Code/Gemini Code Assist/Claude Desktop/
  OpenCode)、ArkTS语法校验插件、11个MCP工具验证表。
---

# DevEco MCP 工具链安装与配置

## 概述

DevEco Toolbox 是鸿蒙开发的 AI 辅助工具链，由两个核心组件构成：

- **deveco-toolbox**：可视化配置工具，提供图形界面管理 DevEco Studio 和 MCP 服务
- **deveco-mcp-server**：MCP（Model Context Protocol）服务端，提供 11 个工具接口供 AI IDE 调用

**核心能力**：依赖 DevEco Studio 环境，但可在不打开 DevEco 的情况下，在 Trae、Cursor、VS Code 等 AI IDE 中完成鸿蒙应用的构建、运行、调试全流程。

**工作流程**：

```
AI IDE → MCP Client → deveco-mcp-server → DevEco Studio CLI → HarmonyOS 项目
```

---

## 安装方式一：npx（推荐）

最简单的方式，无需手动下载安装包，通过 npm 自动拉取并运行：

```bash
npx -y @deveco-codegenie/mcp@beta
```

**优点**：

- 自动下载最新版本
- 无需管理安装路径
- 适合快速体验

**注意事项**：

- 需要 Node.js 环境（建议 v18+）
- 首次运行会下载包，后续会使用缓存
- `@beta` 标签表示当前为测试版本

---

## 各 IDE 配置

### 参数说明

所有配置涉及两个关键环境变量：

| 参数 | 说明 | 必填 | 示例 |
|------|------|------|------|
| `PROJECT_PATH` | 鸿蒙工程路径，可通过 `init_project_path` 工具后续修改 | 否 | `C:/Users/xxx/MyApp` |
| `DEVECO_PATH` | DevEco Studio 安装路径，用于定位构建工具链 | 是（自动探测失败时） | `C:/Program Files/Huawei/DevEco Studio` |

### 1. Trae CN（国内版）

配置文件位置：项目根目录 `.trae/mcp.json`

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**特点**：使用 `mcpServers` 字段，Trae CN 会自动识别并加载 MCP 服务。

### 2. Trae 国际版

配置文件位置：项目根目录 `.trae/mcp.json`

```json
{
  "servers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**差异**：国际版使用 `servers` 而非 `mcpServers` 字段，其他配置相同。

### 3. Cursor

配置文件位置：项目根目录 `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "PROJECT_PATH": "C:/Users/xxx/MyHarmonyApp",
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**注意**：Cursor 可能需要手动指定 `PROJECT_PATH`，因为自动探测在某些项目结构下会失败。建议使用绝对路径。若 `${workspaceFolder}` 不生效则手动替换为绝对路径。

### 4. VS Code / Gemini Code Assist

配置文件位置：项目根目录 `.vscode/mcp.json`

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "PROJECT_PATH": "${workspaceFolder}",
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**特点**：VS Code 支持 `${workspaceFolder}` 变量，可自动指向当前工作区。Gemini Code Assist 作为 VS Code 扩展，共享此配置。

### 5. Claude Desktop

配置文件位置：
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**特点**：Claude Desktop 无需配置 `PROJECT_PATH`，通过对话中的 `init_project_path` 工具动态指定项目路径。

### 6. Gemini CLI

配置文件位置：`~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "PROJECT_PATH": ".",
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**特点**：`PROJECT_PATH` 设为 `"."` 表示当前目录，适合在终端中切换到项目目录后直接运行。

### 7. OpenCode

配置文件位置：项目根目录 `.opencode/config.json`

```json
{
  "mcp": {
    "deveco-mcp": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@deveco-codegenie/mcp@beta"],
      "env": {
        "PROJECT_PATH": ".",
        "DEVECO_PATH": "C:/Program Files/Huawei/DevEco Studio"
      }
    }
  }
}
```

**差异**：OpenCode 使用 `mcp` 而非 `mcpServers` 字段，且需要额外指定 `type: "local"` 表示本地 MCP 服务。

---

## 安装方式二：二进制

适合网络环境不佳或需要离线安装的场景。

### 下载

GitHub Releases 页面：https://github.com/open-deveco/deveco-mcp/releases

### Windows 安装

1. 下载 `deveco-mcp-server-windows-x64.zip`
2. 解压到目标目录（如 `C:\deveco-mcp`）
3. **避免中文路径**，否则可能导致 MCP 服务启动失败

```powershell
# 解压示例
Expand-Archive deveco-mcp-server-windows-x64.zip -DestinationPath C:\deveco-mcp
```

配置时替换 `command` 为二进制路径：

```json
{
  "mcpServers": {
    "deveco-mcp": {
      "command": "C:/deveco-mcp/deveco-mcp-server.exe",
      "args": [],
      "env": {
        "PROJECT_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

### macOS 安装

1. 下载 `deveco-mcp-server-macos-arm64.dmg`（Apple Silicon）或 `deveco-mcp-server-macos-x64.dmg`（Intel）
2. 打开 DMG 并拖拽到 Applications 文件夹
3. **移除隔离属性**（首次运行前必须执行）：

```bash
xattr -cr /Applications/DevEco\ MCP\ Server.app
```

---

## 安装方式三：DevEco Toolbox 可视化

适合不熟悉命令行配置的用户，通过图形界面一键完成。

### 下载

GitHub Releases 页面：https://github.com/open-deveco/deveco-toolbox/releases

### 功能特点

1. **自动探测 DevEco Studio 路径**：无需手动配置 `DEVECO_PATH`
2. **一键添加到 IDE**：界面上提供"添加到 Trae"、"添加到 Cursor"等按钮
3. **可视化管理**：查看 MCP 服务状态、日志、工具列表

### 使用步骤

1. 下载并安装 DevEco Toolbox
2. 启动 Toolbox，自动检测本地 DevEco Studio 安装
3. 选择目标 IDE，点击"添加"按钮
4. Toolbox 自动写入对应 IDE 的 MCP 配置文件

---

## ArkTS 语法校验插件

基于 LSP（Language Server Protocol）语言服务器协议，为 AI IDE 提供 ArkTS 代码智能支持。

### 功能

- **语法高亮**：ArkTS/ETS 代码着色
- **Hover 提示**：鼠标悬停显示类型信息和文档
- **定义跳转**：Ctrl+Click 跳转到类型/函数定义
- **实时校验**：编辑时即时检查语法错误

### 安装方式

| 方式 | 操作 |
|------|------|
| **Toolbox 一键安装** | 在 DevEco Toolbox 界面中点击"安装 ArkTS 插件"按钮，自动完成 VS Code / Trae / Cursor 的插件安装 |
| **手动拖拽 VSIX** | 在 Toolbox 所在目录找到 `.vsix` 文件，拖入 IDE 插件市场安装 |

**验证**：打开 IDE 后右下角状态指示器变为白色，表示 LSP 初始化完成，可正常校验 ArkTS 语法。

---

## MCP 工具验证表

安装完成后，在 AI IDE 的 MCP 工具列表中应能看到以下 11 个工具：

| 工具名称 | 功能描述 |
|---------|---------|
| `harmonyos_knowledge_search` | 查询鸿蒙云端知识库 |
| `check_ets_files` | ets 文件语法检查 |
| `check_cpp_files` | C/C++ 文件语法检查 |
| `build_project` | 项目构建 |
| `start_app` | 启动应用 |
| `get_app_ui_tree` | 获取 UI 树 |
| `perform_ui_action` | UI 操作（点击/滑动/输入） |
| `verify_ui` | UI 验证 |
| `get_hilog_or_faultlog_recent` | 获取日志 |
| `project_sync` | 项目同步（ohpm install） |
| `init_project_path` | 初始化/更改项目路径 |

> **工具缺失排查**：若 MCP 工具列表不完整，通常是 LSP 初始化未完成导致。**重启 MCP 服务**即可解决。

---

## 构建运行工作流

标准的鸿蒙应用构建运行流程，按顺序执行以下步骤：

```
┌─────────────────┐
│  project_sync   │  ← 1. 同步依赖（ohpm install）
└────────┬────────┘
         ▼
┌─────────────────┐
│  build_project  │  ← 2. 编译构建（hvigorw assembleHap）
└────────┬────────┘
         ▼
┌─────────────────┐
│    start_app    │  ← 3. 安装并启动应用
└────────┬────────┘
         ▼
┌───────────────────────────┐
│ get_hilog_or_faultlog_    │  ← 4. 查看运行日志
│       recent              │
└────────┬──────────────────┘
         ▼
┌─────────────────┐
│ perform_ui_     │  ← 5. 执行 UI 交互测试
│     action      │
└─────────────────┘
```

**工作流说明**：

1. **project_sync**：确保所有依赖包已安装，避免构建时缺少模块
2. **build_project**：编译 ArkTS/C++ 代码，生成可部署的 HAP 包
3. **start_app**：将 HAP 安装到设备并启动主 Ability
4. **get_hilog_or_faultlog_recent**：捕获应用启动日志，用于排查崩溃或异常
5. **perform_ui_action**：模拟用户操作进行自动化测试

---

## 构建失败排查

当 `build_project` 返回错误时，按以下四步排查：

### Step A：查询知识库

调用 `harmonyos_knowledge_search` 查询 `compile_fix_pro.md` 知识库，获取历史修复方案：

```
harmonyos_knowledge_search(query="编译错误 <错误码或关键信息>")
```

### Step B：错误分类

根据错误信息将问题归类：

| 分类 | 典型错误 | 排查方向 |
|------|---------|---------|
| **预处理错误** | 文件未找到、import 失败 | 检查文件路径、模块依赖、oh-package.json5 |
| **编译错误** | 类型不匹配、语法错误 | 检查 ArkTS 语法、API 版本兼容性 |
| **链接错误** | 符号未定义、重复定义 | 检查 Native 库配置、build-profile.json5 |
| **打包错误** | 资源缺失、签名失败 | 检查 resources 目录、签名配置 |

### Step C：最多 3 次重试

每次重试采用不同修复方案：

1. **第 1 次**：根据知识库方案修复，重新 `build_project`
2. **第 2 次**：若失败，尝试替代方案（如降级 API、修改配置）
3. **第 3 次**：若仍失败，执行 `project_sync` 清理依赖后重试

**重要**：避免重复相同方案，每次重试必须有实质性改变。

### Step D：沉淀修复经验

修复成功后，将解决方案追加到 `compile_fix_pro.md` 知识库：

```markdown
## <错误类型> - <日期>
**错误信息**：<完整错误日志>
**根因**：<问题原因分析>
**修复方案**：<具体修改步骤>
**验证**：重新 build_project 成功
```

这样下次遇到相同问题时，Step A 可以直接命中历史方案，提升排查效率。

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 日常 Qt 鸿蒙化开发实践积累 |

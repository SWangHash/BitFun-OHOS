---
name: hmos-dev-env-setup
description: >-
  **MUST** load before any HarmonyOS build/run/sign skill (`deveco-cli`, `hmos-arkui-develop-skill`, `hmos-runtime-fix-skill`) when the development environment is not yet set up, AND whenever any generic tool is missing. Required if `devecocli`, `node`, `npm`, `hdc`, `git`, `python`, `curl`, `wget`, or `zsh` is missing, `command not found: devecocli` / `command not found: git` appears, or `COMMAND_LINE_TOOL_PATH` is unset. Walks the full prerequisite chain per the official devecocli README: install `command-line-tools-for-hmos` (provides node/bin) → set `COMMAND_LINE_TOOL_PATH` + add `node/bin` to PATH → `npm install -g @deveco-test/hmos-deveco-cli` → (recommended) Harmonybrew as the generic package manager for any missing tools (git/python/curl/wget/zsh etc) → verify. Triggers — HarmonyOS 环境搭建, 配置, install, setup, brew, node, npm, git, devecocli, Harmonybrew, command-line-tools-for-hmos, COMMAND_LINE_TOOL_PATH, "devecocli not found", "command not found: devecocli", "git not found", "command not found: git", "python not found", 缺 git/python/curl/wget/zsh 等通用工具, 鸿蒙开发环境.
---

# HarmonyOS 开发环境搭建

为 agent 提供鸿蒙构建/运行/签名工具链的前置环境搭建流程。本 skill 是 `deveco-cli` 等 skill 的**前置**——后者假设 `devecocli`/`node`/`npm` 已就绪,本 skill 负责让它们就绪。

**依据**:devecocli 官方 README(`https://gitcode.com/openharmony-sig/deveco-cli/blob/hmos-develop/README.md`)的"快速开始 → 前置要求"。

## 何时加载

满足任一即加载:

- 首次在 HarmonyOS 上做开发,环境未配置
- `devecocli` / `node` / `npm` / `hdc` 任一缺失或 `command not found`
- `COMMAND_LINE_TOOL_PATH` 未设(CLT 未装或未配)
- 用户要求"配置鸿蒙开发环境"/"装 devecocli"/"装 command-line-tools"
- **缺 `git`/`python`/`curl`/`wget`/`zsh` 等通用工具时**(任一 `command not found` 或用户要求装某工具)——此时走 Step 4 装 Harmonybrew 并 `brew install <name>`,这条**贯穿全程**

环境就绪后,构建/运行/签名移交 `deveco-cli` skill;但**缺通用工具时本 skill 仍可加载**走 Step 4 Harmonybrew 路径,不受"环境已就绪"限制。

## 前置依赖链(顺序不能跳,依据官方 README)

```
command-line-tools-for-hmos (华为下载,自带 node/bin + hdc toolchains)
        │
        ▼
配置 COMMAND_LINE_TOOL_PATH + PATH 加 node/bin  (node ≥18 / npm 可用)
        │
        ▼
npm install -g @deveco-test/hmos-deveco-cli   (用 CLT 自带的 node)
        │
        ▼
(推荐) Harmonybrew —— HarmonyOS 通用包管理器,缺任何工具都用它装
        │
        ▼
验证 → 移交 devecocli skill
```

**关键**:`command-line-tools-for-hmos` **自带 `node/bin`**(Node.js ≥18),是 node/npm 的来源,**不需要 Harmonybrew 提供 node**。顺序反了会导致 `npm: command not found`。Harmonybrew 是 HarmonyOS 上的通用包管理器(Homebrew 的 OHOS 移植)——用户**缺任何工具时**(git/python/ruby/rust/curl/wget/zsh 等)都应该装 Harmonybrew 并用 `brew install <name>` 补齐,不限于 git。

**详细每平台命令、失败矩阵、故障排查见 `references/env-setup-steps.md`**,按需查阅,不要整读。

## Step 1 — command-line-tools-for-hmos(华为下载,提供 node/bin)

**平台前提**:devecocli 官方前置要求"操作系统为 HarmonyOS"。CLT 是 node/npm/hdc 的唯一来源。

下载页 `https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos` 是 JS 渲染 + 华为账号门控,**不能 webfetch 抓链接**。流程:

1. 用 `OpenUrl` 工具**通过内置浏览器**打开页面(`{ "url": "https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos" }`,`OpenUrl` 默认 `mode: "auto"` 优先用 BitFun 内置浏览器面板,面板不可用回退 OS 浏览器),让用户登录华为账号下载对应平台 CLT 包。
2. 用户下载完成后,询问用户下载文件的位置。
3. Agent 解压到稳定路径(避免空格/中文):
   - HarmonyOS PC:`/storage/Users/currentUser/command-line-tools-for-hmos`
   - Linux:`~/.local/command-line-tools-for-hmos`
   - Windows:`C:\Users\<user>\command-line-tools-for-hmos`
4. 解压后目录应含 `node/bin/`、`sdk/default/openharmony/toolchains/`(hdc)、`ohpm/` 等。若结构不对(只有一层空壳),重新下载解压。

## Step 2 — 配置环境变量(官方 README 前置要求)

按官方 README,设置 `COMMAND_LINE_TOOL_PATH` 和 `PATH`:

```sh
export COMMAND_LINE_TOOL_PATH=path/to/deveco_tools
export PATH=$PATH:path/to/deveco_tools/node/bin
```

持久化写入 shell rc(HarmonyOS PC 用 `~/.zshrc`):

```sh
echo 'export COMMAND_LINE_TOOL_PATH=/storage/Users/currentUser/command-line-tools-for-hmos' >> ~/.zshrc
echo 'export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/node/bin' >> ~/.zshrc
source ~/.zshrc
```

注意:变量名是 **`COMMAND_LINE_TOOL_PATH`**(单数 TOOL,来自官方 README)。`DEVECO_CLI_CLT_PATH`(见 `deveco-cli/SKILL.md` 的 `check lint` 说明)是另一用途变量,不要混淆。

CLT 还提供 hdc 工具链,推包运行需要:

```sh
export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/sdk/default/openharmony/toolchains
```

验证 Step 1+2:

```sh
node --version    # ≥18
npm --version
hdc version       # hdc 可用
```

## Step 3 — devecocli(npm 全局安装)

用 Step 2 配好的 node/npm:

```sh
npm install -g @deveco-test/hmos-deveco-cli
devecocli --version
```

包名是 `@deveco-test/hmos-deveco-cli`(官方 README 安装命令)。若 `command not found: devecocli`,通常是 npm 全局 bin 不在 PATH——检查 `npm config get prefix`,把全局 bin 加入 PATH。

更新:`devecocli update`。

## Step 4 — Harmonybrew(推荐,通用包管理器)

CLT 仅提供 node/npm/hdc/ohpm 等 HarmonyOS 开发工具链,**不提供 git、python、ruby、curl、wget、zsh 等通用工具**。Harmonybrew 是 HarmonyOS 上的通用包管理器(Homebrew 的 OpenHarmony 移植),用户**缺任何工具时都建议装 Harmonybrew 并用 `brew install <name>` 补齐**,不限于 git。

**平台前提**:Harmonybrew 仅 OpenHarmony/HarmonyOS arm64。脚本探测 `/lib/ld-musl-aarch64.so.1` 含 `OHOS`,不满足则 `abort`。**不要在 Windows/标准 Linux 跑**。HarmonyOS PC(MateBook Pro/HiShell)为 Tier 2(低)支持,部分包受系统安全限制;开发板/容器为 Tier 1。

HarmonyOS PC 安装(**依据官方 install.md "鸿蒙 PC" 章节**,4 步):

1. **卸载冲突软件**:若装了 `GitNext`、`DevBox`,先卸载。
2. **打开安全开关**:"设置" → "系统" → "开发者选项" 打开开关;"设置" → "隐私和安全" → "高级" → 打开"运行来自非应用市场的扩展程序"。若"开发者选项"菜单不显示:"设置" → "关于本机" → 找"软件版本"连点 7 次 → 弹窗点"确认重启并开启"。
3. **安装 Homebrew**:
   ```sh
   zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"
   ```
4. **配置环境变量**(按脚本提示):
   ```sh
   echo >> ~/.zshrc
   echo 'eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"' >> ~/.zshrc
   eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"
   ```

安装路径硬编码 `/storage/Users/currentUser/.harmonybrew`。开发板/容器步骤不同,见 `references/env-setup-steps.md` §4.4/4.5。

**装好后,缺任何工具用标准 Homebrew 语法**:`brew search <name>` → `brew install <name>`。常用示例:`brew install git`、`brew install python`、`brew install ruby`、`brew install curl`。

## Step 5 — 验证

按序跑,任一失败即定位修复:

```sh
node --version && npm --version          # Step 1+2(CLT 提供 node)
hdc version                              # Step 1+2(hdc toolchains)
echo $COMMAND_LINE_TOOL_PATH             # Step 2,应指向 CLT 根
ls $COMMAND_LINE_TOOL_PATH/node/bin      # 应有 node/npm
devecocli --version                      # Step 3
devecocli auth status                    # auth(未登录则 auth login)
```

(若已装 Harmonybrew,可加 `git --version` / `brew --version` 验证 Step 4。)

全通过 → 环境就绪 → **移交 `deveco-cli` skill** 继续 `devecocli init` / `auth login` / `signature generate` / `build` / `run`。本 skill 不重复 `deveco-cli` 的内容。

## 路由

- 环境就绪后:所有 build/run/sign/docs 走 `deveco-cli` skill
- ArkTS 代码编写:走 `hmos-arkui-develop-skill`
- 运行时崩溃/闪退:走 `hmos-runtime-fix-skill`
- **缺任何工具**(git/python/ruby/curl/wget/zsh 等):装 Harmonybrew(若未装),然后 `brew install <name>`;不要假设系统已有

## 故障排查入口

具体每平台命令、失败矩阵、重置步骤见 `references/env-setup-steps.md`。

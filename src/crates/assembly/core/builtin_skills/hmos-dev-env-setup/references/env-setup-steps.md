# HarmonyOS 开发环境搭建详细步骤

本文档为 `hmos-dev-env-setup` skill 的详细参考。`SKILL.md` 提供加载时即可见的简明入口,具体每平台的命令、失败矩阵和故障排查放在这里,按需查阅。

**依据**:devecocli 官方 README `https://gitcode.com/openharmony-sig/deveco-cli/blob/hmos-develop/README.md` 的"快速开始 → 前置要求"。

## 前置依赖链(官方 README 顺序)

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

**关键**:`command-line-tools-for-hmos` **自带 `node/bin`**(Node.js ≥18),是 node/npm 的来源。**顺序不能反**——先装 CLT 才有 node/npm,才能 `npm install -g devecocli`。Harmonybrew 不是 node 的来源;它是 HarmonyOS 上的通用包管理器(Homebrew 的 OHOS 移植),用户**缺任何工具时**都应该装 Harmonybrew 并用 `brew install <name>` 补齐,不限于 git。

---

## Step 1 — command-line-tools-for-hmos(华为下载)

### 1.1 用户手动下载(必须)

下载页 `https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos` 是 JS 渲染 + 华为账号登录门控,**不能用 webfetch 抓下载链接**。**必须让用户自己在浏览器打开该页面,登录华为账号,下载对应平台的 CLT 包**。

Agent 行为:

1. 用 `OpenUrl` 工具**通过内置浏览器**打开页面(`{ "url": "https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos" }`,`OpenUrl` 默认 `mode: "auto"` 优先用 BitFun 内置浏览器面板,面板不可用回退 OS 浏览器)——优先用 BitFun 内置浏览器面板。
2. 告诉用户:登录华为账号 → 选择对应平台的 `command-line-tools-for-hmos` → 下载。
3. 用户下载完成后,**询问用户下载文件的位置**。
4. **Agent 解压**到稳定路径(见 §1.2)。

### 1.2 解压到稳定路径

用户告诉 agent下载位置后,agent 解压到稳定路径(避免空格和中文):

- HarmonyOS PC:`/storage/Users/currentUser/command-line-tools-for-hmos`
- Linux:`~/.local/command-line-tools-for-hmos`
- Windows:`C:\Users\<user>\command-line-tools-for-hmos`

解压后目录结构应包含 `node/bin/`(node/npm)、`sdk/default/openharmony/toolchains/`(hdc)、`ohpm/` 等。若结构不对(只有一层空壳),说明压缩包损坏或解压层级错了,重新下载解压。

---

## Step 2 — 配置环境变量(官方 README 前置要求)

按官方 devecocli README,前置要求是:

```
- 操作系统为 HarmonyOS
- 安装 Command Line Tool 工具
- 配置环境变量:
  export COMMAND_LINE_TOOL_PATH=path/to/deveco_tools
  export PATH=$PATH:path/to/deveco_tools/node/bin
```

### 2.1 临时(当前会话)

```sh
export COMMAND_LINE_TOOL_PATH=/storage/Users/currentUser/command-line-tools-for-hmos
export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/node/bin
export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/sdk/default/openharmony/toolchains  # hdc
```

### 2.2 持久(写入 shell rc)

HarmonyOS PC(zsh):

```sh
echo 'export COMMAND_LINE_TOOL_PATH=/storage/Users/currentUser/command-line-tools-for-hmos' >> ~/.zshrc
echo 'export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/node/bin' >> ~/.zshrc
echo 'export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/sdk/default/openharmony/toolchains' >> ~/.zshrc
source ~/.zshrc
```

Linux(bash):

```sh
echo 'export COMMAND_LINE_TOOL_PATH=$HOME/.local/command-line-tools-for-hmos' >> ~/.bashrc
echo 'export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/node/bin' >> ~/.bashrc
source ~/.bashrc
```

### 2.3 变量说明

| 变量 | 来源 | 用途 |
|---|---|---|
| `COMMAND_LINE_TOOL_PATH` | 官方 devecocli README | 指向 CLT 根目录,devecocli 前置要求 |
| `PATH` 加 `$COMMAND_LINE_TOOL_PATH/node/bin` | 官方 README | 让 node/npm 可被命令行找到(node ≥18) |
| `PATH` 加 `.../sdk/default/openharmony/toolchains` | README "本地推包运行" | hdc 可用(`hdc tconn`/`hdc install` 等) |
| `DEVECO_CLI_CLT_PATH` | BitFun `deveco-cli/SKILL.md` `check lint` 说明 | **不同用途**:Studio 未装时 `devecocli check lint` 发现 CLT;非 devecocli 通用前置 |

**不要混淆** `COMMAND_LINE_TOOL_PATH`(官方前置)和 `DEVECO_CLI_CLT_PATH`(check lint 专用)。

### 2.4 验证 Step 1+2

```sh
node --version    # 应 ≥18(CLT 自带)
npm --version
hdc version
echo $COMMAND_LINE_TOOL_PATH    # 应非空,指向 CLT 根
ls $COMMAND_LINE_TOOL_PATH/node/bin   # 应有 node/npm
```

---

## Step 3 — devecocli(npm 全局安装)

用 Step 2 配好的 node/npm:

```sh
npm install -g @deveco-test/hmos-deveco-cli
devecocli --version
```

包名是 **`@deveco-test/hmos-deveco-cli`**(官方 README 安装命令)。更新:`devecocli update`。

若报 `command not found: devecocli` 或 `devecocli is not installed or not in PATH`(见 [devecocli_run.rs](src/crates/assembly/core/src/agentic/tools/implementations/devecocli_run.rs) 的缺失提示),通常是 `npm` 全局 bin 目录不在 PATH。检查:

```sh
npm config get prefix        # 全局安装前缀
npm bin -g                  # 全局 bin 路径(老版本)
```

把 npm 全局 bin 目录加入 PATH,或重新 `source ~/.zshrc`。

---

## Step 4 — Harmonybrew(推荐,通用包管理器)

### 4.1 何时需要

Harmonybrew 是 HarmonyOS 上的通用包管理器(Homebrew 的 OpenHarmony 移植)。CLT 仅提供 HarmonyOS 开发工具链(node/npm/hdc/ohpm/hvigor),**不提供 git、python、ruby、rust、curl、wget、zsh 等通用工具**。用户**缺任何工具时**都应该装 Harmonybrew 并用 `brew install <name>` 补齐:

- `git`(版本控制)
- `python`(脚本/工具链)
- `ruby` / `rust` / `go`(其他语言运行时)
- `curl` / `wget`(网络工具)
- `zsh`(其他设备)
- 其他标准 Homebrew formula

**Harmonybrew 不是 node 的来源**——node 已由 CLT 的 `node/bin` 提供。不要为了拿 node 而装 Harmonybrew。但用户缺任何其他工具时,Harmonybrew 是 HarmonyOS 上**推荐的通用补齐方式**(优于手动编译/推送 tarball)。

### 4.2 平台前提(必读)

Harmonybrew **仅支持 OpenHarmony / HarmonyOS arm64**。安装脚本会探测 `/lib/ld-musl-aarch64.so.1` 是否含 `OHOS` 字符串,不满足则直接 `abort "Harmonybrew is only supported on OpenHarmony and HarmonyOS"`。**不要在 Windows / 标准 Linux 上运行此步骤**——脚本会中断,不会给用户可用结果。

支持等级:

| 设备形态 | 代表产品 | 最低系统版本 | Shell | 支持等级 |
|---|---|---|---|---|
| HarmonyOS PC | HUAWEI MateBook Pro | HarmonyOS 6.1.0.117 SP68 | HiShell (zsh) | Tier 2(低) |
| HarmonyOS 开发板 | dayu200 (rk3568) | OpenHarmony 6.1 | hdc shell | Tier 1(高) |
| HarmonyOS 容器 | DockerHarmony | OpenHarmony 6.1 | 任意 | Tier 1(高) |

**Tier 2 含义**:HarmonyOS PC 的 HiShell 受系统安全限制,部分包可能装不上或运行受限。这是系统级限制,不是 Harmonybrew 本身的 bug。遇到受限应如实告知用户,不要假装成功。

### 4.3 HarmonyOS PC(MateBook Pro / HiShell)

**依据**:官方 install.md "鸿蒙 PC" 章节(`https://atomgit.com/Harmonybrew/docs/blob/main/zh-CN/user/install.md#鸿蒙-pc`)。严格按以下 4 步:

#### 01. 卸载冲突软件

如果 PC 中安装有 `GitNext` 和 `DevBox` 这两个应用,请将它们卸载。

#### 02. 打开安全开关

- 进入"设置" → "系统" → "开发者选项",打开"开发者选项"开关
- 进入"设置" → "隐私和安全" → "高级",打开"运行来自非应用市场的扩展程序"开关

如果你的系统不显示"开发者选项"菜单,则需要通过隐藏开关来开启:打开"设置" → "关于本机"(即进入"设置"时的默认界面),找到"软件版本",连续点击 7 次,出现弹窗后点击"确认重启并开启"即可。

#### 03. 安装 Homebrew

在终端中执行这句命令进行安装:

```sh
zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"
```

安装路径硬编码为 `/storage/Users/currentUser/.harmonybrew`(脚本自动检测,不可改)。

#### 04. 配置环境变量

按照安装脚本的提示,执行以下命令,将 Homebrew 加入到 PATH 中:

```sh
echo >> ~/.zshrc
echo 'eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"' >> ~/.zshrc
eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"
```

注意第一行 `echo >> ~/.zshrc` 是加一个空行分隔,不要省略(官方文档原文)。

#### 验证 + 装工具

```sh
brew --version          # 验证安装
brew install git        # 示例:装 git;其他工具同理 brew install <name>
```

```sh
brew install git
```

### 4.4 OpenHarmony 开发板(dayu200 / rk3568,经 hdc shell)

**依据**:官方 install.md "在鸿蒙开发板上使用" 章节。

#### 01. 配置所需目录

Homebrew 运行过程中需要使用 `$HOME`、`/usr/bin`、`/storage/Users/currentUser` 等目录,需手动配置:

```sh
mount -o remount,rw /
mkdir -p /usr
mkdir -p /data/storage/Users/currentUser
ln -s /bin /usr/bin

# /storage 目录在 tmpfs 上,数据无法持久化,每次重启设备后需要重新创建软链接
ln -s /data/storage/Users /storage/Users

# hdc shell 环境下 HOME 变量默认指向 / 目录,这个目录可用空间很少,需要将其指向一个大容量的目录
# 此配置仅在当前终端有效,每次进入 hdc shell 需要重新设置
export HOME=/storage/Users/currentUser
```

#### 02. 安装 curl 和 zsh

在上位机(Windows 电脑)下载好 [鸿蒙版 curl](https://github.com/Harmonybrew/ohos-curl) 和 [鸿蒙版 zsh](https://github.com/Harmonybrew/ohos-zsh),并用 hdc 将 tar 包推到设备上。

在设备上解压,把里面的命令软链接到 `/usr/bin` 目录下:

```sh
mount -o remount,rw /
tar -zxf curl-8.19.0-ohos-arm64.tar.gz -C /data
ln -s /data/curl-8.19.0-ohos-arm64/bin/curl /usr/bin/curl
tar -zxf zsh-5.9-ohos-arm64.tar.gz -C /data
ln -s /data/zsh-5.9-ohos-arm64/bin/zsh /usr/bin/zsh
```

#### 03. 安装 Homebrew

在终端中执行这句命令进行安装(**别忘了给开发板联网**):

```sh
zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"
```

#### 04. 配置环境变量

手动将 Homebrew 加入到 PATH 中:

```sh
# 此配置仅在当前终端有效,每次进入 hdc shell 需要重新设置
export PATH=/storage/Users/currentUser/.harmonybrew/bin:$PATH
```

注意:`/storage` 是 tmpfs,重启后软链丢失,每会话需重建 PATH。详见 Harmonybrew 文档。

### 4.5 OpenHarmony 容器(DockerHarmony)

**依据**:官方 install.md "在鸿蒙容器上使用" 章节。

#### 01. 安装 zsh

在容器内通过 curl 下载 zsh,将其软链接到 `/usr/bin` 目录下:

```sh
curl -fLO https://github.com/Harmonybrew/ohos-zsh/releases/download/5.9/zsh-5.9-ohos-arm64.tar.gz
tar -zxf zsh-5.9-ohos-arm64.tar.gz -C /opt
ln -s /opt/zsh-5.9-ohos-arm64/bin/zsh /usr/bin/zsh
```

#### 02. 安装 Homebrew

在终端中执行这句命令进行安装:

```sh
zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"
```

#### 03. 配置环境变量

按照安装脚本的提示,执行以下命令,将 Homebrew 加入到 PATH 中:

```sh
echo >> ~/.mkshrc
echo 'eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"' >> ~/.mkshrc
eval "$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)"
```

### 4.6 Harmonybrew 常用命令

```sh
brew update                 # 更新 brew + 包索引
brew formulae               # 列出可用 formula
brew search [keyword]        # 按关键词搜索
brew install [formula]       # 安装包
brew uninstall [formula]      # 卸载
brew list                    # 列出已装
brew upgrade [formula]       # 升级单个
brew upgrade                 # 升级全部
rm -rf $(brew --cache)       # 清缓存
rm -rf /storage/Users/currentUser/.harmonybrew   # 彻底卸载(重置)
```

**后续若缺少工具**:优先 `brew search <name>` → `brew install <name>`(标准 Homebrew 语法)。

---

## Step 5 — 验证

按顺序跑,任一步失败即定位到对应 Step 修复:

```sh
node --version          # Step 1+2(CLT 自带 node ≥18)
npm --version           # Step 1+2
hdc version             # Step 1+2(hdc toolchains)
echo $COMMAND_LINE_TOOL_PATH   # Step 2,应非空且指向 CLT 根
ls $COMMAND_LINE_TOOL_PATH/node/bin # 应有 node/npm
devecocli --version     # Step 3
devecocli auth status   # 验证 auth(未登录则提示 devecocli auth login)
```

(若已装 Harmonybrew,可加 `git --version` / `brew --version` 验证 Step 4;缺其他工具时 `brew install <name>` 补齐后同样用 `<tool> --version` 验证。)

全部通过后,环境就绪,**移交 `deveco-cli` skill** 继续 `devecocli init` / `auth login` / `signature generate` / `build` / `run`。

---

## 故障矩阵

| 症状 | 根因 | 修复 |
|---|---|---|
| 下载页打不开 / 无下载链接 | JS 渲染 + 账号门控 | 用 `OpenUrl` 通过内置浏览器打开,让用户登录;Agent 不要尝试 webfetch 抓链接 |
| `node: command not found` | Step 2 PATH 未配 `$COMMAND_LINE_TOOL_PATH/node/bin` | 重跑 Step 2 持久化命令,`source ~/.zshrc` |
| `npm: command not found` | 同上,node/bin 未在 PATH | 同上 |
| `devecocli: command not found` 装完后 | npm 全局 bin 不在 PATH | `npm config get prefix` 找全局 bin,加入 PATH;或 `source ~/.zshrc` |
| `npm install -g` 报 `EACCES` | 全局 bin 目录权限 | 用 CLT 自带 node(在 CLT 目录,通常无权限问题);若系统 node,修 npm prefix |
| `hdc: command not found` | 未配 `.../sdk/default/openharmony/toolchains` 到 PATH | 加 `export PATH=$PATH:$COMMAND_LINE_TOOL_PATH/sdk/default/openharmony/toolchains` |
| `devecocli check lint` 报 CLT 未找到 | `DEVECO_CLI_CLT_PATH` 未设(Studio 未装时) | 设 `DEVECO_CLI_CLT_PATH` 为 CLT 根(注意:这与 `COMMAND_LINE_TOOL_PATH` 是不同变量,见 §2.3) |
| 缺任意工具(`git`/`python`/`curl`/`wget`/`zsh` 等) | CLT 仅含 HarmonyOS 开发工具链,无通用工具 | 装 Harmonybrew(Step 4),然后 `brew search <name>` → `brew install <name>`;不要假设系统已有或手动编译 |
| `Harmonybrew is only supported on OpenHarmony and HarmonyOS` | 在 Windows/标准 Linux 上跑了 install.sh | 该平台不能装 Harmonybrew;告知用户仅 OHOS/arm64 支持 |
| `zsh: command not found` 跑 install.sh 时 | 无 zsh | HarmonyOS PC:HiShell 自带;开发板/容器:先装 `ohos-zsh`(见 §4.4/4.5) |
| `curl: (7) Failed to connect to harmonybrew.atomgit.com` | 网络受限 / 防火墙 | 让用户检查网络代理;Harmonybrew 也可 `git clone https://atomgit.com/Harmonybrew/brew.git` fallback |
| `brew install <pkg>` 在 HarmonyOS PC 失败 | Tier 2 系统安全限制 | 这是已知系统级限制,非 Harmonybrew bug;告知用户,不重试 |
| `devecocli auth login` 打不开浏览器 | HarmonyOS PC 无桌面浏览器 handler | 命令会打印授权 URL,用 `OpenUrl` 工具打开(见 `deveco-cli/SKILL.md` auth login 说明) |

---

## 卸载 / 重置

重置整个环境(谨慎):

```sh
npm uninstall -g @deveco-test/hmos-deveco-cli
rm -rf /storage/Users/currentUser/.harmonybrew        # Step 4(若装了)
rm -rf /storage/Users/currentUser/command-line-tools-for-hmos  # Step 1
# 从 ~/.zshrc 删除 COMMAND_LINE_TOOL_PATH、node/bin、toolchains、brew shellenv 行
```

重置后需从 Step 1 重装。

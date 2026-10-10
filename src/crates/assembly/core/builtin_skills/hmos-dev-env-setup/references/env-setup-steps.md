# HarmonyOS 开发环境搭建详细步骤

本文档为 `hmos-dev-env-setup` skill 的详细参考。`SKILL.md` 提供加载时即可见的简明入口,具体每平台的命令、失败矩阵和故障排查放在这里,按需查阅。

## 前置依赖链(node/npm 来源二选一)

```
获取 node/npm(二选一,用 AskUserQuestion 弹选项):
  方式 A: Command Line Tools —— 浏览器下载 → 解压 → 配 COMMAND_LINE_TOOL_PATH + node/bin + npm prefix + npm/bin PATH
  方式 B: DevEco Studio —— 应用市场→我的→应用尝鲜下载 → 配 hmos-clt node/bin + npm prefix + npm/bin PATH
        │
        ▼  (node/npm 可用)
npm install -g @deveco-test/hmos-deveco-cli
        │
        ▼
(推荐) Harmonybrew —— 缺任何工具都用它装
        │
        ▼
验证 → 移交 devecocli skill
```

**关键**:DevEco Studio 和 Command Line Tools **都自带 Node.js**(≥18),是 node/npm 的来源。**顺序不能反**——先获取 node/npm 才能 `npm install -g devecocli`。Harmonybrew 不是 node 的来源;它是 HarmonyOS 上的通用包管理器(Homebrew 的 OHOS 移植),用户**缺任何工具时**都应该装 Harmonybrew 并用 `brew install <name>` 补齐,不限于 git。

---

## Step 1 — 获取 node/npm(二选一)

devecocli 经 npm 分发,安装前需先装 DevEco Studio 或 Command Line Tools(都自带 Node.js)。用 **`AskUserQuestion`** 工具弹出两个选项让用户选:

- **方式 A:Command Line Tools(浏览器下载)**
- **方式 B:DevEco Studio(应用市场下载)**

### 1.1 方式 A — Command Line Tools

#### 1.1.1 用户手动下载(必须)

下载页 `https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos` 是 JS 渲染 + 华为账号登录门控,**不能用 webfetch 抓下载链接**。**必须让用户自己在浏览器打开该页面,登录华为账号,下载对应平台的 CLT 包**。

Agent 行为:

1. 用 `OpenUrl` 工具**通过内置浏览器**打开页面(`{ "url": "https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos" }`,`OpenUrl` 默认 `mode: "auto"` 优先用 BitFun 内置浏览器面板,面板不可用回退 OS 浏览器)——优先用 BitFun 内置浏览器面板。
2. 告诉用户:登录华为账号 → 选择对应平台的 `command-line-tools-for-hmos` → 下载。
3. 用户下载完成后,**询问用户下载文件的位置**。
4. **Agent 解压**(见 §1.1.2)。

#### 1.1.2 解压

用户告诉 agent 下载位置后,agent 解压(工具名按实际):

```sh
tar -zxvf commandline-tools-harmonyos-xxx.tar.gz
```

解压到稳定路径(避免空格和中文),例如 `/storage/Users/currentUser/command-line-tools-for-hmos`。

解压后目录结构应包含 `node/bin/`(node/npm)、`ohpm/` 等。若结构不对(只有一层空壳),说明压缩包损坏或解压层级错了,重新下载解压。

#### 1.1.3 配置环境变量

在终端中执行以下命令,打开环境变量配置文件:

```sh
vim ~/.zshrc
```

在 `.zshrc` 文件中添加 Node.js 环境变量(`解压路径` 替换为实际的解压路径):

```sh
export COMMAND_LINE_TOOL_PATH=${解压路径}/command-line-tools
export PATH=$COMMAND_LINE_TOOL_PATH/node/bin:$PATH
```

保存并关闭文件,使用 `source` 命令重新加载 `.zshrc` 配置文件:

```sh
source ~/.zshrc
```

#### 1.1.4 设置 npm 全局安装路径

在终端中执行以下命令,设置 npm 包安装路径,建议设置到个人目录下 `/storage/Users/currentUser/npm`:

```sh
npm config set prefix /storage/Users/currentUser/npm
```

在 `.zshrc` 文件中添加 npm 环境变量:

```sh
export PATH=/storage/Users/currentUser/npm/bin:$PATH
```

保存并关闭文件,使用 `source` 命令重新加载 `.zshrc` 配置文件:

```sh
source ~/.zshrc
```

#### 1.1.5 验证方式 A

```sh
node -v
npm -v
echo $COMMAND_LINE_TOOL_PATH    # 应非空,指向 CLT 根
ls $COMMAND_LINE_TOOL_PATH/node/bin   # 应有 node/npm
```

### 1.2 方式 B — DevEco Studio

#### 1.2.1 下载安装 DevEco Studio

引导用户去**应用市场 → 我的 → 应用尝鲜**,下载安装 DevEco Studio。

#### 1.2.2 查看 hmos-clt 版本

装好后,在鸿蒙电脑终端或 DevEco Studio 终端进入 `/data/service/hnp/hmos-clt.org` 目录,查看 `hmos-clt_x.x.x` 实际版本号(按实际修改下面命令中的版本):

```sh
ls /data/service/hnp/hmos-clt.org   # 查看 hmos-clt_x.x.x 实际版本
```

#### 1.2.3 配置环境变量

在终端中执行以下命令,打开环境变量配置文件:

```sh
vim ~/.zshrc
```

在 `.zshrc` 文件中添加 Node.js 环境变量(`hmos-clt_x.x.x` 请根据实际情况进行修改):

```sh
export PATH=/data/service/hnp/hmos-clt.org/hmos-clt_x.x.x/node/bin:$PATH
```

保存并关闭文件,使用 `source` 命令重新加载 `.zshrc` 配置文件:

```sh
source ~/.zshrc
```

#### 1.2.4 设置 npm 全局安装路径

在终端中执行以下命令,设置 npm 包安装路径,建议设置到个人目录下 `/storage/Users/currentUser/npm`:

```sh
npm config set prefix /storage/Users/currentUser/npm
```

在 `.zshrc` 文件中添加 npm 环境变量:

```sh
export PATH=/storage/Users/currentUser/npm/bin:$PATH
```

保存并关闭文件,使用 `source` 命令重新加载 `.zshrc` 配置文件:

```sh
source ~/.zshrc
```

#### 1.2.5 验证方式 B

```sh
node -v
npm -v
```

---

## Step 2 — devecocli(npm 全局安装)

用 Step 1 配好的 node/npm:

```sh
npm install -g @deveco-test/hmos-deveco-cli
devecocli --version
```

包名是 **`@deveco-test/hmos-deveco-cli`**(官方 README 安装命令)。更新:`devecocli update`。

若报 `command not found: devecocli` 或 `devecocli is not installed or not in PATH`,通常是 `npm` 全局 bin 目录(`/storage/Users/currentUser/npm/bin`)不在 PATH。检查:

```sh
npm config get prefix        # 应为 /storage/Users/currentUser/npm
echo $PATH | grep npm        # 应含 /storage/Users/currentUser/npm/bin
```

重新 `source ~/.zshrc`,或确认 Step 1 的 npm prefix + npm/bin PATH 已正确配置。

---

## Step 3 — Harmonybrew(推荐,通用包管理器)

### 3.1 何时需要

Harmonybrew 是 HarmonyOS 上的通用包管理器(Homebrew 的 OpenHarmony 移植)。DevEco Studio / CLT 仅提供 HarmonyOS 开发工具链(node/npm/hdc/ohpm/hvigor),**不提供 git、python、ruby、rust、curl、wget、zsh 等通用工具**。用户**缺任何工具时**都应该装 Harmonybrew 并用 `brew install <name>` 补齐:

- `git`(版本控制)
- `python`(脚本/工具链)
- `ruby` / `rust` / `go`(其他语言运行时)
- `curl` / `wget`(网络工具)
- `zsh`(其他设备)
- 其他标准 Homebrew formula

**Harmonybrew 不是 node 的来源**——node 已由 DevEco Studio / CLT 提供。不要为了拿 node 而装 Harmonybrew。但用户缺任何其他工具时,Harmonybrew 是 HarmonyOS 上**推荐的通用补齐方式**(优于手动编译/推送 tarball)。

### 3.2 平台前提(必读)

Harmonybrew **仅支持 OpenHarmony / HarmonyOS arm64**。安装脚本会探测 `/lib/ld-musl-aarch64.so.1` 是否含 `OHOS` 字符串,不满足则直接 `abort "Harmonybrew is only supported on OpenHarmony and HarmonyOS"`。**不要在 Windows / 标准 Linux 上运行此步骤**——脚本会中断,不会给用户可用结果。

支持等级:

| 设备形态 | 代表产品 | 最低系统版本 | Shell | 支持等级 |
|---|---|---|---|---|
| HarmonyOS PC | HUAWEI MateBook Pro | HarmonyOS 6.1.0.117 SP68 | HiShell (zsh) | Tier 2(低) |
| HarmonyOS 开发板 | dayu200 (rk3568) | OpenHarmony 6.1 | hdc shell | Tier 1(高) |
| HarmonyOS 容器 | DockerHarmony | OpenHarmony 6.1 | 任意 | Tier 1(高) |

**Tier 2 含义**:HarmonyOS PC 的 HiShell 受系统安全限制,部分包可能装不上或运行受限。这是系统级限制,不是 Harmonybrew 本身的 bug。遇到受限应如实告知用户,不要假装成功。

### 3.3 HarmonyOS PC(MateBook Pro / HiShell)

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

### 3.4 OpenHarmony 开发板(dayu200 / rk3568,经 hdc shell)

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

### 3.5 OpenHarmony 容器(DockerHarmony)

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

### 3.6 Harmonybrew 常用命令

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

## Step 4 — 验证

按顺序跑,任一步失败即定位到对应 Step 修复:

```sh
node --version          # Step 1(两条路径都验,node ≥18)
npm --version           # Step 1
devecocli --version     # Step 2
devecocli auth status   # 验证 auth(未登录则提示 devecocli auth login)
```

仅**方式 A**(Command Line Tools)验证:
```sh
echo $COMMAND_LINE_TOOL_PATH   # 应非空,指向 CLT 根
ls $COMMAND_LINE_TOOL_PATH/node/bin   # 应有 node/npm
```

方式 B(DevEco Studio)无 `COMMAND_LINE_TOOL_PATH` 变量,跳过上面两行。

(若已装 Harmonybrew,可加 `git --version` / `brew --version` 验证 Step 3;缺其他工具时 `brew install <name>` 补齐后同样用 `<tool> --version` 验证。)

全部通过后,环境就绪,**移交 `deveco-cli` skill** 继续 `devecocli init` / `auth login` / `signature generate` / `build` / `run`。

---

## 故障矩阵

| 症状 | 根因 | 修复 |
|---|---|---|
| 下载页打不开 / 无下载链接(方式 A) | JS 渲染 + 账号门控 | 用 `OpenUrl` 通过内置浏览器打开,让用户登录;Agent 不要尝试 webfetch 抓链接 |
| 应用尝鲜找不到 DevEco Studio(方式 B) | 应用市场未上架 / 地区限制 | 让用户检查应用市场"我的 → 应用尝鲜";或回退方式 A(Command Line Tools) |
| `hmos-clt_x.x.x` 版本找不到(方式 B) | DevEco Studio 未装或路径不对 | 确认 DevEco Studio 已装;`ls /data/service/hnp/hmos-clt.org` 查看实际版本目录名 |
| `node: command not found` | Step 1 PATH 未配 node/bin | 方式 A:重跑 Step 1 env config,`source ~/.zshrc`;方式 B:确认 `hmos-clt_x.x.x` 版本号正确 |
| `npm: command not found` | 同上,node/bin 未在 PATH | 同上 |
| `devecocli: command not found` 装完后 | npm 全局 bin 不在 PATH | 确认 `/storage/Users/currentUser/npm/bin` 在 PATH;`source ~/.zshrc`;检查 `npm config get prefix` 应为 `/storage/Users/currentUser/npm` |
| `npm install -g` 报 `EACCES` | 全局 bin 目录权限 | 确认 Step 1 已设 `npm config set prefix /storage/Users/currentUser/npm`(个人目录,无权限问题) |
| `devecocli check lint` 报 CLT 未找到 | `DEVECO_CLI_CLT_PATH` 未设(Studio 未装时) | 设 `DEVECO_CLI_CLT_PATH` 为 CLT 根(注意:这与方式 A 的 `COMMAND_LINE_TOOL_PATH` 是不同变量) |
| 缺任意工具(`git`/`python`/`curl`/`wget`/`zsh` 等) | DevEco Studio/CLT 仅含 HarmonyOS 开发工具链,无通用工具 | 装 Harmonybrew(Step 3),然后 `brew search <name>` → `brew install <name>`;不要假设系统已有或手动编译 |
| `Harmonybrew is only supported on OpenHarmony and HarmonyOS` | 在 Windows/标准 Linux 上跑了 install.sh | 该平台不能装 Harmonybrew;告知用户仅 OHOS/arm64 支持 |
| `zsh: command not found` 跑 install.sh 时 | 无 zsh | HarmonyOS PC:HiShell 自带;开发板/容器:先装 `ohos-zsh`(见 §3.4/3.5) |
| `curl: (7) Failed to connect to harmonybrew.atomgit.com` | 网络受限 / 防火墙 | 让用户检查网络代理;Harmonybrew 也可 `git clone https://atomgit.com/Harmonybrew/brew.git` fallback |
| `brew install <pkg>` 在 HarmonyOS PC 失败 | Tier 2 系统安全限制 | 这是已知系统级限制,非 Harmonybrew bug;告知用户,不重试 |
| `devecocli auth login` 打不开浏览器 | HarmonyOS PC 无桌面浏览器 handler | 命令会打印授权 URL,用 `OpenUrl` 工具打开(见 `deveco-cli/SKILL.md` auth login 说明) |

---

## 卸载 / 重置

重置整个环境(谨慎):

```sh
npm uninstall -g @deveco-test/hmos-deveco-cli
rm -rf /storage/Users/currentUser/npm        # npm 全局安装目录(Step 1 两条路径都设)
rm -rf /storage/Users/currentUser/.harmonybrew        # Step 3(若装了)
rm -rf /storage/Users/currentUser/command-line-tools-for-hmos  # Step 1 方式 A(若装了)
# 从 ~/.zshrc 删除:COMMAND_LINE_TOOL_PATH、node/bin、npm prefix、npm/bin、brew shellenv 行
```

重置后需从 Step 1 重装。

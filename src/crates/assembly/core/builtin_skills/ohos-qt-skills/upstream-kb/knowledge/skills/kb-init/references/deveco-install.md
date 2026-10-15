# DevEco 开发工具安装指南

本文件涵盖三类工具的安装：
1. **DevEco Studio** — GUI IDE（macOS / Windows）
2. **Command Line Tools** — 命令行工具集（Linux / HarmonyOS）
3. **deveco-cli** — 开源 AI 开发工具（全平台）

---

## macOS

### DevEco Studio

#### 下载

1. 访问 https://developer.huawei.com/consumer/cn/deveco-studio/
2. 选择 **DevEco Studio** macOS 版本（支持 Intel 和 Apple Silicon）
3. 下载 `.dmg` 安装包

> **自动下载**：`bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=<目录>` 可自动下载安装包到指定目录。

#### 安装

1. 双击 `.dmg` 文件
2. 将 DevEco Studio 拖入 `/Applications` 目录
3. 首次启动时，如果系统提示"无法验证开发者"，前往 **系统设置 → 隐私与安全性** 点击"仍要打开"
4. DevEco Studio 首次启动会自动下载 HarmonyOS SDK

#### 验证

```bash
ls /Applications/DevEco-Studio.app
ls /Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native/llvm/bin/clang
ls /Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc
```

### 将工具加入 PATH（推荐）

```bash
echo 'export PATH="/Applications/DevEco-Studio.app/Contents/tools:$PATH"' >> ~/.zshrc
echo 'export PATH="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains:$PATH"' >> ~/.zshrc
source ~/.zshrc
devecocli --version  # 验证 DevEco CLI
hdc version          # 验证 hdc
```

---

## Windows

### DevEco Studio

#### 下载

1. 访问 https://developer.huawei.com/consumer/cn/deveco-studio/
2. 选择 **DevEco Studio** Windows 版本
3. 下载 `.exe` 安装包

> **自动下载**：`bash skills/kb-init/scripts/download-cmdline-tools.sh --dest=<目录>` 可自动下载安装包。

#### 安装

1. 双击 `.exe` 安装包
2. 按向导完成安装（默认安装到 `C:\Program Files\Huawei\DevEco Studio`）
3. 首次启动会自动下载 HarmonyOS SDK

#### 验证

```powershell
dir "C:\Program Files\Huawei\DevEco Studio"
dir "C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\native\llvm\bin\clang.exe"
dir "C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe"
```

### 将工具加入 PATH（推荐）

1. 打开 **系统设置 → 高级系统设置 → 环境变量**
2. 在 **Path** 中添加:
   - `C:\Program Files\Huawei\DevEco Studio\tools`
   - `C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains`
3. 打开新的 PowerShell 窗口验证：`devecocli --version` 和 `hdc version`

---

## Linux

### Command Line Tools

DevEco Studio **没有 Linux GUI 版本**。Linux 用户使用 **Command Line Tools for HarmonyOS**。

#### 自动安装（推荐）

```bash
bash skills/kb-init/scripts/download-cmdline-tools.sh \
  --dest=~/commandline-tools \
  --url=<从下载页获取的链接>
```

脚本会自动下载、解压并输出 SDK 路径。

#### 手动安装

1. 访问 https://developer.huawei.com/consumer/cn/download/
2. 找到 **Command Line Tools for HarmonyOS** Linux 版本
3. 下载 `.tar.gz` 归档

```bash
mkdir -p ~/commandline-tools
tar xzf commandline-tools-linux-*.tar.gz -C ~/commandline-tools
```

#### 配置 PATH

```bash
echo 'export PATH="$HOME/commandline-tools/tools:$PATH"' >> ~/.bashrc
echo 'export PATH="$HOME/commandline-tools/sdk/default/openharmony/toolchains:$PATH"' >> ~/.bashrc
echo 'export OHOS_SDK_NATIVE="$HOME/commandline-tools/sdk/default/openharmony/native"' >> ~/.bashrc
source ~/.bashrc
```

#### 验证

```bash
devecocli --version
hdc version
ls ~/commandline-tools/sdk/default/openharmony/native/llvm/bin/clang
```

---

## HarmonyOS

### 平台限制

鸿蒙 PC 当前存在以下限制：

| 工具 | 状态 | 获取方式 |
|------|------|----------|
| DevEco Studio | 不可用 | 无鸿蒙版，未上架应用市场 |
| Command Line Tools | 需申请 | 在统一工单平台提单申请遥测版本 |
| deveco-cli | 可尝试 | 仓库未声明支持，但可通过 npm 尝试安装 |

### 申请 Command Line Tools

1. 访问 https://developer.huawei.com/consumer/cn/ 统一工单平台
2. 提单申请 **Command Line Tools for HarmonyOS 遥测版本**
3. 获得下载链接后，运行：

```bash
bash skills/kb-init/scripts/download-cmdline-tools.sh \
  --dest=~/commandline-tools \
  --url=<下载链接>
```

4. 配置 PATH：

```bash
echo 'export PATH="$HOME/commandline-tools/tools:$PATH"' >> ~/.zshrc
echo 'export PATH="$HOME/commandline-tools/sdk/default/openharmony/toolchains:$PATH"' >> ~/.zshrc
echo 'export OHOS_SDK_NATIVE="$HOME/commandline-tools/sdk/default/openharmony/native"' >> ~/.zshrc
source ~/.zshrc
```

### 在等待 CLT 期间可完成的配置

以下工具可通过 HarmonyBrew 安装，不依赖 DevEco/CLT：

```bash
# 安装 HarmonyBrew（如未安装）
zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"

# 安装基础工具
brew install git cmake node
```

---

## deveco-cli（全平台）

`deveco-cli` 是独立的开源工具，与 DevEco Studio 内置的 `devecocli` 不同。

- **仓库**: https://gitcode.com/openharmony-sig/deveco-cli
- **功能**: 集成 HarmonyOS 应用开发工具集、知识文档和 AI Skills
- **依赖**: Node.js >= 18

### 自动安装（推荐）

```bash
bash skills/kb-init/scripts/install-deveco-cli.sh --method=npm
```

### 手动安装

**方式 1: npm**

```bash
npm install -g deveco-cli
deveco-cli --version
```

**方式 2: git clone**

```bash
git clone https://gitcode.com/openharmony-sig/deveco-cli.git ~/dev/deveco-cli
cd ~/dev/deveco-cli
npm install
npm link  # 创建全局命令
```

### 验证

```bash
deveco-cli --version
```

### 与 devecocli 的区别

| 工具 | 来源 | 用途 |
|------|------|------|
| `devecocli` | DevEco Studio / CLT 内置 | 构建、安装、日志等 IDE 操作 |
| `deveco-cli` | 开源仓库 (npm) | AI 辅助开发、知识文档、Skills |

两者可同时安装，互不冲突。

---
name: kb-init
description: |
  Qt for HarmonyOS 知识库环境初始化。检测当前环境并帮助用户下载或安装迁移所需的工具链、Qt SDK/源码和模板工程，生成本地环境配置并验证是否就绪。
  当用户说"初始化"、"配置环境"、"第一次使用"、"setup"、"install"，
  或 ENV.local.md 不存在时，必须触发此 skill。
  即使用户没有明确说"初始化"，只要是第一次与知识库交互，也应主动建议运行。
---

# kb-init: Qt for HarmonyOS 开发环境一键配置

本 skill 引导你完成 Qt for HarmonyOS 开发所需的全部环境配置。整个过程分两阶段：

1. **收集决策**（Phase 1）：Agent 逐一问你问题，你回答完后就不用再管了
2. **自动执行**（Phase 2）：脚本自动安装、下载、配置，最后验证环境就绪

> 设计原则：能用脚本确定性完成的步骤，绝不让 Agent 自由发挥。Agent 只负责问你问题和调用脚本。

---

## Phase 0: 确认知识库位置

在开始任何配置之前，先确认用户是否在 `ohos_qt-skills` 知识库目录中。

运行检测：
```bash
bash skills/kb-init/scripts/detect-env.sh
```

检查输出中的 `KB_ROOT` 和 `KB_FOUND` 字段：

- 如果 `KB_FOUND=true`：用户已在知识库中，记录 `KB_ROOT` 值，进入 Phase 1
- 如果 `KB_FOUND=false`：用户不在知识库中，需要先下载知识库

### 下载知识库

如果 `KB_FOUND=false`，询问用户：

> 你还没有下载 Qt for HarmonyOS 知识库。你希望把它下载到哪个目录？
> 例如：`D:\dev` 或 `/Users/你的用户名/dev`
>
> 脚本会在该目录下创建 `ohos_qt-skills/` 目录。

记录用户指定的目录为 `KB_PARENT_DIR`，然后执行：

```bash
bash skills/kb-init/scripts/clone-kb.sh --dest=<KB_PARENT_DIR>
```

脚本会 clone `https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git` 到 `<KB_PARENT_DIR>/ohos_qt-skills/`。

完成后，将工作目录切换到 `<KB_PARENT_DIR>/ohos_qt-skills/`，重新运行 `detect-env.sh` 确认 `KB_FOUND=true`。

> 注意：如果用户是从知识库外部调用此 skill（比如从其他 AI 工具），Agent 需要先帮用户 clone 知识库，然后在知识库目录中继续后续步骤。

---

## Phase 1: 收集用户决策

按以下顺序**逐一**询问用户。每个问题等用户回答后再问下一个。不要一次性列出所有问题。

### Q1: 你的应用需要哪个 Qt 版本？

> 你的 Qt 应用需要哪个版本？
> 1. **Qt 5.15** — 推荐，新项目使用
> 2. **Qt 5.12** — 旧项目维护
> 3. **不确定** — 推荐选 Qt 5.15

记录为 `QT_VERSION`（`5.15` / `5.12`）。

### Q2: Qt 获取方式

根据 Q1 的版本，走不同分支：

**如果 Q1 = 5.15**：

> Qt 5.15 鸿蒙版仅有商业 license 版本。你有 Qt 商业 license 吗？
> 1. **有** — 我帮你从 Qt 官方下载源码并编译 SDK
> 2. **没有** — Qt 5.15 需要商业 license，请联系 Qt 销售获取。或者你可以选择 Qt 5.12（有开源版本）

如果用户选"没有"，回到 Q1 让用户重新选择版本。

**如果 Q1 = 5.12**：

> 你有 Qt 商业 license 吗？
> 1. **有** — 从 Qt 官方下载源码并编译 SDK（可选 5.12 或 5.15）
> 2. **没有** — 从 GitCode 下载开源版本（当前仅有 qt-harmonyos-src-5.12.12-20260625）

记录为 `QT_SOURCE_METHOD`（`commercial` / `opensource`）。

### Q3: 编译/下载参数

**如果 QT_SOURCE_METHOD = commercial**：

需要编译 SDK，询问编译参数：

> 编译 Qt SDK 需要选择几个参数：
>
> **渲染后端**：
> 1. **Desktop GL** — 大多数桌面开发场景，性能好
> 2. **GLES** — 需要与 HarmonyOS 设备端渲染行为一致（调试渲染问题时使用）
>
> **构建类型**：
> 1. **Release** — 优化后的版本，用于正式开发
> 2. **Debug** — 带调试信息，用于排查 Qt 框架问题

记录为 `RENDER_BACKEND`（`gl` / `gles`）和 `BUILD_TYPE`（`release` / `debug`）。

**如果 QT_SOURCE_METHOD = opensource**：

> 开源版本当前仅有 **qt-harmonyos-src-5.12.12-20260625**。
>
> 你需要什么？
> 1. **源码 + 预编译 SDK 都下载** — 可以查看源码，同时直接用 SDK 开发
> 2. **只下载预编译 SDK** — 最快上手，不需要源码

记录为 `OPENSOURCE_DOWNLOAD`（`both` / `sdk-only`）。

### Q4: DevEco Studio 状态

> 你已经安装了 DevEco Studio 吗？
> 1. **已安装** — 请告诉我安装路径（例如 macOS: `/Applications/DevEco-Studio.app`，Windows: `C:\Program Files\Huawei\DevEco Studio`）
> 2. **未安装** — 我会引导你安装

记录为 `DEVECO_STATUS`（`installed` / `not-installed`）和 `DEVECO_PATH`（如已安装）。

### Q5: Git 配置

> 你的 git 是否已配置好用户名和邮箱？（clone 代码需要）

Agent 运行以下命令检查：
```bash
git config --global user.name
git config --global user.email
```

如果为空，询问用户的名字和邮箱，然后运行：
```bash
git config --global user.name "用户的名字"
git config --global user.email "用户的邮箱"
```

### Q6: Commercial 场景账号验证

如果 QT_SOURCE_METHOD = commercial：

> 请确认你能访问 https://codereview.qt-project.org 。
> 1. 在浏览器中打开这个网址
> 2. 用你的 Qt 账号登录
> 3. 进入 Settings → HTTP Credentials → GENERATE NEW PASSWORD
> 4. 记下生成的**用户名**和**密码**（clone 时会用到）
>
> 完成后告诉我。

等用户确认完成后再继续。记录用户提供的 `QT_USER` 和 `QT_PASS`。

---

## Phase 2: 自动执行

Phase 1 完成后，Qt 工具链和模板默认安装到 BitFun 用户级共享资源目录，不再写入当前工作区。脚本会输出实际安装路径；如需指定其他位置，仍可传入 `--dest`。

### Step 1: 环境检测

```bash
bash skills/kb-init/scripts/detect-env.sh
```

解析输出，向用户简要展示当前环境状态。

### Step 2: 安装 DevEco Studio（如果未安装）

如果 Q4 回答未安装，读取 `references/deveco-install.md`，根据用户 OS 引导安装。

安装完成后，重新运行 `detect-env.sh` 确认 `DEVECO_FOUND=true`。

**DevEco CLI（devecocli）**：
- macOS/Windows：DevEco Studio 安装后自带 `devecocli`，位于 `<DEVECO_PATH>/tools/devecocli`
- Linux：需要单独下载 Command Line Tools，见 `references/deveco-install.md` Linux 章节

Agent 检查 `devecocli` 是否可用：
```bash
command -v devecocli || ls <DEVECO_PATH>/tools/devecocli 2>/dev/null
```

如果不可用，引导用户将其加入 PATH 或从 DevEco 下载页获取。

### Step 3: 平台依赖检查

根据 OS 运行对应脚本：

**macOS**:
```bash
bash skills/kb-init/scripts/install-deps-macos.sh
```

**Windows**（在 Git Bash 中运行）:
```bash
bash skills/kb-init/scripts/install-deps-linux.sh
```

**Linux**:
```bash
bash skills/kb-init/scripts/install-deps-linux.sh
```

**HarmonyOS**（鸿蒙 PC / 开发板 / 容器）:
```bash
bash skills/kb-init/scripts/install-deps-harmonyos.sh
```

> **HarmonyOS 平台说明**：鸿蒙平台使用 [HarmonyBrew](https://gitcode.com/Harmonybrew) 作为包管理器（Homebrew 的鸿蒙移植版）。如果未安装 HarmonyBrew，脚本会提示安装命令：`zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"`。git、cmake 等依赖可通过 `brew install` 安装。

脚本会检查 git、curl、cmake、Node.js、JDK、hdc、DevEco CLI 等依赖。如果有 FAIL 项，Agent 引导用户修复后重新运行。

> **cmake 是必须的**：知识库中引用 cmake 189 次，是 Qt 编译和项目构建的核心工具。如果 cmake 检查失败，必须先安装。

### Step 4: 获取 Qt 源码/SDK

所有文件默认安装到 BitFun 用户级共享资源目录。源码仍可使用 `--dest` 指定到用户选择的源码目录；预编译 SDK 使用 `download-qt-sdk.sh` 时不传 `--dest`，模板使用 `download-template.sh` 时不传 `--dest`。

**场景 A: commercial（需要源码 + 编译 SDK）**

```bash
bash skills/kb-init/scripts/clone-qt-src.sh \
  --method=commercial \
  --version=<QT_VERSION> \
  --user=<QT_USER> \
  --pass=<QT_PASS> \
  --dest=<KB_ROOT>/workspace/qt-src
```

克隆完成后，编译 SDK：

```bash
bash skills/kb-init/scripts/compile-qt-sdk.sh \
  --src=<KB_ROOT>/workspace/qt-src/qt<VERSION> \
  --dest=<KB_ROOT>/workspace/qt-sdk \
  --render=<RENDER_BACKEND> \
  --build-type=<BUILD_TYPE> \
  --ohos-sdk-native=<OHOS_SDK_NATIVE_PATH>
```

脚本会输出 `QT<VERSION>_OHOS_SDK=<路径>`。

> **安全提示**：commercial 场景 clone 完成后，建议清除 git remote URL 中的凭据：
> ```bash
> cd <KB_ROOT>/workspace/qt-src/qt<VERSION>
> git remote set-url origin https://codereview.qt-project.org/qt/tqtc-qt5
> ```

> **详细编译指南**：如果编译遇到问题，或需要手动编译，请参阅 `references/qt-compile-guide.md`，其中包含完整的编译步骤、参数说明和故障排除指南。

**场景 B: opensource, both（源码 + SDK）**

```bash
bash skills/kb-init/scripts/clone-qt-src.sh \
  --method=opensource \
  --version=5.12 \
  --dest=<KB_ROOT>/workspace/qt-src
```

然后下载预编译 SDK：

```bash
bash skills/kb-init/scripts/download-qt-sdk.sh \
  --platform=<OS>
```

**场景 C: opensource, sdk-only（仅 SDK）**

```bash
bash skills/kb-init/scripts/download-qt-sdk.sh \
  --platform=<OS>
```

### Step 5: 生成 ENV.local.md

```bash
bash skills/kb-init/scripts/generate-env-local.sh \
  --deveco-path="<DEVECO_PATH>" \
  --qt5-12-src="<KB_ROOT>/workspace/qt-src/qt5.12" \
  --qt5-15-src="<KB_ROOT>/workspace/qt-src/qt5.15" \
  --qt-build-root="<KB_ROOT>/workspace/qt-build" \
  --qt5-12-ohos-sdk="<SDK_PATH>" \
  --qt5-15-ohos-sdk="<SDK_PATH>" \
  --ohos-sdk-native="<OHOS_SDK_NATIVE_PATH>"
```

只传用户实际有的路径，缺失的参数不传。

Agent 向用户展示生成结果，请用户确认。

### Step 6: 验证环境

```bash
bash skills/kb-init/scripts/verify-env.sh
```

- `STATUS=ready`：告知用户环境就绪
- `STATUS=not-ready`：逐项展示 FAIL 原因，引导修复后重新验证

---

## 完成标志

- 知识库已下载（如果是新安装）
- `ENV.local.md` 已生成到 KB 根目录
- DevEco Studio + OHOS SDK native + DevEco CLI 已就绪
- Qt OHOS SDK 已配置
- `verify-env.sh` 输出 `STATUS=ready`

## 错误处理

| 错误 | 处理 |
|------|------|
| 知识库 clone 失败 | 检查网络；手动 `git clone https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git` |
| `detect-env.sh` 执行失败 | `chmod +x skills/kb-init/scripts/*.sh` |
| DevEco 安装后检测不到 | 读取 `references/deveco-install.md` 按平台检查路径 |
| DevEco CLI 不可用 | 检查 `<DEVECO_PATH>/tools/devecocli` 是否存在；加入 PATH |
| git clone 失败 (commercial) | 检查 HTTP 凭据；检查网络 |
| git clone 失败 (opensource) | 检查网络；尝试 `git config --global http.sslVerify false` |
| SDK 下载失败 | 手动访问 https://gitcode.com/ohos-qt/qt-harmonyos-src/releases |
| 编译 SDK 失败 (commercial) | 检查 MinGW/Perl/cmake 是否安装；参阅 `references/qt-compile-guide.md` 故障排除章节 |
| `verify-env.sh` 报告 FAIL | 按 FAIL 项提示修复，重新运行 |
| Linux 用户无 DevEco Studio GUI | 正常——使用 Command Line Tools |

## 参考文档

- `references/deveco-install.md` — DevEco Studio / CLI 各平台安装详细步骤
- `references/qt-src-acquisition.md` — Qt 源码获取的两种方式详细说明
- `references/qt-compile-guide.md` — Qt 源码编译构建完整指南（商业版用户必读，含故障排除）
- `references/env-variables.md` — ENV.md 中所有变量的含义和用途（含 DevEco 自带工具说明）

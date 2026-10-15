# Qt 源码获取方式详细说明

## 场景 A: 有 Qt 商业 license

### 前置条件

1. 你拥有有效的 Qt 商业 license
2. 你能访问 https://codereview.qt-project.org
3. 你已在该网站生成了 HTTP Credentials（Settings → HTTP Credentials → GENERATE NEW PASSWORD）

### 获取步骤

```bash
# 克隆（系统会提示输入用户名和密码，使用 codereview.qt-project.org 生成的凭据）
git clone https://codereview.qt-project.org/qt/tqtc-qt5 <目标路径>

cd <目标路径>

# 切到 5.12 分支
git checkout tqtc/harmonyos-5.12.12

# 或切到 5.15 分支
git checkout tqtc/harmonyos-5.15.16

# 初始化子模块（必须，QtOhosExtras 在子模块中）
git submodule update --init --recursive
```

### 可用分支

| 版本 | 分支名 | 说明 |
|------|--------|------|
| Qt 5.12.12 | `tqtc/harmonyos-5.12.12` | LTS 版本，旧项目维护 |
| Qt 5.15.16 | `tqtc/harmonyos-5.15.16` | 推荐，新项目使用 |

### 注意事项

- clone 可能需要较长时间（Qt 源码约 3GB）
- `git submodule update --init --recursive` 也必须完成，否则缺少 QtOhosExtras 模块
- 如果 clone 失败，检查 HTTP 凭据是否正确，网络是否能访问 codereview.qt-project.org

---

## 场景 B: 无 license（开源）

### 前置条件

1. git 已安装并配置好 user.name 和 user.email
2. 网络能访问 https://gitcode.com

### 获取步骤

**macOS / Linux（POSIX 构建）必须用构建分支**——`main`/`5.12.12` 快照带
Windows CRLF 行尾且丢失可执行位，`sh configure` 会直接失败（QOH037）：

```bash
# POSIX 构建分支（推荐，LF + 构建使能补丁，即官方预构建所用分支）
git clone --branch build/macos-arm64-qt5.12.12 --single-branch \
  https://gitcode.com/ohos-qt/qt-harmonyos-src <目标路径>
cd <目标路径>

# 克隆后恢复执行位并固化为提交（约 620 个 shebang 脚本在初始导入中丢了 +x）
grep -rIl "^#!" --exclude-dir=.git . > /tmp/exec-files.txt
xargs -a /tmp/exec-files.txt chmod +x
xargs -a /tmp/exec-files.txt git update-index --chmod=+x
git commit -m "fix: restore executable bits lost in initial import"
```

> 用 qt-sdk-forge 的 `src-clone --method opensource` 时以上修复全部自动完成。

**Windows** 可直接用 `main` / `5.12.12` 快照分支。

### 可用分支

| 分支 | 行尾 | 适用 |
|------|------|------|
| `build/macos-arm64-qt5.12.12` | LF + 构建补丁 | **macOS/Linux 源码编译（推荐）** |
| `main` / `5.12.12`（快照 20260625） | CRLF + 丢执行位 | Windows |

### 注意事项

- 开源版本仅有 Qt 5.12.12，没有 5.15
- 如果需要 Qt 5.15，必须有商业 license（场景 A）
- 镜像**没有** `tqtc/harmonyos-*` 商业分支名（那是场景 A 的仓库）

---

## 场景 C: 只需预编译 SDK

### 适用场景

你不需要修改 Qt 框架本身，只需要用预编译好的 Qt SDK 来编译你的 Qt 应用。这是最快上手的方式。

### 获取步骤

1. 访问发布页面: https://gitcode.com/ohos-qt/qt-harmonyos-src/releases
2. 找到匹配你平台的 SDK 包
3. 下载并解压到指定目录

### 可用的 SDK

| 平台 | 渲染后端 | 说明 |
|------|----------|------|
| Windows | Desktop GL | Windows 平台开发，Desktop GL 渲染 |
| Windows | GLES | Windows 平台开发，GLES 渲染 |
| macOS | Desktop GL | macOS 平台开发，Desktop GL 渲染 |
| macOS | GLES | macOS 平台开发，GLES 渲染 |
| HarmonyOS | GLES | HarmonyOS 设备上运行，GLES 渲染 |

### 选择渲染后端的建议

- **Desktop GL**: 大多数桌面开发场景使用，性能好
- **GLES**: 需要与 HarmonyOS 设备端渲染行为一致时使用（调试渲染问题）

### 注意事项

- 预编译 SDK 解压后的目录就是 `CMAKE_PREFIX_PATH` 的值
- SDK 中已包含 Qt 库、头文件、CMake 配置，无需额外编译

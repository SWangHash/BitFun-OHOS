# Qt 源码编译构建指南

本文档详细说明如何从源码编译 Qt for HarmonyOS SDK，适用于拥有 Qt 商业 license 的用户。

## 前置条件

编译 Qt 源码需要以下工具：

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| **cmake** | 构建系统 | macOS: `brew install cmake`<br>Windows: https://cmake.org/download/<br>Linux: `sudo apt install cmake` |
| **clang/llvm** | 交叉编译器 | 随 OHOS SDK 安装（DevEco Studio 自带） |
| **MinGW** | Windows 编译器 | 仅 Windows 需要：https://www.mingw-w64.org/ |
| **Strawberry Perl** | Qt 构建脚本 | 仅 Windows 需要：https://strawberryperl.com/ |
| **PowerShell** | Windows 编译环境 | Windows 自带 |

## 编译流程概览

```
1. 准备源码（clone + submodule）
2. 配置交叉编译环境（设置环境变量）
3. 运行 configure（生成 Makefile）
4. 编译（make/mingw32-make）
5. 安装（make install）
```

## 详细步骤

### Step 1: 准备源码

```bash
# 克隆源码（使用你的 Qt 凭据）
git clone --branch tqtc/harmonyos-5.12.12 --single-branch \
  https://<用户名>:<密码>@codereview.qt-project.org/qt/tqtc-qt5 \
  workspace/qt-src/qt5.12

cd workspace/qt-src/qt5.12

# 初始化子模块（必须，QtOhosExtras 在子模块中）
git submodule update --init --recursive
```

**验证**：检查 `qtbase/` 和 `qtohosextras/` 目录是否存在。

### Step 2: 配置环境变量

**macOS / Linux**：
```bash
export NATIVE_OHOS_SDK="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native"
export OHOS_SDK_SYSROOT="$NATIVE_OHOS_SDK/sysroot"
export LLVM_INSTALL_DIR="$NATIVE_OHOS_SDK/llvm"
```

**Windows (PowerShell)**：
```powershell
$env:NATIVE_OHOS_SDK = "C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\native"
$env:OHOS_SDK_SYSROOT = "$env:NATIVE_OHOS_SDK\sysroot"
$env:LLVM_INSTALL_DIR = "$env:NATIVE_OHOS_SDK\llvm"
```

**验证**：
```bash
ls $NATIVE_OHOS_SDK/llvm/bin/clang    # macOS/Linux
dir $env:NATIVE_OHOS_SDK\llvm\bin\clang.exe  # Windows PowerShell
```

### Step 3: 运行 configure

进入源码目录，运行 configure 脚本：

**macOS / Linux**：
```bash
cd workspace/qt-src/qt5.12

./configure -xplatform ohos-clang \
  -release \
  -opengl desktop \
  -prefix "$(pwd)/../qt-sdk/Qt5.12.12-arm64-v8a" \
  -nomake examples \
  -nomake tests \
  -skip qtwebengine
```

**Windows (PowerShell)**：
```powershell
cd workspace\qt-src\qt5.12

configure.bat -xplatform ohos-clang `
  -release `
  -opengl desktop `
  -prefix "$(Get-Location)\..\qt-sdk\Qt5.12.12-arm64-v8a" `
  -nomake examples `
  -nomake tests `
  -skip qtwebengine
```

#### configure 参数说明

| 参数 | 说明 | 可选值 |
|------|------|--------|
| `-xplatform` | 交叉编译平台 | `ohos-clang`（固定） |
| `-release` | 构建类型 | `-release`（优化版）或 `-debug`（调试版） |
| `-opengl` | 渲染后端 | `desktop`（Desktop GL）或 `es2`（GLES） |
| `-prefix` | SDK 安装路径 | 任意目录 |
| `-nomake examples` | 跳过示例编译 | 推荐，加快编译速度 |
| `-nomake tests` | 跳过测试编译 | 推荐，加快编译速度 |
| `-skip qtwebengine` | 跳过 WebEngine | 推荐，HarmonyOS 不支持 |

#### 常见 configure 错误

**错误 1**: `Cannot find feature spec_post.prf`
- **原因**：子模块未初始化
- **解决**：`git submodule update --init --recursive`

**错误 2**: `clang not found`
- **原因**：环境变量未设置
- **解决**：检查 `$LLVM_INSTALL_DIR/bin/clang` 是否存在

**错误 3**: `sysroot not found`
- **原因**：OHOS SDK 路径错误
- **解决**：检查 `$OHOS_SDK_SYSROOT` 是否指向正确目录

### Step 4: 编译

**macOS / Linux**：
```bash
make -j$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
```

**Windows (PowerShell)**：
```powershell
mingw32-make -j8
```

> ⚠️ **Windows 必须在 PowerShell 中编译**，不能在 Git Bash 中运行 mingw32-make。

编译时间：30-60 分钟（取决于 CPU 核心数）。

#### 常见编译错误

**错误 1**: `undefined reference to xxx`
- **原因**：链接库缺失
- **解决**：检查 configure 输出，确认所有依赖库已找到

**错误 2**: `mingw32-make: *** [xxx] Error 2`
- **原因**：编译中间错误
- **解决**：查看上方具体错误信息，通常是源码问题或环境问题

**错误 3**: `fatal error: xxx.h: No such file or directory`
- **原因**：头文件路径错误
- **解决**：检查 OHOS SDK sysroot 是否完整

### Step 5: 安装

**macOS / Linux**：
```bash
make install
```

**Windows (PowerShell)**：
```powershell
mingw32-make install
```

安装完成后，SDK 会出现在 `-prefix` 指定的目录中。

**验证**：
```bash
ls workspace/qt-sdk/Qt5.12.12-arm64-v8a/
# 应该看到：bin/ include/ lib/ mkspecs/ plugins/ qml/
```

## 使用编译好的 SDK

编译完成后，将 SDK 路径配置到 `ENV.local.md`：

```markdown
| `QT5_12_OHOS_SDK` | `/Users/you/dev/qt-sdk/Qt5.12.12-arm64-v8a` |
```

然后在 Qt 项目中使用：

```cmake
set(CMAKE_PREFIX_PATH "/Users/you/dev/qt-sdk/Qt5.12.12-arm64-v8a")
```

## 故障排除

### 问题：编译很慢

- **解决**：增加并行度 `-j16` 或 `-j32`（取决于 CPU 核心数）
- **优化**：使用 `-nomake examples -nomake tests -skip qtwebengine`

### 问题：磁盘空间不足

- Qt 源码约 3GB，编译产物约 5GB，SDK 约 2GB
- **解决**：确保至少有 15GB 可用空间

### 问题：子模块初始化失败

- **原因**：网络问题或凭据错误
- **解决**：
  ```bash
  git submodule sync
  git submodule update --init --recursive
  ```

### 问题：configure 后找不到某些模块

- **原因**：某些 Qt 模块依赖系统库
- **解决**：使用 `-skip` 跳过不需要的模块，例如：
  ```bash
  -skip qtwebengine -skip qtwayland -skip qtlocation
  ```

### 问题：Windows 编译时路径错误

- **原因**：在 Git Bash 中运行 mingw32-make
- **解决**：必须在 PowerShell 中编译

## 自动化编译

使用 `compile-qt-sdk.sh` 脚本可以自动化上述流程：

```bash
bash skills/kb-init/scripts/compile-qt-sdk.sh \
  --src=workspace/qt-src/qt5.12 \
  --dest=workspace/qt-sdk \
  --render=gl \
  --build-type=release \
  --ohos-sdk-native=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native
```

脚本会自动执行 configure → make → make install。

**注意**：Windows 平台脚本无法自动执行编译（必须在 PowerShell 中），脚本会输出 PowerShell 命令供手动执行。

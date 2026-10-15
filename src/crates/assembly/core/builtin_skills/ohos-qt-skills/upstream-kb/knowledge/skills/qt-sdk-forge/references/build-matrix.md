# 构建矩阵：平台 × 版本 × 源码获取

> qt-sdk-forge 的可加载参考层。Agent 在处理"在某平台编译某版本"请求时按本页
> 决策，再走 SKILL.md 工作流执行。
> 深度环境初始化（DevEco 安装、系统依赖、ENV.local.md 生成）归
> `skills/kb-init/`；本页聚焦**源码 → SDK** 的获取与编译路径。

---

## 1. 版本 × 获取渠道决策表

先问两个问题：**要不要改 Qt 源码？**（要 → 源码编译；不要 → 预构建）
**有没有商业 license？**（有 → commercial；没有 → 只有 5.12 开源/预构建和 Qt6 安装器）

| 目标 | 获取方式 | 渠道与坐标 | CLI 命令 |
|------|----------|-----------|----------|
| Qt 5.15.16（推荐源码线） | 源码编译 | **仅商业**：`https://codereview.qt-project.org/qt/tqtc-qt5`，分支 `tqtc/harmonyos-5.15.16` | `src-clone --method commercial --version 5.15 --dest <dir> --user <U> --pass <P>` |
| Qt 5.12.12（LTS 维护线） | 源码编译 | 商业：同仓库，分支 `tqtc/harmonyos-5.12.12`；**开源**：`https://gitcode.com/ohos-qt/qt-harmonyos-src`，POSIX 构建分支 `build/macos-arm64-qt5.12.12`（LF + 构建使能补丁，macOS/Linux 默认；`main`/`5.12.12` 快照为 CRLF+丢执行位，仅 Windows 可用，见 QOH037） | `src-clone --method commercial\|opensource --version 5.12 --dest <dir>` |
| Qt 5.12.12（不改框架） | 预构建 SDK | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases`（Windows/macOS × GL/GLES，HarmonyOS × GLES） | 手动下载解压，或 `bash skills/kb-init/scripts/download-qt-sdk.sh --platform=<os> --dest <dir>` |
| Qt 6.12 | 官方预构建安装器 | Qt 在线安装器，自定义安装勾选 **HarmonyOS** target；kit 路径形如 `C:\Qt\Qt6.12-beta3\6.12.0\harmonyos_arm64_v8a` | ❌ **agent 无法自动下载**：安装器需登录 Qt 账号交互式操作，须**提示用户手动安装**，完成后 `config set sdk_root` 登记接入 |

**版本能力差异**：5.12/5.15 完整 kit（QtOhosExtras、QPA）；6.12 预构建含
libqohos QPA 与 HarmonyExtras，**缺 WebEngine/DBus/Pdf/Script**
（见 `semantic/qt-harmonyos-qt6-status.md`）。

### 商业版凭据流程（src-clone --method commercial 前置）

1. 浏览器打开 https://codereview.qt-project.org 并登录 Qt 账号
2. Settings → HTTP Credentials → GENERATE NEW PASSWORD
3. 记下用户名/密码，传给 `src-clone --user --pass`（只进内存，clone 完成后
   CLI 自动把 remote URL 还原为无凭据形式）

### 获取要点（所有源码线通用）

- 源码约 **3GB**，clone 耗时较长；磁盘预算：源码 3GB + 构建产物 5GB + SDK 2GB，**预留 ≥15GB**
- **子模块必须初始化**：`git submodule update --init --recursive`——QtOhosExtras
  在子模块中（`src-clone` 已内置此步；SV1 会校验）
- 全量编译 **30-60 分钟**（视 CPU 核数）

---

## 2. 平台 × 工具链前置

所有平台共同必需：**OHOS SDK native**（DevEco Studio 自带：
`<DEVECO>/sdk/default/openharmony/native`，须含 `llvm/bin/` 与 `sysroot/`）
+ git + cmake。CLI 的 `env` 子命令逐项检查这些。

| 平台 | 编译器 | 平台特有工具 | 关键注意 |
|------|--------|-------------|---------|
| **Windows**（主力） | MinGW（推荐 `llvm-mingw-20230919-ucrt-x86_64`） | Strawberry Perl | `MINGW_ROOT`、`PERL_ROOT` 进 PATH。mingw32-make 必须带 `SHELL=cmd.exe`——**CLI 已内置**，任何宿主 shell 下安全 |
| **macOS** (Sonoma 14+) | Xcode/clang | git ≥ 2.39.3、python ≥ 3.12 | `make -j$(sysctl -n hw.ncpu)`；configure 用 `sh <src>/configure` |
| **Linux** | OHOS SDK llvm | python3（CLI 自动 shim `python` 别名，QOH038）+ make | 编译流程与 macOS 相同（POSIX 分支）。**已实测验证**（Ubuntu 22.04 x86_64）：src-clone 默认 POSIX 构建分支 + 自动恢复执行位；configure 内置 `-no-dbus`（QOH039）+ 指纹防护自动清脏构建目录（QOH040）；`python` 由 `.qtsdk/pyshim` 自动提供 |
| **HarmonyOS PC**（鸿蒙 PC/开发板/容器） | OHOS SDK llvm | [HarmonyBrew](https://gitcode.com/Harmonybrew)（brew 的鸿蒙移植版） | `zsh -c "$(curl -fsSL https://harmonybrew.atomgit.com/install.sh)"` 后 `brew install git cmake` 等 |

CLI 平台适配已内置（`tools/qt_sdk/building.py`）：
- Windows：`cmd.exe /c configure.bat` + `mingw32-make.exe SHELL=cmd.exe`，自动注入 `NATIVE_OHOS_SDK`/`OHOS_SDK_SYSROOT`/`LLVM_INSTALL_DIR` 及 `-device-option CROSS_COMPILE=<llvm>/bin`
- POSIX（macOS/Linux/HarmonyOS）：`sh configure` + `make`

### 2.1 Linux 获取 OHOS SDK（公开渠道，无需登录）

DevEco **Command Line Tools** 需华为官网登录获取；Linux 可改用 **OpenHarmony
官方公开镜像**的 native 工具链（与 DevEco SDK 同源同构，实测可用）：

```bash
# 路径规律：https://repo.huaweicloud.com/openharmony/os/<版本>/ohos-sdk-windows_linux-public.tar.gz
# 版本选择：QOH041——Qt 移植层要求 apiVersion ≥ 23（即 ≥ 6.1）；
#   5.0.3（API 15）缺 OH_ArkUI_PointerEvent_GetGlobalDisplayX 等符号，编不过 qarkui
curl -L -o ohos-sdk.tar.gz \
  "https://repo.huaweicloud.com/openharmony/os/6.1-LTS/ohos-sdk-windows_linux-public.tar.gz"
tar xzf ohos-sdk.tar.gz ohos-sdk/linux/native-linux-x64-*.zip   # 只解 native
unzip native-linux-x64-*.zip -d . && mv native/native native-sdk
python3 tools/qt-sdk-run.py config set ohos_sdk_native <绝对路径>/native-sdk
python3 tools/qt-sdk-run.py env      # SV0 验证 llvm/bin + sysroot
```

实测基准（2026-09-19，Ubuntu 22.04）：OpenHarmony 6.1.0.35（API 23，clang 15.0.4
与官方预构建同版本）+ 本仓库 POSIX 构建分支 → SV0-SV6/SV8 全 PASS。

**低内存机器**（≤ 8GB RAM）：`config set jobs <N>`（建议 N ≈ 核数 × 2/3，实测
12 核 / 7.7GB 用 `-j8` 稳定）。

**换 SDK 后**：CLI 指纹防护会自动清构建目录（QOH040）；手动操作时务必先删
`build-<变体>` 目录。

---

## 3. 版本编译差异（CLI 参数 → configure 映射）

CLI 的 `configure --qt <V> --render <R> --build-type <T>` 内置以下差异，
Agent 不需要手拼 configure 参数；本节供评审 config.summary 时对照。

| 差异点 | Qt 5.12.12 | Qt 5.15.16 | Qt 6.12 |
|--------|-----------|-----------|---------|
| skip 列表 | 全量 skip（33 项，见 `semantic/qt-harmonyos-build.md` §Configure） | 精简 skip（27 项，同页 §Qt 5.15.16 Skip 列表） | 不适用 |
| `-c++std` | c++14 | c++14 | — |
| OpenGL | `--render gl` → `-opengl desktop`（CLI 自动检查 sysroot libGLv4.so，缺失时警告并给 gitee.com/inkuu/opengl 替换指引）；`--render gles` → `-opengl es2`；`--render gles3` → `-opengl es2 -opengles3`（显式 ES3，需 qtbase c5de1b3d+） | 同左 | — |
| OpenSSL（可选） | configure 追加 `-openssl-runtime -I<openssl头文件> -ssl`，头文件来自 [openharmony/third_party_openssl](https://gitee.com/openharmony/third_party_openssl/tree/master/include/) | 同左 | — |
| Desktop GL 构建失败缓解 | SDK/设备 ≥ API 20；从 [inkuu/opengl](https://gitee.com/inkuu/opengl/tree/mesa_headers_all) 取 `libGLv4.so` 替换 `sysroot/usr/lib/aarch64-linux-ohos/` 下同名文件后重编；app.json5 设 `NEED_OPENGL` | 同左 | — |
| SDK 输出目录名 | `Qt5.12.12-arm64-v8a[-gles|-debug]` | `Qt5.15.16-arm64-v8a[-gles|-debug]` | kit 目录名（安装器决定） |
| 本 CLI 可编译 | ✅ | ✅ | ❌（`configure --qt 6.12` 直接拒绝，仅登记/切换/跟踪） |

变体组合即多槽数学的键：`<qt>-<render>-<build_type>`（如 `5.15-gles-debug`），
每个已 configure 的变体一个独立槽（见 SKILL.md §多变体并行维护）。

---

## 4. 各平台快速路径（命令等价表）

### 4.1 从零到 SDK（任一平台）

```bash
# ① 获取源码（见 §1 决策表选渠道）
python tools/qt-sdk-run.py src-clone --method <m> --version <v> --dest <dir> [--user U --pass P]

# ② 初始化 forge 状态 + 指路
python tools/qt-sdk-run.py init
python tools/qt-sdk-run.py config set qt_src <源码根>
python tools/qt-sdk-run.py config set ohos_sdk_native <OHOS SDK native>

# ③ 编译（平台无关，CLI 内部适配 Windows/POSIX）
python tools/qt-sdk-run.py configure --qt <v> --render gl --build-type release
python tools/qt-sdk-run.py build          # 默认超时 4h，--timeout 覆盖
python tools/qt-sdk-run.py install

# ④ 门禁 + 发布 + 切换
python tools/qt-sdk-run.py verify
python tools/qt-sdk-run.py release --note "initial 5.15.16 build"
python tools/qt-sdk-run.py use <version>
```

### 4.2 无源码、只要预构建（最快上手）

```bash
# 5.12：GitCode releases 下载解压（或 kb-init 脚本）
bash skills/kb-init/scripts/download-qt-sdk.sh --platform=<macos|windows|linux> --dest <dir>
# 6.12：Qt 在线安装器勾选 HarmonyOS target

# 登记进 forge 版本管理（ENV 同步走 use）
python tools/qt-sdk-run.py config set sdk_root <解压/安装目录>
```

### 4.3 平台专属手动命令（CLI 不可用时的等价操作）

**Windows**（必须 PowerShell/cmd，或加 `SHELL=cmd.exe`）：

```powershell
$env:NATIVE_OHOS_SDK = "C:\...\openharmony\native"
$env:OHOS_SDK_SYSROOT = "$env:NATIVE_OHOS_SDK\sysroot"
$env:LLVM_INSTALL_DIR = "$env:NATIVE_OHOS_SDK\llvm"
cd <build_dir>
mingw32-make.exe SHELL=cmd.exe -j64 install    # 增量 + install 一条命令
```

**macOS / Linux / HarmonyOS**：

```bash
export NATIVE_OHOS_SDK=/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native
export OHOS_SDK_SYSROOT="$NATIVE_OHOS_SDK/sysroot"
export LLVM_INSTALL_DIR="$NATIVE_OHOS_SDK/llvm"
cd <build_dir>
make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu) install
```

完整 configure 参数原文见 `semantic/qt-harmonyos-build.md` 与
`skills/kb-init/references/qt-compile-guide.md`（含常见 configure/编译错误表）。

---

## 5. 编译排障入口

1. CLI 每步退出码非 0 → 先看 `.qtsdk/logs/<时间戳>-<步骤>.log` 尾部（state.json 里也有 tail 证据）
2. `python tools/qt-ohos-run.py analyze-log <日志>`——42 条 QOH 错误模式机器匹配，沿命中条目 `refs` 读 problems/ 知识页
3. `problems/_lookup.md` 按错误信息检索
4. 增量编译三坑（只 build 不 install / bash 跑 mingw32-make / install 后 demo 未重编）由 SV4/SV7 门禁兜底；**第四坑**（跨配置/换 SDK 复用脏构建目录，QOH040）由 CLI configure 指纹防护兜底

Linux/macOS 源码编译常见坑（均已内置预防，analyze-log 可命中）：

| QOH | 症状 | 内置预防 |
|-----|------|---------|
| QOH037 | `configure: Permission denied` / `bad interpreter ^M` / 开源镜像无 tqtc 分支 | src-clone 默认 POSIX 构建分支 + 自动恢复执行位 + CRLF 拒绝 |
| QOH038 | `python: not found`（QtQml 阶段） | build_env 自动 shim `.qtsdk/pyshim` |
| QOH039 | qdbusreply.h -Wdeprecated-copy 被 -Werror 拦 | configure 内置 `-no-dbus` |
| QOH040 | ibus 插件残留构建（unknown QDBusArgument） | configure 指纹变化自动清构建目录 |
| QOH041 | qarkui 缺 OH_ArkUI_* 符号 | 见 §2.1，SDK 需 apiVersion ≥ 23 |

---

## 6. 已验证基准

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

> 上游演进后先跑 `python tools/qt-sdk-run.py upstream-check`，基准表更新流程
> 见 SKILL.md §7.4。

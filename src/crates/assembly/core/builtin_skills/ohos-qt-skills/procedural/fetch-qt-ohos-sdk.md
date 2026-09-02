---
id: procedural-fetch-qt-ohos-sdk
type: procedural
domain: workflow
tags: [qt, harmonyos, sdk, download, toolchain, template, prebuilt]
created: 2026-08-25
updated: 2026-08-25
status: active
audience: public
refs: [procedural-qt-app-harmonyos-migration, semantic-qt-harmonyos-build, semantic-qt-harmonyos-project-structure]
summary: >
  当本地缺少 Qt OHOS SDK 或鸿蒙工程模板时，从 GitCode releases 直接 HTTP 下载预编译 SDK 和模板归档，
  免 git clone、免源码编译。含平台选择、User-Agent 要求、校验步骤和 ENV.local.md 配置。
---

# 直接下载 Qt OHOS 预编译 SDK 与模板工程

> 当 Qt 鸿蒙化迁移任务中本地环境**未提供** Qt OHOS 工具链或鸿蒙工程模板时，从 GitCode releases 页面直接 HTTP 下载预编译产物，无需 git clone 源码、无需本地编译 Qt。
>
> 本页是 [[qt-app-harmonyos-migration]] §1.3 / §1.5 的补充分支：当用户没有 Qt 源码树、没有预编译 SDK、没有模板归档时走此路径。

---

## 触发条件 / 适用场景

- 用户要迁移 Qt 应用到鸿蒙，但本地**没有** Qt OHOS SDK（`CMAKE_PREFIX_PATH` 无处指向）
- 用户**没有** Qt 源码树（无法从 `<QT_SRC>/qtbase/src/harmonyos/templates` 复制模板）
- 用户只有 DevEco Studio + HarmonyOS SDK，想用最快路径拿到可链接的 Qt 鸿蒙运行时
- CI 流水线中需要预置 Qt OHOS SDK 和模板

> 不适用：有 Qt 商业 license 的用户——应走 `skills/kb-init/` 的 commercial 路径，从源码编译获取最新补丁版 SDK。

---

## 可下载产物

所有产物来自 GitCode 仓库 [ohos-qt/qt-harmonyos-src](https://gitcode.com/ohos-qt/qt-harmonyos-src) 的 [releases/tag/v5.12.12](https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/tag/v5.12.12) 页面。

### Qt OHOS 预编译 SDK（Qt 5.12.12, GLES 渲染后端, arm64-v8a）

| 平台 | 下载 URL | 大小 | 说明 |
|------|----------|------|------|
| **Windows** | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip` | ~49 MB | Windows 上做鸿蒙交叉编译开发 |
| **macOS** | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-macos-gles.zip` | ~43 MB | macOS 上做鸿蒙交叉编译开发 |
| **HarmonyOS** | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-harmonyos-gles.zip` | ~42 MB | 鸿蒙 PC / 开发板上原生开发 |

> SDK 内含 Qt 运行时库（`libqohos.so` 等）、QPA 插件、QtOhosExtras、CMake config 文件、头文件。
> 渲染后端为 GLES（与 HarmonyOS 设备端渲染行为一致）。

### 鸿蒙工程模板

| 产物 | 下载 URL | 大小 | 说明 |
|------|----------|------|------|
| **templates-0625.zip** | `https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/templates-0625.zip` | ~240 KB | ArkTS 胶水代码、build-profile、qEmbeddedUiExtensionHost 模块 |

> 模板归档与 Qt 源码树内 `qtbase/src/harmonyos/templates` 内容相同，独立打包供无源码用户使用。

---

## ⚠️ 下载注意事项

### GitCode 要求浏览器 User-Agent

GitCode 对无 User-Agent 的 HTTP 请求（curl/wget 默认）返回 **401 Unauthorized**。下载时**必须**带浏览器 User-Agent，否则失败。

**curl 示例（正确）**：
```bash
curl -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  -o Qt-5.12.12-arm64-v8a-windows-gles.zip \
  "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip"
```

**curl 示例（错误——不带 User-Agent 会 401）**：
```bash
# ❌ 这样会失败
curl -L -o sdk.zip "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip"
```

**PowerShell 示例**：
```powershell
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
Invoke-WebRequest -Uri "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip" -OutFile "Qt-5.12.12-windows-gles.zip" -Headers @{ "User-Agent" = $ua }
```

**wget 示例**：
```bash
wget -U "Mozilla/5.0" -O sdk.zip "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/Qt-5.12.12-arm64-v8a-windows-gles.zip"
```

### 链接验证状态（2026-08-25 实测）

| 文件 | HTTP 状态 | Content-Type | 可直接下载 |
|------|-----------|--------------|-----------|
| Qt-5.12.12-windows-gles.zip | 206 Partial Content | application/x-zip-compressed | ✅ |
| Qt-5.12.12-macos-gles.zip | 206 Partial Content | application/octet-stream | ✅ |
| Qt-5.12.12-harmonyos-gles.zip | 206 Partial Content | application/zip | ✅ |
| templates-0625.zip | 206 Partial Content | application/zip | ✅ |

> 206 状态码（Partial Content）表示服务器支持 Range 请求，文件完整可下载。需带浏览器 User-Agent。

---

## 下载与安装步骤

### Step 1: 确定平台

根据开发机操作系统选择对应的 SDK：

| OS | 检测方法 | 下载文件 |
|----|---------|---------|
| Windows | `uname -s` → `MINGW*` / `MSYS*` / `CYGWIN*`；或 PowerShell `$env:OS` → `Windows_NT` | `Qt-5.12.12-arm64-v8a-windows-gles.zip` |
| macOS | `uname -s` → `Darwin` | `Qt-5.12.12-arm64-v8a-macos-gles.zip` |
| HarmonyOS | `uname -s` → `OpenHarmony` / 鸿蒙 PC | `Qt-5.12.12-arm64-v8a-harmonyos-gles.zip` |

### Step 2: 下载 Qt SDK

```bash
# 设置变量（根据平台选择）
PLATFORM="windows"  # 或 macos / harmonyos
# 脚本默认选择 BitFun 用户级共享资源目录
bash skills/kb-init/scripts/download-qt-sdk.sh --platform="${PLATFORM}"
# 从脚本输出记录 QT5_12_OHOS_SDK
```

### Step 3: 下载模板工程

```bash
# 脚本默认选择 BitFun 用户级共享资源目录
bash skills/kb-init/scripts/download-template.sh
# 从脚本输出记录 OHOS_TEMPLATE_SRC
```

### Step 4: 验证下载完整性

```bash
# 检查 SDK 关键文件存在
ls "${QT5_12_OHOS_SDK}/lib/libQt5Core.so"   # Qt Core 运行时
ls "${QT5_12_OHOS_SDK}/lib/cmake/Qt5/Qt5Config.cmake"  # CMake config
ls "${QT5_12_OHOS_SDK}/plugins/platforms/libqohos.so"  # QPA 插件

# 检查模板关键文件存在
ls "${OHOS_TEMPLATE_SRC}/build-profile.json5"
ls "${OHOS_TEMPLATE_SRC}/qEmbeddedUiExtensionHost"
```

### Step 5: 更新 ENV.local.md

下载完成后，将路径写入 `ENV.local.md`（或手动创建）：

```bash
# ENV.local.md 中添加/更新以下变量
QT5_12_OHOS_SDK=<download-qt-sdk.sh 输出的路径>
OHOS_TEMPLATE_SRC=<download-template.sh 输出的路径>
```

> `CMAKE_PREFIX_PATH` 在工程 `entry/build-profile.json5` 中指向 `${QT5_12_OHOS_SDK}`。
> 模板复制路径用 `${OHOS_TEMPLATE_SRC}` 替代 `<QT_SRC>/qtbase/src/harmonyos/templates`。

---

## 在迁移工作流中使用

下载完成后，在 [[qt-app-harmonyos-migration]] 中：

| 迁移步骤 | 正常路径（有源码） | 下载路径（本页） |
|----------|-------------------|-----------------|
| §1.3 获取模板 | `cp -r <QT_SRC>/qtbase/src/harmonyos/templates/ .` | `cp -r ${OHOS_TEMPLATE_SRC}/. .` |
| §1.5 CMAKE_PREFIX_PATH | 指向自编译 SDK | 指向 `${QT5_12_OHOS_SDK}` |
| §6 填充运行时库 | 从自编译 SDK 的 lib/ 复制 | 从 `${QT5_12_OHOS_SDK}/lib/` 复制 |

---

## 常见问题

| 问题 | 解决 |
|------|------|
| 下载返回 401 | 必须带浏览器 User-Agent（`-A "Mozilla/5.0"` 或 `-U "Mozilla/5.0"`） |
| 下载速度慢 | GitCode CDN 国内访问，通常 1-5 MB/s；如超时重试即可 |
| 解压后找不到 `libqohos.so` | 检查解压目录结构，SDK 可能在 `Qt-5.12.12/plugins/platforms/` 下 |
| SDK 版本只有 5.12.12 | Qt 5.15 需商业 license，无开源预编译版；5.12.12 足覆盖大多数迁移场景 |
| 模板与源码树模板不一致 | `templates-0625.zip` 与 `qtbase/src/harmonyos/templates` 内容相同，同步发布 |
| 需要 Desktop GL 渲染后端 | 当前 releases 仅提供 GLES 版；Desktop GL 需自行从源码编译 |

---

## 相关文档

- [[qt-app-harmonyos-migration]] — 应用迁移工作流（§1.3 模板获取、§1.5 CMake 配置）
- [[qt-harmonyos-project-structure]] — 工程结构详解（CMAKE_PREFIX_PATH、运行时库部署）
- [[qt-harmonyos-build]] — Qt 编译指南（从源码编译的完整路径）
- [[qt-harmonyos-build-run-workflow]] — 构建运行全流程
- `skills/kb-init/` — 初始化 skill（可自动完成下载，见 `scripts/download-qt-sdk.sh` 和 `scripts/download-template.sh`）

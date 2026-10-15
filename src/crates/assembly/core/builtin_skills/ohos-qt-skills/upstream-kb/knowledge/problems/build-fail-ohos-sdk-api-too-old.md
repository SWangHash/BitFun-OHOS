---
id: build-fail-ohos-sdk-api-too-old
type: problem
domain: build
status: solved
audience: public
created: 2026-09-19
updated: 2026-09-19
severity: critical
tags: [build, ohos-sdk, api-version, arkui, linux]
refs: [skills/qt-sdk-forge/references/build-matrix.md, knowledge/errors/QOH041.yaml]
error_message: "qtbase/src/plugins/platforms/ohos/qarkui/input.cpp:193:39: error: no member named 'OH_ArkUI_PointerEvent_GetGlobalDisplayX' in the global namespace"
error_code: N/A
summary: >
  Qt 鸿蒙移植的 OHOS QPA 插件（qarkui）编译期直接取 ArkUI NDK 函数地址，要求较新的
  API（实测 OpenHarmony SDK ≥ 6.1 / API 23；官方构建用 API 24 v6.1.1.125）。
  API 15（OpenHarmony 5.0.3）等旧 SDK 缺这些符号。Linux 无预构建 host 包，须从
  OpenHarmony 公开镜像取 SDK。
---

# OHOS SDK API 版本过旧，QPA 插件缺 ArkUI NDK 符号

## 症状

qtbase 编到 OHOS 平台插件（qarkui）报「符号不存在」：

```
qtbase/src/plugins/platforms/ohos/qarkui/input.cpp:193:39: error: no member named
'OH_ArkUI_PointerEvent_GetGlobalDisplayX' in the global namespace; did you mean
'OH_ArkUI_PointerEvent_GetDisplayX'?

qtbase/src/plugins/platforms/ohos/qarkui/input.cpp:219:52: error: no member named
'OH_ArkUI_HoverEvent_IsHovered' in the global namespace
```

## 原因

OHOS QPA 插件通过 `Q_OHOS_NAMED_FUNC(::OH_ArkUI_...)` 取函数地址做运行时动态
解析包装，**编译期就要求符号在 sysroot 头文件中声明**，没有低版本回退分支。
已知最低要求（按 sysroot `arkui/ui_input_event.h` 实测）：

| SDK | apiVersion | 结果 |
|-----|-----------|------|
| OpenHarmony 5.0.3.135 | 15 | ❌ 缺 `GetGlobalDisplayX/Y`、`IsHovered` 等 |
| **OpenHarmony 6.1.0.35（6.1-LTS）** | **23** | ✅ 全部存在，clang 15.0.4 与官方一致 |
| HarmonyOS SDK 6.1.1.125（官方构建用） | 24 | ✅（需华为账号，公开渠道拿不到） |

注意：编译器版本反而不是问题——5.0.3 与 6.1 的 native 工具链都是 OHOS clang 15.0.4。

## 解决方案

Linux 上获取合规 SDK（无需登录的公开渠道）：

```bash
# OpenHarmony 官方公开镜像（华为云），路径规律：
# https://repo.huaweicloud.com/openharmony/os/<版本>/ohos-sdk-windows_linux-public.tar.gz
curl -L -o ohos-sdk.tar.gz \
  "https://repo.huaweicloud.com/openharmony/os/6.1-LTS/ohos-sdk-windows_linux-public.tar.gz"

# 只解压 Linux native 工具链（tar 内是按平台/组件分的 zip）
tar xzf ohos-sdk.tar.gz ohos-sdk/linux/native-linux-x64-*.zip
unzip native-linux-x64-*.zip -d native && mv native/native native-sdk

# 登记进 forge（env 检查需 llvm/bin + sysroot）
python3 tools/qt-sdk-run.py config set ohos_sdk_native <绝对路径>/native-sdk
```

**换 SDK 后必须清构建目录**（见
[build-fail-stale-build-state](build-fail-stale-build-state.md)；新版 CLI 自动处理）。

## 验证

```bash
cat <native-sdk>/oh-uni-package.json       # apiVersion ≥ 23
grep -l "OH_ArkUI_PointerEvent_GetGlobalDisplayX" \
  <native-sdk>/sysroot/usr/include/arkui/ui_input_event.h
```

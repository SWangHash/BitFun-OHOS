---
id: build-fail-qt515-icu-detection
type: problem
domain: build
severity: high
tags: [build, icu, qt515, configure, ohos]
status: open
created: 2026-08-06
updated: 2026-08-09
summary: >
  Qt5.15 OHOS configure 阶段 ICU 检测失败（ICU=no、ures.h not found、UCNV_FROM_U_CALLBACK_SUBSTITUTE 未声明），因 sysroot 仅含 stub libicu.so 缺完整 ICU 三件套（libicui18n/libicuuc/libicudata）；解法：升级 SDK 到 26.0.0.32+ 或打 qtbase configure.json 补丁补 OHOS 专用 ICU 源。
error_message: "unable to find library -licui18n / ICU=no / ures.h not found / UCNV_FROM_U_CALLBACK_SUBSTITUTE undeclared"
related_problems: [problem-build-fail-qtnetwork-no-ssl]
audience: public
---

# Qt5.15 OHOS ICU 检测失败

## 症状

Qt5.15.16 OHOS 源码编译 configure 阶段，ICU 检测失败：

```
Checking for ICU...
  Trying source 0 (type inline) of library icu ...
    + cd /tmp/config-test-icu && /path/to/qmake ...
    + ...
    => source produced no result
  test config.libraries.icu FAILED

ICU .................................... no
```

后续编译报错：
```
error: 'ures.h' file not found
error: use of undeclared identifier 'UCNV_FROM_U_CALLBACK_SUBSTITUTE'
```

## 原因

OHOS sysroot 只合并了 stub `libicu.so`（单文件，不含 `libicui18n` / `libicuuc` / `libicudata` 三件套），导致 Qt5 configure 的 ICU 检测脚本找不到 ICU 库。

同时 `ures.h`（ICU 资源文件头）和 `UCNV_FROM_U_CALLBACK_SUBSTITUTE`（ICU 转换器回调）在 sysroot 中缺失，即使强制启用 ICU 也会在编译期报错。

## 解决方案

### 方案 A：升级 OHOS SDK（推荐）

升级 SDK 到 26.0.0.32 或更新版本，新版 sysroot 包含完整 ICU 三件套。

### 方案 B：configure.json 打补丁

修改 `qtbase/src/corelib/configure.json`，为 ICU 检测添加 OHOS 专用源：

```json
{
  "libraries": {
    "icu": {
      "label": "ICU",
      "test": {
        "main": "...(ICU test code)..."
      },
      "sources": [
        { "type": "pkgConfig", "args": "icu-uc icu-i18n" },
        { "type": "inline", "libs": ["-licuuc", "-licui18n", "-licudata"] },
        { "type": "inline", "libs": ["-licu"], "condition": "config.ohos" }
      ]
    }
  }
}
```

### 方案 C：qcollator 守卫 ures.h

在 `qtbase/src/corelib/text/qcollator_icu.cpp` 中守卫 `ures.h` 和 `UCNV_FROM_U_CALLBACK_SUBSTITUTE`：

```cpp
#if defined(Q_OS_OHOS)
// OHOS sysroot may lack ures.h; skip resource bundle loading
#else
#include <unicode/ures.h>
#endif
```

## 影响范围

- Qt5.15.16 OHOS 源码编译（Qt5.12 SDK 预编译版不受影响）
- 影响 `QCollator`（locale-aware 字符串排序）和 `QTimeZone`（时区数据）功能
- 如果 ICU=no，这两个功能会 fallback 到非 ICU 实现

## 经验教训

- OHOS sysroot 的 ICU stub 是 **合并 stub**（单 .so），不是标准的三件套（icui18n/icuuc/icudata）
- 升级 SDK 版本可能引入新的枚举偏差（见 `build-fail-ohos-sdk-enum-werror`），需同步处理
- configure 检测失败不一定代表库不存在，可能是 sysroot 布局与标准 Linux 不同

---
id: problem-build-fail-qt6-libcpp-musl-isystem
title: Qt6 OHOS target 构建卡在 libc++/musl 不兼容（-isystem sysroot/usr/include 注入）
type: problem
tags: [qt6, ohos, build, libcxx, musl, cmake, isystem, nullptr_t]
created: 2026-06-25
updated: 2026-07-13
status: solved
audience: public
summary: "Qt6 OHOS target 构建卡在 libc++/musl 不兼容（-isystem sysroot/usr/include 注入致 musl 遮蔽 clang builtin）"
severity: blocker
domain: build
error_message: "no member named 'nullptr_t' in the global namespace; use of undeclared identifier '__promote'; call to 'hypot' is ambiguous (libcxx-ohos c++/v1/cstddef, cmath; -isystem sysroot/usr/include 注入致 musl 遮蔽 clang builtin)"
refs: [semantic-qt-harmonyos-qt6-status]
---

# Qt6 for OHOS target 构建卡在 libc++/musl 不兼容

## 已绕过（2026-07-13，未定位根因）

> **状态更新**：本 BLOCKER 在推荐构建组合下**不再复现**，但根因（Qt cmake 向 target CXX 命令注入 `-isystem sysroot/usr/include`）**未修复**，仅被绕过。

- **原失败组合**（2026-06-25 复现）：Qt 6.12.0 `c7581743` + **llvm-mingw clang 22** host + **API 24** SDK + per-module `qt-cmake -G Ninja -S qtbase` 路径 → build.ninja 含 904 处 `-isystem sysroot/usr/include` → musl `<stddef.h>`/`<math.h>` 遮蔽 clang builtin → `nullptr_t`/`__promote` 崩。
- **现可用组合**（2026-07-13 验证）：同 `c7581743` + **MinGW g++ 13.1.0** host + **API 23** SDK + `qt5/configure.bat -submodules` **superbuild** 路径 → 可编译，gallery demo 真机运行通过。详见 [[qt-harmonyos-qt6-status]] §策略 B。
- **三个变量同时改变**（host 编译器 / SDK 版本 / 构建路径），**未逐一隔离确认是哪个解的**。若在原失败组合下构建，本页「根因」「已验证的修复」仍适用。

## error_message

```
C:/ohos-sdk/native/llvm/bin/../include/libcxx-ohos/include/c++/v1/cstddef:50:9: error:
  no member named 'nullptr_t' in the global namespace
  using ::nullptr_t;
        ~~^
C:/ohos-sdk/native/llvm/bin/../include/libcxx-ohos/include/c++/v1/__memory/unique_ptr.h:173:3:
  error: non-static data member cannot be constexpr; did you intend to make it const?
  error: member 'nullptr_t' declared as a template
  error: unknown type name 'nullptr_t'
C:/ohos-sdk/native/llvm/bin/../include/libcxx-ohos/include/c++/v1/cmath:544:5:
  error: use of undeclared identifier '__promote'
C:/ohos-sdk/native/llvm/bin/../include/libcxx-ohos/include/c++/v1/cmath:552:12:
  error: call to 'hypot' is ambiguous
```

## 场景

按 wiki.qt.io/Building_Qt6_for_HarmonyOS 在 Windows 上构建 Qt6 6.12（commit c7581743）for OHOS（arm64-v8a），OHOS NDK 为 DevEco 6.1.1.268 / API 24 Beta1（6.1.1.115）。host 构建成功；target 构建configure 成功，但 build 至 QtGui 的 qimage.cpp/qbitmap.cpp/removed_api.cpp（任何 `#include <algorithm>`/`<memory>` 的文件）时，libc++ 头文件连锁崩溃。

## 根因（已源码级定位）

1. **CMake/Qt 向每个 CXX 编译命令注入 `-isystem <OHOS_SDK>/native/sysroot/usr/include`**（build.ninja 的 INCLUDES 行，904 处）。隔离测试证明 OHOS toolchain 本身不注入（standalone 0 处），是 Qt 的构建逻辑注入的（注入点 `qt5/qtbase/cmake/QtTargetHelpers.cmake:189` `target_include_directories("${target}" SYSTEM ... ${arg_SYSTEM_INCLUDE_DIRECTORIES})`，但 `arg_SYSTEM_INCLUDE_DIRECTORIES` 的值的来源未最终定位——非 Qt cmake/、非 src/*/CMakeLists.txt、非 wrapper、非 CMAKE_CXX_STANDARD_INCLUDE_DIRECTORIES（为空）、非 OHOS toolchain）。

2. 该 `-isystem` 让 musl 的 `<stddef.h>`/`<math.h>`（C 头）在搜索顺序上**先于** clang 的 builtin `<stddef.h>`（resource dir `llvm/lib/clang/15.0.4/include`）和 libc++ 的 C++ 包装头，造成**遮蔽**：
   - **nullptr_t**：libc++ `<cstddef>:50` 做 `using ::nullptr_t;`，期望 `::nullptr_t` 在全局命名空间。glibc 的 `<stddef.h>` 定义它；**musl 的 `<stddef.h>` 不定义**（`grep -c nullptr_t musl/stddef.h` = 0）；clang 的 builtin `<stddef.h>` 只在 `#if defined(_MSC_EXTENSIONS) && defined(_NATIVE_NULLPTR_SUPPORTED)` 下定义（OHOS 非 MSVC，不定义）。故 `::nullptr_t` 缺失，`using ::nullptr_t;` 崩。
   - **cmath __promote**：libcxx-ohos `<cmath>` 用 `__promote`（line 544）但**未 `#include <__math/promote.h>`**（line 307-318 只 include math.h/type_traits/version/__undef_macros）——这是 libcxx-ohos 的 bug，只在 `-isystem` 改变 include 顺序、选到 musl 的 `<math.h>` 时暴露。

3. **API 22（Release 6.0.2.130）同样有此问题**（musl `<stddef.h>` 同样无 nullptr_t，libcxx-ohos 同样缺 `__math/promote.h`）。之前成功的构建用的是 **API 20**（稳定版，已不在本机）。

## 已验证的修复（隔离测试）

去掉 `-isystem sysroot/usr/include`（仅用 `--sysroot`）→ `<memory>` + `<cmath>` 干净编译（`--sysroot` 使 sysroot/usr/include 在 clang resource dir **之后**搜索，musl 不再遮蔽）。

```bash
# 失败（-isystem 注入，musl 遮蔽）
clang++ --target=aarch64-linux-ohos --sysroot=$S -isystem $S/usr/include -std=gnu++17 -c test_mem.cpp  # 20 errors
# 成功（仅 --sysroot，无 -isystem）
clang++ --target=aarch64-linux-ohos --sysroot=$S -std=gnu++17 -c test_mem.cpp                           # clean
```

部分修复（不彻底）：
- `-include nullptr_t_fix.h`（`typedef decltype(nullptr) nullptr_t;`）→ 修 nullptr_t（20→3 errors），但 cmath __promote 仍崩。
- `-I <clang resource>`（让 clang stddef.h 先找到）→ 无效（clang builtin stddef.h 非 MSVC 不定义 nullptr_t）。

## 未生效的注入式修复（均未去掉 build.ninja 的 -isystem）

| 尝试 | 结果 |
|------|------|
| `CMAKE_PROJECT_INCLUDE` 过滤 `CMAKE_CXX_IMPLICIT_INCLUDE_DIRECTORIES`（in-memory） | 过滤生效（IMPLICIT 4→2 目录），但 build.ninja 仍 904 处 -isystem（Qt 构建用 cached IMPLICIT？superproject 重新加载？） |
| 编辑 cached `CMakeCXXCompiler.cmake` 过滤 IMPLICIT + re-configure | re-configure 触发 compiler 重新检测，覆盖编辑 |
| `CMAKE_PROJECT_QTBASE_INCLUDE`（qtbase project() 后过滤） | 该 hook 只对顶层 project() 触发，不对子项目 project() 触发 |
| `CMAKE_SYSROOT` 移除（QtOHOSToolchainFixes 改 `--sysroot` 走 flags） | 无关——OHOS toolchain 本身不注入 -isystem（standalone 0），是 Qt 注入的 |

## 解决方案（待选其一）

> **实际已绕过**：改用 superbuild + MinGW g++ + API 23 组合（见上方「已绕过」段）。下列 4 项为当时未绕过时的备选，保留备查。

1. **装 API 20 稳定 OHOS SDK**（之前成功构建所用，无此 libc++/musl 问题）→ 用 DevEco SDK Manager 装 API 20，重跑 target 构建。
2. **定位 Qt 注入 `arg_SYSTEM_INCLUDE_DIRECTORIES` 的值的来源**并去除 sysroot/usr/include（需在 Qt cmake 里找 `qt_internal_add_module`/Platform 目标是否给 OHOS 加默认 SYSTEM include）。
3. **创建 `Platform/OHOS.cmake`**（CMake 警告 "System is unknown to cmake, create Platform/OHOS" 所示）控制 CMake 对 OHOS 的 include 处理，可能阻止 -isystem 注入。
4. **patch libcxx-ohos `<cmath>` 加 `#include <__math/promote.h>` + patch musl `<stddef.h>` 加 `typedef decltype(nullptr) nullptr_t;`**（SDK 头文件改动，需用户授权改 SDK）。

## 关键路径

- OHOS NDK: `C:/Program Files/Huawei/DevEco Studio/sdk/default/openharmony/native`（junction `C:/ohos-sdk`）
- libcxx-ohos: `<NDK>/llvm/bin/../include/libcxx-ohos/include/c++/v1/`
- clang builtin stddef.h: `<NDK>/llvm/lib/clang/15.0.4/include/stddef.h`（仅 MSVC 定义 nullptr_t）
- musl stddef.h: `<NDK>/sysroot/usr/include/stddef.h`（无 nullptr_t）
- 隔离测试脚本: `<LOCAL_PATH>`（`#include <memory>`）

## refs

- [[semantic-qt-harmonyos-qt6-status]]
- [[build-fail-bash-path-escape]]（同次构建的 PowerShell 参数分裂问题）

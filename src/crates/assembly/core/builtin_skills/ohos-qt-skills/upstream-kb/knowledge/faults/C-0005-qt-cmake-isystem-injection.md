---
id: fault-C-0005
cid: C-0005
type: cause
title: Qt cmake 向每个 CXX 命令注入 -isystem sysroot/usr/include（musl 遮蔽 clang builtin）
nature: defect
domain: build
fault_type: build-blocker
responsible: qt-port
co_responsible: []
component: "qtbase/cmake/QtTargetHelpers.cmake:189（target_include_directories ... SYSTEM）"
severity: blocker
evidence_type: logs
status: workaround
fix_route: "定位并去除 Qt 对 sysroot/usr/include 的 SYSTEM include 注入；或 SDK 侧修 C-0006（任一方修复即解除）"
review_note: "新 OHOS SDK / Qt 6.12 是否仍注入 -isystem；libcxx-ohos cmath 是否补 include（C-0006）"
depends_on: []
affects_qt: ["Qt 6.12.0 (c7581743)"]
affects_ohos: ["API 22 (Release 6.0.2.130)", "API 24 Beta1 (DevEco 6.1.1.268)"]
qoh: []
first_seen: 2026-06-25
review_due: 2026-10-15
created: 2026-09-14
updated: 2026-09-14
tags: [qt6, ohos, build, cmake, isystem, musl, nullptr_t, blocker, workaround]
audience: public
refs: [problem-build-fail-qt6-libcpp-musl-isystem, semantic-qt-harmonyos-qt6-status, fault-C-0006]
summary: >
  Qt 构建逻辑向每个 CXX 编译命令注入 -isystem sysroot/usr/include（build.ninja 904 处），
  使 musl C 头遮蔽 clang builtin，叠加 C-0006（libcxx-ohos cmath 缺 include）产生构建
  连锁崩溃（S-0005，all_of）。defect/qt-port（注入方）；临时方案 W-0004（换构建组合）
  已验证但未根治，注入值来源未定位。
---

# C-0005 Qt cmake 注入 -isystem sysroot/usr/include

> nature: defect ｜ 责任: qt-port ｜ 状态: workaround ｜ 表现: S-0005（与 C-0006 叠加）｜ 复核: 2026-10-15

## 表现（symptoms）

### S-0005 Qt6 OHOS target 构建连锁崩溃（nullptr_t / __promote / hypot）

按 wiki 构建 Qt6 6.12（commit c7581743）for OHOS：host 构建成功、target configure
成功，但编到 QtGui（任何 `#include <algorithm>`/`<memory>` 的文件）时 libc++ 头连锁崩溃：

```
error: no member named 'nullptr_t' in the global namespace   (cstddef:50 using ::nullptr_t)
error: use of undeclared identifier '__promote'              (cmath:544)
error: call to 'hypot' is ambiguous                          (cmath:552)
```

**致病结构**：本根因（注入改变头文件搜索顺序）+ [C-0006](C-0006-libcxx-ohos-cmath-promote.md)
（libcxx-ohos 头缺陷）**叠加**才产生完整症状（S-0005 的 cause_relation = all_of）；
任一方修复即解除。

## 根因 / 定性依据（部分定位）

- CMake/Qt 向每个 CXX 编译命令注入 `-isystem <OHOS_SDK>/native/sysroot/usr/include`
  （build.ninja 的 INCLUDES 行，904 处）。隔离测试证明 OHOS toolchain 本身不注入
  （standalone 0 处），是 Qt 构建逻辑注入；
- 注入点 `qtbase/cmake/QtTargetHelpers.cmake:189`
  `target_include_directories("${target}" SYSTEM ... ${arg_SYSTEM_INCLUDE_DIRECTORIES})`，
  但 `arg_SYSTEM_INCLUDE_DIRECTORIES` 值的**来源未定位**——非 Qt cmake/、非 src
  CMakeLists、非 wrapper、非 CMAKE_CXX_STANDARD_INCLUDE_DIRECTORIES、非 OHOS toolchain；
- 该 `-isystem` 使 musl 的 `<stddef.h>`/`<math.h>`（C 头）在搜索顺序上先于 clang
  builtin resource dir → 遮蔽：musl `<stddef.h>` 不定义 `nullptr_t`（glibc 定义）→
  libc++ `<cstddef>` 的 `using ::nullptr_t;` 崩（nullptr_t 部分）；
- `__promote`/`hypot` 部分由 C-0006 决定。

## 责任判定

`qt-port`（注入方）。与本症状的另一根因 C-0006（ohos-ndk）互为叠加责任，
**任一方修复即解除**。

## 根治方案（defect）

定位并去除 Qt 对 `sysroot/usr/include` 的 SYSTEM include 注入（需查
`qt_internal_add_module`/Platform 目标是否给 OHOS 加默认 SYSTEM include）。

## 临时方案（Workarounds）

- **W-0004（adopted，已验证 2026-07-13 构建+demo 真机；未根治）**：换构建组合——
  **MinGW g++ 13.1.0 host + API 23 SDK + `configure.bat -submodules` superbuild** →
  可编译，gallery demo 真机运行通过。

  ⚠️ 三个变量同时改变（host 编译器/SDK 版本/构建路径），**未逐一隔离确认是哪个解**；
  原失败组合（llvm-mingw clang 22 + API 24 + per-module qt-cmake）仍必现。

  隔离证据：仅 `--sysroot`（无 `-isystem`）→ `<memory>`+`<cmath>` 干净编译。
  退役条件：官方版本确认去除注入或 SDK 修 C-0006 后，恢复标准构建组合并重跑隔离测试。

## 跟踪单（Tickets）

- 尚无（注入源未完全定位，定位后按 `procedural/qt-bug-report-generation.md` 向 Qt
  侧提交；完整材料见
  [build-fail-qt6-libcpp-musl-isystem](../problems/build-fail-qt6-libcpp-musl-isystem.md)）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-25 | Qt 6.12.0 c7581743 + llvm-mingw clang 22 + API 24 Beta1 | per-module qt-cmake 构建 | 904 处 -isystem，连锁崩溃 | → open（blocker） |
| 2026-06-25 | 同上 | 隔离测试：去 `-isystem` 只留 `--sysroot` | `<memory>`/`<cmath>` 干净编译 | → diagnosed |
| 2026-07-13 | Qt 6.12.0 + MinGW g++ 13.1.0 + API 23 + superbuild | 全量构建 + gallery demo 真机 | 编译通过、demo 运行正常 | → workaround |

## 关联

- 症状（S）：S-0005（与 C-0006 叠加致病，all_of）
- 临时方案（W）：W-0004
- 跟踪单（T）：暂无
- problems：[build-fail-qt6-libcpp-musl-isystem](../problems/build-fail-qt6-libcpp-musl-isystem.md)
- semantic：[qt-harmonyos-qt6-status](../semantic/qt-harmonyos-qt6-status.md) §策略 B
- 相关根因（C）：[C-0006](C-0006-libcxx-ohos-cmath-promote.md)（ohos-ndk，叠加责任）

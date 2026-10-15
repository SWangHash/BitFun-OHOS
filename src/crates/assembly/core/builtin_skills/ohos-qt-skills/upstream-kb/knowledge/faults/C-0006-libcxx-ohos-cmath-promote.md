---
id: fault-C-0006
cid: C-0006
type: cause
title: libcxx-ohos <cmath> 使用 __promote 但缺 #include <__math/promote.h>
nature: defect
domain: build
fault_type: bug
responsible: ohos-ndk
co_responsible: []
component: "OHOS NDK libcxx-ohos include/c++/v1/cmath（line 307-318 include 列表 / line 544 __promote）"
severity: medium
evidence_type: source
status: diagnosed
fix_route: "SDK/NDK 给 libcxx-ohos <cmath> 补 #include <__math/promote.h>"
review_note: "libcxx-ohos <cmath> 是否补 __math/promote.h（随 C-0005 一并复核）"
depends_on: []
affects_qt: []
affects_ohos: ["API 22", "API 24 Beta1（libcxx-ohos）"]
qoh: []
first_seen: 2026-06-25
review_due: 2026-10-15
created: 2026-09-14
updated: 2026-09-14
tags: [ohos, ndk, libcxx, cmath, promote, build, bug]
audience: public
refs: [problem-build-fail-qt6-libcpp-musl-isystem, fault-C-0005]
summary: >
  libcxx-ohos 的 <cmath> 使用 __promote 却未 #include <__math/promote.h>——确定缺陷，
  仅在头搜索顺序被改变、选到 musl <math.h> 时暴露（即 C-0005 的 -isystem 注入场景）。
  defect/ohos-ndk，已 diagnosed（未上报）；独立无临时方案，症状随 W-0004 组合规避。
---

# C-0006 libcxx-ohos cmath 缺 __math/promote.h include

> nature: defect ｜ 责任: ohos-ndk ｜ 状态: diagnosed ｜ 表现: S-0005（与 C-0005 叠加）｜ 复核: 2026-10-15

## 表现（symptoms）

### S-0005 Qt6 OHOS target 构建连锁崩溃（nullptr_t / __promote / hypot）

本根因贡献症状中的 `__promote` / `hypot ambiguous` 部分（`nullptr_t` 部分由
[C-0005](C-0005-qt-cmake-isystem-injection.md) 的 musl 遮蔽直接决定）：

```
libcxx-ohos include/c++/v1/cmath:544:5: error: use of undeclared identifier '__promote'
libcxx-ohos include/c++/v1/cmath:552:12: error: call to 'hypot' is ambiguous
```

**致病结构**：本根因（libcxx-ohos 头缺陷）单独潜伏不发作；与 C-0005（-isystem 注入
改变头搜索顺序、选到 musl `<math.h>`）**叠加**才产生症状（S-0005 的
cause_relation = all_of）；任一方修复即解除。

## 根因 / 定性依据（源码级，已确认）

- libcxx-ohos `<cmath>` **使用** `__promote`（line 544），但 include 列表
  （line 307-318）只有 `math.h`/`type_traits`/`version`/`__undef_macros`，
  **未 `#include <__math/promote.h>`**——libcxx-ohos 的确定缺陷；
- 正常 include 顺序下不发作（`__promote` 经由其他头间接可见）；只有
  `-isystem` 改变搜索顺序、`<math.h>` 选到 musl 版本时暴露；
- API 22（Release 6.0.2.130）与 API 24 Beta1 的 libcxx-ohos 均有此缺陷。

## 责任判定

`ohos-ndk`（libcxx-ohos 头文件属 OHOS SDK/NDK）。修复随 SDK/NDK 版本发布。

## 根治方案（defect）

SDK 侧给 libcxx-ohos `<cmath>` 补一行 `#include <__math/promote.h>`。

## 临时方案（Workarounds）

- 无独立解法；症状经 W-0004（S-0005 的构建组合规避，见
  [C-0005](C-0005-qt-cmake-isystem-injection.md)）缓解。

## 跟踪单（Tickets）

- 尚无（材料见
  [build-fail-qt6-libcpp-musl-isystem](../problems/build-fail-qt6-libcpp-musl-isystem.md)，
  待按 `procedural/qt-bug-report-generation.md` 向 OHOS SDK 侧提交）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-25 | libcxx-ohos（API 22 / API 24 Beta1） | 源码审查 cmath include 列表 | 确认缺 `__math/promote.h` | → diagnosed |

## 关联

- 症状（S）：S-0005（与 C-0005 叠加致病，all_of）
- 临时方案（W）：无独立方案（随 W-0004）
- 跟踪单（T）：暂无
- problems：[build-fail-qt6-libcpp-musl-isystem](../problems/build-fail-qt6-libcpp-musl-isystem.md)
- 相关根因（C）：[C-0005](C-0005-qt-cmake-isystem-injection.md)（qt-port，叠加责任）

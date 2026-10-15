---
id: fault-C-0001
cid: C-0001
type: cause
title: qqmlplatform os() 的 #ifdef 链缺 Q_OS_OHOS 分支
nature: defect
domain: api
fault_type: bug
responsible: qt-port
co_responsible: []
component: "qtdeclarative/src/qml/qml/qqmlplatform.cpp:59（os()）"
severity: high
evidence_type: source
status: workaround
fix_route: "qtdeclarative 上游加分支 → harmonyos 分支 cherry-pick"
review_note: "harmonyos 分支 / qtdeclarative 是否已有 Q_OS_OHOS 分支"
depends_on: []
affects_qt: ["Qt 5.12.12 (613336de)", "Qt 5.15.16 (962aa625)", "Qt 6.12（os() 实现一致）"]
affects_ohos: ["全版本（与系统/API 版本无关）"]
qoh: []
first_seen: 2026-08-06
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [qt, harmonyos, qml, platform, qqmlplatform, pluginName, workaround, bug]
audience: public
refs: [semantic-qt-harmonyos-api, semantic-qt-harmonyos-platform-limits]
summary: >
  qqmlplatform.cpp os() 的 #ifdef 链缺 Q_OS_OHOS 分支，而 qsystemdetection.h 同时定义
  Q_OS_OHOS 与 Q_OS_LINUX，导致 Qt.platform.os 在鸿蒙返回 "linux"。defect/qt-port；
  临时方案 W-0001 已验证（pluginName/productType 判断），上游修复后可回收。
---

# C-0001 qqmlplatform os() 缺 Q_OS_OHOS 分支

> nature: defect ｜ 责任: qt-port ｜ 状态: workaround ｜ 表现: S-0001 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0001 QML 平台守卫静默失效（Qt.platform.os 返回 "linux"）

```qml
Qt.platform.os === "ohos"    // false（鸿蒙下 os 返回 "linux"）
Qt.platform.os === "linux"   // true，但无法区分鸿蒙与 Linux 桌面
```

用 `Qt.platform.os` 做鸿蒙平台守卫的 QML 代码**静默不生效**（无任何报错）。
同平台 `QSysInfo::productType()` 却返回 `"ohos"`——Qt 内部自相矛盾。
间接受影响：依赖 `os === "linux"` 分支的 `QFileSelector` 平台选择器。

## 根因 / 定性依据（源码级，已确认）

- `qsystemdetection.h:115-117`：`__OHOS__` 同时定义 `Q_OS_OHOS` **和** `Q_OS_LINUX`
  （同 Android 模式）；
- `qqmlplatform.cpp:59` 的 `os()` `#ifdef` 链**缺 `Q_OS_OHOS` 分支** → 命中
  `Q_OS_LINUX → "linux"`；
- 对照：`qglobal.cpp:2718` 的 `productType()` 有 `Q_OS_OHOS` 分支 → 返回 `"ohos"`。

## 责任判定

`qt-port`——鸿蒙适配引入的平台宏组合未被 qtdeclarative 的平台枚举覆盖。修复需先提
qtdeclarative 上游，再随 harmonyos 分支 cherry-pick 到各 Qt OHOS 版本。

## 根治方案（defect）

`os()` 在 `Q_OS_LINUX` 分支**之前**加：

```cpp
#elif defined(Q_OS_OHOS)
    return QStringLiteral("ohos");
```

行为变更（"linux"→"ohos"），影响依赖 `os === "linux"` 的代码与 QFileSelector，
release notes 需标注；Qt6 同样适用（`os()` 实现一致）。

## 临时方案（Workarounds）

- **W-0001（adopted，已验证 2026-08-06）**：QML 用
  `readonly property bool isHarmony: Qt.platform.pluginName === "ohos"`（QPA 插件
  key）；C++ 用 `QSysInfo::productType() == "ohos"` 或编译期 `#ifdef Q_OS_OHOS`
  （最可靠）。

  ⚠️ `pluginName` 依赖运行时加载的 QPA 插件，`-platform offscreen` 等测试环境值会变。

  退役条件：上游修复进入所用 Qt OHOS SDK 后，把 `pluginName` 判断换回
  `Qt.platform.os === "ohos"`。

## 跟踪单（Tickets）

- 尚无（未上报）。根因与建议 patch 材料齐全（见
  [qt-harmonyos-api](../semantic/qt-harmonyos-api.md)），待按
  `procedural/qt-bug-report-generation.md` 提交后在此登记 T-xxxx。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-08-06 | Qt 5.15.16 (962aa625) | 源码验证 qqmlplatform.cpp / qsystemdetection.h / qglobal.cpp | 确认缺分支；pluginName/productType 替代可用 | → workaround |

## 关联

- 症状（S）：S-0001
- 临时方案（W）：W-0001
- 跟踪单（T）：暂无
- semantic：[qt-harmonyos-api](../semantic/qt-harmonyos-api.md)（平台判断完整分析）、
  [qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)

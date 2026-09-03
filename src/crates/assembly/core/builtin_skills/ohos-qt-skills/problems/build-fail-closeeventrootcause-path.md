---
id: problem-closeeventrootcause-compile-fail
type: problem
domain: build
tags: [compile, enum-class, CloseEventRootCause, API-path]
created: 2026-06-03
updated: 2026-06-03
status: solved
audience: public
summary: "编译报错 QtOhosExtras::AbilityClose/WindowStageClose/InternalClose 枚举找不到（API 路径变更）"
severity: high

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  error: 'AbilityClose' is not a member of 'QtOhosExtras'
  error: 'WindowStageClose' is not a member of 'QtOhosExtras'
  error: 'InternalClose' is not a member of 'QtOhosExtras'
error_code: ""
keywords: [CloseEventRootCause, AbilityClose, WindowStageClose, InternalClose, enum, compile]
symptoms: "编译报错：QtOhosExtras::AbilityClose 等枚举值找不到"

# ====== 问题详情 ======
environment: "Qt 5.12/5.15 for HarmonyOS, C++14/C++17"
refs: [semantic-qt-harmonyos-lifecycle, semantic-qt-ohos-extras, semantic-qt-harmonyos-golden-rules]
related_problems: []
---

# CloseEventRootCause 短路径编译失败

## 错误信息

```
error: 'AbilityClose' is not a member of 'QtOhosExtras'
   if (cause == QtOhosExtras::AbilityClose) {
                            ^~~~~~~~~~~~~~
note: suggested alternative: 'CloseEventRootCause'
```

或类似：

```
error: 'WindowStageClose' is not a member of 'QtOhosExtras'
error: 'InternalClose' is not a member of 'QtOhosExtras'
```

## 场景

在 `closeEvent()` 处理中使用短路径 `QtOhosExtras::AbilityClose` 访问关闭原因枚举值，编译失败。

## 原因

`CloseEventRootCause` 是 C++11 `enum class`（强类型枚举），其值**不在**外层命名空间 `QtOhosExtras` 中直接可见。必须使用完整路径：

```
QtOhosExtras::CloseEventRootCause::AbilityClose       ✅
QtOhosExtras::AbilityClose                             ❌
```

这是 审计中发现的 **修正传播遗漏** 问题：`lifecycle.md`（金标准）使用了正确路径，但 `porting-workflow.md` 和 `api-mapping.md` 仍使用短路径。

## 解决方案

将所有枚举引用改为完整路径：

```cpp
auto cause = QtOhosExtras::getCloseEventRootCause(event);

// ✅ 正确：完整 enum class 路径
if (cause == QtOhosExtras::CloseEventRootCause::WindowStageClose) {
    // Level 1：用户关窗口
} else if (cause == QtOhosExtras::CloseEventRootCause::AbilityClose) {
    // Level 2：系统回收
} else {
    // InternalClose
}
```

## 注意事项

- 同样的规则适用于 `ColorThemeMode` 枚举：`QtOhosExtras::ColorThemeMode::FollowSystemSetting`（不是 `QtOhosExtras::FollowSystemSetting`）
- 黄金法则 A1/A2 明确要求完整路径
- 此问题已在 06-03 审计中全部修正（porting-workflow.md + api-mapping.md，共 6 处）

## 相关

- [[qt-harmonyos-lifecycle]] — 金标准（canonical source）
- [[qt-ohos-extras]] — CloseEventRootCause 枚举定义
- [[qt-harmonyos-golden-rules]] — 规则 A1/A2

> 📋 返回 [错误速查表](_lookup.md)

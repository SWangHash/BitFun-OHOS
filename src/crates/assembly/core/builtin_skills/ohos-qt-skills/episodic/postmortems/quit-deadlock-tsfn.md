---
id: episodic-quit-deadlock-tsfn
type: episodic
domain: postmortem
tags: [bug, quit, deadlock, TSFN, ThreadSafeFunction, handleAbilityOnDestroy, Promise, N-API, HarmonyOS]
created: 2026-06-09
updated: 2026-07-13
status: active
audience: public
refs: [semantic-qt-harmonyos-lifecycle]
summary: >
  退出死锁复盘：<STAKEHOLDER>(<PRODUCT>) qApp->quit()后应用卡死~2分钟。
  根因：HarmonyOS在Ability销毁阶段不处理N-API ThreadSafeFunction回调，
  导致qWindowDestroyPromise的resolve回调永远不被执行，Promise永不resolve。
  修复：外部补丁通过原子变量+并行轮询绕过TSFN机制，已验证有效。
  关联确认：退出流程中sensor插件触发崩溃，伙伴确认移除即规避（2026-07-13）。
---

# 退出死锁：qApp->quit() 后 handleAbilityOnDestroy Promise 永不 resolve

## 问题概述

| 项目 | 内容 |
|------|------|
| 外部 | <PRODUCT> |
| 现象 | 调用 `qApp->quit()` 后应用卡死约 2 分钟才退出 |
| Qt 版本 | 5.12.12 (tqtc/harmonyos-5.12.12, commit 613336de) |
| 设备 | 真机 |
| 根因 | HarmonyOS ArkTS runtime 在 Ability 销毁阶段不处理 TSFN 回调 |
| 修复 | 外部补丁：原子变量 + 并行轮询绕过 TSFN |

## 时间线

| 日期 | 阶段 | 产出 |
|------|------|------|
| 2026-06-05 | 收到外部反馈 | 初始排查方案（TROUBLESHOOTING_GUIDE.md） |
| 2026-06-05 | 外部确认的根因 | WINDOW_DESTROYED 时序问题 + 补丁代码 |
| 2026-06-08 | 日志深度分析 | 确认 TSFN 回调阻塞是真正根因 |
| 2026-06-08 | Demo 复现 | 堆分配 QApplication（不 delete）精确复现 |
| 2026-06-09 | 交付件整理 | <WORK_DIR>/quit-deadlock/（ISSUE.md + patch + demo） |

## 根因分析

### 表面现象

`main()` 返回后，`handleAbilityOnDestroy` 返回 Promise 给 ArkTS 框架，但 Promise 永远不 resolve，导致 ArkTS 框架 await 超时（~2 分钟）。

### 初始误判

最初认为根因是 **QApplication 未被正确析构**（堆分配且未 delete），导致 `QOhosView::destroyed` 信号不触发，`qWindowDestroyPromise` 永远 pending。

**修正**：即使 `delete app` 在 `main()` 返回前执行，QOhosView 正确析构、destroyed 信号触发、`resolveQWindowDestroyPromiseFunc` 被调用，**resolve 仍然通过 `Napi::ThreadSafeFunction::NonBlockingCall()` 投递到 JS 线程**。而 HarmonyOS 在 Ability 销毁阶段不处理这些 TSFN 回调。

### 真正根因

```
qApp->quit()
  → Qt 事件循环退出 → main() 返回
  → exit handler: invokeInJsThread(terminateAllAbilityInstances)
  → JS 线程: context.terminateSelf → 系统开始销毁 Ability
  → 系统: onDestroy → handleAbilityOnDestroy
  → handleAbilityOnDestroy 获取 qWindowDestroyPromise
  → initialPromise.onFinally(callback) 注册
  → 返回 resultPromiseDeferred->Promise() → ArkTS await

  ★ 死锁点：
    qWindowDestroyPromise 的 resolve 通过 TSFN 投递
    → ArkTS runtime 在 await 期间不处理 TSFN 回调
    → deferred.Resolve() 永远不被执行
    → initialPromise 永远 pending
    → onFinally 永远不触发
    → resultPromise 永远不 resolve
    → ArkTS 等待超时 → AbilityStage::onDestroy → _Exit(0)
```

### 关键日志证据

```
19:07:35.002  [JS thread]  handleAbilityOnDestroy → returning Promise for id='0'
19:07:35.003  [JS thread]  Tagging JS Window as closing (from: WINDOW_DESTROYED)
    ⚠️ 此后 2 分 10 秒无任何 Qt 框架日志
    ❌ "initial Promise resolved" — 从未出现
    ❌ "Qt: requested Qt app quit" — 从未出现
    ❌ "Qt: end waiting" — 从未出现（5 秒超时机制从未启动）
19:09:45.013  [JS thread]  QAbilityStage::onDestroy()
19:09:45.035  [JS thread]  AbilityStage::onDestroy: calling _Exit(0)
```

## 复现方法

**核心设计**：堆分配 QApplication，不 delete。

```cpp
int main(int argc, char *argv[]) {
    auto *app = new QApplication(argc, argv);  // 堆分配，不 delete
    // ... 创建主窗口 ...
    QTimer::singleShot(5000, []() { qApp->quit(); });
    mainWindow->show();
    int ret = app->exec();
    // 不 delete app
    return ret;
}
```

**关键发现**：`delete app` **不能解决**此问题。原因是 resolve 回调通过 TSFN 投递，被 ArkTS runtime 阻塞，与 QApplication 是否析构无关。

## 修复方案

### 外部补丁（已验证有效）

**核心思路**：绕过 TSFN，用原子变量 + 并行轮询直接检测 Qt 线程状态。

1. 新增 `std::atomic_bool s_qtAppThreadIdle{true}`
2. `main()` 开始 → `false`，`main()` 返回 → `true`
3. `handleAbilityOnDestroy` 中：
   - 如果 `s_qtAppThreadIdle.load() == true` → 直接 `continueDestroyFlow`
   - 启动并行轮询任务：独立线程每 100ms 检查，如果 Qt idle → `continueDestroyFlow`
4. `continueDestroyFlow` 用 `compare_exchange_strong` 防止重复执行

### 为什么有效

- 不依赖 TSFN 回调（绕过了被阻塞的通道）
- 原子变量是跨线程安全的，无需 JS 线程处理
- 并行轮询在独立线程运行，不受 ArkTS runtime 影响

## 经验教训

1. **不要假设 delete app 能解决所有退出问题** — 根因可能在更底层的运行时行为
2. **日志中的"缺失"比"存在"更有诊断价值** — 三条关键日志的"不存在"直接指向了死锁点
3. **跨线程通信机制（TSFN）在系统生命周期特定阶段可能失效** — 这是 HarmonyOS 平台特有限制
4. **Demo 复现必须精确匹配实际场景** — 局部变量 QApplication 无法复现，必须堆分配
5. **提交 Tqtc 的交付件必须包含可复现问题的 demo** — 已写入工作流铁律

## 关联崩溃确认：退出流程中 sensor 插件触发崩溃

> 2026-07-13 与伙伴确认。与本文 quit-deadlock 同属 Ability 销毁阶段的退出路径问题，并入本页沉淀。

| 项目 | 内容 |
|------|------|
| 外部 | 同上文 quit-deadlock 伙伴 |
| 现象 | 应用退出流程中触发崩溃 |
| 根因 | 应用集成的 sensor 插件（来源未确认：Qt Sensors 模块后端 / 伙伴自研 / 第三方，未深查）在退出阶段触发崩溃 |
| 验证 | 伙伴确认：去掉 sensor 插件后崩溃消失 |
| 确认日期 | 2026-07-13 |

### 确认结论

跟伙伴确认：**sensor 插件去掉后不会崩了**。

- 崩溃发生在应用退出流程中，与本文 quit-deadlock 同属 Ability 销毁阶段这一高风险退出窗口
- quit-deadlock 已揭示 HarmonyOS 在 Ability 销毁阶段不 pump TSFN 回调，多条正常路径在该窗口失效/异常；sensor 插件在此窗口触发的崩溃属同类退出阶段问题
- sensor 插件具体来源未进一步深查——移除即规避，伙伴已接受此解法

### 待办（若后续需保留 sensor 功能）

- 深查该 sensor 插件在退出阶段崩溃的具体机理：析构顺序 / TSFN 残留回调 / 后端硬件资源释放时序，参照本页退出路径分析
- 退出阶段是 HarmonyOS + Qt 的高风险窗口：凡涉及回调投递、跨线程、动态资源释放的插件，在该窗口都应做防御性处理（参照本页"原子变量 + 并行轮询绕过 TSFN"思路）

## 交付件

```
<WORK_DIR>/quit-deadlock/
├── ISSUE.md              # 中英双语根因分析
├── patches/
│   └── 0001-*.patch      # 外部补丁（git diff 格式）
├── demo/
│   ├── ohos-repro/       # OHOS 完整工程（可编译部署）
│   └── qt-repro/         # 桌面版（代码审查用）
└── README.md             # 交付件概览
```

## 相关上下文

- 框架问题分析工作流
- [[qt-harmonyos-lifecycle]] — 生命周期详解
- 外部日志：`<log-dir>/destroyError20260608_*.log`
- Demo 源码：`<demos-dir>/quit-signal-repro/`

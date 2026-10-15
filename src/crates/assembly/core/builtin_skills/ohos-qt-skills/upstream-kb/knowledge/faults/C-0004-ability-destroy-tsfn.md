---
id: fault-C-0004
cid: C-0004
type: cause
title: Ability 销毁窗口不处理 N-API TSFN 回调（Promise resolve 通道被阻塞）
nature: undetermined
domain: lifecycle
fault_type: hang
responsible: ohos-runtime
co_responsible: []
component: "HarmonyOS ArkTS runtime × N-API ThreadSafeFunction（Ability 销毁窗口）"
severity: critical
evidence_type: both
status: reported
fix_route: "若定性 defect：系统侧在销毁窗口处理/排空 TSFN 回调；若定性 limitation：W-0003 转正为长期方案"
review_note: "伙伴/系统侧答复；新系统版本销毁窗口 TSFN 行为；定性改判（CID 不变）"
depends_on: []
affects_qt: ["Qt 5.12.12 (613336de)"]
affects_ohos: ["真机（系统版本未记录）"]
qoh: []
first_seen: 2026-06-05
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [qt, harmonyos, quit, deadlock, TSFN, ThreadSafeFunction, N-API, Promise, handleAbilityOnDestroy, workaround]
audience: public
refs: [episodic-quit-deadlock-tsfn, semantic-qt-harmonyos-lifecycle]
summary: >
  qWindowDestroyPromise 的 resolve 经 TSFN 投递，而 HarmonyOS 在 Ability 销毁阶段不
  处理 TSFN 回调，Promise 永不 resolve，ArkTS await 超时兜底（卡死 ~2 分钟）。
  nature 未定（倾向 limitation：系统行为，Qt 侧无法根治），等系统侧定性后改判；
  临时方案 W-0003（轮询补丁）已验证，跟踪单 T-0001（伙伴交付件）已提交。
---

# C-0004 Ability 销毁窗口不处理 TSFN 回调

> nature: undetermined（倾向 limitation）｜ 责任: ohos-runtime ｜ 状态: reported ｜ 表现: S-0004 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0004 qApp->quit() 后退出卡死约 2 分钟（Promise 永不 resolve）

调用 `qApp->quit()` 后应用卡死约 2 分钟才退出。日志特征：`handleAbilityOnDestroy`
返回 Promise 后 **2 分 10 秒无任何 Qt 框架日志**，"initial Promise resolved" 从未出现，
最终 `AbilityStage::onDestroy → _Exit(0)` 兜底退出。

## 根因 / 定性依据

```
qApp->quit() → Qt 事件循环退出 → main() 返回
  → invokeInJsThread(terminateAllAbilityInstances) → context.terminateSelf
  → 系统 onDestroy → handleAbilityOnDestroy 返回 resultPromise → ArkTS await
  ★ qWindowDestroyPromise 的 resolve 经 Napi::ThreadSafeFunction::NonBlockingCall() 投递
  ★ ArkTS runtime 在 await 期间不处理 TSFN 回调 → deferred.Resolve() 永不执行
  → Promise 永远 pending → ArkTS 等待超时（~2 分钟）
```

注意：`delete app` **不能**解决——resolve 回调走 TSFN 通道被阻塞，与 QApplication
是否析构无关（已用堆分配/不 delete 的 demo 精确复现验证）。

**定性状态**：系统行为实证成立；"这是缺陷还是设计如此"未取得官方定性。
倾向 `limitation`（销毁窗口不 pump TSFN 像运行时设计约束）——系统侧答复后改判，
CID 不变。

## 责任判定

`ohos-runtime`——ArkTS runtime 在 Ability 销毁窗口不 pump TSFN 回调，属系统运行时
行为，Qt 侧无法根治、只能绕过。修复（若定性为 defect）随系统/SDK 版本到达。

## 根治方案（若定性为 defect）

系统侧：Ability 销毁 await 窗口内继续处理（或排空）TSFN 回调。

## 替代方案与演进（若定性为 limitation）

W-0003 轮询补丁转正为长期方案；退出阶段凡涉及回调投递/跨线程/动态资源释放的插件
都做防御性处理（参照"原子变量+并行轮询"思路）。

## 临时方案（Workarounds）

- **W-0003（adopted，已验证 2026-06-09 真机）**：绕过 TSFN——
  1. `std::atomic_bool s_qtAppThreadIdle{true}`（`main()` 进入置 false、返回置 true）；
  2. `handleAbilityOnDestroy` 中：Qt 已 idle 则直接 `continueDestroyFlow`；否则独立线程
     每 100ms 轮询，idle 即触发；
  3. `continueDestroyFlow` 用 `compare_exchange_strong` 防重入。

  完整实现见 [quit-deadlock-tsfn](../episodic/postmortems/quit-deadlock-tsfn.md)。
  退役条件：确认所用 HarmonyOS 版本已在销毁窗口处理 TSFN 后，移除轮询补丁并回归
  退出测试。

## 跟踪单（Tickets）

- **T-0001（partner，submitted 2026-06-09）**：ISSUE.md（中英双语根因）+ patches/ +
  ohos-repro/qt-repro 可复现 demo 交付件（`<WORK_DIR>/quit-deadlock/`，内部路径见
  复盘页）；等系统侧定性。
- 关联确认（2026-07-13）：同一销毁窗口 sensor 插件触发崩溃，移除即规避——同属
  Ability 销毁高风险退出窗口问题（机理未深查，若需保留 sensor 功能再立案）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-08 | Qt 5.12.12 / 真机 | 堆分配 QApplication demo 精确复现 | 复现成功，锁定 TSFN 阻塞 | → diagnosed |
| 2026-06-09 | Qt 5.12.12 / 真机 | 原子变量 + 并行轮询补丁 | 退出正常，不再卡死 | → workaround |
| 2026-06-09 | — | ISSUE + patch + demo 交付伙伴（T-0001） | 已上报 | → reported |

## 关联

- 症状（S）：S-0004
- 临时方案（W）：W-0003
- 跟踪单（T）：T-0001
- episodic：[quit-deadlock-tsfn](../episodic/postmortems/quit-deadlock-tsfn.md)
  （完整时间线、补丁实现、日志证据）
- semantic：[qt-harmonyos-lifecycle](../semantic/qt-harmonyos-lifecycle.md)

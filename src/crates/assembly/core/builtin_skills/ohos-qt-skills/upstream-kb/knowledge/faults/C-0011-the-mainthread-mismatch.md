---
id: fault-C-0011
cid: C-0011
type: cause
title: theMainThread 与 QCoreApplication::instance()->thread() 指向不同 QThread（QtMainThread thread-local 被清除重建）
nature: undetermined
domain: runtime
fault_type: crash
responsible: undetermined
co_responsible: []
component: "qtbase corelib qcoreapplication.cpp（sendThroughApplicationEventFilters Q_ASSERT / theMainThread）× qthread_unix.cpp QThreadData::current() × OHOS QPA qohosjsmain.cpp（QtMainThread 创建与 init lambda）"
severity: high
evidence_type: source
status: diagnosed
fix_route: "若定性 app：main() 约束文档化；若定性 qt-port：QPA 构造校验 theMainThread==currentThread + guard 增强日志；若定性 ohos-runtime/ohos-ndk：随系统或 NDK 版本修复"
review_note: "触发路径三假说未定（app 在 QApplication 前调 Qt API / Qt 内部清 thread-local / OHOS thread_local 行为），补探针日志后改判（CID 不变）；证据仅源码定位，提单或改判前必须补 demo/logs；Release 构建不崩易漏报"
depends_on: []
affects_qt: ["Qt 5.15.16 (tqtc/harmonyos-5.15.16)"]
affects_ohos: ["未记录（伙伴反馈案例，设备/系统版本未留）"]
qoh: [QOH028]
first_seen: 2026-06-13
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [qt, harmonyos, threading, qcoreapplication, Q_ASSERT, theMainThread, QtMainThread, thread-local, dual-thread, debug-build, undetermined]
audience: public
refs: [problem-ohos-mainthread-mismatch, semantic-qt-harmonyos-overview]
summary: >
  Debug 构建鼠标点击事件在 QCoreApplicationPrivate::sendThroughApplicationEventFilters
  触发 Q_ASSERT：theMainThread（init lambda 首个 QThreadData::current() 设定为
  QAdoptedThread_A）与 QCoreApplication::instance()->thread()（QAdoptedThread_B）指向
  不同 QThread，说明 QtMainThread 的 thread-local currentThreadData 在两者之间被清除
  重建，触发方未定位。undetermined（app 误用 / qt-port 线程防御 / ohos-runtime
  thread_local 三假说）；机制已源码定位（diagnosed），W-0009（QApplication 前置
  约束）仅 proposed，无跟踪单。
---

# C-0011 theMainThread 与 instance()->thread() 不匹配

> nature: undetermined ｜ 责任: undetermined ｜ 状态: diagnosed ｜ 表现: S-0010 ｜ 方案: W-0009（proposed） ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0010 QWidget 应用 Debug 构建鼠标点击即崩（sendThroughApplicationEventFilters Q_ASSERT）

- 鼠标点击/触摸事件分发时崩溃，触发 `Q_ASSERT(receiver->d_func()->threadData.loadAcquire()->thread.loadRelaxed() == mainThread())`（`QCoreApplicationPrivate::sendThroughApplicationEventFilters()`，qcoreapplication.cpp:1160）；
- Debug 构建必崩，Release 构建不崩（Q_ASSERT 被编译掉——问题被遮蔽，易漏报）；
- 打印 `QThread::currentThread()`、事件发送线程、接收线程**看起来都是** Qt 主线程；但 `mainThread()`（theMainThread=QAdoptedThread_A）**不等于** `QCoreApplication::instance()->thread()`（QAdoptedThread_B）；
- 影响范围：所有 QWidget 应用（Debug 构建）；伙伴反馈的实际崩溃案例。

## 根因 / 定性依据（源码级调用链，机制已定位、触发路径未定）

机制：

```
OHOS 双线程模型：ArkTS UI 线程（生命周期/NAPI 回调） + QtMainThread（Qt 事件循环/用户 main()）
  → SingleThreadExecutor 创建 "QtMainThread"（qohossinglethreadexecutor.cpp:108-135）
  → init lambda 在 QtMainThread 上执行 QThread::currentThread()
    → 首个 QThreadData::current() 设定 theMainThread = QAdoptedThread_A（qthread_unix.cpp:224-225）
  → 用户 main() 在 QtMainThread 上运行 → QApplication 构造 → QObject → QThreadData::current()
  → 正常：返回同一 QAdoptedThread_A（instance()->thread() == theMainThread ✓）
  → 实际：返回 QAdoptedThread_B ≠ theMainThread
    → 说明 thread-local currentThreadData 在 init lambda 与 QApplication 构造之间被清除并重建
  → 事件分发：notify_helper 的 guard（:1213）通过，sendThroughApplicationEventFilters 的
    Q_ASSERT（:1160）失败——两处检查仅内存序不同，单线程正常场景不可能一过一败
```

触发路径三假说（均未定）：

1. 用户在 main() 中 QApplication 构造**前**调用了某些 Qt API（`qDebug`、QObject/QSettings 构造、`QThread::currentThread()` 等会触发 `QThreadData::current()` 的调用）——伙伴**已确认其代码存在此情况**，但未验证移除后崩溃消失；
2. 某些 Qt 内部初始化路径导致 thread-local data 意外清除/重建；
3. OHOS/musl `thread_local` 实现在特定场景下的行为差异。

定性状态：机制已源码定位；**nature 与责任未定**——改判证据到位后改判，CID 不变。

证据形态：`source`（源码 file:line 调用链分析 + 伙伴反馈崩溃案例的 Q_ASSERT 原文）；**无留档 faultlog 栈、无最小复现 demo**——问题页诊断步骤（三处探针打印 + main() 前置调用排查）已设计、输出未留档。本问题属运行时行为异常（非静态可判定类），source 仅作过渡记录：提单或定性改判前必须补 demo/logs。

## 责任判定

`undetermined`——三假说对应三种归层与处置：

| 假说 | 若成立 | 处置分类 |
|------|--------|---------|
| ① app 在 QApplication 前调 Qt API | responsible=app | 应用使用问题 |
| ② Qt 内部初始化清除 thread-local | responsible=qt-port / qt-upstream | Qt 问题 |
| ③ OHOS thread_local 行为差异 | responsible=ohos-runtime / ohos-ndk | 系统问题 |

已有事实仅"伙伴确认 QApplication 前存在 Qt API 调用"，未验证因果，不足以定责 app。改判路径：按问题页诊断步骤补三处探针日志（断言处 / init lambda / QApplication 构造后）→ 锁定清除/重建 thread-local 的调用方 → 定性改判（CID 不变）。

## 根治方案（若定性为 defect）

- 假说②：Qt 5.15 OHOS 分支在 `QOhosPlatformIntegration` 构造时校验 `theMainThread == QThread::currentThread()`（防御性检查）；`notify_helper()` guard 增强为详细错误日志而非直接 Q_ASSERT；
- 假说①③：分别归应用侧修复 / 系统侧 thread_local 行为确认。

## 替代方案与演进（若定性为使用约束）

若最终定性为"OHOS 双线程架构下的使用约束"：文档化 main() 约束（QApplication 必须是第一个 Qt API 调用），W-0009 转正为长期规范；QPA 防御性检查作为加固项一并落地。

## 临时方案（Workarounds）

- **W-0009（proposed，未验证）**：确保 `QApplication` 是 main() 中的**第一个** Qt API 调用——构造 QApplication 前不调用任何触发 `QThreadData::current()` 的 Qt API（`qDebug`、QObject/QSettings 构造、`QThread::currentThread()` 等；QString 等不触发 thread data 的类型安全）：

  ```cpp
  int main(int argc, char *argv[])
  {
      QApplication app(argc, argv);   // 第一个 Qt 调用
      // 之后才能使用其他 Qt API
      return app.exec();
  }
  ```

  代价：既有 main() 前置 Qt 调用需重排；本方案针对假说①，根因未定不保证生效。
  退役条件：根因确认并根治（或定性为约束并文档化转正）后，撤销临时约束并回归 Debug 构建点击测试。

## 跟踪单（Tickets）

- 暂无。未上报——证据不满足提单门禁（须先补 demo/logs）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-13 | Qt 5.15.16 (tqtc/harmonyos-5.15.16) / OHOS（伙伴反馈案例，设备未记录） | 源码级调用链分析：guard 通过 / assert 失败的矛盾点 → theMainThread 不匹配机制 | 机制定位：theMainThread（QAdoptedThread_A）≠ instance()->thread()（QAdoptedThread_B），thread-local 被清除重建、触发方未定 | → diagnosed |

（历史事实来源：[ohos-mainthread-mismatch](../problems/ohos-mainthread-mismatch.md)（2026-06-13 建、2026-07-04 更新，status: open）；主编合入时按门禁在本表首行登记审核复现。）

## 关联

- 症状（S）：S-0010
- 临时方案（W）：W-0009（proposed）
- 跟踪单（T）：暂无
- problems：[ohos-mainthread-mismatch](../problems/ohos-mainthread-mismatch.md)（诊断步骤、源码引用表、ArkTS 生命周期 → C++ 回调映射）
- semantic：[qt-harmonyos-overview](../semantic/qt-harmonyos-overview.md)
- QOH（机器层）：QOH028（mainthread_mismatch_assert）
- 相关根因（C）：无

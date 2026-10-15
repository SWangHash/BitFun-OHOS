---
id: problem-runtime-ohos-ime-reset-detach
type: problem
domain: runtime
tags: [ime, inputmethod, qohosinputcontext, reset, detach, 拼音, preedit, 探针, hilog, imf]
created: 2026-09-12
updated: 2026-09-12
status: solved
severity: high
audience: public
refs: [fault-C-0002, fault-C-0003, problem-build-qt612-ohos-plugin-rebuild]
summary: >
  Qt 6.12-beta3 ohos 平台插件 QOhosInputContext::reset() 里 Detach/Attach 输入法
  控制器，在拼音组合中途把软键盘收起（handlePanelHiding），且 commit() 把 pending
  拼音字母强制上屏污染文本。修复对齐 Android 插件行为：reset 只 finalize preedit、
  不 detach。同时沉淀 IMF 探针排查法（IMEPROBE）与「中文搜索搜不到」的定性结论
  （服务器不索引中文短词全局搜索，非移植 bug）。
leader_summary: >
  修 Qt ohos 插件 IME reset 的 Detach/Attach bug + IMF 回调探针排查法 + 中文搜索无结果的三角验证定性
impact: [输入法, 平台后端, 排查方法论]
deliverables: [problem记录]
evidence: []

error_message: >
  症状（hilog）：组合输入期间 inputMethod 侧出现 handlePanelHiding（键盘被收起）、
  Qt 侧 showTextInput 重复触发 8+ 次、光标跳到编辑区底部、最终上屏文本混入拼音字母。
  hilog 关键行：IMEPROBE cb setPreviewText / IMEPROBE insertText raw=[...] 交叉比对。
error_code: ""
keywords: [QOhosInputContext, reset, detach, attach, commit, preedit, setPreviewText, insertText, IMF, inputmethod_controller_capi, hilog, 拼音, 中文输入]
symptoms: "OHOS 上 Qt 应用拼音打字时键盘中途收起 / 拼音字母混入最终文本 / 搜索框查询词被污染导致搜不到"
environment: "HarmonyOS PC (MateBook Pro, 物理键盘) + Qt 6.12-beta3 harmonyos kit libqohos.so + 华为输入法"
---

# Qt ohos 插件 IME reset() 的 Detach/Attach bug 与 IMF 探针排查法

## 症状

- 拼音组合输入进行到一半，软键盘被系统收起（inputMethod 日志 `handlePanelHiding`）；
- 选词上屏后文本里混入拼音字母（如「ji极速搜索」），污染搜索框查询词；
- Qt 侧 `showTextInput` 被重复触发 8+ 次，光标跳到编辑区底部。

## 根因（Qt 6.12-beta3 `qohosinputcontext.cpp`）

`reset()` 原实现：

```cpp
void QOhosInputContext::reset()
{
    setImConnectionState(Detached);   // ← OHOS IMF 的 Detach 会直接收起软键盘
    setImConnectionState(Attached);
}
```

两个叠加问题：

1. **Detach 收起面板**：OHOS IMF 的 `OH_InputMethodController_Detach` 语义比 Android
   激进——组合中途 detach 直接塌掉键盘面板，打断候选词选择。
2. **commit 污染文本**：`commit()` 把 `m_pendingPreeditText`（拼音组合期的原始
   字母 preview）强制 `setCommitString` 上屏。

## 修复（对齐 Qt Android 插件行为）

```cpp
void QOhosInputContext::reset()
{
    // 只收尾未决 preedit，不 detach/attach，保持 IMF 连接与面板状态
    if (!m_pendingPreeditText.isEmpty())
        commit();
}
```

重编 libqohos.so 并按
[build-qt612-ohos-plugin-rebuild](build-qt612-ohos-plugin-rebuild.md) 的流程替换
kit 部署。

## IMF 探针排查法（IMEPROBE，可复用）

hilog 默认不打印 IMF 回调内容，且**应用进程日志里看不到任何文本回调**——必须自己
加探针。两个层面：

**① 回调入口层**（`qohosinputmethodproxy.cpp`，证明 IMF 是否回调、参数长度）：

```cpp
// OH_TextEditorProxy_SetInsertTextFunc 的 lambda 里：
qOhosPrintfDebug("IMEPROBE cb insertText len=%zu", length);
// SetSetPreviewTextFunc / SetFinishTextPreviewFunc 同理
```

**② context 层**（`qohosinputcontext.cpp`，证明字符串内容与流向）：
reset/commit/sendInsertedTextToQt/sendInsertedPreviewTextToQt/pushTextAroundCursorToProxy
加探针，配一个 **码点转义 helper** 让 hilog 显示精确内容（避免编码问题误导）：

```cpp
QString imeProbeEscape(const QString &s)   // 'd'=ASCII 原样，其余 \uXXXX
```

**③ 抓取与判读**：`hdc shell hilog` 抓 60-90s 窗口（Python 后台线程收集，避免
PowerShell 对无 BOM UTF-8 的中文匹配失真），判读顺序：

```
cb setPreviewText（组合期，拼音字母，正常）
→ cb insertText raw=[\u6781 \u901f ...]（选词提交，码点应为最终中文）
→ pushText left=[...]（Qt 查询字段内容）
```

本次实测：`insertText raw=[\u6781 \u901f \u641c \u7d22]`（极速搜索）+ `pushText`
一致 → **IME 提交链路干净**，排除了编码/污染假设，把问题定位收敛到应用层。

## 已知未修问题：焦点切换瞬间丢首字符

探针时序中观察到：focus 切换瞬间（Detach→Attach 竞态）有一次
`previewText raw=[j]` 后紧跟 `commit pending=[j]`——首字母被 commit 给了旧的 focus
object（此刻 pushText left=[] 为空，新字段还没接上）。表现为偶发丢首字。待上游或
本地进一步修复（思路：commit 前校验 focus object 的 ImEnabled 查询结果）。

## 附：「中文搜索搜不到」的定性方法（非移植 bug）

某 IM 客户端移植版中文搜索无结果时的**三角验证**方法，供同类问题参考：

| 测试 | 结果 | 结论 |
|------|------|------|
| 本地会话搜索中文单字 | 命中已加入会话 | 本地 CJK 索引正常 |
| 远端全局搜索中文短词 | 无结果 | 见下 |
| 官方客户端（同账号）搜同样词 | 同样无结果 | **服务器不索引中文短词全局搜索，非移植 bug** |
| 拉丁词查询 | 有结果 | 远端链路正常 |

**方法要点**：应用层"功能异常"先用**官方客户端同账号对照**定性——官方同样不行的，
是服务端/应用设计行为，不是移植引入的 bug。

## 应用侧日志排查（通用方法）

`hdc file recv` 拉取应用私有目录日志（`/data/app/el2/100/base/<bundle>/` 下，
具体文件名因应用而异），看应用自身错误码（如 RPC Error）区分客户端 bug
与服务器行为（FLOOD_WAIT / PEER_ID_INVALID / USER_NOT_PARTICIPANT 等）。

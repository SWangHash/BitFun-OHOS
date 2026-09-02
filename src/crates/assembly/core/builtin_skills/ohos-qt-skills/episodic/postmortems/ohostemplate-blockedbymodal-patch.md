---
id: episodic-ohostemplate-blockedbymodal-patch
type: episodic
domain: postmortem
tags: [bug, blockedByModalWindow, QDialog, transientParent, qpa, syntheticParent, three-level-window, ohostemplate, matplotlib, qt515, patch, qt, harmonyos]
created: 2026-08-06
updated: 2026-08-06
status: active
audience: public
refs: [semantic-qt-harmonyos-window-model, problem-runtime-blocked-by-modal-window-no-parent]
summary: >
  ohostemplate matplotlib 三级窗口(Configure subplots->Export values)关不掉。根因：无 parent 的 QDialog 经
  syntheticParent fallback 分类为 SubWindow，但 OHOS QPA 从不调 setTransientParent() 反写 Qt 层，
  导致 blockedByModalWindow=1 拦截 close()。Qt 源码修复：showImmediate() 在 fallback 后反写
  transientParent（约8 行 qohosview.cpp），设备日志验证 blockedByModalWindow=0、close()=1。
  同时发现并修复 ArkTS 模板版本不匹配崩溃（modules->modulesFactories）。
leader_summary: >
  Qt源码层修复三级窗口关不掉问题（blockedByModalWindow），patch 设备验证通过，产出可提交 tqtc 的源码 patch
impact: [框架支撑, 商业答复]
deliverables: [patch, 源码分析报告, 风险评估, 交付目录]
evidence: [ohos-qt-patch-delivery, hilog 日志 17:39 验证链]
---

# ohostemplate blockedByModalWindow Qt 源码修复

> ohostemplate 中 matplotlib 三级窗口（Configure subplots -> SubplotToolQt -> Export values）关不掉。
> Qt 源码层修复 `blockedByModalWindow` 根因，设备日志验证通过。

## 一、问题背景

08-04 分析发现 matplotlib `_export_values()` 创建 `QDialog()` 无 parent，走 syntheticParent fallback 分类为 SubWindow。
hilog 43844 行验证确认三级窗口关闭时链路在 `onSubWindowCloseHandler: calling close()` 处断裂。

08-06 进入 Qt 源码层定位，发现真正根因不是"close 不执行"，而是 **Qt 层的 blockedByModalWindow 机制直接拦截了 close**。

## 二、根因链（源码实证）

```
QDialog() 无 parent
  -> Qt 层 QWindow::transientParent() == nullptr
  -> OHOS QPA determineViewTypeAndLogicalParent() 用 syntheticParent fallback 分类为 SubWindow
  -> syntheticParent 传给 createSubWindow（ArkUI 层建立归属）
  -> OHOS QPA 从不调 QWindow::setTransientParent() 反写 Qt 层
  -> Qt 层 transientParent 仍为 null
  -> isWindowBlocked() 的 isAncestorOf() 检查失败
  -> blockedByModalWindow = 1
  -> processCloseEvent() if (blocked) return -> close 不执行
```

### 关键源码位置

| 文件 | 行号 | 代码 | 作用 |
|------|------|------|------|
| qohosview.cpp | 252-261 | `syntheticParentForQWindowOrNull()` | fallback 找 syntheticParent |
| qohosview.cpp | 390-471 | `tryCreateWindowProxyIfNeeded()` | 用 syntheticParent 创建 ArkUI subWindow |
| qguiapplication.cpp | 899-958 | `isWindowBlocked()` | 检查 parent 链判断是否阻塞 |

### Win vs OHOS 对比（修正 08-04 的错误认知）

之前 08-04 分析认为"Win32 自动匹配 parent"是**错误的**。实际：
- Win32 的 `CreateWindowEx(parent=NULL)` 自动设 owner=GetActiveWindow()，但 owner 不进 Qt parent 链
- 两边 blockedByModalWindow 逻辑链**一致**
- 唯一真正差异：Win32 窗口管理器有兜底，OHOS 没有

## 三、修复方案

### 方案选择（3 选 1）

| 方案 | 改动 | 风险 | 推荐 |
|------|------|------|------|
| 1. OHOS QPA showImmediate 反写 transientParent | 约8 行 qohosview.cpp | 低 | **推荐** |
| 2. OHOS QPA 重写 isAncestorOf | 约20 行 qohosplatformwindow.cpp | 中 | 否 |
| 3. Qt GUI kernel processCloseEvent 加 OHOS 条件 | 约10 行 qguiapplication.cpp | 高（改共享代码） | 否 |

### 方案 1 代码

```cpp
// [OHOS FIX] After syntheticParent fallback, reflect to Qt transientParent
if (currentViewTypeInfo.viewType == SubWindow
    && currentViewTypeInfo.syntheticParent
    && m_ownerWindow->transientParent() == nullptr) {
    auto *tpWindow = currentViewTypeInfo.syntheticParent->qWindow();
    if (tpWindow && tpWindow != m_ownerWindow)
        m_ownerWindow->setTransientParent(tpWindow);
}
```

### 方案 1 风险评估（10 场景）

| 场景 | 结果 | 说明 |
|------|------|------|
| 有 parent 的 QDialog(this) | 跳过 | 条件不满足（transientParent 已有值） |
| 无 parent 的 QDialog() | **修复目标** | transientParent==null 则设置 |
| ToolTip/Popup | 不受影响 | popupType 排除 |
| 普通 QWindow | 跳过 | 不在 fallback 列表 |
| 首个窗口 | 跳过 | syntheticParent==null |
| tag 窗口 | 无负面 | 反写一致 |
| showImmediate 多次调用 | 无负面 | 第二次条件不满足 |
| lastWindowClosed | 更安全 | 行为变化仅影响反模式 |

## 四、设备验证（17:39 日志）

### 关键日志证据链

```
17:39:37  Window WIID_4 - subWindowOf tag=0x0   <- 三级窗口创建
17:39:39  onSubWindowCloseHandler: calling close()
17:39:39  processCloseEvent: blockedByModal=0    <- patch 生效
17:39:39  processCloseEvent: closeEvent sent, accepted=1
17:39:39  close() returned=1 proxyAfter=0        <- 窗口正确销毁
```

### patch 前 vs patch 后

| 指标 | patch 前 | patch 后 |
|------|---------|---------|
| blockedByModalWindow | 1 | 0 |
| processCloseEvent | if(blocked) return | 发送 CloseEvent |
| close() 返回值 | 不可达 | 1 |
| 窗口销毁 | ghost window | proxy 销毁 |

## 五、部署中的额外发现

1. **ArkTS 模板不匹配**：新编译 libqohos.so 读 `modulesFactories` 属性，旧工程传 `modules`，启动崩溃。替换 19 个 .ets/.ts 文件解决。
2. **hvigor CLI 打包崩溃**：命令行打包 HAP 启动后 `Cannot read property handleAbilityStageOnCreate of undefined`。回退后无 patch 的 .so 也崩溃，非 patch 问题，是 CLI 打包与 IDE 打包的差异。
3. **import lazy 语法**：需 `compatibleSdkVersionStage: "beta3"` 加到 build-profile.json5。

## 六、交付件

- patch: `0001-OHOS-Reflect-syntheticParent-to-transientParent.patch`
- README.md（部署指南）
- libs/（libqohos.so + 57 个 Qt5 .so）
- template/（19 个 ArkTS 模板文件）

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | Qt 源码层修复三级窗口关不掉问题，patch 设备验证通过，可提交 tqtc |
| 影响面 | 框架支撑（所有无 parent QDialog 场景）、matplotlib 等 Python 嵌入应用 |
| 交付物 | patch、源码分析报告、风险评估、交付目录 |
| 证据 | hilog 日志验证链、交付目录 ohos-qt-patch-delivery |
| 可复用方式 | 遇到 QDialog 关不掉/滚不动时直接复用此 patch |

---
id: problem-surfaceholder-nativexcomponent-incompatibility
type: problem
domain: errors
tags: [ohos, xcomponent, surface, opaque, surfaceholder, nativexcomponent, qpa, framework, api-conflict, deferred]
created: 2026-06-24
updated: 2026-06-24
status: open
audience: public
severity: high
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-window-model]
summary: >
  设置 XComponent surface opaque（OH_ArkUI_XComponentSurfaceConfig_SetIsOpaque）时，
  OH_ArkUI_SurfaceHolder_Create 返回 null。系统侧确认 SurfaceHolder（Node API）与
  OH_NativeXComponent（旧 NAPI）不能同时使用，而 Qt QPA 深度依赖 OH_NativeXComponent
  （无障碍/输入/平台集成），全量解耦风险过高。遗留待分析：精确界定互斥触发的 API 边界。

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  OH_ArkUI_SurfaceHolder_Create returned null
  LastFatalMessage:::OH_NativeXComponent_GetNativeXComponent failed
error_code: ""
keywords: [SurfaceHolder, SurfaceConfig, SetIsOpaque, NativeXComponent, opaque, XComponent, 互斥, 不能同时使用]
symptoms: >
  设置 XComponent surface opaque 时 SurfaceHolder_Create 返回 null；
  或 GetNativeXComponent 在节点挂载前返回 null 导致启动崩溃。

# ====== 问题详情 ======
environment: >
  Qt 5.12.12 OHOS（tqtc/harmonyos-5.12.12, commit 613336de）
  + OHOS SDK（API 22+，SurfaceHolder/SurfaceConfig 自 API 19/22 起可用）
  修改文件：qtbase/src/plugins/platforms/ohos/qarkui/qqtembeddedwindownode.{h,cpp}
---

# XComponent SurfaceConfig opaque：SurfaceHolder 与 NativeXComponent 互斥

> **错误类型**：API 互斥 / 架构冲突（运行时 SurfaceHolder_Create 返回 null）
> **影响版本**：Qt 5.12 / 5.15 for OHOS
> **状态**：⚠️ **遗留待分析**（未解决，需精确界定互斥边界后再决定方案）

---

## 目标

为 Qt QPA 创建的 XComponent surface 设置 `isOpaque=true`，让合成器跳过 alpha 混合以提升性能。

设置 opaque 的**唯一 C 入口**：`OH_ArkUI_SurfaceHolder_SetSurfaceConfig(holder, config)`（SDK 中无直接作用于 `ArkUI_NodeHandle` 的 setter，已确认）。

调用链：
```
OH_ArkUI_SurfaceHolder_Create(node)           // API 19
OH_ArkUI_XComponentSurfaceConfig_Create()     // API 22
OH_ArkUI_XComponentSurfaceConfig_SetIsOpaque(config, true)  // API 22
OH_ArkUI_SurfaceHolder_SetSurfaceConfig(holder, config)     // API 22 ← 唯一应用入口
OH_ArkUI_XComponentSurfaceConfig_Dispose(config)
```

## 症状

1. `OH_ArkUI_SurfaceHolder_Create(node)` 返回 null（即使节点已挂载、`OH_NativeXComponent_GetNativeXComponent` 已返回有效指针）
2. opaque 配置无法应用
3. 早先版本还会因 `GetNativeXComponent` 在挂载前返回 null 而崩溃（已通过延迟 `registerCallbacks` 到挂载后修复）

## 原因

### 系统侧确认的互斥

<STAKEHOLDER>确认：**`OH_ArkUI_SurfaceHolder`（Node API）与 `OH_NativeXComponent`（旧 NAPI）不能同时使用**。

但**精确的互斥触发 API 边界尚未界定**，存在两种可能：

| 假设 | 含义 | 解法范围 |
|------|------|---------|
| **A. 完全互斥** | 只要调用过 `GetNativeXComponent` / `RegisterCallback`（哪怕仅为触摸），SurfaceHolder_Create 就失败 | 全量解耦 NativeXComponent（极大重构） |
| **B. 仅 Surface 管理互斥** | NativeXComponent 不再管理 surface（surface 回调槽置空、只留 DispatchTouchEvent）即可与 SurfaceHolder 共存 | 小改动（surface 走 SurfaceHolder，触摸仍走 NativeXComponent） |

### Qt 框架对 OH_NativeXComponent 的深度依赖（全量解耦的障碍）

`OH_NativeXComponent` 不仅用于 surface+touch 回调，还深度嵌入多个子系统：

| 子系统 | 使用位置 |
|--------|---------|
| **无障碍** | `qohosaccessibilityprovider.cpp`、`qohosaccessibilitytree.cpp`、`qohosaccessibilityarkuihelpers.cpp`（`QXComponentRender` 用于 accessibility provider 注册、节点映射） |
| **输入** | `qohosnativexcomponentinputhandler.cpp`（触摸 `GetTouchEvent`/`GetTouchPoint*`、鼠标 `GetMouseEvent`、键盘 `GetKeyEvent*`） |
| **平台集成** | `qohosplatformintegration.cpp`（`xComponentProvider` 贯穿） |
| **QNativeNode** | `renderXComponent()` 返回 `QXComponentRender` 到处传递 |
| **XComponentId** | `tryCreateFromXComponent()` 从 `OH_NativeXComponent*` 取 ID |

### 耦合点：`OH_NativeXComponent_RegisterCallback` 捆绑 surface+touch

`OH_NativeXComponent_Callback` struct 把 4 个回调捆绑注册：
- `OnSurfaceCreated` / `OnSurfaceChanged` / `OnSurfaceDestroyed`（surface 生命周期）
- `DispatchTouchEvent`（触摸）

无法只保留 surface、只迁出 touch；反之亦然。要解耦 surface 必须连带处理触摸。

### 现有 Node API 替代通路（已实现）

| 输入类型 | 旧 NativeXComponent 路径 | Node API 替代 | Node 处理器现状 |
|---------|------------------------|--------------|---------------|
| Surface 创建/变化/销毁 | `RegisterCallback` | `SurfaceHolder`+`SurfaceCallback` | ❌ 需新建 |
| 触摸 | `DispatchTouchEvent` + `GetTouch*` | `NODE_TOUCH_EVENT` + `OH_ArkUI_PointerEvent_*` | ❌ 需新建处理器 |
| 鼠标 | `RegisterMouseEventCallback`（默认关闭） | `NODE_ON_MOUSE` | ✅ 已有 `qohosnativemouseeventshandler` |
| 悬停 | `DispatchHoverEvent`（默认关闭） | `NODE_ON_HOVER_EVENT` | ✅ 已有 `QOhosHoverEventsGenerator` |
| 键盘 | `RegisterKeyEventCallback`（默认关闭） | `NODE_ON_KEY_EVENT` | ✅ 已有 `qohosnativekeyeventshandler` |

> 鼠标/键盘已有 Node API 通路（`isNativeNodeApiMouseEventsEnabled` / `isNativeNodeApiKeyEventsEnabled` 默认 true）。**触摸是唯一缺口**。

## 解决方案

⚠️ **未解决。** 当前代码状态（`qqtembeddedwindownode.cpp`）：surface 仍走 `OH_NativeXComponent_RegisterCallback`，`applySurfaceConfig()` 在 `OnSurfaceCreated` 回调中尝试 `SurfaceHolder_Create` 但返回 null。

### 待执行的验证方案（最小改动，界定互斥边界）

在 `XComponentCallbackDispatcher::registerCallbackReceiver` 中：
1. `OH_NativeXComponent_Callback` 的 3 个 surface 槽置 `nullptr`，只保留 `DispatchTouchEvent`
2. surface 生命周期改走 `OH_ArkUI_SurfaceHolder` + `OH_ArkUI_SurfaceCallback`（Created/Changed/Destroyed）
3. opaque 配置在 `SurfaceCreated` 回调应用
4. 编译运行，观察 `SurfaceHolder_Create` 是否返回非空

**判定**：
- 若返回非空 → 互斥仅限 surface 管理（假设 B 成立），小改动即可解决
- 若仍为空 → `GetNativeXComponent` 本身互斥（假设 A 成立），C API opaque 在当前架构不可行

### 若假设 A 成立的备选方向

1. **改走 ArkTS 侧**：模板 `.ets` 用 `XComponentController.setXComponentSurfaceConfig({isOpaque:true})`。但需确认这对 Qt QPA 通过 `createNode(ARKUI_NODE_XCOMPONENT)` 创建的原生窗口是否生效（很可能不生效，因为是不同节点）。
2. **与系统侧进一步确认**：是否有计划提供直接作用于 `ArkUI_NodeHandle` 的 opaque setter（绕过 SurfaceHolder）。
3. **接受不支持**：当前架构下无法设置 opaque，记录为平台限制。

## 注意事项

- **全量解耦不可盲改**：涉及无障碍子系统，无法本地测试，风险极高。在界定互斥边界前不要尝试。
- **触摸迁移工作量**：即使只迁触摸到 `NODE_TOUCH_EVENT`，也需新写 `qohosnativetoucheventshandler.{h,cpp}`，移植多点触摸/tool type/tilt/display 坐标/历史点逻辑（约 200+ 行），且无法本地验证。
- **API 版本**：SurfaceHolder/SurfaceConfig 需 API 19/22+；`NODE_TOUCH_EVENT` 在 `native_node.h` 值为 0（基础枚举）。
- 已有的分析文档：`${DEMOS_ROOT}/<INTERNAL_DEMO>`（含 mermaid 时序图）。

## 相关

- 分析文档：`<LOCAL_PATH>`
- 计划文件：`<LOCAL_PATH>`
- [[semantic-qt-harmonyos-window-model]]

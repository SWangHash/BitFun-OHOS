---
id: semantic-qt-harmonyos-accessibility
type: semantic
domain: tech
tags: [qt, harmonyos, accessibility, a11y, QAccessible, ArkUI_AccessibilityProvider, xcomponent, want, io.qt.experimental.enableA11ySupport, uitest, dumpLayout, ui-tree, testing, automation]
created: 2026-07-23
updated: 2026-07-23
status: active
audience: public
refs: [procedural-qt-ohos-run-test, problem-runtime-crash-ohos-deviceinfo-global-expression, semantic-qt-harmonyos-window-model, procedural-demo-generation]
summary: >
  Qt OHOS 无障碍(a11y)桥机制与启用: libqohos 内置 QOhosPlatformAccessibility(QPlatformAccessibility 子类),
  把 Qt 的 QAccessible 控件树经每个 QWindow 的 XComponent 原生 ArkUI_AccessibilityProvider 发布到 OHOS 无障碍框架
  (findAccessibilityNodeInfosById 等回调)。桥默认关, 由【启动 Want 布尔参数 io.qt.experimental.enableA11ySupport】开启
  (aa start --pb io.qt.experimental.enableA11ySupport true), 非 env 变量/非 appArg/非系统读屏自动触发。
  开启后 uitest dumpLayout -b <bundle> 可取完整 Qt 控件树(QApplication/QWidget/QPushButton/QLabel+text+bounds);
  DevEco MCP get_app_ui_tree 走 ArkUI inspector 只到 XComponent 节点(不含 Qt 控件)。
leader_summary: >
  沉淀 Qt 鸿蒙无障碍桥的 Want 参数启用机制与 uitest 取 Qt 控件树方法, 支撑 Qt 鸿蒙应用 UI 自动化验证/控件定位/点击驱动。
impact: [框架支撑, 迁移提效]
deliverables: [知识页, 设备验证记录]
evidence: [uitest dumpLayout 开参数前后对比(空树→QApplication/QPushButton/QLabel 全 Qt 树), qohosjsmain.cpp:564-627 源码, qohosplatformintegration.cpp:171-177 门控]
---

# Qt for HarmonyOS 无障碍桥与 Want 参数启用

## 核心机制(源码核实, qtbase/src/plugins/platforms/ohos)

Qt OHOS QPA 内置完整无障碍桥, 把 Qt 的 `QAccessible` 控件树桥接到 OHOS 无障碍框架。链路:

```
Qt QAccessible 控件树
  → QOhosPlatformAccessibility(QPlatformAccessibility 子类, setActive(true), setRootObject 时映射树)
  → AccessibilityTree(Qt 可访问树副本)
  → 每个 QWindow+XComponent: qnativenode.cpp:248 → tryInitializeAccessibilityForQWindowWithXComponent
    → 向 XComponent 原生 ArkUI_AccessibilityProvider 注册回调
       (findAccessibilityNodeInfosById / executeAccessibilityAction / findFocusedAccessibilityNode ...)
  → OHOS 无障碍框架(ArkUI accessibility) → 可被读屏/uitest 等消费者查询
```

**桥编译进 libqohos.so**(受 `QT_NO_ACCESSIBILITY` 门控, Qt5 默认未定义即编入; strings libqohos.so 可见 `QOhosPlatformAccessibility` + 全部 `OH_ArkUI_AccessibilityElementInfoSet*`(SetAccessibilityText/ComponentType/Clickable/ChildNodeIds…) + `findAccessibilityNodeInfosById` 错误串)。

## 启用:启动 Want 参数(关键)

桥**默认关**(`experimentalEnableA11ySupport{false}`, qohosjsmain.cpp:106), 由 **app 启动 Want 的布尔参数**开启, 不是 env 变量、不是 appArgs、不是系统读屏自动触发:

```
getProcessLaunchOptionsFromWant(launchWant)                  // qohosjsmain.cpp:564
  assignWantParamIfPresent(experimentalA11ySupport,
      "io.qt.experimental.enableA11ySupport")                // :583-584  ← Want 参数名
setGlobalFlagsFromAppProcessLaunchOptions(launchOpts)        // :616, 调用于 :803
  experimentalEnableA11ySupport = launchOpts.experimentalA11ySupport.Value()  // :626-627
isA11ySupportEnabled() → return experimentalEnableA11ySupport   // :1968
QOhosPlatformIntegration 构造:                                // qohosplatformintegration.cpp:171-177
  #ifndef QT_NO_ACCESSIBILITY
    if (QtOhos::isA11ySupportEnabled())                      // :172  ← 仅 true 才建桥
       m_accessibilityContext = makeAccessibilityContext();
       installEventFilter(makeAccessibilityEventHandler());
  #endif
```

**开启命令**(`aa start` 用 `--pb` 传布尔 Want 参数):

```bash
hdc shell aa start -b <bundle> -a <ability> \
    --pb io.qt.experimental.enableA11ySupport true
```

### 其他 io.qt.* 启动 Want 参数(同机制, getProcessLaunchOptionsFromWant)

| Want 参数 | 类型 | 作用 |
|-----------|------|------|
| `io.qt.experimental.enableA11ySupport` | bool | **启用无障碍桥(本页)** |
| `io.qt.useDefaultUiAbilityInstanceInQt` | bool | 用默认 UIAbility 实例 |
| `io.qt.appSharedLibNameOverride` | string | 覆盖应用 .so 名 |
| `io.qt.experimental.enableGlBackingStore` | bool | 实验性 GL backing store |
| `io.qt.experimental.enableSupportContextMenuEventOnLongPress` | bool | 长按触发上下文菜单事件 |
| `io.qt.experimental.enableVsyncOnSoftwareBackingStore` | bool | 软件 backing store vsync |
| `io.qt.experimental.enableNativeNodeApiKeyEvents` | bool | NativeNode API 键盘事件 |
| `io.qt.experimental.enableNativeNodeApiMouseEvents` | bool | NativeNode API 鼠标事件 |
| `io.qt.watchdogEnabled` | bool | QtWatchdog |
| `io.qt.debug.drawQtRasterBackingStoreFlushedRegion` | bool | 调试绘制刷新区 |
| `io.qt.debug.useBasicStyleAndTheme` | bool | 调试用基础样式/主题 |
| `io.qt.debug.redirectedStdoutPath` | string | stdout 重定向文件 |
| `io.qt.debug.autoRequestPermissions` | string | 自动申请权限 |

> 注:系统无障碍服务(`startup.service.ctl.accessibility`, 设备 `BarrierFree.Accessibility.Core/Vision/Hearing=true`)无论此参数都常驻运行; 但**应用侧 Qt 桥的创建**取决于本参数。系统读屏(屏幕朗读)是消费者, 不等于应用桥已开。

## 取 Qt 控件树:uitest vs DevEco MCP

| 工具 | 机制 | 开参数前 | 开参数后 |
|------|------|---------|---------|
| **`uitest dumpLayout -b <bundle>`** | 基于无障碍框架查询 | 空树(无 Qt 控件) | **完整 Qt 控件树**(QApplication/QWidget/QPushButton/QLabel + text + origBounds) |
| DevEco MCP `get_app_ui_tree` full | ArkUI inspector dump(ArkUI 组件树) | 只有 XComponent 节点+容器 | 仍只到 XComponent(Qt 控件在 provider 后, 非 ArkUI 节点) |
| DevEco MCP `get_app_ui_tree` simple | WMS 窗口 dump | 窗口 bounds | 同(窗口级) |

**取 Qt 控件树方法**:

```bash
hdc shell uitest dumpLayout -b <bundle>           # 存到 /data/local/tmp/layout_*.json
# 拉取/读取后, 控件节点含 "type":"QPushButton"/"QLabel"/"QWidget", "text":..., "origBounds":"[l,t][r,b]"
```

控件 bounds 为 `[left,top][right,bottom]`, 中心点 `(l+r)/2, (t+b)/2` 可喂给 `uitest uiInput click <x> <y>` 驱动点击。

**为何 DevEco MCP get_app_ui_tree 取不到 Qt 控件**: Qt Widgets 渲染在 XComponent surface 内, 不是 ArkUI 节点; 它们经 XComponent 的 `ArkUI_AccessibilityProvider` 回调暴露为无障碍元素, 不在 ArkUI inspector 树里。ArkUI inspector 只到 XComponent 节点本身。故**取 Qt 控件树须用 `uitest dumpLayout`(无障碍通道), 且须先开 `io.qt.experimental.enableA11ySupport`**。

## 关键判据

- 桥默认关: 不开参数 → libqohos 不建 `QOhosPlatformAccessibility`, `uitest dumpLayout -b` 对 Qt 窗口返回空树(只有窗口/容器, 无 Qt 控件)。
- 桥已编译: `strings libqohos.so | grep -i accessibility` 命中 `QOhosPlatformAccessibility` + `OH_ArkUI_AccessibilityElementInfoSet*` = 桥在; 全空 = libqohos 以 `QT_NO_ACCESSIBILITY` 编译(需重编)。
- 开参数后空树→Qt 全树: 即证桥已建 + XComponent provider 已注册 + QAccessible 树已发布。
- 应用侧无需改代码(桥自动): 仅启动方式加 `--pb io.qt.experimental.enableA11ySupport true`。
- **Qt6.12 beta2 预构建 libqohos.so 实测 = `QT_NO_ACCESSIBILITY`**（2026-08-05 FeatherPad 端到端实测（KB 内部复盘，公开版不可达）：`grep -ao` 查 a11y 桥符号 `QOhosPlatformAccessibility`/`OH_ArkUI_AccessibilityElementInfoSet*`/`experimentalEnableA11ySupport`/`isA11ySupportEnabled` 全空，"ccessibilit" 计数 0 → 桥未编入 → `--pb` 无效 → `uitest dumpLayout` 只拿 ArkUI 树取不到 Qt 控件树；实测确认）。**预构建 B' 跑不通 a11y 树自动化测试**，需策略 B 源码 superbuild 重编 libqohos（不定义 QT_NO_ACCESSIBILITY）。

## 应用场景

1. **UI 自动化/验证**: 取 Qt 控件 bounds → `uitest uiInput click` 驱动按钮(替代盲点坐标)。例: qapp-recreate-test 用此定位 btn1(origBounds) → 点击触发 QApplication 二次构造 recreate。
2. **控件树检视**: 确认 Qt 控件结构/文本/可见性(替代看不到内容的截图)。
3. **无障碍回归**: 验证 Qt 控件的 accessible text/role 是否正确暴露给系统读屏。

## 关联

- [[procedural-qt-ohos-run-test]] — OHOS 真机运行验证(uitest 取树 + 点击驱动)
- [[problem-runtime-crash-ohos-deviceinfo-global-expression]] — 本机制用于定位/点击触发 recreate, 验证 deviceInfo 修复
- [[semantic-qt-harmonyos-window-model]] — XComponent/窗口模型(无障碍 provider 绑定于 XComponent)
- [[procedural-demo-generation]] — demo 生成后用 uitest 取树验证

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ Qt 源码核实 | qtbase/src/plugins/platforms/ohos/{qohosjsmain.cpp, qohosplatformintegration.cpp, accessibility/*, render/qnativenode.cpp} |
| 🔬 设备验证 | uitest dumpLayout 开参数前后对比 + aa start --pb 实测(HUAWEI MateBook Fold, OHOS 6.0) |

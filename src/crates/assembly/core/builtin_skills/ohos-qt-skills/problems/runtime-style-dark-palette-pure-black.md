---
id: problem-runtime-style-dark-palette-pure-black
type: problem
domain: runtime
tags: [runtime, ui-style, palette, dark-theme, qml, SystemPalette, pure-black, QOhosPlatformTheme, createDarkModePalette, setPalette, Q_OS_OHOS, RESP]
created: 2026-07-29
updated: 2026-07-29
status: solved
severity: medium
audience: public
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-platform-limits, problem-runtime-crash-libqohos-modules-mismatch]
summary: >
  OHOS 系统暗主题下 Qt QML 应用按钮/输入框背景纯黑看不清。根因：QOhosPlatformTheme 的 Dark 调色板把
  QPalette::Base = activeWindowFrame = #000000(纯黑)，QML SystemPalette.base 取之，应用用 sysPalette.base
  做控件/窗口背景 → 全纯黑一片。修复：app.cpp 加 Q_OS_OHOS 分支 QGuiApplication::setPalette(createDarkModePalette())
  override(setColorsTheme 不调 setPalette，override 持久)；base #1E1E1E 可读。
leader_summary: >
  沉淀 OHOS 暗主题 Qt QML 应用控件纯黑显示问题的根因(平台 palette.Base 取窗口框色)与应用层 override 修复，
  批量移植暗色 Qt QML 应用的通用样式拦路问题
impact: [迁移提效, 框架支撑]
deliverables: [problem 记录, RESP.app 样式修复(app.cpp), 真机截图对比]
evidence: [src/app/app.cpp Q_OS_OHOS palette override, screenshot/resp-after-fix.png, libqohos.so strings #FF000000]

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  视觉症状(非报错)：OHOS 暗主题下 Qt QML 应用，Button 与 TextField 默认背景色纯黑(#000000)，与窗口背景
  融为一片看不清控件边界；文字浅色可见但控件不可辨。
  根因日志线索：QOhosPlatformTheme Dark palette: QPalette::Base = system.activeWindowFrame = QColor("#FF000000")
  (qohosplatformtheme.cpp:204, :485)。QML SystemPalette.base → app.qml `color: sysPalette.base`
  / BetterButton `palette.button: sysPalette.button` / BetterTextField base → 纯黑。
  strings libqohos.so 含 "#FF000000"(Dark activeWindowFrame) / "#FFE4E4E4"(Light)。
error_code: ""
keywords: [palette, Base, activeWindowFrame, "#000000", "#FF000000", Dark theme, SystemPalette, sysPalette, QML, Controls, pure black, QOhosPlatformTheme, setColorsTheme, createDarkModePalette, setPalette, Q_OS_OHOS, Q_OS_LINUX, G1, Fusion, darkmode.h, isDarkThemeEnabled, RESP.app, 暗主题, 纯黑背景, 控件看不清]
symptoms: >
  Qt QML 应用在 OHOS 暗主题设备运行，按钮和输入框默认背景纯黑，控件与背景融为一片看不清边界(文字可见)。

# ====== 问题详情 ======
environment: >
  Qt 5.15.16 OHOS SDK(${QT5_15_OHOS_SDK_FULL}, libqohos.so 5.8MB built 2026-07-25) |
  HarmonyOS | HUAWEI MateBook Fold(系统暗主题) | RESP.app(Redis Desktop Manager) Qt5 QML 应用(QApplication 入口)

---

# OHOS 暗主题 Qt 应用控件背景纯黑（palette.Base = activeWindowFrame = \#000000）

## 错误信息（视觉症状）

纯黑控件背景，无报错。截图特征：Qt QML 应用在 OHOS 暗主题设备运行，Button/TextField 背景色 = \#000000(纯黑)，与窗口背景(也取 sysPalette.base)融为一片，控件边界不可辨；文字浅色可见。

## 场景

移植 Qt5 QML 应用(如 RESP.app)到 OHOS，应用 QML 用 `SystemPalette`(sysPalette) 的 base/button 色做控件与窗口背景(`color: sysPalette.base`)。在系统暗主题设备(HUAWEI MateBook Fold)运行即现；Light 主题设备正常(\#FFE4E4E4 浅灰可读)。

## 原因（三层，由表及里）

### 第一层：OHOS QOhosPlatformTheme 的 Dark 调色板 Base = 纯黑

`qtbase/src/plugins/platforms/ohos/qohosplatformtheme.cpp`：
```cpp
// Light theme (line 194):
.activeWindowFrame = QColor("#FFE4E4E4"),   // 浅灰
// Dark theme (line 204):
.activeWindowFrame = QColor("#FF000000"),   // ★ 纯黑
```
`makeSystemPalette` 设 `QPalette::Base = system.activeWindowFrame`(line 485-487)：
```cpp
{QPalette::Active,   QPalette::Base, palettesColors.system.activeWindowFrame},  // Dark → #000000
{QPalette::Disabled, QPalette::Base, palettesColors.system.inactiveWindowFrame}, // #FF18181A
{QPalette::Inactive, QPalette::Base, palettesColors.system.inactiveWindowFrame},
```
即 **OHOS 把"窗口框色"(activeWindowFrame)当 `QPalette::Base` 用**。Dark 主题窗口框=\#000000，故 Base=纯黑。Light 主题=\#FFE4E4E4 浅灰，故 Light 设备正常。

### 第二层：QML SystemPalette.base 直接取 QGuiApplication::palette().Base

QML `SystemPalette`(app.qml:87 `id: sysPalette`) 的 base 色来自 `QGuiApplication::palette().color(QPalette::Base)`。OHOS Dark → sysPalette.base = \#000000。

应用 QML 普遍用 sysPalette.base 做背景：
- `app.qml:290 color: sysPalette.base`(appWrapper 背景)
- `app.qml:383 color: sysPalette.base`(TabBar background)
- `BetterButton.qml:18 palette.button: sysPalette.button`
- `BetterTextField`(base 色做输入框背景)

→ 所有控件与窗口背景都 = sysPalette.base = \#000000 → 纯黑一片，控件不可辨。

### 第三层：应用原有 darkmode override 在 OHOS 未触发

应用 `src/app/app.cpp` 原暗色 override 只为 Windows/Linux 桌面设计，OHOS 因 G1 命中但不执行：
```cpp
#if defined(Q_OS_WINDOWS) || defined(Q_OS_LINUX)   // ★ G1: Q_OS_OHOS 隐含 Q_OS_LINUX → OHOS 命中此分支
  if (isDarkThemeEnabled()) {                      // ★ darkmode.h LINUX 分支读 QSettings "app/darkModeOn"(默认 false)
    setStyle(QStyleFactory::create("Fusion"));     //    → OHOS 默认返回 false → 不 override
    setPalette(createDarkModePalette());           //    → 用 OHOS 平台默认 palette(Dark Base=黑)
  }
#endif
```
- golden-rules **G1**：`Q_OS_OHOS` 隐含 `Q_OS_LINUX`，故 `#if Q_OS_LINUX` 分支在 OHOS 命中(但应用本意是 Windows/Linux 桌面)。
- `darkmode.h isDarkThemeEnabled()` 的 `Q_OS_LINUX` 分支读 `QSettings app/darkModeOn`(默认 false)，OHOS 无此设置 → 返回 false → override 不执行 → 用 OHOS 平台 palette(Dark Base=黑)。

## 解决方案（应用层 override palette）

在 `app.cpp` 加 `Q_OS_OHOS` 专属分支，无条件 `setPalette(createDarkModePalette())`(base=\#1E1E1E 深灰可读)：

```cpp
#if defined(Q_OS_OHOS)
  // OHOS dark theme: Base = activeWindowFrame = #000000 → QML sysPalette.base 纯黑。
  // Override 为可读暗色 palette(base #1E1E1E, button #323232, text #DFDFDF)。
  // setColorsTheme() 只翻转平台内部 palette map，不调 QGuiApplication::setPalette()，
  // 故应用层 setPalette 一次 override 即持久生效，无需跟踪 color-mode 变化。
  setPalette(createDarkModePalette());
#elif defined(Q_OS_WINDOWS) || defined(Q_OS_LINUX)
  if (isDarkThemeEnabled()) {
    setStyle(QStyleFactory::create("Fusion"));
    setPalette(createDarkModePalette());
  }
#endif
```

`createDarkModePalette()`(应用自带，`src/app/darkmode.h`)：base=`QColor(30,30,30)`(\#1E1E1E)、button=`QColor(50,50,50)`(\#323232)、text=`QColor(223,223,223)`(\#DFDFDF) —— 深灰可读暗色，控件与背景有层次，边界可辨。

### 为什么 override 持久（关键判据）

`QOhosPlatformTheme::setColorsTheme()`(qohosplatformtheme.cpp:931) 只改 `m_currentColorsTheme`(平台内部 map 选择)，**不调 `QGuiApplication::setPalette()`**。`QOhosPlatformTheme::palette()`(:982) 返回内部 map。

Qt 逻辑：`QGuiApplication::palette()` 优先返回 `QGuiApplicationPrivate::app_palette`(应用 `setPalette` 设过)，否则 fallback `QPlatformTheme::palette()`(= QOhosPlatformTheme)。故应用 `setPalette` 后，`QGuiApplication::palette()` 恒返回 override 的 createDarkModePalette，**不再 fallback 到平台黑 palette**，系统色模后续变化也不影响。

## 验证方法

1. `build_project(entry@default, debug)` → BUILD SUCCESSFUL(13s)
2. `start_app` 装机(HUAWEI MateBook Fold，暗主题)
3. `perform_ui_action screenshot` 截图对比：修复前控件/背景全 \#000000；修复后 base=\#1E1E1E、button=\#323232，控件边界可辨、文字可读
4. **判主题**：`strings <SDK>/plugins/platforms/libqohos.so | grep -E "FFE4E4E4|FF000000"` —— 两 hex 都在 = 该 .so 含 Light/Dark 双 palette；设备系统暗主题 → 取 Dark → Base=\#000000

## 注意事项

- **无条件 override**：OHOS 分支不检测系统主题，Light 系统下应用也固定暗色(不跟随系统 Light)。因 `setColorsTheme` 时序(可能在 QApplication 构造后才设 Dark) + 无应用层 colorMode 变化信号，条件式 override 会错过 Dark。固定暗色对开发者工具可接受；若要跟随系统，需用 QtOhosExtras 的 ColorThemeMode(但 CMake 不支持 QtOhosExtras，见 golden-rules B6)。
- **createDarkModePalette 是 QWidgets Fusion 设计**：其 Light/Dark role 反常(Light=\#4C4C4C 深、Dark=\#EBEBEB 浅，为 Fusion 3D 凸起效果)。QML Controls 2 flat 控件不显式用 Light/Dark 做边框，故反常值不影响 BetterButton 等。base/button/text 是主要可用色。
- **PlaceholderText 未设**：createDarkModePalette 未设 `QPalette::PlaceholderText`，用 QPalette 默认(WindowText 半透明)，深灰 base 上可读。次要。
- **非 OHOS 平台不受影响**：`#elif Q_OS_WINDOWS || Q_OS_LINUX` 保留原 isDarkThemeEnabled 逻辑。
- **同类但不同因**：QML 全黑无内容(缺 qml/ 模块部署)或白屏(WMS/Qt 可见性状态不同步)是另一类问题(见 _lookup.md 黑屏/白屏类);本页是控件/背景纯黑但应用正常渲染(文字可见),根因是 palette.Base 取窗口框色。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 OHOS 暗主题 Qt QML 应用控件纯黑显示问题的根因(平台 palette.Base 取窗口框色)与应用层 override 修复 |
| 影响面 | 批量移植暗色 Qt QML 应用到 OHOS 的通用样式拦路问题 |
| 交付物 | problem 记录 + RESP.app app.cpp 修复 + 真机截图对比 |
| 证据 | src/app/app.cpp Q_OS_OHOS override、screenshot/resp-after-fix.png、libqohos.so strings \#FF000000 |
| 可复用方式 | 以后遇到"OHOS Qt QML 控件/背景纯黑但应用正常"直接复用本页：app.cpp setPalette override + strings libqohos.so 查 \#FF000000 确认 Dark palette |

## 相关

- [[semantic-qt-harmonyos-golden-rules]] G1(Q_OS_OHOS 隐含 Q_OS_LINUX，致 `#if Q_OS_LINUX` 分支在 OHOS 命中)
- [[semantic-qt-harmonyos-platform-limits]] OHOS 平台行为
- [[problem-runtime-crash-libqohos-modules-mismatch]] 同项目(RESP.app)胶水代码 modulesFactories 崩溃修复
- QML 全黑/白屏(不同因,非本页) → 查 problems/_lookup.md "黑屏/白屏" 类
- Qt 源码 `qtbase/src/plugins/platforms/ohos/qohosplatformtheme.cpp`(makeSystemPalette / setColorsTheme / palette)

---

> **模板说明**：此模板用于记录实际执行中遇到的报错。
> Qt 平台已知限制（如 chmod 不支持）请记录在 `semantic/qt-harmonyos-platform-limits.md`，不使用此模板。

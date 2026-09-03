---
id: semantic-qt-harmonyos-system-tray
type: semantic
domain: tech
tags: [qt, harmonyos, system-tray, qsystemtrayicon, statusbar, StatusBarExtensionKit, notificationManager, qpa, ohos]
created: 2026-07-23
updated: 2026-07-23
status: active
audience: public
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-window-model, procedural-demo-generation, problem-runtime-crash-ohos-deviceinfo-global-expression]
summary: >
  Qt 鸿蒙系统托盘(QSystemTrayIcon)实现与行为:底层 QOhosSystemTrayIcon(qohossystemtrayicon.cpp)经
  @kit.StatusBarExtensionKit.statusBarManager 把图标放进鸿蒙状态栏(addToStatusBar/updateIcon/updateMenu/
  removeFromStatusBar/updateStatusBarHoverTips),菜单走 QOhosStatusBarMenuImpl(rightMenuClick/menuCode),
  showMessage 走 @ohos.notificationManager.publish。列全 stub/坑(geometry 恒值/messageClicked 永不/
  activated 仅 Trigger/菜单仅 text+顶层 separator+一层子菜单/图标强转单色 mask/tooltip 需 API≥22)。
leader_summary: >
  源码级补全 KB 系统托盘空白:鸿蒙 tray 真实可用(非 stub 探针),经状态栏 StatusBarExtensionKit 实现;
  沉淀 API 行为与全部 stub 陷阱,支撑后续 tray/通知/状态栏类应用与 demo。
impact: [框架支撑, demo 生成, 迁移提效]
deliverables: [${DEMOS_ROOT}/tray-ohos(完整 Qt5.12 OHOS demo + HAP), 语义知识页]
evidence: [${DEMOS_ROOT}/tray-ohos/entry-default-unsigned.hap(37.7MB,BUILD SUCCESSFUL), libTrayOhos.so 导出 T main, libqohos.so strings 含 statusBarManager 5 方法]
---

# Qt for HarmonyOS 系统托盘(System Tray)

> **来源**：Qt 5.12.12 OHOS 源码 `qtbase/src/plugins/platforms/ohos/qohossystemtrayicon.cpp/.h` + `qohosstatusbarmenu.cpp/.h` + libqohos.so 二进制 strings 核实。
> 鸿蒙**有**真实的系统托盘实现——`QSystemTrayIcon` 在鸿蒙上把图标放进**系统状态栏**(顶部),非 stub 探针。

## 工厂接入

`qohosplatformtheme.cpp` 的 `createPlatformSystemTrayIcon()` 返回 `makeQOhosSystemTrayIcon()`(匿名 namespace final 类 `QOhosSystemTrayIcon`)。菜单后端是 `QOhosStatusBarMenuImpl`(`qohosstatusbarmenu.cpp`)。调用经 **QtOhos JS 线程桥**(`runInJsThreadAndWait` / `invokeInJsThreadAndWaitForContinue` + `jsState.eval(expr, args)`,`*` 为位置占位符)marshal 到 ArkTS 线程执行;每个 statusBarManager 调用的**首参是 UiAbility context**(`getContextForStatusBarManager` → `qAbility().eval<QNapi::Object>("context")`)。

## API 行为(public QSystemTrayIcon → platform 虚函数 → ArkTS eval)

| public 调用 | platform 虚函数 | ArkTS eval(逐字) | 鸿蒙实际 |
|------------|---------------|-----------------|---------|
| `show()` / `setVisible(true)` | `init()` | `@kit.StatusBarExtensionKit.statusBarManager.addToStatusBar(*)` | 真实:状态栏出现图标(白/黑单色 mask) |
| `hide()` / `setVisible(false)` | `cleanup()` | `@kit.StatusBarExtensionKit.statusBarManager.removeFromStatusBar(*)` | 真实:状态栏图标消失 |
| `setIcon(QIcon)` | `updateIcon()` | `@kit.StatusBarExtensionKit.statusBarManager.updateStatusBarIcon(*)` | 真实:live 换图标(转单色 mask) |
| `setContextMenu(QMenu*)` | `updateMenu()` | `@kit.StatusBarExtensionKit.statusBarManager.updateStatusBarMenu(*)` | 真实:live 换 statusBarGroupMenu |
| `setToolTip(QString)` | `updateToolTip()` | `@kit.StatusBarExtensionKit.statusBarManager.updateStatusBarHoverTips(*)` | 真实**仅 SDK API≥22**;<22 no-op(日志 "not supported, ignoring") |
| `showMessage(title,msg,QIcon,MessageIcon,msecs)` | `showMessage()` | `@ohos.notificationManager.publish(*)` | 真实:发系统通知(通知栏出现);`MessageIcon` 被 `Q_UNUSED` 忽略 |
| `geometry()` | `geometry()` | — | **stub**:恒返回 `QRect(0,0,24,24)`,不可信 |
| static `isSystemTrayAvailable()` | — | — | **stub**:恒 `true`(无真实探测) |
| static `supportsMessages()` | — | — | **stub**:恒 `true` |
| signal `activated(Trigger)` | `init()` 注册 `statusBarIconClick` 事件 | `iconClickType=="leftClick"` → `activated(Trigger)` | 真实:**仅**左键单击发 Trigger |
| signal `messageClicked()` | — | — | **stub**:永不触发(showMessage 用 publish 无点击回调) |

**ActivationReason 枚举**:`Unknown=0, Context=1, DoubleClick=2, Trigger=3, MiddleClick=4`。鸿蒙只发 `Trigger`;右键**不发** `Context`(右键走菜单项 `QOhosStatusBarMenuItem::activated()` → public `QAction::triggered()`,经 `rightMenuClick` 事件 + `menuCode` 匹配)。

## 图标管线(单色 mask)

`init`/`updateIcon`/`showMessage` 共用 `makeDisplayDensityScaledJsPixelMapFromQImage`:经 `@ohos.display.getPrimaryDisplaySync()` 读密度,按 `1/density`(vp)缩放 QImage,再 `createNapiPixelMapFromQImage`。tray 图标被 `convertToMonochromeIcon` **强转单色 mask**——白版(全像素白,保留 alpha)+ 黑版,因 OHOS 状态栏图标是 mask 图标。**故 demo 里任意 QColor/图形都行,颜色无意义**。PixelMap 尺寸经 `getImageInfoSync().size` 回读(PixelMap 方法,非 @kit 模块)。

## showMessage(系统通知)

`showMessage` 构造 notificationRequest:`{content:{notificationContentType:<num>, normal:{title,text}}, smallIcon:<PixelMap 128×128>, [autoDeletedTime: now+msecs 仅 msecs>0]}`。`notificationContentType` 是 `@ohos.notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT` 的数值(经 `mapOhosEnumToJs` 一次性 eval `@ohos.notificationManager.ContentType` 解析为 double 并缓存)。`@ohos.notificationManager.publish(request)` promise,错误 catch 记日志。

> **运行时 caveat**(待真机验证):`notificationManager.publish` 可能需用户在系统设置授权通知(非 module.json5 权限,而是系统级通知授权);未授权则通知静默不发(非崩溃)。demo 中 showMessage 按钮即探针。

## 菜单限制(QOhosStatusBarMenuImpl / QOhosStatusBarMenuItem)

鸿蒙状态栏菜单**仅支持**:
- `text`(菜单项文字)
- 顶层 `separator`(分隔 `statusBarGroupMenu` 分组)
- **一层** sub-menu(嵌套 sub-menu 被忽略并告警)

**全 no-op** 的菜单项 setter:`setIcon/setVisible/setFont/setRole/setCheckable/setChecked/setShortcut/setEnabled/setIconSize`。菜单 `showPopup/dismiss/setIcon/setEnabled/setVisible/syncMenuItem/syncSeparatorsCollapsible` 也全 no-op(OS 自己弹菜单,Qt 不弹)。子菜单内 `separator` 被忽略并告警。

**硬编码值**:`quickOperation.abilityName=""`,`ohosSystemTrayItemTitle="Qt Application"`(tray 项 quickOperation 标题恒 "Qt Application",public API 不可配)。

## 胶水依赖(OhosExportModules.ts)

tray 经 libqohos eval 的模块(须在 `OhosExportModules.ts` 注册为"已知模块路径"):
- `@kit.StatusBarExtensionKit.statusBarManager`(核心 tray:init/cleanup/updateIcon/updateMenu/updateToolTip + `statusBarIconClick`/`rightMenuClick` 事件)
- `@ohos.display`(图标密度缩放 `getPrimaryDisplaySync`)
- `@ohos.notificationManager`(showMessage `publish` + `ContentType`)

> **5.12 vs 5.15 关键区别**:
> - **5.12 libqohos = factories API**(读 `modulesFactories` 字段,`makeJsModulesFactoriesMap`)。源码树模板的 `OhosExportModules.ts`(5 个 @kit.* lazy + `getOhosExportModulesFactories` 箭头工厂)**正是 5.12 对应代际**,且**已含 `@kit.StatusBarExtensionKit`** → 核心 tray 开箱即用,**不要**换成 qView-ohos objects 版(那是 5.15 读 `modules` 字段的)。
> - tray 额外依赖 `@ohos.display` + `@ohos.notificationManager`,源码树模板**未注册**。tray demo 主动补这两个(eager default-import + factories map 条目,匹配现有 5 行模式)。
> - `@ohos.deviceInfo` 裸 eval 崩溃 trap([[problem-runtime-crash-ohos-deviceinfo-global-expression]])是 **5.15 代际**机制;5.12 单实例 demo 不触发(见该 problem 页判据:`strings libqohos.so | grep "global expression"` 区分代际)。

## demo(${DEMOS_ROOT}/tray-ohos)

Qt5.12 OHOS 完整 demo:`QApplication` + `MainWindow`(10 按钮触发各 tray API + 屏幕日志区)+ `QSystemTrayIcon`(窗口 show 后 QTimer 延迟 show,contextMenu 含显示/隐藏窗口+弹通知+顶层 separator+一层子菜单+退出,`activated(Trigger)` 切换窗口可见性)。规避全部 stub(不依赖 geometry/messageClicked/Context,菜单仅 text+顶层 separator+一层子菜单)。CMake 套铁律 B1/B2/B3/B7/B10/B11。**BUILD SUCCESSFUL**(unsigned+signed HAP,libTrayOhos.so 导出 `T main`,HAP 含 libqohos.so+libQt5Core/Gui/Widgets+styles/libqohosstyle.so)。

> **设备运行通过(2026-07-23,真机 MateBook Fold)**:曾因 **libqohos↔libQt5Gui 版本错配**(`nativeSurfacePixelSize` 符号)启动崩——libqohos(07-14 patched)引用该符号,部署的 libQt5Gui 不导出→dlopen "symbol not found"。`NEED_OPENGL=1` 无效(加载期符号失败)。**MIX 修复**:CMake 用 FULL(libQt5Core/Gui/Widgets 提供该符号)+ 覆盖 `Qt5::QOhosPlatformIntegrationPlugin` 的 `IMPORTED_LOCATION` 指 ORIGINAL libqohos(引用该符号、非 debug)→hvigor 经 DT_NEEDED 拷 MIX 组合→libqohos 加载成功。hilog 铁证:`Window show`+`addToStatusBar succeed!`+进程稳定;HAP libqohos=5.7MB(ORIGINAL)。详见 problems/runtime-crash-qbackingstore-qregion-ohos.md。tray 行为(状态栏图标经 addToStatusBar、菜单、通知)真机验证通过。

## 相关上下文

- [[qt-harmonyos-golden-rules]] — W5(主窗口 hide 回退最小化)、L2(argv[0] 是 .so 库路径)
- [[qt-harmonyos-window-model]] — 窗口可见性/状态栏关系
- [[procedural-demo-generation]] — 六步闭环 + §3.2 OhosExportModules.ts 陷阱(5.15 路径)
- [[problem-runtime-crash-ohos-deviceinfo-global-expression]] — @ohos.* eager-import 陷阱(5.15 代际判据)

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 源码级补全 KB 系统托盘空白:鸿蒙 tray 真实可用(经状态栏 StatusBarExtensionKit),非探针 stub |
| 影响面 | tray/通知/状态栏类应用与 demo、商业答复、迁移提效 |
| 交付物 | ${DEMOS_ROOT}/tray-ohos(完整 Qt5.12 OHOS demo + unsigned HAP)、语义知识页 |
| 证据 | entry-default-unsigned.hap(37.7MB,BUILD SUCCESSFUL)、libTrayOhos.so T main、libqohos.so strings 含 statusBarManager 5 方法 |
| 可复用方式 | 后续任何 tray/状态栏/通知类 Qt 鸿蒙 demo 或应用直接套用本页 API 行为与 stub 列表 |

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ Qt 源码验证 | `qtbase/src/plugins/platforms/ohos/qohossystemtrayicon.cpp/.h`(QOhosSystemTrayIcon 全虚函数 + ArkTS eval)、`qohosstatusbarmenu.cpp/.h`(菜单后端 + rightMenuClick/menuCode)、`qohosplatformtheme.cpp:1005`(createPlatformSystemTrayIcon 工厂)、`qohosenums.h:143`(notificationManager.ContentType fullTypeName)、`qohosplugincore.cpp:659`(mapOhosEnumToJs) |
| 🛠️ libqohos.so 二进制核实 | `strings <SDK>/plugins/platforms/libqohos.so \| grep statusBarManager` 确认 5 方法(addToStatusBar/removeFromStatusBar/updateStatusBarIcon/updateStatusBarMenu/updateStatusBarHoverTips)+`statusBarIconClick`/`rightMenuClick` 事件;`grep -E '@ohos.display|@ohos.notificationManager'` 确认 tray eval 的两个 @ohos.* 模块名逐字命中 |
| 📖 Qt 公共 API | `<QtWidgets/qsystemtrayicon.h>`(QSystemTrayIcon public API + ActivationReason 枚举 + MessageIcon)、`<QtGui/qpa/qplatformsystemtrayicon.h>`(platform 虚接口) |

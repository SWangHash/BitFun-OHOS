## 12. 导航与路由


> **组件索引**：`Navigation`、`NavPathStack 操作`、`NavDestination`、`Router`

### Navigation

**构造：** `Navigation()`

**属性方法：**

| 方法 | 签名 | 默认值 | 说明 |
|------|------|--------|------|
| .navDestination | `.navDestination(builder: (name: string, param: unknown) => void)` | — | 路由目标映射 |
| .title | `.title(value: ResourceStr \| CustomBuilder \| NavigationCommonTitle \| NavigationCustomTitle, options?: NavigationTitleOptions)` | — | 标题 |
| .subTitle | `.subTitle(value: string)` | — | 副标题（API 8，已废弃，用 .title 替代） |
| .mode | `.mode(NavigationMode)` | Auto | Stack/Split/Auto |
| .hideNavBar | `.hideNavBar(value: boolean)` | false | 隐藏导航页（标题栏+内容区+工具栏）。栈中有 NavDestination 则显示栈顶页面，反之显示空白；API 11+ 单栏/双栏/自适应模式均生效，会失去自适应分栏能力；全屏需求改用 NavDestination 的 `.fullScreenOverlay(true)`，只藏标题用 `.hideTitleBar(true)` |
| .hideTitleBar | `.hideTitleBar(value: boolean)` | false | 隐藏标题栏 |
| .hideToolBar | `.hideToolBar(value: boolean)` | false | 隐藏工具栏 |
| .toolBar | `.toolBar(value: object \| CustomBuilder)` | — | 工具栏（旧接口） |
| .toolbarConfiguration | `.toolbarConfiguration(value: Array\<ToolbarItem\> \| CustomBuilder, options?)` | — | 工具栏（API 10+） |
| .navBarWidth | `.navBarWidth(value: Length)` | 240vp | 导航栏宽度（仅 Split 模式） |
| .navBarPosition | `.navBarPosition(value: NavBarPosition)` | Start | 导航栏位置 |

### NavPathStack 操作

| 方法 | 签名 | 说明 |
|------|------|------|
| pushPath | `pushPath(info: NavPathInfo, animated?: boolean)` | 压入页面（无错误码返回） |
| pushPathByName | `pushPathByName(name: string, param: unknown, animated?: boolean)` | 按名称压入（无错误码返回） |
| pushDestination | `pushDestination(info: NavPathInfo, options?: NavigationOptions): Promise<void>` | 压入页面，错误经 Promise reject 错误码返回（**推荐**） |
| pushDestinationByName | `pushDestinationByName(name: string, param: unknown, options?: NavigationOptions): Promise<void>` | 按名称压入，错误经 reject 返回（**推荐**） |
| pop | `pop(animated?: boolean): NavPathInfo \| undefined` | 弹出，返回 NavPathInfo |
| pop | `pop(result: Object, animated?: boolean): NavPathInfo \| undefined` | 弹出并回传结果 |
| replacePath | `replacePath(info: NavPathInfo, animated?: boolean)` | 替换 |
| clear | `clear(animated?: boolean)` | 清空 |
| size | `size(): number` | 栈大小（方法，非属性） |
| getParent | `getParent(): NavPathStack \| null` | 获取父栈，无父返回 null |

### NavDestination

**构造：** `NavDestination()`

**属性方法：**

| 方法 | 签名 | 默认值 | 说明 |
|------|------|--------|------|
| .title | `.title(value: string \| CustomBuilder \| NavDestinationCommonTitle \| NavDestinationCustomTitle \| Resource, options?)` | — | 标题 |
| .hideTitleBar | `.hideTitleBar(boolean)` | false | 隐藏标题栏 |
| .hideBackButton | `.hideBackButton(boolean)` | false | 隐藏返回键 |
| .backgroundColor | `.backgroundColor(ResourceColor)` | — | 背景色 |

**事件：** `.onReady((context: NavDestinationContext) => void)` `.onWillShow()` `.onShown()` `.onHidden()` `.onWillHide()` `.onBackPressed()`

### Router

| 方法 | 签名 | 说明 |
|------|------|------|
| pushUrl | `router.pushUrl({url, params?})` | 压入页面 |
| replaceUrl | `router.replaceUrl({url, params?})` | 替换当前页 |
| back | `router.back(url?)` | 返回 |
| clear | `router.clear()` | 清空栈 |
| getLength | `router.getLength(): number` | 栈大小 |
| getState | `router.getState(): RouterState` | 当前状态 |

---
### 典型用法

#### 获取导航栈 NavPathStack 的方式

| 方式 | 写法 | 说明 |
|------|------|------|
| `queryNavigationInfo`（12+，推荐） | `let info = this.queryNavigationInfo(); if (info !== undefined) { this.pathStack = info.pathStack }` | 自定义组件方法，任意时机可取、不依赖 NavDestination 生命周期 |
| `onReady`（推荐） | `NavDestination().onReady((ctx: NavDestinationContext) => { this.navPathStack = ctx.pathStack; const p = ctx.pathInfo.param as DetailParams })` | NavDestination 生命周期回调，取栈同时可取本页参数 |
| AppStorage 全局共享 | 宿主 `AppStorage.setOrCreate` / 页面 `AppStorage.get` | 不推荐 |
| `@Provide`/`@Consume` | 跨层级传递 | 不推荐 |

#### 全局路由状态监听

`uiObserver.on('navDestinationUpdate', (info: NavDestinationInfo) => ...)` 监听 NavDestination 显示/隐藏状态变化（经 `this.getUIContext().getUIObserver()` 获取 observer，见 @ohos.arkui.observer）。

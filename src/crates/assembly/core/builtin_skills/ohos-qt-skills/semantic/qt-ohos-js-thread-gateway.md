---
id: semantic-qt-ohos-js-thread-gateway
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, qpa, threading, node-api, arkts, napi, private-api, oauth, sync]
created: 2026-06-26
updated: 2026-07-27
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-ohos-extras, problem-ohos-mainthread-mismatch, semantic-qt-harmonyos-qt6-status, episodic-quit-deadlock-tsfn]
summary: >
  Qt↔ArkTS/JS 线程桥接的私有 API：QOhosJsThreadGateway 命名空间（invoke/runAndWait/eval/
  evalWithPromise/invokeAndWaitForContinue）是把 Qt 线程的调用安全 marshal 到唯一 JS 主线程的入口，
  QOhosJsThreadOps 是其背后的抽象接口（QPA 插件用 JsThreadOpsImpl 注册实现）。位于 QtCore 私有头
  qcore_ohos_p.h，非公共 API。开发者用命名空间自由函数，不直接碰 QOhosJsThreadOps。
---

# Qt↔JS 线程桥接：QOhosJsThreadGateway / QOhosJsThreadOps

## 背景：为什么需要这套接口

Qt for HarmonyOS 是**双线程模型**（详见 [[ohos-mainthread-mismatch]]）：

| 线程 | 用途 |
|------|------|
| ArkTS UI 线程（JS 线程） | 运行 ArkTS 生命周期回调、Node-API 回调，持有 `napi_env` |
| QtMainThread | 运行 Qt 事件循环、用户 `main()`、QPA 事件分发 |

**核心约束**：Node-API 对象（`napi_value` / `napi_ref` / `QNapi::Value`）**只能在 JS 主线程访问**。因此 Qt 线程要调用任何 ArkTS/系统 API（取字体路径、wifi、标准路径、调 `@ohos.*` 模块等），必须把调用 marshal 到 JS 线程。`QOhosJsThreadGateway` 就是这个方向的入口；反方向（JS 线程 → Qt 线程）用 `QtOhos::invokeInQtThread`。

## 两者关系（源码核实）

| | `QOhosJsThreadGateway` | `QOhosJsThreadOps` |
|---|---|---|
| 性质 | **namespace**（门面，自由函数） | **抽象类**（虚接口 + `static instance()/registerInstance()` 单例） |
| 定义 | `qtbase/src/corelib/kernel/qcore_ohos.cpp:36-54` | `qtbase/src/corelib/kernel/qcore_ohos.cpp:19-34` |
| 头文件 | `QtCore/private/qcore_ohos_p.h` | 同 |
| 谁用 | **调用方**（开发者 / Qt 模块） | **实现方**（QPA ohos 插件） |

委托链（命名空间函数只是薄门面，转调单例）：

```cpp
// qcore_ohos.cpp
void QOhosJsThreadGateway::runAndWait(
    const std::function<void(QOhosJsState &)> &task, std::string callerContextName)
{
    QOhosJsThreadOps::instance().runAndWait(task, std::move(callerContextName));
}
// invoke / invokeAndWaitForContinue 同样转调 instance()
```

后端实现是 QPA ohos 插件的 `JsThreadOpsImpl`（`qtbase/src/plugins/platforms/ohos/qohosplugincore.cpp:780-821`），启动时由 `initJsThreadState()` 通过 `QOhosJsThreadOps::registerInstance(&jsThreadOpsImpl)`（:920）注册为单例，内部转调真正排任务的 `QtOhos::runInJsThreadAndWait / invokeInJsThread / invokeInJsThreadAndWaitForContinue`。

**结论**：开发者用 `QOhosJsThreadGateway::*` 自由函数；`QOhosJsThreadOps` 是给"要换后端实现的人"用的接口，不要直接 `instance().xxx()` 调用。`runAndWait` 两边同名，应用/模块代码一律用命名空间版本。

## ⚠️ 私有 API 边界

- 都在 `QtCore/private/qcore_ohos_p.h`，头文件顶部明确 **"not part of the Qt API. It may change from version to version without notice, or even be removed."**
- 符号靠 `Q_CORE_EXPORT` 从 QtCore 导出，可链接，但**无 ABI/API 兼容性承诺**
- Qt 自身在大量内部模块使用：字体库（`qohosplatformfontdatabase.cpp`）、QStandardPaths（`qstandardpaths_ohos.cpp`）、wifi bearer（`qohoswifi.cpp`）、QPA 插件自身
- 应用层若要用：需 `#include <QtCore/private/qcore_ohos_p.h>`、链接 Qt 私有头（CMake `Qt5::CorePrivate` / `find_package(Qt5 ... COMPONENTS ... Private)`），并自担升级风险

## ⚠️ 构建前置条件（易漏，本文示例全部命中）

本页所有示例（及任何直接命名 `QNapi::*` 类型的 TU）除 `Qt5::CorePrivate` 外还**必须**满足两条，否则编译/链接失败（2026-07-27 实证 Qt 5.15.16 full SDK 安装树）：

1. **node-addon-api 的 `napi.h`**：`qcore_ohos_p.h` → `qnapi_p.h:24 #include <napi.h>`。5.15.16 full SDK **不含** `napi.h`（`find` 全树 0 命中）；`Qt5::CorePrivate` target 只携带 `Qt5Core_OWN_PRIVATE_INCLUDE_DIRS`（私有头目录），**不带** node-addon-api 路径（`Qt5CoreConfigExtras.cmake` 无 `3rdparty`/`node-addon` 条目）。必须从 Qt5 源码树 `qtbase/src/3rdparty/node-addon-api/` 取，手动 `target_include_directories(<tgt> PRIVATE <path>/node-addon-api)`，或设 `QT5_SRC_3RDPARTY` 环境变量。
2. **链接 `ace_napi.z`**：node-addon-api 是 header-only 内联封装，`napi_*` C 函数由 OHOS 运行时 `libace_napi.z.so` 提供（sysroot `<OHOS_SDK_NATIVE>/sysroot/usr/lib/aarch64-linux-ohos/libace_napi.z.so`）。`Qt5::Core` **不传递**此依赖（`Qt5CoreConfigExtras.cmake` 无 `INTERFACE_LINK_LIBRARIES` 含 ace_napi），应用须在 `target_link_libraries` 显式加 `ace_napi.z`，否则 `undefined reference to napi_*`。

> 💡 仅当应用代码完全不用 `QNapi::*` 类型、只用 `jsState.eval<T>(expr)` 取 POD 返回时，理论上 napi.h 仍被 `qcore_ohos_p.h` 传递包含（躲不开）；ace_napi.z 链接则任何使用本网关的 TU 都需要。

## 取主窗口 / Window id 的现行写法（5.15.16，易写错）

- **主窗口**：`jsState.defaultWindowStageOrEmpty().call<QNapi::Object>("getMainWindowSync")`（同步，`@ohos.window.d.ts` `WindowStage.getMainWindowSync(): Window`；源码 `qohosqabilityinstancesmanager.cpp:312` / `qohoswindowproxydatafactory.cpp:267` 同款）。
- **Window id 访问**：`window.get<QNapi::Number>("getWindowProperties().id")`，**不是** `.get<QNapi::Number>("id")`——5.15.16 的 Window 对象 `id` 非直接属性，须经 `getWindowProperties().id`（源码 `qohoswindowproxy.cpp:489/518`）。
- **子窗口枚举**：`windowStage.call<QNapi::Promise>("getSubWindow")` **无参**，返回 `Promise<Array<Window>>`（`@ohos.window.d.ts:8480`），在 `onThen` 内按 `getWindowProperties().id` 匹配。**不要**给 `getSubWindow` 传 id 入参（旧代码传了会被忽略）。
- **GC 警告**：`getSubWindow` 异步，`onThen` 在另一 JS turn 执行。在其中要用的 `QNapi::Object`（如 policy）**必须在该回调内用 `info.Env()` 当场构造**，不能从外层 task 按值捕获——非 persistent 的 `napi_value` 跨 turn 会被 GC。同步路径（如 `getMainWindowSync` 后立即 `call`）无此问题。

## 5 个入口（全部在 `QOhosJsThreadGateway` 命名空间）

| 场景 | 接口 | 阻塞 | 返回值 |
|---|---|:---:|:---:|
| 异步投递、不要结果 | `invoke(task)` | 否 | 无 |
| 同步阻塞、不要结果 | `runAndWait(task, ctx)` | 是 | 无 |
| 同步阻塞、要返回值 | `eval(func, ctx)`（模板，推导返回类型） | 是 | 有 |
| JS 返回 Promise、阻塞等副作用 | `invokeAndWaitForContinue(task, ctx)` | 是 | 无 |
| JS 返回 Promise、阻塞等并取值 | `evalWithPromise<T>(func, ctx)` | 是 | `T` |

`ctx`（`callerContextName`）是出错定位用，习惯传 `Q_FUNC_INFO`。

### 用法示例（仿 Qt 自身实现）

```cpp
#include <QtCore/private/qcore_ohos_p.h>

// 1) 异步 fire-and-forget
QOhosJsThreadGateway::invoke([](QOhosJsState &) {
    // 在 JS 线程做不需要结果的事
});

// 2) 同步阻塞、无返回值（Qt 字体库取字体路径的模式）
QStringList fontPaths;
QOhosJsThreadGateway::runAndWait(
    [&](QOhosJsState &jsState) {
        fontPaths.append(getSystemFontPaths(jsState)); // 必须在 JS 线程内取
    }, Q_FUNC_INFO);

// 3) 同步阻塞、带返回值（最常用；QStandardPaths/wifi 模式）
QString family = QOhosJsThreadGateway::eval(
    [&](QOhosJsState &jsState) {
        return QString::fromStdString(getDefaultFontFamily(jsState));
    });

// 4) JS 侧返回 Promise、阻塞等并取值（wifi getLinkedInfo 模式）
auto linked = QOhosJsThreadGateway::evalWithPromise<QOhosOptional<WifiLinkedInfo>>(
    [&](QOhosJsState &jsState, QOhosTaskPromise<QOhosOptional<WifiLinkedInfo>> p) {
        auto branches = std::move(p).makeThenCatchBranches(Q_FUNC_INFO);
        jsState.evalToPromiseOrRejectOnThrow("@ohos.wifiManager.getLinkedInfo()")
            .then(std::move(branches.thenFunc))
            .catch(std::move(branches.catchFunc));
    });

// 5) JS 侧返回 Promise、只要副作用、不要值
QOhosJsThreadGateway::invokeAndWaitForContinue(
    [&](QOhosJsState &jsState, QOhosTaskPromise<> done) {
        jsState.evalToPromiseOrRejectOnThrow("doSomethingAsync()")
            .then([done]() { done(); })
            .catch([done](QNapi::Value) { done(); });
    }, Q_FUNC_INFO);
```

task 拿到的 `QOhosJsState &` 提供：
- `env()` — `napi_env`
- `eval(expr, args)` — 执行 JS 表达式，模板返回值
- `evalToPromiseOrRejectOnThrow(expr, args)` — 拿到 `QNapi::Promise`
- `defaultWindowStageOrEmpty()` / `defaultUiContextOrEmpty()` — ArkUI 对象
- `mapOhosEnumToJs / mapOhosEnumFromJs / tryMapOhosEnumFromJs` — 鸿蒙枚举双向映射

## 关键约束

`eval` / `evalWithPromise` 内有 `static_assert`：**返回类型不能是 `napi_value` / `napi_ref` / `QNapi::Value` 等 NAPI 值**——必须在 JS 线程内转成普通 C++ 类型（`std::string` / `int` / `bool` / `std::vector` / `QOhosOptional<T>` 等）再返回。违反在编译期报错。这就是 Qt wifi 代理返回 `std::vector<ScanInfo>` / `QOhosOptional<WifiLinkedInfo>` 而非 NAPI 对象的原因。

## 反方向（JS 线程 → Qt 线程）

同文件 `qcore_ohos_p.h` 还提供反方向工具，凑齐跨线程全景：

- `QtOhos::invokeInQtThread(task)` — 任意线程可调，把 task 排进 Qt 线程执行（[[ohos-mainthread-mismatch]] 的"ArkTS UI 线程回调不能直接用 Qt API"就用它）
- `QtOhos::QThreadSafeRef<T>::visitInQtThreadIfAlive(func)` / `QObjectThreadSafeRef` — 持有 QObject 的线程安全引用，内部用 `QPointer` 判活后在 Qt 线程访问
- `QtOhos::makeProxyWithJsThreadDeleter(shared_ptr)` — 给 shared_ptr 套自定义删除器，确保被管对象在 JS 线程析构（内部用 `QOhosJsThreadGateway::runAndWait` 实现）
- `QtOhos::initQtThreadState(qpaFunctions)` — 启动期从 Qt 线程调用一次，初始化 `QtState`

## 决策表

| 我要做什么 | 用哪个 |
|---|---|
| 任意 Qt 线程 → JS 线程，异步、不要结果 | `QOhosJsThreadGateway::invoke` |
| 任意 Qt 线程 → JS 线程，同步阻塞、无返回值 | `QOhosJsThreadGateway::runAndWait` |
| 任意 Qt 线程 → JS 线程，同步阻塞、取返回值 | `QOhosJsThreadGateway::eval` |
| 任意 Qt 线程 → JS 线程调一个返回 Promise 的 API，阻塞等并取值 | `QOhosJsThreadGateway::evalWithPromise<T>` |
| 同上但只要副作用不要值 | `QOhosJsThreadGateway::invokeAndWaitForContinue` |
| JS 线程（NAPI 回调里） → Qt 线程 | `QtOhos::invokeInQtThread` |
| 跨线程持有 QObject 引用并安全访问 | `QtOhos::QThreadSafeRef<T>` |

## 用例：同步化异步 Ability 结果（OAuth 场景）

`startAbilityForResult` 在 OHOS SDK 里**没有 sync 变体**（源码 grep `interface_sdk-js` 全树 0 命中），Stage `UIAbility` 也无 `onAbilityResult` 生命周期覆写；`QtOhosExtras` **有** `startAbilityForResult`（异步，返回 `requestId` 经 `startAbilityForResultResponseReceived` 信号回调），但**无同步阻塞变体**（[[qt-ohos-extras]]）。要在 Qt 侧同步等结果（OAuth 授权码、选择器回传等），用 `evalWithPromise<T>` 在 **worker 线程**上阻塞等 ArkTS Promise resolve：

```cpp
// worker 线程（GUI 线程绝不能调）
QString code = QOhosJsThreadGateway::evalWithPromise<QString>(
    [&](QOhosJsState &js, QOhosTaskPromise<QString> p) {
        auto br = std::move(p).makeThenCatchBranches(Q_FUNC_INFO);
        js.evalToPromiseOrRejectOnThrow("globalThis.__qtStartOAuthForResult('...')")
          .then(std::move(br.thenFunc))
          .catch(std::move(br.catchFunc));
    });
```

**三个硬约束**：

1. **必须 worker 线程**：`evalWithPromise` 内部 `std::future::wait()` 真阻塞，GUI 线程调 = UI 冻 + appfreeze；JS 主线程调 = tsfn 回调不 fire = 死锁（[[ohos-mainthread-mismatch]]）。
2. **context 暴露**：`startAbilityForResult` 是 `UIAbilityContext` 实例方法，eval 上下文拿不到——caller 宿主 Ability 须先注册全局 helper（如 `globalThis.__qtStartOAuthForResult = async (wantJson) => await ctx.startAbilityForResult(...)`），纯 ArkTS NEXT 下 `globalThis` 受限时改走 NAPI tsfn 回调注入（`napi_create_reference` 持函数引用）。`evalWithPromise` 对模块级调用（`@ohos.wifiManager.getLinkedInfo()`）开箱即用，对实例方法须自己暴露符号。
3. **超时兜底**：OAuth 期间宿主 Ability 未销毁，tsfn 正常 pump；但绝不在退出路径上依赖 tsfn——[[quit-deadlock-tsfn]] 证明 Ability destroy 阶段 ArkTS 运行时不 pump tsfn 回调，Promise 永不 settle，阻塞调用 hang ~2min。`wait_for(timeout)` + `std::make_shared<std::promise<T>>`（防 broken_promise）是硬性要求。OHOS musl 无 `pthread_cancel`，阻塞调用无法强制打断。

**替代方案**：搬运既有同步 `doOAuth()` 且不想绑 Qt 私有 API 时，手写 NAPI tsfn + `std::promise<QString>` + requestCode-keyed `OAuthStore` 单例，同样在 worker 线程 `wait_for`。**别用嵌套 `QEventLoop`** 做 sync-from-async：OHOS 上 mid-wait 重入 + 依赖 JS 线程 pump tsfn，脆弱；Qt 自家 gateway 故意用 `std::promise::wait()` 而非嵌套 loop。

## 源码引用（Qt 5.15.16 / tqtc/harmonyos-5.15.16）

| 文件 | 行号 | 说明 |
|------|------|------|
| `qtbase/src/corelib/kernel/qcore_ohos_p.h` | 51-167 | `QOhosJsState` / `QOhosJsThreadGateway` namespace / `QOhosJsThreadOps` 声明 |
| `qtbase/src/corelib/kernel/qcore_ohos.cpp` | 19-54 | `QOhosJsThreadOps` 单例 + `QOhosJsThreadGateway` 门面转调 |
| `qtbase/src/plugins/platforms/ohos/qohosplugincore.cpp` | 780-821, 920 | `JsThreadOpsImpl` 实现 + `registerInstance` |
| `qtbase/src/platformsupport/fontdatabases/ohos/qohosplatformfontdatabase.cpp` | 86, 169, 235 | `evalWithPromise` / `runAndWait` / `eval` 实战用法 |
| `qtbase/src/corelib/io/qstandardpaths_ohos.cpp` | 22 | `eval` 实战用法 |
| `qtbase/src/plugins/bearer/ohos/src/ohosinterfaces/qohoswifi.cpp` | 90, 144, 187, 271, 285, 310, 332, 348 | `eval` / `evalWithPromise` 大量实战用法 |

## 参考来源

本文基于 Qt 5.15.16（tqtc/harmonyos-5.15.16, commit 962aa625）源码核实，非外部文档蒸馏——此为 Qt 私有 API，无官方外部文档。

| 来源 | 说明 |
|------|------|
| 🛠️ Qt 源码 | `qtbase/src/corelib/kernel/qcore_ohos.{cpp,p.h}` — 网关与接口声明/实现 |
| 🛠️ Qt 源码 | `qtbase/src/plugins/platforms/ohos/qohosplugincore.cpp` — `JsThreadOpsImpl` 后端实现 |
| 🛠️ Qt 源码 | `qohosplatformfontdatabase.cpp` / `qstandardpaths_ohos.cpp` / `qohoswifi.cpp` — 实战用法参考 |
| 📦 安装头文件 | `<LOCAL_PATH>` |

## 相关上下文

- [[qt-harmonyos-overview]] — QPA 插件架构总览
- [[qt-ohos-extras]] — 公共鸿蒙专有 API（`startAbility`/`QOhosWant` 等），与本文私有桥接层互补
- [[ohos-mainthread-mismatch]] — 双线程架构与 `theMainThread` 断言崩溃，反方向 `invokeInQtThread` 的使用场景
- [[qt-harmonyos-qt6-status]] — Qt6 鸿蒙化状态，迁移时注意此私有 API 可能在 Qt6 重构

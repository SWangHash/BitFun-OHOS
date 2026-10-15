---
id: semantic-qt-harmonyos-lifecycle
type: semantic
domain: tech
tags: [qt, harmonyos, lifecycle, ability, want, close-event, continuation, sharing]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-ohos-extras, semantic-qt-harmonyos-api]
summary: >
  Stage/UIAbility 生命周期的 Qt adapter：平台回调到 Qt main/event loop 的桥接、启动其他应用
  (显式/隐式Want)、被其他应用启动(module.json5 skills)、多实例管理、
  3级关闭拦截(WindowStageClose/AbilityClose/InternalClose)、
  应用接续(跨设备迁移)、分享(ShareKit)、无UI子进程、argv组装规则、主题管理。
---

# Stage/UIAbility 生命周期的 Qt adapter

> Stage/UIAbility、WindowStage、Want、skills、launchType 与保存恢复的平台语义，以 common 的 [[ohos-common-kb/semantic/stage-uiability-lifecycle|Stage 模型与 UIAbility 生命周期]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）为准。本页只维护平台回调如何映射到 Qt `main()`/event loop、`QWindow`/`QDialog`、QtOhosExtras、argv、关闭拦截、接续与分享 adapter。

## Qt 启动桥接 (Startup Flow)

Qt 适配层将平台生命周期事件桥接到标准 Qt `main()` 入口。平台回调的权威顺序见 common；下方只展示 Qt 胶水层增加的线程、共享库和 event loop seam。

### 启动时序

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. 系统启动 UIAbility（Stage 模型入口）                               │
│    ↓                                                                 │
│ 2. UIAbility 通过 NAPI 启动 Qt 线程                                  │
│    ↓                                                                 │
│ 3. 系统加载 Qt 共享库（.so），调用 main()                             │
│    ↓                                                                 │
│ 4. 主窗口创建并显示在 WindowStage 中                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 各阶段详解

| 阶段 | 执行方 | 说明 |
|------|--------|------|
| 1. 启动 UIAbility | 系统 | 系统根据 `module.json5` 配置创建 UIAbility 实例，调用 `onCreate()`、`onWindowStageCreate()` 等生命周期回调 |
| 2. NAPI 启动 Qt 线程 | QPA 插件 | Qt 的 ArkTS 侧适配层通过 NAPI（Native API）在独立线程中启动 Qt 运行时 |
| 3. 加载 .so 调用 main() | Qt 运行时 | 加载应用编译产出的共享库，执行标准 C++ `main(int argc, char *argv[])` |
| 4. 创建主窗口 | 开发者代码 | `QApplication` / `QGuiApplication` 初始化后创建主窗口，QPA 插件自动将其嵌入 WindowStage |

> **要点**：开发者只需编写标准 Qt `main()` 函数，Stage 模型的 ArkTS 侧由 QPA 插件自动处理，无需手动编写 Ability 生命周期代码。

## 启动其他应用 (Launching Other Apps)

鸿蒙通过 **Want** 对象实现 Ability 间通信，类似 Android 的 Intent。Qt 中通过 `QtOhosExtras::QOhosWant` 封装。

### 显式匹配 (Explicit Matching)

直接指定目标应用的 `bundleName` 和 `abilityName`，精确启动某个特定 Ability。

```cpp
#include <QtOhosExtras/qohoswant.h>
#include <QtOhosExtras/qohosuiabilitycontext.h>

QtOhosExtras::QOhosWant want;
want.bundleName = "com.example.targetapp";
want.abilityName = "MainAbility";

// 可选：附带参数
QJsonObject params;
params.insert("key", "value");
want.parameters = params;

QtOhosExtras::startAbility(want);
```

**适用场景**：明确知道目标应用的包名和 Ability 名称，如跳转到自家另一款应用。

### 隐式匹配 (Implicit Matching)

通过 `action`、`type`、`uri` 描述意图，由系统自动选择匹配的 Ability。

```cpp
QtOhosExtras::QOhosWant want;
want.action = "ohos.want.action.viewData";   // 动作：查看数据
want.type = "text/plain";                     // 数据类型
want.uri = "content://example/data";          // 数据 URI
QtOhosExtras::startAbility(want);
```

**适用场景**：不关心具体哪个应用处理，如分享文本、打开网页、查看图片等。

### 显式 vs 隐式对比

| 属性 | 显式匹配 | 隐式匹配 |
|------|---------|---------|
| 指定方式 | `bundleName` + `abilityName` | `action` + `type` + `uri` |
| 目标确定性 | 唯一确定 | 系统选择，可能弹出选择框 |
| 典型用途 | 应用间精确跳转 | 通用意图（分享、打开、查看） |
| 需要 exported | 是 | 是（且需 skills 匹配） |

## 被其他应用启动 (Being Launched by Other Apps)

### 1. module.json5 配置 skills

在 `module.json5` 中声明 Ability 能响应的意图类型：

```json
{
  "abilities": [{
    "name": "QAbility",
    "launchType": "specified",
    "exported": true,
    "skills": [{
      "entities": ["entity.system.home"],
      "actions": [
        "action.system.home",
        "ohos.want.action.viewData"
      ],
      "uris": [
        { "type": "*/*" }
      ]
    }]
  }]
}
```

| 字段 | 说明 |
|------|------|
| `entities` | Ability 的类别标识，`entity.system.home` 表示可在桌面启动 |
| `actions` | 能响应的动作，如 `ohos.want.action.viewData` 表示查看数据 |
| `uris` | 能处理的数据 URI 格式，`type` 指定 MIME 类型 |

> `exported: true` 是必须项，否则其他应用无法启动此 Ability。

### 2. 代码中监听 newWantReceived

当应用已在运行中被其他应用再次启动时，触发 `newWantReceived` 信号：

```cpp
QObject::connect(
    QtOhosExtras::QOhosUiAbilityContext::instance(),
    &QtOhosExtras::QOhosUiAbilityContext::newWantReceived,
    this,
    [](QtOhosExtras::QOhosWant want) {
        qDebug() << "Action:" << want.action;
        qDebug() << "URI:" << want.uri;

        // 处理附带参数
        if (want.parameters.contains("key")) {
            QString value = want.parameters.value("key").toString();
            // 根据参数执行相应逻辑
        }
    }
);
```

### 冷启动 vs 热启动接收 Want

| 场景 | 获取方式 |
|------|---------|
| 冷启动（应用未运行） | `QOhosAppContext::getAppLaunchWantInfo()->want()` 获取启动 Want |
| 热启动（应用已在后台） | 连接 `newWantReceived` 信号接收新 Want |

## 多实例管理 (Multiple Instance Management)

鸿蒙支持三种多实例模式，适用于不同业务场景：

### 模式对比

| 模式 | 进程数 | 窗口数 | 实现方式 | 适用场景 |
|------|--------|--------|---------|---------|
| **单例 (Singleton)** | 1 | 1 | 已有实例通过 `newWantReceived` 处理新请求 | 大多数应用，状态共享 |
| **多实例单进程** | 1 | N | 在 `newWantReceived` 中创建新窗口实例 | 多文档编辑器 |
| **多实例多进程** | N | N | `startAppProcess()` 启动新进程 | 需要进程隔离的场景 |

### 单例模式 (Singleton)

默认行为。新的启动请求会触发已有实例的 `newWantReceived`，在其中更新 UI 或跳转页面：

```cpp
QObject::connect(
    QtOhosExtras::QOhosUiAbilityContext::instance(),
    &QtOhosExtras::QOhosUiAbilityContext::newWantReceived,
    [](QtOhosExtras::QOhosWant want) {
        // 已有实例处理新请求，如打开新文档
        openDocument(want.uri);
    }
);
```

### 多实例单进程

在 `newWantReceived` 中创建新窗口，共享同一进程内存：

```cpp
QObject::connect(
    QtOhosExtras::QOhosUiAbilityContext::instance(),
    &QtOhosExtras::QOhosUiAbilityContext::newWantReceived,
    [](QtOhosExtras::QOhosWant want) {
        // 创建新的主窗口实例
        auto *window = new MainWindow();
        window->loadFromWant(want);
        window->show();
    }
);
```

### 多实例多进程

调用 `startAppProcess()` 启动独立进程，需要在 `module.json5` 中配置进程隔离：

```cpp
// 启动新进程
QtOhosExtras::startAppProcess("workerProcess", want);
```

`module.json5` 配置：

```json
{
  "app": {
    "extensionAbilities": [{
      "name": "workerProcess",
      "isolationProcess": true
    }]
  }
}
```

> **注意**：多进程模式下各进程内存不共享，需通过 IPC 机制通信。

## 应用退出 (Application Exit) — 3 级关闭拦截

这是鸿蒙生命周期中**最容易踩坑**的部分。系统在不同层级给予不同的拦截权限和时间窗口。

### 3 级关闭拦截总览

| 级别 | 名称 | 触发场景 | 拦截能力 | 时间限制 |
|------|------|---------|---------|---------|
| **Level 1** | Window (WindowStageClose) | 用户点击窗口关闭按钮 | 完整交互：可弹对话框、显示保存提示、等待用户操作 | **无限制** |
| **Level 2** | Ability (AbilityClose) | 任务中心/Dock 缩略图关闭 | 快速保存：不可弹 UI，只能做静默自动保存 | **有限**（系统给定超时） |
| **Level 3** | AbilityStage | 系统关机、Dock 右键菜单 | **尚未支持**，自动降级为 Level 2 | 降级到 Level 2 |

### 关闭方式 → 级别映射表

| 关闭方式 | 触发级别 | CloseEventRootCause | 可拦截行为 |
|---------|---------|---------------------|-----------|
| 主窗口关闭按钮 | Level 1 | `WindowStageClose` | Close / Hide / Minimize |
| 子窗口关闭按钮 | Level 1 | `WindowStageClose` | Close / Hide |
| 任务中心/Dock 缩略图 | Level 2 | `AbilityClose` | Close / Hide / Minimize（需快速完成） |
| Dock 右键菜单 | Level 3 | 降级到 Level 2 | 同 Level 2 |
| 系统托盘关闭 | Level 3 | 降级到 Level 2 | 同 Level 2 |
| 系统关机 | Level 3 | 降级到 Level 2 | 同 Level 2 |
| 任务管理器强杀 | — | — | **不可拦截** |
| 程序内部 `close()` | — | `InternalClose` | 直接接受 |

### 根据关闭根因分别处理

在 `closeEvent()` 中通过 `QtOhosExtras::getCloseEventRootCause()` 判断关闭来源，执行不同策略：

```cpp
void MainWindow::closeEvent(QCloseEvent *event) override {
    auto cause = QtOhosExtras::getCloseEventRootCause(event);

    switch (cause) {
    case QtOhosExtras::CloseEventRootCause::InternalClose:
        // 程序内部调用 close()，直接接受
        event->accept();
        break;

    case QtOhosExtras::CloseEventRootCause::WindowStageClose:
        // Level 1：用户点击窗口关闭按钮
        // 有充足时间，可以弹保存对话框等交互操作
        if (hasUnsavedChanges()) {
            showSaveDialog(event);  // 弹对话框让用户选择
        } else {
            event->accept();
        }
        break;

    case QtOhosExtras::CloseEventRootCause::AbilityClose:
        // Level 2：任务中心/Dock 关闭
        // 时间有限，不能弹 UI，只能快速自动保存
        if (hasUnsavedChanges()) {
            autoSave();  // 静默快速保存
        }
        event->accept();
        break;
    }
}
```

> **⚠️ 关键警告**：Level 2 时**绝对不能弹 UI**。如果在此级别弹出对话框，应用会卡在关闭流程中被系统强杀，用户体验极差。务必区分 Level 1 和 Level 2 的处理逻辑。

## 应用接续 (Application Continuation)

鸿蒙的核心特性之一：应用状态从一台设备无缝迁移到另一台设备（如手机 → 平板）。

### 源设备：序列化状态

连接 `continueRequestReceived` 信号，在用户发起接续时序列化当前应用状态：

```cpp
auto ability = QOhosAbilityContext::getInstanceForMainWindow(window.windowHandle());

QObject::connect(ability.get(), &QOhosUiAbilityContext::continueRequestReceived,
    [](auto ctx) {
        // 版本校验：确保源端和目标端应用版本一致
        auto appVersion = QOhosAppContext::instance()->getBundleInfo()->versionCode();

        if (ctx->sourceApplicationVersionCode() == appVersion) {
            // 序列化应用状态（payload 限制 < 100KB）
            QByteArray payload = serializeState();
            ctx->setAgreeResponse(payload);

            // 可选：接续完成后是否关闭源端应用
            ctx->setExitAppOnSourceDeviceAfterMigration(false);
        } else {
            // 版本不匹配，拒绝接续
            ctx->setMismatchResponse();
        }
    });
```

> **payload 限制 < 100KB**。大型数据（如文件、数据库）应先同步到云端，接续时仅传 key 或引用。

### 目标设备冷启动 (Cold Start)

应用未在目标设备运行时，从启动 Want 中获取接续数据：

```cpp
if (auto launchInfo = QOhosAppContext::getAppLaunchWantInfo()) {
    auto data = QtOhosExtras::tryGetOnContinueData(launchInfo->want());
    if (data) {
        deserializeState(*data);
    }
}
```

### 目标设备热启动 (Warm Start)

应用已在目标设备后台运行时，通过信号接收接续数据：

```cpp
QObject::connect(ability.get(), &QOhosUiAbilityContext::newWantInfoReceived,
    [](const QSharedPointer<QOhosWantInfo> &info) {
        // 确认是接续启动
        if (info->launchReason() == QOhosWantInfo::LaunchReason::Continuation) {
            auto data = QtOhosExtras::tryGetOnContinueData(info->want());
            if (data) {
                deserializeState(*data);
            }
        }
    });
```

### ContinueQuickStart 优化

在 `module.json5` 的 `continueType` 后追加 `_ContinueQuickStart` 后缀，系统将分两阶段启动目标应用：

| 阶段 | LaunchReason | 用途 |
|------|-------------|------|
| 第一阶段 | `PrepareContinuation` | 轻量初始化，显示加载占位界面 |
| 第二阶段 | `Continuation` | 收到完整数据，执行完整状态恢复 |

```json
{
  "abilities": [{
    "continueType": "video_ContinueQuickStart"
  }]
}
```

> 此优化可让用户更快看到目标应用的界面，减少接续等待时间。

## 应用分享 (Application Sharing)

通过鸿蒙 **Share Kit** 实现应用间内容分享。

### 发送端 (Sender)

创建分享记录并通过 `shareDataWithShareKit` 发起分享：

```cpp
#include <QtOhosExtras/qohossharekit.h>

// 创建文本内容记录
auto record = QtOhosExtras::ShareKit::createContentRecord(
    QMimeDatabase().mimeTypeForName("text/plain"),
    "这是要分享的文本内容");
record->setTitle("分享标题");
record->setDescription("分享描述");

// 发起分享（系统弹出分享面板）
auto ability = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
ability->shareDataWithShareKit({record}, nullptr);
```

也可以分享文件：

```cpp
auto fileRecord = QtOhosExtras::ShareKit::createFileRecord(
    QMimeDatabase().mimeTypeForFile("/path/to/image.png"),
    "/path/to/image.png");
```

### 接收端 (Receiver)

**冷启动**（从分享面板点击启动应用）：

```cpp
auto launchInfo = QOhosAppContext::getAppLaunchWantInfo();
auto records = QtOhosExtras::ShareKit::tryGetSharedRecordsFromShareKit(
    launchInfo->want());
for (const auto &record : records) {
    processSharedRecord(record);
}
```

**热启动**（应用已在后台运行）：

```cpp
QObject::connect(ability.get(), &QOhosUiAbilityContext::newWantInfoReceived,
    [](const QSharedPointer<QOhosWantInfo> &info) {
        auto records = QtOhosExtras::ShareKit::tryGetSharedRecordsFromShareKit(
            info->want());
        for (const auto &record : records) {
            processSharedRecord(record);
        }
    });
```

> 接收端同样需要在 `module.json5` 的 `skills` 中声明能处理的分享 action 和 MIME type。

## 无 UI 子进程 (UI-less Child Process)

用于执行后台任务（网络同步、数据处理、定时任务等），不创建窗口，节省资源。这是鸿蒙**原生**的 .so 子进程托管方式（Child Process Manager）。

> **与 QProcess 的关系**：无界面后台任务既可用本节 `startNoUiChildProcess`，也可直接用 `QProcess`（沙箱内可 fork/exec 无界面二进制）；有界面子进程须经 Ability 框架。决策树见 [[qt-harmonyos-api-mapping]] §1。

### 启动子进程

```cpp
// 主进程中启动无 UI 子进程
QtOhosExtras::QOhosAppContext::startNoUiChildProcess(
    "libBackgroundTask.so",           // 子进程加载的共享库
    QStringList{"task1", "param1"}    // 传递给子进程 main() 的参数
);
```

### 子进程内检测模式

```cpp
int main(int argc, char *argv[]) {
    if (QtOhosExtras::QOhosAppContext::isNoUiChildMode()) {
        // 无 UI 模式：不要创建 QApplication 或任何窗口
        // 只做后台处理
        runBackgroundTask(argc, argv);
        return 0;
    }

    // 正常 UI 模式
    QGuiApplication app(argc, argv);
    MainWindow w;
    w.show();
    return app.exec();
}
```

> **要点**：无 UI 子进程中**不要创建 `QApplication` / `QGuiApplication`**，也不要初始化任何 GUI 相关资源。

### 获取子进程 PID 与 kill 子进程（待上游补丁）

当前 `startNoUiChildProcess` 是 `static void`，**不返回 PID、无法 kill 子进程**。原因：底层 OHOS `childProcessManager.startChildProcess` 是**异步回调**，PID 在 AsyncCallback 里才得到（原仅用于 setup-data 文件 IPC 的 key 后丢弃）；且 `childProcessManager` **只有 start、没有 stop/abort/kill**（`appManager.killProcessesByBundleName` 只能按 bundle 杀整 app）。

中望3D 诉求（补丁待上游合入）新增：
- `Q_SIGNAL noUiChildProcessStarted(int pid, const QString &libraryName, const QStringList &args)` — 异步派发 PID（`Qt::QueuedConnection`，需事件循环在跑；PID 先于 setup-data 到达）
- `Q_SIGNAL noUiChildProcessStartFailed(const QString &libraryName)` — 启动失败（与 started 二选一，避免伙伴永挂）
- `static killNoUiChildProcess(int pid)` — `::kill(pid, SIGKILL)`（native，OHOS 无 stop API）
- `static isNoUiChildProcessRunning(int pid)` — `::kill(pid, 0)` 存活探测

> **kill 可行性**：native `::kill(pid,SIGKILL)` 是本库已验证模式（`killCurrentProcess`、`kill(pid,0)` 存活检查），但 APP_SPAWN_FORK 子进程的 **SELinux/MAC 域 + AMS 注册表 desync**（SIGKILL 绕过 AbilityManagerService，槽残留致下次 `16000062`）为**设备级未决**，须真机验证。`startNoUiChildProcess` 签名不变（向后兼容）。

## 参数传递 (Passing Arguments to main)

鸿蒙平台的 `argv` 组装规则与桌面平台有显著差异。

### argv 组装规则

| 索引 | 内容 | 说明 |
|------|------|------|
| `argv[0]` | 应用库路径（`.so`） | **不是**可执行文件路径，而是加载的共享库路径 |
| `argv[1...]` | 来自 `appArgs` 或 Want 参数 | 按规则从 Want 中提取 |

### Want 传参规则

| 参数 | 行为 |
|------|------|
| `want.uri` | 默认占用 `argv[1]` |
| `want.parameters["io.qt.useUriAsArg"]` | 设为 `false` 可禁止 URI 占位 |
| `want.parameters["io.qt.appArgs"]` | 自定义参数列表，填充 `argv[1...]` |

```json
{
  "parameters": {
    "io.qt.useUriAsArg": false,
    "io.qt.appArgs": ["--config", "production", "--verbose"]
  }
}
```

### 通过 hdc 调试传参

```bash
# 传递自定义参数
hdc shell aa start -a QAbility -b com.example.myapp \
  --pb io.qt.useUriAsArg false \
  --ps io.qt.appArgsJson '["--config","production","--verbose"]'
```

### argv 组装优先级

```
1. 如果 Want 中有 io.qt.appArgs → 使用其值作为 argv[1...]
2. 如果 want.uri 存在且 useUriAsArg 未禁用 → uri 占 argv[1]
3. 否则 argv 仅包含 argv[0]（库路径）
```

## 主题管理 (Theme Management)

鸿蒙支持深色/浅色模式切换，Qt 通过 `QOhosAppContext` 提供查询和监听接口。

### 查询当前主题

```cpp
auto *ctx = QtOhosExtras::QOhosAppContext::instance();
bool isDark = ctx->darkThemeActive();
```

### 设置主题跟随策略

```cpp
// 跟随系统设置（默认）
ctx->setColorThemeMode(
    QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting);

// 强制浅色
ctx->setColorThemeMode(
    QtOhosExtras::QOhosAppContext::ColorThemeMode::LightTheme);

// 强制深色
ctx->setColorThemeMode(
    QtOhosExtras::QOhosAppContext::ColorThemeMode::DarkTheme);
```

### 监听主题变化

```cpp
QObject::connect(ctx, &QtOhosExtras::QOhosAppContext::darkThemeActiveChanged,
    [](bool dark) {
        qDebug() << "Theme changed to:" << (dark ? "Dark" : "Light");
        // 更新 UI 颜色、图标、样式等
        updateColorScheme(dark);
    });
```

> **最佳实践**：结合 Qt 的 QPalette 或 QSS 样式表，在主题变化信号中动态切换应用配色方案。

## 相关文档

- [[qt-harmonyos-overview]] — Qt 鸿蒙化总览与架构
- [[qt-ohos-extras]] — QtOhosExtras 模块 API 详解
- [[qt-harmonyos-api]] — API 兼容性笔记

## 参考来源

- [Application Lifecycle on HarmonyOS](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_lifecycle_guide)
- [Application Continuation Guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_continuation_guild)
- [Application Sharing Guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/application_share_guild)
- [QOhosWant Usage](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_use_QOhosWant)
- [Pass Arguments to main()](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_pass_args_to_main_guide)
- [Color Theme](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/qt_for_harmonyos_color_theme)
- [UI-less Child Process](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide/how_to_start_uiless_child_process)

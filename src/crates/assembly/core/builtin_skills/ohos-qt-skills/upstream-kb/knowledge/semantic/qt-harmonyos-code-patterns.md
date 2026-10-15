---
id: semantic-qt-harmonyos-code-patterns
type: semantic
domain: tech
tags: [qt, harmonyos, code-patterns, porting, before-after, examples]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-api-mapping, semantic-qt-harmonyos-porting-workflow, semantic-qt-ohos-extras]
summary: >
  HarmonyOS 平台能力的 Qt adapter 代码速查：14 组 Before/After，覆盖子进程、Want、
  独立对话框→tagged子窗口、关闭事件处理、文件权限守卫、参数解析、
  平台构建配置、深色模式、拖放、等宽字体、浮窗、分享数据、Qt6→Qt5 shim移植(不改原src)、
  数据库文件路径。
---

# HarmonyOS 平台能力的 Qt adapter：14 组 Before/After

> 来源：[Code Patterns: Before/After Porting Examples](https://wiki.qt.io/Qt_for_HarmonyOS/code_patterns)
> 关联：[[qt-harmonyos-api-mapping]]、[[qt-harmonyos-porting-workflow]]、[[qt-ohos-extras]]
>
> 本页只维护可复制的 Qt/QtOhosExtras/QPA 代码改写。Want 与生命周期语义见 [[ohos-common-kb/semantic/stage-uiability-lifecycle|Stage 模型与 UIAbility 生命周期]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）；窗口/XComponent seam 见 [[ohos-common-kb/semantic/arkui-window-xcomponent-model|ArkUI 窗口与 XComponent 承载模型]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/arkui-window-xcomponent-model.md)）；文件权限与 loader 限制见 [[ohos-common-kb/semantic/harmonyos-platform-limits|HarmonyOS 平台限制]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）；bundle/data 路径选择见 [[ohos-common-kb/semantic/application-sandbox-paths|HarmonyOS 应用沙箱路径与代码加载]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/application-sandbox-paths.md)）。

## 模式一览

| # | 场景 | 核心变化 |
|---|------|----------|
| 1 | 子进程 | QProcess 按场景：无界面保留 / 有界面Qt用 startAppProcess / 有界面非Qt用 startAbility |
| 2 | 启动外部应用 | QDesktopServices / JNI → startAbility() |
| 3 | 独立对话框 | 直接 show() → tagAsSubWindowOf() |
| 4 | 关闭事件处理 | 统一 closeEvent → 区分 WindowStage/Ability/Internal |
| 5 | 文件权限守卫 | setPermissions → 条件编译跳过 |
| 6 | 参数解析 | argv 直取 → QCommandLineParser |
| 7 | 平台构建配置 | qmake 缺 ohos 分支 → 补充 ohos {} |
| 8 | 深色模式 | 手动 palette → ColorThemeMode 跟随系统 |
| 9 | 拖放 | dragEnter 读数据 → 仅检查 MIME，drop 再读 |
| 10 | 等宽字体 | systemFont → 自带 .ttf 注册 |
| 11 | 浮窗 | 无 → setShowWindowAsFloatWindowHint() |
| 12 | 分享数据 | 无 → ShareKit 集成 |
| 13 | Qt6→Qt5 shim 移植 | Qt6-only API/不可用三方库 → 独立 shim 层替代（不改原 src） |
| 14 | 数据库文件路径 | 相对文件名 → QStandardPaths 沙箱可写绝对路径 |

---

## 模式 1：子进程 → 按场景选择（非一刀切）

桌面/Android 用 `QProcess` 启动子进程。鸿蒙上要按场景选择，不能一刀切。

> 四场景决策树（无界面保留 QProcess / 有界面 Qt 用 startAppProcess / 有界面非 Qt 用 startAbility / 无界面需托管用 startNoUiChildProcess）详见 [[qt-harmonyos-api-mapping]] §1 进程管理。

**Before (Desktop/Android)**
```cpp
#include <QProcess>

void MainWindow::runWorker() {
    QProcess proc;
    proc.start("worker", {"--input", inputFile});
    proc.waitForFinished();
}
```

**After (HarmonyOS) — 无界面：保持 QProcess 不改**
```cpp
// 无界面计算子进程：QProcess 原样保留
void MainWindow::runWorker() {
    QProcess proc;
    proc.start("worker", {"--input", inputFile});
    proc.waitForFinished();
}
```

**After (HarmonyOS) — 无界面但需原生托管（.so 子进程）**
```cpp
#include <QtOhosExtras/qohosappcontext.h>

void MainWindow::runWorker() {
    QtOhosExtras::QOhosAppContext::startNoUiChildProcess(
        "libWorker.so",
        QStringList{"--input", inputFile}
    );
}
```

> **关键约束**：`startNoUiChildProcess` 的子进程必须编译为 `.so` 共享库，部署到 `entry/libs/<arch>/`，且子进程内**禁止**创建 `QApplication`/GUI。若只是无界面计算，**首选保持 QProcess 不改**。
> 详见 [[qt-ohos-extras]] 中 startNoUiChildProcess 的说明，决策树见 [[qt-harmonyos-api-mapping]] §1。

---

## 模式 2：启动外部应用 → Start Ability

桌面用 `QDesktopServices::openUrl()`，Android 用 JNI 构造 Intent；Qt 的 HarmonyOS adapter 使用 `QOhosWant` + `startAbility()`。

**Before (Desktop)**
```cpp
QDesktopServices::openUrl(QUrl("https://example.com"));
```

**Before (Android)**
```cpp
QAndroidJniObject intent("android/content/Intent");
// ... 复杂的 JNI 构造
```

**After (HarmonyOS)**
```cpp
QtOhosExtras::QOhosWant want;
want.uri = "https://example.com";
want.action = "ohos.want.action.viewData";
QtOhosExtras::startAbility(want);
```

> 参考 [[qt-ohos-extras]] 中 QOhosWant 和 startAbility() 的完整参数说明。

---

## 模式 3：独立对话框 → Tagged Subwindow

在 Qt QPA adapter 中，无 parent 的独立 `QDialog` 会映射为新主窗口；需要子窗口语义时必须 tagging，参见 [[qt-harmonyos-api-mapping]]。

**Before (Desktop)**
```cpp
void MainWindow::showSettings() {
    SettingsDialog *dlg = new SettingsDialog();
    dlg->setAttribute(Qt::WA_DeleteOnClose);
    dlg->show();
}
```

**After (HarmonyOS)**
```cpp
void MainWindow::showSettings() {
    SettingsDialog *dlg = new SettingsDialog();
    // 关键：标记为当前主窗口的子窗口
    QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(dlg, this->windowHandle());
    dlg->setAttribute(Qt::WA_DeleteOnClose);
    dlg->show();
}
```

> **注意**：不调用 `tagWindowOrWidgetAsSubWindowOf()` 的无 parent 对话框会成为独立主窗口，不具备预期的子窗口层级与模态语义。

---

## 模式 4：关闭事件处理 — 区分关闭原因

Qt adapter 会把窗口关闭、Ability 生命周期销毁和内部关闭映射到 `closeEvent`，需按 root cause 分别处理。

**Before (Desktop)**
```cpp
void MainWindow::closeEvent(QCloseEvent *event) {
    if (unsavedChanges()) {
        int ret = QMessageBox::question(this, "Save?",
            "Unsaved changes. Save before closing?",
            QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel);
        if (ret == QMessageBox::Save) { save(); event->accept(); }
        else if (ret == QMessageBox::Discard) { event->accept(); }
        else { event->ignore(); }
    }
}
```

**After (HarmonyOS)**
```cpp
void MainWindow::closeEvent(QCloseEvent *event) {
    auto cause = QtOhosExtras::getCloseEventRootCause(event);

    if (cause == QtOhosExtras::CloseEventRootCause::WindowStageClose) {
        // 用户关窗口 → 正常询问保存（完整交互）
        if (unsavedChanges()) {
            int ret = QMessageBox::question(this, "Save?",
                "Unsaved changes. Save before closing?",
                QMessageBox::Save | QMessageBox::Discard | QMessageBox::Cancel);
            if (ret == QMessageBox::Save) { save(); event->accept(); }
            else if (ret == QMessageBox::Discard) { event->accept(); }
            else { event->ignore(); }
        }
    } else if (cause == QtOhosExtras::CloseEventRootCause::AbilityClose) {
        // 系统回收 Ability → 静默自动保存，不要弹窗
        if (unsavedChanges()) autoSave();
        event->accept();
    } else {
        // InternalClose → 直接接受
        event->accept();
    }
}
```

> **核心原则**：
> - `WindowStageClose` — 用户主动关窗口，可以弹 QMessageBox 完整交互
> - `AbilityClose` — 系统回收 Ability，用户已不在前台，必须快速 autoSave，禁止弹窗
> - `InternalClose` — 程序内部触发，直接 accept

---

## 模式 5：文件权限守卫

平台权限模型以 common 为准；Qt 代码用条件编译避免把 `QFile::setPermissions()` 成功作为流程前提。

**Before (Cross-platform)**
```cpp
QFile file(path);
file.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
```

**After (HarmonyOS-aware)**
```cpp
QFile file(path);
#ifndef Q_OS_OHOS
file.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
#endif
```

> 在鸿蒙上调用 `setPermissions()` 会失败或产生未定义行为。用 `#ifndef Q_OS_OHOS` 条件编译守卫。

---

## 模式 6：参数解析 → QCommandLineParser

鸿蒙的 `argv[0]` 是应用库路径而非可执行文件路径，Want 参数可能占用 `argv[1]`。不要假设业务参数位置，改用 `QCommandLineParser`。参见 [[qt-harmonyos-api-mapping]] 参数传递章节。

**Before (Desktop)**
```cpp
int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    QString configFile = argv[1]; // 假设 argv[1] 是配置文件
    // ...
}
```

**After (HarmonyOS-aware)**
```cpp
int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    QCommandLineParser parser;
    parser.addOption({"config", "Config file", "file"});
    parser.process(app);
    QString configFile = parser.value("config");
    // ...
}
```

> **关键约束**：永远不要直接索引 `argv[N]` 取业务参数。使用 `QCommandLineParser` 是跨平台安全做法。

---

## 模式 7：平台构建配置 → 补充 ohos 分支

qmake 项目文件中 Linux 条件 `unix:!android:!macx` 会错误匹配 ohos，需显式排除并添加 ohos 分支。构建详情见 [[qt-harmonyos-porting-workflow]]。

**Before (.pro)**
```qmake
win32 {
    SOURCES += platform_win.cpp
}
unix:!android:!macx {
    SOURCES += platform_linux.cpp
}
android {
    SOURCES += platform_android.cpp
}
```

**After (Add OHOS)**
```qmake
win32 {
    SOURCES += platform_win.cpp
}
unix:!android:!macx:!ohos {
    SOURCES += platform_linux.cpp
}
android {
    SOURCES += platform_android.cpp
}
ohos {
    QT += ohosextras
    SOURCES += platform_ohos.cpp
}
```

> **注意**：
> - `unix` 分支必须追加 `:!ohos` 排除鸿蒙，否则 ohos 会同时命中 unix 分支
> - `ohos` 分支必须加 `QT += ohosextras` 才能使用 QtOhosExtras API

---

## 模式 8：深色模式支持 → 跟随系统

桌面通过手动设置 QPalette 实现暗色主题。鸿蒙通过 `QOhosAppContext` 跟随系统暗色设置，并响应动态变化信号。

**Before (Desktop)**
```cpp
QApplication::setStyle("fusion");
QPalette darkPalette;
darkPalette.setColor(QPalette::Window, QColor(53, 53, 53));
darkPalette.setColor(QPalette::WindowText, Qt::white);
// ... 手动设置各颜色角色
qApp->setPalette(darkPalette);
```

**After (HarmonyOS)**
```cpp
#include <QtOhosExtras/qohosappcontext.h>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    auto *ctx = QtOhosExtras::QOhosAppContext::instance();
    ctx->setColorThemeMode(
        QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting);

    MainWindow w;
    QObject::connect(ctx, &QOhosAppContext::darkThemeActiveChanged,
        [&w](bool dark) { w.updateTheme(dark); });
    w.show();
    return app.exec();
}
```

> `FollowSystemSetting` 自动跟随系统深浅色切换；`darkThemeActiveChanged(bool)` 信号在切换时触发，可在槽函数中更新自定义样式。

---

## 模式 9：拖放 → 延迟读取数据

鸿蒙拖放的 MIME 数据在 `dragEnterEvent` 时可能不可用，只能在 `dropEvent` 中读取实际内容。

**Before (Desktop)**
```cpp
void Widget::dragEnterEvent(QDragEnterEvent *event) {
    if (event->mimeData()->hasText()) {
        QString text = event->mimeData()->text(); // 直接读取数据
        if (isValidData(text))
            event->acceptProposedAction();
    }
}
```

**After (HarmonyOS)**
```cpp
void Widget::dragEnterEvent(QDragEnterEvent *event) {
    if (event->mimeData()->hasText()) {  // 仅检查 MIME 类型
        event->acceptProposedAction();
        // 不要在 OHOS 上此处读取 text() 实际数据
    }
}

void Widget::dropEvent(QDropEvent *event) {
    QString text = event->mimeData()->text(); // 在 drop 时读取实际数据
    processData(text);
}
```

> **核心原则**：`dragEnterEvent` 只做 `hasText()` / `hasUrls()` 等类型检查，`dropEvent` 才读取实际内容。这是因为鸿蒙拖放协议的数据传输是异步的。

---

## 模式 10：等宽字体 → 自带 TTF

鸿蒙系统不提供等宽字体，`QFontDatabase::systemFont(QFontDatabase::FixedFont)` 返回普通字体。需自带 `.ttf` 并通过 `addApplicationFont()` 注册。

**Before (Desktop)**
```cpp
QFont monoFont = QFontDatabase::systemFont(QFontDatabase::FixedFont);
editor->setFont(monoFont);
```

**After (HarmonyOS)**
```cpp
#ifdef Q_OS_OHOS
int fontId = QFontDatabase::addApplicationFont(":/fonts/NotoSansMono-Regular.ttf");
QStringList families = QFontDatabase::applicationFontFamilies(fontId);
QFont monoFont(families.first());
#else
QFont monoFont = QFontDatabase::systemFont(QFontDatabase::FixedFont);
#endif
editor->setFont(monoFont);
```

> **部署步骤**：
> 1. 将 `NotoSansMono-Regular.ttf` 放入项目资源文件（`.qrc`）
> 2. 通过 `:/fonts/` 前缀引用
> 3. `addApplicationFont()` 返回 fontId，用 `applicationFontFamilies()` 获取实际字体族名

---

## 模式 11：浮窗（鸿蒙独有能力）

鸿蒙支持 Floating Window，桌面端无此概念。通过 `setShowWindowAsFloatWindowHint()` 启用悬浮窗显示。

**New (HarmonyOS only)**
```cpp
#include <QtOhosExtras/qohoswindowutils.h>

void MainWindow::openFloatingNote() {
    NoteWidget *note = new NoteWidget();
    QtOhosExtras::setShowWindowAsFloatWindowHint(note, true);
    note->setAttribute(Qt::WA_DeleteOnClose);
    note->resize(300, 400);
    note->show();
}
```

> **注意**：悬浮窗需要 `ohos.permission.SYSTEM_FLOAT_WINDOW` 权限，第三方应用通常不可用。桌面端此函数无效果。

---

## 模式 12：分享数据（鸿蒙独有能力）

通过 ShareKit 将文件分享到系统其他应用。桌面端无对等能力。

**New (HarmonyOS only)**
```cpp
#include <QtOhosExtras/qohossharekit.h>
#include <QtOhosExtras/qohosuiabilitycontext.h>

void MainWindow::shareFile(const QString &filePath) {
    auto record = QtOhosExtras::ShareKit::createFileRecord(QFileInfo(filePath));
    record->setTitle(QFileInfo(filePath).fileName());

    auto ability = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
    ability->shareDataWithShareKit({record}, nullptr);
}
```

> `createFileRecord()` 从 `QFileInfo` 构造分享记录，`shareDataWithShareKit()` 调起系统分享面板。第二个参数为回调，传 `nullptr` 表示不关心结果。

---

## 模式 13：Qt6 应用 → Qt5 OHOS shim 移植（不改原 src）

> 目标 Qt6 的应用移植到 Qt 5.15 OHOS 时，Qt6-only API / 不可用三方库（qcoro C++20 协程、exiv2 等）通过**独立 shim 层**替代，**不修改应用原始 src/**。源自 vooki-image-viewer 鸿蒙化实战。

**布局**（场景二 OhosExampleApp 变体）：
```
<app>/                     # 原始仓库，不动
├── src/...                # 原始源码
└── OhosExampleApp/        # shim 层 + OHOS 入口
    ├── CMakeLists.txt     # 用 shim .cpp 替换原始 .cpp（排除原始、加入 shim）
    ├── main.cpp           # extern "C" int main
    ├── ImageLoaderShim.cpp      # 替代 src/processing/ImageLoader.cpp
    ├── Application.cpp          # stub：Qt6 QLibraryInfo 新 API → Qt5
    ├── MetadataExtractorStub.cpp # 禁用 EXIF（exiv2 不可用）
    ├── ohos_compat.h            # std::ranges 等 OHOS NDK libc++ 缺失设施 shim
    ├── qcoro_shim/              # qcoro Task/Future 协程最小骨架
    └── exiv2_stub/exiv2/exiv2.hpp  # exiv2 占位头
```

**CMakeLists 替换模式**（用 shim 替代原始 .cpp，include 路径指向 ../src 使 shim 能引用原始头）：
```cmake
# 排除含 Qt6-only API 的原始文件
set(OHOS_SOURCES
    main.cpp
    ImageLoaderShim.cpp        # 替代 ../src/processing/ImageLoader.cpp
    Application.cpp            # stub
    MetadataExtractorStub.cpp  # stub
)
# Q_OBJECT 头若被 shim 经 ../src include 引用，必须显式列入 add_library
# （否则 AUTOMOC 跨目录不生成/不链接 moc → undefined vtable/staticMetaObject）
set(OHOS_HEADERS
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/processing/Application.h
    ${CMAKE_CURRENT_SOURCE_DIR}/../src/processing/MetadataExtractor.h
)
add_library(Ohos<App> SHARED ${OHOS_SOURCES} ${OHOS_HEADERS} ...)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../src)
```

**shim .cpp 模式**（移除 Qt6-only 调用，逻辑降级）：
```cpp
// ImageLoaderShim.cpp —— 替代 ImageLoader.cpp
#include "processing/ImageLoader.h"
// Qt6: QImageReader::setAllocationLimit(512); // Qt5.15 无此 API，且仅是内存上限，省略安全
QImage ImageLoader::load(const QString &path) { /* 用 Qt5 API 实现 */ }
```

**适用场景与限制**：
- Qt6-only API（如 `QImageReader::setAllocationLimit`、`QLibraryInfo` 新路径 API）→ shim 替代或降级
- 不可用三方库（exiv2/qcoro）→ stub 占位（功能降级，编译通过；运行时该功能不可用）
- OHOS NDK libc++ 缺失（`std::ranges`）→ `ohos_compat.h` 提供 min-max shim
- **原则**：shim 只在 OhosExampleApp/ 层，原始 src/ 不动——便于上游同步、隔离 OHOS 特定逻辑
- **不适用**：若应用核心功能强依赖 Qt6 专有模块（如 QtQuick3D、QtMultimedia6 新 API），shim 无法替代，需评估真迁移或阻塞

> AUTOMOC/AUTOUIC 跨目录陷阱：Q_OBJECT 头若被 shim 经 `../src` include 引用，必须显式列入 `add_library`（否则 AUTOMOC 跨目录不生成/不链接 moc → undefined vtable/staticMetaObject）；.ui 在独立子目录时设 `CMAKE_AUTOUIC_SEARCH_PATHS`。

---

## 模式 14：数据库文件路径 → 沙箱可写绝对路径

Qt 应用的 CWD 可能位于只读 bundle 或不可预期路径。SQLite/配置文件应通过 `QStandardPaths::writableLocation(AppLocalDataLocation)` 取得 Qt 映射后的可写目录，不在本页硬编码平台路径；该 API 在桌面端同样成立，通常无需 `#ifdef`。

**Before (Desktop-friendly but breaks on OHOS)**
```cpp
QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE");
db.setDatabaseName("myapp.db");   // 裸文件名，依赖 CWD 可写
if (!db.open()) {
    QMessageBox::information(nullptr, "错误", "无法创建本地数据库 !");
    exit(-1);
}
```

**After (HarmonyOS-aware, unified cross-platform)**
```cpp
#include <QStandardPaths>
#include <QDir>

QSqlDatabase db = QSqlDatabase::addDatabase("QSQLITE");
QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
if (dataDir.isEmpty()) dataDir = QDir::currentPath();   // 兜底
QDir().mkpath(dataDir);
db.setDatabaseName(dataDir + QDir::separator() + "myapp.db");
if (!db.open()) {
    qWarning() << "DB open failed:" << db.lastError().text() << "path:" << db.databaseName();
    QMessageBox::information(nullptr, "错误",
        QString("无法创建本地数据库 !\n路径: %1\n错误: %2").arg(db.databaseName(), db.lastError().text()));
    exit(-1);
}
```

> **关键约束**：
> - `AppLocalDataLocation` 在 OHOS 映射 `preferencesDir`（el2 可写沙箱，文件 IO 允许，仅 `.so` dlopen 被拒——故放 `.db` 安全，见 [[qt-harmonyos-platform-limits]] §dlopen）
> - `exit(-1)` 在 OHOS 会被 `libappspawn_helper.z.so` 拦截转 `SIGABRT` cppcrash（`LastFatalMessage: Unexpected call: exit(-1)`），如需静默退出改 `QCoreApplication::exit()`
> - **驱动插件独立问题**：即使路径正确，若 `libqsqlite.so` 未部署到 `libs/<abi>/sqldrivers/`，`open()` 仍返回 false（driver null，不碰文件系统）——见 [[qt-harmonyos-project-structure]] §6.2 + [runtime-fail-sqlite-open-database](../problems/runtime-fail-sqlite-open-database.md)
> - 桌面端建议补 `QCoreApplication::setOrganizationName()/setApplicationName()`，使路径含合理 `<App>` 段（OHOS 端由 bundleName 决定不受影响）

---

## 移植检查清单

在实际移植中，按以下顺序逐项排查：

1. **构建系统** — qmake/CMake 是否补充了 `ohos` 分支和 `QT += ohosextras`？（模式 7）
2. **进程模型** — 是否用 QProcess？→ 按场景：无界面保留 / 有界面 Qt 用 startAppProcess / 有界面非 Qt 用 startAbility / 需托管用 startNoUiChildProcess（模式 1）
3. **外部调用** — 是否用 QDesktopServices / JNI？→ 改为 startAbility（模式 2）
4. **窗口/对话框** — 所有独立顶级窗口是否 tag 为子窗口？（模式 3）
5. **生命周期** — closeEvent 是否区分 WindowStage / Ability / Internal？（模式 4）
6. **文件系统** — setPermissions 调用是否已条件编译守卫？（模式 5）
7. **参数传递** — 是否依赖 argv 位置？→ 改用 QCommandLineParser（模式 6）
8. **UI 适配** — 深色模式（模式 8）、拖放（模式 9）、等宽字体（模式 10）
9. **鸿蒙增强** — 是否需要浮窗（模式 11）或系统分享（模式 12）？

---

## 参考来源

- [Qt for HarmonyOS Code Patterns (Wiki)](https://wiki.qt.io/Qt_for_HarmonyOS/code_patterns) — 原始 Before/After 示例
- [[qt-harmonyos-api-mapping]] — API 兼容性映射（argv、QProcess、窗口模型）
- [[qt-harmonyos-porting-workflow]] — 移植工作流与检查清单
- [[qt-ohos-extras]] — QtOhosExtras 模块 API 参考

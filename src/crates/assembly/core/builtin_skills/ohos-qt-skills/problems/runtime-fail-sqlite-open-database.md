---
id: problem-runtime-sqlite-open-database
type: problem
domain: runtime
tags: [runtime, sqlite, qsqlite, sqldrivers, QSqlDatabase, driver-not-loaded, relative-path, QStandardPaths, filesystem, dlopen, appspawn, exit-sigabrt]
created: 2026-07-07
updated: 2026-07-07
status: solved
audience: public
summary: "应用启动弹「无法创建本地数据库」后 native cppcrash 退出（QSQLITE driver not loaded / 相对路径）"
severity: high

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  无法创建本地数据库 !
  QSqlDatabase: QSQLITE driver not loaded
  unable to open database file
  LastFatalMessage: [appspawn_server.c:69]Unexpected call: exit(-1)
  Reason: Signal:SIGABRT(SI_TKILL)
  #03 libOhosChessGame.so(Database::Database()+352)
error_code: ""
keywords: [QSQLITE, libqsqlite, sqldrivers, QSqlDatabase, driver not loaded, setDatabaseName, 相对路径, QStandardPaths, AppLocalDataLocation, exit(-1), SIGABRT, cppcrash]
symptoms: "应用启动即弹 QMessageBox '无法创建本地数据库 !' 后崩溃退出（实为 native cppcrash），Login 窗口未显示"

# ====== 问题详情 ======
environment: "Qt 5.12.12 OHOS SDK（CMAKE_PREFIX_PATH=<QT5_12_OHOS_SDK>），ChessClient 鸿蒙化（场景二 OhosExampleApp 包装），真机 HUAWEI MateBook Fold，bundleName=com.example.chessgame"
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-code-patterns]
related_problems: [problem-runtime-qpa-plugin-not-found, problem-runtime-dlopen-writable-path, problem-build-hvigor-native-skip]
---

# QSqlDatabase open() 失败致启动崩溃（驱动未部署 + 相对路径双根因）

## 错误信息

### 用户侧
应用启动即弹 `QMessageBox`：「无法创建本地数据库 !」，点确定后应用消失。

### faultlog（cppcrash-com.example.chessgame-20260707084730）
```
LastFatalMessage: [appspawn_server.c:69]Unexpected call: exit(-1)
Reason: Signal:SIGABRT(SI_TKILL)
#00 raise
#01 abort
#02 libappspawn_helper.z.so(exit+144)
#03 libOhosChessGame.so(Database::Database()+352)   ← exit(-1) 调用点
#04 Database::GetInstance()+80
#05 Login::loadStatusFromDB()+40
#06 Login::Login(QWidget*)+332
#07 main+96
#08..#45 libqohos.so（Qt OHOS bootstrap）
```

### 关键诊断信号
- 崩溃进程内存映射 `grep "qsqlsqlite|sqldrivers|QSqlDriver"` **无任何匹配**——Qt 驱动 .so 从未 dlopen 进进程（仅有系统原生 `libsqlite.z.so`，Qt 用不了）
- 磁盘 `entry/libs/arm64-v8a/` 只有 `styles/libqohosstyle.so`，**无 `sqldrivers/` 目录、无 `libqsqlite.so`**
- `db->lastError().text()`（修复时补打）= `"Driver not loaded"`

## 场景

开源 Qt Widgets 应用（象棋游戏 ChessClient）鸿蒙化迁移。原桌面 `.pro` 用 `QT += sql`，`database.cpp` 在单例构造函数里 `setDatabaseName("ChineseChess.db")`（裸文件名）+ `open()` 失败即 `exit(-1)`。`Login` 构造时调 `Database::GetInstance()` 首次实例化 → `open()` 失败 → 弹框 → `exit(-1)`，发生在 `a.exec()` 之前（启动早期）。

编译通过、HAP 能安装启动（QPA 插件已加载，能跑到弹 QMessageBox），但数据库初始化即崩。

## 原因

**双根因并存，须同修：**

### 根因 1（触发根因，high）：QSQLITE 驱动插件未部署
`OhosExampleApp/CMakeLists.txt` 已 `find_package(Qt5 ... Sql)` + `target_link_libraries(... Qt5::Sql ...)`（链接 `libQt5Sql.so` 主库，已进 HAP），但 **`libqsqlite.so` 驱动插件未部署**。

- 驱动性质：`Qt5Sql_QSQLiteDriverPlugin.cmake` 声明 `add_library(Qt5::QSQLiteDriverPlugin MODULE IMPORTED)` + `PLUGIN_LOCATION=sqldrivers/libqsqlite.so`——**动态 MODULE 插件**，运行时由 `QFactoryLoader` 按 `sqldrivers/` 子目录 dlopen 加载。
- 非 NEEDED 依赖：`libQt5Sql.so` 与业务库的 strings 均无 `libqsqlite` 引用，CMake/HVigor **不会自动打包**它。
- SDK 无 sqlite 静态 `.a`，`Q_IMPORT_PLUGIN` 静态路径不可行。
- 对比：`libqohosstyle.so`→`styles/`、`libqsvg.so`→`imageformats/` 都手拷部署（铁律 B7），`sqldrivers/` 被遗漏。

**决定性逻辑**：driver 缺失时 `QSqlDatabase::open()` 第一步检查 `d->driver` 为空，**直接返回 false 并置 `lastError="Driver not loaded"`，根本不调用 `sqlite3_open`、不碰文件系统**。所以根因 2（路径）的因果链在本次运行中从未启动——只改路径不部署驱动，崩溃不变。

### 根因 2（并发隐患，medium）：setDatabaseName 用相对路径
`setDatabaseName("ChineseChess.db")` 仅文件名，依赖进程 CWD 可写。OHOS 应用以共享库方式加载（铁律 L2：`argv[0]` 是 .so 路径），CWD 多落在只读 `el1/bundle` 区（faultlog 显示 `libOhosChessGame.so` 来自 `/data/storage/el1/bundle/libs/arm64/`）。驱动部署到位后，该缺陷会作为第二故障显现——SQLite `CANTOPEN(14)`/`EACCES`。

### 崩溃机制（非根因）
`exit(-1)` 被 OHOS `libappspawn_helper.z.so` 拦截判为 "Unexpected call"，转 `raise(SIGABRT)`→`abort()` 生成 cppcrash（故用户看到的是 native 崩溃而非静默退出）。

## 解决方案

### 1. 部署 QSQLITE 驱动插件（首要，对齐铁律 B7）

```bash
mkdir -p <工程>/HarmonyOS/entry/libs/arm64-v8a/sqldrivers/
cp <Qt_SDK>/plugins/sqldrivers/libqsqlite.so \
   <工程>/HarmonyOS/entry/libs/arm64-v8a/sqldrivers/libqsqlite.so
```

⚠️ **OHOS SDK 驱动文件名是 `libqsqlite.so`，不是桌面的 `libqsqlsqlite.so`**（`Qt5Sql_QSQLiteDriverPlugin.cmake` 的 `PLUGIN_LOCATION` 已核实）。

**CMake 不用改**——动态分类插件 `target_link_libraries` 无效，SDK 也无静态 `.a` 故 `Q_IMPORT_PLUGIN` 不可行。可选：在 `CMakeLists.txt` 末尾加 `add_custom_command(POST_BUILD)` 自动拷贝防复发：

```cmake
add_custom_command(TARGET <app> POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory
    ${CMAKE_CURRENT_SOURCE_DIR}/../HarmonyOS/entry/libs/arm64-v8a/sqldrivers
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CMAKE_PREFIX_PATH}/plugins/sqldrivers/libqsqlite.so
    ${CMAKE_CURRENT_SOURCE_DIR}/../HarmonyOS/entry/libs/arm64-v8a/sqldrivers/libqsqlite.so
  COMMENT "Deploy qsqlite driver plugin to HAP libs/sqldrivers/")
```

### 2. database.cpp 路径改沙箱可写绝对路径（并发必修）

```cpp
#include <QStandardPaths>
#include <QDir>
#include <QSqlError>
// ...
QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
if (dataDir.isEmpty()) dataDir = QDir::currentPath();   // 兜底
QDir().mkpath(dataDir);
db->setDatabaseName(dataDir + QDir::separator() + "ChineseChess.db");
if (!db->open()) {
    qWarning() << "[DB] open failed:" << db->lastError().text() << "path:" << db->databaseName();
    QMessageBox::information(nullptr, "错误",
        QString("无法创建本地数据库 !\n路径: %1\n错误: %2").arg(db->databaseName(), db->lastError().text()));
    exit(-1);  // 可选改 QCoreApplication::exit(-1) 避免 SIGABRT cppcrash
}
```

`AppLocalDataLocation` 在 OHOS 映射 `preferencesDir`（`/data/storage/el2/` 下可写沙箱，文件 IO 允许，仅 `.so` dlopen 被拒——故放 `.db` 安全）。桌面端返回 `~/.local/share/<Org>/<App>`，统一使用无需 `#ifdef`。

### 3.（可选）main.cpp 补应用名/组织名

```cpp
QCoreApplication::setOrganizationName("MyOrg");
QCoreApplication::setApplicationName("MyApp");
```
桌面端使路径含合理 `<App>` 段；OHOS 端由 bundleName 决定不受影响。

## 验证

```bash
# 1. 驱动进 bundle（只读 el1）
hdc shell find /data/storage/el1/bundle -name 'libqsqlite*'
# 2. 启动应用，不再弹"无法创建本地数据库"、Login 正常显示
# 3. db 文件生成在可写沙箱
hdc shell find /data/storage/el2 -name 'ChineseChess.db'
# 4. qWarning 诊断（默认走 stderr 不入 hilog，需重定向）
hdc shell hilog | grep -iE 'QSqlDatabase|QSQLITE|driver|open'
# 5. 无新 cppcrash
hdc shell faultloggerd
```

修复后 faultlog 不再出现 `cppcrash-com.example.chessgame`（`exit(-1)` 分支不再触发）。本次修复已真机验证通过。

## 注意事项

- **库链接 ≠ 驱动部署**：`target_link_libraries(Qt5::Sql)` 只部署 `libQt5Sql.so`，驱动 `libqsqlite.so` 是独立运行时 dlopen 插件，须手拷到 `sqldrivers/`（与 `libqohosstyle.so`→`styles/`、`libqsvg.so`→`imageformats/` 同范式）。
- **两种 open() 失败不可区分**：原代码 `open()` 失败只弹固定文案，不输出 `lastError()`，导致"驱动未加载"与"路径不可写"表现同框。修复时务必把 `lastError().text()` 带进弹框/qWarning——"Driver not loaded"=驱动问题，"unable to open database file"=路径问题。
- **dlopen 限制边界**：`dlopen()` 拒绝 el2 可写路径（平台限制 P3）**仅针对 .so 加载**，不影响数据库文件本身写入 el2 沙箱。驱动 .so 必须放 `entry/libs/`（安装后映射 el1 只读，dlopen 允许）。
- **文件名差异**：OHOS SDK 是 `libqsqlite.so`，桌面是 `libqsqlsqlite.so`。从 SDK 拷贝时按实际文件名。
- **静态内建排除**：本 SDK 的 `libQt5Sql.so` strings 扫描 `qsqlite` 匹配数=0，驱动未静态内建（若静态内建则无需部署插件，但 OHOS SDK 不是）。
- **构建缓存陷阱**：部署驱动 + 改源码后，若 hvigor 增量构建 no-op（产物 mtime 不变、`.cxx`/`build` 不重建），需清 `.hvigor` + `.cxx` + `build` 并带 env（`DEVECO_SDK_HOME`+`JAVA_HOME`）全量 sync 重建，见 [build-hvigor-native-skip](build-hvigor-native-skip.md)。

## 相关

- [[qt-harmonyos-golden-rules]] — 规则 B7（style 手拷）/B12（SQL 驱动手拷）/L2（argv 是库路径）
- [[qt-harmonyos-project-structure]] — §6.2 手动复制表格（含 libqsqlite.so）
- [[qt-harmonyos-platform-limits]] — §dlopen 拒绝可写路径（仅 .so）/§QStandardPaths 约束
- [[qt-harmonyos-code-patterns]] — 模式 14（数据库文件沙箱可写路径）

### 相关问题

- [runtime-fail-qpa-plugin-not-found](runtime-fail-qpa-plugin-not-found.md) — 同类"插件未部署"范式（QPA libqohos.so）
- [runtime-fail-dlopen-writable-path](runtime-fail-dlopen-writable-path.md) — dlopen 限制边界（.so 不能放 el2，但 .db 可以）
- [build-hvigor-native-skip](build-hvigor-native-skip.md) — 修复后重建若 no-op 的缓存清理

> 📋 返回 [错误速查表](_lookup.md)

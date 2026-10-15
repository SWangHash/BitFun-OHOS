---
id: fault-C-0013
cid: C-0013
type: cause
title: OHOS 沙箱 bundle 安装路径只读，桌面式 currentPath/applicationDirPath 写文件失败（应用 exit(1) → SIGABRT）
nature: limitation
domain: filesystem
fault_type: crash
responsible: ohos-runtime
co_responsible: []
component: "HarmonyOS 应用沙箱文件系统规格（bundle 只读） × QDir::currentPath / QCoreApplication::applicationDirPath"
severity: critical
evidence_type: logs
status: wontfix
evidence: "应用沙箱规格：bundle 安装目录只读，可写区在 /data/storage/el2/base/...（QStandardPaths 映射）；ohos-common-kb runtime-write-to-readonly-bundle-path 诊断页（跨框架成立）；源页崩溃栈（SIGABRT ← exit(1) ← createNewConfig 写只读路径失败）实证"
evolution: "—（规格稳定：bundle 只读属沙箱安全模型，可写区语义未变）"
fix_route: ""
review_note: "bundle 只读规格有无变化；应用其余写入点（plog/QSettings/临时文件）是否已全面迁移可写区"
depends_on: []
affects_qt: ["Qt 5.15.16（源页实证；规格本身与 Qt 版本无关）"]
affects_ohos: ["HarmonyOS 6.0（源页实证；bundle 只读为全版本沙箱规格）"]
qoh: []
first_seen: 2026-07-09
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [harmonyos, sandbox, readonly, bundle, qstandardpaths, qdir, sigabrt, exit, config, limitation, workaround]
audience: public
refs: [problem-runtime-crash-sandbox-readonly-path, semantic-qt-harmonyos-platform-limits]
summary: >
  OHOS 沙箱中 QDir::currentPath()/applicationDirPath() 返回只读 bundle 路径，应用
  在该路径写配置/日志失败后 exit(1) → SIGABRT 延迟崩溃。limitation/ohos-runtime
  （沙箱规格，wontfix）；替代方案 W-0011（路径获取加 Q_OS_OHOS 分支，改用
  QStandardPaths::AppDataLocation）已真机验证并合入 FRequest（commit 8a8ba95）。
---

# C-0013 OHOS 沙箱 bundle 安装路径只读，写配置/日志触发 exit(1) 崩溃

> nature: limitation ｜ 责任: ohos-runtime ｜ 状态: wontfix ｜ 表现: S-0012 ｜ 方案: W-0011 ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0012 应用启动数秒后 SIGABRT 崩溃（exit(1)，栈指向配置文件写入失败）

错误原文（源页 [runtime-crash-sandbox-readonly-path](../problems/runtime-crash-sandbox-readonly-path.md)）：

```
Signal:SIGABRT(SI_TKILL)@0x... from exit(1)
LastFatalMessage:[appspawn_server.c:69]Unexpected call: exit(1)
Tid:QtMainThread
#00 raise+216
#01 abort+24
#02 exit+144
#03 ConfigFileFRequest::createNewConfig()+1884
#04 ConfigFileFRequest::ConfigFileFRequest(QString const&)+84
#05 MainWindow::MainWindow(QWidget*)+376
#06 main+180
```

构建/安装/启动均成功，运行数秒后崩溃；SIGABRT（非 SIGSEGV）由应用代码主动
`exit(1)` 触发。任何在 OHOS 上用桌面式路径写文件的 Qt 应用都可能受影响
（不限 FRequest）。

## 根因 / 定性依据

崩溃链（源页）：

```
getAppPath() → QDir::currentPath() → 只读 bundle 路径
  → ConfigFileFRequest(configPath) → 配置文件不存在 → createNewConfig()
    → doc.save_file(configPath) → 写入失败（只读）
      → exit(1) → SIGABRT
```

HarmonyOS 应用沙箱规格：**bundle 安装路径只读**——`QDir::currentPath()` 与
`QCoreApplication::applicationDirPath()` 在 OHOS 沙箱中指向只读区；可写区为
`/data/storage/el2/base/...`（经 `QStandardPaths` 映射）。属**规格限制**而非
缺陷——路径语义由沙箱安全模型决定，不存在"放开 bundle 写"的修复路径，只有
改用可写区。通用诊断以 ohos-common-kb `runtime-write-to-readonly-bundle-path`
为准（跨框架成立）。

## 责任判定

`ohos-runtime`（沙箱文件系统规格）。应用侧以桌面习惯把可执行目录当可写目录
（写配置/日志）——按平台规格属**应用必须适配**（处置：鸿蒙必须适配），非 Qt
框架问题（QDir 如实返回平台路径）。

与 C-0008 的区分：C-0008 是"文件权限与链接属打包契约、运行时禁 chmod/symlink"；
本条是"bundle 安装路径只读、写入失败"——**同为应用沙箱文件系统规格体系的两条
不同规则**，根因不同，各自独立建档（互链见 §关联）。

## 替代方案与演进（limitation）

- **W-0011（adopted）**：路径获取函数加 `Q_OS_OHOS` 分支，返回
  `QStandardPaths::writableLocation(AppDataLocation)` 等可写路径（见 §临时方案）。
- **演进**：无（规格稳定）。观察点：沙箱可写区语义与 QStandardPaths 映射的扩展
  （如资源目录映射 QTBUG-146626）。

## 临时方案（Workarounds）

- **W-0011（adopted，已验证 2026-07-09 真机）**：

```cpp
#include <QStandardPaths>

QString getAppPath(){
#ifdef Q_OS_MAC
    // ... macOS 逻辑 ...
#elif defined(Q_OS_OHOS)
    // OHOS sandbox: app binary dir is read-only, use writable app data dir
    QString dataPath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dataPath);
    return dataPath;
#else
    return QDir::currentPath();
#endif
}
```

  OHOS 可写路径（源页记录）：
  - `AppDataLocation` → `/data/storage/el2/base/haps/entry/files/`
  - `CacheLocation` → `/data/storage/el2/base/haps/entry/cache/`
  - `TempLocation` → `/data/storage/el2/base/haps/entry/temp/`

  要点：① 确保已 include `<QStandardPaths>`；② `mkpath()` 保证目录存在（首次
  运行可能不存在）；③ 同步排查其余写入点（plog 日志 appender、QSettings、
  临时文件等同样使用 getAppPath() 的路径）。

  代价：所有文件写入点需排查改造；跨平台分支维护。
  退役条件：无退役预期（wontfix：bundle 只读规格稳定）；若未来平台放开应用
  目录写语义，可回归 QDir 原生路径。

## 跟踪单（Tickets）

暂无（沙箱路径规格已有 Qt 官方平台限制页与 ohos-common-kb 通用诊断覆盖，
暂无需另立 Qt 侧行为记录单）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-07-09 | Qt 5.15.16 / HarmonyOS 6.0 / HUAWEI MateBook 14 | 崩溃栈定位（源页错误信息）+ 修复：getAppPath() 加 Q_OS_OHOS 分支返回 AppDataLocation（FRequest commit 8a8ba95） | 真机验证崩溃消失（源页 evidence：真机验证截图） | → workaround |
| 2026-07-09 | — | 定性：bundle 安装路径只读为沙箱规格（源页"OHOS 沙箱限制"结论 + ohos-common-kb 通用诊断页） | 定性成立，无修复路径，长期依赖路径适配 | → wontfix |

## 关联

- 症状（S）：S-0012
- 临时方案（W）：W-0011
- 跟踪单（T）：暂无
- problems：[runtime-crash-sandbox-readonly-path](../problems/runtime-crash-sandbox-readonly-path.md)（错误检索、修复代码、可写路径清单、成果记录）
- semantic：[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)（QStandardPaths 约束与标准路径映射）
- 相关根因（C，含 depends_on 说明）：C-0008（互链——同属应用沙箱文件系统规格体系的兄弟规则：C-0008 禁运行时 chmod/symlink（权限/链接属打包契约），本条禁写 bundle 只读区；并列规则，无 depends_on 依赖）

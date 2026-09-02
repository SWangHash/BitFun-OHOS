---
id: problem-runtime-crash-sandbox-readonly-path
type: problem
domain: runtime
tags: [ohos, sandbox, file-write, sigabrt, exit, qstandardpaths, getapppath]
created: 2026-07-09
updated: 2026-08-14
status: solved
severity: critical
audience: public
refs: [procedural-qt-ohos-run-test, semantic-qt-harmonyos-platform-limits]
summary: >
  OHOS 沙箱环境下 QDir::currentPath()/applicationDirPath() 返回只读路径，
  应用写配置文件/日志时失败并调用 exit(1) 导致 SIGABRT 崩溃。
  修复：使用 QStandardPaths::writableLocation(AppDataLocation) 获取可写路径。
leader_summary: >
  解决 OHOS 沙箱只读路径导致的配置文件写入崩溃，形成通用路径修复模式。
impact: [迁移提效]
deliverables: [problem记录, 源码修复]
evidence: [FRequest commit 8a8ba95, 崩溃日志, 真机验证截图]

error_message: >
  Signal:SIGABRT(SI_TKILL) from exit(1)
  #03 ConfigFileFRequest::createNewConfig()+1884
  #04 ConfigFileFRequest::ConfigFileFRequest(QString const&)+84
  #05 MainWindow::MainWindow(QWidget*)+376
  doc.save_file() fails on read-only path → exit(1) → SIGABRT
error_code: ""
keywords: [SIGABRT, exit, sandbox, read-only, writable, QStandardPaths, AppDataLocation, QDir, currentPath, config file, OHOS]
symptoms: "应用启动后延迟崩溃（SIGABRT），崩溃栈显示配置文件写入失败后调用 exit(1)"
environment: "Qt 5.15.16 OHOS / HarmonyOS 6.0 / HUAWEI MateBook 14"
---

# OHOS 沙箱只读路径导致配置文件写入崩溃

> 平台级“写入只读 bundle 路径”诊断以 common 的 [[ohos-common-kb/problems/runtime-write-to-readonly-bundle-path|运行时写入失败：目标位于只读 bundle 路径]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/problems/runtime-write-to-readonly-bundle-path.md)）为准。本页保留 Qt/FRequest 的原始错误检索、`QDir`/`QStandardPaths` 根因与修复。

## 错误信息

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

## 场景

Qt 鸿蒙化应用构建成功、安装成功、启动成功，但运行数秒后崩溃。崩溃类型为 SIGABRT（非 SIGSEGV），由应用代码主动调用 `exit(1)` 触发。

## 原因

**OHOS 沙箱限制**：`QDir::currentPath()` 和 `QCoreApplication::applicationDirPath()` 在 OHOS 沙箱中返回的路径是只读的。应用尝试在该路径下写入配置文件或日志文件时失败。

**崩溃链**：
```
getAppPath() → QDir::currentPath() → 只读路径
  → ConfigFileFRequest(configPath) → 配置文件不存在 → createNewConfig()
    → doc.save_file(configPath) → 写入失败（只读）
      → exit(1) → SIGABRT
```

**同类问题**：plog 日志 appender 也使用 `getAppPath()` 写日志文件，同样会失败。

## 解决方案

在路径获取函数中添加 `Q_OS_OHOS` 分支，返回沙箱可写路径：

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

**OHOS 可写路径**：
- `QStandardPaths::AppDataLocation` → `/data/storage/el2/base/haps/entry/files/`
- `QStandardPaths::CacheLocation` → `/data/storage/el2/base/haps/entry/cache/`
- `QStandardPaths::TempLocation` → `/data/storage/el2/base/haps/entry/temp/`

## 注意事项

- 这是 OHOS 沙箱的通用问题，不限于 FRequest。任何使用 `QDir::currentPath()` 或 `applicationDirPath()` 写文件的 Qt 应用都可能受影响
- 修复时需确保 `QStandardPaths` 头文件已 include
- `mkpath()` 确保目录存在（首次运行时目录可能不存在）
- 同时检查 plog 日志路径、QSettings 路径等其他文件写入点

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 解决 OHOS 沙箱只读路径导致的配置文件写入崩溃，形成通用路径修复模式 |
| 影响面 | 所有在 OHOS 上写文件的 Qt 应用 |
| 交付物 | problem 记录 + FRequest 源码修复 |
| 证据 | FRequest commit 8a8ba95, 崩溃日志, 真机验证截图 |
| 可复用方式 | 遇到 SIGABRT + exit(1) + 文件写入失败栈帧时直接复用 |

## 相关

- [[qt-harmonyos-platform-limits]] — OHOS 平台限制（沙箱文件系统）
- [[procedural-qt-ohos-run-test]] — 运行测试工作流

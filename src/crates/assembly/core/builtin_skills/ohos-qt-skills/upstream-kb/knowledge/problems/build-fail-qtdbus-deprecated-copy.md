---
id: build-fail-qtdbus-deprecated-copy
type: problem
domain: build
status: solved
audience: public
created: 2026-09-19
updated: 2026-09-19
severity: high
tags: [build, dbus, clang, werror, ohos]
refs: [knowledge/errors/QOH039.yaml, knowledge/errors/QOH002.yaml, problems/runtime-fail-libqtdbus-missing.md]
error_message: "qdbusreply.h:105:24: error: definition of implicit copy constructor for 'QDBusReply<T>' is deprecated ... [-Werror,-Wdeprecated-copy-with-user-provided-copy]"
error_code: N/A
summary: >
  Qt 5.12 的 QtDBus 模块在 OHOS clang 15.0.4 下因 -Wdeprecated-copy 类警告 + mkspec
  默认 -Werror 编不过。且鸿蒙运行时根本没有 DBus（QOH002），官方预构建配置即 -no-dbus。
  CLI configure 已内置 -no-dbus。
---

# QtDBus 模块 -Wdeprecated-copy 编译失败（应禁用 dbus）

## 症状

qtbase 编译到 QtDBus 模块报大量同类错误后中断：

```
qtbase/include/QtDBus/../../src/dbus/qdbusreply.h:105:24: error: definition of
implicit copy constructor for 'QDBusReply<QString>' is deprecated because it
has a user-provided copy assignment operator [-Werror,-Wdeprecated-copy-with-user-provided-copy]
```

## 原因

1. Qt 5.12 的 `qdbusreply.h` 是 2012 年前的代码风格：有用户提供的拷贝赋值却没有
   拷贝构造——新版 clang（15.x）对此打 `-Wdeprecated-copy-with-user-provided-copy` 警告
2. `ohos-clang` mkspec 默认带 `-Werror`，警告即错误
3. **根本层面**：HarmonyOS 运行时没有 DBus，`libQt5DBus.so` 装上也没用（QOH002）。
   官方 v5.12.12 预构建的 configure 参数明确含 `-no-dbus`（Windows/macOS 构建均是）

## 解决方案

**现在**：CLI 的 configure 已内置 `-no-dbus`（v2026-09-19 起，与官方预构建配置
和 `semantic/qt-harmonyos-build.md` 的 configure 命令对齐）。

**手动等价操作**（自拼 configure 时）：

```bash
../configure ... -no-dbus ...
```

**注意**：从带 dbus 的旧配置切换到 `-no-dbus` 时必须清空构建目录，否则会踩
[build-fail-stale-build-state](build-fail-stale-build-state.md)（ibus 插件残留构建）。

## 验证

config.summary 中应出现：

```
Qt D-Bus ............................... no
```

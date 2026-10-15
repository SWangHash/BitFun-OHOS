---
id: build-fail-stale-build-state
type: problem
domain: build
status: solved
audience: public
created: 2026-09-19
updated: 2026-09-19
severity: medium
tags: [build, incremental, qmake, dbus, pitfall]
refs: [knowledge/errors/QOH040.yaml, problems/build-fail-qtdbus-deprecated-copy.md]
error_message: "qibusplatforminputcontext.h:61:44: error: unknown type name 'QDBusPendingCall'"
error_code: N/A
summary: >
  复用旧构建目录改配置（如切 -no-dbus / 换 OHOS SDK）时，mkspecs/modules/ 下的旧
  模块 pri 文件（qt_lib_dbus.pri）残留，qtHaveModule(dbus) 仍为 true，ibus 插件照常
  构建并报 QDBus 类型缺失。CLI 已内置 configure 指纹防护自动清目录。
---

# 改配置/换 SDK 后复用构建目录，旧模块 pri 残留导致构建失败

## 症状

把 configure 从「带 dbus」改为 `-no-dbus`（或更换了 OHOS SDK）后重新 configure +
build，config.summary 明明显示 `Qt D-Bus ... no`，但 ibus 输入法插件仍然被构建：

```
qtbase/src/plugins/platforminputcontexts/ibus/qibusplatforminputcontext.h:61:44:
error: unknown type name 'QDBusPendingCall'
qtbase/src/plugins/platforminputcontexts/ibus/qibustypes.h:58:22:
error: unknown type name 'QDBusArgument'
```

## 原因

qmake 的 `qtHaveModule(dbus)` 通过查找**构建树里已生成的模块 pri 文件**判断模块
是否存在（`build-*/qtbase/mkspecs/modules/qt_lib_dbus.pri`）。重新 configure 不会
删除旧 pri——上次带 dbus 的 configure 留下的 `qt_lib_dbus.pri` 仍然在，于是：

```
platforminputcontexts.pro: qtHaveModule(dbus) → true → SUBDIRS += ibus
```

ibus 插件无条件 `QT += dbus`，但 QtDBus 已不在 → 报 QDBus 类型缺失。

同理，**更换 OHOS SDK**（如 API 15 → API 23）而不清构建目录，也会留下带旧
sysroot 路径的缓存状态，产生各种不可预期的错配。

这是知识库「增量编译三坑」之外的第四坑：**跨配置切换必须清构建目录**。

## 解决方案

**现在**：CLI 已内置防护（v2026-09-19 起）——configure 会计算指纹（configure 参数 +
OHOS SDK 路径与 oh-uni-package.json 版本），与该变体槽上次记录不一致时自动清空
构建目录并打印 `wiped stale build dir ... see QOH040`；无记录的半配置目录同样清空。

**手动等价操作**：

```bash
rm -rf workspace/qt-sdk/build/build-Qt5.12.12-arm64-v8a-gles
python3 tools/qt-sdk-run.py configure --qt 5.12 --render gles --build-type release
python3 tools/qt-sdk-run.py build
```

## 验证

重新 configure 后确认旧 pri 已不存在：

```bash
ls workspace/qt-sdk/build/build-*/qtbase/mkspecs/modules/ | grep -c dbus   # → 0
```

---
id: problem-ohos-qfiledialog-native-support
type: problem
domain: caveat
tags: [qfiledialog, file-dialog, save, load, download, qohosplatformplugin, native-support, qt515, frequest]
created: 2026-07-29
updated: 2026-08-03
status: solved
severity: low
audience: public
refs: [semantic-qt-harmonyos-api-mapping]
summary: "反模式：QFileDialog OHOS 原生可用，误加 #ifdef 是常见反模式"
error_message: >
  开发者误以为 QFileDialog 在 OHOS 需 \#ifdef Q_OS_OHOS 替代方案（QInputDialog/硬编码路径），
  添加不必要守卫代码导致维护负担与原生支持冲突；实际 QOhosPlatformIntegrationPlugin 已内置原生支持，
  标准 QFileDialog API 可直接使用。
---

# QFileDialog 在 OHOS 上原生可用

## 问题描述

迁移 Qt 应用到 OHOS 时，开发者容易**误以为** OHOS 不支持 `QFileDialog`，从而为 Save/Load/Download 功能添加 `#ifdef Q_OS_OHOS` 替代方案（如 `QInputDialog` 或硬编码路径）。

实际上 Qt for OHOS 的平台插件 `QOhosPlatformIntegrationPlugin`（`libqohos.so`）已经内置了文件对话框的支持。

## 验证方法

参考 ModbusDebuger 验证项目，其 Save 功能直接使用标准 API：

```cpp
void MainWindow::on_pushButton_save_clicked()
{
    QString filePath = QFileDialog::getSaveFileName(this, tr("Save Data"), "",
                                                    tr("Data Files (*.txt)"));
    if (filePath.isNull()) return;
    QFile file(filePath);
    if (!file.open(QIODevice::WriteOnly|QIODevice::Text)) { ... }
    file.write(data.toLatin1());
}
```

- 无 `#ifdef Q_OS_OHOS` 分支
- 无 ArkTS 桥接
- 无 NAPI 层
- module.json5 中的 `FILE_ACCESS_PERSIST` 权限由 Qt 模板预置

## 根因

`QOhosPlatformIntegrationPlugin` 在内部通过 `OhosExportModules.ts` 中注册的 `@kit.FileManagerServiceKit.fileManagerService` 调用 OHOS 原生文件管理器 API，对上层 Qt Widgets 代码完全透明。

## 解决方案

**不需要任何特殊处理。** 直接使用标准 Qt API：

```cpp
// Save
QString filePath = QFileDialog::getSaveFileName(this, tr("Save File"),
                                                 defaultPath,
                                                 tr("Project files (*.frp)"));

// Load
QString filePath = QFileDialog::getOpenFileName(this, tr("Load File"),
                                                 defaultPath,
                                                 tr("Project files (*.frp)"));
```

## 常见错误路径

| 错误做法 | 正确做法 |
|----------|----------|
| `#ifdef Q_OS_OHOS` + QInputDialog 输入文件名 | 直接用 QFileDialog |
| `#ifdef Q_OS_OHOS` + 硬编码到 getAppPath() | 直接用 QFileDialog |
| `#ifdef Q_OS_OHOS` + QStandardPaths::DocumentsLocation | 直接用 QFileDialog（DocumentsLocation 在 OHOS 上不存在） |

## 注意事项

- 文件保存路径由 Qt 平台插件决定，通常指向应用沙箱 `files` 目录
- 保存的文件在系统文件管理器中**不可见**（沙箱限制），如需可见需 ArkTS + NAPI 桥接 filePicker API
- `file://` URL scheme 不支持 `QDesktopServices::openUrl()`，但 QFileDialog 本身正常工作

## 受影响项目

- FRequest (`com.ohosqt.FRequest`) — 已修复，移除了所有不必要的 QFileDialog OHOS 守卫

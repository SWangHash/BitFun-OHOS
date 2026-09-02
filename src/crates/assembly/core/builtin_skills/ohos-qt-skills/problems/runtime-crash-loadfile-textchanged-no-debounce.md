---
id: problem-runtime-crash-loadfile-textchanged-no-debounce
type: problem
domain: runtime
tags: [runtime, crash, textChanged, debounce, getFileTimeRange, loadfile, SIGSEGV]
created: 2026-08-10
updated: 2026-08-10
status: solved
severity: high
audience: public
refs: []
summary: >
  QtSerialMonitor 在 Load File 路径输入框每输入一个字符即触发 getFileTimeRange（open+readAll+split 重操作），
  导致 SIGSEGV 闪退。修复：QTimer 防抖 500ms + 空列表检查。
leader_summary: >
  沉淀 QLineEdit textChanged 信号触发重操作的防抖模式，避免应用层每字符触发文件解析导致崩溃。
impact: [迁移提效, 应用完善]
deliverables: [problem记录, patch]
evidence: [QtSerialMonitor 真机测试 TC-08, src/mainwindow.cpp 修复]

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  SIGSEGV crash when typing in Load File path input field; on_lineEditLoadFilePath_textChanged triggers getFileTimeRange on every keystroke
error_code: ""
keywords: [textChanged, debounce, getFileTimeRange, loadfile, crash, SIGSEGV, QLineEdit]
symptoms: "用户在 Load File 路径输入框输入路径时应用闪退（还没点 Load 按钮）"

# ====== 问题详情 ======
environment: "Qt 5.15.16 OHOS (Qt5.15.16-arm64-v8a-full SDK), HUAWEI MateBook Pro (2in1), API 24"
---

# Load File 路径输入时 SIGSEGV 闪退（textChanged 无防抖）

## 错误信息

应用闪退，无明确错误日志（SIGSEGV 在 getFileTimeRange 内部）。

## 场景

QtSerialMonitor 真机测试 TC-08：用户在窗口底部 "Load File" 路径输入框（`lineEditLoadFilePath`）输入文件路径时，**还没点 Load 按钮**，应用即闪退。

## 原因

`MainWindow::on_lineEditLoadFilePath_textChanged(const QString &arg1)` 在用户**每输入一个字符**时触发，调用 `fileReader.getFileTimeRange(&file)`。该函数执行：
1. `file.open(QIODevice::ReadOnly)` — 打开文件
2. `file.readAll()` — 读取全部内容到内存
3. `allData.split(QRegExp("[\\n+\\r+]"), Qt::SplitBehaviorFlags::SkipEmptyParts)` — 正则 split

每字符触发一次重操作（open+readAll+split），导致：
- 资源竞争（频繁 open/close 同一文件）
- 可能触发 Qt 内部信号/槽重入崩溃
- `Qt::SplitBehaviorFlags::SkipEmptyParts` 在 Qt 5.15 OHOS 运行时可能符号解析不稳定

## 解决方案

在 `on_lineEditLoadFilePath_textChanged` 中加 QTimer 防抖（延迟 500ms 触发），并加空列表检查：

```cpp
void MainWindow::on_lineEditLoadFilePath_textChanged(const QString &arg1)
{
    // 防抖：延迟 500ms 触发，避免每字符触发一次 getFileTimeRange（open+readAll+split 重操作）
    QTimer::singleShot(500, this, [this, arg1]() {
        if (ui->lineEditLoadFilePath->text() != arg1)
            return; // 路径已变，忽略旧触发
        
        QFile file(arg1);
        if (!file.exists())
        {
            ui->lineEditFileInfo->setText("File doesnt exist !");
            return;
        }
        
        QList<QTime> timeRange = fileReader.getFileTimeRange(&file);
        if (timeRange.count() >= 2)
        {
            ui->timeEditMinParsingTime->setTime(timeRange.first());
            ui->timeEditMaxParsingTime->setTime(timeRange.last());
        }
        
        QString info = "Size: " + QString::number(file.size());
        ui->lineEditFileInfo->setText(info);
    });
}
```

**关键修改点**：
1. `QTimer::singleShot(500, ...)` — 防抖 500ms
2. `if (ui->lineEditLoadFilePath->text() != arg1) return;` — 路径已变则忽略旧触发
3. `if (timeRange.count() >= 2)` — 空列表保护

## 注意事项

- 防抖延迟 500ms 是经验值，可根据文件解析耗时调整
- `getFileTimeRange` 本身也有优化空间（可改为只读首尾几行而非 readAll）
- 此模式适用于所有 QLineEdit textChanged 触发重操作的场景

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 QLineEdit textChanged 防抖模式，避免应用层每字符触发文件解析导致崩溃 |
| 影响面 | QtSerialMonitor 真机测试 TC-08；其他有类似 textChanged 触发重操作的 Qt OHOS 应用 |
| 交付物 | problem 记录 + src/mainwindow.cpp patch |
| 证据 | QtSerialMonitor 真机测试 TC-08 修复验证通过 |
| 可复用方式 | 以后遇到 "QLineEdit textChanged 触发重操作导致崩溃" 时直接复用防抖模式 |

## 相关

- [[qt-app-harmonyos-completion]] — 应用鸿蒙化完善工作流（TC-08 属于此工作流）
- [[qt-harmonyos-golden-rules]] — 铁律速查

---

> **模板说明**：此模板用于记录实际执行中遇到的报错。
> Qt 平台已知限制（如 chmod 不支持）请记录在 `semantic/qt-harmonyos-platform-limits.md`，不使用此模板。

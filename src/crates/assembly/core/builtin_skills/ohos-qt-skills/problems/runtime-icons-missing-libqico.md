---
id: problem-runtime-icons-missing-libqico
type: problem
domain: runtime
tags: [runtime, icons, qico, libqico, imageformat, QIcon, toolbar, menu, ico, imageformats, plugin-deploy]
created: 2026-07-29
updated: 2026-07-29
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-project-structure, problem-runtime-sqlite-open-database]
summary: >
  Qt 鸿蒙应用工具栏/菜单/托盘图标不显示（QIcon 位置空白）：图标资源是 .ico，需 qico imageformat 插件
  (libqico.so) 才能读，但 HAP 未部署 imageformats/ 子目录 → QFactoryLoader 找不到 → QImageReader 读不了
  .ico → QIcon 空。修复：从 <SDK>/plugins/imageformats/ 复制 libqico.so 到 entry/libs/<abi>/imageformats/。
leader_summary: >
  沉淀 .ico 图标不显示根因（缺 libqico.so imageformat 插件，非 QtGui 内置），同 B7/B12 子目录插件部署族。
impact: [迁移提效, 框架支撑]
deliverables: [problem 记录, RedisView HAP 图标修复]
evidence: [HAP 含 imageformats/libqico.so+libqgif.so, hilog makeJsPixelMapFromIcon 48x48 非空, 截图工具栏图标可见]

# ====== 检索关键字 ======
error_message: >
  工具栏/菜单 QAction 图标不显示，setIcon(QIcon(":/Resources/x.ico")) 后图标位置空白
  QIcon(".ico") loads empty / QImageReader cannot read .ico
  hilog: makeJsPixelMapFromIcon original Icon dimensions: 0x0（或无该行）
error_code: ""
keywords: [ico, qico, libqico, imageformat, imageformats, QIcon, toolbar, menubar, 图标不显示, 图标空白, qgif, qsvg, qjpeg, QFactoryLoader]
symptoms: >
  应用启动后工具栏/菜单/托盘图标位置空白不显示；QIcon(:/...x.ico) 加载为空；改用 .png 图标则正常显示。

# ====== 问题详情 ======
environment: "Qt 5.12/5.15 for HarmonyOS，真机/模拟器。图标资源为 .ico 格式（Windows 风格 Qt 应用常见）。"

## 根因

`.ico`（Windows icon）**不是 QtGui 内置支持格式**——Qt 内置仅 BMP/JPG/PNG/GIF/PBM/PGM/PPM/XBM/XPM。`.ico` 由 `qico` imageformat 插件（`qtimageformats` 模块，`libqico.so`）提供，运行时由 `QFactoryLoader` 从应用 lib 目录的 `imageformats/` 子目录按需 dlopen 加载。

OHOS HAP 默认只部署 Qt 核心 .so + QPA `libqohos.so` + `styles/libqohosstyle.so`，**不部署 imageformats/ 子目录**（同 `sqldrivers/libqsqlite.so`、`styles/libqohosstyle.so` 都是分类子目录插件，需手动放，见铁律 B7/B12）。故 `QImageReader` 读 .ico 失败 → `QIcon(":/Resources/run.ico")` 空 → 工具栏/菜单/托盘图标位置空白。

注：`.png` 内置可读，故 qrc 里的 `alipay.png`/`weiPay.png` 正常；`wait.gif` 需 `libqgif.so`，`.svg` 需 `libqsvg.so`，`.jpeg` 需 `libqjpeg.so`。

## 验证方法

1. `unzip -l entry-default-signed.hap | grep -i imageformat` → 若无 `libs/<abi>/imageformats/libqico.so` 即缺。
2. `strings <SDK>/plugins/imageformats/libqico.so` 确认插件存在。
3. 修复后冷启动，`hdc shell hilog -x | grep makeJsPixelMap` 应出现 `original Icon dimensions: 48x48`（非 0x0）= .ico 已加载；截图工具栏图标可见。

## 解决方案

从 Qt OHOS SDK 的 `plugins/imageformats/` 复制所需插件到工程 `entry/libs/<abi>/imageformats/`（hvigor 自动打包 entry/libs/ 子目录到 HAP `libs/<abi>/<subdir>/`）：

```bash
ABI=arm64-v8a
SDK=<Qt OHOS SDK 根>   # 如 ${QT5_15_OHOS_SDK_FULL}
mkdir -p entry/libs/$ABI/imageformats
# 按资源实际用到的格式复制（最小集）：
cp $SDK/plugins/imageformats/libqico.so entry/libs/$ABI/imageformats/   # .ico（必须）
cp $SDK/plugins/imageformats/libqgif.so  entry/libs/$ABI/imageformats/   # .gif（若用 wait.gif 等）
cp $SDK/plugins/imageformats/libqsvg.so  entry/libs/$ABI/imageformats/   # .svg（若有 SVG 图标）
cp $SDK/plugins/imageformats/libqjpeg.so entry/libs/$ABI/imageformats/   # .jpeg/.jpg（若有）
```
重建 HAP（`hvigorw assembleHap`）→ 重装 → 图标显示。

> 部署位置 **必须**是 `imageformats/` 子目录（非 `libs/<abi>/` 根），与 `styles/`、`sqldrivers/` 同规——`QFactoryLoader` 按子目录 dlopen 分类插件。

## 关键判据

- 区分「图标资源未嵌入」vs「.ico 读不了」：qrc 含 .ico + AUTORCC ON = 已嵌入；`QIcon(":/...x.ico").isNull()` 返回 true = 读不了（缺 libqico.so）。改用 `.png` 资源若显示正常，即坐实 .ico 插件缺失。
- 仅 .ico 不显示、.png 正常 → 100% 缺 libqico.so。
- 若 .svg 也不显示 → 同时缺 libqsvg.so（同理）。

## 关联

- [[qt-harmonyos-golden-rules]] — B7（libqohosstyle.so→styles/）、B12（libqsqlite.so→sqldrivers/，同条提到 libqsvg.so→imageformats/）
- [[qt-harmonyos-project-structure]] — §6.2 分类插件子目录部署
- [runtime-fail-sqlite-open-database](runtime-fail-sqlite-open-database.md) — 同族（sqldrivers/ 子目录插件缺失）

> 📋 返回 [错误速查表](_lookup.md)

---
id: build-fail-python-not-found
type: problem
domain: build
status: solved
audience: public
created: 2026-09-19
updated: 2026-09-19
severity: high
tags: [build, linux, qtdeclarative, python, qml]
refs: [skills/qt-sdk-forge/references/build-matrix.md, knowledge/errors/QOH038.yaml]
error_message: "sh: 1: python: not found / Project ERROR: Building QtQml requires Python."
error_code: N/A
summary: >
  qtdeclarative 的 qmake 脚本调用 `python`（非 `python3`），Ubuntu 等 Linux 发行版
  默认只有 python3。qtbase 能编完，到 QtQml 才爆错。CLI 已内置 forge 本地 shim 自动修复。
---

# QtQml 构建报 python: not found（Linux）

## 症状

Linux 上全量编译 Qt：qtbase/qtsvg/qtimageformats 全部编过，进入 qtdeclarative 后失败：

```
Info: creating cache file .../qtdeclarative/.qmake.cache
sh: 1: python: not found
Project ERROR: Building QtQml requires Python.
make: *** [Makefile:159: module-qtdeclarative-make_first] Error 3
```

## 原因

qtdeclarative 的 qmake 构建脚本（`qtdeclarative.pro` 的 `python` 探测）调用的是
**`python`** 而非 `python3`。Ubuntu/Debian 及多数服务器发行版默认不装
`python-is-python3`，`python` 命令不存在。

## 解决方案

**现在**：CLI 已内置自动修复（v2026-09-19 起）——`build_env()` 会在 forge 状态目录
创建 `.qtsdk/pyshim/python`（软链到当前解释器）并前置进 PATH，不污染宿主系统。
SV0 环境检查也新增 `python3` / `python_alias` 两项。

**手动等价操作**（绕过 CLI 直接跑 make 时）：

```bash
# 系统级（简单）
apt install python-is-python3        # 或
ln -s /usr/bin/python3 /usr/local/bin/python
```

续编（增量，无需重来）：

```bash
python3 tools/qt-sdk-run.py build    # 前面已编好的模块会跳过
```

## 验证

```bash
python --version    # 输出 3.x
```

---
id: build-fail-configure-exec-bit-crlf
type: problem
domain: build
status: solved
audience: public
created: 2026-09-19
updated: 2026-09-19
severity: high
tags: [build, linux, macos, src-clone, gitcode, crlf, exec-bit]
refs: [skills/qt-sdk-forge/references/build-matrix.md, knowledge/errors/QOH037.yaml]
error_message: "exec: /path/qt-harmonyos-src/qtbase/configure: Permission denied"
error_code: N/A
summary: >
  GitCode 开源镜像的初始导入提交把全部文件存为 100644（丢执行位）、main/5.12.12
  快照带 Windows CRLF 行尾。POSIX（Linux/macOS）下 sh configure 直接失败
  （Permission denied 或 bad interpreter: /bin/sh^M）。src-clone 已内置自动修复。
---

# 开源镜像源码执行位丢失 / CRLF 行尾导致 configure 失败

## 症状

Linux/macOS 上用 `qt-sdk-run.py src-clone --method opensource` 克隆后 configure：

```
/path/qt-src/qt5.12/configure: 49: exec: /path/qt-src/qt5.12/qtbase/configure: Permission denied
```

或（分支带 CRLF 时）：

```
bad interpreter: /bin/sh^M: no such file or directory
```

## 原因

GitCode 开源镜像 `ohos-qt/qt-harmonyos-src` 的初始导入（`5e9825352`）有两个快照级缺陷：

1. **全部文件 100644**：~620 个带 shebang 的脚本（`configure`、`syncqt.pl`、各 `*.sh`）丢失执行位，git 里存的就是非可执行
2. **main / 5.12.12 快照是 CRLF**：源码包从 Windows 侧导出，POSIX shell 无法执行

镜像实际分支（`git ls-remote --heads` 确认）：

| 分支 | 内容 | 适用 |
|------|------|------|
| `main` / `5.12.12` | 上游快照，CRLF + 丢执行位 | 仅 Windows |
| `build/macos-arm64-qt5.12.12` | **POSIX 构建分支**：LF 行尾 + 构建使能补丁（警告抑制） | **macOS/Linux 源码编译应用此分支** |

注意：CLI 早期版本的 `BRANCHES` 映射（`tqtc/harmonyos-5.12.12`）是商业仓名字，开源镜像不存在该分支，clone 直接报 `Remote branch not found`。

## 解决方案

**现在**：`src-clone --method opensource` 已内置修复（v2026-09-19 起）：

- 默认检出 POSIX 构建分支 `build/macos-arm64-qt5.12.12`（`OPENSOURCE_BRANCHES`，可用 `--branch` 覆盖）
- 克隆后自动扫描 shebang 脚本恢复 +x，并以 git 提交固化（保持工作树干净，SV1 门禁可过）
- CRLF 检查：检出分支若带 CRLF 会直接 FAIL 并提示换分支

**手动等价操作**（旧版 CLI / 已有克隆）：

```bash
git clone --branch build/macos-arm64-qt5.12.12 --single-branch \
  https://gitcode.com/ohos-qt/qt-harmonyos-src.git qt5.12
cd qt5.12
# 恢复执行位并固化为提交
grep -rIl "^#!" --exclude-dir=.git . | tee /tmp/exec-files.txt
xargs -a /tmp/exec-files.txt chmod +x
xargs -a /tmp/exec-files.txt git update-index --chmod=+x
git commit -m "fix: restore executable bits lost in initial import"
```

## 验证

```bash
file qtbase/configure   # → POSIX shell script, ASCII text executable（无 CRLF）
sh qtbase/configure --help
```

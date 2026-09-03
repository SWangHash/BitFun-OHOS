---
id: problem-build-fail-hvigor-spawn-java-enoent
type: problem
domain: build
tags: [build, hvigor, PackageHap, java, ENOENT, windows, PATH, bash, build-bat, JBR]
created: 2026-07-23
updated: 2026-07-23
status: solved
severity: high
audience: public
refs: [procedural-qt-ohos-run-test, procedural-demo-generation]
summary: >
  hvigor 打 HAP 卡在 PackageHap:`Error Code: 00308018 spawn java ENOENT`。根因:bash 里 export 的 PATH 用 Unix 格式
  (`:` 分隔 + `/c/...` 路径),Windows 的 node.exe(hvigorw.js)读 process.env.PATH 期望 Windows 格式(`;` 分隔 +
  `C:\...`),node child_process.spawn('java') 找不到 java.exe(node spawn 不自动补 .exe、不查 PATHEXT);
  仅设 JAVA_HOME 无效(hvigor PackageHap 直接 spawn 'java')。修复:写 Windows 原生 .bat(反斜杠 + `;` 分隔 PATH
  含 DevEco jbr/bin)+ `JAVA_HOME=<DevEco>\jbr`,用 cmd.exe /c 跑。
leader_summary: >
  沉淀 hvigor 打 HAP "spawn java ENOENT" 排障:bash Unix-PATH 与 Windows node 期望格式不匹配,改走 .bat 修复,
  支撑所有 Qt 鸿蒙 demo 的 CLI 构建。
impact: [编译排障, demo 生成, 迁移提效]
deliverables: [problem 记录, ${DEMOS_ROOT}/tray-ohos/build.bat]
evidence: [BUILD SUCCESSFUL in 3s 324ms(entry-default-unsigned.hap 37.7MB), java 报 ENOENT 前 + 修复后对比]

# ====== 检索关键字(Agent 快速匹配用)======
error_message: >
  > hvigor ERROR: Failed :entry:default@PackageHap...
  > hvigor ERROR: Error Code: 00308018 Unknown Error
  spawn java ENOENT
  * Try: Run with --stacktrace / --debug option ...
  > hvigor ERROR: BUILD FAILED
  (C++/ArkTS 全部编译通过,仅最后 PackageHap 失败)
error_code: "00308018"
keywords: [spawn java ENOENT, PackageHap, 00308018, hvigor, java not found, windows PATH, bash PATH, node spawn, java.exe, JBR, DEVECO, build.bat, cmd.exe]
symptoms: >
  Qt5 鸿蒙 demo 用 bash 跑 `node hvigorw.js assembleHap`,CMake/ninja 编 C++ 通过、ArkTS 编译通过,
  但最后 PackageHap 步骤报 `spawn java ENOENT` 失败。`which java` 在 bash 里即使把 DevEco jbr/bin
  加进 PATH 也找不到(或找到但 node spawn 仍 ENOENT)。

# ====== 问题详情 ======
environment: >
  Windows 11 + Git Bash(MSYS)。DevEco Studio `C:\Program Files\Huawei\DevEco Studio`(jbr/bin/java.exe =
  JBR 21.0.8)。Qt5.12 OHOS demo(${DEMOS_ROOT}/tray-ohos)。hvigorw.js 经 `node` 启动。设备 HUAWEI MateBook Fold。
---

## 错误信息

```
> hvigor Finished :entry:default@BuildNativeWithNinja... after 95 ms   ← C++/ninja 编译通过
> hvigor Finished :entry:default@PackageHap... after 116 ms             ← 进到这里失败
> hvigor ERROR: Failed :entry:default@PackageHap...
> hvigor ERROR: Error Code: 00308018 Unknown Error
spawn java ENOENT
> hvigor ERROR: BUILD FAILED in 6 s 205 ms
```

## 场景

在 Git Bash 里用 CLI 打 Qt5 鸿蒙 HAP:
```bash
DEVECO="C:/Program Files/Huawei/DevEco Studio"
export DEVECO_SDK_HOME='C:/Program Files/Huawei/DevEco Studio/sdk'
export JAVA_HOME='C:\Program Files\Huawei\DevEco Studio\jbr'
export PATH="$DEVECO/jbr/bin:$DEVECO/tools/node:$PATH"
node "$DEVECO/tools/hvigor/bin/hvigorw.js" assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```
C++ + ArkTS 全编译通过,卡在 `PackageHap`(打 HAP + 签名步骤,需 java)。

## 原因

三重叠加:

1. **node `child_process.spawn('java', ...)` 在 Windows 不自动补 `.exe`、不查 PATHEXT**(区别于 `exec` 走 shell)。即使 java.exe 在 PATH 里,spawn('java') 仍可能 ENOENT,除非 PATH 被 Windows 进程正确解析。
2. **bash export 的 PATH 是 Unix 格式**(`:` 分隔 + `/c/...` 或 `C:/...` 路径)。MSYS 给 Windows 子进程传 PATH 时会做格式转换,但当 PATH 里已混入 Windows 风格 `C:/...` 条目时,转换可能不完整 → Windows node 读到 `:` 分隔的 PATH 无法按 `;` split → `spawn('java')` 搜不到。
3. **`JAVA_HOME` 无效**:hvigor PackageHap 直接 `spawn('java')`(不读 `JAVA_HOME/bin/java`),故只设 JAVA_HOME 不解决。

> 注:这与 [[build-hvigor-native-skip]](DEVECO_SDK_HOME 缺失致 native 构建被**跳过**)不同——本问题是 native 全编过、仅**打包步骤**因 java 找不到而失败。

## 解决方案

写一个 Windows 原生 `.bat`(PATH 用反斜杠 + `;` 分隔,含 DevEco jbr/bin),用 `cmd.exe /c` 跑,让 Windows node 拿到正确格式的 PATH:

```bat
@echo off
set "JAVA_HOME=C:\Program Files\Huawei\DevEco Studio\jbr"
set "DEVECO_SDK_HOME=C:\Program Files\Huawei\DevEco Studio\sdk"
set "PATH=C:\Program Files\Huawei\DevEco Studio\jbr\bin;C:\Program Files\Huawei\DevEco Studio\tools\node;%PATH%"
cd /d "${DEMOS_ROOT}/<demo-name>"
where java
node "C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.js" assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
```

从 bash 调用:`cmd.exe //c "C:\\path\\to\\build.bat"`(`//c` 是 MSYS 对 `/c` 的转义)。

`where java` 应输出 `C:\Program Files\Huawei\DevEco Studio\jbr\bin\java.exe`。之后 `BUILD SUCCESSFUL`,产物 `entry/build/default/outputs/default/entry-default-unsigned.hap`(无 signingConfig 时为 unsigned,装机需另配签名,见 signhap-bundlename-mismatch)。

## 注意事项

- **CLAUDE.md "Qt OHOS 编译必须在 PowerShell" 警告只针对 `mingw32-make.exe`**(Qt 源码编译,mingw32-make 调 `/usr/bin/sh` 吞反斜杠)。demo 用 hvigor+ninja,**bash 可用**,但 PATH 格式要用 Windows 原生(本 .bat)。
- 仅设 `JAVA_HOME` 不够(hvigor 不读它定位 java);必须把 `jbr\bin` 放进 Windows 格式 PATH。
- 该 .bat 也适合放进 demo 根目录作为可复用构建入口(${DEMOS_ROOT}/tray-ohos/build.bat 即此模式)。
- unsigned HAP 装:`code:9568320 error: no signature file`——需 DevEco GUI 配 signingConfig(Automatically generate signature,用华为账号生成 bundle 绑定 .p7b),或复用已有签名(见 signhap-bundlename-mismatch)。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 hvigor 打 HAP "spawn java ENOENT" 排障(bash Unix-PATH vs Windows node 格式不匹配),改走 .bat 修复 |
| 影响面 | 所有 Qt 鸿蒙 demo 的 CLI 构建、demo 生成、迁移编译 |
| 交付物 | problem 记录、${DEMOS_ROOT}/tray-ohos/build.bat |
| 证据 | BUILD SUCCESSFUL in 3s 324ms / entry-default-unsigned.hap 37.7MB / 修复前后对比 |
| 可复用方式 | 以后任何 Qt 鸿蒙 demo 在 bash 里 hvigor 打 HAP 报 spawn java ENOENT,直接套 .bat |

## 相关

- 见 procedural/qt-ohos-concrete-build-recipe.md（内部页）— 5.12 cmake+hvigor 命令(本 problem 补 Windows PATH 细节)
- [[procedural-qt-ohos-run-test]] — 构建→装机→运行 CLI 流
- [[build-hvigor-native-skip]] — 区分:DEVECO_SDK_HOME 缺失致 native 构建**跳过**(本问题是 native 全过、仅 PackageHap java 失败)
- signhap-bundlename-mismatch — unsigned HAP 装机签名需求
- [[build-fail-bash-path-escape]] — 相关:Git Bash 路径转义问题(PROGRA~1)

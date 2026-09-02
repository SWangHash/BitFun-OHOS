---
id: problem-build-hvigor-native-skip
type: problem
domain: build
tags: [hvigor, cmake, native-build, deveco-sdk-home, java, environment]
created: 2026-06-08
updated: 2026-08-14
status: solved
audience: public
severity: high
error_message: "spawn java ENOENT; BuildNativeWithCmake finished after 1ms with no .so artifact (DEVECO_SDK_HOME missing)"
refs: [semantic-qt-harmonyos-build-run-workflow]
summary: >
  hvigor 构建原生代码不执行（BuildNativeWithCmake 1ms）：DEVECO_SDK_HOME 未设置导致
  CMake 工具链找不到；PackageHap 失败 spawn java ENOENT：Java 不在 PATH 中。
---

# hvigor 原生构建不执行 + HAP 打包 Java 缺失

## 错误信息

### 症状 1：原生构建被跳过
```
> hvigor Finished :entry:default@BuildNativeWithCmake... after 1 ms
> hvigor Finished :entry:default@BuildNativeWithNinja... after 1 ms
```
构建显示 BUILD SUCCESSFUL 但无 .so 产物。

### 症状 2：HAP 打包失败
```
ERROR: Failed :entry:default@PackageHap...
ERROR: spawn java ENOENT
```

### 症状 3：Java 复制后崩溃
```
Command failed with exit code 3221225781: java -Dfile.encoding=GBK -jar ...
```
（0xC0000135 = STATUS_DLL_NOT_FOUND，java.exe 缺少 jvm.dll 等依赖）

## 触发场景

- 从命令行（bash/terminal）运行 hvigor 构建，未设置 `DEVECO_SDK_HOME`
- DevEco MCP 工具构建时原生步骤不执行（MCP 未传递 SDK 环境变量）

## 根因

1. **DEVECO_SDK_HOME 缺失**：hvigor 需要此环境变量定位 OHOS SDK 工具链。缺失时 `BuildNativeWithCmake` 静默跳过（1ms），不报错。
2. **Java 不在 PATH**：`PackageHap` 步骤调用 `java` 命令执行 `app_packing_tool.jar`。DevEco Studio IDE 内置 JBR，但命令行环境需手动配置。
3. **不能只复制 java.exe**：JBR 的 java.exe 依赖同目录下的 jvm.dll 等 DLL，必须将整个 `jbr/bin` 目录加入 PATH。

## 解决方案

### 命令行构建所需环境变量

```bash
# 必须设置
export DEVECO_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk"

# Java 必须通过 PATH 访问（不能只复制 java.exe）
export PATH="/c/Program Files/Huawei/DevEco Studio/jbr/bin:$PATH"
```

### 完整构建命令

```bash
export DEVECO_SDK_HOME="C:/Program Files/Huawei/DevEco Studio/sdk"
export PATH="/c/Program Files/Huawei/DevEco Studio/jbr/bin:$PATH"

cd <project-root>
node "C:/Program Files/Huawei/DevEco Studio/tools/hvigor/bin/hvigorw.js" \
  --mode project -p product=default assembleApp -p buildMode=debug --no-daemon
```

### 清理缓存后重新构建

如果 `BuildNativeWithCmake` 仍显示 1ms，需清理所有缓存：
```bash
rm -rf entry/.cxx entry/build .hvigor
```

## 验证

构建成功后，HAP 中应包含所有 .so：
```bash
unzip -l entry/build/default/<INTERNAL_OUTPUT> | grep "\.so"
```

## 经验

1. **DevEco MCP 工具的局限**：MCP 构建成功不代表原生代码编译成功。`BuildNativeWithCmake 1ms` 是静默跳过的标志。
2. **MCP 工具 vs 命令行**：MCP 工具在 DevEco Studio 环境内运行，自动配置 Java 和 SDK 路径；但 `DEVECO_SDK_HOME` 可能未传递给 hvigor 子进程。
3. **诊断方法**：检查 `entry/.cxx/` 目录是否存在 `CMakeCache.txt`，以及 `entry/build/` 下是否有 `.so` 产物。

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | Coin3D Quarter Demo 构建时发现，MCP 和命令行环境均验证确认 |

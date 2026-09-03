---
id: semantic-qt-harmonyos-build-run-workflow
type: semantic
domain: tech
tags: [qt, harmonyos, devecocli, hvigor, hdc, build, run, hilog, ui-test, troubleshooting, workflow]
created: 2026-06-02
updated: 2026-08-15
status: active
audience: public
refs: [semantic-qt-harmonyos-build, semantic-qt-harmonyos-overview]
summary: >
  Qt HarmonyOS 编译运行工作流：devecocli 优先完成构建、安装、启动、日志和 UI 操作；
  封装未覆盖或诊断封装时使用可审计的 hvigor/hdc 最小调用，并保留 Qt 工程检查与失败排查闭环。
---

# Qt HarmonyOS 编译运行工作流

平台工具的当前能力和选择规则以 common 为准：

- [[ohos-common-kb/procedural/deveco-cli-usage-rules|DevEco CLI 使用规则]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/deveco-cli-usage-rules.md)）
- [[ohos-common-kb/semantic/deveco-mcp-capabilities|DevEco MCP 能力与使用边界]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/deveco-mcp-capabilities.md)）
- [[ohos-common-kb/semantic/harmonyos-development-fundamentals|HarmonyOS 开发基础]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-development-fundamentals.md)）

当前 deveco-mcp 只承担静态 `check` 和 LSP `restart`，不提供项目同步、构建、启动、日志或 UI 操作。历史名称 `project_sync`、`build_project`、`start_app`、`get_app_ui_tree`、`perform_ui_action` 不得作为当前流程调用。

构建环境搭建（configure、MinGW、Perl 等）见 [[qt-harmonyos-build]]；完整真机验收见 [[qt-ohos-run-test]]。

## 核心流程

```text
依赖准备 → 构建 unsigned HAP → 独立签名 → 安装启动 → 日志 → Qt UI/渲染验证
```

### Step 1：依赖准备

首次 checkout 或 `oh-package.json5` 变化时，优先运行项目/devecocli 提供的依赖同步能力。Qt 工程同时检查：

- `entry/build-profile.json5` 的 `externalNativeOptions.path` 指向目标 CMakeLists；
- `CMAKE_PREFIX_PATH` 指向正确 Qt OHOS SDK；
- Qt 应用 target 名与 `QtAppConstants.ets` 的 `APP_LIBRARY_NAME` 一致；
- `local.properties`/SDK 路径只保存在本机配置，不写进共享知识页。

### Step 2：构建

正常路径：

```bash
devecocli build --modules entry --product default --build-mode debug
```

Qt 编译阶段以 `BUILD SUCCESSFUL` 和 `entry-default-unsigned.hap` 为完成标志；签名是独立后续步骤。

当 devecocli 尚未覆盖目标参数、正在维护封装或构造最小失败复现时，可直接调用 hvigor。必须记录使用原因，结束后回到 devecocli 或项目标准门禁验证：

```bash
node <DEVECO>/tools/hvigor/bin/hvigorw.js assembleHap \
  --mode module -p product=default -p buildMode=debug --no-daemon
```

底层诊断只保留以下约束：使用同一 DevEco 安装中的 Node/JBR/SDK；先用 `tasks --no-daemon` 确认任务名；不把个人绝对路径固化进仓库。

### Step 3：签名、安装和启动

签名配置完成后，正常路径使用：

```bash
devecocli run --module entry
```

需要验证具体 HAP、Ability/Want 参数或封装未覆盖动作时，允许最小 hdc 诊断：

```bash
hdc install <signed.hap>
hdc shell aa start -b <bundleName> -a <abilityName>
```

不要用底层命令规避 bundleName/profile/signingConfig 不一致；底层调用成功后仍要回到正常交付流程。

### Step 4：日志

```bash
devecocli log --bundle-name <bundleName> --level E
devecocli log --crash --bundle-name <bundleName>
```

Qt 特有关键字：

| 日志 | Qt 侧检查 |
|---|---|
| `libqohos.so not found` | QPA plugin 是否进入最终 HAP |
| `libQt5Core.so not found` | Qt runtime 依赖闭包是否完整 |
| `Cannot load Qt platform plugin` | plugin 路径、依赖和 ABI |
| `module "QtQuick" is not installed` | QML 模块与资源部署 |

devecocli 过滤不足时可用最小 `hdc shell hilog` 诊断，并记录 bundle/PID 过滤条件。

### Step 5：Qt UI 验证

优先使用 devecocli 当前实际提供的 `ui` 子命令。Qt UI 位于 XComponent/QPA 承载层，普通 ArkUI inspector 可能只看到 XComponent；获取 Qt 控件树需启用 Qt accessibility bridge，再通过目标环境支持的 uitest 能力验证。

devecocli 没有对应 key/uitest 动作时，可使用最小底层调用，例如 `hdc shell uitest uiInput keyEvent ...`。这属于明确能力缺口，不应被推广为所有设备操作的默认路径。

截图存在不等于 Qt 渲染正确；同时检查非黑屏、窗口层级、输入、生命周期和日志。

## 静态检查 MCP

当前环境已连接 deveco-mcp 时，在修改受支持的 ArkTS/C++ 文件后运行 `check`；LSP 索引异常时运行一次 `restart`。MCP 不可用时，运行项目既有编译/lint/typecheck，不调用历史 build/run/UI MCP 工具。

## 失败排查闭环

1. 先查 KB 中同错误关键词和对应 problem；
2. 分类为依赖/编译/链接/打包/签名/安装/启动/运行时；
3. 同一假设最多重试三次，每次保留命令、输入、输出和不同证据；
4. 成功后沉淀最小根因与回归；仍失败则停止并提交错误上下文、已尝试方案和缺失权限/环境。

| 环节 | 典型信号 | 优先检查 |
|---|---|---|
| CMake | package/target not found | Qt kit、toolchain、find root path |
| 编译 | header/API error | Qt5/Qt6 与 OHOS 条件分支 |
| 链接 | undefined symbol / missing library | target link、ABI、依赖闭包 |
| 打包 | Hvigor/HAP/resource failure | build-profile、模板、资源路径 |
| 安装/启动 | profile/bundle/ability error | 身份、签名、设备 API、Want |
| 运行 | dlopen/QPA/QML/crash | 最终 HAP、hilog/faultlog、Qt adapter |

## 验收清单

- [ ] 未调用历史 MCP build/run/UI 工具
- [ ] 正常路径优先 devecocli，底层调用有明确原因和退出条件
- [ ] unsigned HAP、签名 HAP 和运行中应用三个阶段分开记录
- [ ] Qt runtime/QPA/QML/三方依赖闭包经过静态预检
- [ ] 真机日志、截图、Qt 控件交互和生命周期均完成验证
- [ ] deveco-mcp 可用时完成 check；不可用时完成项目替代门禁

## 参考

- [[qt-harmonyos-build]] — Qt SDK 与构建环境
- [[qt-ohos-run-test]] — Qt 真机 CLI 验收
- [[ohos-common-kb/procedural/deveco-cli-usage-rules|common：DevEco CLI 使用规则]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/deveco-cli-usage-rules.md)）

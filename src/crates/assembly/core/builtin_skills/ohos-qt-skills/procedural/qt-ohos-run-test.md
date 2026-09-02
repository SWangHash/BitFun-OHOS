---
id: procedural-qt-ohos-run-test
type: procedural
domain: workflow
tags: [qt, harmonyos, device, verification, hdc, hvigor, signing, cli, build, deploy, run, troubleshoot, rendering, lifecycle, window, platform-limits, input-event, run-test, cli-build]
created: 2026-07-08
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-build-run-workflow, semantic-qt-harmonyos-project-structure, semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-window-model, semantic-qt-harmonyos-lifecycle, problem-render-black-rgba8-zink-mipmap, problem-ohos-mainthread-mismatch, problem-runtime-qpa-plugin-not-found, problem-runtime-fail-libqtdbus-missing, problem-runtime-sqlite-open-database, problem-runtime-dlopen-writable-path, problem-runtime-crash-sandbox-readonly-path, problem-runtime-crash-null-pointer-entry-shim, problem-surfaceholder-nativexcomponent-incompatibility, episodic-quit-deadlock-tsfn, episodic-wa-nativewindow-leave-bug, episodic-toolwindow-crossscreen-flicker, procedural-qt-app-harmonyos-completion, problem-runtime-crash-libqohos-modules-mismatch]
summary: >
  鸿蒙化运行测试工作流（CLI全流程,七阶段闭环）：环境SDK预检→构建静态预检(DT_NEEDED/符号可见性/QML插件部署)→
  签名安装→启动运行时测试(渲染黑屏三类定位/Ability生命周期退出/窗口行为回归/输入事件/平台限制回归)→
  崩溃日志分析→修复回归→Playbook B Demo。聚焦让应用在真机跑起来,非全量功能验证(功能用例闭环见应用鸿蒙化完善)。
  含三件套(ASCII循环图/循环退出条件✅/门控检查⚠️)。被应用移植/构建排障/修复验证复用。
leader_summary: >
  提炼可复用的真机运行测试工作流,覆盖源码到真机跑起来的完整链路,含部署预检/三类黑屏定位/生命周期退出/窗口行为/平台限制回归等实战运行测试维度及问题沉淀。功能级用例闭环见应用鸿蒙化完善工作流。
impact: [迁移提效, 框架支撑]
deliverables: [工作流, 问题沉淀]
evidence: [<APP_NAME>真机验证commit, <WORKLOG>]
---

# 鸿蒙化运行测试工作流

> **适用场景**：已迁移完成的 Qt 鸿蒙化项目，需在真机上让应用端到端运行起来（聚焦"跑起来"，非全量功能验证——功能级用例闭环见 [[qt-app-harmonyos-completion]]）。
> **前置条件**：项目已有 `HarmonyOS/` 工程目录 + `OhosExampleApp/CMakeLists.txt` + Qt OHOS SDK。
> **预期耗时**：30-60 分钟（含排障）。

---

## 触发条件

- 已迁移完成的 Qt 鸿蒙化项目，需真机端到端运行测试（让应用跑起来）
- 收到 应用移植 / 构建排障 / 修复验证 任务且需真机闭环（本工作流被三者复用，见 _index/_task-routing.md 路由 [A][E][J]）
- 桌面/模拟器验证不足以暴露渲染、生命周期、窗口行为等真机专属问题

---

## 流程总览

```
§1 环境与SDK预检 → §2 构建与静态预检 → §3 签名与安装 → §4 启动与运行时验证
                                                              │
                              ┌───────────────────────────────┤
                              ↓                               ↓
                         通过→闭合              崩溃/异常→§5 崩溃日志分析→§6 修复回归→闭合
§7 Playbook B Demo（纯库项目可选附录）
```

> **📋 TODO 同步点**：本工作流为多步骤任务，每个阶段转换时更新 `<LOCAL_TODO>` 该任务「进展」列（格式 `阶段N[完成|进行中]：关键产出`）；任务完成时同会话移至「✅ 已完成」并追加 `<WORKLOG>`。纯查询类任务不适用本流程。

---

## 阶段一：环境与 SDK 预检

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段一进行中：环境与SDK预检`

### 1.1 路径配置

运行 `setup.ps1`（或 `setup.sh`）替换 `entry/build-profile.json5` 中的占位符：

```powershell
powershell -File "HarmonyOS\setup.ps1" -QtSdk "$env:QT5_15_OHOS_SDK"
```

**⚠️ 中文路径陷阱**：`setup.ps1` 内部 `Resolve-Path` 对中文路径编码可能损坏。如遇乱码，手动 Write 重写 `build-profile.json5`。

**⚠️ hvigor 路径白名单**：hvigor **拒绝**包含中文/特殊字符的工程路径。解决方案：

```powershell
# 复制到纯 ASCII 路径
Copy-Item -Path "原始路径\ProjectName" -Destination "$env:TEMP\opencode\ProjectName" -Recurse -Force
# 修正 build-profile.json5 中的 CMake 路径指向复制后的位置
```

### 1.2 创建 local.properties

```powershell
"sdk.dir=${env:DEVECO_PATH}\sdk" | Set-Content "HarmonyOS\local.properties" -NoNewline
```

### 1.3 环境变量

| 变量 | 值 | 用途 |
|------|---|------|
| `DEVECO_SDK_HOME` | `${DEVECO_PATH}\sdk` | hvigor 定位 SDK |
| `PATH` | 追加 `${DEVECO_PATH}\jbr\bin` | Java（HAP 打包需要） |

```powershell
$env:DEVECO_SDK_HOME = "${env:DEVECO_PATH}\sdk"
$env:PATH = "${env:DEVECO_PATH}\jbr\bin;" + $env:PATH
```

### 1.4 工具路径速查

| 工具 | 路径 |
|------|------|
| hvigorw.js | `${DEVECO_PATH}\tools\hvigor\bin\hvigorw.js` |
| node.exe | `${DEVECO_PATH}\tools\node\node.exe` |
| java (JBR) | `${DEVECO_PATH}\jbr\bin\java.exe` |
| hdc | `${DEVECO_PATH}\sdk\default\openharmony\toolchains\hdc.exe` |
| clang | `${DEVECO_PATH}\sdk\default\hms\native\BiSheng\bin\clang.exe` |

### 1.5 SDK 模块 live-verify

> **⚠️ 元教训**：不要信 KB 静态矩阵表（modules 页的"已适配"标记），**必须 live-verify**。默认 SDK 与全量 SDK 模块齐全度不同，KB 矩阵记录的是 wiki 适配状态，与本地默认 SDK 实际可用模块可能不一致——直接 `ls` 验证。

```powershell
# 验证 CMake config 齐全
Get-ChildItem "$env:QT5_15_OHOS_SDK\lib\cmake" -Directory | Select-Object Name
# 验证 Qt 模块 .so 存在
Get-ChildItem "$env:QT5_15_OHOS_SDK\lib" -Filter "libQt5*.so" | Select-Object Name
```

- 缺模块（如 QuickControls2/Qt3D）→ 改用全量 SDK（`QT5_15_OHOS_SDK_FULL`），或参考全量 SDK 重编复盘
- 实战教训：某 Qt3D planets demo 黑屏根因之一就是 KB 矩阵标记"已适配"但默认 SDK 实际缺 Qt3D 模块，须 live-verify 方可信

### 循环退出条件（必须全部满足）

- ✅ hvigorw `--sync` 成功无 error
- ✅ SDK 模块 live-verify 通过（所需 CMake config + `.so` 均存在）
- ✅ 工程路径无中文/特殊字符白名单冲突

### 输出物

- 可同步的 `HarmonyOS/` 工程
- SDK 模块可用性清单（缺失模块已补齐或改用全量 SDK）

> **⚠️ 门控检查**：阶段一未通过退出条件前，**禁止进入阶段二**。环境/SDK 不齐的构建是无意义的。

---

## 阶段二：构建与静态预检

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段二进行中：构建与静态预检`

### 2.1 命令行构建（推荐）

```powershell
$node = "${env:DEVECO_PATH}\tools\node\node.exe"
$hvigor = "${env:DEVECO_PATH}\tools\hvigor\bin\hvigorw.js"

# clean
& $node $hvigor clean --no-daemon

# 构建 debug HAP
& $node $hvigor --mode project -p product=default assembleApp -p buildMode=debug --no-daemon
```

### 2.2 构建产物

```
entry/build/default/outputs/default/
├── entry-default-unsigned.hap    ← 未签名（真机不可安装）
├── entry-default-signed.hap      ← 已签名（§3 配置后生成）
└── app/
    └── entry-default.hap         ← 中间产物
```

### 2.3 native 库完整性验证

```powershell
Get-ChildItem "entry\build\default\intermediates\cmake\default\obj\arm64-v8a" -Filter "*.so" | Select-Object Name
```

**必检清单**（核心 + 分类插件，参见 [[qt-harmonyos-golden-rules]] B7/B12）：

| 库 | 部署位置 | 漏部署后果 |
|----|---------|-----------|
| `libqohos.so` | `libs/arm64/` | 启动即崩，`QPA platform plugin "qohos" not found`（见 problem-runtime-qpa-plugin-not-found） |
| `libQt5Core.so` / `libQt5Gui.so` / `libQt5Widgets.so` | `libs/arm64/` | 核心功能缺失 |
| `libQt5DBus.so` | `libs/arm64/` | `libqohos.so` 依赖链断裂（见 problem-runtime-fail-libqtdbus-missing，**常被遗漏**） |
| 应用业务库（如 `lib<APP_NAME>.so`） | `libs/arm64/` | 业务功能缺失 |
| `libqohosstyle.so` | `libs/arm64-v8a/styles/` | 样式缺失（B7 铁律，手动复制） |
| `libqsqlite.so` | `libs/arm64-v8a/sqldrivers/` | `addDatabase("QSQLITE")` driver 为 null（B12 铁律，见 problem-runtime-sqlite-open-database） |
| `libqsvg.so` | `libs/arm64-v8a/imageformats/` | SVG 图片不显示（同类分类插件） |

### 2.4 DT_NEEDED / 符号可见性静态预检

> **⚠️ 元教训**：必须在部署前静态预检，避免真机 `dlopen` 失败再回头查。Qt6 OHOS Windows 交叉编译产物要**遍历 HAP 内全部 native `.so`**，不能只检查业务库（Qt 框架库也可能带病）。

```powershell
# 遍历 HAP 内全部 native .so（不只业务库）
$soDir = "entry\build\default\intermediates\cmake\default\obj\arm64-v8a"
Get-ChildItem $soDir -Filter "*.so" | ForEach-Object {
    $f = $_.FullName
    Write-Host "=== $($_.Name) ==="
    # DT_NEEDED 是否含 Windows 绝对路径（如 C:/<绝对路径>/lib*.so）
    & $readelf -d $f | Select-String "NEEDED.*[A-Z]:\\"
    # main 符号是否 GLOBAL DEFAULT 可见（非 HIDDEN）
    & $readelf -s $f | Select-String "\bmain\b.*GLOBAL.*DEFAULT"
}
```

| 异常 | 关联 problem | 修复方向 |
|------|------------|---------|
| DT_NEEDED 含 `C:/<绝对路径>/lib*.so` 绝对路径 | 见 _lookup 速查表 | CMake 改裸名链接，去绝对路径 |
| `main` 符号 HIDDEN / 无 GLOBAL DEFAULT | 见 _lookup 速查表 | CMake 设 `CMAKE_VISIBILITY_INLINES_HIDDEN=OFF` 或显式导出 main |

### 2.5 QML / 分类插件部署验证

**QML 应用必做**（否则黑屏，见 _lookup 速查表）：

```powershell
# 复制 SDK 整个 qml/ 目录到 HAP resfile（只读目录，dlopen 允许）
Copy-Item "$env:QT5_15_OHOS_SDK\qml" -Destination "entry\src\main\resources\resfile\qml" -Recurse -Force
```

- QPA 启动设 `QML2_IMPORT_PATH = bundle/entry/resources/resfile/qml`（源码实证）
- `styles/`、`sqldrivers/`、`imageformats/` 子目录结构验证（见 §2.3 表）

### 2.6 Debug vs Release 构建差异

| 维度 | Debug | Release |
|------|-------|---------|
| `Q_ASSERT` 崩溃 | 触发（如 theMainThread 不匹配，见 problem-ohos-mainthread-mismatch） | **静默**（Q_ASSERT 编译消失，问题隐藏） |
| 验证策略 | 首次验证用 Debug 暴露断言 | 稳定性验证补 Release，确认无隐藏问题 |

> **建议**：首次端到端验证用 Debug 构建暴露 `Q_ASSERT`；Debug 通过后补一轮 Release 构建回归，防断言问题在 Release 静默潜伏。

### 2.7 libqohos 与 .ets 胶水模板版本一致性预检

> **⚠️ 元教训**：libqohos.so 的 NAPI `setupQtApplicationImpl` 在不同源码版本读字段名不同——5.12 源(qohosjsmain.cpp:1736)读 `"modulesFactories"`,5.15 源(:1735)读 `"modules"`。而 OHOS 胶水模板 `QAbilityStage.ets` 来源决定它传哪个字段(5.12 模板传 `modulesFactories`)。**SDK 的 libqohos 与 .ets 模板必须同源版本**,否则启动即崩 jscrash `object has no property named 'modules'`(QAbilityStage.ets:22,见 problem-runtime-crash-libqohos-modules-mismatch)。

| .ets 模板来源 | 传字段 | 匹配的 SDK(libqohos) |
|---|---|---|
| `${QT5_15_SRC}`(ENV 标 5.15 实为脏 5.12 树) | `modulesFactories` | `${QT5_15_OHOS_SDK}`(旧 SDK,libqohos 读 modulesFactories) |
| 5.15 模板(源码树未含,需另行获取) | `modules` | `${QT5_15_OHOS_SDK_FULL}`(全量 SDK,libqohos 读 modules) |

**判据**：qView(参考实现)用 `${QT5_15_OHOS_SDK}` + 5.12 模板 → 一致 → 能跑。port agent 若误用 `${QT5_15_OHOS_SDK_FULL}` + 5.12 模板 → 编译成功但运行崩。**编译产出 HAP ≠ 能跑**,须 §4 真机验证。

### 循环退出条件（必须全部满足）

- ✅ HAP 构建成功，产物在 `entry/build/default/outputs/default/`
- ✅ native 库完整性清单全部通过（含分类插件子目录 `styles/`/`sqldrivers/`/`imageformats/`）
- ✅ DT_NEEDED 全裸名，无 Windows 绝对路径
- ✅ `main` 符号 GLOBAL DEFAULT 可见
- ✅ QML 应用的 `qml/` 目录已部署到 `resfile/qml/`
- ✅ libqohos 与 .ets 模板版本一致(${QT5_15_OHOS_SDK_FULL} 仅当用 5.15 模板;否则用 ${QT5_15_OHOS_SDK})

### 输出物

- 签名就绪的 HAP（或待签名 unsigned HAP）
- 静态预检报告（DT_NEEDED + 符号可见性 + 插件部署清单）

> **⚠️ 门控检查**：静态预检未全通过前，**禁止安装到真机**。带病部署只会得到"启动即崩"的无意义结果，浪费真机往返。

---

## 阶段三：签名与安装

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段三进行中：签名与安装`

### 3.1 签名配置

真机拒绝安装未签名 HAP（`code:9568320 error: no signature file`）。

**复用已有调试证书**（从 `~/.ohos/config/` 或已有项目提取）：

```json5
// build-profile.json5 → app.signingConfigs
{
  "name": "default",
  "type": "HarmonyOS",
  "material": {
    "certpath": "C:\\Users\\<user>\\.ohos\\config\\<name>.cer",
    "keyAlias": "debugKey",
    "keyPassword": "<encrypted>",
    "profile": "C:\\Users\\<user>\\.ohos\\config\\<name>.p7b",
    "signAlg": "SHA256withECDSA",
    "storeFile": "C:\\Users\\<user>\\.ohos\\config\\<name>.p12",
    "storePassword": "<encrypted>"
  }
}
```

**关键**：`.p7b` Profile 绑定特定 bundleName。必须将 `AppScope/app.json5` 的 `bundleName` 改为与证书一致的值，否则 SignHap 失败（见 _lookup 速查表）。

```json5
// AppScope/app.json5
{ "app": { "bundleName": "<证书绑定的bundleName>", ... } }
```

在 products 中引用 signingConfig：

> **⚠️ 必做步骤**：仅在 `app.signingConfigs` 定义证书**不够**——必须在 `app.products[]` 里加 `"signingConfig": "default"` 引用对应签名配置，否则 hvigor 仍产出 unsigned HAP（`entry-default-unsigned.hap` 而非 `-signed.hap`），真机拒装 `code:9568320 error: no signature file`。验证标志：构建后 `entry/build/default/outputs/default/` 下出现 `entry-default-signed.hap`。

```json5
// build-profile.json5 → app.products
{ "name": "default", "signingConfig": "default", ... }
```

### 3.2 安装到真机

```powershell
$hdc = "${env:DEVECO_PATH}\sdk\default\openharmony\toolchains\hdc.exe"

# 确认设备连接
& $hdc list targets
# 输出设备 ID，如 <DEVICE_ID>

# 卸载旧版（如有）
& $hdc uninstall <bundleName>

# 安装签名 HAP
& $hdc install "entry\build\default\outputs\default\entry-default-signed.hap"

# 如有多模块（如 <EmbeddedUiExtensionHost>），逐个安装
& $hdc install "<module>\build\default\outputs\default\<module>-default-signed.hap"
```

### 循环退出条件（必须全部满足）

- ✅ `hdc install` 成功（无 `error: no signature file` / 无 `9568320`）
- ✅ 设备上可查到 bundleName 对应的安装记录

### 输出物

- 真机已安装的签名 HAP

---

## 阶段四：启动与运行时验证 ★重构核心

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段四进行中：启动与运行时验证`

> **本阶段为验证核心**：进程存活只是最低门槛，渲染/生命周期/窗口/输入/平台限制回归才是真机验证的价值所在。

### 4.1 启动应用 + 验证进程存活

```powershell
# 从 module.json5 获取 abilityName（通常为 QAbility 或 EntryAbility）
& $hdc shell aa start -a <AbilityName> -b <bundleName>

Start-Sleep -Seconds 5
& $hdc shell "ps -ef" | Select-String "<bundleName>"
```

- **有输出** → 进程存活，进入 §4.2 渲染验证
- **无输出** → 进程已崩溃，直接进入 §5 崩溃日志分析

### 4.2 渲染正确性验证

> **⚠️ 元教训**：截图"存在"≠"渲染正确"。三类黑屏在真机同现实战，根因各异，须按矩阵区分。**竞态/渲染最终判定须以真机为准——静态分析给方向，真机给结论。**

**三类黑屏区分矩阵**：

| 黑屏类型 | 日志特征 | 根因 | 修复 |
|---------|---------|------|------|
| Qt3D RGBA8 mipmap 静默纯黑 | **无 GL 错误**（完全静默）；Phong 光照/JPG 贴图正常，仅 alpha-PNG 实体贴图纯黑 | ZINK `glGenerateMipmap` 对 RGBA8 alpha 纹理失败→mipmap 不完整→采样返回 0 | alpha-PNG 实体关 mipmap（`generateMipMaps:false`+`minificationFilter:Texture.Linear`），守卫用 `Qt.platform.pluginName!=="ohos"`（注意 `Qt.platform.os` 在 OHOS 返回 "linux" 会致守卫永不触发）——见 problem-render-black-rgba8-zink-mipmap |
| EGL_BAD_CONFIG 黑屏 | `Cannot find EGLConfig` + `Failed to create surface with error: 12293 - EGL_BAD_CONFIG` | `QSurfaceFormat::setSamples(4)` 4x MSAA，OHOS EGL 无匹配 config | 加 `#ifndef Q_OS_OHOS` 守卫去掉 samples（保留 depth24+stencil8）——见 _lookup 速查表 |
| QML 模块未部署黑屏 | `module "Qt3D"/"QtQuick"/"QtQuick.Scene3D" is not installed`；进程不崩溃但 QML 树加载失败→空白 | HAP 无 `qml/` 目录，QML 类型插件未部署 | 复制 SDK `qml/` 到 `entry/src/main/resources/resfile/qml/`——见 §2.5 / _lookup 速查表 |

**渲染黑屏定位循环**：

```
┌──────────────────────────────────────────────────────────┐
│  黑屏诊断循环开始                                         │
│  ↓                                                       │
│  4.2a 获取 hilog + 截图                                    │
│  ↓                                                       │
│  4.2b 日志含 EGL_BAD_CONFIG / 12293 ?                    │
│  ├─ 是 → EGL 样本配置问题(setSamples(4))                 │
│  │       → 加 Q_OS_OHOS 守卫 → 回阶段二构建               │
│  └─ 否 ↓                                                 │
│  4.2c 日志含 "module not installed" / QML 错误 ?         │
│  ├─ 是 → QML 模块未部署                                   │
│  │       → 复制 SDK qml/ 到 resfile/qml/ → 回阶段二构建   │
│  └─ 否 ↓                                                 │
│  4.2d 日志无 GL 错误，截图纯黑 ?                           │
│  ├─ 是 → 疑似 ZINK mipmap 黑(RGBA alpha-PNG)            │
│  │       → alpha-PNG 实体关 mipmap(守卫 pluginName)      │
│  │       → 回阶段二构建                                   │
│  └─ 否 → 非三类黑屏，转入阶段五崩溃分析                    │
│                                                           │
│  退出条件：截图非纯黑 + 无 EGL/QML 错误                  │
└──────────────────────────────────────────────────────────┘
```

**截图验证**（保留并扩展为"截图对照"）：

```
# 通过 DevEco MCP
deveco-mcp_perform_ui_action(actionType="screenshot", hvd="<设备名>", localPath="<保存路径>")

# 或 hdc 命令行
& $hdc shell uitest screenCap -p /data/local/tmp/screenshot.png
& $hdc file recv /data/local/tmp/screenshot.png <本地路径>
```

**竞态类渲染问题**：拖拽/缩放窗口时若 surface 报的尺寸与 native 实际几何解耦（match=0 铁证查法），属鸿蒙系统侧 bug，转入系统问题验证分析。

### 4.3 Ability 生命周期与退出验证

> 参见 [[qt-harmonyos-lifecycle]] 金标准 + [[qt-harmonyos-golden-rules]] L1 铁律。

| 验证项 | 操作 | 预期 | 异常关联 |
|--------|------|------|---------|
| closeEvent 3 级关闭 | 分别触发 WindowStageClose(L1)/AbilityClose(L2) | L1 可弹对话框；L2 **禁止弹 UI**（弹对话框会卡在关闭流程被系统强杀），仅 autoSave | L1 铁律违背→对话框卡死 |
| `qApp->quit()` 退出 | 调用 quit() | 进程及时退出 | 死锁 ~2min 不退出（Ability 销毁阶段不处理 NAPI TSFN 回调致 Promise 永不 resolve）——见 episodic-quit-deadlock-tsfn |
| theMainThread 匹配 | Debug 构建下点击/输入 | 输入事件正常 | Debug 下 `Q_ASSERT` 崩溃（`sendThroughApplicationEventFilters` mainThread 不匹配）——见 problem-ohos-mainthread-mismatch；**Release 静默**，须 Debug 验证 |

### 4.4 窗口行为回归验证

> 参见 [[qt-harmonyos-window-model]] + [[qt-harmonyos-golden-rules]] W1-W5。

| 验证项 | 操作 | 预期 | 关联 |
|--------|------|------|------|
| subwindow tagging 顺序 | 子窗口 `show()`/`winId()` 前调用 `tagWindowOrWidgetAsSubWindowOf()` | 子窗口正确归属主窗口 | W1 铁律；事件 bug 方法论见 episodic-wa-nativewindow-leave-bug（10 场景风险矩阵） |
| Dialog-as-main-window | 弹无 parent 的 `QDialog` | 不出现独立 Dock 图标/Alt+Tab 条目 | W3 铁律；dialog 后 MDI 切换失效见 _lookup 速查表 |
| 首窗口全屏顺序 | 先 `show()` 再 `showFullScreen()` | 首窗口正常全屏 | W4 铁律（启动时直接全屏会异常） |
| hide→最小化 | 主窗口 `hide()` | 回退为最小化（无系统托盘时，与桌面行为不同） | W5 铁律 |
| 跨屏拖拽 | 拖窗口到另一屏 | 无闪烁 | moveWindowToGlobalDisplay 与 resizeAsync 冲突见 episodic-toolwindow-crossscreen-flicker |
| SurfaceHolder opaque | 设置 surface opaque | opaque 生效 | SurfaceHolder(Node API) 与 OH_NativeXComponent(旧 NAPI) 互斥，见 problem-surfaceholder-nativexcomponent-incompatibility（遗留待分析） |

### 4.5 输入事件验证

| 验证项 | 操作 | 预期 | 关联 |
|--------|------|------|------|
| 鼠标点击 | 点击按钮/菜单 | 响应正确 | — |
| 触摸 | 触摸交互 | 响应正确 | — |
| hover | 鼠标悬停 | hover 回调触发 | hover 回调不可靠是双重盲区（见 episodic-wa-nativewindow-leave-bug） |
| Leave 事件 | 鼠标移出窗口 | Leave 事件触发 | Leave 事件不灵敏双重盲区（事件"汇聚点"修复，5 条方法论见 episodic-wa-nativewindow-leave-bug） |

> **验证方法**：操作 + `hilog` 同步观察事件序列，确认事件投递路径完整。

### 4.6 平台限制回归清单

> 参见 [[qt-harmonyos-platform-limits]] 8 大类 + [[qt-harmonyos-golden-rules]] P1-P5/G1-G2。逐项确认应用未误用被限制 API。

| 限制类 | 验证方法 | 预期 | 关联 |
|--------|---------|------|------|
| chmod 不可用 | `QFile::setPermissions()` | 返回 false，静默失败 | P1；QTBUG-146619 |
| symlink 禁止 | `QFile::link()` | EACCES 13900012 | P2；QTBUG-146621 |
| stat 系统路径 | `QFileInfo("/bin/sh").isFile()` | false（stat 返回 EACCES） | findExecutable 失效；QTBUG-146625 |
| dlopen 拒绝可写路径 | 从 `/data/storage/el2/` 加载 .so | EINVAL errno=22（仅 el1 只读可访问） | P3；见 problem-runtime-dlopen-writable-path |
| 无 tzdata | `QTimeZone::systemTimeZone()` | 需 ICU 后端 | P5；QTBUG-146717 |
| 无等宽字体 | `QFontDatabase::systemFont(FixedFont)` | 返回非等宽，需自带字体 | QTBUG-146623 |
| XComponent 弃用 | SURFACE 类型 | API 20 弃用，迁移方向 ContentSlot | QTBUG-146622 |
| ZINK mipmap 黑 + pluginName | `Qt.platform.os` / `Qt.platform.pluginName` | `os` 返回 "linux"（非 "ohos"），守卫必须用 `pluginName` | G1；见 problem-render-black-rgba8-zink-mipmap |

### 循环退出条件（必须全部满足）

- ✅ 进程存活（`ps -ef` 有输出）
- ✅ 截图非纯黑，渲染内容正确（通过三类黑屏区分）
- ✅ closeEvent 3 级关闭行为符合预期（L1 可弹/L2 禁弹）
- ✅ 窗口行为回归清单全部通过（tagging/Dialog/全屏/hide/跨屏）
- ✅ 输入事件响应正确（点击/触摸/hover/Leave）
- ✅ 平台限制回归清单无意外触发（未误用被限制 API）

### 输出物

- 运行时验证报告（截图 + 日志 + 行为对照表）
- 平台限制回归清单（已确认/已规避/需修复）

> **⚠️ 门控检查**：运行时验证未全通过 → 进入阶段五崩溃日志分析。全部通过 → 工作流闭合（可选进阶段六回归或阶段七 Demo）。

---

## 阶段五：崩溃日志分析与问题定位

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段五进行中：崩溃日志分析`

### 5.1 获取崩溃日志

```
# 通过 DevEco MCP（推荐，自动解析）
deveco-mcp_get_hilog_or_faultlog_recent(
  bundle_name="<bundleName>",
  is_crash_log=true
)

# 或 hdc 命令行
& $hdc shell "hilog -x -e '<bundleName>'" | Select-String "Error|FATAL|SIGSEGV|TypeError"
```

### 5.2 崩溃分类与排查

| 崩溃类型 | 日志特征 | 常见原因 | 排查方向 |
|---------|---------|---------|---------|
| **JSCrash (TypeError)** | `Cannot read property X of undefined` | native .so 加载失败 → JS 模块导出为 undefined | 检查 `MUSL-LDSO` 日志 `Error loading shared library` |
| **SIGSEGV (SEGV_MAPERR)** | `Signal:SIGSEGV@0x...` + C++ 栈帧 | 空指针/野指针；entry shim 传 nullptr | 分析栈帧；entry shim nullptr 见 problem-runtime-crash-null-pointer-entry-shim |
| **SIGABRT** | `abort` + assert 信息 | 断言失败；theMainThread 不匹配；沙箱只读路径 | theMainThread 见 problem-ohos-mainthread-mismatch；沙箱只读见 problem-runtime-crash-sandbox-readonly-path |
| **dlopen 失败** | `dlopen failed` / `library not found` | .so 缺失/路径错误/DT_NEEDED 绝对路径/main 不可见 | 检查 HAP `libs/arm64/`；见 §2.4 静态预检 |

**崩溃日志分析循环**：

```
┌──────────────────────────────────────────────────────────┐
│  崩溃分析循环开始                                         │
│  ↓                                                       │
│  5.1 获取 faultlog (hilog --type crash)                  │
│  ↓                                                       │
│  5.2 崩溃类型分类                                         │
│  ├─ JSCrash (TypeError)                                  │
│  │   → 检查 MUSL-LDSO "Error loading library"           │
│  │   → 匹配 _lookup 部署类 problem → 修复 → 回构建       │
│  ├─ SIGSEGV (SEGV_MAPERR)                               │
│  │   ├─ entry shim 传 nullptr? → problem-runtime-crash-null-pointer-entry-shim │
│  │   └─ 否 → 分析 C++ 栈帧定位崩溃函数                   │
│  ├─ SIGABRT (assert)                                    │
│  │   ├─ theMainThread 不匹配? → problem-ohos-mainthread-mismatch │
│  │   ├─ 沙箱只读路径? → problem-runtime-crash-sandbox-readonly-path │
│  │   └─ 否 → 查看 assert 消息                            │
│  └─ dlopen 失败                                          │
│      ├─ DT_NEEDED 绝对路径? → 见 §2.4 / problem-runtime-absolute-needed-path │
│      ├─ 可写路径? → problem-runtime-dlopen-writable-path │
│      ├─ main 不可见? → 见 §2.4 / problem-runtime-main-symbol-hidden │
│      └─ 否 → 检查 HAP libs/arm64/ 目录                  │
│  ↓                                                       │
│  5.3 匹配到已知 problem ?                                  │
│  ├─ 是 → 应用已知修复方案 → 转入阶段六                    │
│  └─ 否 → 新问题 → 记录草稿 → 转入阶段六                  │
│                                                           │
│  退出条件：崩溃根因已定位 + 修复方案已确定               │
└──────────────────────────────────────────────────────────┘
```

### 5.3 常见运行时问题速查

> 按 _lookup 分类组织，含双向链接到 problem 库（部署类已从"运行时"迁入"部署安装"分类）。

| 分类 | 问题 | 日志关键词 | 关联 problem |
|------|------|----------|-------------|
| 部署安装 | QPA 插件缺失 | `QPA platform plugin "qohos" not found` | problem-runtime-qpa-plugin-not-found |
| 部署安装 | libQt5DBus 缺失 | `Error loading shared library libQt5DBus.so` | problem-runtime-fail-libqtdbus-missing |
| 部署安装 | SQLite driver 缺失 | `QSQLITE driver not loaded` / `db->open()` 返回 false | problem-runtime-sqlite-open-database |
| 部署安装 | QML 模块未部署 | `module "Qt3D/QtQuick" is not installed` | 见 _lookup 速查表 |
| 部署安装 | DT_NEEDED 绝对路径 | `needed by C:/<绝对路径>/lib*.so` | 见 _lookup 速查表 |
| 部署安装 | main 未导出 | `dlsym() failed to find 'main' symbol` | 见 _lookup 速查表 |
| 渲染 | RGBA8 mipmap 黑 | Qt3D 实体贴图纯黑，无 GL 错 | problem-render-black-rgba8-zink-mipmap |
| 渲染 | EGL_BAD_CONFIG | `EGL_BAD_CONFIG 12293` / `Cannot find EGLConfig` | 见 _lookup 速查表 |
| 生命周期 | theMainThread 不匹配 | `Q_ASSERT sendThroughApplicationEventFilters` | problem-ohos-mainthread-mismatch |
| 生命周期 | 退出死锁 | `qApp->quit()` 后 ~2min 不退出 | episodic-quit-deadlock-tsfn |
| 平台限制 | dlopen 可写路径 | `dlopen errno=22 EINVAL` | problem-runtime-dlopen-writable-path |
| 平台限制 | 沙箱只读 SIGABRT | `SIGABRT` + `exit(1)` + 配置写入失败 | problem-runtime-crash-sandbox-readonly-path |
| 入口 | entry shim nullptr | `SIGSEGV` + 业务代码栈帧 | problem-runtime-crash-null-pointer-entry-shim |
| 模板/SDK版本 | libqohos/.ets 错配 | `object has no property named "modules"` / QAbilityStage.ets:22 / 启动1-2s退出 | problem-runtime-crash-libqohos-modules-mismatch |
| 窗口 | SurfaceHolder opaque 不生效 | `SurfaceHolder_Create returned null` | problem-surfaceholder-nativexcomponent-incompatibility |

### 循环退出条件（必须全部满足）

- ✅ 崩溃根因已定位（类型 + 具体原因）
- ✅ 匹配到已知 problem 或确认为新问题
- ✅ 修复方案已确定

### 输出物

- 崩溃分析报告（类型 + 栈帧 + 根因 + 修复方案）
- 新问题记录草稿（如为新问题，待阶段六沉淀）

---

## 阶段六：修复与回归验证

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` → `阶段六进行中：修复与回归验证`

### 6.1 修复流程

1. **定位根因**：根据 §5 分析结果
2. **修改源码**：在临时构建目录中修改
3. **同步回原始工程**：确保原始工程也包含修复
4. **重新构建**：`hvigorw clean` + `assembleApp`（回阶段二，**重跑静态预检**）
5. **卸载旧版 + 安装新版**：`hdc uninstall` + `hdc install`
6. **启动验证**：`aa start` + `ps -ef` 确认进程存活
7. **日志确认**：无 Error 级应用日志

### 6.2 修复沉淀到 problems/

> **⚠️ 元教训**：修正一个文件 ≠ 修正一个知识点。沉淀前 `grep` 全引用点，避免跨文件传播遗漏（工作流页本身曾因逐文件修正模式 67% 遗漏）。

- 使用 `_templates/qt-problem.md` 模板，`error_message` 字段填完整错误文本（便于 Agent 全文搜索匹配）
- 反向引用现有 problem 库：本工作流 §5.3 速查表已链接 14 条 problem
- 运行 `bash _scripts/kb-regen-indexes.sh` 重生 `problems/_lookup.md`（症状速查 + 领域分组 + 部署/运行时/签名分类；派生索引，gitignored，自动从 frontmatter 重建，勿手改）

### 6.3 回归验证

- 重新构建 + 安装 + 启动 + 验证（回阶段二→四）
- 确认原崩溃/黑屏/异常行为已消除
- 确认未引入新问题（Release 构建补一轮回归）

---

## 阶段七：Playbook B Demo 应用编写（可选附录）

> 适用：Playbook B 项目编译产物为静态库（`.a`），无 `HarmonyOS/` 工程目录，无法直接安装真机，需编写 Playbook A 风格 demo 链接静态库完成端到端验证。

> Demo 工程结构、CMakeLists.txt 要点、main.cpp 设计原则及已验证案例表属编译配方范畴（内部 procedural，此处不展开）。本节仅补充环境准备与真机验证衔接。

### 7.1 环境准备

```powershell
# 从已有 Playbook A 项目复制 HarmonyOS/ 目录（路径用 ENV.md 实际值，勿硬编码）
$base = "${PROJECTS_ROOT}/<batch-dir>"
robocopy "$base\<APP_NAME>\HarmonyOS" "$base\NewProject\HarmonyOS" /E /XD build .hvigor .cxx node_modules

# 替换占位符、签名、bundleName（同 §1 / §3 流程）
```

### 7.2 构建后真机验证

Demo 构建完成后，按本工作流 §1-§6 流程进行真机验证（环境预检→构建预检→签名安装→运行时验证→崩溃分析→修复回归），重点确认库在真机上的运行时行为（如 qhttp HTTP 通信、QSqlMigrator 数据库迁移）。

---

## 快速参考：完整命令序列

```powershell
# ── 环境 ──
$env:DEVECO_SDK_HOME = "${env:DEVECO_PATH}\sdk"
$env:PATH = "${env:DEVECO_PATH}\jbr\bin;" + $env:PATH
$node = "${env:DEVECO_PATH}\tools\node\node.exe"
$hvigor = "${env:DEVECO_PATH}\tools\hvigor\bin\hvigorw.js"
$hdc = "${env:DEVECO_PATH}\sdk\default\openharmony\toolchains\hdc.exe"

# ── 构建 ──
& $node $hvigor clean --no-daemon
& $node $hvigor --mode project -p product=default assembleApp -p buildMode=debug --no-daemon

# ── 安装 ──
& $hdc uninstall <bundleName>
& $hdc install "entry\build\default\outputs\default\entry-default-signed.hap"

# ── 启动 ──
& $hdc shell aa start -a <AbilityName> -b <bundleName>
Start-Sleep -Seconds 5
& $hdc shell "ps -ef" | Select-String "<bundleName>"

# ── 日志 ──
& $hdc shell "hilog -x -e '<bundleName>' -L E"
```

---

## 检查清单（工作流闭合确认）

- [ ] 阶段一：SDK 预检通过，hvigor sync 成功（SDK 模块 live-verify）
- [ ] 阶段二：HAP 构建成功 + 静态预检全通过（native 库完整性 + DT_NEEDED + 符号可见性 + QML 插件部署）
- [ ] 阶段三：签名 HAP 安装成功
- [ ] 阶段四：进程存活 + 渲染正确 + 生命周期/窗口/输入/平台限制回归全通过
- [ ] 阶段五：无未解决崩溃（或崩溃根因已定位 + 修复方案已确定）
- [ ] 阶段六：修复已回归验证 + 问题已沉淀到 `problems/`
- [ ] 索引同步：已运行 `bash _scripts/kb-regen-indexes.sh` 重生 `_map.md` 等派生索引（如页面 summary 变更），已提交 git commit

---

## 常见问题模式

| 模式 | 表现 | 排查方向 | 关联 problem |
|------|------|----------|-------------|
| 启动即崩 | `dlopen failed` | .so 缺失/路径错误 | problem-runtime-qpa-plugin-not-found, problem-runtime-fail-libqtdbus-missing |
| 黑屏无渲染 | 截图纯黑 | 三类黑屏区分矩阵（§4.2） | problem-render-black-rgba8-zink-mipmap, 见 _lookup 速查表 |
| 输入崩溃 | `SIGSEGV` + `Q_ASSERT` | theMainThread 不匹配 | problem-ohos-mainthread-mismatch |
| 退出卡死 | `quit()` 后无响应 | TSFN 死锁 | episodic-quit-deadlock-tsfn |
| 沙箱崩溃 | `SIGABRT` + `exit(1)` | 配置文件只读路径 | problem-runtime-crash-sandbox-readonly-path |
| 窗口异常 | 独立 Dock 图标/tagging 失效 | subwindow 规则 | [[qt-harmonyos-window-model]] W1-W5 |

---

## 供应链

> 详见 工作流供应链 §应用移植（本页为应用移植的真机验证子环节，也被构建排障和修复验证复用）

| 维度 | 详情 |
|------|------|
| **上游来源** | 迁移后的工程 / 构建排障需真机验证 / 修复后的回归验证 |
| **上游输入** | 已编译的 HAP + 签名配置 + 目标设备 |
| **下游接收方** | 迁移交付闭环 / 排障结论 / 回归报告 |
| **交付件** | 运行时验证报告 + 崩溃分析报告 + 问题沉淀 |
| **交付件路径** | 无固定目录（验证结果回流到上游任务） |
| **分流规则** | 发现框架 bug → 转入框架问题分析；发现系统问题 → 转入系统问题验证分析；已知问题 → 查 `_lookup` |

---

## 相关上下文

- [[qt-harmonyos-build-run-workflow]] — DevEco MCP 方式构建运行（本文补充 CLI 方式）
- [[ohos-common-kb/semantic/deveco-mcp-capabilities|DevEco MCP 能力与使用边界]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/deveco-mcp-capabilities.md)）— 通用安装、配置与能力边界
- [[qt-harmonyos-project-structure]] — 工程结构详解
- [[qt-harmonyos-golden-rules]] — 35 条铁律（B7/B12 部署、W1-W5 窗口、L1 生命周期、P1-P5/G1-G2 平台限制）
- [[qt-harmonyos-platform-limits]] — 平台限制 8 大类（§4.6 回归清单 canonical）
- [[qt-harmonyos-window-model]] — 窗口模型（tagging/First Window/fullscreen，§4.4 canonical）
- [[qt-harmonyos-lifecycle]] — 生命周期（closeEvent 3 级关闭/Stage 模型，§4.3 canonical）
- [[qt-app-harmonyos-completion]] — 应用鸿蒙化完善（运行通过后进入功能级用例闭环）
- 工作流供应链 — 工作流供应链总览（上下游关系和对接人清单）

---

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | CLI 全流程命令、脱敏后的真机验证实战经验、三类黑屏区分矩阵、生命周期/窗口/输入验证清单 |
| 🔍 框架源码 | QPA 插件关键文件路径、DT_NEEDED/符号可见性检查方法（readelf） |
| 📄 华为官方文档 | hdc 命令参考、Ability 生命周期文档、EGL/XComponent API 文档 |
| 📦 Problem 库 | 14 条运行时/部署 problem 的脱敏方法论提炼（见 refs） |
| 💼 Postmortem | 3 条公开复盘（quit-deadlock/wa-nativewindow-leave/toolwindow-crossscreen）的验证方法论提炼 |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

---

## 参考来源

- 基于个人 Qt 鸿蒙真机验证工作经验开发的工作流，无外部文档来源
- 实战素材脱敏后写入（项目名/设备 ID/路径均替换为占位符）
- 方法论参考 Qt 内部 QA 流程 + 本库 `episodic/postmortems/` 复盘

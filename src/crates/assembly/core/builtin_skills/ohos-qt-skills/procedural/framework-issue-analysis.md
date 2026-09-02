---
id: procedural-framework-issue-analysis
type: procedural
domain: workflow
tags: [workflow, qt, harmonyos, debugging, framework, analysis, logging, upstream-submission]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-api,semantic-qt-harmonyos-build,semantic-qt-harmonyos-overview]
summary: >
  框架内部问题分析工作流（四阶段闭环）：复现demo生成→编译修复迭代→问题定位(日志法)→根因分析(框架代码调用链)→系统接口验证→上游issue打包提交（工作流最终步骤）。
  阶段四为工作流闭合点：生成clean patch、整理issue说明单、输出纯Qt复现demo、更新知识库索引。
  适用于Qt框架在鸿蒙平台的bug分析。
---

# 框架内部问题分析

> 当收到 Qt for HarmonyOS 的 bug 报告或发现异常行为时，按此流程进行系统性分析和定位。

---

## 触发条件

- 收到 bug 报告或问题反馈
- 自己发现 Qt 在鸿蒙平台上的异常行为
- 开发者提交的问题需要内部排查

---

## 阶段一：明确问题现象（迭代循环）

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段一完成：最简 demo 已复现`

> **此阶段为循环过程，必须获得可稳定复现的最简 demo 后才能进入阶段二。**

```
┌──────────────────────────────────────────────────────────┐
│  循环开始                                                 │
│  ↓                                                       │
│  1.1 收集问题信息                                         │
│  ↓                                                       │
│  1.2 尝试复现 / 简化代码                                  │
│  ↓                                                       │
│  1.3 编译通过？                                           │
│  ├─ 否 → 分析编译错误 → 修复 → 回到 1.3                  │
│  └─ 是 ↓                                                 │
│  1.4 复现成功？                                           │
│  ├─ 否 → 调整条件 / 补充信息 → 回到 1.1                  │
│  └─ 是 → 1.5 还能进一步简化吗？                          │
│           ├─ 是 → 继续简化 → 回到 1.2                    │
│           └─ 否 → 退出循环 ✓                             │
│                                                           │
│  退出条件：最简 demo 可编译 + 可稳定复现问题              │
└──────────────────────────────────────────────────────────┘
```

### 1.1 收集问题信息

| 收集项 | 说明 |
|--------|------|
| 问题描述 | 预期行为 vs 实际行为 |
| 复现步骤 | 操作序列、触发条件 |
| 环境信息 | Qt 版本、OHOS SDK 版本、设备/模拟器型号 |
| 影响范围 | 哪些模块/功能受影响 |
| 原始代码 | 用户提供的完整工程或问题片段 |

### 1.2 尝试复现 / 简化代码

**创建 Demo 工程**：

> **⚠️ 复现 demo 必须使用鸿蒙工程迁移中的胶水代码模板创建工程结构，禁止手动创建目录。**
> 模板路径见 `ENV.md` 的 `OHOS_TEMPLATE_SRC`（即 `<QT_SRC>/qtbase/src/harmonyos/templates`，源码内置）。

```bash
# 从 Qt 源码树复制内置模板到 demo 目录（5.15 / 5.12 源码树内均有，内容相同）
cp -r <QT5_15_SRC>/qtbase/src/harmonyos/templates/. "<demo目标目录>/"
```

解压后将 Qt C++ 源码放入 `entry/src/main/cpp/`，配置 `CMakeLists.txt`、`QtAppConstants.ets` 和 `build-profile.json5`，与迁移工作流一致。

> 详见 [[qt-app-harmonyos-migration]] 阶段 1.2 和 [[qt-harmonyos-project-structure]]。

**每轮迭代只做一步简化**：
1. 优先用现有 Qt Examples 验证（如 Qt 自带的 examples 目录下）
2. 移除与问题无关的 UI 组件、业务逻辑、资源文件
3. 移除第三方依赖，用最小代码替代
4. 简化数据结构和初始化流程
5. 保留能触发问题的最简代码路径

### 1.3 编译验证（迭代修复）

> **⚠️ 门控检查**：demo 必须编译通过后才能进入复现验证。编译不通过的 demo 毫无价值。

```
┌──────────────────────────────────────────────────────────┐
│  编译循环开始                                             │
│  ↓                                                       │
│  执行编译                                                 │
│  ↓                                                       │
│  编译成功？                                               │
│  ├─ 否 ↓                                                 │
│  │  分析编译错误信息                                      │
│  │  ↓                                                     │
│  │  定位根因（缺少头文件/链接库/语法/配置/CMake...）      │
│  │  ↓                                                     │
│  │  修复 → 回到循环开头                                   │
│  └─ 是 → 退出编译循环 ✓                                  │
│                                                           │
│  退出条件：demo 编译成功，生成可部署产物                  │
└──────────────────────────────────────────────────────────┘
```

**常见编译错误分类与修复方向**：

| 错误类型 | 典型错误信息 | 修复方向 |
|----------|------------|---------|
| CMake 找不到 Qt | `find_package(Qt5 ... NOT FOUND)` | 检查 `CMAKE_PREFIX_PATH` 是否指向 Qt OHOS SDK |
| 头文件缺失 | `'QMainWindow' file not found` | 缺少 `find_package` 组件或 `target_link_libraries` |
| 链接错误 | `undefined reference to ...` | 补充链接库（`QOhosPlatformIntegrationPlugin` 等） |
| 交叉编译 find_package | `find_package` 找到主机库而非目标库 | 检查 `CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH` 设置 |
| 鸿蒙模板缺失 | `QtAppConstants.ets` 未找到 | 确认从源码内置模板（`qtbase/src/harmonyos/templates`）正确复制 |
| 库名不匹配 | 运行时加载失败 | `CMakeLists.txt` 中 `add_library` 名必须与 `QtAppConstants.ets` 的 `APP_LIBRARY_NAME` 一致 |

**修复原则**：
- 每次修复只改一个变量，便于确认修复是否生效
- 记录每轮修复的错误信息和解决方案（后续可沉淀到 `problems/` 知识库）
- 如果连续 5 轮仍无法编译通过，暂停并重新审视工程配置（可能模板版本与 SDK 不匹配）

### 1.4 复现成功？

- **否** → 信息不完整或条件缺失，回到 1.1 补充信息，或调整条件：
  - 检查环境差异（Qt 版本、SDK 版本、设备型号）
  - 检查触发条件（特定操作序列、时序、数据状态）
  - 检查依赖项（特定模块、配置、权限）
  - 向用户确认缺失的上下文
- **是** → 进入 1.5 判断是否已最简

### 1.5 还能进一步简化吗？

判断标准：
- 是否还有与问题无关的代码可以移除？
- 是否可以用更简单的 API 或数据结构？
- 是否可以减少依赖的模块数量？
- 复现步骤是否可以更少（目标：3 步以内）？

**还能简化** → 回到 1.2 继续简化
**已是最简** → 退出循环

### 循环退出条件（必须全部满足）

- ✅ 最简 demo 可**稳定复现**问题（非偶发）
- ✅ demo 可**独立编译运行**（不依赖原始工程的其他部分）
- ✅ 复现步骤 **3 步以内**
- ✅ 已移除所有与问题无关的代码

### 循环失败处理（超过 3 轮仍无法复现）

- 记录已尝试的简化路径和失败原因
- 标记为"无法复现"，暂时搁置
- 等待用户提供更多信息或新的复现条件

### 输出物（循环结束后）

- 最小复现 demo（代码 + 编译产物）
- 复现步骤文档（3 步以内）
- 预期 vs 实际对比截图/日志
- 简化过程记录（从原始代码到最简 demo 的演变路径）

> **⚠️ 门控检查**：阶段一未通过退出条件前，**禁止进入阶段二**。没有可靠复现手段的定位是无意义的。

---

## 阶段二：问题定位

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段二完成：问题已定位`

### 2.1 分析 QT 框架代码调用流程

**目标**：沿着 Qt 源码中的调用链，找到问题发生的确切位置。

**Qt 5.15 源码**：`<LOCAL_PATH>`
**Qt 5.12 源码**：`<LOCAL_PATH>`

**分析步骤**：
1. 从 demo 的入口 API 开始，追踪 Qt 源码中的实现
2. 重点关注 `src/plugins/platforms/ohos/` 目录（QPA 插件层）
3. 梳理调用链：`应用层调用 → Qt 封装 → QPA 插件 → 系统接口`
4. 标注每个环节的参数转换、状态变更

**关键目录**（OHOS QPA 插件）：
```
src/plugins/platforms/ohos/
├── qohosintegration.cpp      # 平台集成入口
├── qohoswindow.cpp           # 窗口管理
├── qohosbackingstore.cpp     # 渲染后端
├── qohosinput.cpp            # 输入事件
└── ...
```

### 2.2 在框架内加日志定位问题

**日志策略**：
```cpp
// 在 QPA 插件层的关键路径加日志
qDebug() << "[OHOS] functionName" << "param=" << param << "result=" << result;

// 在系统接口调用前后加日志
qDebug() << "[OHOS] before OH_NativeXxx call, param:" << value;
auto ret = OH_NativeXxx(param);
qDebug() << "[OHOS] after OH_NativeXxx call, ret:" << ret;
```

**日志规范**：
- 统一使用 `[OHOS]` 前缀，便于过滤
- 记录函数名、关键参数、返回值
- 在条件分支处记录走了哪条路径
- 注意日志本身不能影响执行逻辑（避免在关键时序处加 sleep）

**查看日志**：
```bash
hdc shell hilog | grep "\[OHOS\]"
```

### 2.3 验证系统接口表现

**目标**：确认问题是否由系统接口异常导致。

**方法**：
1. 在日志中记录系统接口的输入参数和返回值
2. 对比官方文档中该接口的预期行为
3. 如果系统接口返回异常，单独写测试验证（绕过 Qt，直接调用 N-API / OHOS 系统接口）

**判断标准**：

| 情况 | 结论 | 后续 |
|------|------|------|
| 系统接口返回正常，Qt 行为异常 | Qt 框架问题 | 修复 Qt 代码 |
| 系统接口返回异常 | 系统接口问题 | 记录并向华为反馈 |
| 系统接口返回正常但语义与文档不符 | 系统实现 bug | 对比官方文档确认后反馈 |

---

## 阶段三：根因确认

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` 中该任务的「进展」列 → `阶段三完成：根因已分析`

### 3.1 对比官方接口文档

- 查阅鸿蒙官方文档确认接口预期行为：https://developer.huawei.com/consumer/cn/doc/
- 重点关注：接口版本兼容性、已知限制、废弃 API
- 如果文档描述与实际行为不一致，记录差异

### 3.2 输出分析结论

**结论模板**：
```
问题：[简述]
根因：[具体原因，精确到代码行]
归属：Qt 框架 / 系统接口 / 应用层
修复建议：[方案概述]
相关代码：[文件:行号]
```

---

## 阶段四：上游问题提交（工作流最终步骤）

> **📋 TODO 同步点**：更新 `<LOCAL_TODO>` — 将此任务从「📌 进行中」移至「✅ 已完成」，填写完成日期和结果摘要

> **⚠️ 这是工作流的最终闭合步骤。** 修复验证通过后，必须将成果整理为上游提交包并提交给 Tqtc。
> 未经此步骤闭合的工作流视为**未完成**——即使 bug 已修复、验证已通过，如果不向上游提交，
> 修复将在下个版本被覆盖，且其他团队成员无法得知该问题的存在。

> 当问题修复完成并验证通过后，将修复成果整理为上游提交包。

### 4.1 创建交付目录

> **⚠️ 铁律**：提交给 Tqtc 的交付件**必须包含可复现问题的 demo**。没有复现 demo 的 issue 报告不具备说服力，Tqtc 可能拒绝处理。

在 `${DELIVERABLES_ROOT}/<WORK_DIR>`（见 `ENV.md`）下创建以 bug 名命名的子目录（如 `leave-event-fix`），包含以下交付物：

```
<WORK_DIR>/<bug-name>/
├── ISSUE.md          → 上游 issue 说明单（中英双语）
├── patches/          → git patch 文件（如有修复）
│   └── 0001-*.patch
├── demo/             → ★ 复现 demo（必须包含，禁止省略）
│   ├── OHOS demo/    → 完整鸿蒙工程（可直接编译部署到设备）
│   └── qt-repro/     → 纯 Qt 复现 demo（去除 OHOS 胶水代码，桌面可编译）
└── README.md         → 交付物概览
```

> **为什么必须有复现 demo？**
> 1. Tqtc 上游工程师需要能自行复现问题才会分析和修复
> 2. 纯文字描述容易产生理解偏差，demo 是唯一可靠的复现手段
> 3. 后续回归验证也依赖这个 demo
> 4. 如果问题无法复现，则不应提交 issue——应先排查直到能稳定复现

### 4.2 ISSUE.md 格式

| 章节 | 内容 |
|------|------|
| Issue Summary | 组件/版本/严重度/分支/commit/报告人/日期 |
| Description | 问题现象 + 复现步骤（中英双语） |
| Root Cause | 根因分析（含代码引用） |
| Fix Strategy | 修复策略（含设计决策说明） |
| Files Changed | 涉及文件表（文件/改动类型/说明） |
| Testing | 测试场景和验证结果 |

### 4.3 生成 git patch

```bash
cd <Qt源码>/qtbase
git add -A
git diff --cached -- src/plugins/platforms/ohos/ > patches/0001-<description>.patch
git reset HEAD
```

### 4.4 纯 Qt Demo

- 从 OHOS demo 中提取纯 Qt C++ 代码
- 移除 OHOS ArkTS 胶水代码（ets/、build-profile.json5 等）
- CMakeLists.txt 改为桌面平台可编译的 add_executable
- README 说明如何在桌面编译 + 注明 bug 仅在 OHOS 复现

### 4.5 Patch 清理

> **⚠️ 铁律**：git patch 必须仅包含与当前 bug 修复相关的改动。
> 在生成 patch 之前，必须排除同分支上不相关的改动（其他 bug 的追踪日志、调试代码、实验性功能等）。

**操作步骤**：

1. 确认 Qt 源码中的改动列表：
   ```bash
   cd <Qt源码>/qtbase
   git diff --stat HEAD
   ```

2. 识别并排除不相关的改动文件（常见情况：其他 bug 的 `[OHOS-BUG-TRIAGE]` 日志、`[MDI_RENDER]` 追踪等）

3. 仅对修复相关文件生成 patch：
   ```bash
   git diff HEAD -- <file1> <file2> ... > patches/0001-<description>.patch
   ```

4. 验证 patch 文件列表：
   ```bash
   grep "diff --git" patches/0001-*.patch
   ```

### 4.6 检查清单

- [ ] ★ **复现 demo 已创建**（OHOS 工程 + 纯 Qt demo，均可编译运行）
- [ ] ★ **纯 Qt demo 已生成**，存放在 `<INTERNAL_DEMO><bug-name>-qt/` 路径
- [ ] ISSUE.md 已创建，包含中英双语描述
- [ ] ISSUE.md 中包含复现步骤（引用 demo）
- [ ] **git patch 已生成且已清理**，格式正确，仅含 bug 修复相关改动（如有修复）
- [ ] patch 已通过 `grep "diff --git"` 验证不含无关文件
- [ ] 所有文件已放入 `<WORK_DIR>/<bug-name>/` 目录
- [ ] `<WORK_DIR>/README.md` 已更新（交付件索引表）
- [ ] <LOCAL_TODO> 任务已从「📌 进行中」移至「✅ 已完成」
- [ ] 已提交 git commit
- [ ] 复盘记录已更新（`episodic/postmortems/` 中的对应文件）

### 4.7 工作流闭合

> **完成阶段四 = 工作流完成。** 以下是闭合确认清单：

- [ ] **阶段一**：最简复现 demo 可编译 + 可稳定复现（`<INTERNAL_DEMO><bug-name>/`）
- [ ] **阶段二**：调用链已追踪，根因已定位到具体文件:行号
- [ ] **阶段三**：问题归属已明确（Qt 框架 / 系统 / 应用）
- [ ] **阶段四**：交付件已输出到 `<WORK_DIR>/<bug-name>/`，patch 已清理
- [ ] **知识沉淀**：复盘记录已写入 `episodic/postmortems/`
- [ ] **索引同步**：已运行 `bash _scripts/kb-regen-indexes.sh` 重生 `_index/_map.md` 等派生索引（如有新页面），已提交 git commit

---

## 检查清单

- [ ] 最小复现 demo 已**编译通过**
- [ ] 最小复现 demo 可独立运行
- [ ] 问题调用链已完整梳理
- [ ] 系统接口表现已通过日志验证
- [ ] 根因已定位到具体代码位置
- [ ] 问题归属已明确（Qt / 系统 / 应用）
- [ ] 分析结论已记录
- [ ] 上游 issue 说明单已整理
- [ ] 修复补丁已生成
- [ ] 纯 Qt 复现 demo 已创建

---

## 常见问题模式

| 模式 | 表现 | 排查方向 |
|------|------|----------|
| 窗口不显示 | 黑屏/无渲染 | `qohoswindow.cpp` → XComponent 初始化 |
| 输入不响应 | 点击/触摸无效 | `qohosinput.cpp` → 事件回调注册 |
| 崩溃 | SIGABRT/SIGSEGV | 空指针 / 生命周期时序 / 资源释放 |
| 渲染异常 | 花屏/闪烁 | `qohosbackingstore.cpp` → 缓冲区管理 |
| 接口不生效 | API 调用无效果 | 检查 API 是否在该平台有实现 |

---

## 供应链

| 维度 | 详情 |
|------|------|
| **上游来源** | ① 自驱动（日常测试/代码审查发现的框架异常） ② 商业 Qt 客户直接反馈 ③ 版本发布前的已知问题清单 |
| **上游输入** | bug 描述、复现步骤、日志/截图、Qt 版本和环境信息、原始工程代码（如有） |
| **下游接收方** | **The Qt Company (Tqtc)** 框架团队 |
| **交付件** | `<WORK_DIR>/<bug-name>/`：ISSUE.md + patches/ + demo/ + README.md |
| **交付件路径** | `${DELIVERABLES_ROOT}/<WORK_DIR>`（见 `ENV.md`） |
| **分流规则** | 无（本工作流产出的就是最终交付件，直接提交上游） |

---

## 相关上下文

- [[qt-harmonyos-overview]] — QPA 插件架构理解
- [[qt-harmonyos-build]] — 编译构建（加日志后需重新编译）
- [[qt-harmonyos-api]] — API 兼容性差异
- [[qt-harmonyos-platform-limits]] — 已知平台限制（避免将已知限制误判为 bug）
- [[ohos-common-kb/semantic/harmonyos-development-fundamentals|HarmonyOS 开发基础]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-development-fundamentals.md)）— hdc 工具使用

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 整体文档结构、方法论、调试规范、日志实践、模板、检查清单 |
| 🔍 框架源码 | QPA 插件目录路径（src/plugins/platforms/ohos/）、关键文件名（qohosintegration.cpp、qohoswindow.cpp、qohosbackingstore.cpp、qohosinput.cpp）、调用链架构 |
| 📄 华为官方文档 | HarmonyOS API 文档参考（developer.huawei.com/consumer/cn/doc/）、判断矩阵中系统接口预期行为对比 ([developer.huawei.com](https://developer.huawei.com/consumer/cn/doc/)) |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |

## 参考来源

- 基于个人 Qt 框架调试工作经验开发的工作流，无外部文档来源
- 部分方法论参考 Qt 内部 bug 分析流程（Gerrit 代码审查 + QTBUG 追踪）

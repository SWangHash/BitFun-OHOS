# 鸿蒙特性目录（features）

本目录收录**鸿蒙特有特性**的实施知识：碰一碰、接续、分享、系统托盘类增强等超出"等价移植"范围的系统能力。迁移项目在门控流程第 6 阶段（鸿蒙特性适配）检查 `registry.tsv`，只实现目录中登记的特性。

```
features/
  registry.tsv          # 特性管理文件：所有可用特性的登记表（Agent 的检查入口）
  <feature-id>/
    feature.md          # 该特性的实施 playbook
    snippets/           # 可选：代码片段 / 配置模板
```

## 角色边界

- **维护者**编写并评审特性 playbook、登记 registry、随 skill 版本发布。新增/修改特性是 skill 发布动作，类似上游知识库的维护者刷新。
- **迁移 Agent** 只读：在阶段 6 检查 registry → 用户批准（decisions.tsv）→ 在项目 `feature-adoption.tsv` 采纳并钉版 playbook 哈希 → 展开为 CAP-\*/VAL-\* 行按普通能力切片实现。
- **项目不得实现 registry 之外的特性**。需要未收录特性时记 `blocked` 并申请目录新增，与"知识库缺页阻塞"同策略。

## registry.tsv 列定义

| 列 | 说明 |
|---|---|
| `feature_id` | 稳定 ID，kebab-case，如 `harmonyos-tap-to-transfer` |
| `title` | 中文名称（碰一碰、接续、分享……） |
| `status` | `stable` / `beta` / `draft`；`draft` 不允许被迁移采纳 |
| `playbook_path` | 相对本目录，如 `<feature-id>/feature.md` |
| `requirements` | 前置：Qt 5.15/Qt6、所需 QtOhosExtras API、module.json5 权限/声明、设备能力（NFC 等） |
| `triggers` | 空格分隔的触发关键词，供合同门扫描用户需求 |
| `summary` | 一句话说明 |

## feature.md 编写规范

### frontmatter 与章节骨架

```markdown
---
feature_id: harmonyos-<name>
title: <中文名称>
status: draft | beta | stable
requirements:
  - <QtOhosExtras API / 权限 / 设备能力，每条独立列出>
refs:
  - semantic/<page>.md
---

## 前置条件
## 实施步骤
## 代码模式
## 建议 ledger 行
## 常见陷阱
## 回退方式
```

七个章节缺一不可。下面定义每一节**写什么、写到什么程度算合格、什么样的内容不合格**——判断依据是它的消费位置：playbook 被采纳后，每一段文本都会被流水线上某个台账接住使用。

### 前置条件

- **写什么**：该特性开工前必须成立的每一项证据要求，且每项注明**在哪验证**：QtOhosExtras 某 API 是否存在于所选 Qt SDK（对照 `environment.tsv` 记录的实际 SDK 路径，给出头文件/模块名）、module.json5 需要声明的权限/ability（给出精确字符串）、设备能力（NFC/双机/系统版本）。
- **合格标准**：另一台机器上的 agent 拿着 `environment.tsv` 逐条核对，能明确得出"可开工 / 缺哪项"的结论，不需要再问你。
- **不合格示例**："需要 Qt 5.15 和 NFC"。没有验证途径、没有精确权限串，agent 无法对照任何台账判定。

### 实施步骤

- **写什么**：有序步骤，每步 = 动作 + 精确落点（源文件路径/构建文件/module.json5/ArkTS 胶水）+ 该步产出。步骤顺序即依赖顺序（先声明权限、再写 C++ 守卫代码、再接 UI 入口）。
- **合格标准**：agent 照步骤执行后**不遗漏任何一处改动**——尤其是不显眼的落点：权限声明、CMake 链接、HAP 配置；每一步都能对应到 `changes.tsv` 里的一行修改。
- **不合格示例**："添加碰一碰功能"。无落点、无顺序、无产出，agent 只能自由发挥。

### 代码模式

- **写什么**：完整可编译的代码片段，全部置于 `Q_OS_OHOS`（或 CMake `ohos` scope）守卫内；API 签名、枚举路径必须来自 refs 知识页或 Qt 源码验证，并标注出处；跨 C++/ArkTS 的调用给出两侧代码。
- **合格标准**：实现者**不需要再查任何资料**就能把代码写对；评审人拿 diff 与片段对照即可判断正误。
- **不合格示例**：伪代码、凭记忆写的函数名、没有守卫的全局改动。

### 建议 ledger 行

- **写什么**：建议的 inventory（CAP-\*）行字段值（category、典型 source_location 样式、risk 等级与理由）与 validation（VAL-\*）行（scenario、platform、command_or_steps、expected），以及设备类场景的 device-runs 证据要求。
- **合格标准**：agent 能据此在具体应用里核实后落行——它只是起点，最终行必须绑定该应用真实的源码位置与验证命令。
- **不合格示例**：只写"加一条 CAP 记录"。没有任何字段建议，等于没写。

### 常见陷阱

- **写什么**：每条 = 失败签名（日志关键字、错误码、崩溃栈特征）→ 根因 → 修法。来自真实踩坑（上游 problems/ 页、复盘记录）。
- **合格标准**：构建/运行失败时，agent 拿失败签名来这里**字符串级比对**能直接命中根因与修法，喂给 `diagnostics.tsv` 分类。
- **不合格示例**："注意权限问题"。无签名、无根因、无修法，对排障零价值。

### 回退方式

- **写什么**：摘除/降级的精确清单（删哪些代码块、撤哪些权限声明、还原哪些构建配置）、降级后应用的行为描述、是否需要重打包重签名。
- **合格标准**：按此回退后应用可正常构建、宿主平台行为不变、鸿蒙侧行为变化明确；这条路径会被写进 `report.md` 的 limitations 和 `decisions.tsv` 的降级决策。
- **不合格示例**："移除相关代码"。不可执行，等于没有回退方案。

## 四条编写要求（达标判定与检查位置）

| 要求 | 达标判定 | 在哪被检查 |
|---|---|---|
| **平台隔离** | 所有 C++ 改动给出守卫内写法，明确声明"其他宿主平台零改动" | 评审拓扑将平台守卫列为强制独立评审范围；宿主回归在共享代码修改后重跑 |
| **每特性至少一个 VAL 场景** | 能写出一个"会失败的实验"：可执行步骤 + 可判定期望；设备依赖场景注明 device-runs 要求 | **入库门**：写不出的只能登记 `draft`（不可采纳）；**关闭门**：展开的 VAL 行是 CAP 行关闭唯一依据，`not-run` 不算通过 |
| **引用知识页（refs）** | 每个平台事实落到 upstream-kb/knowledge/ 具体页面；页面必须存在于当前 skill 基线 | `knowledge-usage.tsv` 记录页/节 → 决策引用；引用页打 `used=yes`；缺页 → 特性 blocked 并申请新基线 |
| **只写可验证内容** | 每个行为性声明都能映射到某个 VAL 场景，禁止无法验证的承诺 | VAL 门槛的上游约束；`report.md` 按实际达到的最强证据层交底，未验证的声明不允许出现在结论里 |

## 示例片段（仅示意写法，不注册进 registry）

```markdown
## 前置条件

| 项 | 要求 | 验证途径 |
|---|---|---|
| QtOhosExtras | `QOhosAppContext::startAbility` 存在 | 对照 environment.tsv 的 SDK 路径检查头文件 `QtOhosExtras/...` |
| 权限 | `ohos.permission.NFC`（module.json5） | HAP 包内容检查：package-manifest.tsv |
| 设备 | 两台支持 NFC 的真机 | device-runs.tsv 记录设备型号与系统版本 |

## 常见陷阱

- 签名：`Failed to get ability info` → 根因：module.json5 缺 skills 实体声明 → 修法：按实施步骤 2 补齐 actions/uris。
- 签名：真机点击无反应且日志无 NFC 回调 → 根因：Q_OS_OHOS 守卫外注册监听被宿主分支覆盖 → 修法：按代码模式 3 的守卫写法。
```

## 自查清单（登记 beta/stable 前逐项确认）

1. frontmatter 五项齐全，requirements 每条可独立验证；
2. 七章节齐全，每节达到上文"合格标准"；
3. 至少一个 VAL 场景能明确写"期望什么、怎么判定失败"；
4. refs 指向的页面全部存在于当前 `upstream-kb/knowledge/` 基线；
5. 代码模式全部在平台守卫内，宿主平台零改动；
6. 回退方式执行后应用可构建、宿主行为不变；
7. 通读一遍：每个行为声明都能指出"哪个 VAL 场景验证它"——指不出的删掉或降级为 `draft`。

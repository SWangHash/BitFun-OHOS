**中文** | [English](README.md)

<div align="center">

![BitFun](./png/BitFun_title.png)

### 持续推进，直到完成。

BitFun 是一个开源的跨平台 Agent 工作台：高效稳健的 **Rust Agent Runtime**、可塑的 **Agent Harness**，配合基于 Tauri 的桌面包体，让 Agent 真正替你写代码、修 Bug、查资料、写报告，并做出工作里需要的小工具。

它原生支持 **Windows**、**macOS** 与 **HarmonyOS PC**，并自带鸿蒙宿主、平台桥接与鸿蒙开发工具链。

[官网](https://www.bitfun.work/) | [下载](https://www.openbitfun.com/download) | [参与共建](./CONTRIBUTING_CN.md) | [版本说明](./RELEASE_NOTES.md)

[![Core code: MIT](https://img.shields.io/badge/core_code-MIT-yellow?style=flat-square)](./LICENSE)
[![官网](https://img.shields.io/badge/%E5%AE%98%E7%BD%91-bitfun.work-0b7285?style=flat-square)](https://www.bitfun.work/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20HarmonyOS-blue?style=flat-square)](https://www.bitfun.work/)

</div>

![BitFun 桌面界面](./png/bitfun_desktop.jpg)

## BitFun 能为你做什么

**BitFun 把自然语言变成真正交付的成果。** 一句话指令自动拆解任务、全程执行，写代码、做文档、做调研，以及工作里需要的小工具，都出自同一个地方。

| 场景 | 覆盖范围 |
| --- | --- |
| **代码** | 写代码、跑构建，覆盖编辑、构建、运行、调试与验证，鸿蒙应用开发一站搞定 |
| **办公** | 写文档、做调研、分析数据，高效处理日常工作 |
| **助理** | 记偏好、办任务、持续跟进，越用越懂你 |

产品核心保持与平台无关：Agent Runtime、工具与服务只有一套实现，平台差异只留在确实存在差异的宿主、适配器与服务边界里，各平台都是原生体验，而不是分叉出的另一套产品。细节见[平台可移植性规约](./docs/architecture/platform-portability-design.md)。

## 四种模式，按你的方式工作

**Agent Harness 决定任务如何推进**，负责规划步骤、组织上下文、调用工具、协调多个 Agent 并整合结果。根据当前任务选择适合的协作方式：

![四种工作模式：极简、标准、极致与创造](./png/bitfun-harness-modes.png)

| 模式 | 什么时候选 |
| --- | --- |
| **极简 · Minimal** | **即时协作。** 目标明确、希望快速动手时，AI 直接执行，你随时反馈，在协作中持续调整。 |
| **标准 · Standard** | **日常任务。** 工作需要多个步骤时，有序规划、逐步执行，并检查结果。 |
| **极致 · Ultimate** | **复杂任务。** 问题需要深入分析时，拆解任务，由多个 Agent 分工协作、整合结果。 |
| **创造 · Creative** | **创造与定制。** 想做自己的应用或扩展工作台时，创建 Mini App，定制 BitFun 的界面与功能。 |

## 鸿蒙开发

鸿蒙 PC 是一等目标，而不是附属形态。BitFun 把**鸿蒙 Harness、Skills、工具链与知识库**融合在一起，让应用开发从编辑到构建、运行、调试、验证走通同一条流程。

![BitFun Agent 驱动鸿蒙应用开发：编辑、构建、运行、调试与验证](./png/bitfun-harmonyos-workflow.png)

| 能力 | 说明 |
| --- | --- |
| **鸿蒙应用开发** | 覆盖编辑、构建、运行、调试与验证。`arkts_check` 与 DevEco 命令行工具直接作用于你的工程，内置 `hmos-*` 与 `deveco-cli` 技能承载工具链知识 |
| **QT 迁移专家** | 内置 QT 迁移知识库与 Skill：智能识别 QT API 调用与界面布局，自动生成对应的 ArkTS 实现，让现有 QT 工程平滑迁移到鸿蒙生态 |
| **代码审核专家** | 深度审核 / DeepReview：通过设计审查、测试覆盖与代码审查提升工程水准，从源头化解风险 |

## 多设备协同

**一个账号、多台设备、同一个任务持续推进。** 轻触即可连接鸿蒙 PC 与移动端设备，文件、图片、文本等内容跨设备传送，切换设备也能快速接续。

- **一碰即连**：轻触即可连接鸿蒙 PC 与移动端设备。
- **跨设备传送**：文件、图片、文本便捷传送，减少重复操作。
- **跟进与记忆**：记住你的偏好与工作习惯，代办日常任务、跟进长期事项，并在关键节点主动提醒，让每次协作都从已有上下文继续。

## 一个任务，多个入口

BitFun 不是本地单机应用。工作区、执行任务的运行时、以及驱动它的人，可以分别在不同机器上；以下四种远程场景都是一等目标，而不是事后补充：

![四种远程入口汇聚到同一个 BitFun 宿主会话](./png/bitfun-remote-surfaces.png)

| 场景 | 含义 | 延伸阅读 |
| --- | --- | --- |
| **远程工作区** | 活动工作区位于 SSH 主机、跳板机链或 Docker 容器中，文件、终端、搜索与 Agent 子进程都在目标环境执行 | [remote-workspaces.md](./docs/features/remote-workspaces.md) |
| **远程控制** | 移动 Web 或飞书 / Telegram / 微信机器人，经由 Remote Connect relay 驱动桌面或 CLI 宿主上的会话 | [移动 Web 遥控端](./src/mobile-web/README.md) |
| **Peer Device Mode** | 同账号的一台设备成为另一台的数据面：控制端外壳留在本地，调用与事件来自对端 | [peer-device-mode.md](./docs/architecture/peer-device-mode.md) |
| **Detached Dispatch** | 控制端把持久任务提交到另一台 BitFun 宿主后可以断开；任务、会话、worktree、事件日志与权限信箱都归目标端持有 | [detached-task-dispatch.md](./docs/architecture/detached-task-dispatch.md) |

哪条命令可以在哪里运行，由 [Product Operation Registry](./docs/architecture/remote-surface-contract.md) 统一声明，并由测试兜底，而不是手工维护的清单。

## 许可证

BitFun 通过 GitCode 分发。核心代码采用 [MIT License](./LICENSE)，第三方依赖与资源遵循各自的许可证。漏洞报告方式见[安全策略](./SECURITY_CN.md)。

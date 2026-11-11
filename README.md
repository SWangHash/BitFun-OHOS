[中文](README.zh-CN.md) | **English**

<div align="center">

![BitFun](./png/BitFun_title.png)

### Built to keep going.

BitFun is an open-source, cross-platform Agent workspace. A fast, reliable **Rust Agent Runtime**, a flexible **Agent Harness**, and Tauri-based desktop shells turn agent work into something you can actually get done: write code, fix bugs, research a topic, draft reports, and build the small tools your own work needs.

It runs natively on **Windows**, **macOS**, and **HarmonyOS PC**, with a HarmonyOS host, platform bridges, and a HarmonyOS development toolchain of its own.

[Website](https://www.bitfun.work/) | [Download](https://gitcode.com/OpenBitFun/bitfun_ade/releases) | [Contribute](./CONTRIBUTING.md) | [Release notes](./RELEASE_NOTES.md)

[![Core code: MIT](https://img.shields.io/badge/core_code-MIT-yellow?style=flat-square)](./LICENSE)
[![Website](https://img.shields.io/badge/website-bitfun.work-0b7285?style=flat-square)](https://www.bitfun.work/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20HarmonyOS-blue?style=flat-square)](https://www.bitfun.work/)

## Join the community

Scan the QR code with WeChat to add us and request to join the OpenBitFun community group.

<a href="./png/openbitfun-community-wechat.png">
  <img src="./png/openbitfun-community-wechat.png" alt="WeChat QR code for joining the OpenBitFun community" width="147" />
</a>

</div>

![The BitFun desktop interface](./png/bitfun_desktop.jpg)

## What BitFun can do for you

**BitFun turns natural language into work that actually lands.** One instruction is decomposed into steps and carried out end to end, with AI running the whole way, so code, documents, research, and the small tools your own work needs all come from the same place.

| Scenario | What it covers |
| --- | --- |
| **Code** | Write code, run builds, and ship HarmonyOS apps end to end: edit, build, run, debug, and verify |
| **Work** | Write documents, run research, and analyze data for everyday office tasks |
| **Assist** | Remember preferences, carry out tasks, and keep following up over time |

The product core stays platform-agnostic: the Agent Runtime, tools, and services are one implementation, and platform differences live only in the hosts, adapters, and services that genuinely differ, so each platform gets native behavior without a forked product. The details are in [platform-portability-design.md](./docs/architecture/platform-portability-design.md).

## Four modes for the way you work

**The Agent Harness shapes how a task gets done.** It plans steps, manages context, calls tools, coordinates agents, and brings their results together. Choose the mode that fits the task:

![Four working modes: Minimal, Standard, Ultimate, and Creative](./png/bitfun-harness-modes.png)

| Mode | When to use it |
| --- | --- |
| **Minimal** | **Quick collaboration.** Start with a clear goal. The agent acts directly, you give feedback, and you refine the work together. |
| **Standard** | **Everyday tasks.** For work with several steps: plan the approach, work through it, and check the results. |
| **Ultimate** | **Complex tasks.** Dig into demanding problems, divide the work among agents, and bring their results together. |
| **Creative** | **Creation and customization.** Build Mini Apps or extend BitFun's interface and capabilities to make the workspace your own. |

## HarmonyOS development

HarmonyOS PC is a first-class target, not a side surface. BitFun brings a **HarmonyOS Harness, Skills, toolchain, and knowledge base** together so creating an app is one workflow from edit to build to run, debug, and verify.

![The BitFun agent driving a HarmonyOS app through edit, build, run, debug, and verify](./png/bitfun-harmonyos-workflow.png)

| Capability | What it does |
| --- | --- |
| **HarmonyOS app development** | Edit, build, run, debug, and verify HarmonyOS projects. `arkts_check` and the DevEco command-line tools run against your project, and the built-in `hmos-*` and `deveco-cli` Skills carry the toolchain knowledge |
| **QT migration expert** | Built-in QT migration knowledge base and Skill: it recognizes QT API calls and layout, then generates the matching ArkTS implementation, so an existing QT project moves to HarmonyOS smoothly |
| **Deep Review** | Design review, test coverage, and code review raise engineering quality and catch risk at the source |

## Multi-device collaboration

**One account, several devices, one continuous task.** Lightly tap to connect a HarmonyOS PC with phones and tablets, move files, images, and text across devices, and keep work going as you switch between them.

- **Tap to connect** — a light tap links a HarmonyOS PC with mobile devices.
- **Send across devices** — move files, images, and text without repeating yourself.
- **Follow up and remember** — preferences and work habits are retained, routine tasks are handled, long-running items are tracked, and reminders arrive at the right moment, so every session continues from the context you already have.

## One task, many surfaces

BitFun is not a local-only desktop app. The workspace, the runtime that executes a turn, and the person driving it can each sit on a different machine, and all four remote scenarios below are first-class targets rather than later additions:

![Four remote surfaces converging on one BitFun host session](./png/bitfun-remote-surfaces.png)

| Scenario | What it means | Where to read more |
| --- | --- | --- |
| **Remote workspace** | The active workspace lives on an SSH host, a jump-host chain, or a Docker container; files, terminal, search, and agent subprocesses run there | [remote-workspaces.md](./docs/features/remote-workspaces.md) |
| **Remote control** | Mobile web or a Feishu / Telegram / WeChat bot drives a session on a desktop or CLI host through the Remote Connect relay | [mobile-web](./src/mobile-web/README.md) |
| **Peer Device Mode** | One same-account device becomes the data plane of another: the controller shell stays local, invokes and events come from the peer | [peer-device-mode.md](./docs/architecture/peer-device-mode.md) |
| **Detached Dispatch** | A controller submits a durable job to another BitFun host and may then disconnect; the target owns the job, session, worktree, event log, and permission mailbox | [detached-task-dispatch.md](./docs/architecture/detached-task-dispatch.md) |

Which commands may run where is declared in the [Product Operation Registry](./docs/architecture/remote-surface-contract.md) and enforced by tests, not hand-kept lists.

## License

BitFun is distributed through GitCode. Describe what you need and let the agent build it. Each Mini App pairs a dedicated interface with an agent conversation, so you can use the app for everyday work and keep improving it through chat.

Install and reuse the apps you build, or explore the [Mini App Marketplace](https://market.bitfun.com/miniapp/) for tools that fit your work.

## Extend BitFun with BitFun

**Customize the roles, tools, interface, and source code.** Start with an agent that fits your work, then extend the workspace around it:

- **Build a specialist agent.** Choose a model, define its role, and equip it with the tools and workflows it needs for motion comic production, visual design, code review, or your own field.
- **Connect tools and workflows.** Connect tools through MCP, turn repeatable processes into Skills, and use Hooks to customize how tasks run.
- **Change the interface and source.** Choose a built-in theme, or modify the UI, tools, and runtime source to build your own version of BitFun.

**You can ask BitFun's Code Agent to modify and extend BitFun itself.**

Learn more about [agent management](./docs/interactive-capabilities/capabilities/feature.agents.md), [Hooks and compatibility](./docs/features/agent-hooks.md), and the [product architecture](./docs/architecture/product-architecture.md).

## Built for sustained work

The Rust Agent Runtime manages session state, context, and tool execution. Persistent sessions, interruption recovery, long-term memory, and support for extended tasks help keep work moving. Context compression and cache reuse help control resource consumption over longer runs.

In this **DeepSWE v1.1** evaluation, BitFun achieved:

- **GLM-5.3-Flash**: **64.6%** pass rate, **42.9 minutes** median runtime (P50).
- **DeepSeek-V4-Flash**: **56.6%** pass rate, **19.6 minutes** median runtime (P50).

![DeepSWE v1.1 comparison: pass rate, runtime P50, and token P50](./png/openbitfun-deepswe-v1.1.png)

## More to explore

**These are just some of BitFun's features.** Explore more tools, workflows, and extensions as you put it to work on your own tasks.

![A selection of BitFun's features](./png/openbitfun-feature-wall.jpg)

## Where we're headed

BitFun is still evolving. Here are three directions we want to explore:

- **Lights-Out Factory**: Plan and design during the day, let tasks continue on a server, and come back the next morning to review the results.
- **Infinite Radius**: Extend from desktops and phones to wearables and embedded devices, so work can continue in more places.
- **App Evolution**: Enable more people to shape software, from personal tools to versions tailored to a profession or industry.

Getting there means making long-running tasks more reliable, the runtime more efficient, and the desktop experience smoother.

## Build with it. Help shape it.

**Share what you build, offer feedback, or contribute code to help shape BitFun.**

Share your use cases and experience, contribute agents, Skills, or Mini Apps, or help improve the docs, interface, and runtime. Ideas and questions are welcome in this repository's Issues and Discussions. See the [contribution guide](./CONTRIBUTING.md) for the development workflow.

<details>
<summary>Download, setup, and running from source</summary>

Get the Windows, macOS, or Linux package from the [official download page](https://bitfun.com/download). Install it, configure a model, and open a workspace to get started. See the [user guide](https://playbook.bitfun.com) for usage instructions and [download verification](./docs/verify-downloads.md) for package signature checks.

**Migration note:** BitFun 1.0.0 is not data-compatible with legacy 0.2.x releases. To migrate legacy data,
use the [BitFun Data Tools](src/apps/data-tools/README.md), currently available
for stable releases 0.2.17–0.2.19.

To run from source, install [Node.js](https://nodejs.org/) 22.12+, [pnpm](https://pnpm.io/) 10.15.0, the [Rust toolchain](https://rustup.rs/), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Clone the repository, then run:

```bash
pnpm install
pnpm run desktop:dev
```

Desktop development supports frontend hot reload and automatic Rust rebuilds. See the [CLI guide](./src/apps/cli/README.md) for the command-line workflow.

</details>

Core code is licensed under the [MIT License](./LICENSE); third-party dependencies and assets retain their own licenses. BitFun is distributed through GitCode. Thanks to the open-source authors and contributors who make this work possible. To report a vulnerability, see the [security policy](./SECURITY.md).

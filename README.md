[中文](README.zh-CN.md) | **English**

<div align="center">

![BitFun](./png/BitFun_title.png)

### Built to keep going.

BitFun is an open-source, cross-platform Agent workspace. A fast, reliable **Rust Agent Runtime**, a flexible **Agent Harness**, and Tauri-based desktop shells turn agent work into something you can actually get done: write code, fix bugs, research a topic, draft reports, and build the small tools your own work needs.

It runs natively on **Windows**, **macOS**, and **HarmonyOS PC**, with a HarmonyOS host, platform bridges, and a HarmonyOS development toolchain of its own.

[Website](https://www.bitfun.work/) | [Contribute](./CONTRIBUTING.md) | [Release notes](./RELEASE_NOTES.md) | [Product architecture](./docs/architecture/product-architecture.md)

[![Core code: MIT](https://img.shields.io/badge/core_code-MIT-yellow?style=flat-square)](./LICENSE)
[![Website](https://img.shields.io/badge/website-bitfun.work-0b7285?style=flat-square)](https://www.bitfun.work/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20HarmonyOS-blue?style=flat-square)](https://www.bitfun.work/)

</div>

![The BitFun desktop interface](./png/bitfun_desktop.jpg)

## Platform support

BitFun runs on **Windows**, **macOS**, and **HarmonyOS PC**. The product core stays platform-agnostic: the Agent Runtime, tools, and services are one implementation, and platform differences live only in the host, adapters, and services that genuinely differ, so each platform gets native behavior without a forked product.

Platform boundaries and HarmonyOS design facts live in [platform-portability-design.md](./docs/architecture/platform-portability-design.md). Coverage is described per capability, not per platform name.

## Code, work, and assist

**BitFun turns natural language into work that actually lands.** One instruction is decomposed into steps and carried out end to end, with AI running the whole way, so code, documents, research, and the small tools your own work needs all come from the same place.

| Scenario | What it covers |
| --- | --- |
| **Code** | Write code, run builds, and ship HarmonyOS apps end to end: edit, build, run, debug, and verify |
| **Work** | Write documents, run research, and analyze data for everyday office tasks |
| **Assist** | Remember preferences, carry out tasks, and keep following up over time |

## HarmonyOS development

HarmonyOS PC is a first-class target, not a side surface. BitFun brings a **HarmonyOS Harness, Skills, toolchain, and knowledge base** together so creating an app is one workflow from edit to build to run, debug, and verify.

![BitFun building a HarmonyOS app and the running app](./png/bitfun-harmonyos-dev.png)

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

## Four modes for the way you work

**The Agent Harness shapes how a task gets done.** It plans steps, manages context, calls tools, coordinates agents, and brings their results together. Harness ids are constrained by the shared contract at `src/shared/agent-harness/contract.json`; choose the mode that fits the task:

![Four working modes: Minimal, Standard, Ultimate, and Creative](./png/bitfun-harness-modes.png)

| Mode | When to use it |
| --- | --- |
| **Minimal** | **Quick collaboration.** Start with a clear goal. The agent acts directly, you give feedback, and you refine the work together. |
| **Standard** | **Everyday tasks.** For work with several steps: plan the approach, work through it, and check the results. |
| **Ultimate** | **Complex tasks.** Dig into demanding problems, divide the work among agents, and bring their results together. |
| **Creative** | **Creation and customization.** Build Mini Apps or extend BitFun's interface and capabilities to make the workspace your own. |

## One task, many surfaces

BitFun is not a local-only desktop app. The workspace, the runtime that executes a turn, and the person driving it can each sit on a different machine. Four remote scenarios are first-class targets rather than later additions:

| Scenario | What it means | Design entry point |
| --- | --- | --- |
| **Remote workspace** | The active workspace lives on an SSH host, a jump-host chain, or a Docker container; files, terminal, search, and agent subprocesses run there | [remote-workspace-transport.md](./docs/architecture/remote-workspace-transport.md), [remote-workspaces.md](./docs/features/remote-workspaces.md) |
| **Remote control** | Mobile web or a Feishu / Telegram / WeChat bot drives a session on a desktop or CLI host through the Remote Connect relay | [src/mobile-web/README.md](./src/mobile-web/README.md), [relay-server](./src/apps/relay-server/README.md) |
| **Peer Device Mode** | One same-account device becomes the data plane of another: the controller shell stays local, invokes and events come from the peer | [peer-device-mode.md](./docs/architecture/peer-device-mode.md) |
| **Detached Dispatch** | A controller submits a durable job to another BitFun host and may then disconnect; the target owns the job, session, worktree, event log, and permission mailbox | [detached-task-dispatch.md](./docs/architecture/detached-task-dispatch.md) |

Which commands may run where is not a set of hand-kept lists: every registered product command declares its stance in the Product Operation Registry, and the desktop closure test and capability generator fail on undocumented commands. See [remote-surface-contract.md](./docs/architecture/remote-surface-contract.md).

## HarmonyOS PC surfaces

| Surface | Path | What it is |
| --- | --- | --- |
| **HarmonyOS host (HAP)** | `src/apps/ohos` | The ArkTS host and platform bridges. `EntryAbility.ets` loads the ArkTS-embedded Rust library `libbitfun_desktop_lib.so` through `@ohos-rs/ability` and renders the reused Web UI; window chrome, status bar tray, share, voice input, screen capture, credential storage, and app update are bridged here. |
| **Desktop integration** | `src/apps/desktop` | Shared Tauri host. OHOS-only commands and bridges live under `src/api/ohos/` behind `target_env = "ohos"` gates. |
| **HarmonyOS mobile controller** | `src/apps/mobile/harmonyos` | Phone, foldable, and tablet remote controller for a desktop or CLI host. It runs no Agent Runtime and stores no model configuration; it signs in with GitHub, selects a device, and sends tasks. |

The shared core deliberately drops desktop-only native dependencies on this target: the OHOS build uses `lzma-rs` instead of the C-backed `xz2`, links `napi-ohos`, and injects an ArkTS-backed credential vault instead of the D-Bus `system-vault`.

## Turn everyday needs into useful apps

Build a Git insights panel for a repository, a workspace for presentations, or a form that brings routine actions together. **Mini Apps turn specific needs into tools you can use.** Describe what you need and let the agent build it; each Mini App pairs a dedicated interface with an agent conversation.

An HAP build also packages the bundled MiniApps (`src/apps/mobile/harmonyos/miniapps`) into generated raw resources. Those pages run locally in ArkWeb without signing in, pairing, a desktop connection, or internet access, and their storage and clipboard writes stay on the device.

## Extend BitFun with BitFun

**Customize the roles, tools, interface, and source code.** Start with an agent that fits your work, then extend the workspace around it:

- **Build a specialist agent.** Choose a model, define its role, and equip it with the tools and workflows it needs for code review, HarmonyOS development, visual design, or your own field.
- **Connect tools and workflows.** Connect tools through MCP, turn repeatable processes into Skills, and use Hooks to customize how tasks run.
- **Change the interface and source.** Install appearance packages for a new look, or modify the UI, tools, and runtime source to build your own version of BitFun.

**You can ask BitFun's Code Agent to modify and extend BitFun itself.** Learn more about [agent management](./docs/interactive-capabilities/capabilities/feature.agents.md), [Hooks and compatibility](./docs/features/agent-hooks.md), and the [product architecture](./docs/architecture/product-architecture.md).

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/apps` | Product hosts and entrypoints: `desktop`, `cli`, `ohos`, `mobile`, `relay-server`, `server`, `sdk-host`, `extension-host`, `data-migrator`, and the market servers |
| `src/crates` | Rust layers: `contracts` -> `execution` -> `services` -> `adapters` -> `assembly` -> `interfaces` |
| `src/web-ui`, `src/mobile-web`, `src/shared` | React Web UI, mobile web remote control, and shared generated contracts |
| `src/crates/assembly/core/builtin_skills` | Built-in Skills, including the HarmonyOS development bundle |
| `design-system`, `website`, `sdk`, `extensions`, `packages` | Design system, Playbook site, TypeScript SDK slice, and ecosystem bridges |
| `deploy`, `products`, `tests/e2e`, `docs` | Deployment runbooks, product definitions, E2E tests, and architecture and feature docs |

Layer ownership, dependency direction, and boundary rules are defined in [AGENTS.md](./AGENTS.md) and [product-architecture.md](./docs/architecture/product-architecture.md).

## Where we're headed

BitFun is still evolving. Here are three directions we want to explore:

- **Lights-Out Factory**: Plan and design during the day, let tasks continue on a server, and come back the next morning to review the results.
- **Infinite Radius**: Extend from desktops and phones to wearables and embedded devices, so work can continue in more places.
- **App Evolution**: Enable more people to shape software, from personal tools to versions tailored to a profession or industry.

Getting there means making long-running tasks more reliable, the runtime more efficient, and the desktop experience smoother.

## Optional legacy data migration

Data migration is optional and uses a **separately downloaded BitFun Data Migrator**. It runs independently and is not bundled with or launched by the main application. See the [download, compatibility and recovery guide](src/apps/data-migrator/README.md).

## Download and install

**Fully open-source HarmonyOS Agentic IDE. Install it and put the agent to work on real engineering tasks.**

| Platform | Requirement | Download |
| --- | --- | --- |
| **Windows** | Windows 10 / 11 | [Windows build](https://www.openbitfun.com/download) |
| **macOS** | macOS 13 or later | [macOS build](https://www.openbitfun.com/download) |
| **HarmonyOS** | HarmonyOS 5 or later | [AppGallery](https://appgallery.huawei.com/app/detail?id=com.develop.opensource.ohpcd.bitfun) |

See the [official site](https://www.bitfun.work/) for the full product overview and download page.

## Build with it. Help shape it.

**Share what you build, offer feedback, or contribute code to help shape what comes next.**

Share your use cases and experience, contribute agents, Skills, Mini Apps, or appearance packages, or help improve the docs, interface, and runtime. Ideas and questions are welcome in this repository's Issues and Discussions. See the [contribution guide](./CONTRIBUTING.md) for the development workflow, and [RELEASE_NOTES.md](./RELEASE_NOTES.md) for what landed in each HarmonyOS PC version.

<details>
<summary>Development setup</summary>

To run from source, install [Node.js](https://nodejs.org/) 22.12+, [pnpm](https://pnpm.io/) 10.15.0, the [Rust toolchain](https://rustup.rs/), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Clone the repository, then run:

```bash
pnpm install
pnpm run desktop:dev
```

Desktop development supports frontend hot reload and automatic Rust rebuilds. When a build fails with confusing resource or download errors, run `pnpm run check:build-prereqs` to identify missing prerequisites. See the [CLI guide](./src/apps/cli/README.md) for the command-line workflow and [src/apps/ohos/AGENTS.md](./src/apps/ohos/AGENTS.md) for the HarmonyOS host.

</details>

BitFun is distributed through GitCode. Core code is licensed under the [MIT License](./LICENSE); third-party dependencies and assets retain their own licenses. To report a vulnerability, see the [security policy](./SECURITY.md).

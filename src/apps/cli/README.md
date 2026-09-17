# BitFun CLI

BitFun CLI provides an interactive terminal UI, non-interactive Agent runs,
session management, and machine-owned background tasks. The executable and
command name is `bitfun`.

## Install

From the repository root:

```bash
pnpm run cli:install
```

The installer builds and installs the `bitfun` entrypoint for the current
platform. The default install directory is `~/.local/bin` on macOS/Linux and
`%LOCALAPPDATA%\BitFun\bin` on Windows. Open a new terminal after installation
so the updated `PATH` is visible.

Official release archives contain the same `bitfun` executable.

Prerequisites for a source install are a Rust toolchain and this repository.
See the repository [contribution guide](../../../CONTRIBUTING.md) for development
setup and build commands.

## Quick start

```bash
bitfun                                  # interactive TUI
bitfun exec "summarize this project"   # one non-interactive Agent run
bitfun exec "run tests" --auto         # approve interactive tool asks for this run
bitfun sessions list
bitfun doctor
```

The interactive TUI asks before protected Agent tool calls. Non-interactive
`exec` rejects permission requests by default; use `--auto` only when the
current invocation may approve them.

Run `bitfun --help` or `bitfun <command> --help` for the complete command and
option reference.

## Interactive TUI

The most frequently used commands follow established OpenCode names where an
equivalent exists:

| Input | Effect |
| --- | --- |
| `/sessions` | Browse and restore sessions. |
| `/new` or `/clear` | Start a new session. |
| `/timeline` | Navigate persisted user messages without changing the session. |
| `/fork` | Fork the full session or fork immediately before a selected prompt. |
| `/compact` or `/summarize` | Compact model context without deleting the saved transcript. |
| `/undo` / `/redo` | Move the persisted session timeline backward or forward. |
| `/diff` | Review staged, unstaged, and untracked workspace changes. |
| `/editor` | Edit the current draft with `VISUAL`, then `EDITOR`. |
| `/copy` / `/export` | Copy or export the visible transcript as Markdown. |
| `/status` / `/usage` | Inspect current-session status or cumulative usage. |
| `/reload [skills\|instructions]` | Refresh declarative context for the next message. |

The command palette and shortcut help show the bindings active in the current
configuration. The OpenCode-compatible **View subagents** palette action has no
slash alias or default shortcut. It opens the current conversation's child
Session tree without replacing the root Session or its draft. The selected
transcript is read-only: use `Up` for its parent, `Left`/`Right` for siblings,
`Esc` for the root conversation, and the normal interrupt action to cancel the
selected child Session's active execution subtree.

`/editor` does not install or guess an editor. For GUI editors,
configure a command that waits until the file is closed; missing commands,
non-zero exits, and empty editor output leave the current draft unchanged.

### Prompt continuity

Unsent drafts stay with their session while the TUI remains open. Switching,
creating, or forking a session swaps the existing composer state, including
structured `@` references, image attachments, and Shell/Chat mode, instead of
putting UI drafts into Runtime session persistence.

The command palette also follows OpenCode's prompt-stash entrypoints: **Stash
prompt**, **Stash pop**, and **Stash list**. They intentionally have no slash
aliases or default key bindings. Stashes are shared across CLI processes in a
bounded `prompt-stash.jsonl` file and preserve text plus structured workspace
references. Image drafts are rejected with an explicit message because the
persistent stash does not copy image bytes. When a stash is restored from a
different workspace, its text is kept but structured references are detached
with a visible warning so a relative path cannot silently bind another file.

### Terminal notifications

Terminal attention notifications are off by default. Enable them in the CLI
config when completed turns, failures, permission requests, and question
prompts should emit a terminal notification:

```toml
[ui]
notifications = true
notification_method = "auto" # auto, osc9, or bel
```

`auto` uses OSC 9 for terminals known to support it and falls back to the
terminal bell. Notification text is bounded and strips terminal control
characters.

### Shell mode

With an empty composer, type `!` to enter **SHELL** mode, matching OpenCode's
entry flow. The `!` marker becomes the input label and is not part of the
command. Press `Esc`, or press `Backspace` while the command is empty, to return
to chat mode. Shell and chat keep separate input histories.

Press Enter to run the command in the session workspace. Shell mode is
non-interactive: it does not allocate a PTY and does not accept image or
structured `@` attachments. A leading `/` is shell text, not an BitFun slash
command. The command uses the shared Agent Runtime, normal `ExecCommand` tool,
workspace binding, cancellation, audit, and static permission rules. Because
the command was explicitly typed by the user, an interactive `ask` is approved
without a second prompt; a configured `deny` still blocks execution.

The command and tool result are saved as a standard turn. Restoring the session
therefore shows the same tool card in CLI and Desktop instead of a CLI-only
transcript item.

### Image attachments

In Embedded TUI, use the configured paste action (`Ctrl+V` by default) or
terminal bracketed paste to attach a clipboard image or a local PNG, JPEG, GIF,
or WebP path. Quoted paths, `file://` URLs, and POSIX shell-escaped paths are
accepted. A message may contain up to five images, each no larger than 20 MiB.

A primary model with image input support receives the image pixels directly.
With a text-only primary model, configure an enabled image-understanding model
and keep the `analyze_image` tool enabled for the agent. The host saves uploaded
images as durable runtime attachments so analysis and restored turns can read
them; image handling also applies when this CLI hosts mobile or peer sessions.

Images are read when pasted, so later file changes do not alter the submitted
turn and local absolute paths are not sent to the Runtime. Slash commands and
Shell mode do not accept images. Shared TUI currently reports image paste as
unsupported and keeps the draft unchanged.

### Shared TUI

```bash
bitfun chat --shared
```

Shared TUI lets multiple terminal processes reuse one workspace Runtime. Each
TUI controls at most one session and a session has one controller. Core chat,
Shell mode, session navigation, read-only subagent transcript inspection,
model/mode selection, permissions, and transcript events use the same behavior
as Embedded TUI. Some local management and attachment capabilities remain
Embedded-only and report that limitation instead of silently falling back.

Exit all Shared TUI clients and wait briefly before returning to the default
Embedded mode for the same workspace.

## Non-interactive output

Select output with `--output-format text|json|stream-json`:

| Format | stdout contract |
| --- | --- |
| `text` | Final Assistant text. Progress and diagnostics use stderr. |
| `json` | One final result object, including session/turn identity and usage when available. |
| `stream-json` | JSONL containing existing Agent events. |

`Ctrl+C` requests cancellation of the active turn. Session writer conflicts,
unsuccessful completion, an invalid event stream, and requested Patch failures
produce a non-zero result instead of reporting partial success.

## Other command groups

```bash
bitfun agents --help
bitfun models --help
bitfun mcp --help
bitfun plugins --help
bitfun hooks --help
bitfun config --help
bitfun acp --help
bitfun server --help
```

`bitfun mcp import` is an explicit preview/apply snapshot. It does not copy
credentials, headers, environment values, or explicit working directories, and
new native entries remain disabled until reviewed.

### Persistent tasks

`bitfun dispatch` is the machine-readable target-side interface used by other
BitFun surfaces. Jobs remain owned by this machine after the submitting client
disconnects. Controllers should call `dispatch probe` and honor the returned
protocol version before submitting or inspecting jobs. See the
[detached task architecture](../../../docs/architecture/detached-task-dispatch.md)
for the transport and workspace-snapshot contract.

The `remote` approval policy lets a controller answer pending tool permissions.
Interactive questions from `AskUserQuestion` are unavailable for dispatch jobs;
provide required task choices in the prompt instead of waiting for a question.

### App server

`bitfun server` starts the BitFun App Server surface over stdio. stdout carries
JSON-RPC traffic only, so an App Server client (for example an editor
integration) can connect by spawning this command; logs go to stderr. The
server scope is the current directory, matching the CLI's cwd-only session
scope, and reuses the CLI product runtime. Host management capabilities
(models, skills, subagents, hooks, and external sources) are served from the
local configuration; account sync, MCP management, and local worktree
management are reported as unavailable by this host.

The server is a reviewed stdio Server Host with an explicit method allowlist
(read-only session, agent, permission, workspace, git, config, and i18n
methods plus management catalogs; state-changing config, model, MCP, account,
worktree, and hook mutations are not served). Frames are limited to 16 MiB and
the limit is enforced at the stdin reader. stdin EOF is a deterministic
disconnect: the Host cancels in-flight turns and exits. `app/initialize`
advertises only the methods this Host actually serves.

### Publishing Pages

After `/login`, Standard and Claw sessions can use `PagePublish` to save page
content and optionally publish it, and `PageDeploy` to deploy or roll back to a
saved version. The tools appear only while the executing CLI Runtime has an
account session. Existing tool permissions still apply; unattended `exec` and
dispatch runs use their configured approval policy.

The CLI restores its saved account session at startup, including for `exec` and
Shared Runtime hosts. Shared TUI account login remains unsupported: sign in
through an embedded TUI before starting the Shared Runtime. Login changes in a
separate process require restarting the executing Runtime.

Inline files work without a local workspace. Directory uploads read only a
local workspace on the executing host; remote workspace directory uploads are
rejected, so supply inline files instead. Publishing returns production and
preview URLs; private pages still require account access in the browser. The
CLI does not add a Pages management screen or Peer HostInvoke page commands.

### Always-on account device host

After signing in with `/login`, a server can keep its account device route
online without an interactive TUI:

```bash
bitfun daemon install
bitfun daemon status
```

Linux uses a systemd user service and macOS uses a LaunchAgent. Windows does not
currently install an auto-start service; use `bitfun daemon run` under a
supervisor instead. Run `bitfun daemon --help` for lifecycle commands and
platform diagnostics.

## Updates and troubleshooting

```bash
bitfun update --check
bitfun update
bitfun doctor
bitfun health
```

Official Linux archive installations perform a small, rate-limited update check
before interactive startup. Set `behavior.auto_update = false` in CLI config or
`BITFUN_CLI_DISABLE_AUTO_UPDATE=1` to disable it. Stable updates verify the
published checksum and, in official builds, the compiled release signing key
before replacing either entrypoint.

Use `doctor` for product/runtime assembly diagnostics and `health` for required
capability registration. They do not claim that external Network, Git, or MCP
services are currently reachable.

Account sign-in opens the shared BitFun page, where you can choose GitHub or
an email verification code. Email sign-in creates an independent account without
a password; it does not link to a GitHub account. Use the same method and account
on every device you want to connect. A terminal without a browser can display the
authorization URL for opening on another device.

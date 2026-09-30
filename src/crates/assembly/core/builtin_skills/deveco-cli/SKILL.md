---
name: deveco-cli
description: >-
  **MUST** use 'devecocli' for HarmonyOS apps (scaffold, build, run, debug, devices, logs, docs, 鸿蒙开发文档, skills, multi-preview). **REQUIRED** and **MANDATORY** if workspace has build-profile.json5 or oh-package.json5, or user mentions HarmonyOS, 鸿蒙, DevEco, ArkTS, ArkUI, docs, 鸿蒙文档, 知识, 搜索, skills, or preview/预览/预览器/多预览器/多设备预览器.
---

# DevEco CLI

`devecocli` wraps DevEco Studio's `hvigor`, `ohpm`, `hdc`, and HarmonyOS-skills installer. **Prefer `devecocli` over invoking underlying tools directly.**

**Do NOT use these legacy commands** — use the `devecocli` equivalent instead:
- ❌ `deveco preview` / `hvigorw preview` → ✅ `devecocli run --device <product-name>` (launches DevEco Studio previewer; product name in `--device` triggers previewer mode)
- ❌ `hvigorw` directly → ✅ `devecocli build`
- ❌ `hdc` directly (when a `devecocli` wrapper exists) → ✅ `devecocli device` / `devecocli log`; for device install + launch use the **`start_app` tool**, not `devecocli run` (see below)
  - **BitFun override — device install + launch**: `devecocli run` drives devices through DevEco Studio's own bundled `hdc`, which BitFun must NOT use. Run code on a device/emulator with the **`start_app` tool** instead; it uses BitFun's own `hdc`. Use `devecocli run --device <product-name>` only for the DevEco Studio previewer (no device/hdc involved).

Available commands: `build`, `check`, `run`, `update`, `device`, `ui`, `skills`, `log`, `create`, `init`, `serve`, `docs`, `signature`, `auth`.

**Platform awareness**: On HarmonyOS native PC (2in1), **emulator commands are NOT available** and must never be suggested. The `emulator` command does not exist on this platform. When `device list` shows no devices, instead of suggesting emulator startup, tell the user to:
1. Enable wireless debugging in Settings → System → Developer options → Wireless debugging
2. Note the port number
3. Run `hdc tconn 127.0.0.1:<port>`

**Sandbox Rule**: Commands tagged `[Outside sandbox]` must be run outside the sandbox.

## 1. Code → Build → Deploy → Run → Debug

### `devecocli create`
Scaffold a new HarmonyOS project.
- `--app-name <name>` (Req): 1–200 chars, `^[a-zA-Z][a-zA-Z0-9_]*$`
- `--project-path <path>`: Final project root. Auto-created if omitted (`./<app-name>`) or missing, and populated if empty. A non-empty target returns `PROJECT_EXISTS` unless `--merge` is supplied.
- `--bundle-name <bundle>`: Default `com.example.<appname-lowercase>`. 7–128 chars, ≥3 segments.
- `--api-level <level>`: int ≥17 (default: auto or 23).
- `--merge` allows a non-empty target while preserving existing content. Generated paths are checked before the target changes, and no existing file is overwritten.
- `PROJECT_EXISTS` (exit 2): use `--merge` only if the existing directory is intended to become the project root. Otherwise ask whether to overwrite, rename, or cancel. Never clear the reported `details.targetRoot` without explicit confirmation.
- `PROJECT_FILE_CONFLICT` (exit 2): report `details.conflicts` and ask the user to rename those paths, choose another root, or cancel. No existing files were changed; never overwrite the conflicts automatically.
*Ex*: `devecocli create --app-name MyApp --project-path ./CustomDir --api-level 23`

### `devecocli build` `[Outside sandbox]`
Compile and package project/modules. (Defaults: `--product default`, `--build-mode debug`)
| Goal | Command |
|---|---|
| Single-module / single-`entry` | `devecocli build` |
| Specific modules | `devecocli build --modules <m1> <m2>@<target>` |
| Whole product bundle (.app) | `devecocli build --product <name>` |
| Clean build outputs | `devecocli build clean` |

If build output is truncated, the complete log is saved at the path shown after `Full output saved to:`.

### `devecocli check lint`
Run DevEco Code Linter checks for TS/ArkTS code.
- **Studio requirement**: Default lint checks and `--fix`, `--incremental`, `--product`, `--config-path`, and `--limit` support DevEco Studio `>= 6.0.0`; explicitly using `--format` or `--output-path` requires DevEco Studio `>= 6.1.0`. Command Line Tools mode follows the CLT `>= 26.0.0` baseline.
- `[path]`: File or directory to lint. Defaults to the project root from `build-profile.json5`, otherwise the current directory.
- Options: `--config-path <file>`, `--fix`, `--incremental`, `--product <name>`, `--format <default|json>`, `--output-path <path>`, `--limit <number>`.
- Set `DEVECO_CLI_CLT_PATH` to the Command Line Tools root when DevEco Studio is not installed; CLT is not discovered automatically from PATH or default installation directories.

### `devecocli emulator`
Manage local emulator instances and system images. **On HarmonyOS native PC (2in1) this command is NOT available — see Platform awareness above.**
- **Studio requirement**: DevEco Studio `>= 6.1.0`.
- `list`: Show instances (status, serial, device type). Opt: `--format <table|json>` (default: `table`).
- `start <names...>`: Start instances. Quote names with spaces. (See Troubleshooting if blocked.)
- `stop <names...>`: Stop by name or serial (`127.0.0.1:<port>`).
- Scene control commands require Emulator 7.0 or later. Use `DEVECO_CLI_DEBUG=1` to inspect the underlying `Emulator` command mapping.
- `shake` / `power` / `rotate <left|right>` / `volume <up|down>` (Req: `--target <nameOrSerial>`): Basic emulator controls.
- `fold <state>` (Req: `--target <nameOrSerial>`): Set foldable display state, matched against the target emulator's reported `deviceType`. `foldable` uses `open|half-open|close`; `2in1_foldable` uses `open|vertical-open|half-open|close`; `triplefold` uses `single|double|triple` or one of its six left/right folded-state combinations. Other device types and cross-device states are rejected before execution.
- `battery` (Req: `--target`; one of `--level <0-100>` or `--status <charging|discharging>`): Set battery state. `--level` checks the current emulator charging state automatically (`0-100` while charging, `1-100` otherwise).
- `geolocation` (Req: `--target`; one of `--longitude`, `--latitude`, `--altitude`, `--direction`): Inject GPS data.
- `scene <outdoorRunning|outdoorCycling|drivingNavigation>` (Req: `--target`): Start motion simulation.
- `sensor` (Req: `--target`; one of `--light-intensity`, `--humidity`, `--temperature`, `--steps`, `--heartrate`): Inject sensor data.
- `create <name>` (Req: `--device-type`, `--os-version`): Create instance. Optional: `--force`.
- `delete <name>`: Delete instance.
- `image list`: List downloaded images. Opts: `--device-type <type>`, `--all`, `--format <table|json>`.
- `image download` / `image remove` (Req: `--device-type`, `--os-version`): Download/remove image. (Takes 30+ min, set long timeout.)
*Device types*: `phone`, `foldable`, `widefold`, `triplefold`, `tablet`, `2in1`, `2in1 foldable`, `wearable`, `tv`.

### `devecocli docs`
Search/read local HarmonyOS docs.
- `search <keywords...>`: Match any keyword. Opts: `--catalog <name>`, `--format <default|json>`, `--limit <n>`.
- `read <documentId>`: Read full content by ID (e.g. `devecocli docs read 开发指南/冷启动_Launch分析/Launch模板基本操作/ide-insight-session-launch`).
- `catalog`: List available catalogs.

### `devecocli device`
- `list`: Show active real devices.
- `view`: Detailed info. Req `-t <name|serial>` on multi-device hosts.

### `devecocli run` `[Outside sandbox]`
Build, install, and launch.

> **BitFun override — do NOT use `devecocli run` to install + launch on a device/emulator.** BitFun must not use DevEco Studio's bundled `hdc`. Use the **`start_app` tool** for on-device run: it locates the built `.hap`, reads `bundleName`, and installs + launches through BitFun's own `hdc` (`hdc` fallback is built in). Reserve `devecocli run` for the **DevEco Studio previewer** only: `devecocli run --device <product-name>` (the product name in `--device` triggers previewer mode). `devecocli build` is unaffected and still preferred.

- `--module <module>`: Target module (auto-selected if only one runnable).
- `--device <name|serial>`: Target device (Req if multiple connected).
- `--product <product>` / `--build-mode <mode>`: Defaults: `default` / `debug`.
- `--ability <ability>`: Default from `module.json5`.
- `--uninstall`: Uninstall existing app first (Fixes signing key issues).
- `--skip-build`: Deploy existing artifacts.
- `--apply <fileName>`: **Fast incremental deploy** — rebuilds only changed files into a signed hqf, installs via `bm quickfix -a -f -o`, then restarts the app. Much faster than a full `devecocli run` for iterating on code changes. Modules are auto-detected from the file paths in `<fileName>` (no `--module` needed).
  - `<fileName>`: a plain file name (no path separators) under the project's `.hvigor/` directory; the caller writes the changed-file list there. File name is sanitized to prevent path traversal. Content: list of **source file paths changed this round** (one per line, relative to project root or absolute; `#` comments and blank lines ignored; typically `.ets`/`.ts`/`.cpp`/resource files). The changeFileList is **incrementally merged** — only list files changed since the last apply; previously listed files are retained automatically.
  - **Prereq**: run `devecocli run` once first (full build + deploy + generates the `buildConfig.json` cache that `--apply` reuses).
  - **If changes don't take effect**: check `<module>/build/config/buildConfig.json` has content — empty/missing means `devecocli run` wasn't run; on any apply failure, fall back to a full `devecocli run`.
*Ex*: `devecocli run` → edit code → write `.hvigor/changes.txt` → `devecocli run --apply changes.txt`
- **Previewer mode**: Pass a product name to `--device` to launch the DevEco Studio previewer. If `--device` matches a connected real device (name or serial), it takes priority over previewer mode — check device names with `devecocli device list`.
  - Single Previewer: `devecocli run --device "Pura 90 Pro"`
  - Multi Previewer: `devecocli run --device "Pura 90 Pro,MatePad 11.5'S"`
  - Prerequisites:
    1. Device connected: enable wireless debugging (Settings → System → Developer options → Wireless debugging) and run `hdc tconn 127.0.0.1:<port>` (or set `DEVECO_HDC_PORT=<port>` env var).
    2. DevEco Studio running (CLI throws if not — does NOT auto-start).
  - Supported products: `Pura 90 Pro`, `MatePad 11.5'S`, `Mate X7`, `Pura X`, `Mate XT`. Aliases: `phone`, `pad`/`tablet`, `fold`/`foldable`.

### `devecocli signature generate` `[Outside sandbox]`
Auto-generate HarmonyOS signing materials (local p12/csr + cloud cert + test profile) and write signing config to `build-profile.json5`.
- **Prereq**: `devecocli auth login` first; run from a project directory (with `build-profile.json5`); a connected device is required for device registration. Device registration drives the device through DevEco Studio's bundled `hdc`; if that `hdc` cannot see the device, register the device another way (DevEco Studio UI) and keep the generated materials rather than switching device transport.
- `--product <name>`: Product name for local p12/csr file naming (default: `default`).
- `--team-id <id>`: Specify the team-id (default: current user's id).
- `--force`: Force regenerate even if existing materials are valid.
- Generates under `~/.ohos/config/`: `.p12` keystore, `.csr`, downloaded `.cer` certificate, `.p7b` profile.
- Writes `signingConfigs` + `products` entries to `build-profile.json5` with encrypted key/store passwords (AES-128-GCM).
- Cloud cert name: `auto_debug_<teamId>.cer`. Local files: `<product>_<project>_<hash>=.{p12,csr,cer,p7b}`.
- Error handling: 401→re-login, 403→no AGC permission, `205389872`→cert limit, `205389904`→not Harmony user, `205389938`→provision limit, invalid `.cer`→retry.
*Ex*: `devecocli signature generate --product default`

### `devecocli log`
Fetch hilog or crash logs. Req `--device <name|serial>` on multi-device hosts.
- `--crash`: Dump crash logs.
- `--level D|I|W|E|F`: Filter by level.
- `--bundle-name` / `--keyword`: Filter output.
- `--from <start>` / `--to <end>`: Relative offsets (`30s`, `5m`).
- `--tail <num>` / `--follow`: Keep last N lines / stream real-time (no `--to`).
*Ex*: `devecocli log --crash --bundle-name com.example.app`, `devecocli log --level E --from 5m --tail 200`

### `devecocli ui`
Inspect UI on a connected device. All subcommands accept `--device <name|serial>` (Req on multi-device hosts).

| Subcommand | Description | Key Options |
|---|---|---|
| `layout` | Dump ArkUI accessibility layout tree — **visible area only** (on-screen nodes) | `--id <id>`, `--window <windowId>`, `--all-windows`, `--depth <n>` (0=unlimited, 1=root only, 2=root+children), `--format default\|json`, `--mode full\|simplified` |
| `window list` | List active windows | `--format default\|json`, `--all` (include system windows) |
| `screenshot` | Capture a screenshot of the device screen | `--display <displayId>`, required `--path <path>` (existing directory or PNG file path; relative paths supported; writable destination; no overwrite) |
| `click [x] [y]` | Tap at the specified coordinates or node | `--id <id>` (auto-resolves to center), `--window <windowId>` (used with `--id`) |
| `doubleclick [x] [y]` | Double-tap at the specified coordinates or node | `--id <id>`, `--window <windowId>` |
| `longclick [x] [y]` | Long-press at the specified coordinates or node | `--id <id>`, `--window <windowId>` |
| `swipe <x1> <y1> <x2> <y2>` | Swipe from one point to another (precise coordinates, custom speed) | `--speed <n>` (200–40000, px/s) |
| `fling <x1> <y1> <x2> <y2>` | Fling from one point to another | `--speed <n>` (200–40000, px/s) |
| `drag <x1> <y1> <x2> <y2>` | Drag from one point to another | `--speed <n>` (200–40000, px/s) |
| `dircfling <direction>` | Quick directional fling (system default speed, ideal for scrolling) | `direction`: `up`, `down`, `left`, `right` |
| `text <text> [x] [y]` | Input text at a target location or the currently focused field | `--id <id>` (auto-resolves to center), `--window <windowId>` (used with `--id`) |

- **Coordinates vs `--id`**: Mutually exclusive. Provide either `x y` or `--id <id>`. For `text`, if neither is given, text goes to the currently focused field.
- **`--window`**: May only be used together with `--id`. Default is focused window. Secondary display operations via `--id` + `--window` are not supported.
- **`swipe` vs `dircfling`**: `swipe` requires exact start/end coordinates and supports `--speed`; `dircfling` only needs a direction (`up/down/left/right`) and uses system default speed (ideal for page/list scrolling).
- **Text encoding**: Special characters in `text` are Base64-encoded internally to safely pass through device shell.
- `--format json` pairs well with `jq`.
- `--mode full`: full layout tree, no filtering.
- `--mode simplified` (default): folds meaningless wrapper containers (non-root, no `id`, no text, not interactive) by lifting their surviving children up. `--depth` truncates after folding.

## 2. Setup

### `devecocli init`
MUTUALLY EXCLUSIVE modes for setup:
1. `--skill` (Default): Install `deveco-cli` skill to AI agents.
2. `--mcp`: Configure `deveco-mcp` server (ArkTS/C++ syntax checking).
*Options*:
- `--agent <agents>`: Comma-separated (e.g. `opencode,cursor`). Omitting targets all.
- `--project <path>`: Project-level config (Abs path for MCP).
- `--path <path>`: Direct skill install path.
- `-f, --force`: Overwrite existing config.
*MCP Rules*: Global MCP (no `--project`) only supports `opencode` and `cursor`. Others require `--project`.

### `devecocli auth login`
Sign in to your Huawei Developer account. Required before `signature generate`. Starts a local OAuth callback server, prints the authorization URL, and waits for the browser callback.
- **If it opens a browser** (desktop): complete the sign-in there; the CLI detects the callback automatically.
- **If it cannot open a browser** (HarmonyOS native PC and other hosts without a desktop browser handler): the command reports the failure and **prints the authorization URL**. It keeps polling while the callback server stays open.
  - Read that URL from the command output and open it for the user with the **`OpenUrl` tool** (`{ "url": "<printed URL>" }`). `OpenUrl` prefers BitFun's built-in browser panel, so the user can sign in without leaving the app.
  - The URL is dynamic (it embeds a per-run `port` and `code`); open the exact URL that was printed. If it expired, re-run `devecocli auth login` and use the new URL.
  - Do **not** kill the `auth login` process while the user signs in — its callback server must stay up to capture the redirect. Wait for it to report success, then verify with `devecocli auth status`.
*Ex*: `devecocli auth login`

### `devecocli auth logout`
Sign out and clear locally stored credentials.

### `devecocli auth status`
Show the current logged-in user.

### `devecocli auth team list`
List team accounts the current user has joined.

### `devecocli skills`
Manage HarmonyOS skills in AI agents/projects.
- `list [-l|--long]` / `find <keyword>`: List or search skills.
- `add (--all | --skill <name>) [--agent <a,b…>] [--project <path>] [--path <path>] [-f]`: Install.
- `remove --skill <name> [...]`: Uninstall.

### `devecocli check compat` `[Outside sandbox]`
Scan source code for breaking API changes between two SDK versions. Built on DevEco Studio's `arkanalyzer-apiscan` plugin.
- `versions`: List available target SDK versions. Opts: `--format <default|json>` (default: `default`).
- Default (no args): project-level scan.
- `--modules <m1> [m2...]`: Module-level scan.
- `<file1> [file2...]`: File-level scan (`.ets`/`.c`/`.cpp` only).
- `--source-version <v>` (Req) / `--target-version <v>` (Req): SDK version pair. Run `devecocli check compat versions` first; on zsh, **quote the value**.
- `--format <default|csv|json>`: Console output accepts `default` (text) or `json`; file output (via `--output-path`) accepts `default` (csv), `csv`, or `json`. `csv` requires `--output-path`.
- `--output-path <path>`: Directory (writes `apiChange-*.csv`/`apiChange-*.json`) or explicit file (extension must match `--format`).
- `--limit <n>` (default `100`): Max records shown on console when no `--output-path`.
*Ex*: `devecocli check compat --source-version "<source_version>" --target-version "<target_version>" --output-path ./report`

## 3. Maintenance

- **`devecocli update`** `[Outside sandbox]`: Update CLI to latest version.
- **`devecocli serve mcp`**: Host stdio MCP server (`check` tool for `.ets`/C/C++). Used via `init --mcp`. (Env: `PROJECT_PATH`, `DEVECO_PATH`, `NODE_MAX_OLD_SPACE_SIZE`, `DEBUG=1`).

## Recipes

- **Fresh checkout to real device**:
  `devecocli build` -> `start_app` tool (lists devices, then installs + launches via BitFun's own `hdc`)
- **Launch previewer**: `devecocli run --device "Pura 90 Pro"` (single) or `devecocli run --device "Pura 90 Pro,Mate XT"` (multi).
- **Diagnose crash**:
  `devecocli log --crash --bundle-name <bundle>`
- **Release build**:
  `devecocli build --product oversea --build-mode release`
- **First-time signing setup**:
  `devecocli auth login` -> `devecocli signature generate --product default` -> `devecocli build` -> `start_app`

## Troubleshooting

- **"Product / Build mode `<x>` not found"**: Check `build-profile.json5`.
- **"Multiple entry modules" / "No entry module"**: Pass `--modules` (build) or `--module` (run).
- **"No active devices" / "Multiple devices connected"**: Connect a real device (or self-connect via wireless debugging on HarmonyOS native PC). Pass `-t <serial>` (device view) or `--device <name|serial>` (run/log).
- **`error:install sign info inconsistent`**: Signing key changed. Regenerate materials (`devecocli signature generate --force`) or uninstall the existing app on the device via BitFun's own `hdc` (`hdc uninstall <bundleName>`), then re-run `start_app`.
- **`Not logged in. Run devecocli auth login first`**: Run `devecocli auth login` to authenticate. If the host cannot open a browser, it prints the authorization URL — open that URL with the `OpenUrl` tool and let the user sign in.
- **`auth login` did not open a browser**, and the terminal/built-in browser shows the sign-in page but nothing happens**: the printed URL is per-run. Cover the whole flow without restarting: open the exact printed URL via `OpenUrl`, keep the `auth login` command running until it reports success, then re-check with `devecocli auth status`.
- **`Provision number exceeds limit`**: Test provision quota is full. Delete old test provisions in DevEco Studio (Signing Configs) or AGC console, then retry `devecocli signature generate`.
- **`Invalid AccessToken. Sign in and try again`**: Token expired. Run `devecocli auth login` again.
- **`skills add` agent not found**: Valid: `codebuddy`, `cursor`, `opencode`, `qoder`, `trae-cn`.
- **`emulator start` / `image download` blocked on agreement**: User MUST accept agreements. Interactive: `devecocli emulator license` (requires TTY). Non-interactive (CI/scripts): `devecocli emulator license accept`. Ask the user to review and accept; run the non-interactive acceptance only if explicitly authorized. Do not retry until accepted.
- **`image download` failure / timeout**: Do NOT auto-retry. Give the command to the user to run manually in their terminal.
- **`emulator create` timeout**: Treat as a user-action step. Ask the user to open DevEco Studio → Device Manager. Check `emulator list` after the user confirms. Do NOT auto-retry or edit SDK files.
- **`image list` duplicate OS rows**: `phone`/`foldable`/`widefold`/`triplefold` share the same image. Download/remove ONCE per OS version.
- **`ui layout` missing expected node**: `layout` only returns on-screen nodes. Scroll the target into view with `ui dircfling` / `ui swipe` when appropriate, or ask the user to scroll, then retry `ui layout`.
- **HarmonyOS native (2in1 PC) — `hdc list targets` shows `[Empty]`**: hdc on HarmonyOS does NOT auto-discover the local device. Open "Settings → System → Developer options → Wireless debugging", note the port, then `hdc tconn 127.0.0.1:<port>`. For normal run: pass `--device 127.0.0.1:<port>`. For previewer mode: set `DEVECO_HDC_PORT=<port>` env var (previewer mode uses `--device` for product name, not hdc target).
- **Previewer — "DevEco Studio is not running"**: Tell the user to start DevEco Studio manually first, then retry. Do NOT retry automatically.

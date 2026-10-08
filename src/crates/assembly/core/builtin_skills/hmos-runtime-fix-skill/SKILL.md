---
name: hmos-runtime-fix-skill
description: Load for ArkTS/JavaScript jscrash, runtime crash, uncaught exception, stack trace, faultlog, or hilog diagnosis. Also load when the app 闪退/崩溃/白屏, exits after 点击/启动/launch, or build succeeds but runtime fails (no compile error). Use before broad Read/Glob on crash-only tasks.
---

# Harmony JSCrash Fixes

Use this skill to diagnose and fix ArkTS or JavaScript runtime crashes with minimal edits.

Use `devecocli` for device discovery and log acquisition. Use this skill's private Node scripts under `skills/hmos-runtime-fix-skill/scripts/` only to parse evidence or save a hilog snapshot.

If `node` is unavailable, stop and explain that the private scripts cannot run.

## When To Load

Load this skill when the issue looks like one of these:

- Runtime logs show `TypeError`, `ReferenceError`, `RangeError`, `SyntaxError`, `BusinessError`, or similar exceptions.
- The app exits, flashes back, or white-screens during launch or after a tap.
- The user provides a `jscrash` log, stack trace, or a temporary log file with `@file`.
- Build succeeds, but runtime behavior fails immediately.

## Core Approach

Prefer a concrete crash anchor before broad code exploration. A good anchor can come from:

- a provided crash log
- a stack trace
- a clear page or module named by the user
- a recent device-side faultlog or hilog when no better evidence is available

Avoid broad `Read` / `Glob` / `Explore` across the whole project until you have at least one concrete anchor such as:

- `error_type`
- `error_message`
- `suspected_file`
- `top_stack`
- or a clearly named crash entry point from the user

Do not over-collect logs. If the user already gave enough crash evidence, parse that evidence first and move into focused reading and minimal fixes.

## CLI And Script Contract

Run `devecocli` through Shell. Do not call `hdc`, read `DEVECO_HOME`, or use DevEco Code-specific device/log tools directly.

### Private Node scripts

Run the private scripts through Shell like this:

```bash
node "{SKILL_DIR}/scripts/<script>.mjs" ...
```

`{SKILL_DIR}` is the absolute path of this skill directory at runtime.

Scripts print stable `key: value` text to stdout. A non-zero exit code means the current step could not continue and the agent should report the reason instead of guessing.

## Preferred Flows

### Case A: The user already provided raw crash text

```bash
node "{SKILL_DIR}/scripts/jscrash-report.mjs" --log-text "{crashLog}" --bundle-name "{bundleName}" --include-text
```

### Case B: The user provided `@file` or a local log path

```bash
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{logFilePath}" --bundle-name "{bundleName}" --include-text
```

### Case C: The user only described symptoms and did not provide logs

Log collection is optional here. Use it when you still need a concrete runtime anchor.

Before collecting device evidence:

1. Read `AppScope/app.json5` and take the exact `app.bundleName` value (for example `com.example.hmos.sample`). Use that string as `{bundleName}` in every script below.
2. Do not guess `bundleName` from `vendor`, module folder names, or prefixes such as `com.example`.
3. Resolve the target device:
   - If the user provided a `deviceId`, use it for every device-side command.
   - If no `deviceId` is provided, run `devecocli device list` first.
   - If exactly one device is connected, use that device.
   - If multiple devices are connected, ask the user which device to inspect. Do not collect logs until the user selects a device.
   - If no devices are connected, report that device-side evidence cannot be collected and ask for a connected device or a local crash log.

After the user reproduces the crash on the selected device, fetch and parse the latest matching crash log:

```bash
node "{SKILL_DIR}/scripts/jscrash-report.mjs" --bundle-name "{bundleName}" --device-id "{deviceId}" --include-text
```

With no `--log-text` or `--log-file`, `jscrash-report.mjs` runs `devecocli log --crash --device ... --bundle-name ...` and parses its output. If no matching crash is returned, ask the user to reproduce and retry immediately; do not guess from symptoms alone.

If the crash log is unavailable or insufficient, fall back to hilog. The collector runs `devecocli log --device ... --tail ...` and only handles the local snapshot file itself:

```bash
node "{SKILL_DIR}/scripts/collect-hilog.mjs" --device-id "{deviceId}" --lines "4000" --output-dir "{tempDir}"
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{hilogPathFromCollect}" --bundle-name "{bundleName}" --source hilog --include-text
```

## Output Contract

The leading `key: value` block from `jscrash-report.mjs` and `parse-jscrash-log.mjs` includes:

- `status`: `detected` | `no_crash_signature` | `parse_failed`
- `source`: `file` | `text` | `hilog` and similar sources
- `error_type`
- `error_message`
- `suspected_file`
- `top_stack`: `|`-joined frames
- `keywords`: comma-separated
- `next_action`

`--include-text` appends a human-readable summary after the structured block.

If `status: no_crash_signature`, explain that the evidence is weak and ask for a better log, clearer repro, or an additional runtime clue before broad code reading.

## JSCrash Fix Knowledge Base

Knowledge source (synced): [hmos-jscrash-analysis](https://gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills/tree/main/03-solutions/quality/stability/hmos-jscrash-analysis).

After parsing crash evidence and obtaining `error_type`, match patterns from the knowledge base and apply the corresponding fix. Do not invent root causes or fixes outside these references.

### Using the Fix Knowledge Base

1. Parse crash evidence with scripts to obtain `error_type`, `error_message`, and `top_stack`.
2. Read [reference/fault-mode-library.md](./reference/fault-mode-library.md) first. Match `JSError` → secondary cause → tertiary cause using `Reason` / `Error name` / `Error message`.
3. Based on `error_type`, read only the corresponding patterns file:
   - `ReferenceError` → [reference/referenceerror_patterns.md](./reference/referenceerror_patterns.md)
   - `TypeError` → [reference/typeerror_patterns.md](./reference/typeerror_patterns.md)
   - `Error` → [reference/error_patterns.md](./reference/error_patterns.md)
   - `BusinessError` → [reference/businesserror_patterns.md](./reference/businesserror_patterns.md)
   - `SyntaxError` → [reference/syntaxerror_patterns.md](./reference/syntaxerror_patterns.md)
   - `RangeError` → [reference/rangeerror_patterns.md](./reference/rangeerror_patterns.md)
   - `OutOfMemoryError` → [reference/outofmemoryerror_patterns.md](./reference/outofmemoryerror_patterns.md)
   - `URIError` → [reference/urierror_patterns.md](./reference/urierror_patterns.md)
4. When multiple patterns match, prefer the one supported by `Error message` + `Error code` + top application stack frame simultaneously (see credibility rules in each reference file).
5. Apply a minimal fix to the suspected file from the stack. Do not refactor broadly.

### Quick Reference

| Error type / message keyword | Root cause | Reference |
|---|---|---|
| ReferenceError + `@Provide` / `@Consume` | Missing or duplicate @Provide/@Consume | [referenceerror_patterns.md](./reference/referenceerror_patterns.md) |
| ReferenceError + `is not initialized` | Variable used before assignment | [referenceerror_patterns.md](./reference/referenceerror_patterns.md) |
| ReferenceError + `<name> is not defined` | Variable scope or import missing | [fault-mode-library.md](./reference/fault-mode-library.md) |
| ReferenceError + `super()` before `this` | super() not called before this | [fault-mode-library.md](./reference/fault-mode-library.md) |
| TypeError + `Cannot read property` / `null or undefined` | Accessing property on undefined/null | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `is not callable` | Calling a non-function value | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `circular structure` | Circular reference in JSON.stringify | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `Receiver is not a JSObject` / N-API scope | N-API receiver type mismatch | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| SyntaxError + `Unexpected Text in JSON` / `Invalid Token` | Malformed JSON.parse input | [syntaxerror_patterns.md](./reference/syntaxerror_patterns.md) |
| RangeError + `Invalid array length` | Negative or non-integer array length | [rangeerror_patterns.md](./reference/rangeerror_patterns.md) |
| RangeError + `Stack overflow` | Unbounded recursion | [rangeerror_patterns.md](./reference/rangeerror_patterns.md) |
| URIError + `DecodeURI: invalid character` | Malformed URI in decodeURI | [urierror_patterns.md](./reference/urierror_patterns.md) |
| Error + `UI execution context not found` / `100001` | UI context not bound to router | [error_patterns.md](./reference/error_patterns.md) |
| Error + `WebviewController must be associated` / `17100001` | WebviewController not linked to Web component | [error_patterns.md](./reference/error_patterns.md) |
| Error + `ForEach id` / id generator | ForEach keyGenerator missing or invalid | [error_patterns.md](./reference/error_patterns.md) |
| Error + `ArrayBuffer is null or detached` | Using detached ArrayBuffer | [fault-mode-library.md](./reference/fault-mode-library.md) |
| Error + `Map's constructor cannot be directly invoked` | ArkTS Map constructor misuse | [fault-mode-library.md](./reference/fault-mode-library.md) |
| Error + SQLite / RDB / resource ID / window state | DB handle, resource ID, or window API misuse | [error_patterns.md](./reference/error_patterns.md) |
| BusinessError + `Parameter error` / URL / JSON / XML | Invalid API parameter type or value | [businesserror_patterns.md](./reference/businesserror_patterns.md) |
| OutOfMemoryError + allocate / leak | Heap allocation failure or memory leak | [outofmemoryerror_patterns.md](./reference/outofmemoryerror_patterns.md) |
| TerminationError + `Terminate execution!` | Forced termination by runtime | [fault-mode-library.md](./reference/fault-mode-library.md) |
| AggregateError + `Promise.any()` all rejected | All promises in Promise.any() rejected | [fault-mode-library.md](./reference/fault-mode-library.md) |

## Interpretation Rules

- Prefer application frames over framework noise.
- Treat the first concrete `.ets`, `.ts`, or `.js` path as the starting point, not the final truth.
- If the user gave repro steps, trust them over a simplistic stack-only guess.
- If the stack points to a non-entry page, assume an interaction-triggered path unless evidence proves a cold-start crash.
- Do not refactor broadly. Fix the crash path first.

## Conversational Shape

1. Say what evidence you already have.
2. If logs are missing, say whether you are using a crash log or hilog to get a better anchor.
3. Once you have an anchor, switch into focused code reading and minimal fixing.

## Constraints

- Never claim a crash fix from prompt reasoning alone.
- Never replace a root-cause fix with retries, arbitrary delays, or broad defensive rewrites.
- If unfamiliar `@ohos.*` or `@kit.*` APIs are involved, check their constraints before editing.
- This skill does not decide the final compile / run / verification order; the primary agent owns that.

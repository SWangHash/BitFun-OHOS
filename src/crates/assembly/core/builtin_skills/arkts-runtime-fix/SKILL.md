---
name: arkts-runtime-fix
description: Load for ArkTS/JavaScript jscrash, runtime crash, uncaught exception, stack trace, faultlog, or hilog diagnosis. Also load when the app 闪退/崩溃/白屏, exits after 点击/启动/launch, or build succeeds but runtime fails (no compile error). Use before broad Read/Glob on crash-only tasks.
---

# Harmony JSCrash Fixes

Use this skill to diagnose and fix ArkTS or JavaScript runtime crashes with minimal edits.

Use this skill's private Node scripts under `skills/arkts-runtime-fix/scripts/` to parse crash evidence, inspect recent faultlogger entries, or collect hilog when no better evidence is available. Use the `references/` error-pattern knowledge base below to map a signature to its root cause once you have a crash anchor.

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

## Tool And Script Contract

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
   - If no `deviceId` is provided, prefer Bash `devecocli device list` first.
   - If exactly one device is connected, use that device.
   - If multiple devices are connected, ask the user which device to inspect. Do not probe faultlogger, fetch faultlog, or collect hilog until the user selects a device.
   - If no devices are connected, report that device-side evidence cannot be collected and ask for a connected device or a local crash log.

After the user reproduces the crash on the selected device, inspect recent faultlogger evidence:

```bash
node "{SKILL_DIR}/scripts/probe-faultlogger.mjs" --bundle-name "{bundleName}" --device-id "{deviceId}" --max-age-minutes "30" --limit "10"
```

If `status: found`, fetch and parse the latest faultlog:

```bash
node "{SKILL_DIR}/scripts/fetch-faultlog.mjs" --faultlog-name "{latestFaultlog}" --device-id "{deviceId}" --output-dir "{tempDir}"
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{localFaultlogPath}" --bundle-name "{bundleName}" --source file --include-text
```

If `status: not_found`, do not broad-read the project or guess from symptoms alone. Ask the user to reproduce the crash on the selected device, then probe faultlogger again immediately.

If faultlogger is unavailable, the reproduced crash still does not create a matching faultlog, or the parsed faultlog is still not enough, fall back to a `devecocli log`

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

## Common Crash Signatures

Map the parsed signal to a root cause, then confirm it against the `references/` file before editing. Match on `Error message` + `Error code` + the top application stack frame together; a single weak signal is not enough.

| Error type / message keyword | Root cause | Reference |
|---|---|---|
| `ReferenceError` + `@Provide` / `@Consume` | Missing or duplicate @Provide/@Consume | `references/referenceerror_patterns.md` |
| `ReferenceError` + `is not initialized` | Variable used before assignment | `references/referenceerror_patterns.md` |
| `ReferenceError` + `<name> is not defined` | Variable scope or import missing | `references/fault-mode-library.md` |
| `TypeError` + `Cannot read property` / `null or undefined` | Accessing a property on undefined/null during render or lifecycle | `references/typeerror_patterns.md` |
| `TypeError` + `is not callable` | Calling a non-function value | `references/typeerror_patterns.md` |
| `TypeError` + `circular structure` | Circular reference in JSON.stringify | `references/typeerror_patterns.md` |
| `SyntaxError` + `Unexpected Text in JSON` / `Invalid Token` | Malformed JSON.parse input | `references/syntaxerror_patterns.md` |
| `RangeError` + `Invalid array length` / `Stack overflow` | Bad index/array length or unbounded recursion | `references/rangeerror_patterns.md` |
| `URIError` + `DecodeURI: invalid character` | Malformed URI passed to decodeURI | `references/urierror_patterns.md` |
| `Error` + `UI execution context not found` / `100001` | UI context not bound; use `Navigation` or `UIContext.getRouter()` | `references/error_patterns.md` |
| `Error` + `WebviewController must be associated` / `17100001` | WebviewController not linked to a Web component | `references/error_patterns.md` |
| `Error` + `ForEach id` / id generator | `ForEach` keyGenerator missing or invalid | `references/error_patterns.md` |
| `Error` + SQLite / RDB / resource ID / window state | DB handle, resource ID, or window API misuse | `references/error_patterns.md` |
| `BusinessError` + `Parameter error` / URL / JSON / XML | Invalid API parameter type or value | `references/businesserror_patterns.md` |
| `OutOfMemoryError` + allocate / leak | Heap allocation failure or memory leak | `references/outofmemoryerror_patterns.md` |
| `TerminationError` / `AggregateError` / `ArrayBuffer` detached | Runtime lifecycle and ArkTS collection/type traps | `references/fault-mode-library.md` |

## Error Pattern Knowledge Base

Read the matching file under `references/` (relative to this skill directory) before applying a fix. Each file lists a pattern matrix plus credibility rules so you can confirm the hit instead of pattern-matching on a single keyword:

| File | Covers |
|---|---|
| `references/typeerror_patterns.md` | TypeError: null/undefined access, not callable, circular reference, N-API receiver |
| `references/referenceerror_patterns.md` | ReferenceError: @Provide/@Consume, uninitialized variable |
| `references/syntaxerror_patterns.md` | SyntaxError: malformed JSON.parse input |
| `references/rangeerror_patterns.md` | RangeError: invalid array length, stack overflow |
| `references/urierror_patterns.md` | URIError: malformed URI in decodeURI |
| `references/error_patterns.md` | Framework/API Error: UI context, WebviewController, ForEach, SQLite/RDB, resource ID, window state |
| `references/businesserror_patterns.md` | BusinessError: invalid API parameters (URL/JSON/XML, permission, call timing) |
| `references/outofmemoryerror_patterns.md` | OutOfMemoryError: heap allocation failure or leak |
| `references/fault-mode-library.md` | Cross-cutting ArkTS traps: N-API, ArrayBuffer, Map constructor, TerminationError, AggregateError |

Step order once you have a crash anchor:

1. Pick the candidate file from `error_type`.
2. Confirm using `Error message` + `Error code` + top application stack frame together.
3. Apply a minimal fix to the suspected file from the stack. Do not refactor broadly.

## Interpretation Rules

- Prefer application frames over framework noise.
- Treat the first concrete `.ets`, `.ts`, or `.js` path as the starting point, not the final truth.
- If the user gave repro steps, trust them over a simplistic stack-only guess.
- If the stack points to a non-entry page, assume an interaction-triggered path unless evidence proves a cold-start crash.
- Do not refactor broadly. Fix the crash path first.

## Conversational Shape

1. Say what evidence you already have.
2. If logs are missing, say whether you are using a crash log (faultlog) or hilog to get a better anchor.
3. Once you have an anchor, switch into focused code reading and minimal fixing.

## Constraints

- Never claim a crash fix from prompt reasoning alone.
- Never replace a root-cause fix with retries, arbitrary delays, or broad defensive rewrites.
- If unfamiliar `@ohos.*` or `@kit.*` APIs are involved, check their constraints before editing.
- This skill does not decide the final compile / run / verification order; the primary agent owns that.

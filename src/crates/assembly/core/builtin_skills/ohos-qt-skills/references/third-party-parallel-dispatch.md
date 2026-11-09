# Third-party parallel dispatch

How third-party dependency work (judgment, fetch, cross-compile) is split
across subagents. The input is the closure `closure.py` produces in the
inventory phase (sequence, re-ingest guard and outputs: `closure.py --help`).
Dependencies are never judged from greps, formula listings or hand-run
`brew info`/`brew search`; a closure produced without the ingested data source
is not evidence.

Dispatch is a speed-up of work the migration does anyway: it changes *who*
executes each item (a parallel subagent instead of the main conversation),
never *which* items exist or how they are decided.

## Whether to dispatch

`closure.py` prints each trigger with its raw count, source and verdict
(`DISPATCH` or `single`; the thresholds live in `closure.py`), and stores them
in `closure/summary.json` `triggers`. Each trigger counts a different unit,
always taken from the closure output, never from the library list:

| Trigger | Counts |
|---|---|
| judgment | `analyze` `blockers` + `unknowns` rows (platform-interface blockers such as ALSA, PulseAudio, X11 included); two libraries can carry five blockers |
| fetch | real-run `cmd_only` + `failed` rows whose artifact lands in a per-library directory; subtract shared-prefix rows by hand and say so |
| cross-compile | `need_port` rows + `failed` rows that retry and URL check could not recover |

- The real `fetch-deps` run decides: a dry run reports every downloadable row
  as `would_download` and never `failed`. It lands in the inventory phase,
  never later.
- `DISPATCH` means forced dispatch; "should"/"can" readings do not apply.
- Also with `single`, write the candidate list with a per-item rationale and
  record each trigger's raw count with its source in the closure INV row's `cause`, for
  example `judgment = analyze.blockers(3) + analyze.unknowns(0)`.
- A todo item keeps the gate meaning ("third-party stage: artifacts + per-item
  judgment of blockers/unknowns"), never just "obtain dependency artifacts".
- Mechanical work (bottles `downloaded` by the CLI) and judgment work are
  counted separately.
- After a context compaction, recheck judgment conclusions taken from the
  summary (`[tool output]` versus `[judgment - recheck]`).

## What can run in parallel

1. Mutually disjoint read-only work: parallel (judgment, `Explore`).
2. Write work with non-overlapping artifact directories: parallel (fetch,
   cross-compile).
3. Work that writes the same directory or file: main agent only, for example
   flattening `.pc` files into one pkgconfig directory, generating a single
   `ohos-deps.cmake`, or `brew install a b c` into one shared prefix.

## Per scenario

- **Judgment:** exactly the closure's blocked and unknown rows, no extra
  items. Blocked items: guard evidence (an unconditional hit on a core path is
  a hard blocker; a macro or file-level exclusion is an optional branch).
  Unknown items: the `fetch-ohos-third-party-lib` and
  `qt-harmonyos-third-party-libs` pages (bottle, source cross-compile, or
  report to the user); libraries needing the §6 compatibility evaluation
  belong here. Conclusion: optional-off / platform-excluded / built-in
  fallback / true hard gap. Items may be grouped, one subagent per group; one
  item's upstream and downstream judgment stays in one subagent. Platform
  blocker groups matter most: on OHOS `Q_OS_OHOS` implies `Q_OS_LINUX`, so
  code guarded only by `Q_OS_LINUX` that calls Linux-specific APIs compiles
  silently and must be searched exhaustively.
- **Fetch:** classify each row by where its artifact lands; the unit is the
  landing path, not the library.
  - `downloaded`/`already_local`/`covered`: the CLI already fetched them in
    parallel into the shared `ohos-libs/` tree; no dispatch.
  - `cmd_only`/`failed` resolved into `ohos-libs/<name>/`: fill the version,
    build the direct bottle link, retry or fetch by hand into that directory;
    independent per item, dispatchable.
  - shared-prefix install (`brew install <pkg>`, or a `cmd_only` row's
    `artifact_cmd`): one command by the main agent with per-item rationale in
    the ledger; never dispatched and never counted.
  - global rewrites (`.pc` flattening, prefix rewrite, one cmake file): main
    agent only.

  The route decides, not the status label: one library can be fetchable into
  `ohos-libs/<name>/` and also installable through `brew install`. Choose the
  route first, then count.
- **Cross-compile:** enumerate the whole `need_port` list plus unrecovered
  `failed` rows (their upstream disposition is a source build). One subagent
  per item; a single item still goes to one subagent (verification-heavy, not
  by hand in the main conversation).

## Split and launch

The unit is one library (or one judgment item), one subagent each. One
library's analysis, fetch and cross-compile depend on each other and stay in
one subagent.

| Scenario | Subtask | subagent_type | Writes |
|---|---|---|---|
| Judgment | item judgment, four-way class, §6 evaluation; output `<item>\|<class>\|<evidence:file:line>\|<close-method>\|<confidence>` | Explore | nothing |
| Fetch | version, bottle direct link or retry or hand fetch; output link snippet | GeneralPurpose | only `ohos-libs/<name>/` |
| Cross-compile | OHOS toolchain build (`ohos.toolchain.cmake`, `-DOHOS_ARCH=arm64-v8a`), `.so`/`.a` + headers + CMake config, NEEDED closure | GeneralPurpose | only that library's build/install directory, no shared CMake cache |

Issue all `Task` calls in one message. Subagents start with fresh context, so
each prompt is self-contained:

```
subtask: <judgment/fetch/cross-compile> library or item <name> (version <ver>)
scope: <blocker/unknown item ID / formula name / manifest item ID / bottle install dir>
focus: judgment -> guard evidence? unknowns path? four-way class + §6 list + platform-limits hits;
       fetch -> bottle exists + sha256 + runtime dependency recursion + link snippet;
       cross-compile -> toolchain config + NEEDED closure + deploy to entry/libs/arm64-v8a/
output: judgment -> `<item>|<class>|<evidence:file:line>|<close-method>|confidence`;
        others -> conclusion + evidence (file:line / command output) + confidence(1-10)
do not: judgment never modifies files; fetch/compile write only their own library's directory
```

## Merge

- All succeeded: merge per-item conclusions (including close methods such as
  `-D...=OFF`) and link snippets into the CMake integration and deploy.
- Partly failed: mark the failed items `[partial]`, continue with the rest; the
  main conversation handles the failures one by one.
- All failed: the main conversation analyses them itself and records
  `parallel dispatch unavailable`.

Subagents never write the ledgers, the plan or the project envelope; the
main agent records their results as the `TASK-*` rows' evidence and owns every
shared-prefix install and global rewrite in the tasks phase.

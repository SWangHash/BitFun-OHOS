# Inventory: source scan and rows (phase 2)

The inventory needs one pass over the application sources for what the build
files and the dependency closure cannot see: platform code that still compiles
on OHOS, runtime integration (processes, plugins, paths, settings, single
instance, start-up arguments), runtime resources and source encodings. This
page fixes **how** that pass is delegated, because the brief decides its cost:
the same notepad-- inventory took 35 rounds / 86 tool calls with a closed,
length-capped brief and 90 rounds / 166 calls with an open-ended one (version
archaeology, whole-file chunked reads, an unbounded report, a hunt for
locations the closure did not print). Fill the template below; do not write a
free-form brief.

## 1. Before the scan: collect what is already known

Run `preflight_build_files.py` and `closure.py` first. Their results are
facts the scan must not redo:

- `preflight.json`: every `PF-*` finding (Qt modules declared in build files,
  scope leaks, missing target.path, empty globs, orphan `Q_OBJECT` classes).
- `closure/summary.json`: blockers/unknowns, Qt modules, third-party
  dependencies, `need_port`/`failed` rows.
- `closure/interface-hits.json`: **every** platform-interface hit (Win32, ...)
  that compiles on OHOS, with `file:line`, guard state and
  `likely_false_positive` (`comment`/`string`). The counts in the closure
  blocker text ("4 unconditional ...") are these rows; never ask a subagent to
  find them again.

Copy into the brief: the `PF-*` ids with their one-line messages, the
interface hits that are not likely false positives (as **verify targets**),
and the Qt module / third-party verdicts as **known facts, do not re-check**.

## 2. Who scans, and in how many parts

- Fewer than ~80 application source files (vendored directories excluded):
  scan in the main conversation with the same checklist and limits; no
  subagent.
- Otherwise one read-only `Explore` subagent with the template below.
- More than ~300 application source files, or more than 10 verify targets:
  two subagents in parallel (both `Task` calls in one message), part A
  (platform code) and part B (runtime integration), each with its own copy of
  the template, its own part of the checklist, and half the tool budget.

Start every scan subagent with `run_in_background: true`. While it runs,
write the rows that do not depend on it: one `INV-*` row per `PF-*` error, the
closure blockers/`need_port`/`failed` rows, the `VAL-*` skeleton (build,
package, install/launch) and the TASK rows for them. Then collect the result
with `AgentWait` (`bg_task_ids` from the spawn result).

## 3. The brief (fill the `<...>` parts, keep everything else)

```text
Read-only source scan of <app root> (Qt <5|6> <Widgets|QML> app, build: <qmake <top .pro>|CMake>)
for a Qt -> HarmonyOS (OHOS, arm64, clang, musl) migration inventory. Do not edit files.
On OHOS these macros are defined: Q_OS_OHOS, Q_OS_LINUX, Q_OS_UNIX, __linux__, __unix__.
Not defined: Q_OS_WIN, _WIN32, WIN32, _MSC_VER, Q_OS_MAC(OS), __APPLE__.

Scope: <application source dirs>. Vendored directories <list> are summarized per
directory (one line each, only code that compiles on OHOS); do not list their internals.

Known facts, do not re-check: <Qt modules + verdicts>; <third-party dependencies + verdicts>;
build-file findings <PF ids + one-line messages>.

Verify targets (confirm whether each line compiles on OHOS and what it does, one line each):
<file:line - snippet>  ...

Checklist (each item by its name; report only findings that matter on OHOS):
<part A> platform-code: Win32/POSIX-Linux (X11, xcb, dbus, /proc, fork, kill/signals)/macOS
            (Cocoa, .mm) code with no guard or under a guard that is true on OHOS
            (Q_OS_LINUX, Q_OS_UNIX, unix, __linux__).
         non-qt-guards: guards on non-Qt macros (WIN32, _WINDOWS, project macros): the macro and file.
         source-encoding: source files that are not UTF-8 (GBK etc.) among the files the migration
            will edit.
         x86-only: SSE/AVX intrinsics, inline asm.
<part B> processes: QProcess, startDetached, system(), popen.
         dynamic-loading: QLibrary, QPluginLoader, dlopen; where plugins are searched (paths).
         paths-storage: hard-coded absolute paths; writes under applicationDirPath();
            QStandardPaths / QSettings format and location.
         single-instance-ipc: QSharedMemory, QSystemSemaphore, QLocalServer, signals.
         startup-args: how main() treats arguments()/argv (empty or missing args).
         desktop-integration: QDesktopServices::openUrl, tray icon, frameless/always-on-top
            windows, native file dialogs, "show in explorer"/"open terminal"/admin restart.
         runtime-resources: data read from disk at run time (themes, styles, plugins,
            translations) and ":/..." paths that no .qrc file contains.

Do not: look up versions of the app or of vendored libraries; inspect .rc/icons, licenses,
translation texts, algorithm code or UI strings; read a file from top to bottom; paste code.

Method: Grep with -n and -C 3 instead of Read; put independent searches in the same turn;
Read at most 150 lines at a time and only around a hit; at most <40|20> tool calls in total;
thoroughness: medium.

Output (at most 80 lines, no code blocks, nothing else), one line per finding that needs
work on OHOS; code that already works there, or never reaches the OHOS build, is not reported:
<item> | <file:line[,line...]> | compiles on OHOS: yes/no/unknown(<macro>) | <finding, <= 15 words> | <guarded-adaptation | ohos-replacement | packaging-only | decision>
then "Open questions:" with at most 5 lines.
```

## 4. After the scan

- Check only the `yes` and `unknown` lines against the cited lines (one Grep
  each when in doubt); do not re-read whole files.
- Turn the lines into `INV-*` rows with `ledger.py add` (group lines of one
  category and one disposition into one row) with `found_by=scan: <item>`,
  add `VAL-*` rows for the behavior that the findings touch, and link them in
  `TASK-*` rows.
- A `decision` line becomes an inventory row with `disposition=needs-decision`
  and a question in `decisions.tsv` (no answer yet), asked at the end of the
  decisions phase (phase 3). The answer stays in `decisions.tsv` and the TASK
  row that applies it cites the DEC id; the inventory row is not changed.
- `Open questions` that block an inventory row are answered by one targeted
  Grep/Read in the main conversation, not by a second open-ended scan.

## 5. Rows the inventory gate needs

- `inventory.tsv` holds one row per capability or gap that does not work as
  is on OHOS (modules, QML/plugins, platform branches, OS APIs,
  windows/lifecycle, storage/permissions, third-party libraries, package
  identity): where (`location`), why (`cause`), why the row exists
  (`found_by`), what the migration plans to do (`disposition`) and the result
  (`target_behavior`). The rows are final when the inventory gate passes: they
  have no status, and what became of a row is the state of the TASK rows that
  name it in `inventory_ids` (with their `VAL-*` rows as the proof).
- `inventory.tsv` is an exception list: what works as is on OHOS, or never
  reaches the OHOS build, gets no row; a gap that turns out impossible is a
  `blocked` TASK row (the user is asked), not a disposition.
- Every `error` finding of `preflight.json` is named in the `found_by` of the
  row that fixes it (`preflight: PF-...`; fix them in the first tasks-phase
  batch). A finding checked in the source and found to be a false positive
  gets no row: rerun `preflight_build_files.py --waive <id>="<reason>"`. Closure blockers/unknowns, `need_port` and real-run
  `cmd_only`/`failed` rows become rows with `found_by=closure: <finding>` and
  the raw counts in `cause` (`closure.py` prints them).
- When the app targets a newer Qt than the SDK, `scan_qt_api_gap.py` gives one
  row, category `qt-api-gap`, `found_by=qt-api-gap: <hit count>`, listing the
  hit files, fixed in one slice.
- Every row is named in some TASK row's `inventory_ids`, and that TASK row
  lists its `VAL-*` rows. The gate needs at least one real `INV-*`, `VAL-*` and `TASK-*` row.
- Later gates block while a row stays `planned` after its TASK is done,
  and the validation gate blocks on any open row.

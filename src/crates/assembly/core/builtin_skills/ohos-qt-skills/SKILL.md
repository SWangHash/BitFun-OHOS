---
name: ohos-qt-skills
description: >
  Migrate one existing C++/QML Qt application to HarmonyOS while preserving
  other host platforms, then optionally add HarmonyOS-specific features
  (tap-to-transfer, continuation, share, and similar) from the skill's
  reviewed feature catalog. Use a hash-pinned provenance manifest of the
  ohos_qt-skills knowledge base, a persistent compatibility ledger, gated
  capability-slice implementation, deterministic environment/build/package
  tooling, and evidence-based build/package/device verification. The first
  action is always creating the `<container>/migration/ohos/` ledger with
  `scripts/init_migration.py`. Do not use for building Qt itself,
  batch-porting many apps, or rewriting the application in ArkTS.
---

# Qt to HarmonyOS migration

A selective framework/platform port: C++/QML and existing host behavior stay
authoritative; add only the HarmonyOS build, packaging, lifecycle, window,
API, dependency, plugin and resource adaptations the target needs. Generated
SDK files and the knowledge base are read-only.

Every mechanical step goes through the skill's scripts (section 4); hand-made
replacements are what made earlier migrations slow. Learn a script from
`python <skill>/scripts/<script> --help`; never read script sources to find a
schema, option or rule.

## 1. First action: the migration ledger

Before reading the knowledge baseline, probing the environment or running any
qmake, CMake, devecocli or other build/deploy command, check that
`<container>/migration/ohos/STATE.md` exists. If not, run:

```bash
python <skill>/scripts/init_migration.py --target <app> \
  --output-project <container> \
  --template-root <skill>/assets/templates/migration/ohos
```

`<app>` is the Qt application root (its `.pro`/`CMakeLists.txt`, or the
repository root), never the HarmonyOS output directory the user names.
`--output-project` is the bound output **container** (the `output_project` a
BitFun QtMigration session binds; any directory, also the Qt repository root).
The ledger is its `migration/ohos/`, and the script records `<app>` in the
STATE.md Scope (`Qt source root`). The HarmonyOS project is another
subdirectory of the container: the project directory the BitFun bound-inputs
instruction names, otherwise `<Application target>-ohos`. In the decisions
phase, once the authoritative build file is known, record `Application target`
(its TARGET name, the build file as evidence) and `HarmonyOS output project`
in the Scope. Batch logs, screenshots and other evidence go under
`migration/ohos/batches/`; build directories stay where the app's build system
puts them.
If `STATE.md` exists, resume with `next_step.py` instead. This is never
optional, also for "just build and deploy it": work outside the ledger cannot
pass a gate. If initialization fails, stop and report. If you find the ledger
missing later, stop, initialize it and record what was already done. Never
report progress, a phase or a successful build while `STATE.md` is missing.

## 2. Phases and gates

| # | Phase (`id`) | Ledger |
|---|---|---|
| 1 | Environment (`environment`) | `environment.tsv` |
| 2 | Inventory (`inventory`) | `inventory.tsv` |
| 3 | Decisions (`decisions`) | `decisions.tsv` |
| 4 | Tasks (`tasks`) | `tasks.tsv` |
| 5 | Diagnostics (`diagnostics`) | `diagnostics.tsv` |
| 6 | Features (`features`) | `features.tsv` |
| 7 | Validation (`validation`) | `validation.tsv` |

`python <skill>/scripts/next_step.py <container>/migration/ohos` is the description
of each phase: it prints the open phase, what to do now and what must wait,
the unanswered questions, the unmet gate conditions and the gate command. Run it
after initialization, after every gate, after a context compaction and
whenever the next step is unclear. After a compaction its output,
`ledger.py state <root>` and the current TASK row are all you need; do not
reload this file.

- Your todo list is the initialization item followed by exactly these seven
  phase items in this order. Never delete, merge, rename, reorder or skip
  one, also when the user only asks to "build and deploy".
- A phase closes only through
  `python <skill>/scripts/validate_ledgers.py <container>/migration/ohos --phase <id>`
  printing `READY`; then mark the next phase in progress. It checks the
  ledgers and the phase gate and records the verdict in `STATE.md` (`--no-record`
  only checks). A phase with no work closes with `not-applicable` evidence.
  Gates are cumulative; batches of a phase are refused while earlier gates
  are open. On `INVALID` or `NOT-READY`, write the missing observation or
  blocker before any other source or build work.
- `READY` is not a stopping point: enter the next phase in the same turn and
  continue until `validation` is `READY`. Stop only when the open phase is
  `blocked` (its Progress status: something only the user can resolve), when a decision blocking the phase you
  are about to gate is unanswered, or when the budget is exhausted; write the
  reason in `Next executable action`. Continuing never justifies answering a
  user question yourself; the only defaults are the runtime's `auto_decided`
  decisions-phase answers.
- Phases 1-5 are the base Qt migration and never deal with HarmonyOS external
  features; selection and capability features are phase 6, verification
  features run in phase 7.
- At every gate report burndown counts from the ledgers.
- The output layout: from `decisions` on the Scope records the
  `HarmonyOS output project`, a subdirectory of the container that holds
  `migration/`, and from `tasks` on that project exists as a DevEco project
  root. A gate failing on `output layout` means the recorded path or the
  directory on disk is wrong: fix the path, never the gate.

## 3. Ledgers and records

`<container>/migration/ohos/` holds `STATE.md`, `report.md`, the
nine TSV ledgers, the generated `knowledge-manifest.tsv`, and the tool outputs
`env-smoke.json`, `preflight.json`, `preflight-configured.json`, `closure/`. What
each is for: [persistence-model.md](references/persistence-model.md); columns
and values: `ledger.py columns <ledger>`.

- **Ledgers and `STATE.md` are read and written only through scripts**, never
  with Read, Edit, Write, Grep or a shell read/write (`cat`, `type`,
  `Get-Content`, `Set-Content`, `python -c`):
  - `ledger.py get|list|add|update|columns` for rows,
    `ledger.py state` to read `STATE.md` with the ledger views and to set its
    fields;
  - diagnostics through `batch_checks.py` and `record_diagnostic.py`;
    `device-runs.tsv` through `batch_checks.py` and `device_run.py --record`;
    feature rows through `feature_hooks.py` and `feature_gate.py`.

  Load only the rows the current action needs, never whole ledgers.
- Write each row right after the observation it records, before the next
  dependent tool call. A todo item, a chat message or `STATE.md` prose is not
  a ledger row. Keep `Next executable action` current before every
  long-running step. Rows are never deleted: a mistaken row gets
  `not-applicable` with the reason.
- A fact lives in one place. `STATE.md` keeps only what no ledger holds (its
  Scope table: application target, Qt source root, output project, source
  revision); `report.md` is prose you write, citing ledger ids
  instead of copying rows. A file being present is
  never completion evidence. Raw logs stay outside the ledgers, cited by
  path.
- User decisions (when to ask, how to record, changes, degradations,
  plan amendments, working without a device): [decisions.md](references/decisions.md).

## 4. Tools

Paths are `<skill>/scripts/`; `<root>` is `<container>/migration/ohos`. Usage:
`--help`.

| Script | Use for | Replaces |
|---|---|---|
| `next_step.py` (`--schema`: batch plan schema) | the open phase and its gate | rereading the workflow |
| `env_probe.py` | `environment.tsv`: one row per environment item with the variables every tool runs with | hand probing; PATH/encoding/SDK fixes repeated per plan |
| `env_smoke.py` | a hello app through the application's whole pipeline, device included | a pilot phase; meeting environment problems later |
| `preflight_build_files.py` | build-file traps (`PF-*`), later the audit of the configured OHOS build | one failed build per trap |
| `closure.py` | the mandatory portgraph dependency closure and dispatch counts | hand-run portgraph; judging dependencies from greps |
| `scan_qt_api_gap.py` | Qt APIs newer than the SDK | discovering them one build at a time |
| `template_patch.py` | the output project from the template, with every known edit | hand template edits |
| `batch_checks.py` | every configure/build/deploy/package/device attempt: logs, problem rows, the HAP's device-runs.tsv row | foreground builds, hangs, unrecorded attempts |
| `deploy_qt_libs.py` | the application `.so` with its Qt and third-party closure into the project | `make ohosdeploy` (only echoes), hand copies |
| `devecocli_build.py` | packing the HAP (`devecocli build`, hvigor daemon off) | bare `devecocli build` or hvigor calls |
| `hap_check.py` | checking a built HAP | hand HAP inspection |
| `device_run.py` | signing; install, launch, process, hilog and crash-log check through devecocli | hand devecocli/hdc snippets |
| `known_issues.py` | looking a failure up among known issues | re-investigating a known problem |
| `record_diagnostic.py` | writing a problem's cause and fix, closing it, recording one met outside a batch | editing `diagnostics.tsv` |
| `ledger.py` | ledger rows and `STATE.md` | reading or editing ledgers by hand |
| `feature_hooks.py`, `feature_gate.py` | external features (phases 6-7) | ad-hoc feature work |
| `sync_knowledge.py`, `mark_knowledge_used.py` | knowledge provenance | copying knowledge pages |
| `validate_ledgers.py` | the phase gate | judging completion yourself |

Topic rules: [build-diagnostics.md](references/build-diagnostics.md) (the
build/diagnostics loop), [inventory-scan.md](references/inventory-scan.md)
(source scan and inventory rows),
[third-party-parallel-dispatch.md](references/third-party-parallel-dispatch.md),
[external-features.md](references/external-features.md),
[knowledge-sync.md](references/knowledge-sync.md),
[toolchain-template-inputs.md](references/toolchain-template-inputs.md).

## 5. Knowledge baseline

- Every migration uses the released baseline in this skill's
  `upstream-kb/knowledge/`; never read or copy migration knowledge from an
  `ohos_qt-skills` checkout, URL, branch or upstream file. Read pages in place
  and mark them with `mark_knowledge_used.py`; a target-specific adaptation is
  the only local copy (`sync_knowledge.py --register-modified`). Never patch
  manifest rows, never run anything under `upstream-kb/scripts/`.
- When the baseline changed during the migration, `sync_knowledge.py`
  re-pins and lists the changed pages: tell the user and continue.
- Start with `_index/_task-routing.md`, `semantic/qt-harmonyos-golden-rules.md`
  and `_index/_map.md`, then load only pages for the current row. The
  knowledge base's own porting-workflow (8 steps) and full-pipeline (8
  stages) are background knowledge; the phases come from `next_step.py`. A
  missing page blocks its row and needs a new baseline release. Pages routing
  to excluded upstream tooling (`upstream-kb/exclusions.tsv`) are provenance,
  not gaps: never use their workflow or G0-G12 gates; their data (`errors/`,
  `rules/`, `adaptation/`, `faults/`) is knowledge to read.
- Acquire a missing template or Qt kit with `bitfun-download-template.sh` /
  `bitfun-download-qt-sdk.sh` in `<skill>/scripts/`, never the vendored
  `download-*.sh` (toolchain-template-inputs.md).
- Acquisition is a user-confirmed step, never an automatic repair: a bound
  toolchain or template this host cannot use (another platform's binaries, no
  executable `qmake`, an incomplete tree) is a question for the user. Say what
  failed and what the download would install, wait for a real answer and record
  it as a `decisions.tsv` row with `owner=user` before running either script
  (toolchain-template-inputs.md).

## 6. Hard rules

- No configure, build, package, signing, install or device command for the
  target while `migration/ohos/STATE.md` is missing.
- Preserve non-HarmonyOS paths: `Q_OS_OHOS`, `OHOS`, qmake `ohos` scopes
  (`unix:!ohos` for host-only unix blocks), CMake platform guards, adapters or
  platform-specific files. A qmake scope's `{` goes on the condition line:
  `cond {`. A `{` on the next line opens an unconditional block (KI-023).
- Modify source-of-truth project files, never generated output or SDK
  installs (never copy DLLs into an SDK; fix the environment profile).
- No target file per source file, no parallel application tree; vendored
  libraries are their own targets.
- Never silently replace unsupported modules, permissions, lifecycle or
  behavior with stubs: give the inventory row `disposition=needs-decision` and
  ask the user in `decisions.tsv`; the TASK row that applies the answer cites
  its DEC id, and without an answer that TASK row is `blocked` until the user
  answers (gates never pass a `blocked` row).
- The plan (the environment: build system qmake/CMake, Qt version, SDK
  version; inventory dispositions, the answers in `decisions.tsv`, the VAL
  scenarios, the STATE.md Scope) is frozen at the decisions gate; changing any
  of it later needs the user's consent; a material change to stack,
  scope, dependency, degradation, signing or a destructive device action is a
  new question in `decisions.tsv`, applied between rounds once answered, never
  in a repair loop.
- `environment.tsv` is written only by `env_probe.py`, always as a whole
  table: never edit it; fix the environment as a row's `issue` says and rerun
  `env_probe.py`. Never set PATH or toolchain variables in a batch plan,
  build the HAP only with `devecocli_build.py`, never deploy with
  `make ohosdeploy`. An environment
  problem is fixed with `env_probe.py` and proven with `env_smoke.py`, never
  inside a plan.
- Every configure, build, package and device attempt runs through
  `batch_checks.py`; the loop rules are in build-diagnostics.md.
- The output project starts as the Qt envelope app (`template_patch.py
  --envelope`) and switches to the application in the batch that packages
  its `.so` (`deploy_qt_libs.py`).
- Every user-specified deliverable is a `VAL-*` row (bundle name,
  uninstall-before-install, install/launch, a path file the user asked for).
  The deliverable is the final HAP: the `hap_check.py` step of the packaging
  batch writes its one `device-runs.tsv` row (`hap-failed`, `checked`,
  `no-device`) and a passed `device_run.py --record` sets it to `run`; the
  `.so` and intermediate HAPs are not kept, only the batch logs. Smoke-test
  and envelope HAPs never count for the application. Never delete the HAP
  named in `device-runs.tsv`.
- Evidence strength rises from static inspection through host checks,
  configure, compile/link, package inspection, install/launch, device
  scenarios to full regression. A package file does not prove launch or
  behavior; unknown core behavior stays blocked or unverified. Handoff
  reports the strongest tier actually proven.
- Serialize expensive cross-compiles, packaging, signing, installation and
  device operations. Parallelize only disjoint discovery or implementation
  scopes; workers never edit the ledgers, the plan or the project
  envelope. Closure-driven third-party work is dispatched per
  third-party-parallel-dispatch.md.
- Turns, time and context are a budget. Let the compiler drive source
  reading. Delegate broad read-only exploration to a subagent with a closed
  brief, the known facts, a tool budget and an output limit, in the
  background when other work can proceed. If about half the budget is spent
  without an application `.so`, spend the rest on the build loop.
- A conversation summary is not evidence: check a quoted error against the
  log named in the problem's `reproduce` and the files on disk.
- Never substitute or acquire a build input the user bound without asking
  first (section 5, acquisition).
- Never store credentials, signing keys, tokens, full device identifiers or
  unredacted user data in migration records.

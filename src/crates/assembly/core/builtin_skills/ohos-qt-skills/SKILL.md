---
name: ohos-qt-skills
description: >
  Migrate one existing C++/QML Qt application to HarmonyOS while preserving
  other host platforms, then optionally add HarmonyOS-specific features
  (tap-to-transfer, continuation, share, and similar) from the skill's
  reviewed feature catalog. Use a hash-pinned provenance manifest of the
  ohos_qt-skills knowledge base, a persistent compatibility ledger, gated
  capability-slice implementation, and evidence-based build/package/device
  verification. The first action is always creating the
  `<app>/migration/ohos/` ledger with `scripts/init_migration.py`. Do not use
  for building Qt itself, batch-porting many apps, or rewriting the
  application in ArkTS.
---

# Qt to HarmonyOS migration

Treat this as a selective framework/platform port. Keep C++/QML and existing
host behavior authoritative; add only HarmonyOS build, packaging, lifecycle,
window, API, dependency, plugin, and resource adaptations required by the
target. Generated SDK files and the source knowledge base are read-only.

## 0. First action: create the migration ledger

Before reading the knowledge baseline, probing the environment, or running any
qmake, CMake, hvigor, hdc, or other build/deploy command, check that
`<app>/migration/ohos/STATE.md` exists. If it does not, run this now:

```bash
python <skill>/scripts/init_migration.py --target <app> \
  --output-project <container> \
  --template-root <skill>/assets/templates/migration/ohos
```

`<app>` is the root of the Qt application being migrated (the directory with
its `.pro`/`CMakeLists.txt`, or the repository root), never the HarmonyOS
project directory that the user names for the converted output (for example
`<repo>/project`). `init_migration.py` refuses a missing directory or a
HarmonyOS project.

`--output-project` is the bound output **container**, not the project directory
(it is the `output_project` value a BitFun QtMigration session binds; a CLI run
passes the container it uses instead). The migration project lives in that
container's `<app-name>-ohos` subdirectory, so the two are never the same path.
`init_migration.py --output-project` records the pair in `environment.tsv`
(`category=layout`), refuses a container that already holds a HarmonyOS project,
and refuses the Qt project root itself (the project would land inside the Qt
sources).

The recorded cell is the single authority for `<container>` and `<project>`:
read them there rather than re-deriving the application name, and keep them
current if the project directory is renamed. Omitting the flag leaves the binding
unrecorded, and the layout gate then blocks the `pilot` phase until the row
exists. Run the initializer again with `--output-project` to add it; never write
the template or the migration artifacts into the container root, also when the
container is the current workspace root.

If it exists, resume from `STATE.md` instead. This step is never optional, also
when the request sounds like "just build and deploy it": `migration/ohos/` is
where scope, environment, problems, fixes, and evidence are recorded, and work
done without it is untracked and cannot pass any phase gate. If initialization
fails, stop and report the error; do not continue without the ledger. If you
notice later that the ledger is missing, stop the current step, initialize it,
and record what was already done before going on.

If you keep a todo or plan list, its first item is "Initialize
`migration/ohos/` ledger", and it must be done before any other item starts.
The ledger is the only progress record: do not report migration progress,
phase completion, or a successful build to the user while `STATE.md` is
missing.

## 0.1 Phase order: one phase at a time, closed only by its gate

The migration has eight phases. Each has one ledger, and only its gate
command closes it:

| # | Phase (`id`) | Ledger | Do in this phase | Must wait for a later phase |
|---|---|---|---|---|
| 1 | Environment preparation (`baseline`) | `environment.tsv`, `baseline.tsv` | probe Qt, SDK/ABI, toolchain, hvigor/DevEco CLI, template tree, signing, device; host smoke | copying the template, build files, source edits, HarmonyOS builds |
| 2 | Migration inventory (`inventory`) | `inventory.tsv` | scan build files and sources; `CAP-*`/`VAL-*`/queue rows | any edit outside `migration/ohos`, HarmonyOS builds |
| 3 | Migration plan contract (`contract`) | `decisions.tsv` | freeze target, bundle name, deliverables, dispositions, feature selection; user approvals | copying the template, build files, source edits |
| 4 | Pilot verification (`pilot`) | `pilot.tsv` | create the HarmonyOS project from the template inside the output container's `<app-name>-ohos` subdirectory; prove envelope, entry, Qt linkage, packaging, one risky boundary | porting or building the application target |
| 5 | Capability migration (`implementation`) | `work-queue.tsv` | application build files and guarded source changes per `CAP-*` row | HarmonyOS-specific features |
| 6 | HarmonyOS feature adaptation (`features`) | `feature-adoption.tsv` | run activated capability features one at a time through their entry/exit gates | — |
| 7 | Build and diagnostics (`diagnostics`) | `diagnostics.tsv` | application build/package/install/device rounds, classified failures | — |
| 8 | Acceptance and handoff (`handoff`) | `validation.tsv` | verify the real artifact and device behavior; run activated verification features; write `report.md` | — |

The output layout is checked by every gate, not only by the phase that creates
the project: the container root must never carry `AppScope/`, `hvigorfile.ts`,
`build-profile.json5`, `oh-package.json5` or a packaged `.hap`, and from `pilot`
on the project recorded in `environment.tsv` must exist as a `<app-name>-ohos`
directory of the container (`<app-name>-ohos-2` and up only for a repeated
migration of the same application). A gate failing on
`output layout` means the recorded binding or the directory on disk is wrong —
fix the path, never the gate.

- Right after initialization, after every gate, after a context compaction,
  and whenever the next step is unclear, run
  `python <skill>/scripts/next_step.py <app>/migration/ohos`. It names the open
  phase, what it may and may not do, the unmet gate conditions, and the exact
  gate command. Do only what it allows.
- Your todo list is the initialization item followed by exactly these eight
  phase items in this order (finer steps may follow inside the current
  phase). Never delete, merge, rename, reorder, or skip a phase item, also
  when the user only asks to "build and deploy" and gives every path: those
  details fill the phase 1 and 3 rows faster; they do not remove phases.
- A phase item is completed only right after `validate_ledgers.py <app>/migration/ohos --phase <id>`
  printed `READY` for it; then mark the next phase in progress. A phase that
  needs no work still closes through its gate with `not-applicable` evidence.
- Write each ledger row right after the observation it records, before the
  next tool call that depends on it. A todo item, a chat message, or
  `STATE.md` prose is not a ledger row.

## 1. Reference the released skill knowledge baseline

Every Qt migration project must use the complete, released baseline in this
skill's `upstream-kb/knowledge/` directory (page paths below are relative to
it). Never read or copy migration knowledge directly
from an `ohos_qt-skills` checkout, URL, branch, or individual upstream file.

The project does not copy the baseline. Run
`scripts/sync_knowledge.py --target <app>/migration/ohos`; the script verifies
this skill's manifest and baseline files, then writes the project
`knowledge-manifest.tsv` as the single provenance evidence chain: per page it
records the pinned baseline-manifest hash, the original `ohos_qt-skills`
revision/path/hash, and the skill snapshot path/hash. Read pages where they
live in the skill baseline during the migration, and mark consulted pages
`used=yes` with `scripts/mark_knowledge_used.py`. No knowledge files are
copied into the project.

The one exception is a target-specific page adaptation. Create the adapted
copy at `<app>/migration/ohos/knowledge/<source_path>` and run
`scripts/sync_knowledge.py --target <app>/migration/ohos --register-modified
<source_path>`. The manifest then records that local file's hash and the exact
baseline page it was adapted from (`modified=yes`); the project `knowledge/`
directory must contain nothing else.

The manifest pins one baseline version for the whole migration; a migration is
a short run and its knowledge baseline is frozen. If `sync_knowledge.py` or
`scripts/validate_ledgers.py` reports that the installed skill baseline no
longer matches the pinned hash, stop and surface it to the user. The user
alone decides whether to restart the migration against the new baseline
(delete the project `knowledge-manifest.tsv`, or the whole migration
directory, and re-run). Never resume silently on a changed baseline and never
patch manifest rows toward a newer baseline by hand.

Only a skill maintainer may refresh this baseline from `ohos_qt-skills`,
following `upstream-kb/AGENTS.md` (`upstream-kb/scripts/sync_upstream.py`) and a
reviewed release update. A migration agent must never run anything under
`upstream-kb/scripts/`; it may only run the project
provenance command described above. Do not claim knowledge-base currency
without the recorded source revision and hash.

The skill baseline includes complete `kb-init` environment, toolchain, Qt SDK,
and template-acquisition files originally sourced from `ohos_qt-skills`. Read
[toolchain-template-inputs.md](references/toolchain-template-inputs.md) before
starting a migration: it distinguishes these vendored instructions and
scripts from the external Qt/DevEco/OHOS binaries and the real template tree.
The latter must be acquired and verified as a whole directory before the pilot;
this skill must never invent a partial template.

Acquiring those two shared inputs goes through this skill's own BitFun scripts:
`<skill>/scripts/bitfun-download-template.sh` and
`<skill>/scripts/bitfun-download-qt-sdk.sh`. They resolve the shared Qt migration
root BitFun scans (template into `templates/`, kit into `toolchains/`) and verify
the result with the scan's own predicates, so use the path they print
(`OHOS_TEMPLATE_SRC`, `QT5_12_OHOS_SDK`). The vendored `download-*.sh` copies under
`upstream-kb/knowledge/skills/kb-init/scripts/` are baseline references: they demand
an explicit `--dest` and would install where the intake cannot see the result.

Read only skill-baseline pages during the migration. External links and source
paths embedded in those pages are provenance, not permission to fetch missing
knowledge. If a required page is absent from the baseline, block the row and
request a new skill baseline release; never fill the gap directly from
upstream. Start with `_index/_task-routing.md`,
`semantic/qt-harmonyos-golden-rules.md`, and `_index/_map.md`; then load only
pages relevant to the current inventory row. Follow `refs` links and record
consulted files as `used=yes` in the manifest. The maintainer selection and
project provenance boundary are documented in `references/knowledge-sync.md`.

Baseline pages were written for upstream's own agent system and may route a
migration to tooling this skill deliberately excluded (see
`upstream-kb/exclusions.tsv`): the `qt-app-porting` skill with
`tools/qt-ohos-run.py`, `qt-sdk-forge` with `tools/qt-sdk-run.py`,
`task-dispatcher`/`_agent-mesh`, `tools/faults-build.py`, and
`templates/qt-ohos-app/`. Those references are provenance, not missing pages:
do not block a row on them, do not fetch them from upstream, and never
substitute their workflow or G0-G12 gates for this skill's ledgers and phase
gates. The data those tools consume (`knowledge/errors/`, `knowledge/rules/`,
`knowledge/adaptation/`, `faults/`) is in the baseline; read it as knowledge.
`portgraph/` is kept: during inventory, produce the dependency closure as a
**mandatory** step before any per-dependency work — `ingest all` (one-time data
source: Harmonybrew formulae + cmd-pkgs + Qt matrix), then
`python upstream-kb/knowledge/portgraph/portgraph.py scan <app>`, `analyze
<app> --summary`, `deps <app>`, `fetch-deps <app> --dry-run`, and the real
`fetch-deps <app> --json --jobs 8` (commands below in section 2, inventory).
The real run belongs to the gate, not to a later implementation phase: a
dry-run reports every downloadable row as `would_download` and can never
report `failed`, so the fetch trigger's `cmd_only + failed` count is only
decidable after the real run has landed. The closure output —
blockers/unknowns, cmd_only/failed, need_port rows — is the trigger evidence
for third-party parallel dispatch; without it, no dependency judgment, fetch,
or cross-compile may start, and dependencies must never be hand-judged from
greps or formula listings (one or more third-party libraries already require
the closure — this is a "you must obtain the closure first" rule, **not** the
dispatch threshold).
Its output is evidence cited in the ledgers, not a substitute for them; its
workspace (`upstream-kb/knowledge/portgraph/workspace/`) is local scratch, and
any bottles it downloads are external binaries recorded with path and hash
like other toolchain inputs.
Once the closure lands, third-party dependency work (judgment / fetch /
cross-compile) is dispatched per [third-party-parallel-dispatch.md](references/third-party-parallel-dispatch.md).
Every trigger counts a **different unit, always taken from the closure output
and never from the library list**:
- judgment: the `blockers` + `unknowns` rows reported by `analyze`
  (platform-interface blockers such as ALSA / PulseAudio / X11 included) —
  ≥3 rows → forced parallel. This counts *judgment items*, **not** third-party
  libraries: a project with only two libraries can still carry five platform
  blockers.
- fetch: the `cmd_only` / `failed` rows whose artifact lands in a **per-library
  directory** — ≥2 rows → forced parallel.
- cross-compile: the `need_port` rows plus `failed` rows that could not be
  recovered — ≥1 → forced dispatch (≥2 items → one subagent per item, ==1 → a
  single subagent).
Global-rewrite landing and shared-prefix installs (`brew install`) are
main-agent single-point, and even "no parallel needed" must output the
candidate list plus per-item rationale — never process the dependency list
serially in the main conversation. Record the raw counts with their source
(for example `judgment = analyze.blockers(3) + analyze.unknowns(0)`) in the
evidence, so a miscounted trigger is visible instead of silent.

## 2. Persist the migration state

At the target repository root run
`scripts/init_migration.py --target <app> --template-root <skill>/assets/templates/migration/ohos`
to create or reuse `migration/ohos/` from `assets/templates/migration/ohos/` and
record the knowledge-baseline provenance. Maintain these files as the durable
source of truth:

- `STATE.md` — scope, pinned target, current gate, phase progress, blockers,
  decisions, and strongest verified completion tier.
- `PORTING_CONTRACT.md` — stable decisions for platform isolation, Qt/SDK,
  modules, packaging, target behavior, and approved deviations. Queue contract
  amendments; do not change acceptance criteria inside a repair loop.
- `inventory.tsv` — one evidence-backed capability/integration row per gap.
  Its `status` is the capability's migration state: `planned` when recorded,
  closed (`passed`, `verified`, `accepted-limitation`, `not-applicable`, or
  `blocked`) once the queue work that migrates it is done.
- `work-queue.tsv` — executable slices; `inventory_ids` lists the inventory
  `CAP-*` rows each slice closes (build-only slices write `none`).
- `validation.tsv` — host and HarmonyOS acceptance scenarios with evidence.
- `diagnostics.tsv` — the problem log: every build/package/install/launch/
  runtime failure and every environment, toolchain, SDK, or deployment problem
  met on the way, with its root cause and the fix that worked.
- `report.md` — final handoff and reproducible next commands.
- `knowledge-manifest.tsv` — pinned baseline provenance per page; local files
  only for adapted pages.

The migration uses twelve core ledgers. The navigation and handoff documents remain separate:

- `STATE.md`, `PORTING_CONTRACT.md`, `assessment.md`, and `report.md` hold navigation, frozen contract, feasibility assessment, and final handoff.
- `environment.tsv`, `baseline.tsv`, `inventory.tsv`, `decisions.tsv`, `pilot.tsv`, `work-queue.tsv`, `feature-adoption.tsv`, `diagnostics.tsv`, `package-manifest.tsv`, `device-runs.tsv`, and `validation.tsv` are the only TSV ledgers.
- `knowledge-manifest.tsv` is generated by `sync_knowledge.py` and is the twelfth durable ledger for the project.

Each of the eight phases owns one ledger, which is its progress record:
`baseline` → `environment.tsv`, `inventory` → `inventory.tsv`, `contract` →
`decisions.tsv`, `pilot` → `pilot.tsv`, `implementation` → `work-queue.tsv`,
`features` → `feature-adoption.tsv`, `diagnostics` → `diagnostics.tsv`,
`handoff` → `validation.tsv`. `baseline.tsv`, `package-manifest.tsv`, and
`device-runs.tsv` are supporting evidence shared by several phases.

Information from removed specialist ledgers is folded into these fields: scan scope/topology and dependency evidence belong in `inventory.tsv`; feature selection belongs in `decisions.tsv` and feature implementation in `feature-adoption.tsv`; pilot attempts belong in `pilot.tsv`; build rounds and recurring failures belong in `diagnostics.tsv`; source changes and review receipts belong in `work-queue.tsv` and `validation.tsv`; negative controls belong in `validation.tsv`; cost and process notes belong in `report.md`.

Read [persistence-model.md](references/persistence-model.md) for the ledger schemas and initialize them from `assets/templates/migration/ohos/`.

Use stable IDs and the controlled vocabularies in the templates. A file being
present is never completion evidence; a row closes only when its named
validation passes. Keep raw logs/screenshots outside tracked records (or in a
gitignored evidence directory), with redacted summaries and digests only.

### Durable-write invariant

The five execution ledgers are write-ahead records, not a final report:
`inventory.tsv`, `work-queue.tsv`, `validation.tsv`, `pilot.tsv`, and `diagnostics.tsv`.
After initialization, their `BOOT` receipt rows only prove that the files
exist. They do not count as application inventory, executable capability work,
acceptance, or a successful build.

Before entering the next phase, run one command and obey its exit code:

```bash
python scripts/validate_ledgers.py <app>/migration/ohos --phase <phase>
```

It checks ledger structure and the phase gate (`phase_gate.py` rules) in one
call, and records the verdict in `STATE.md` itself: `Last gate` always, and on
`READY` the phase's Progress row (`passed`), the next row (`in-progress`),
`Current phase`, `Last updated`, and `Last completed action`. Do not hand-edit
those fields to claim a gate; refine the Progress evidence text instead. Pass
`--no-record` only for a read-only check. Do not continue when it prints
`INVALID` or `BLOCKED`. Phases run in order and none may be skipped: gates are
cumulative, `validate_ledgers.py` is `INVALID` while `Current phase` points
past a phase whose gate has not passed, every recorded gate moves `Current
phase` back to the first such phase, and `batch_checks.py --diagnostics`
refuses pilot batches before the contract gate and build/package/device
batches before the pilot gate. Do not write build files or port code for
`implementation` while an earlier phase is still open.

A `READY` gate is not a stopping point. Enter the next phase in the same turn
and keep going until the `handoff` gate is `READY`. Stop only when a gate is
`BLOCKED` on something only the user can resolve, when a user decision is
pending, or when the budget is exhausted; then write the reason in `Next
executable action`. Do not end a turn just to ask whether to continue, and do
not leave `features`, `diagnostics`, or `handoff` as "remaining wrap-up".
Keeping going never justifies answering or defaulting a user question
yourself: a pending decision is a valid stop.

Keep `STATE.md` → `Next executable action` current: update it before every
long-running step (scan, configure, build, package, device run) so a reader
of the ledgers can tell what is happening between gates. Never say
"I will update the ledgers later", "batch the ledger updates", or use a Todo
list as a substitute for a TSV row. Write the observation immediately after
it occurs and before the next implementation or build action. If a row cannot
be written because its schema is unclear, stop and record a blocker instead
of doing untracked work. Run every configure/build/package/device attempt
through `batch_checks.py --diagnostics` so its `diagnostics.tsv` receipt is
written by the same command that produced the result.

### Task deliverables and artifact safety

- Record every user-specified deliverable in `PORTING_CONTRACT.md` and as a
  `VAL-*` row during baseline: artifact receipt files (for example "write the
  .so path to `so-path.txt`", "write the HAP path to `hap-path.txt`"), bundle
  name, uninstall-before-install, and install/launch requirements.
- Declare receipt files as `artifact_receipts` in the batch plan with a pattern
  that matches the application target's artifact, so the path is written the
  moment the artifact exists — never at the end of the run. Pilot artifacts
  must not be written into application receipts.
- Never delete a build or output directory that holds a verified or receipted
  artifact (pilot or application) before archiving it (`"archive": true`) and
  recording it in `package-manifest.tsv`. Prefer incremental rebuilds; if a
  clean build is required, make it a batch step after the archive exists.
- Treat turns, time, and context as a budget. After a context compaction,
  re-read `STATE.md` and query the current queue row before acting. Build-system
  experiments (minimal repro projects, toolchain probing) get one attempt per
  recorded diagnostic hypothesis; prefer the structural fixes in
  [build-diagnostics.md](references/build-diagnostics.md).
- Let the compiler drive source reading. Right after the pilot, add the
  smallest build guards and run the first keep-going build of the application
  target; then read the files its errors name. Do not read the source tree
  through before that build. Delegate broad read-only exploration to a
  read-only subagent when the host provides one, and keep only its conclusions.
  If roughly half of the budget is spent and no application `.so` exists,
  stop exploring and spend the rest on the build/diagnostic loop.
- A conversation summary is not evidence. After a compaction, any error,
  file state, or user request quoted only in the summary is unverified: check
  it against the newest `diagnostics.tsv` row, its `log_path`, and the files on
  disk before acting on it. Never chase an error that the latest log does not
  contain.
- Keep the working pilot envelope intact until the application library
  exists. Do not delete the pilot's native sources or point the package entry
  (`build-profile.json5`, `APP_LIBRARY_NAME`) at the application target until
  the application `.so` has an artifact receipt; switch the entry in the same
  batch that packages it.

## 2.1 Keep the working context small

Use `scripts/ledger_query.py` to retrieve only the current queue row and its
linked inventory/validation/environment evidence. Do not load all TSV files
on every turn. Use `scripts/batch_checks.py` for configure, build, package, and
device checks; it writes full logs and one compact JSON summary, so a long
command does not require repeated foreground polling. See
[performance-optimized-workflow.md](references/performance-optimized-workflow.md).
## 3. Execute gated phases

Follow the order in section 0.1 and `references/migration-workflow.md`. The
phases are resumable because their queues are files on disk:

1. **Environment preparation (`baseline`):** inspect repository instructions, source/build/test
   entry points, revision and dirty state; write assessment/environment/baseline
   evidence; identify host flows and the exact
   Qt-for-HarmonyOS distribution, SDK/API, ABI, toolchain, template, signing,
   and device inputs.
   Do not enter the implementation queue until `environment.tsv` contains
   evidence for the selected Qt distribution, OHOS native toolchain, host
   build/package tools, and a complete template source/tree. Use the `kb-init`
   files under the skill baseline's `upstream-kb/knowledge/skills/kb-init/` to acquire and
   verify them; binaries remain external inputs.
   Run `validate_ledgers.py ... --phase baseline`; a `TODO` or `planned` template row is not
   environment evidence.
2. **Migration inventory (`inventory`):** mechanically scan build files and source for
   Qt modules/QML/plugins, platform branches, OS APIs, windows/lifecycle,
   storage/permissions, third-party libraries, and package identity. Persist
   inventory and work queue; audit empty scans and inspect
   matches in context.
   Third-party dependencies are closed over by portgraph **before** any
   per-dependency work (mandatory, not optional):
   ```bash
   # One-time data source: build the dependency graph before any closure query.
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py ingest all
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py scan <app>
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py analyze <app> --summary
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py deps <app>
   # Closure preview, then the real fetch: only the real run reports `failed`,
   # and `cmd_only + failed` is half of the fetch dispatch trigger.
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py fetch-deps <app> --dry-run
   python <skill>/upstream-kb/knowledge/portgraph/portgraph.py fetch-deps <app> --json --jobs 8
   ```
   Both runs are gate evidence. A dry-run classifies every downloadable row as
   `would_download` and never emits `failed`, so a closure that stopped at
   `--dry-run` cannot decide the fetch scenario. The real run exits non-zero
   when a row fails; record the failing rows, give each one a per-item
   disposition, and do not let the non-zero exit abandon the gate.
   Data-source guard: `ingest all` runs once. If the dry-run closure reports
   **every** row as `need_port` (annotated `未入库 / 无源码链接`) while
   `analyze` reports `blockers: 0` and lists all dependencies as unknowns, the
   graph was never ingested — run `ingest all`, re-run the closure, and only
   then record dependency rows. A closure produced without the data source is
   not gate evidence: never substitute hand-run `brew info` / `brew search`
   for it, and never record such a closure as trigger evidence.
   Record blockers/unknowns and need_port rows, plus the cmd_only/failed rows
   of the real `fetch-deps` summary, as `inventory.tsv` `CAP-*` rows; these
   rows are the trigger evidence for third-party parallel dispatch (section 1
   above). The fetch trigger count comes from the real run, never from the
   dry-run preview. Never hand-judge a dependency from greps or formula
   listings — any third-party dependency requires the closure output first (a
   closure rule, **not** a dispatch threshold); the gate blocks while
   dependency rows are not backed by the closure output.
   Run `scripts/scan_qt_api_gap.py <app> --target-qt <sdk-qt-version>` when
   the app declares or uses a newer Qt than the SDK (for example Qt 5.15 code
   on a Qt 5.12 SDK). Record the gap as one `CAP-*` row (category
   `qt-api-gap`) listing the hit files, with the scan output as scan evidence,
   and fix those hits in one slice instead of discovering them one build at a
   time.
   A scan is not complete until there is at least one real `CAP-*` row, one
   linked `VAL-*` row, and one executable `CAP-*` queue row. Every open
   inventory row must be named in some queue row's `inventory_ids` (keep or
   no-change capabilities get a verification slice); the gate lists unlinked
   rows. Run
   `validate_ledgers.py ... --phase inventory`; an empty scan must include scope, exclusion,
   command, and negative-control evidence, or the gate remains blocked.
3. **Migration plan contract (`contract`):** choose `ready`,
   `ready-with-decisions`, `blocked`, or `not-recommended`. Only `ready` may
   enter implementation. Freeze the contract and acceptance scenarios.
   External features: run `feature_hooks.py candidates <root> --request "<request>"`,
   show the list to the user, and let the user choose (default: none). Record
   the choice as a user-owned `decisions.tsv` row with
   `feature_or_scope=external-features` and `selected` = feature ids or `none`,
   then `feature_hooks.py activate <root> --decision <DEC>` with one
   `--select` per chosen id. Never select a feature yourself; keyword hits only
   rank candidates.
   A question that returns without an answer (timed out, skipped, dismissed)
   is not a decision: do not record it as `owner=user`/`approved`, and do not
   apply a default on the user's behalf. Ask again (with a longer wait if the
   question tool allows it); if it is still unanswered, leave the decision
   pending, write the open question in `Next executable action`, and stop.
   Evidence quotes the user's reply verbatim; never write it in your own voice
   ("default applied", "按默认"). The gate rejects evidence that records a
   timeout, a skip, or no reply.
   Run `validate_ledgers.py ... --phase contract`. Freeze the contract before any source or
   build edit; repair loops may not silently amend it.
   Only the user can approve removing, stubbing, deferring, or degrading a
   capability. Such a `decisions.tsv` row needs `owner=user` and evidence
   starting with `user:` that quotes or references the user's words (the task
   prompt counts; an unanswered question does not); the gate rejects an
   agent-approved degradation, and every
   `degraded-approved` inventory row must be listed in that decision's
   `affected_ids`. Without that approval, implement the capability or mark it
   `blocked`. An approved decision also binds the implementation: replacing a
   pinned dependency route (for example vendored libraries) with a stub needs
   a new user-approved decision row.
   Compatibility adaptations do **not** count as degradation and need no user
   decision: aligning the application's calls to the real public API of a
   dependency (header path, function/type names, `extern "C"` protection for
   C headers), or honestly reporting a capability the upstream library never
   provided (for example a CLI-only package with no linkable library), is a
   normal implementation edit — record it in `work-queue.tsv` with
   before/after evidence, like any other guarded change. Only when the
   application loses behavior it previously had on another platform does the
   change become a user-owned decision.
4. **Pilot verification (`pilot`):** prove the application envelope, entry target, Qt linkage,
   package generation, and one risky runtime boundary using the selected
   template/deployment generator. Persist the hypothesis/result and independent
   review before broad edits.
   Pilot attempts are recorded in `pilot.tsv` (`PILOT-*` ids, same columns as
   `diagnostics.tsv`): run them with `scripts/batch_checks.py <plan> ...
   --diagnostics <app>/migration/ohos/pilot.tsv --phase pilot` (passing
   `diagnostics.tsv` with `--phase pilot` is routed to `pilot.tsv` as well)
   and classify failures with `record_diagnostic.py <pilot.tsv> --id <PILOT-id>`.
   The pilot must have a `pilot.tsv` row and an OHOS `VAL-*` row before
   it starts, and a reviewed result before it exits. Pilot artifacts are
   explicitly labeled pilot evidence and cannot satisfy the final application
   artifact gate by itself. Read [build-diagnostics.md](references/build-diagnostics.md)
   when the pilot emits a native library or package artifact whose identity is
   unclear.
   Run `validate_ledgers.py ... --phase pilot`.
5. **Capability migration (`implementation`):** implement in build/capability dependency order.
   Open the phase with builds, not reading: build each vendored library
   target, then run the first keep-going build of the application target with
   the minimum guards, and let those receipts order the remaining slices.
   Re-open row evidence and contract decision, make the smallest guarded
   change, append before/after hashes to `work-queue.tsv` 的 change/evidence 字段, run the cheapest
   relevant check, and update inventory/validation: when a queue row closes,
   set the status and evidence of every inventory row in its `inventory_ids`
   in the same edit. Later gates block while an inventory row stays `planned`
   after its queue work is done, and handoff blocks on any open inventory
   row.
   Build vendored third-party libraries and submodules (for example an
   editor component, image or color-picker libraries) as their own targets
   first — one `CAP-*` row each, reusing their upstream CMake/qmake project
   when present — and prove each compiles and links for OHOS before the
   application target consumes it. Never fold third-party sources into the
   application target; separate targets keep AUTOMOC, macro, and include
   scopes isolated and make each failure attributable.
   Third-party acquisition and judgment work driven by the portgraph closure
   (fetch `cmd_only`/`failed`, `need_port` cross-compile, blockers/unknowns
   judgment) is dispatched with forced parallel subagents per
   [third-party-parallel-dispatch.md](references/third-party-parallel-dispatch.md),
   not serially in the main conversation; global-rewrite landing (shared
   pkgconfig dir, single cmake) and shared-prefix installs (`brew install`)
   stay main-agent single-point.
   Before every configure/build/package attempt, record the selected queue row
   and planned validation. After the command returns, immediately record the
   result or first causal failure in `diagnostics.tsv`; then update the
   affected queue, inventory, and validation rows before starting another
   attempt. Run `validate_ledgers.py ... --phase implementation` before broad implementation.
6. **HarmonyOS feature adaptation (`features`):** enter only after the core app envelope
   installs and launches. Run each activated `capability` feature, one at a
   time: `feature_gate.py enter <root> <FEAT>`, follow the package's
   `feature.md` and, when it wraps a skill, that skill's `SKILL.md` — this
   workflow overrides conflicting skill instructions (expand into `CAP-*`/`VAL-*` rows, implement like any slice,
   `feature_hooks.py progress ... --step` per step, list the ids in the
   `FEAT` row), then `feature_gate.py exit <root> <FEAT>`. Only these scripts
   write a `FEAT` status. Never implement a feature that was not activated or
   is absent from the catalog. A feature that cannot finish is closed with
   `feature_hooks.py close ... --status deferred-approved|blocked --decision <DEC>`.
   Run `validate_ledgers.py ... --phase features`.
7. **Build and diagnostics (`diagnostics`):** one build owner emits numbered logs. Pilot
   attempts stay in `pilot.tsv`; `diagnostics.tsv` holds the application
   build, package, install, and device rounds. Run
   configure/build/package/device checks with
   `scripts/batch_checks.py <plan> --output-dir <evidence>/<batch> --diagnostics
   <app>/migration/ohos/diagnostics.tsv --affected-ids <CAP-*,VAL-*> --phase <phase>`.
   The batch writes the receipt row itself: attempt number, exact command,
   tree/plan hash, log path, affected IDs, evidence, and the first error-like
   log line. A failed row is `unclassified`; classify it with
   `scripts/record_diagnostic.py <diagnostics.tsv> --id <DIAG-id> --category ...
   --root-cause ... --next-action ...` (omitted fields keep their values)
   before the next attempt; `batch_checks.py` refuses to start another
   attempt for the same item while a failed row is unclassified. Record the
   first compiler/linker/packager error, not only a later verifier symptom.
   Failure rows are history: each attempt gets its own row, a later passing
   batch turns the earlier failed rows of the same item into `resolved`, and
   no row that recorded a failure may be rewritten as `passed`. When the fix
   is known, put it in `fix_or_next_action`.
   Problems found and fixed outside a batch (a broken SDK/CMake config file,
   a missing host DLL, a wrong deployment directory, a manifest field the
   build rejected) are diagnostics too. Record each as soon as it is fixed:
   `scripts/record_diagnostic.py <diagnostics.tsv> --id new --phase <phase>
   --category <category> --signature "<first error>" --root-cause ...
   --next-action "<fix applied>" --status resolved --affected-ids <ids>`.
   A handoff whose `diagnostics.tsv` holds only success receipts while the
   work needed repairs is incomplete.
   Build with keep-going (`cmake --build <dir> -- -k 0` for Ninja) so one
   attempt reports every failing translation unit; the batch summary lists
   `error_count` and the distinct `errors`. Group them by root cause and fix a
   whole group per attempt. The diagnostics gate rejects a loop that has no
   `batch_checks.py` receipt or leaves `work-queue.tsv` untouched.

   For a failed build, preserve the batch logs, write the diagnostic row,
   classify the root cause, make one minimal source-of-truth change tied to
   the affected queue row, rerun configure when build inputs changed, and
   update all affected ledgers before the next attempt. Do not repeatedly add
   includes or rename libraries without identifying the first causal error.
   For concrete failure signatures and artifact checks, read
   [build-diagnostics.md](references/build-diagnostics.md). Do not hide a
   failure by disabling the verifier or accepting an unrelated artifact.

   Run `validate_ledgers.py ... --phase diagnostics`. Stop after three genuinely different
   attempts for the same blocker, mark the diagnostic `blocked`, and request
   a decision. `batch_checks.py` refuses to rerun a plan whose tree and plan
   hash match an earlier failed receipt; make a recorded change first.
8. **Acceptance and handoff (`handoff`):** climb the strongest actually reached tier
   (`implemented-unverified` through `behavior-verified`), rerun host
   regression after shared changes, audit all unknowns/limitations/TODOs, and
   write the report. Run activated `verification` features with the same
   enter/exit gates; they never edit sources: a defect goes back to the main
   flow, then `feature_gate.py enter --restart`. List every `FEAT` row with
   its status under `report.md` `## External features`.
   Run `validate_ledgers.py ... --phase handoff`. Final success requires evidence for the
   actual application target, its ABI, HAP/package contents, and matching
   entry identity. Pilot artifacts, source diffs, or a verifier summary alone
   do not satisfy handoff. Read
   [build-diagnostics.md](references/build-diagnostics.md) when the target
   artifact is missing or the package identity is uncertain.

At every gate report burndown counts from the TSV ledgers, not conversational
memory. A material change to target stack, scope, dependency, degradation,
signing, or destructive device action requires an explicit user decision.

If the installed skill baseline changes after the manifest pinned it, do not
re-open rows piecemeal: report the drift and let the user decide whether to
restart the migration against the new baseline
(see [knowledge-sync.md](references/knowledge-sync.md)).

## 4. Non-negotiable safety and quality rules

- Do not run any configure, build, package, signing, install, or device
  command for the target while `migration/ohos/STATE.md` is missing; create
  the ledger first (section 0).
- Preserve non-HarmonyOS paths; use `Q_OS_OHOS`, `OHOS`, qmake `ohos` scopes,
  CMake platform guards, adapters, or platform-specific files.
- Modify source-of-truth project files, never generated output or SDK installs.
- Do not create one target file per source file or a parallel application tree
  merely to imitate a language migration.
- Do not silently replace unsupported modules, permissions, lifecycle, or
  behavior with stubs. Record `unknown`/`blocked` or an explicitly approved
  `degraded-approved` disposition backed by a user-owned decision
  (`owner=user`, evidence `user: ...`); the agent cannot approve it.
- Keep the contract read-only during implementation/repair loops; apply queued
  amendments between rounds and revalidate affected rows.
- Serialize expensive cross-compiles, packaging, signing, installation, and
  device operations. Parallelize only disjoint discovery or implementation
  scopes. Third-party dependency work (judgment / fetch / cross-compile) is
  the one forced parallel exception, gated by the thresholds in
  [third-party-parallel-dispatch.md](references/third-party-parallel-dispatch.md);
  each threshold counts its own unit from the closure output (`analyze`
  blockers + unknowns ≥3 for judgment, per-library-landing cmd_only/failed ≥2
  for fetch, need_port + unrecovered failed ≥1 for cross-compile), never the
  number of libraries. It must
  never touch shared artifacts — global-rewrite landing (shared pkgconfig
  dir, single cmake), shared-prefix installs (`brew install`), and the
  ledgers stay main-agent single-point.
- Never store credentials, signing keys, tokens, full device identifiers, or
  unredacted user data in migration records.

## Supporting references

- Read [knowledge-sync.md](references/knowledge-sync.md) when selecting,
  syncing, updating, or reviewing KB files.
- Read [migration-workflow.md](references/migration-workflow.md) for phase
  gates, queue semantics, and evidence rules.
- Read [external-features.md](references/external-features.md) when
  selecting, activating, or running external features (phases 3, 6, 8).
- Read [third-party-parallel-dispatch.md](references/third-party-parallel-dispatch.md)
  when third-party dependency work (judgment / fetch / cross-compile) follows
  from the portgraph closure; it owns the forced-parallel thresholds and the
  split/prompt/merge convention.
- During the migration, load the skill-baseline pages relevant to the current
  task; do not preload the entire knowledge base.









# Design analysis and adopted plan

## Reference findings

### `ohos_qt-skills`

The knowledge base already has the right domain routing: `_index` selects a
task, `golden-rules` supplies non-negotiable constraints, semantic pages explain
Qt/HarmonyOS behavior, procedural pages describe execution, and `problems`
captures observed failures. Its release manifest provides upstream revisions and
content hashes. The important limitation for a migration skill is lifecycle:
the KB is a separately evolving checkout, so copying prose into a skill would
create a stale fork and make updates hard to audit.

### `code-migration-kit-with-claude-code-main`

The useful process mechanics are feasibility-first assessment, explicit gates,
disk-backed queues, stable manifests, burndown reporting, independent review,
serialized expensive verification, and a rule that recurring failures repair the
process rather than accumulate local patches. Its file-by-file translation and
language rulebook do not transfer to a Qt framework port.

### `qt-experiments-main`

The existing HarmonyOS skill correctly models a capability/integration inventory,
porting contract, validation ladder, diagnostics loop, and host-regression
preservation. Its templates and references are a good execution baseline. The
main missing piece is provenance for the external, changing KB; the new design
adds a pinned provenance manifest without changing the upstream checkout.

## What the first design missed

The original experiment and first draft persisted mostly aggregate state:
current phase, one capability inventory, validations, diagnostics, and a final
report. That answers “where did we stop?” but not the harder resume questions:

- Which installed Qt/SDK/template observation made this decision valid?
- Which source target, runtime plugin, package artifact, and validation depend
  on this capability?
- Which KB section was actually used, and what becomes stale after a KB update?
- Which file was changed for which contract row, and was the host path retested?
- Did packaging contain the correct native closure, independently of build
  success?
- Did install, launch, survival, render, and behavior each pass?
- Is a repeated failure a local bug or evidence that the scanner/adapter/contract
  must change?

The expanded design therefore persists provenance and relationships rather
than only terminal status.

## Adopted architecture

```text
ohos_qt-skills (read-only source)
        │ maintainer-only upstream-kb/scripts/sync_upstream.py (plan/review/apply)
        ▼
skill/upstream-kb/knowledge/ + skill/upstream-kb/manifest.tsv  ← reviewed release baseline
        │ project-only sync_knowledge.py: pin provenance, copy nothing
        ▼
app/migration/ohos/knowledge-manifest.tsv  ← pinned evidence chain
        │ used/modified rows; local files only for adapted pages
        ▼
assessment/environment/baseline → topology/capability graph
        → contract/decisions → pilot/reviews → work queue/changes
        → diagnostics/package/device → validation → report
```

A migration is a short run measured in hours, and its knowledge baseline is
frozen for the whole run, so the project inherits provenance rather than
pages. `sync_knowledge.py` verifies the baseline and pins the
baseline-manifest hash plus per-page upstream/skill hashes into the project
manifest without copying files; agents read baseline pages in place. Only a
page the target genuinely adapted is stored locally and registered as
`modified=yes` with the exact basis version. `knowledge-manifest.tsv` keeps the
citation edge from pages to decisions within the run. If the released baseline
changes, sync and validation report the drift; the user decides whether to
restart the migration against the new baseline.

## Why the work unit is a capability slice

Qt-to-HarmonyOS usually preserves C++/QML. A meaningful unit therefore spans
source, CMake/qmake, plugins/resources, packaging, and a validation scenario;
one source file is not a reliable completion boundary. The queue is inventory
row driven and ordered by build/capability dependencies, with a pilot for the
application envelope before broad implementation.

## Update policy

The source KB remains external, read-only, and outside the project trust
boundary. A migration may locally adapt a baseline page only when the change is
needed for the target: the adapted copy is stored in the project and
registered as `modified=yes` with baseline provenance and reason. Upstream
changes reach a project only through a reviewed new skill baseline. No project
may import an upstream file directly, and a changed baseline is a user restart
decision, never a silent merge.

## Derived persistence layers and their migration value

1. **Evidence layer** — assessment, environment, baseline, topology, knowledge
   usage. This prevents stale module matrices, Qt5/Qt6 mixing, host binaries,
   generated-file edits, and repeated source discovery.
2. **Decision layer** — contract, decisions, capability graph, amendments. This
   turns window ownership, lifecycle, dependency, packaging, and degradation
   choices into stable policy rather than per-file guesses.
3. **Execution layer** — work queue, pilot, reviews, changes, diagnostics. This
   makes the next capability mechanically discoverable and recurring failure
   patterns reusable.
4. **Proof layer** — package manifest, device runs, validation, report. This
   preserves the important distinction between build, HAP contents, install,
   launch, process survival, rendering, and behavior.
5. **Economics layer** — cost log. This measures whether the preflight, pilot,
   review topology, and serialized build loop are worthwhile for the actual
   Qt application instead of importing another migration kit's estimates.

See [persistence-model.md](persistence-model.md) for the schema-by-schema
mapping and invalidation rules.


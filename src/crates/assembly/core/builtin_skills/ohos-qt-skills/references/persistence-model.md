# Migration persistence model

What `migration/ohos/` holds and why each artifact exists. Column meanings,
values and writers: `ledger.py columns <ledger>`; value sets: `scripts/vocab.py`.
The durable unit is a claim with evidence, a decision, a capability slice, an
observation or a validation, never a chat message or an edited file alone.

## Artifacts

`STATE.md`, two prose documents, the tool outputs the gates read, and the nine
TSV ledgers plus the generated `knowledge-manifest.tsv`:

| Artifact | Records | Why a Qt port needs it |
|---|---|---|
| `STATE.md` | Scope (application target with its authoritative build file as evidence, Qt source root, the HarmonyOS output project next to `migration/` in the output container, source revision and dirty paths at the start), assessment verdict with basis and deciding risk, completion tier, gate, progress, next action | the one file to resume from; the gate writes the phase fields, the agent the rest through `ledger.py state`; the decisions gate needs the Scope filled |
| `report.md` | final claims, limitations, evidence, next commands, external features, decisions made on the user's behalf | honest delivery at the strongest tier proven; every headline maps to a ledger row or evidence path |
| `env-smoke.json` | the latest environment smoke test: stages and the runtime result | proves the environment end to end before any application work; the phase 1 gate needs it passed, and with a connected device (environment.tsv) its runtime passed too; written only by `env_smoke.py` |
| `preflight.json`, `preflight-configured.json` | static build-file findings (`PF-*`); audit of the app's configured OHOS build files | build-system traps become inventory rows before the first build |
| `closure/` | portgraph outputs, `summary.json` with the dispatch counts and their sources | mandatory dependency evidence; reproducible dispatch decision |
| `environment.tsv` | one row per environment item (host, Qt SDK, template, DevEco (on a HarmonyOS PC the SDK of DEVECO_SDK_HOME), devecocli, OpenHarmony SDK, make, device, and the items this host/app needs or has: JBR, signing, llvm-mingw, Qt host, CMake...): path, version, status, the problem and its fix, the variables injected into every tool | the one place an environment fix lives; written only by `env_probe.py` as a whole table; catches host/target and Qt5/Qt6 mixing |
| `inventory.tsv` | one row per capability or gap that does not work as is on OHOS: location, cause, the finding behind it (`found_by`), disposition, target behavior; final at the inventory gate, no status: the outcome is the state of the TASK rows that name it | orders work by capability across CMake, C++, QML, plugins and HAP, not by file |
| `decisions.tsv` | the questions asked and the answers, with who answered (`user`, `agent-default`) | one place for the user's migration choices (identity, signing, device, degradations, routes); external-feature answers are not here; no gate reads it |
| `tasks.tsv` | slices of the tasks phase (`TASK-*`): what each does, the INV rows it handles, its VAL rows, status, evidence | the mechanical next step; the outcome of every inventory row it names; every source-of-truth edit has one row |
| `diagnostics.tsv` | one row per problem: where it showed, symptom, cause, how to reproduce, fix, status (`open`/`fixed`/`blocked`/`accepted-limitation`) | keeps every problem met and how it was fixed; passing batches write nothing; no problem stays open past the diagnostics gate |
| `device-runs.tsv` | one row, the application HAP's latest result: path and bundle, status (`hap-failed`/`checked`/`no-device`/`run`), evidence (the batch and `hap_check.py` verdict; after a run process running, clean hilog, no new crash log, logs) | where the final HAP is and whether it passed `hap_check.py` and ran on the device; rewritten by the `hap_check.py` step of `batch_checks.py` and by `device_run.py run --record`; failures are diagnostics problems, smoke-test and envelope HAPs are never written; HAP contents are `hap_check.py`'s job |
| `features.tsv` | activated external features (`FEAT-*`) with entry/exit gate records and the user's answers in `notes`; a feature writes no other ledger row | gated, auditable feature work; written only by `feature_hooks.py`/`feature_gate.py` |
| `validation.tsv` | one acceptance scenario per row: what, how it is checked, expected result, status (`planned`/`passed`/`failed`/`accepted-limitation`/`not-applicable`), what was observed and where the proof is | makes sandbox, window, lifecycle, plugin and degradation claims testable; `planned` is never a pass, the validation gate needs every row done |
| `knowledge-manifest.tsv` | pinned baseline hash, per-page provenance, used/modified marks | the exact knowledge the migration used without copying it (references/knowledge-sync.md) |

## Invariants

- A fact lives in one artifact; documents cite ledger ids instead of copying
  rows, and `ledger.py state`/`decisions` show them together with the ledgers.
- A clean scanner or verifier counts only with its scope and a negative
  control: a zero-candidate scan needs checked patterns, exclusions and one
  expected match or fixture; a package checker that cannot fail on a
  deliberately omitted plugin is not evidence.
- When the SDK or device changes, environment, package and device evidence is
  refreshed; source decisions whose provenance still holds stay.
- A reusable fix is the problem row's `fix`; maintainers promote generic ones
  to `assets/known-issues.tsv` (`known_issues.py candidates`).
- Never persist credentials, signing keys, tokens, full device identifiers,
  raw user data, generated SDK internals, or chat prose as the only state.

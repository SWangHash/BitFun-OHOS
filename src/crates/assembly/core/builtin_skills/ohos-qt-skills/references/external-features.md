# External features (hooks)

The migration flow is the host; external features are hooks on it. A feature
package declares where it hooks in, how it is chosen, and what "done" means;
the skill only registers, activates, admits (entry gate), and closes (exit
gate) it. What happens inside a feature is the package's business (gray box).

| kind | Hook point | Purpose | May edit app sources |
|---|---|---|---|
| `capability` | phase 6 `features` | HarmonyOS-specific capabilities beyond an equivalent port (tap-to-transfer, continuation, share, …) | yes, inside platform guards |
| `verification` | phase 8 `handoff` | another team's acceptance flow run against the final HAP | no — defects go back to the main flow |

No other phase accepts hooks.

## Sources and trust boundary

```text
features/registry.tsv + features/<id>/{hook.json,feature.md,checks/}  ← skill-native, reviewed
        │ chosen by the user at phase 3, package hash pinned on activation
        ▼
app/migration/ohos/feature-adoption.tsv                               ← per-project state
app/migration/ohos/features/FEAT-NNN/                                 ← per-feature workdir (logs, evidence)
        │ capability: expands into CAP-*/VAL-* rows
        ▼
work-queue.tsv / inventory.tsv / validation.tsv / device-runs.tsv     ← existing machinery
```

- Packages live only in this repository's `features/`, are written by the
  maintaining agent following `features/RULES.md` and `features/REGISTER.md`
  (developers only deliver a skill, see `features/README.md`), and are checked with
  `feature_hooks.py lint`. A migration agent never edits `features/` and never
  runs a feature that is not registered and activated. A missing feature is a
  blocker plus a request for a catalog addition.
- `draft` registry entries are neither offered nor activatable.
- Every feature is delivered as a complete skill. The package keeps it
  unchanged in `features/<id>/skill/`; `hook.json` and the adapter
  `feature.md` sit outside it. Such a skill is never installed where it could
  trigger by itself and is read only after its entry gate is READY.

## Selection and activation (phase 3)

1. `feature_hooks.py candidates <root> --request "<user request>"` lists every
   non-draft registered feature, grouped by hook point. `trigger.keywords`
   that appear in the request only move a feature up the list.
2. The user chooses; the default is none. Record one `decisions.tsv` row:
   `feature_or_scope=external-features`, `selected` = space-separated feature
   ids or `none`, `owner=user`, `status=approved`, evidence `user: ...`.
   "Default: none" describes what the user is offered, not what the agent may
   record: if the question times out or is skipped, ask again; if it stays
   unanswered, leave the decision pending and stop. Evidence that records a
   timeout or no reply is rejected by `activate` and by the gates.
   Mirror the choice in `PORTING_CONTRACT.md` `## External features`.
3. `feature_hooks.py activate <root> --decision <DEC> --select <id> ...`
   writes one `FEAT-NNN` row per feature (`planned`, attempts 0, pinned
   `package_sha256`) and the `## External features` table in `STATE.md`.

The contract gate requires this decision whenever the registry holds a
non-draft feature, and every selected id must have a row.

## Running a feature (phases 6 and 8)

Features of one host phase run one at a time.

1. `feature_gate.py enter <root> <FEAT>` checks: the host phase is open, the
   features in `hook.after` are closed, no other feature of the phase is
   in progress, the package hash still matches, and `entry.requires` holds.
   READY turns the row `in-progress` and creates the workdir; verification
   features also record the app source fingerprint.
2. Follow the package's `feature.md`, then read `skill/SKILL.md` (`enter`
   prints its path) and resolve the
   skill's relative paths against that directory. The adapter and this
   workflow win over the skill's own instructions (its phases, state files,
   dependency installs, "fix what you find"); the skill's state and outputs
   go only to the workdir, its results count only once they are ledger rows,
   and the skill directory is never edited. Call
   `feature_hooks.py progress <root> <FEAT> --step "<step>"` at each step.
   Capability features list their `CAP-*`/`VAL-*` ids in the row's
   `capability_ids`/`validation_ids`; verification features list `VAL-*`.
3. `feature_gate.py exit <root> <FEAT>` evaluates `exit.criteria` plus the
   implicit criteria (package unchanged, no open linked diagnostic, listed
   `VAL-*` all passed; capability: listed `CAP-*` closed and, with
   `device=true`, a passed `device-runs.tsv` row covering them; verification:
   app sources unchanged since entry). READY → `passed` with
   `exit_gate=READY @<ts> digest=<hash>`; otherwise `attempts` grows and the
   unmet criteria are printed. Past `max_attempts`, continuing needs a
   user-approved decision passed via `--decision`.
4. A verification feature that finds a defect records it (failed `VAL-*`,
   diagnostic with the `FEAT` id in `affected_ids`) and stops. Fix it in the
   main flow, then `feature_gate.py enter --restart <root> <FEAT>` and rerun.
5. A feature that cannot finish is closed with
   `feature_hooks.py close <root> <FEAT> --status deferred-approved|blocked --decision <DEC>`;
   `deferred-approved` needs a user-approved decision.

Statuses are written only by these scripts. The host phase gate requires
every row of that phase to be terminal (`passed`, `deferred-approved`,
`blocked`), re-computes the evidence digest of each `passed` row, and at
`handoff` requires `report.md` `## External features` to list each `FEAT`
with its status.

## Frozen packages

The pinned `package_sha256` covers the whole package (hook, playbook, check
scripts). If a package changes while its row is not terminal,
`feature_gate.py enter`/`exit` refuse and `validate_ledgers.py` warns. Report
the drift; only after a user decision run
`feature_hooks.py repin <root> <FEAT> --decision <DEC>`.

## Legacy ledgers

A `feature-adoption.tsv` with the old `playbook_path` header (no `host_phase`)
keeps the old rules: rows end `verified`, `deferred-approved`, `blocked`, or
`not-applicable`. `verified` is read as a legacy alias of `passed`.

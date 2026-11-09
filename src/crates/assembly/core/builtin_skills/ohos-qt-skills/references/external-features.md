# External features (hooks)

The migration flow is the host; external features are hooks on it. A feature
package declares where it hooks in, how it is chosen, and what "done" means;
the skill only registers, activates, admits (entry gate), and closes (exit
gate) it. What happens inside a feature is the package's business (gray box).

| kind | Hook point | Purpose | May edit app sources |
|---|---|---|---|
| `capability` | phase 6 `features` | HarmonyOS-specific capabilities beyond an equivalent port (tap-to-transfer, continuation, share, …) | yes, inside platform guards |
| `verification` | phase 7 `validation` | another team's acceptance flow run against the final HAP | no — defects go back to the main flow |

No other phase accepts hooks: phases 1-5 are the base Qt migration and know
nothing about external features.

## Sources and trust boundary

```text
features/registry.tsv + features/<id>/{hook.json,feature.md,checks/}  ← skill-native, reviewed
        │ chosen by the user at phase 6, activated by feature_hooks.py
        ▼
app/migration/ohos/features.tsv                               ← per-project state
app/migration/ohos/features/FEAT-NNN/                                 ← per-feature workdir (logs, evidence)
```

A feature's whole record is its `features.tsv` row and its workdir. The
user's answers about it (selection, retry, deferral) go into the row's
`notes`, never into `decisions.tsv`, and a feature adds no `inventory.tsv`,
`tasks.tsv` or `validation.tsv` rows. The only other ledgers that change while
it runs are written by the main-flow scripts: `diagnostics.tsv` (failed
rounds) and `device-runs.tsv` (the application HAP's latest result); `hook.json`
`outputs.ledgers` may name only these two.

- Packages live only in this repository's `features/`, are written by the
  maintaining agent following `features/RULES.md` and `features/REGISTER.md`
  (developers only deliver a skill, see `features/README.md`), and are checked with
  `feature_hooks.py lint`. A migration agent never edits `features/` and never
  runs a feature that is not registered and activated. A missing feature is a
  blocker plus a request for a catalog addition.
- Every feature is delivered as a complete skill. The package keeps it
  unchanged in `features/<id>/skill/`; `hook.json` and the adapter
  `feature.md` sit outside it. Such a skill is never installed where it could
  trigger by itself and is read only after its entry gate is READY.

## Selection and activation (phase 6, first step)

The selection is the first step of the `features` phase; nothing about
features is offered or asked earlier.

1. `feature_hooks.py candidates <root> --request "<user request>"` lists every
   registered feature, grouped by hook point. `trigger.keywords`
   that appear in the request only move a feature up the list.
2. The user chooses; the default is none and the agent never selects. Ask
   with `AskUserQuestion` without `autoDecideAfterSeconds`
   (`timeout_seconds: 1800`); a timeout or no reply is not an answer. The
   question is not written into `decisions.tsv` and is not a plan amendment;
   the FEAT rows and `report.md` carry the selection.
3. `feature_hooks.py activate <root> --answer "<user's words>" --select <id> ...`
   writes one `FEAT-NNN` row per feature (`planned`, attempts 0, the answer
   in `notes`); `ledger.py state` and `feature_hooks.py status` show them.
   When the user selects nothing, no row is written.
   It refuses while the `features` phase is not open (an earlier gate has
   not passed) or after its gate closed it.

Every selected id must have a row. Earlier gates do not look at external
features.

## Running a feature (phases 6 and 7)

Features of one host phase run one at a time. Capability features run in
`features` after the selection; their rebuild, package, and device rounds go
through `batch_checks.py` like any other build
([build-diagnostics.md](build-diagnostics.md)).

1. `feature_gate.py enter <root> <FEAT>` checks: the host phase is open, the
   features in `hook.after` are closed, no other feature of the phase is
   in progress, and `entry.requires` holds. READY turns the row
   `in-progress` and creates the workdir.
2. Follow the package's `feature.md`, then read `skill/SKILL.md` (`enter`
   prints its path) and resolve the
   skill's relative paths against that directory. The adapter and this
   workflow win over the skill's own instructions (its phases, state files,
   dependency installs, "fix what you find"); the skill's state and outputs
   go only to the workdir (changes made, cases run, the verdict file its exit
   criteria read), and the skill directory is never edited. Call
   `feature_hooks.py progress <root> <FEAT> --step "<step>"` at each step;
   an answer the user gives meanwhile goes in with `--note`.
3. `feature_gate.py exit <root> <FEAT>` evaluates `exit.criteria` plus the
   implicit criteria (no `open` problem in `diagnostics.tsv`; with
   `device=true`, `device-runs.tsv` status `run`: the latest HAP ran on the device).
   READY → `passed` (`exit_gate` keeps the reason of the last failed attempt,
   empty when the first one passed); otherwise `attempts` grows, `exit_gate`
   records the unmet criteria and they are printed. Past `max_attempts`, continuing needs
   the user's answer: `feature_gate.py exit <root> <FEAT> --answer "<user's words>"`
   resets the counter and records the answer in `notes`.
4. A verification feature that finds a defect records it (failed case in its
   workdir report, problem in `diagnostics.tsv` naming the `FEAT` id) and stops. Fix it in the
   main flow, then `feature_gate.py enter --restart <root> <FEAT>` and rerun.
5. After `max_attempts` failed exits the feature is `blocked`, waiting for the user.
   A feature the user gives up is deferred with
   `feature_hooks.py close <root> <FEAT> --answer "<user's words>"` (`deferred-approved`);
   the answer goes into `notes`; `exit_gate` keeps the last failure reason.

Statuses are written only by these scripts. The host phase gate requires
every row of that phase to be terminal (`passed`, `deferred-approved`), and
the user's answer to the feature selection (STATE.md `Feature selection`,
written by `candidates`/`activate`) when features are registered; at `validation` it requires `report.md` `## External features` to list each `FEAT`
with its status.

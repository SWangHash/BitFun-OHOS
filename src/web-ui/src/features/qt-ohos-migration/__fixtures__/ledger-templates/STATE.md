# HarmonyOS migration state

Only what no ledger holds. Read it with `ledger.py state <root>`, which adds the
live views of the ledgers (environment, env smoke, capability dispositions,
decisions, external features, knowledge baseline). The agent writes its fields with
`ledger.py state <root> --set "<field>=<value>"`; the gate writes Current phase,
Last gate and the Progress status and Gate (every ledger write also refreshes the
open phase's status: blocked / failed / in-progress); feature_hooks.py writes
Feature selection. Progress Status `blocked` means waiting for the user; Gate is the
phase's latest gate verdict (`READY`, or `NOT-READY` with the unmet count).

## Scope and target

| Field | Value | Evidence |
|---|---|---|
| Application target | TODO | TODO |
| Qt source root | TODO | TODO |
| HarmonyOS output project | TODO | TODO |
| Source revision at start | TODO | TODO |

## Gate

- Assessment: `TODO` (`ready` / `blocked` / `not-recommended`)
- Verdict basis: TODO
- Deciding risk: TODO
- Current phase: `TODO`
- Last gate: `TODO` (written by `validate_ledgers.py --phase` / `phase_gate.py`)
- Completion tier: `TODO` (`implemented-unverified` → `scenario-verified`)
- Feature selection: `TODO` (`pending` / `answered`, written by `feature_hooks.py`)
- Next executable action: `TODO`

## Progress

| Phase | Status | Gate |
|---|---|---|
| Environment (`environment`, environment.tsv) | planned |  |
| Inventory (`inventory`, inventory.tsv) | planned |  |
| Decisions (`decisions`, decisions.tsv) | planned |  |
| Tasks (`tasks`, tasks.tsv) | planned |  |
| Diagnostics (`diagnostics`, diagnostics.tsv) | planned |  |
| Features (`features`, features.tsv) | planned |  |
| Validation (`validation`, validation.tsv) | planned |  |

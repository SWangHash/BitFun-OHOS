# HarmonyOS migration state

## Scope and target

| Field | Value | Evidence |
|---|---|---|
| Project / repository | TODO | TODO |
| Migration output (container / project inside it) | TODO | TODO |
| Source revision / dirty baseline | TODO | TODO |
| Qt distribution and version | TODO | TODO |
| HarmonyOS SDK/API and ABI | TODO | TODO |
| Template/deployment/build/package route | TODO | TODO |
| Host platforms and essential flows | TODO | TODO |

## Gate

- Assessment: `TODO` (`ready` / `ready-with-decisions` / `blocked` / `not-recommended`)
- Current phase: `TODO`
- Last gate: `TODO` (written by `validate_ledgers.py --phase` / `phase_gate.py`)
- Completion tier: `TODO` (`implemented-unverified` → `behavior-verified`)
- Last updated: `TODO`
- Last completed action: `TODO`
- Next executable action: `TODO`
- Resume check: run `validate_ledgers.py --phase <current phase>` and inspect pending `work-queue.tsv` rows
- After a context compaction: trust the newest `diagnostics.tsv` row and its `log_path`, not the summary

## Progress

| Phase | Status | Evidence / next action |
|---|---|---|
| Environment preparation (`baseline`, environment.tsv) | planned | TODO |
| Migration inventory (`inventory`, inventory.tsv) | planned | TODO |
| Migration plan contract (`contract`, decisions.tsv) | planned | TODO |
| Pilot verification (`pilot`, pilot.tsv) | planned | TODO |
| Capability migration (`implementation`, work-queue.tsv) | planned | TODO |
| HarmonyOS capability features (`features`, feature-adoption.tsv) | planned | TODO |
| Build and diagnostics (`diagnostics`, diagnostics.tsv) | planned | TODO |
| Acceptance and handoff (`handoff`, validation.tsv) | planned | TODO |

## External features

Written by `feature_hooks.py` / `feature_gate.py`; do not edit by hand.

No external feature activated.

## Invalidation rules

| Changed external state | Evidence to invalidate and refresh |
|---|---|
| Used KB page or source revision | linked `knowledge-manifest.tsv` rows and affected inventory/contract/pilot/diagnostic rows |
| Qt/HarmonyOS SDK, ABI, template, or tool version | `environment.tsv`, configure/build/package evidence, affected package rows |
| Device, signing profile, bundle identity, or installed data | `device-runs.tsv` and install/launch/behavior validation rows |
| Shared source or root build file | host baseline, affected capability rows, package evidence, host regression |

## Decisions and blockers

| ID | Decision/blocker | Evidence | Owner/status | Next action |
|---|---|---|---|---|
| DEC-001 | TODO | TODO | TODO | TODO |

## Evidence policy

Keep raw logs/screenshots local or gitignored. Track only redacted summaries,
safe paths, and digests. Never store credentials, signing material, tokens, or
unredacted user/device data.


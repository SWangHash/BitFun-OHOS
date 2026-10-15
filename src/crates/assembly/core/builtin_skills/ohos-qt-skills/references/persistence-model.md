# Qt/HarmonyOS migration persistence model

The durable unit is a claim with evidence, a decision, a capability slice, an
observation, or a validation—not a chat message and not merely an edited file.
Keeping these objects separate makes a later session resume at the exact next
action and makes a knowledge-base update trigger only the affected re-review.

| Artifact | What it records | Why it matters to a Qt port | Resume invariant |
|---|---|---|---|
| `assessment.md` | feasibility calls, assumptions, sampled scope, cost | prevents Qt6 code being sent to a Qt5 kit, or a library-only tree being treated as an app | every claim cites source/SDK/command evidence |
| `environment.tsv` | exact Qt host/target kits, SDK/API, ABI, tools, template, signing/device availability | separates a support matrix from the installed kit; catches host/target and Qt5/Qt6 mixing | drift-prone rows are refreshed before build/device work |
| `baseline.tsv` | source revision, dirty paths, host build/tests/smoke results | distinguishes inherited failures from regressions caused by OHOS guards | capture before edits and rerun after shared-source edits |
| `inventory.tsv` 的 source_location/files 字段 | targets, entry points, generated/vendor paths, source-of-truth files, platform seams | prevents editing generated ArkTS/build output; exposes `Q_OS_LINUX` overlap | every changed file has an owning target and source class |
| `inventory.tsv` 的 prerequisites/dependency 字段 | capability/module → source → Qt/runtime plugins → package artifacts → validations | orders work across CMake, C++, QML, plugins, and HAP rather than by filename | no node closes while a prerequisite is unresolved |
| `inventory.tsv` 的扫描证据字段 | scanner scope, exclusions, commands, counts, and candidate disposition | proves that “no match” means a checked scope; prevents missed seams and invented rows from generated/vendor code | every in-scope candidate links to an inventory row or explicit exclusion |
| `knowledge-manifest.tsv` | pinned skill-baseline set hash, upstream/skill provenance per page, used/modified/action | pins the exact knowledge version the migration used without copying it; local files exist only for registered adapted pages | every page read resolves to the pinned baseline version; every local knowledge file is a registered modification |
| `knowledge-manifest.tsv` 的 used 字段和 evidence 引用 | page section/claim → inventory/decision/diagnostic IDs | cites the KB input behind each decision inside the frozen run | every nontrivial decision/fix has a page citation |
| `PORTING_CONTRACT.md` | stable Qt/SDK, isolation, module, lifecycle, packaging, target behavior decisions | stops implementers inventing incompatible window, plugin, or degradation policy | read-only during repair loops; amendments between rounds |
| `inventory.tsv` | one evidence-backed compatibility gap/capability row | covers modules, QML/plugins, Linux branches, OS APIs, windows, sandbox, ABI, packaging | row closes only with linked validation evidence |
| `work-queue.tsv` | slice, prerequisites, status, attempts, owner, evidence | provides a mechanical next step for capability work | pending rows selected from dependency/status, not memory |
| `feature-adoption.tsv` | user-activated external features (`FEAT-*`): kind, host phase, pinned package hash, status, attempts, entry/exit gate records, linked capability/validation rows | makes HarmonyOS capability additions and external verification flows gated and auditable instead of ad-hoc work | statuses are written only by `feature_hooks.py`/`feature_gate.py`; `passed` needs an exit-gate digest that still matches; the package hash stays frozen |
| `pilot.tsv` | risky-slice hypothesis, exact inputs, result, independent review | catches template, entry, library-name, QPA, and lifecycle errors before broad edits | pilot output may be discarded; decision/evidence survives |
| `STATE.md`、`decisions.tsv` 与 `validation.tsv` | phase entry/exit criteria, status, evidence, invalidation trigger | prevents silently skipping feasibility, judge, pilot, package, or device gates | later gates cannot close while prerequisites are stale |
| `validation.tsv` 的 reviewer/evidence 字段 | reviewer, scope, finding, source/SDK evidence, resolution | adds a second context on high-blast-radius CMake/ArkTS/package changes | findings are read-only and link to a change ID |
| `work-queue.tsv` 的 change/evidence 字段 | changed file/area, before/after hashes, reason, IDs, reviewer, validation | answers exactly what was modified and why; proves platform isolation | every source-of-truth edit has one row |
| `diagnostics.tsv` | first causal signature, stage, root cause, fix, recurrence | prevents repeating configure/link/package/runtime mistakes and keeps the record of every problem met and how it was fixed | one row per attempt or root cause, not per repeated log line; failure rows become `resolved`, never `passed` |
| `diagnostics.tsv` 的 attempt/build/log 字段 | numbered attempt, tree/environment hash, command, error counts, log digest | makes the serialized build loop resumable and shows whether errors converge | one build owner per round; raw logs stay outside ledgers |
| `package-manifest.tsv` | final HAP contents, native libs, DT_NEEDED, plugins/QML/resources, identity | catches missing `libqohos`, wrong `.so`, wrong ABI, absolute host paths | package claims come from final payload inspection |
| `device-runs.tsv` | redacted device/profile/bundle context, install/launch/process/log/UI observations | separates install success, process survival, rendering, and feature behavior | refresh device state before each run |
| `validation.tsv` 的 negative_control 字段 | known-bad fixtures or safe negative controls and expected failures | proves a green package/scenario checker can detect missing plugins, wrong ABI/identity, or behavior regressions | false negatives block trust in the verifier |
| `validation.tsv` | scenario, expected target behavior, host comparison, evidence | makes sandbox, window, lifecycle, QML/plugin, and degradation claims testable | `not-run` is never a pass |
| `decisions.tsv` | user-owned options, impact, approval, affected IDs | records permission to remove/degrade modules, change identity, or choose a target route | material decisions are immutable; changes become new decisions; a degrading/stubbing row needs `owner=user` and evidence `user: <quote or prompt reference>` |
| `diagnostics.tsv` 的 recurrence/next_action 字段 | recurring failure/process rule and affected rows | moves repeated failures into a shared adapter, scanner, or contract | apply between rounds, then re-sweep |
| `knowledge-manifest.tsv` 的哈希与 used 状态 | used KB page hashes before/after, change summary, affected IDs | preserves why a KB update invalidated a specific Qt decision | every used-page update gets an impact review |
| `report.md` 的成本与过程备注 | phase duration, units, review topology, model/tool cost | reveals whether preflight/pilot/serialization saves time for this project | append-only machine-readable receipt |
| `report.md` | final claims, limitations, evidence and next commands | honest handoff at the strongest tier actually proved | every headline maps to a ledger/evidence path |

## State graph

```text
Pinned KB manifest → assessment/environment/baseline → inventory
        → contract/decisions → pilot → work queue → feature adoption
        → diagnostics/package → device runs → validations → report
```

If the installed skill baseline no longer matches the pinned manifest hash,
sync and validation report the drift; the user decides whether to restart the
migration against the new baseline. Never obtain a missing or newer page
directly from `ohos_qt-skills`. If the SDK/device changes, invalidate
environment, package, and device evidence while retaining source decisions
whose provenance remains valid.

Before trusting a clean scanner or verifier, persist its scope and a negative
control. A zero-candidate scan is valid only after checking patterns,
exclusions, and at least one expected match or fixture. A package checker that
cannot fail on a deliberately omitted QPA/plugin is not evidence.

Do not persist credentials, signing keys, tokens, full device IDs, raw user data,
generated SDK internals, or chat prose as the only state. New reusable fixes go
to `diagnostics.tsv` 的 recurrence/next_action 字段 first; publish a separate upstream KB contribution only
after review and approval.





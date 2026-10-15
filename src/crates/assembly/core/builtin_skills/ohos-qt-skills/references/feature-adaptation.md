# HarmonyOS feature adaptation

Phase 6 of the gated workflow adds HarmonyOS-specific capabilities —
tap-to-transfer (碰一碰), continuation, share, and similar system features that
go beyond an equivalent platform port. The phase reuses the capability-slice
machinery; only its input (the feature catalog) and its ledger
(`feature-adoption.tsv`) are new.

## Sources and trust boundary

```text
features/registry.tsv + features/<id>/feature.md   ← skill-native, reviewed
        │ adopted at phase 6, playbook hash pinned
        ▼
app/migration/ohos/feature-adoption.tsv              ← per-project state
        │ expands into CAP-*/VAL-* rows
        ▼
work-queue.tsv / inventory.tsv / validation.tsv    ← existing machinery
```

- The catalog is authored and reviewed by the skill maintainer; a migration
  agent never edits `features/` and never implements a feature that is absent
  from `registry.tsv`. A missing feature is a blocker row plus a request to add
  a catalog entry — the same policy as a missing knowledge page.
- `draft` catalog entries may not be adopted. Only `stable` and `beta` rows
  are eligible, and `beta` adoption must be an explicit user decision.

## Selection at the contract gate (phase 3)

When the user asks for HarmonyOS-specific features, scan the request against
`triggers` in `features/registry.tsv`, list matching entries with their
requirements, and record the user's selection in `PORTING_CONTRACT.md` (new
features section) and `decisions.tsv`. Selection freezes scope; implementation
waits for phase 6.

## Adoption and implementation (phase 6)

Entry gate: the core application envelope installs and launches (pilot passed,
core capability slices closed). Then, per adopted feature:

1. Create a `FEAT-*` row in `feature-adoption.tsv`: `feature_id`,
   `playbook_path`, and `playbook_sha256` (pin the playbook bytes now),
   `status=in-progress`, and a `decision_id` linking the user approval.
2. Follow the playbook's 实施步骤 to expand it into one or more `CAP-*`
   inventory rows and `VAL-*` validation scenarios; append them to the
   existing `work-queue.tsv` in dependency order. The playbook's 建议 ledger
   行 section is the starting point, not a substitute for evidence-based
   inventory rows.
3. Implement each row like any capability slice: smallest guarded change,
   `work-queue.tsv` 的 change/evidence 字段 before/after hashes, cheapest relevant check first. All C++
   changes stay inside `Q_OS_OHOS`/platform guards.
4. Mark the playbook's knowledge pages `used=yes` in
   `knowledge-manifest.tsv` and cite sections in `knowledge-manifest.tsv` 的 used 字段和 evidence 引用.
5. Device-dependent features (NFC peers, sensors, system dialogs) require
   `device-runs.tsv` evidence before their rows may close.

Exit gate: every `FEAT-*` row is `verified`, or explicitly
`deferred-approved`/`blocked` with a recorded decision. A feature row closes
only with linked validation evidence — presence of code is never evidence.

## Frozen-playbook rule

The pinned `playbook_sha256` freezes what the migration was built against. If
`validate_ledgers.py` reports that an adopted playbook hash no longer matches
the skill's file, report the drift to the user; the user decides whether to
restart the migration or keep the existing evidence. Never re-pin a playbook
hash silently mid-migration.

## Authoring new catalog entries

Maintainers add features by following `features/README.md` (frontmatter,
required sections, verification requirements) and registering the entry in
`features/registry.tsv`. A playbook that cannot define at least one `VAL-*`
scenario may only be registered as `draft`.




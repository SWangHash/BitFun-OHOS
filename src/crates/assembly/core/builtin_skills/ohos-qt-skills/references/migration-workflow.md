# Persistent migration workflow

The workflow borrows the useful mechanics of code-migration kits—gates,
mechanical queues, independent review, and resumability—without translating
Qt files or creating a parallel application tree.

## Gates and durable queues

Each phase ends with evidence in `migration/ohos/` and a human decision before
material scope changes. The next invocation reads the ledgers and selects rows
whose prerequisites are satisfied; conversation history is not a queue. The
artifact relationships and their Qt-specific purpose are in
[persistence-model.md](persistence-model.md).

The gate is executable, not rhetorical:

```bash
python scripts/validate_ledgers.py <app>/migration/ohos --phase <phase>
```

The command writes its verdict into `STATE.md` (`Last gate`; on `READY` also
the Progress rows, `Current phase`, `Last updated`, and `Last completed
action`), so the navigation file always matches the last executed gate.
`phase_gate.py <root> <phase>` does the same; add `--no-record` for a read-only
check.

The initializer seeds only `BOOT` receipt rows so the ledgers are never
silently blank. `BOOT` rows are deliberately excluded from phase completion.
If a gate fails, the agent must write the missing observation or blocker before
doing more source or build work.

1. **Environment preparation (`baseline`):** capture repository revision/dirty state, host smoke evidence,
   target binding, and the pinned knowledge-baseline provenance in assessment,
   environment, and baseline ledgers.
2. **Migration inventory (`inventory`):** scan declarations and source in context. Use stable `CAP-*`
   IDs and link each row to a `VAL-*` scenario, snapshot evidence, source
   inventory and work queue.
   `inventory.tsv` and `work-queue.tsv` must contain real application rows
   before contract review; an empty table is a hard stop. Each queue row's
   `inventory_ids` names the inventory rows it closes, and every open
   inventory row must be named by at least one queue row.
   When the app targets a newer Qt than the SDK, record the
   `scan_qt_api_gap.py` result as one `qt-api-gap` capability row.
3. **Migration plan contract (`contract`):** freeze Qt/SDK/ABI/template, platform boundaries,
   dependency dispositions, target behavior, and accepted deviations. If the
   user wants HarmonyOS-specific features, select candidates from
   `features/registry.tsv` here (decision only, no implementation).
   Degradations and stubs need a user-owned decision (`owner=user`, evidence
   `user: ...`); the gate rejects agent-approved ones.
4. **Pilot verification (`pilot`):** validate app envelope, entry point, linkage, package
   generation, and one risky runtime boundary before broad edits; persist the
   hypothesis and result in `pilot.tsv` (`batch_checks.py --phase pilot`).
   The pilot's output is evidence for the envelope only. It must not be
   counted as the application target's final `.so` or HAP. Keep the pilot
   envelope buildable until the application `.so` has a receipt.
5. **Capability migration (`implementation`):** process `work-queue.tsv` in build/capability dependency
   order. Start with builds (vendored library targets, then a keep-going build
   of the application target) and let their errors choose what to read.
   When a queue row closes, close the inventory rows in its `inventory_ids`
   with evidence in the same edit; inventory `status` is the capability's
   migration state, not the scan state.
   Implementers update only disjoint source scopes; append `work-queue.tsv` 的 change/evidence 字段
   with before/after hashes; a central owner merges contract, inventory, and
   project-envelope changes.
6. **HarmonyOS feature adaptation (`features`):** for each contract-approved feature, pin its
   playbook hash in `feature-adoption.tsv`, expand it into `CAP-*`/`VAL-*`
   rows, and implement it in the same serialized, evidence-backed way. Close
   the template row as `not-applicable` when the contract selects no feature;
   run `validate_ledgers.py ... --phase features`.
   Catalog-absent features are blockers, not freestyle work. See
   [feature-adaptation.md](feature-adaptation.md).
7. **Build and diagnostics (`diagnostics`):** one build/package/device owner emits numbered evidence;
   fixers consume classified diagnostics. Three distinct failed approaches to
   one blocker stop the loop and require a decision.
   Write the diagnostic before the next attempt. The first causal signature
   wins: a missing source/header, AUTOMOC or third-party macro collision,
   linker/ABI failure, or package-copy failure must be retained even if a
   later verifier reports an artifact problem. Build with keep-going so one
   attempt lists every failing translation unit, and fix errors by group. Read
   [build-diagnostics.md](build-diagnostics.md) for concrete signatures and
   final-artifact checks.
8. **Acceptance and handoff (`handoff`):** report the strongest actually proven tier and every open,
   blocked, unknown, or accepted-limitation row, including package and device
   receipts rather than source diffs alone.

## Review topology

Use independent read-only review for root build files, HarmonyOS glue,
lifecycle/threading, native loading, packaging identity, and shared adapters.
Parallelize discovery and disjoint capability slices only. Never have workers
edit the same contract, manifest, inventory, or project envelope concurrently.

Before resuming after a new session, run
`scripts/validate_ledgers.py <repo>/migration/ohos`, inspect the pending rows in
`work-queue.tsv`, and keep page citations in `knowledge-manifest.tsv` 的 used 字段和 evidence 引用 current.
Pass `--phase <phase>` with the phase recorded in `STATE.md` so the same call
enforces the gate; do not infer the current phase from chat history.
The validator also warns when the installed skill baseline no longer matches
the pinned manifest hash — surface that warning to the user, who alone decides
whether to restart the migration. Inspect `inventory.tsv` for scope/exclusion
receipts and `validation.tsv` 的 negative_control 字段 before accepting a clean scan or
verification gate.

## Evidence rules

Prefer evidence in this order: static inspection, host checks, configure,
compile/link, package inspection, install/launch, targeted device scenarios,
full regression. A package file does not prove launch or behavior. Unknown core
behavior remains blocked or unverified, never a success-looking stub.





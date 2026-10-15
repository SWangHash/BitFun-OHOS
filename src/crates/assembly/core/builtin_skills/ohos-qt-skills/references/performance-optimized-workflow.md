# Performance-oriented migration helpers

Use `ledger_query.py` to load only the rows needed by the current action:

```powershell
python scripts/ledger_query.py <app>/migration/ohos ready --limit 3
python scripts/ledger_query.py <app>/migration/ohos context --id CAP-001 --id VAL-001
python scripts/ledger_query.py <app>/migration/ohos row --ledger environment.tsv --id ENV-001 --id ENV-002
```

Do not inject every TSV into the model context. Start with `STATE.md`, then query
one queue row and its linked inventory/validation rows. Query package and device
rows only at the package/device phases.

Use `batch_checks.py` for configure/build/package/device evidence so that one
invocation owns the sequence and writes full logs plus one compact summary:

```powershell
python scripts/batch_checks.py <plan>.json --output-dir evidence/batch-001 --cwd <app> \
  --diagnostics <app>/migration/ohos/diagnostics.tsv --affected-ids CAP-003,VAL-002 --phase build
```

Start the plan from `assets/templates/migration/ohos/batch-checks.example.json`
and replace the example commands with the project's real commands. With
`--diagnostics` the batch appends its own `diagnostics.tsv` receipt (failed rows
are `unclassified` until `record_diagnostic.py --id <same>` classifies them) and
refuses to rerun an unchanged tree/plan that already failed. `artifact_receipts`
in the plan write receipt files such as `so-path.txt` the moment the matching
artifact exists and optionally archive it under `<output-dir>/artifacts`.
`batch-summary.json` holds `steps` (status, exit code, duration, log paths,
`first_error`, and for failed steps `error_count` plus the distinct `errors`)
and `artifact_receipts`; copy package and device facts from it
into `package-manifest.tsv` or `device-runs.tsv`. Raw logs remain in the
evidence directory: read the failing step's log from the receipt instead of
re-running with truncated output. A failed step stops the batch unless
`continue_on_failure` is explicitly set. The template build step uses
`-- -k 0` so Ninja keeps going and one attempt reports every failing
translation unit.

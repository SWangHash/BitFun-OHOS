# Skill-baseline provenance and evidence chain

## Two separate trust boundaries

`ohos_qt-skills` is an evolving upstream repository, while a migration needs a
released, reviewable input. Knowledge therefore crosses two distinct boundaries:

```text
ohos_qt-skills -- maintainer sync (upstream-kb/) --> this skill/upstream-kb/knowledge
this skill/upstream-kb/knowledge -- project provenance manifest --> app/migration/ohos
```

Only the first boundary may access `ohos_qt-skills`. A Qt migration project
may only cross the second boundary. It must never read, copy, select, or repair
its knowledge input directly from an upstream checkout or URL.

## What a project inherits: provenance, not files

A migration is a short run measured in hours, and its knowledge baseline is
frozen for the whole run. The project therefore records provenance instead of
copying pages:

```text
python scripts/init_migration.py --target <app>
```

initializes the ledgers and records provenance, or on its own:

```text
python scripts/sync_knowledge.py --target <app>/migration/ohos
```

The command verifies every active skill baseline file against the skill
manifest (a corrupt or edited baseline cannot seed a run), then writes
`migration/ohos/knowledge-manifest.tsv`. For every active page the manifest
pins:

- `baseline_manifest_sha256` — the exact released baseline set (whole-manifest hash);
- `source_revision`/`source_path`/`source_sha256` — the original
  `ohos_qt-skills` commit, path, and bytes the page derives from;
- `skill_snapshot_path`/`skill_snapshot_sha256` — the released skill file the
  migration reads in place;
- `used`/`modified`/`action` — consumption and local-adaptation state
  (`action` is `referenced` or `locally-modified`).

There is deliberately no `--source`, `--selection`, or `--file` option: every
active page is inherited as one atomic release set, referenced where it lives.
`snapshot_path`/`snapshot_sha256` stay empty unless the page has a registered
local adaptation.

## Reading pages during the migration

Agents read skill-baseline files directly (`upstream-kb/knowledge/...` under
the skill root) and mark consulted pages after reading:

```text
python scripts/mark_knowledge_used.py <app>/migration/ohos/knowledge-manifest.tsv \
  semantic/qt-harmonyos-golden-rules.md semantic/qt-harmonyos-modules.md
```

Evidence citations in the ledgers name the page together with the pinned
baseline hash, so any claim resolves to exact bytes even after the skill later
evolves.

## The modified-page exception

Only when the target genuinely needs a locally adapted page: create the
adapted copy at `<app>/migration/ohos/knowledge/<source_path>` (adapted from
the pinned baseline page), then register it:

```text
python scripts/sync_knowledge.py --target <app>/migration/ohos \
  --register-modified semantic/qt-harmonyos-window-model.md
```

The script refuses to register a file identical to the baseline page. The row
becomes `modified=yes`, `action=locally-modified`, and keeps the baseline page
hash it was adapted from — the exact lineage. Any other file under the project
`knowledge/` directory is untracked and fails validation; re-register after
further edits to refresh the recorded hash.

## If the baseline changes mid-migration

`sync_knowledge.py` refuses to rewrite the manifest when the installed skill
baseline's manifest hash differs from the pinned one, and lists the differing
pages. This is a report, not a decision: surface it to the user. The user
alone decides whether to restart the migration — delete
`migration/ohos/knowledge-manifest.tsv` (or the whole migration directory) and
re-run inheritance. Never resume on a changed baseline, and never patch
manifest rows toward the newer baseline by hand.

## Verifying the evidence chain

```text
python scripts/validate_ledgers.py <app>/migration/ohos
```

Beyond the cross-ledger ID checks, it verifies registered modified pages
against their recorded hashes and, when the skill is installed, that the
pinned baseline hash and per-page skill hashes still match the installed
skill. Baseline drift is reported as a warning for the user's restart
decision; a corrupted ledger or an untracked knowledge file is an error. Use
`--no-skill-check` for archive-only audits where the skill is not installed.

## Maintainer-only refresh

Updating the skill baseline from `ohos_qt-skills` is a skill maintenance and
release action, never a project migration action. Everything that touches
upstream lives in `upstream-kb/`; the full procedure, parameter mapping and
inclusion criteria are in `upstream-kb/AGENTS.md`:

```text
python upstream-kb/scripts/sync_upstream.py plan [--source <checkout> | --repo <url>] [--branch <b>]
#   review upstream-kb/.sync/review.tsv (incoming files and diffs)
python upstream-kb/scripts/sync_upstream.py apply
python upstream-kb/scripts/verify_kb.py --smoke
```

The script reads one upstream git commit (never a working tree), so every page
traces to a revision and hash. Inclusion policy: **knowledge is preserved;
every new upstream file is reviewed; exclusion requires a sufficient reason.**
`plan` lists new, changed, removed and blocked paths; new files need an
explicit `include` or `exclude` decision, and exclusions are recorded in
`upstream-kb/exclusions.tsv` (`path` + `reason` + `decided_at`; directories end
with `/`). A blank reason is a hard error. Pages that get excluded later stay
in `upstream-kb/manifest.tsv` as inactive `excluded-by-policy` rows for audit.
Hand-edited baseline pages block the sync until resolved, and
`upstream-kb/required-paths.txt` stops a sync that would remove a page this
skill's documents depend on. `apply` is all-or-nothing and appends to
`upstream-kb/SYNC_LOG.md`. Projects can pin the new baseline only after it is
reviewed and committed.

## Manifest protocol

The project `knowledge-manifest.tsv` is the authoritative evidence chain.
`baseline_manifest_sha256` pins the exact skill baseline set;
`source_revision`/`source_sha256` preserve original upstream provenance;
`skill_snapshot_sha256` identifies the released skill bytes the migration
read; and `snapshot_sha256` identifies a registered local adaptation.
`used=yes` means an agent consulted the page; `modified=yes` means a local
adaptation exists in the project.

### Three versions and two divergence edges

A page can exist in up to three byte-versions, and every manifest row carries
all three hashes:

```text
U = source_sha256            upstream ohos_qt-skills bytes
B = skill_snapshot_sha256    released skill-baseline bytes (what the agent reads)
P = snapshot_sha256          registered project adaptation (empty means P = B)
```

- `modified` in the **project** manifest means `P ≠ B` — an agent-side
  adaptation exists.
- `modified` in the **skill** manifest means `B ≠ U` — a maintainer-side
  divergence from upstream. Same column name, different edge: always read it
  together with the manifest level.

The maintainer-side divergence is also visible from the project manifest
itself (`skill_snapshot_sha256 ≠ source_sha256`), and `validate_ledgers.py`
reports it as a warning ("pinned baseline diverges from upstream on N page(s)")
so a migration pinned on a diverged baseline cannot pass unnoticed. Combined
states are legitimate: a project may adapt a page (P ≠ B) that the maintainer
had already diverged from upstream (B ≠ U); the row then carries all three
hashes and both facts remain auditable.

Before a resumed run, check the manifest with `validate_ledgers.py`. If a page
referenced by another page is absent from the baseline, record a blocker; do
not follow the external link to import it into the project. If a page's
content must change to unblock the target, register a local adaptation instead
of editing the skill.

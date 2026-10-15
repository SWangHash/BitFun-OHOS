#!/usr/bin/env python3
"""Validate the durable migration ledgers and knowledge snapshot hashes.

This is intentionally a structural check.  Phase-specific completion rules
live in phase_gate.py, but an empty core ledger is never a valid migration
state.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
from pathlib import Path

from phase_gate import PHASES, evaluate

PROJECT_MANIFEST_FIELDS = {"baseline_manifest_sha256","source_revision","source_path","source_sha256","skill_snapshot_path","skill_snapshot_sha256","snapshot_path","snapshot_sha256","used","modified","action","last_synced_at"}
CORE_LEDGER_NAMES = [
    "baseline.tsv",
    "decisions.tsv",
    "device-runs.tsv",
    "diagnostics.tsv",
    "environment.tsv",
    "feature-adoption.tsv",
    "inventory.tsv",
    "package-manifest.tsv",
    "pilot.tsv",
    "validation.tsv",
    "work-queue.tsv",
]
ID_PREFIXES = {
    "inventory.tsv": "CAP-",
    "work-queue.tsv": "CAP-",
    "validation.tsv": "VAL-",
    "diagnostics.tsv": "DIAG-",
    "pilot.tsv": "PILOT-",
    "feature-adoption.tsv": "FEAT-",
}
# Ledgers that may legitimately have only a header (no external feature selected).
HEADER_ONLY_OK = {"feature-adoption.tsv"}
# Keep in sync with record_diagnostic.py; phase_gate.py treats passed/resolved as a pilot pass.
DIAGNOSTIC_STATUSES = {"planned", "in-progress", "failed", "timeout", "blocked", "resolved", "passed", "not-applicable"}

def read_tsv(path: Path) -> list[dict[str,str]]:
    if not path.exists(): return []
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    # Mismatched rows are reported by column_errors(); normalize so later checks do not crash.
    return [{k: v or "" for k, v in row.items() if k is not None} for row in rows]

def column_errors(path: Path) -> list[str]:
    """Hand-written TSV rows often lose or gain a tab and silently shift fields."""
    if not path.exists(): return []
    with path.open(newline="", encoding="utf-8") as stream:
        lines = list(csv.reader(stream, delimiter="\t"))
    if not lines: return [f"{path.name} has no header"]
    width = len(lines[0])
    return [f"{path.name} line {number} has {len(line)} columns, header has {width}"
            for number, line in enumerate(lines[1:], 2) if line and len(line) != width]

def feature_ledger_checks(root: Path, features_root: Path, features: list[dict[str, str]],
                          validation_ids: set[str], decision_ids: set[str]) -> tuple[list[str], list[str]]:
    """Structure of feature-adoption.tsv (external features); the lifecycle rules are in phase_gate.hook_errors."""
    import feature_predicates as fp
    errors: list[str] = []; warnings: list[str] = []
    registry_path = features_root / "registry.tsv"
    catalog = fp.read_registry(features_root) if registry_path.is_file() else {}
    legacy = fp.is_legacy(fp.adoption_fields(root))
    if legacy:
        warnings.append("feature-adoption.tsv uses the pre-hook header (playbook_path); validated in compatibility mode "
                        "(host phase features, verified = passed, not-applicable = not selected)")
        statuses = fp.STATUSES | fp.LEGACY_STATUSES
    else:
        statuses = fp.STATUSES | {"verified"}
        missing = [name for name in fp.ADOPTION_FIELDS if name not in fp.adoption_fields(root)]
        if (root / fp.ADOPTION).is_file() and missing:
            errors.append(f"feature-adoption.tsv lacks columns: {', '.join(missing)}")
    for row in features:
        row_id = row.get("id", "").strip()
        status = row.get("status", "").strip()
        if status not in statuses:
            errors.append(f"feature {row_id} has unknown status '{status}' (expected one of {', '.join(sorted(statuses))})")
        fid = row.get("feature_id", "").strip()
        if fid and fid.upper() not in {"TODO", "NONE"} and status != "not-applicable":
            if not registry_path.is_file(): warnings.append(f"feature registry missing: {registry_path}")
            elif fid not in catalog: errors.append(f"feature {row_id} references unknown feature {fid}; request a catalog entry instead")
        if legacy:
            playbook_rel = row.get("playbook_path", "").strip(); expected = row.get("playbook_sha256", "").strip()
            if playbook_rel and playbook_rel.upper() != "TODO" and expected and expected.lower() not in {"none", "todo"}:
                playbook = features_root / playbook_rel
                if not playbook.is_file(): errors.append(f"adopted feature playbook missing: {playbook_rel}")
                elif hashlib.sha256(playbook.read_bytes()).hexdigest() != expected:
                    warnings.append(f"adopted feature playbook drifted from pinned hash: {playbook_rel}; only the user decides whether to restart")
        else:
            if row.get("kind", "").strip() not in fp.KINDS:
                errors.append(f"feature {row_id} has unknown kind '{row.get('kind', '')}'")
            if row.get("host_phase", "").strip() not in fp.PHASE_ORDER:
                errors.append(f"feature {row_id} has unknown host_phase '{row.get('host_phase', '')}'")
            attempts = row.get("attempts", "").strip()
            if attempts and not attempts.isdigit():
                errors.append(f"feature {row_id} has non-numeric attempts: {attempts}")
            package = features_root / row.get("package_path", "").strip()
            pinned = row.get("package_sha256", "").strip()
            if not row.get("package_path", "").strip() or not package.is_dir():
                errors.append(f"feature {row_id} package missing: {package}")
            elif pinned and status not in fp.TERMINAL and fp.package_hash(package) != pinned:
                warnings.append(f"feature {row_id} package drifted from the hash pinned at activation; "
                                "only the user decides (feature_hooks.py repin --decision DEC-xxx)")
        for value in row.get("validation_ids", "").split(","):
            value = value.strip()
            if value and value.upper() not in {"TODO", "NONE"} and value not in validation_ids: errors.append(f"feature {row_id} references missing validation {value}")
        decision = row.get("decision_id", "").strip()
        if decision and decision.upper() not in {"TODO", "NONE"} and decision not in decision_ids:
            errors.append(f"feature {row_id} references missing decision {decision}")
    return errors, warnings

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("--skill-root", type=Path, default=None)
    parser.add_argument("--no-skill-check", action="store_true")
    parser.add_argument("--phase", choices=PHASES, default=None,
                        help="also enforce this phase gate (same rules as phase_gate.py)")
    parser.add_argument("--no-record", action="store_true",
                        help="with --phase: do not write the verdict into STATE.md (Gate / Progress)")
    args = parser.parse_args()
    root = args.migration_root.resolve()
    skill_dir = (args.skill_root or Path(__file__).resolve().parent.parent).resolve()
    errors: list[str] = []; warnings: list[str] = []
    required = CORE_LEDGER_NAMES + ["knowledge-manifest.tsv"]
    for name in required:
        if not (root / name).is_file():
            hint = "; rerun init_migration.py to add it without touching existing ledgers" if name in {"pilot.tsv", "feature-adoption.tsv"} else ""
            errors.append(f'missing required ledger: {name}{hint}')
    rows_by_name = {name: read_tsv(root / name) for name in CORE_LEDGER_NAMES}
    inventory = rows_by_name["inventory.tsv"]
    validation = rows_by_name["validation.tsv"]
    queue = rows_by_name["work-queue.tsv"]
    diagnostics = rows_by_name["diagnostics.tsv"]
    pilot = rows_by_name["pilot.tsv"]
    features = rows_by_name["feature-adoption.tsv"]
    manifest = read_tsv(root/"knowledge-manifest.tsv")
    for name, rows in rows_by_name.items():
        errors.extend(column_errors(root / name))
        if not rows and name not in HEADER_ONLY_OK:
            hint = "every pilot/build/package/device attempt needs a receipt" if name in {"diagnostics.tsv", "pilot.tsv"} else "record the phase receipt before continuing"
            errors.append(f"{name} has no data rows; {hint}")
        prefix = ID_PREFIXES.get(name)
        if prefix:
            for row in rows:
                row_id = row.get("id", "").strip()
                if row_id and not row_id.startswith(prefix):
                    errors.append(f"{name} row has invalid id prefix: {row_id} (expected {prefix})")
    validation_ids = {r.get("id","") for r in validation if r.get("id")}
    if not (root/"knowledge-manifest.tsv").exists(): errors.append("knowledge-manifest.tsv is missing")
    elif manifest:
        missing = PROJECT_MANIFEST_FIELDS - set(manifest[0])
        if missing: errors.append("project knowledge manifest missing " + ", ".join(sorted(missing)))
        hashes = {r.get("baseline_manifest_sha256","") for r in manifest}
        if "" in hashes or len(hashes) != 1: errors.append("project knowledge manifest does not pin one skill baseline hash")
    for row in inventory:
        value = row.get("validation_id","")
        if value and value not in validation_ids: errors.append(f"inventory {row.get('id')} references missing validation {value}")
    queue_ids = {r.get("id","") for r in queue}
    inventory_ids = {r.get("id","") for r in inventory if r.get("id")}
    for row in queue:
        for value in row.get("inventory_ids","").split(","):
            value = value.strip()
            if value and value != "none" and value not in inventory_ids: errors.append(f"work item {row.get('id')} references missing inventory row {value}")
        for value in row.get("validation_ids","").split(","):
            value = value.strip()
            if value and value not in validation_ids: errors.append(f"work item {row.get('id')} references missing validation {value}")
        for value in row.get("prerequisites","").split(","):
            value = value.strip()
            if value and value != "none" and value not in queue_ids: errors.append(f"work item {row.get('id')} references missing prerequisite {value}")
    for row in diagnostics + pilot:
        status = row.get("status", "").strip()
        if status not in DIAGNOSTIC_STATUSES:
            errors.append(f"diagnostic {row.get('id')} has unknown status '{status}' (expected one of {', '.join(sorted(DIAGNOSTIC_STATUSES))})")
        attempts = row.get("attempts", "").strip()
        if attempts:
            try:
                if int(attempts) < 0:
                    errors.append(f"diagnostic {row.get('id')} has negative attempts")
            except ValueError:
                errors.append(f"diagnostic {row.get('id')} has non-numeric attempts: {attempts}")
        for value in row.get("affected_ids", "").split(","):
            value = value.strip()
            if not value:
                continue
            known = value in queue_ids or value in {r.get("id", "") for r in inventory} or value in validation_ids
            if not known and not value.startswith(("ENV-", "BASE-", "PKG-", "DEV-RUN-", "DEC-", "DIAG-", "PILOT-", "FEAT-")):
                errors.append(f"diagnostic {row.get('id')} references unknown affected id {value}")
    errors_f, warnings_f = feature_ledger_checks(root, skill_dir / "features", features, validation_ids,
                                                  {r.get("id", "") for r in rows_by_name["decisions.tsv"]})
    errors.extend(errors_f); warnings.extend(warnings_f)
    for row in manifest:
        snapshot = root / row.get("snapshot_path",""); expected = row.get("snapshot_sha256","")
        if row.get("modified") == "yes":
            if not row.get("snapshot_path") or not expected: errors.append(f"modified knowledge row lacks a local snapshot: {row.get('source_path')}")
            elif not snapshot.exists(): errors.append(f"modified knowledge snapshot missing: {row.get('snapshot_path')}")
            elif hashlib.sha256(snapshot.read_bytes()).hexdigest() != expected: errors.append(f"modified knowledge hash mismatch: {row.get('source_path')}")
        elif row.get("snapshot_path") or expected: errors.append(f"unmodified knowledge row must not claim a local snapshot: {row.get('source_path')}")
        if row.get("action") == "retired-from-skill-baseline": errors.append(f"retired knowledge file requires review: {row.get('source_path')}")
        if row.get("action","").startswith("blocked-") or row.get("action") == "skill-baseline-changed": errors.append(f"blocked knowledge inheritance: {row.get('source_path')}")
    pinned_hash = manifest[0].get("baseline_manifest_sha256","") if manifest else ""
    if manifest and "baseline_manifest_sha256" in manifest[0]:
        diverged = [r.get("source_path","") for r in manifest if r.get("skill_snapshot_sha256") and r.get("source_sha256") and r["skill_snapshot_sha256"] != r["source_sha256"]]
        if diverged: warnings.append(f"pinned baseline diverges from upstream on {len(diverged)} page(s)")
    if manifest and not args.no_skill_check:
        skill_manifest = skill_dir/"upstream-kb"/"manifest.tsv"
        if not skill_manifest.is_file(): warnings.append(f"skill baseline not available for pin check: {skill_manifest}")
        else:
            current_hash = hashlib.sha256(skill_manifest.read_bytes()).hexdigest()
            if current_hash != pinned_hash: warnings.append("installed skill baseline differs from pinned version")
            else:
                for row in manifest:
                    rel = row.get("skill_snapshot_path",""); expected = row.get("skill_snapshot_sha256",""); page = skill_dir/rel if rel else None
                    if not rel or not expected: warnings.append(f"knowledge row lacks skill provenance: {row.get('source_path')}")
                    elif not page.is_file(): warnings.append(f"pinned skill page missing in installed skill: {rel}")
                    elif hashlib.sha256(page.read_bytes()).hexdigest() != expected: warnings.append(f"skill page drifted from pinned hash: {rel}")
    knowledge_root = root/"knowledge"
    if knowledge_root.exists() and manifest:
        tracked = {(root/r.get("snapshot_path","")).resolve() for r in manifest if r.get("snapshot_path")}
        for path in knowledge_root.rglob("*"):
            if path.is_file() and path.resolve() not in tracked: errors.append(f"untracked knowledge file outside registered modifications: {path.relative_to(root)}")
    # Current phase is written by the gate scripts; a hand edit must not skip phases.
    state_path = root / "STATE.md"
    if state_path.is_file() and not args.phase:
        from gate_state import open_phases_before
        current, skipped = open_phases_before(state_path.read_text(encoding="utf-8", errors="replace"))
        if skipped:
            errors.append(
                f"STATE.md Current phase is '{current}' but these phases have not passed their gates: {', '.join(skipped)}; "
                f"Current phase and Progress are written only by the gate. "
                f"Run validate_ledgers.py {root} --phase {skipped[0]} and finish that phase first")
    if warnings: print("WARNINGS"); print("\n".join(f"- {w}" for w in warnings))
    if errors: print("INVALID"); print("\n".join(f"- {e}" for e in errors))
    else: print(f"OK inventory={len(inventory)} validation={len(validation)} queue={len(queue)} pilot={len(pilot)} features={len(features)} manifest={len(manifest)}")
    # One command per checkpoint: structural validity plus the requested phase gate.
    gate_errors = evaluate(root, args.phase, skill_dir / "features") if args.phase else []
    if args.phase:
        if gate_errors: print(f"BLOCKED phase={args.phase}"); print("\n".join(f"- {e}" for e in gate_errors))
        else: print(f"READY phase={args.phase}")
        if not args.no_record:
            # Structural errors block advancement exactly like gate errors.
            from gate_state import record_gate
            warning = record_gate(root, args.phase, [f"INVALID: {e}" for e in errors] + gate_errors, "validate_ledgers.py")
            if warning: print(f"WARNING {warning}")
    return 1 if errors or gate_errors else 0

if __name__ == "__main__": raise SystemExit(main())



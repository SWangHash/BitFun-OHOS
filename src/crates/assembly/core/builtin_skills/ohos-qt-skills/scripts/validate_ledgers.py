#!/usr/bin/env python3
"""Check the ledgers and, with ``--phase``, the phase gate; record the verdict.

    python <skill>/scripts/validate_ledgers.py <container>/migration/ohos --phase <phase>

Prints ``OK``/``INVALID`` for the ledger structure (columns, id prefixes,
cross-references, status values, knowledge manifest) and, with ``--phase``,
``READY``/``NOT-READY`` for the gate (phase_gate.py) with every unmet condition.
The verdict is written into STATE.md (``Last gate``; on READY also the
Progress status and ``Current phase``); ``--no-record`` only checks. Gates are cumulative: a phase's gate
re-checks every earlier phase. Structural errors block like gate errors.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
from pathlib import Path

from phase_gate import PHASES, evaluate
from ohos_env import ENV_COLUMNS, parse_command_env
from vocab import (DECISION_OWNERS, DEVICE_RUN_ID, DEVICE_RUN_STATUSES, DIAGNOSTIC_STATUSES, STAGES, VALIDATION_STATUSES, DISPOSITIONS, ENV_CONDITIONAL_ITEMS, ENV_CORE_ITEMS, ENV_STATUSES,
                   ENV_TOOL_PREFIX, QUEUE_CLOSE_STATUSES, QUEUE_STATUSES)

PROJECT_MANIFEST_FIELDS = {"baseline_manifest_sha256","source_revision","source_path","source_sha256","skill_snapshot_path","skill_snapshot_sha256","snapshot_path","snapshot_sha256","used","modified","action","last_synced_at"}
CORE_LEDGER_NAMES = [
    "decisions.tsv",
    "device-runs.tsv",
    "diagnostics.tsv",
    "environment.tsv",
    "features.tsv",
    "inventory.tsv",
    "validation.tsv",
    "tasks.tsv",
]
ID_PREFIXES = {
    "inventory.tsv": "INV-",
    "tasks.tsv": "TASK-",
    "decisions.tsv": "DEC-",
    "device-runs.tsv": "DEV-RUN-",
    "validation.tsv": "VAL-",
    "diagnostics.tsv": "DIAG-",
    "features.tsv": "FEAT-",
}
# Ledgers whose header must be exactly the skill template's (no compatibility with older layouts).
TEMPLATE_HEADER_LEDGERS = ("decisions.tsv", "device-runs.tsv", "diagnostics.tsv", "inventory.tsv", "validation.tsv",
                          "tasks.tsv")
TEMPLATES = Path(__file__).resolve().parent.parent / "assets" / "templates" / "migration" / "ohos"


def environment_errors(root: Path, rows: list[dict[str, str]]) -> list[str]:
    """Shape of environment.tsv (written only by env_probe.py): one row per known item, valid status and command_env."""
    errors: list[str] = []
    path = root / "environment.tsv"
    if path.is_file():
        header = path.read_text(encoding="utf-8-sig").splitlines()[:1]
        if header and header[0].split("\t") != ENV_COLUMNS:
            errors.append("environment.tsv header is not the env_probe.py table: rerun env_probe.py --migration-root <root>")
            return errors
    seen: set[str] = set()
    known = set(ENV_CORE_ITEMS) | set(ENV_CONDITIONAL_ITEMS)
    for row in rows:
        item = row.get("item", "").strip()
        if item in seen:
            errors.append(f"environment.tsv lists item {item} twice: one row per environment item")
        seen.add(item)
        if item not in known and not (item.startswith(ENV_TOOL_PREFIX) and len(item) > len(ENV_TOOL_PREFIX)):
            errors.append(f"environment.tsv has unknown item '{item}' (vocab.ENV_CORE_ITEMS, ENV_CONDITIONAL_ITEMS or tool:<name>)")
        if row.get("status", "").strip() not in ENV_STATUSES:
            errors.append(f"environment.tsv {item} has unknown status '{row.get('status', '')}'")
        try:
            parse_command_env(row.get("command_env", ""))
        except ValueError as error:
            errors.append(f"environment.tsv {item}: {error}")
    return errors

def read_tsv(path: Path) -> list[dict[str,str]]:
    if not path.exists(): return []
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    # Mismatched rows are reported by column_errors(); normalize so later checks do not crash.
    return [{k: v or "" for k, v in row.items() if k is not None} for row in rows]

def header_errors(path: Path) -> list[str]:
    """A ledger written with an older skill layout: report it, never read it half-way."""
    template = TEMPLATES / path.name
    if path.name not in TEMPLATE_HEADER_LEDGERS or not path.is_file() or not template.is_file():
        return []
    def first(file: Path) -> list[str]:
        with file.open(newline="", encoding="utf-8-sig") as stream:
            return next(csv.reader(stream, delimiter="\t"), [])
    expected, actual = first(template), first(path)
    if actual == expected:
        return []
    return [f"{path.name} header differs from the skill template ({', '.join(expected)}): "
            "rewrite the ledger with the current columns (ledger.py columns " + path.name + ")"]

def column_errors(path: Path) -> list[str]:
    """Hand-written TSV rows often lose or gain a tab and silently shift fields."""
    if not path.exists(): return []
    with path.open(newline="", encoding="utf-8") as stream:
        lines = list(csv.reader(stream, delimiter="\t"))
    if not lines: return [f"{path.name} has no header"]
    width = len(lines[0])
    return [f"{path.name} line {number} has {len(line)} columns, header has {width}"
            for number, line in enumerate(lines[1:], 2) if line and len(line) != width]

def feature_ledger_checks(root: Path, features_root: Path, features: list[dict[str, str]]) -> tuple[list[str], list[str]]:
    """Structure of features.tsv (external features); the lifecycle rules are in phase_gate.hook_errors."""
    import feature_predicates as fp
    errors: list[str] = []; warnings: list[str] = []
    registry_path = features_root / "registry.tsv"
    catalog = fp.read_registry(features_root) if registry_path.is_file() else {}
    statuses = fp.STATUSES
    missing = [name for name in fp.ADOPTION_FIELDS if name not in fp.adoption_fields(root)]
    if (root / fp.ADOPTION).is_file() and missing:
        errors.append(f"features.tsv lacks columns: {', '.join(missing)}")
    for row in features:
        row_id = row.get("id", "").strip()
        status = row.get("status", "").strip()
        if status not in statuses:
            errors.append(f"feature {row_id} has unknown status '{status}' (expected one of {', '.join(sorted(statuses))})")
        fid = row.get("feature_id", "").strip()
        if fid and fid.upper() not in {"TODO", "NONE"}:
            if not registry_path.is_file(): warnings.append(f"feature registry missing: {registry_path}")
            elif fid not in catalog: errors.append(f"feature {row_id} references unknown feature {fid}; request a catalog entry instead")
        if row.get("kind", "").strip() not in fp.KINDS:
            errors.append(f"feature {row_id} has unknown kind '{row.get('kind', '')}'")
        attempts = row.get("attempts", "").strip()
        if attempts and not attempts.isdigit():
            errors.append(f"feature {row_id} has non-numeric attempts: {attempts}")
        package = fp.package_dir(features_root, row)
        if not package.is_dir():
            errors.append(f"feature {row_id} package missing: {package}")
    return errors, warnings

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
            hint = "; rerun init_migration.py to add it without touching existing ledgers" if name == "features.tsv" else ""
            errors.append(f'missing required ledger: {name}{hint}')
    rows_by_name = {name: read_tsv(root / name) for name in CORE_LEDGER_NAMES}
    inventory = rows_by_name["inventory.tsv"]
    validation = rows_by_name["validation.tsv"]
    queue = rows_by_name["tasks.tsv"]
    diagnostics = rows_by_name["diagnostics.tsv"]
    features = rows_by_name["features.tsv"]
    manifest = read_tsv(root/"knowledge-manifest.tsv")
    for name, rows in rows_by_name.items():
        errors.extend(header_errors(root / name))
        errors.extend(column_errors(root / name))
        prefix = ID_PREFIXES.get(name)
        if prefix:
            for row in rows:
                row_id = row.get("id", "").strip()
                if row_id and not row_id.startswith(prefix):
                    errors.append(f"{name} row has invalid id prefix: {row_id} (expected {prefix})")
    errors.extend(environment_errors(root, rows_by_name["environment.tsv"]))
    validation_ids = {r.get("id","") for r in validation if r.get("id")}
    if not (root/"knowledge-manifest.tsv").exists(): errors.append("knowledge-manifest.tsv is missing")
    elif manifest:
        missing = PROJECT_MANIFEST_FIELDS - set(manifest[0])
        if missing: errors.append("project knowledge manifest missing " + ", ".join(sorted(missing)))
        hashes = {r.get("baseline_manifest_sha256","") for r in manifest}
        if "" in hashes or len(hashes) != 1: errors.append("project knowledge manifest does not pin one skill baseline hash")
    for row in inventory:
        disposition = row.get("disposition", "").strip()
        if disposition not in DISPOSITIONS:
            errors.append(f"inventory {row.get('id')} has unknown disposition '{disposition}' (one of {', '.join(DISPOSITIONS)})")
    for row in queue if not queue or "status" in queue[0] else []:
        status = row.get("status", "").strip()
        if status not in QUEUE_STATUSES:
            errors.append(f"task {row.get('id')} has unknown status '{status}' (one of {', '.join(QUEUE_STATUSES)})")
        elif status in QUEUE_CLOSE_STATUSES and not row.get("evidence", "").strip():
            errors.append(f"task {row.get('id')} is {status} without evidence: "
                          f'ledger.py update <root> tasks.tsv {row.get("id")} --set "evidence=<batch receipt, check or decision>"')
    for row in validation if not validation or "steps" in validation[0] else []:
        if row.get("status", "").strip() not in VALIDATION_STATUSES:
            errors.append(f"validation {row.get('id')} has unknown status '{row.get('status', '')}' "
                          f"(one of {', '.join(VALIDATION_STATUSES)})")
    inventory_ids = {r.get("id","") for r in inventory if r.get("id")}
    for row in queue:
        for value in row.get("inventory_ids","").split(","):
            value = value.strip()
            if value and value != "none" and value not in inventory_ids: errors.append(f"work item {row.get('id')} references missing inventory row {value}")
        for value in row.get("validation_ids","").split(","):
            value = value.strip()
            if value and value not in validation_ids: errors.append(f"work item {row.get('id')} references missing validation {value}")
    # An older layout is reported once by header_errors(), not row by row.
    for row in diagnostics if not diagnostics or "location" in diagnostics[0] else []:
        status = row.get("status", "").strip()
        if status not in DIAGNOSTIC_STATUSES:
            errors.append(f"diagnostic {row.get('id')} has unknown status '{status}' (one of {', '.join(DIAGNOSTIC_STATUSES)})")
        stage = row.get("location", "").partition(":")[0].strip()
        if stage not in STAGES:
            errors.append(f"diagnostic {row.get('id')} location must start with '<stage>:' (one of {', '.join(STAGES)})")
    device = rows_by_name["device-runs.tsv"]
    if len(device) > 1:
        errors.append(f"device-runs.tsv has {len(device)} rows: it holds one row, the application HAP's latest result "
                      "(rerun the packaging batch to rewrite it)")
    for row in device if not device or "status" in device[0] else []:
        if row.get("id", "").strip() != DEVICE_RUN_ID:
            errors.append(f"device-runs.tsv row id must be {DEVICE_RUN_ID}, got {row.get('id', '')}")
        if row.get("status", "").strip() not in DEVICE_RUN_STATUSES:
            errors.append(f"device-runs.tsv has unknown status '{row.get('status', '')}' (one of {', '.join(DEVICE_RUN_STATUSES)})")
    if (root / "package-manifest.tsv").is_file():
        warnings.append("package-manifest.tsv is no longer used (the HAP is in device-runs.tsv): delete it")
    for row in rows_by_name["decisions.tsv"]:
        owner = row.get("owner", "").strip()
        if row.get("answer", "").strip() and owner not in DECISION_OWNERS:
            errors.append(f"decision {row.get('id')} has owner '{owner}' (one of {', '.join(DECISION_OWNERS)})")
        elif not row.get("answer", "").strip() and owner:
            errors.append(f"decision {row.get('id')} has no answer yet but owner '{owner}': leave owner empty until it is answered")
    errors_f, warnings_f = feature_ledger_checks(root, skill_dir / "features", features)
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
            if current_hash != pinned_hash: warnings.append("installed skill baseline differs from pinned version: run sync_knowledge.py --target <root> to re-pin, tell the user and continue")
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
                f"Current phase and Progress are written only by the skill scripts. "
                f"Run validate_ledgers.py {root} --phase {skipped[0]} and finish that phase first")
    if warnings: print("WARNINGS"); print("\n".join(f"- {w}" for w in warnings))
    if errors: print("INVALID"); print("\n".join(f"- {e}" for e in errors))
    else: print(f"OK inventory={len(inventory)} validation={len(validation)} queue={len(queue)} features={len(features)} manifest={len(manifest)}")
    # One command per checkpoint: structural validity plus the requested phase gate.
    gate_errors = evaluate(root, args.phase, skill_dir / "features") if args.phase else []
    if args.phase:
        if gate_errors: print(f"NOT-READY phase={args.phase}"); print("\n".join(f"- {e}" for e in gate_errors))
        else: print(f"READY phase={args.phase}")
        if not args.no_record:
            # Structural errors block advancement exactly like gate errors.
            from gate_state import record_gate
            warning = record_gate(root, args.phase, [f"INVALID: {e}" for e in errors] + gate_errors, "validate_ledgers.py")
            if warning: print(f"WARNING {warning}")
    return 1 if errors or gate_errors else 0

if __name__ == "__main__": raise SystemExit(main())



#!/usr/bin/env python3
"""Initialize migration/ohos ledgers without overwriting existing records."""
from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
from pathlib import Path


BOOTSTRAP_ROWS = {
    "inventory.tsv": {
        "id": "CAP-BOOT-001",
        "category": "bootstrap",
        "source_location": "migration/ohos",
        "source_kind": "receipt",
        "current_behavior": "Initialization completed",
        "ohos_constraint": "Replace this receipt with application scan evidence",
        "prerequisites": "none",
        "scan_scope": "migration root",
        "scan_evidence": "init_migration.py created the ledger; no source scan performed",
        "disposition": "blocked",
        "target_behavior": "Application inventory required before contract gate",
        "files": "none",
        "risk": "high",
        "status": "planned",
        "evidence": "init_migration.py receipt",
        "validation_id": "VAL-BOOT-001",
    },
    "work-queue.tsv": {
        "id": "CAP-BOOT-001",
        "capability": "Migration inventory",
        "category": "bootstrap",
        "prerequisites": "none",
        "inputs": "source repository and build files",
        "owner": "migration-owner",
        "status": "planned",
        "attempts": "0",
        "next_action": "Run the scoped source/build scan; do not implement yet",
        "change_refs": "none",
        "change_hashes": "none",
        "evidence": "init_migration.py receipt; bootstrap row is not application evidence",
        "validation_ids": "VAL-BOOT-001",
        "inventory_ids": "CAP-BOOT-001",
    },
    "validation.tsv": {
        "id": "VAL-BOOT-001",
        "scenario": "Initialization receipt",
        "platform": "host+ohos",
        "command_or_steps": "init_migration.py and ledger header check",
        "expected": "Core ledgers exist and require real evidence before phase advancement",
        "result": "bootstrap receipt",
        "status": "planned",
        "reviewer": "migration-owner",
        "negative_control": "Empty inventory/queue must fail phase_gate.py",
        "evidence": "init_migration.py receipt",
    },
    "diagnostics.tsv": {
        "id": "DIAG-BOOT-001",
        "build_or_device_run_id": "INIT-001",
        "phase": "baseline",
        "category": "receipt",
        "first_causal_signature": "Initialization only",
        "root_cause": "No build or device result exists yet",
        "attempts": "0",
        "command": "init_migration.py",
        "tree_or_environment_hash": "not-computed",
        "log_path": "none",
        "fix_or_next_action": "Run baseline and record the first real receipt",
        "affected_ids": "ENV-001,BASE-001,VAL-BOOT-001",
        "evidence": "init_migration.py receipt",
        "status": "planned",
        "recurrence": "Bootstrap receipt must be replaced or supplemented by real build diagnostics",
    },
    "pilot.tsv": {
        "id": "PILOT-BOOT-001",
        "build_or_device_run_id": "INIT-001",
        "phase": "pilot",
        "category": "receipt",
        "first_causal_signature": "Initialization only",
        "root_cause": "No pilot attempt exists yet",
        "attempts": "0",
        "command": "init_migration.py",
        "tree_or_environment_hash": "not-computed",
        "log_path": "none",
        "fix_or_next_action": "Run the pilot through batch_checks.py --phase pilot after the contract gate",
        "affected_ids": "VAL-BOOT-001",
        "evidence": "init_migration.py receipt",
        "status": "planned",
        "recurrence": "Bootstrap receipt must be supplemented by a reviewed pilot attempt",
    },
    "decisions.tsv": {
        "id": "DEC-BOOT-001",
        "phase": "baseline",
        "question": "Initialization receipt",
        "options": "Replace with explicit user decisions",
        "selected": "none",
        "impact": "No material decision has been approved",
        "owner": "migration-owner",
        "approved_at": "not-applicable",
        "feature_or_scope": "migration bootstrap",
        "affected_ids": "none",
        "status": "planned",
        "evidence": "init_migration.py receipt; not a user approval",
    },
}


def write_bootstrap_rows(destination: Path) -> int:
    """Seed receipt rows only in newly created or header-only ledgers."""
    written = 0
    for filename, bootstrap in BOOTSTRAP_ROWS.items():
        path = destination / filename
        if not path.is_file():
            continue
        with path.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream, delimiter="\t")
            fields = reader.fieldnames or []
            rows = list(reader)
        if rows:
            continue
        if not fields:
            raise SystemExit(f"ledger has no header: {path}")
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n")
            writer.writeheader()
            writer.writerow({field: bootstrap.get(field, "") for field in fields})
        written += 1
    return written


OHOS_PROJECT_MARKERS = ("AppScope/app.json5", "hvigorfile.ts", "build-profile.json5")
QT_PROJECT_PATTERNS = ("*.pro", "CMakeLists.txt", "*.qbs")
SKIP_DIRS = {".git", "migration", "build", "node_modules", "oh_modules"}


def is_ohos_project(path: Path) -> bool:
    """A HarmonyOS (hvigor) project directory, i.e. the converted output."""
    return any((path / marker).is_file() for marker in OHOS_PROJECT_MARKERS)


def has_qt_project(path: Path, depth: int = 3) -> bool:
    """A qmake/CMake/qbs project file at most ``depth`` levels below ``path``."""
    level = [path]
    for _ in range(depth + 1):
        following = []
        for directory in level:
            if any(next(directory.glob(pattern), None) for pattern in QT_PROJECT_PATTERNS):
                return True
            try:
                following.extend(child for child in directory.iterdir()
                                 if child.is_dir() and child.name not in SKIP_DIRS and not is_ohos_project(child))
            except OSError:
                continue
        level = following
    return False


def check_target(target: Path) -> None:
    """The ledger belongs to the Qt application, not to the HarmonyOS output project."""
    if not target.is_dir():
        raise SystemExit(
            f"BLOCKED: --target {target} does not exist. --target is the Qt application root "
            "(the directory holding its .pro/CMakeLists.txt or the repository root), not the "
            "HarmonyOS project directory that the migration will create.")
    if is_ohos_project(target):
        raise SystemExit(
            f"BLOCKED: --target {target} is a HarmonyOS project (AppScope/hvigor files). "
            "Pass the Qt application root instead and record this directory as the "
            "HarmonyOS project in STATE.md (Template/deployment/build/package route).")
    if not has_qt_project(target):
        print(f"WARNING: no .pro, CMakeLists.txt or .qbs found under --target {target}. "
              "Check that it is the root of the Qt application being migrated.")


def fill_state(destination: Path, project: str, target: Path) -> None:
    """Seed the project name and the first phase in a fresh STATE.md; never overwrite."""
    state = destination / "STATE.md"
    if not state.is_file():
        return
    text = state.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    changed = False
    for index, line in enumerate(lines):
        if line.startswith("| Project / repository | TODO | TODO |"):
            lines[index] = line.replace("| TODO | TODO |", f"| {project} | {target.as_posix()} |", 1)
            changed = True
        elif line.startswith("- Current phase: `TODO`"):
            lines[index] = line.replace("`TODO`", "`baseline`", 1)
            changed = True
        elif line.startswith("| Environment preparation (`baseline`") and "| planned |" in line:
            lines[index] = line.replace("| planned |", "| in-progress |", 1)
            changed = True
    if changed:
        state.write_text("".join(lines), encoding="utf-8", newline="")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template-root", type=Path, required=True,
                        help="assets/templates/migration/ohos")
    parser.add_argument("--target", type=Path, required=True,
                        help="Qt application root (not the HarmonyOS output project)")
    args = parser.parse_args()
    source = args.template_root.resolve()
    app_root = args.target.resolve()
    destination = app_root / "migration" / "ohos"
    if not source.is_dir():
        raise SystemExit(f"template root does not exist: {source}")
    if not (destination / "STATE.md").is_file():
        check_target(app_root)
    destination.mkdir(parents=True, exist_ok=True)
    created = 0
    skipped = 0
    for item in source.rglob("*"):
        if not item.is_file():
            continue
        target = destination / item.relative_to(source)
        if target.exists():
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        created += 1

    bootstrap_rows = write_bootstrap_rows(destination)
    fill_state(destination, app_root.name, app_root)
    sync = Path(__file__).resolve().parent / "sync_knowledge.py"
    command = [sys.executable, str(sync), "--target", str(destination)]
    result = subprocess.run(command, check=False)
    if result.returncode:
        print("knowledge provenance recording failed; review migration/ohos/knowledge-manifest.tsv")
        return result.returncode
    print(f"migration_root={destination}")
    print(f"created={created} skipped_existing={skipped}")
    print(f"bootstrap_rows={bootstrap_rows}")
    next_step = Path(__file__).resolve().parent / "next_step.py"
    print(f"Next: run `python {next_step} {destination}` and follow the phase it names.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

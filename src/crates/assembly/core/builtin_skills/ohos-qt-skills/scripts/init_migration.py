#!/usr/bin/env python3
"""Initialize migration/ohos ledgers without overwriting existing records."""
from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
from datetime import datetime, timezone
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
# The output container is never the project directory: the migration project is
# its `<app-name>-ohos` subdirectory. Keep in sync with phase_gate.py.
LAYOUT_ROW_ID = "ENV-011"
LAYOUT_CATEGORY = "layout"
LAYOUT_ROW_NAME = "Migration output container and the project inside it"


def is_ohos_project(path: Path) -> bool:
    """A HarmonyOS (hvigor) project directory, i.e. the converted output."""
    return any((path / marker).is_file() for marker in OHOS_PROJECT_MARKERS)


def is_qt_source_root(path: Path) -> bool:
    """The directory holds its own qmake/CMake/qbs project file."""
    if not path.is_dir():
        return False
    return any(next(path.glob(pattern), None) is not None for pattern in QT_PROJECT_PATTERNS)


def find_qt_project_file(path: Path, depth: int = 3) -> Path | None:
    """The nearest qmake/CMake/qbs project file at most ``depth`` levels below ``path``."""
    level = [path]
    for _ in range(depth + 1):
        following = []
        for directory in level:
            for pattern in QT_PROJECT_PATTERNS:
                hit = next(directory.glob(pattern), None)
                if hit is not None:
                    return hit
            try:
                following.extend(child for child in directory.iterdir()
                                 if child.is_dir() and child.name not in SKIP_DIRS and not is_ohos_project(child))
            except OSError:
                continue
        level = following
    return None


def has_qt_project(path: Path, depth: int = 3) -> bool:
    """A qmake/CMake/qbs project file at most ``depth`` levels below ``path``."""
    return find_qt_project_file(path, depth) is not None


def output_app_name(target: Path) -> str:
    """The application name for `<app-name>-ohos`: the Qt project file's, else the target's.

    `--target` may be a repository root, whose directory name is not the
    application name, so the Qt project file found under it names the project;
    the engine derives the same name from the bound Qt project.
    """
    project_file = find_qt_project_file(target)
    if project_file is None:
        return target.name
    if project_file.name == "CMakeLists.txt":
        return project_file.parent.name
    return project_file.stem


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


def record_layout(destination: Path, container_raw: str, app_name: str) -> tuple[Path, Path] | None:
    """Record the output container and the project inside it, idempotently.

    The bound output directory is a container: the template and every migration
    artifact go into its `<app-name>-ohos` subdirectory. Recording the pair here
    is what lets `phase_gate.py` reject a template materialized into the
    container root, so a container that is itself a HarmonyOS project is
    refused instead of recorded.
    """
    if not container_raw.strip():
        print("WARNING: --output-project was not given, so the output layout is unrecorded; "
              "the layout gate blocks the pilot phase until it is (re-run this script with "
              "--output-project <container>)")
        return None
    container = Path(container_raw.strip()).expanduser().resolve()
    if is_ohos_project(container):
        raise SystemExit(
            f"BLOCKED: --output-project {container} already holds a HarmonyOS project "
            f"({', '.join(OHOS_PROJECT_MARKERS)}). It must be the output container. Move the template tree "
            f"into {container}/<app-name>-ohos (the container root never holds it) and re-run, or pass the "
            f"container the user bound instead of the project directory.")
    if is_qt_source_root(container):
        raise SystemExit(
            f"BLOCKED: --output-project {container} is the Qt project root itself "
            f"({', '.join(QT_PROJECT_PATTERNS)}). Bind the directory that holds the Qt sources instead: the "
            f"migration project would otherwise be created inside the Qt source tree.")
    project = container / f"{app_name}-ohos"
    path = destination / "environment.tsv"
    if not path.is_file():
        raise SystemExit(f"ledger is missing: {path}")
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        fields = reader.fieldnames or []
        rows = list(reader)
    if not fields:
        raise SystemExit(f"ledger has no header: {path}")
    exists = container.is_dir()
    row = {
        "id": LAYOUT_ROW_ID,
        "category": LAYOUT_CATEGORY,
        "name": LAYOUT_ROW_NAME,
        "value": f"container={container.as_posix()}; project={project.as_posix()}",
        "version_or_revision": app_name,
        "source_or_path": container.as_posix(),
        "status": "verified" if exists else "planned",
        "last_verified_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "evidence": "init_migration.py --output-project: container recorded"
                    + (" as an existing directory that is not a HarmonyOS project" if exists
                       else " (the directory does not exist yet)"),
    }
    replaced = False
    for index, existing in enumerate(rows):
        if existing.get("id") == LAYOUT_ROW_ID:
            rows[index] = row
            replaced = True
            break
    if not replaced:
        rows.append(row)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for existing in rows:
            writer.writerow({field: existing.get(field, "") for field in fields})
    return container, project


def fill_state(destination: Path, project: str, target: Path, layout: tuple[Path, Path] | None = None) -> None:
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
        elif layout and line.startswith("| Migration output (container / project inside it) | TODO | TODO |"):
            container, project_dir = layout
            lines[index] = line.replace(
                "| TODO | TODO |",
                f"| container {container.as_posix()} | project {project_dir.as_posix()} |", 1)
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
    parser.add_argument("--output-project",
                        help="bound output container (never the project directory): the migration "
                             "project is created in its <app-name>-ohos subdirectory; recorded in "
                             "environment.tsv as the layout binding")
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
    layout = record_layout(destination, args.output_project or "", output_app_name(app_root))
    fill_state(destination, app_root.name, app_root, layout)
    sync = Path(__file__).resolve().parent / "sync_knowledge.py"
    command = [sys.executable, str(sync), "--target", str(destination)]
    result = subprocess.run(command, check=False)
    if result.returncode:
        print("knowledge provenance recording failed; review migration/ohos/knowledge-manifest.tsv")
        return result.returncode
    print(f"migration_root={destination}")
    if layout:
        container, project = layout
        print(f"output_container={container.as_posix()}")
        print(f"migration_project={project.as_posix()} (create the HarmonyOS project here, never in the container root)")
    print(f"created={created} skipped_existing={skipped}")
    print(f"bootstrap_rows={bootstrap_rows}")
    next_step = Path(__file__).resolve().parent / "next_step.py"
    print(f"Next: run `python {next_step} {destination}` and follow the phase it names.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

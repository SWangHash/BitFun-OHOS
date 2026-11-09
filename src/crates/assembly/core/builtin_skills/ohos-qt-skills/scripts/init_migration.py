#!/usr/bin/env python3
"""Create the migration ledger ``<container>/migration/ohos/`` from the templates.

The first action of every migration, before reading the knowledge baseline,
probing the environment or running any build or device command::

    python <skill>/scripts/init_migration.py --target <app> --output-project <container> \
        --template-root <skill>/assets/templates/migration/ohos

``<app>`` is the root of the Qt application (the directory with its
``.pro``/``CMakeLists.txt``, or the repository root), never the HarmonyOS
output project; a missing directory or a HarmonyOS project is refused.
``--output-project`` is the bound output container (it may be any directory,
also the Qt repository root): the ledger goes into its ``migration/ohos`` and
the HarmonyOS project into another subdirectory of it, recorded in the
decisions phase. The script copies the ledger templates without overwriting
existing files (the ledgers start with only their header), sets the first
phase in STATE.md, records the Qt source root and its source revision and dirty
paths before any edit in the STATE.md Scope table, and runs sync_knowledge.py
for ``knowledge-manifest.tsv``. Rerunning it on an existing ledger only adds
missing files and records the Qt source root again.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


OHOS_PROJECT_MARKERS = ("AppScope/app.json5", "hvigorfile.ts", "build-profile.json5")
QT_PROJECT_PATTERNS = ("*.pro", "CMakeLists.txt", "*.qbs")
SKIP_DIRS = {".git", "migration", "build", "node_modules", "oh_modules"}
# Same Scope field as phase_gate.py.
SCOPE_SOURCE = "Qt source root"


def is_ohos_project(path: Path) -> bool:
    """A HarmonyOS (hvigor) project directory, i.e. the converted output."""
    return any((path / marker).is_file() for marker in OHOS_PROJECT_MARKERS)


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


def check_target(target: Path) -> None:
    """The ledger belongs to the Qt application, not to the HarmonyOS output project."""
    if not target.is_dir():
        raise SystemExit(
            f"ERROR: --target {target} does not exist. --target is the Qt application root "
            "(the directory holding its .pro/CMakeLists.txt or the repository root), not the "
            "HarmonyOS project directory that the migration will create.")
    if is_ohos_project(target):
        raise SystemExit(
            f"ERROR: --target {target} is a HarmonyOS project (AppScope/hvigor files). "
            "Pass the Qt application root as --target and the directory that holds this project as "
            "--output-project (the output container).")
    if not has_qt_project(target):
        print(f"WARNING: no .pro, CMakeLists.txt or .qbs found under --target {target}. "
              "Check that it is the root of the Qt application being migrated.")


def _git(target: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(["git", *args], cwd=target, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def source_revision(target: Path, ledger: Path | None = None) -> tuple[str, str]:
    """``(value, evidence)`` for the STATE.md Scope row: HEAD and the dirty paths outside the ledger.

    The output container may be the repository itself, so its ``migration/`` is left out.
    """
    head = _git(target, "rev-parse", "HEAD")
    if head is None:
        return "not a git checkout", "init_migration.py: git rev-parse HEAD failed (no repository or no git)"
    excluded = "migration"
    if ledger is not None:
        try:
            excluded = ledger.resolve().parent.relative_to(target.resolve()).as_posix()
        except ValueError:
            excluded = ""
    status = _git(target, "status", "--porcelain", "--", ".", *([f":(exclude){excluded}"] if excluded else [])) or ""
    dirty = [line[3:].strip() for line in status.splitlines() if line.strip()]
    shown = ", ".join(dirty[:10]) + (f" (+{len(dirty) - 10} more)" if len(dirty) > 10 else "")
    value = head.strip()[:12] + (f"; dirty: {shown}" if dirty else "; clean")
    return value.replace("|", "/"), "init_migration.py: git rev-parse HEAD, git status --porcelain before any edit"


def fill_state(destination: Path, target: Path) -> None:
    """Record the Qt source root (on every run), and seed the first phase and the source
    revision in a fresh STATE.md (never overwritten)."""
    state = destination / "STATE.md"
    if not state.is_file():
        return
    lines = state.read_text(encoding="utf-8").splitlines(keepends=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for index, line in enumerate(lines):
        label = line.split("|")[1].strip() if line.startswith("|") and line.count("|") >= 4 else ""
        ending = line[len(line.rstrip("\r\n")):]
        if label == SCOPE_SOURCE:
            lines[index] = f"| {label} | {target.as_posix()} | init_migration.py --target {stamp} |{ending}"
        elif label.startswith("Source revision") and line.rstrip().endswith("| TODO | TODO |"):
            value, evidence = source_revision(target, destination)
            lines[index] = f"| {label} | {value} | {evidence} |{ending}"
        elif line.startswith("- Current phase: `TODO`"):
            lines[index] = line.replace("`TODO`", "`environment`", 1)
        elif line.startswith("| Environment (`environment`") and "| planned |" in line:
            lines[index] = line.replace("| planned |", "| in-progress |", 1)
    state.write_text("".join(lines), encoding="utf-8", newline="")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template-root", type=Path, required=True,
                        help="assets/templates/migration/ohos")
    parser.add_argument("--target", type=Path, required=True,
                        help="Qt application root (not the HarmonyOS output project)")
    parser.add_argument("--output-project", type=Path, required=True,
                        help="bound output container: the ledger goes into its migration/ohos, the HarmonyOS "
                             "project into another subdirectory of it (recorded in the decisions phase)")
    args = parser.parse_args()
    source = args.template_root.resolve()
    app_root = args.target.resolve()
    container = args.output_project.expanduser().resolve()
    destination = container / "migration" / "ohos"
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

    fill_state(destination, app_root)
    sync = Path(__file__).resolve().parent / "sync_knowledge.py"
    command = [sys.executable, str(sync), "--target", str(destination)]
    result = subprocess.run(command, check=False)
    if result.returncode:
        print("knowledge provenance recording failed; review migration/ohos/knowledge-manifest.tsv")
        return result.returncode
    print(f"migration_root={destination}")
    print(f"output_container={container.as_posix()} (the HarmonyOS project goes into a subdirectory of it, "
          "recorded in the decisions phase)")
    print(f"created={created} skipped_existing={skipped}")
    scripts = Path(__file__).resolve().parent
    print(f"Next: run `python {scripts / 'env_probe.py'} --migration-root {destination}`, "
          f"then `python {scripts / 'next_step.py'} {destination}` and follow the phase it names.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

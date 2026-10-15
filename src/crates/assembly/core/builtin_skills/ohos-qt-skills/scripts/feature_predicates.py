#!/usr/bin/env python3
"""Shared model for external features (hooks): packages, ledger rows, predicates.

An external feature is a reviewed package under ``features/<feature-id>/``.
The skill reads only its ``hook.json`` (host phase, entry requirements, exit
criteria); how the feature works is described in its ``feature.md`` and is not
parsed here. ``feature_hooks.py`` (register/activate), ``feature_gate.py``
(enter/exit) and ``phase_gate.py`` (host-phase gate) all evaluate the same
fixed predicate set defined in this module.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from gate_state import PHASE_ORDER, _TERMINAL_PROGRESS, _now, _progress_statuses
from phase_gate import INVENTORY_CLOSED, PASS_STATUSES, QUEUE_DONE, non_placeholder, read_rows, split_ids, user_approved

SCHEMA = "qt-ohos-feature/1"
KINDS = ("capability", "verification")
ADOPTION = "feature-adoption.tsv"
ADOPTION_FIELDS = [
    "id", "feature_id", "kind", "host_phase", "package_path", "package_sha256", "decision_id",
    "status", "attempts", "current_step", "entry_gate", "exit_gate", "source_fingerprint",
    "capability_ids", "validation_ids", "notes", "evidence",
]
# Lifecycle written only by feature_hooks.py / feature_gate.py.
STATUSES = {"planned", "in-progress", "passed", "deferred-approved", "blocked"}
TERMINAL = {"passed", "deferred-approved", "blocked"}
# Ledgers created before the hook mechanism: `verified` meant passed and a
# `not-applicable` template row meant "no feature selected".
LEGACY_STATUSES = {"verified", "not-applicable"}
ACTIVATION_SCOPE = "external-features"
DEFAULT_MAX_ATTEMPTS = 3

PLACEHOLDERS = ("migration_root", "app_root", "package", "workdir", "FEAT")
PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_]+)\}")
# predicate -> (stages where it may be declared, required parameters, optional parameters)
PREDICATES = {
    "phase-passed": ({"entry", "exit"}, {"phase"}, set()),
    "feature": ({"entry", "exit"}, {"feature_id"}, {"status_in"}),
    "ledger-row": ({"entry", "exit"}, {"ledger"}, {"where", "status_in", "non_placeholder", "min"}),
    "validation-passed": ({"exit"}, {"ids"}, set()),
    "artifact": ({"entry", "exit"}, {"path"}, {"json"}),
    "command": ({"exit"}, {"run"}, {"timeout_s", "cwd"}),
    "no-open-diagnostics": ({"exit"}, set(), set()),
    "source-unchanged": ({"exit"}, set(), set()),
}
COMMAND_CWDS = ("workdir", "package", "app")
INTERPRETERS = {"python", "python3", "bash", "sh", "node"}
DEFAULT_TIMEOUT_S = 600
# A diagnostic stays open (failed, timeout, blocked, planned, in-progress) until resolved.
DIAGNOSTIC_CLOSED = {"resolved", "passed", "not-applicable"}

SOURCE_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".qml", ".js", ".ui", ".qrc", ".pro", ".pri",
    ".cmake", ".json5", ".ets", ".ts",
}
SOURCE_NAMES = {"CMakeLists.txt"}
SKIP_DIRS = {".git", "migration", "node_modules", "oh_modules", ".hvigor", ".cxx", ".idea", ".preview", "__pycache__"}


def skill_dir(package: Path, hook: dict) -> Path | None:
    """Directory of the vendored skill a package wraps (None only for an invalid package; lint rejects it)."""
    value = str(hook.get("skill", "") or "").strip()
    return (package / value) if value else None


def skill_frontmatter(skill_md: Path) -> dict[str, str]:
    """Top-level ``key: value`` pairs of a SKILL.md frontmatter (empty when there is none)."""
    try:
        lines = skill_md.read_text(encoding="utf-8", errors="replace").lstrip("\ufeff").splitlines()
    except OSError:
        return {}
    if not lines or lines[0].strip() != "---":
        return {}
    fields: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return fields
        if line[:1] not in (" ", "\t", "#") and ":" in line:
            key, _, value = line.partition(":")
            fields[key.strip()] = value.strip()
    return {}


def default_features_root() -> Path:
    return Path(__file__).resolve().parent.parent / "features"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_hash(package: Path) -> str:
    """One hash for the whole package tree, so a changed check script is noticed too."""
    lines = []
    for path in sorted(package.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        lines.append(f"{path.relative_to(package).as_posix()}\t{sha256_file(path)}")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def load_hook(package: Path) -> dict:
    """Parse ``hook.json``; raises ``ValueError`` with a readable reason."""
    path = package / "hook.json"
    if not path.is_file():
        raise ValueError(f"{path} is missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{path} is not valid JSON: {error}") from error
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def read_registry(features_root: Path) -> dict[str, dict[str, str]]:
    return {row["feature_id"]: row for row in read_rows(features_root / "registry.tsv") if row.get("feature_id", "").strip()}


def adoption_fields(root: Path) -> list[str]:
    path = root / ADOPTION
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return next(csv.reader(stream, delimiter="\t"), [])


def is_legacy(fields: list[str]) -> bool:
    """Ledger created before external features: playbook columns, no host phase."""
    return "playbook_path" in fields and "host_phase" not in fields


def read_adoption(root: Path) -> list[dict[str, str]]:
    return read_rows(root / ADOPTION)


def write_adoption(root: Path, rows: list[dict[str, str]]) -> None:
    fields = adoption_fields(root) or ADOPTION_FIELDS
    fd, tmp = tempfile.mkstemp(prefix=".feature-adoption.", suffix=".tmp", dir=str(root))
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: clean(row.get(name, "")) for name in fields})
    os.replace(tmp, root / ADOPTION)


def clean(value: str) -> str:
    return re.sub(r"[\t\r\n]+", " ", str(value)).strip()


def find_row(rows: list[dict[str, str]], feat_id: str) -> dict[str, str] | None:
    return next((row for row in rows if row.get("id", "").strip() == feat_id), None)


def status_of(row: dict[str, str]) -> str:
    status = row.get("status", "").strip().lower()
    return "passed" if status == "verified" else status


def attempts_of(row: dict[str, str]) -> int:
    try:
        return int(row.get("attempts", "") or 0)
    except ValueError:
        return 0


def host_phase_open(root: Path, phase: str) -> str | None:
    """``None`` when ``phase`` is the phase being worked on, else the reason it is not."""
    state = root / "STATE.md"
    if not state.is_file():
        return "STATE.md is missing"
    statuses = _progress_statuses(state.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True))
    if phase not in statuses:
        return f"STATE.md Progress has no row for phase {phase}"
    earlier = [name for name in PHASE_ORDER[:PHASE_ORDER.index(phase)]
               if name in statuses and statuses[name] not in _TERMINAL_PROGRESS]
    if earlier:
        return f"host phase {phase} is not open yet; these phases have not passed their gates: {', '.join(earlier)}"
    if statuses[phase] in _TERMINAL_PROGRESS:
        return f"host phase {phase} is already closed by its gate"
    return None


def source_fingerprint(app_root: Path) -> str:
    """Hash of the application's source and build files, excluding ``migration/`` and build output."""
    lines = []
    for directory, names, files in os.walk(app_root):
        names[:] = sorted(name for name in names if name not in SKIP_DIRS and not name.lower().startswith("build"))
        for name in sorted(files):
            path = Path(directory) / name
            if name not in SOURCE_NAMES and path.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            try:
                lines.append(f"{path.relative_to(app_root).as_posix()}\t{sha256_file(path)}")
            except OSError:
                continue
    return f"sha256:{hashlib.sha256(chr(10).join(lines).encode('utf-8')).hexdigest()} files={len(lines)}"


@dataclass
class Context:
    """Everything a predicate may look at for one ``FEAT-*`` row."""
    root: Path                      # <app>/migration/ohos
    package: Path                   # features/<feature-id>/
    row: dict[str, str]
    hook: dict
    rows: list[dict[str, str]] = field(default_factory=list)
    run_commands: bool = True       # the host-phase gate re-checks without re-running commands
    attempt: int = 1

    @property
    def app_root(self) -> Path:
        return self.root.parent.parent

    @property
    def workdir(self) -> Path:
        return self.root / "features" / self.row.get("id", "FEAT")

    def expand(self, text: str) -> str:
        values = {
            "migration_root": str(self.root), "app_root": str(self.app_root), "package": str(self.package),
            "workdir": str(self.workdir), "FEAT": self.row.get("id", ""),
        }
        return PLACEHOLDER_RE.sub(lambda match: values.get(match.group(1), match.group(0)), text)


def _as_list(value) -> list[str]:
    if value is None:
        return []
    return [str(item) for item in value] if isinstance(value, (list, tuple)) else [str(value)]


def _json_path(data, dotted: str):
    for key in dotted.split("."):
        if isinstance(data, dict) and key in data:
            data = data[key]
        else:
            return None, False
    return data, True


def _related_ids(ctx: Context) -> set[str]:
    return {ctx.row.get("id", "")} | set(split_ids(ctx.row.get("capability_ids", ""))) | set(split_ids(ctx.row.get("validation_ids", "")))


def evaluate(predicate: dict, ctx: Context) -> tuple[bool, str]:
    """Evaluate one predicate. Returns ``(passed, human-readable reason)``."""
    check = predicate.get("check", "")
    if check == "phase-passed":
        phase = predicate.get("phase", "")
        state = ctx.root / "STATE.md"
        statuses = _progress_statuses(state.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)) if state.is_file() else {}
        return statuses.get(phase, "") in _TERMINAL_PROGRESS, f"phase {phase} has passed its gate"
    if check == "feature":
        wanted = {item.lower() for item in _as_list(predicate.get("status_in"))} or {"passed"}
        found = [status_of(row) for row in ctx.rows if row.get("feature_id", "").strip() == predicate.get("feature_id")]
        return any(status in wanted for status in found), (
            f"feature {predicate.get('feature_id')} is {'/'.join(sorted(wanted))} (now: {', '.join(found) or 'not activated'})")
    if check == "ledger-row":
        ledger = str(predicate.get("ledger", ""))
        rows = [row for row in read_rows(ctx.root / ledger) if "-BOOT-" not in row.get("id", "")]
        where = predicate.get("where") or {}
        statuses = {item.lower() for item in _as_list(predicate.get("status_in"))}
        filled = _as_list(predicate.get("non_placeholder"))
        minimum = int(predicate.get("min", 1))
        hits = [
            row for row in rows
            if all(row.get(column, "").strip() in _as_list(value) for column, value in where.items())
            and (not statuses or row.get("status", "").strip().lower() in statuses)
            and all(non_placeholder(row.get(column, "")) for column in filled)
        ]
        detail = "; ".join(filter(None, [
            f"where {json.dumps(where, ensure_ascii=False)}" if where else "",
            f"status in {sorted(statuses)}" if statuses else "",
            f"filled {filled}" if filled else "",
        ]))
        return len(hits) >= minimum, f"{ledger} has at least {minimum} row(s) {detail} (found {len(hits)})"
    if check == "validation-passed":
        ids = predicate.get("ids")
        wanted = split_ids(ctx.row.get("validation_ids", "")) if ids == "row" else _as_list(ids)
        if not wanted:
            return False, f"{ctx.row.get('id')} lists no validation_ids; a feature closes only on VAL-* evidence"
        status = {row.get("id", ""): row.get("status", "").strip() for row in read_rows(ctx.root / "validation.tsv")}
        failing = [f"{value}={status.get(value) or 'missing'}" for value in wanted if status.get(value, "") not in PASS_STATUSES]
        return not failing, "validation rows passed: " + ", ".join(wanted) + (f" (not passed: {', '.join(failing)})" if failing else "")
    if check == "artifact":
        path = Path(ctx.expand(str(predicate.get("path", ""))))
        if not path.is_file():
            return False, f"artifact {path} exists"
        expected = predicate.get("json")
        if expected:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                return False, f"artifact {path} is valid JSON ({error})"
            for key, value in expected.items():
                actual, present = _json_path(data, key)
                if not present or actual != value:
                    return False, f"artifact {path.name} has {key}={json.dumps(value, ensure_ascii=False)} (found {json.dumps(actual, ensure_ascii=False) if present else 'no such key'})"
        return True, f"artifact {path} present"
    if check == "command":
        return _run_command(predicate, ctx)
    if check == "no-open-diagnostics":
        related = _related_ids(ctx)
        open_rows = [
            row.get("id", "") for row in read_rows(ctx.root / "diagnostics.tsv")
            if related & set(split_ids(row.get("affected_ids", "")))
            and row.get("status", "").strip().lower() not in DIAGNOSTIC_CLOSED
        ]
        return not open_rows, "no open diagnostics for this feature" + (f" (open: {', '.join(open_rows)})" if open_rows else "")
    if check == "source-unchanged":
        recorded = ctx.row.get("source_fingerprint", "").strip()
        if not recorded:
            return False, "source fingerprint was recorded at entry"
        current = source_fingerprint(ctx.app_root)
        return current == recorded, (
            "application sources unchanged since entry" if current == recorded else
            "application sources unchanged since entry (they changed: fix through the main flow, then run "
            "feature_gate.py enter --restart and repeat the verification)")
    return False, f"unknown predicate '{check}'"


def _run_command(predicate: dict, ctx: Context) -> tuple[bool, str]:
    args = [ctx.expand(str(item)) for item in predicate.get("run", [])]
    label = " ".join(str(item) for item in predicate.get("run", []))
    if not ctx.run_commands:
        return True, f"command not re-run by the phase gate: {label}"
    if args and args[0] in {"python", "python3"}:
        args[0] = sys.executable
    cwd = {"workdir": ctx.workdir, "package": ctx.package, "app": ctx.app_root}[predicate.get("cwd", "workdir")]
    ctx.workdir.mkdir(parents=True, exist_ok=True)
    log = ctx.workdir / f"exit-{ctx.attempt}.log"
    timeout = int(predicate.get("timeout_s", DEFAULT_TIMEOUT_S))
    try:
        # Package files (a vendored skill included) stay byte-identical: no __pycache__ next to its scripts.
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        done = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, errors="replace", timeout=timeout,
                              check=False, env=env)
        code, out, err = done.returncode, done.stdout or "", done.stderr or ""
    except subprocess.TimeoutExpired as error:
        code, out, err = None, str(error.stdout or ""), f"timeout after {timeout}s"
    except OSError as error:
        code, out, err = None, "", f"cannot start: {error}"
    with log.open("a", encoding="utf-8") as stream:
        stream.write(f"$ {label}\n# cwd={cwd} exit={code} at {_now()}\n{out}\n{err}\n")
    evidence = ""
    last = next((line for line in reversed(out.splitlines()) if line.strip()), "")
    if last.lstrip().startswith("{"):
        try:
            evidence = str(json.loads(last).get("evidence", ""))
        except json.JSONDecodeError:
            evidence = ""
    tail = evidence or (err.strip().splitlines()[-1] if err.strip() else last)
    return code == 0, f"command exits 0: {label} (exit={code if code is not None else 'none'}; {clean(tail)[:200]}; log {log})"


def implicit_criteria(ctx: Context) -> list[tuple[bool, str]]:
    """Exit rules every feature of a kind gets, whatever its ``hook.json`` declares."""
    results: list[tuple[bool, str]] = []
    kind = ctx.row.get("kind", "")
    pinned = ctx.row.get("package_sha256", "").strip()
    if ctx.run_commands:
        current = package_hash(ctx.package) if ctx.package.is_dir() else "missing"
        results.append((current == pinned, "feature package matches the hash pinned at activation"
                        + ("" if current == pinned else " (it drifted; only the user decides: feature_hooks.py repin)")))
    results.append(evaluate({"check": "no-open-diagnostics"}, ctx))
    results.append(evaluate({"check": "validation-passed", "ids": "row"}, ctx))
    if kind == "capability":
        caps = split_ids(ctx.row.get("capability_ids", ""))
        queue = {row.get("id", ""): row.get("status", "").strip() for row in read_rows(ctx.root / "work-queue.tsv")}
        inventory = {row.get("id", ""): row.get("status", "").strip().lower() for row in read_rows(ctx.root / "inventory.tsv")}
        open_caps = [value for value in caps if queue.get(value, "") not in QUEUE_DONE
                     or (value in inventory and inventory[value] not in INVENTORY_CLOSED)]
        results.append((bool(caps) and not open_caps,
                        "capability_ids are listed and closed in work-queue.tsv/inventory.tsv"
                        + (f" (open: {', '.join(open_caps)})" if open_caps else "" if caps else " (none listed)")))
    if kind == "verification":
        results.append(evaluate({"check": "source-unchanged"}, ctx))
    if (ctx.hook.get("permissions") or {}).get("device"):
        wanted = set(split_ids(ctx.row.get("validation_ids", "")))
        covered = any(
            row.get("status", "").strip() in PASS_STATUSES and wanted & set(split_ids(row.get("scenario_ids", "")))
            for row in read_rows(ctx.root / "device-runs.tsv")
        )
        results.append((covered, "a passed device-runs.tsv row lists one of this feature's validation_ids in scenario_ids"))
    return results


def evidence_paths(ctx: Context) -> list[Path]:
    declared = _as_list((ctx.hook.get("outputs") or {}).get("evidence_files"))
    declared += [str(item.get("path", "")) for item in (ctx.hook.get("exit") or {}).get("criteria", []) if item.get("check") == "artifact"]
    return sorted({Path(ctx.expand(item)) for item in declared if item})


def evidence_digest(ctx: Context) -> str:
    """What the exit verdict was based on; the host-phase gate recomputes it."""
    status = {row.get("id", ""): row.get("status", "").strip() for row in read_rows(ctx.root / "validation.tsv")}
    parts = [f"package={ctx.row.get('package_sha256', '').strip()}"]
    parts += [f"{path.name}={sha256_file(path) if path.is_file() else 'missing'}" for path in evidence_paths(ctx)]
    parts += [f"{value}={'pass' if status.get(value, '') in PASS_STATUSES else 'open'}"
              for value in split_ids(ctx.row.get("validation_ids", ""))]
    if ctx.row.get("kind") == "verification":
        parts.append(f"source={source_fingerprint(ctx.app_root)}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:16]


def build_context(root: Path, features_root: Path, row: dict[str, str], rows: list[dict[str, str]], **extra) -> Context:
    package = features_root / row.get("package_path", "").strip()
    return Context(root=root, package=package, row=row, hook=load_hook(package), rows=rows, **extra)


def activation_decision(root: Path) -> dict[str, str] | None:
    """The newest user-approved decision that selects external features."""
    rows = [row for row in read_rows(root / "decisions.tsv")
            if row.get("feature_or_scope", "").strip().lower() == ACTIVATION_SCOPE and user_approved(row)]
    return rows[-1] if rows else None


def selected_features(decision: dict[str, str]) -> set[str]:
    return {item for item in re.split(r"[,\s;]+", decision.get("selected", "").strip()) if item and item.lower() != "none"}

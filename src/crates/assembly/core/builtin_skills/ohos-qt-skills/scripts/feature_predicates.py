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
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from gate_state import PHASE_ORDER, _TERMINAL_PROGRESS, _now, _progress_statuses, refresh_progress
from phase_gate import non_placeholder, read_rows

import ohos_env
import vocab

SCHEMA = "qt-ohos-feature/1"
ADOPTION = "features.tsv"
ADOPTION_FIELDS = [
    "id", "feature_id", "kind", "status", "attempts", "current_step", "entry_gate", "exit_gate", "notes",
]
# The host phase follows from the kind (hook.json's hook.phase must match it, lint checks);
# the package is the registry's package_path of the feature_id.
HOST_PHASES = {"capability": "features", "verification": "validation"}
# A feature writes only its own features.tsv row and its workdir: the user's
# answers go into ``notes``, never into decisions.tsv, and a feature adds no
# inventory, tasks or validation rows.
# Lifecycle written only by feature_hooks.py / feature_gate.py; values in vocab.py.
KINDS = vocab.FEATURE_KINDS
STATUSES = vocab.FEATURE_STATUSES
TERMINAL = vocab.FEATURE_TERMINAL
DEFAULT_MAX_ATTEMPTS = 3

PLACEHOLDERS = ("migration_root", "app_root", "package", "workdir", "FEAT")
PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_]+)\}")
# predicate -> (stages where it may be declared, required parameters, optional parameters)
PREDICATES = {
    "phase-passed": ({"entry", "exit"}, {"phase"}, set()),
    "feature": ({"entry", "exit"}, {"feature_id"}, {"status_in"}),
    "ledger-row": ({"entry", "exit"}, {"ledger"}, {"where", "status_in", "non_placeholder", "min"}),
    "artifact": ({"entry", "exit"}, {"path"}, {"json"}),
    "command": ({"exit"}, {"run"}, {"timeout_s", "cwd"}),
    "no-open-diagnostics": ({"exit"}, set(), set()),
}
COMMAND_CWDS = ("workdir", "package", "app")
INTERPRETERS = {"python", "python3", "bash", "sh", "node"}
DEFAULT_TIMEOUT_S = 600


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


def host_phase(row: dict[str, str]) -> str:
    """The phase a FEAT row hooks into: features for capability, validation for verification."""
    return HOST_PHASES.get(row.get("kind", "").strip(), "")


def package_dir(features_root: Path, row: dict[str, str]) -> Path:
    """The feature package of a FEAT row: registry.tsv package_path of its feature_id."""
    feature_id = row.get("feature_id", "").strip()
    registered = read_registry(features_root).get(feature_id, {})
    return features_root / (registered.get("package_path", "").strip() or f"{feature_id}/")


def adoption_fields(root: Path) -> list[str]:
    path = root / ADOPTION
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return next(csv.reader(stream, delimiter="\t"), [])


def read_adoption(root: Path) -> list[dict[str, str]]:
    return read_rows(root / ADOPTION)


def write_adoption(root: Path, rows: list[dict[str, str]]) -> None:
    fields = adoption_fields(root) or ADOPTION_FIELDS
    fd, tmp = tempfile.mkstemp(prefix=".features.", suffix=".tmp", dir=str(root))
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: clean(row.get(name, "")) for name in fields})
    os.replace(tmp, root / ADOPTION)
    refresh_progress(root)


def clean(value: str) -> str:
    return re.sub(r"[\t\r\n]+", " ", str(value)).strip()


def find_row(rows: list[dict[str, str]], feat_id: str) -> dict[str, str] | None:
    return next((row for row in rows if row.get("id", "").strip() == feat_id), None)


def status_of(row: dict[str, str]) -> str:
    return row.get("status", "").strip().lower()


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


@dataclass
class Context:
    """Everything a predicate may look at for one ``FEAT-*`` row."""
    root: Path                      # <container>/migration/ohos
    package: Path                   # features/<feature-id>/
    row: dict[str, str]
    hook: dict
    rows: list[dict[str, str]] = field(default_factory=list)
    attempt: int = 1

    @property
    def app_root(self) -> Path:
        """The Qt source root of the STATE.md Scope (the ledger lives in the output container)."""
        return ohos_env.require_source_root(self.root)

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
        rows = read_rows(ctx.root / ledger)
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
        # The base migration closed its problems before the features phase, so an open one now is the feature's.
        open_rows = [row.get("id", "") for row in read_rows(ctx.root / "diagnostics.tsv")
                     if row.get("status", "").strip() == "open"]
        return not open_rows, "no open problem in diagnostics.tsv" + (f" (open: {', '.join(open_rows)})" if open_rows else "")
    return False, f"unknown predicate '{check}'"


def _run_command(predicate: dict, ctx: Context) -> tuple[bool, str]:
    args = [ctx.expand(str(item)) for item in predicate.get("run", [])]
    label = " ".join(str(item) for item in predicate.get("run", []))
    if args and args[0] in {"python", "python3"}:
        args[0] = sys.executable
    cwd = {"workdir": ctx.workdir, "package": ctx.package, "app": ctx.app_root}[predicate.get("cwd", "workdir")]
    ctx.workdir.mkdir(parents=True, exist_ok=True)
    log = ctx.workdir / f"exit-{ctx.attempt}.log"
    timeout = int(predicate.get("timeout_s", DEFAULT_TIMEOUT_S))
    try:
        # The command runs with the migration's environment table like every batch step (devecocli, Qt
        # tools resolve through its command_env); package files (a vendored skill included) stay
        # byte-identical: no __pycache__ next to its scripts.
        env = ohos_env.apply_profile(ohos_env.load_profile(ctx.root))
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        if (ctx.root / ohos_env.ENV_PROFILE).is_file():
            env[ohos_env.ENV_PROFILE_VAR] = str((ctx.root / ohos_env.ENV_PROFILE).resolve())
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
    """Exit rules every feature gets, whatever its ``hook.json`` declares."""
    results: list[tuple[bool, str]] = [evaluate({"check": "no-open-diagnostics"}, ctx)]
    if (ctx.hook.get("permissions") or {}).get("device"):
        # device-runs.tsv has one row: the application HAP's latest result (run = passed on the device).
        rows = read_rows(ctx.root / "device-runs.tsv")
        status = rows[-1].get("status", "").strip() if rows else ""
        results.append((status == "run", f"device-runs.tsv shows the latest application HAP ran on the device "
                                         f"(status run; now: {status or 'no row'})"))
    return results


def build_context(root: Path, features_root: Path, row: dict[str, str], rows: list[dict[str, str]], **extra) -> Context:
    package = package_dir(features_root, row)
    return Context(root=root, package=package, row=row, hook=load_hook(package), rows=rows, **extra)

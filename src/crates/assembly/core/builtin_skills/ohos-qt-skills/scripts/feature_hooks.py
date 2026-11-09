#!/usr/bin/env python3
"""Register, select and track external features (hooks) of the migration flow.

An external feature is a reviewed package in ``features/<feature-id>/`` that
hooks into one host phase of the gated flow. The main flow treats it as a gray
box: it manages registration, activation, the entry gate and the exit gate,
and shows progress; what happens inside is described by the package's
``feature.md``. Entry and exit gates are ``feature_gate.py``.

Maintainer (outside a migration)::

    python scripts/feature_hooks.py lint [<feature-id> ...]
    python scripts/feature_hooks.py list

Registering a delivered skill: ``feature_register.py`` (inspect / scaffold).

Migration agent (``<root>`` is ``<container>/migration/ohos``)::

    python scripts/feature_hooks.py candidates <root> --request "<user request>"
    python scripts/feature_hooks.py activate <root> --answer "<user's words>" [--select <feature-id> ...]
    python scripts/feature_hooks.py progress <root> FEAT-001 --step "<milestone>" [--note TEXT]
    python scripts/feature_hooks.py close <root> FEAT-001 --answer "<user's words>"
    python scripts/feature_hooks.py status <root>

Features are never activated automatically. All HarmonyOS feature work sits
in the ``features`` phase, which opens only after the base Qt migration has
passed ``diagnostics``: there the user selects from the registered features
(default: none) and ``activate --answer "<user's words>"`` writes one FEAT
row per selected feature while that phase is open, with the answer in its
``notes``. ``candidates`` records the question as STATE.md ``Feature selection:
pending`` (the phase is blocked until the user answers) and ``activate``
records the answer there, also when nothing is selected. ``close`` defers a
feature the user gives up (``deferred-approved``). The answer is not a decisions.tsv row, and a feature writes no
inventory, tasks or validation rows: features.tsv and the feature's workdir
are its whole record. Selected ``capability`` features run in ``features``;
selected ``verification`` features run later in ``validation``.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import feature_predicates as fp
from gate_state import _now, feature_selection, set_feature_selection

# Host phases a feature may hook into, and the kind each one accepts.
# Phases 1-5 port, build and diagnose the base Qt application and accept no
# hooks; phase 6 `features` selects and runs features, phase 7 verifies.
HOOK_POINTS = {"features": "capability", "validation": "verification"}
# The phase in which the user selects external features (of every kind).
SELECTION_PHASE = "features"
REGISTRY_FIELDS = ["feature_id", "title", "kind", "package_path", "owner", "summary"]
# Every feature is delivered as a skill, kept untouched in the package (hook.json "skill");
# feature.md is only the adapter between the skill and the migration ledgers.
REQUIRED_SECTIONS = {
    "capability": ("前置条件", "执行入口", "结果记录", "准出对照", "失败处理"),
    "verification": ("前置条件", "执行入口", "证据产出", "判定规则", "失败处理"),
}
# Ledgers other than features.tsv that change while a feature runs; only the
# main-flow scripts write them (batch_checks.py / record_diagnostic.py, device_run.py).
# A feature never writes inventory, decisions, tasks or validation rows.
FEATURE_OUTPUT_LEDGERS = ("diagnostics.tsv", "device-runs.tsv")
FEATURE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def ledger_names() -> set[str]:
    templates = Path(__file__).resolve().parent.parent / "assets" / "templates" / "migration" / "ohos"
    return {path.name for path in templates.glob("*.tsv")} | {"knowledge-manifest.tsv", "knowledge-usage.tsv", "changes.tsv"}


# --------------------------------------------------------------------------- lint

def _check_predicate(item, stage: str, where: str, package: Path, errors: list[str]) -> None:
    if not isinstance(item, dict):
        errors.append(f"{where}: a predicate must be a JSON object")
        return
    check = item.get("check")
    if check not in fp.PREDICATES:
        errors.append(f"{where}: unknown predicate '{check}' (allowed: {', '.join(fp.PREDICATES)})")
        return
    stages, required, optional = fp.PREDICATES[check]
    if stage not in stages:
        errors.append(f"{where}: '{check}' is not allowed in {stage} conditions")
    keys = set(item) - {"check"}
    for name in sorted(required - keys):
        errors.append(f"{where}: '{check}' needs '{name}'")
    for name in sorted(keys - required - optional):
        errors.append(f"{where}: '{check}' has unknown parameter '{name}'")
    for text in _strings(item):
        for name in fp.PLACEHOLDER_RE.findall(text):
            if name not in fp.PLACEHOLDERS:
                errors.append(f"{where}: unknown placeholder '{{{name}}}' (allowed: {', '.join(fp.PLACEHOLDERS)})")
    if check == "phase-passed" and item.get("phase") not in fp.PHASE_ORDER:
        errors.append(f"{where}: phase '{item.get('phase')}' is not a phase id")
    if check == "ledger-row":
        if item.get("ledger") not in ledger_names():
            errors.append(f"{where}: '{item.get('ledger')}' is not a migration ledger")
        if "where" in item and not isinstance(item["where"], dict):
            errors.append(f"{where}: 'where' must map column -> value or list of values")
        if "min" in item and (not isinstance(item["min"], int) or item["min"] < 1):
            errors.append(f"{where}: 'min' must be a positive integer")
    if check == "artifact" and "json" in item and not isinstance(item["json"], dict):
        errors.append(f"{where}: 'json' must map key path -> expected value")
    if check == "command":
        _check_command(item, where, package, errors)


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _check_command(item: dict, where: str, package: Path, errors: list[str]) -> None:
    run = item.get("run")
    if not (isinstance(run, list) and run and all(isinstance(value, str) for value in run)):
        errors.append(f"{where}: 'run' must be a non-empty list of strings")
        return
    program = run[0]
    if program in fp.INTERPRETERS:
        script = next((value for value in run[1:] if not value.startswith("-")), "")
        if not script.startswith("{package}/"):
            errors.append(f"{where}: an interpreter may only run a script inside the package ('{{package}}/...'), got '{script}'")
            return
        program = script
    elif not program.startswith("{package}/"):
        errors.append(f"{where}: 'run' must start with a system interpreter ({', '.join(sorted(fp.INTERPRETERS))}) "
                      f"or a '{{package}}/...' script, got '{program}'")
        return
    relative = program[len("{package}/"):]
    target = (package / relative).resolve()
    if package.resolve() not in target.parents or not target.is_file():
        errors.append(f"{where}: script '{program}' does not exist inside the package")
    timeout = item.get("timeout_s", fp.DEFAULT_TIMEOUT_S)
    if not isinstance(timeout, int) or timeout < 1:
        errors.append(f"{where}: 'timeout_s' must be a positive integer")
    if item.get("cwd", "workdir") not in fp.COMMAND_CWDS:
        errors.append(f"{where}: 'cwd' must be one of {', '.join(fp.COMMAND_CWDS)}")


def lint_package(package: Path, registry: dict[str, dict[str, str]], kb_root: Path) -> tuple[list[str], list[str]]:
    """Return ``(errors, warnings)`` for one feature package."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        hook = fp.load_hook(package)
    except ValueError as error:
        return [str(error)], warnings
    feature_id = hook.get("feature_id")
    if hook.get("schema") != fp.SCHEMA:
        errors.append(f"schema must be '{fp.SCHEMA}'")
    if feature_id != package.name or not FEATURE_ID_RE.match(str(feature_id or "")):
        errors.append(f"feature_id '{feature_id}' must be kebab-case and equal the directory name '{package.name}'")
    for name in ("title", "version", "owner"):
        if not str(hook.get(name, "")).strip():
            errors.append(f"'{name}' is required")
    kind = hook.get("kind")
    if kind not in fp.KINDS:
        errors.append(f"kind must be one of {', '.join(fp.KINDS)}")
    point = (hook.get("hook") or {}).get("phase")
    if point not in HOOK_POINTS:
        errors.append(f"hook.phase '{point}' is not an open hook point (open: "
                      + ", ".join(f"{phase} [{accepts}]" for phase, accepts in HOOK_POINTS.items()) + ")")
    elif kind in fp.KINDS and HOOK_POINTS[point] != kind:
        errors.append(f"hook.phase '{point}' accepts kind '{HOOK_POINTS[point]}', not '{kind}'")
    after = (hook.get("hook") or {}).get("after", [])
    if not isinstance(after, list):
        errors.append("hook.after must be a list of feature ids")
        after = []
    for other in after:
        if other == feature_id:
            errors.append("hook.after must not name the feature itself")
        elif other in registry and fp.host_phase(registry[other]) != point:
            errors.append(f"hook.after '{other}' hooks into another phase; ordering only applies within one host phase")
        elif other not in registry:
            warnings.append(f"hook.after '{other}' is not registered")
    keywords = (hook.get("trigger") or {}).get("keywords")
    if not (isinstance(keywords, list) and keywords and all(isinstance(value, str) and value.strip() for value in keywords)):
        errors.append("trigger.keywords must be a non-empty list of words the user would use for this feature")
    extra = set(hook.get("trigger") or {}) - {"keywords"}
    if extra:
        errors.append(f"trigger has unknown fields {sorted(extra)}; features are only activated by the user's selection")
    requires = (hook.get("entry") or {}).get("requires", [])
    if not isinstance(requires, list):
        errors.append("entry.requires must be a list")
        requires = []
    for index, item in enumerate(requires, 1):
        _check_predicate(item, "entry", f"entry.requires[{index}]", package, errors)
    exit_ = hook.get("exit") or {}
    criteria = exit_.get("criteria")
    if not (isinstance(criteria, list) and criteria):
        errors.append("exit.criteria needs at least one explicit condition")
        criteria = []
    for index, item in enumerate(criteria, 1):
        _check_predicate(item, "exit", f"exit.criteria[{index}]", package, errors)
    attempts = exit_.get("max_attempts", fp.DEFAULT_MAX_ATTEMPTS)
    if not isinstance(attempts, int) or attempts < 1:
        errors.append("exit.max_attempts must be a positive integer")
    outputs = hook.get("outputs") or {}
    for name in outputs.get("ledgers", []) or []:
        if name not in FEATURE_OUTPUT_LEDGERS:
            errors.append(f"outputs.ledgers: '{name}' is not allowed; a feature keeps its record in its features.tsv row "
                          f"and {{workdir}}, and only the main-flow scripts write {', '.join(FEATURE_OUTPUT_LEDGERS)}")
    for path in outputs.get("evidence_files", []) or []:
        if not str(path).startswith("{workdir}/"):
            errors.append(f"outputs.evidence_files: '{path}' must live in '{{workdir}}/'")
    permissions = hook.get("permissions") or {}
    if kind == "verification" and permissions.get("modify_sources", False):
        errors.append("a verification feature may not modify sources (permissions.modify_sources must be false); "
                      "defects go back to the main flow")
    playbook = package / str(hook.get("playbook", "feature.md"))
    skill = fp.skill_dir(package, hook)
    if skill is None:
        errors.append('hook.json must name the delivered skill directory ("skill": "skill"); every feature is a skill '
                      "kept unchanged inside its package")
    else:
        resolved = skill.resolve()
        if package.resolve() not in resolved.parents:
            errors.append(f"skill '{hook.get('skill')}' must be a subdirectory of the package")
        elif not (skill / "SKILL.md").is_file():
            errors.append(f"skill '{hook.get('skill')}' has no SKILL.md; put the delivered skill there unchanged")
        else:
            front = fp.skill_frontmatter(skill / "SKILL.md")
            lacking = [name for name in ("name", "description") if not front.get(name)]
            if lacking:
                errors.append(f"{hook.get('skill')}/SKILL.md frontmatter lacks {', '.join(lacking)}; it is not a complete skill")
            if (skill / "hook.json").exists():
                errors.append("hook.json must stay outside the skill directory; the delivered skill is kept unchanged")
            if resolved == playbook.resolve().parent or resolved in playbook.resolve().parents:
                errors.append("the playbook (adapter) must stay outside the skill directory; the delivered skill is kept unchanged")
    if not playbook.is_file():
        errors.append(f"playbook '{playbook.name}' is missing")
    elif kind in REQUIRED_SECTIONS:
        headings = {line.strip().lstrip("#").strip() for line in playbook.read_text(encoding="utf-8").splitlines()
                    if line.startswith("## ")}
        missing = [name for name in REQUIRED_SECTIONS[kind] if name not in headings]
        if missing:
            errors.append(f"{playbook.name} is missing adapter sections for kind {kind}: {', '.join(missing)}")
    placeholders = sum(path.read_text(encoding="utf-8", errors="replace").count("TODO")
                       for path in (package / "hook.json", playbook) if path.is_file())
    if placeholders:
        warnings.append(f"{placeholders} TODO placeholder(s) left in hook.json/{playbook.name}; fill them before review")
    for ref in hook.get("refs", []) or []:
        if "<" in str(ref) or not (kb_root / str(ref)).is_file():
            errors.append(f"refs: '{ref}' does not exist in the current upstream-kb/knowledge baseline")
    row = registry.get(str(feature_id))
    if row is None:
        warnings.append("not registered in registry.tsv yet (register after review)")
    else:
        if row.get("kind") != kind:
            errors.append(f"registry.tsv kind '{row.get('kind')}' differs from hook.json '{kind}'")
        if row.get("package_path", "").strip().rstrip("/") != package.name:
            errors.append(f"registry.tsv package_path '{row.get('package_path')}' must be '{package.name}/'")
    return errors, warnings


def _after_cycles(features_root: Path, registry: dict[str, dict[str, str]]) -> list[str]:
    graph = {}
    for feature_id, row in registry.items():
        try:
            graph[feature_id] = list(((fp.load_hook(features_root / row.get("package_path", "").strip()).get("hook") or {}).get("after")) or [])
        except ValueError:
            graph[feature_id] = []
    errors, state = [], {}

    def visit(node: str, path: list[str]) -> None:
        state[node] = 1
        for other in graph.get(node, []):
            if state.get(other) == 1:
                errors.append("hook.after forms a cycle: " + " -> ".join(path + [node, other]))
            elif other in graph and not state.get(other):
                visit(other, path + [node])
        state[node] = 2

    for node in graph:
        if not state.get(node):
            visit(node, [])
    return errors


def cmd_lint(args) -> int:
    root = Path(args.features_root)
    registry = fp.read_registry(root)
    kb_root = Path(args.kb_root) if args.kb_root else root.parent / "upstream-kb" / "knowledge"
    names = args.feature_ids or sorted({path.name for path in root.iterdir() if path.is_dir() and not path.name.startswith(("_", "."))} | set(registry))
    failed = 0
    header = (root / "registry.tsv").read_text(encoding="utf-8").splitlines()[:1] if (root / "registry.tsv").is_file() else []
    if header and header[0].split("\t") != REGISTRY_FIELDS:
        print(f"ERROR registry.tsv header must be: {chr(9).join(REGISTRY_FIELDS)}")
        failed += 1
    for name in names:
        package = root / name
        if not package.is_dir():
            print(f"ERROR {name}: package directory {package} is missing")
            failed += 1
            continue
        errors, warnings = lint_package(package, registry, kb_root)
        for message in warnings:
            print(f"WARN  {name}: {message}")
        for message in errors:
            print(f"ERROR {name}: {message}")
        failed += bool(errors)
        if not errors:
            print(f"OK    {name}")
    if not args.feature_ids:
        for message in _after_cycles(root, registry):
            print(f"ERROR {message}")
            failed += 1
    if not names:
        print("no feature packages")
    return 1 if failed else 0


def cmd_list(args) -> int:
    registry = fp.read_registry(Path(args.features_root))
    if not registry:
        print("no registered features")
        return 0
    for row in registry.values():
        print("\t".join(row.get(name, "") for name in REGISTRY_FIELDS))
    return 0


# --------------------------------------------------------------------------- activation

def _entry_summary(package: Path) -> str:
    try:
        requires = (fp.load_hook(package).get("entry") or {}).get("requires", [])
    except ValueError as error:
        return f"(hook.json unreadable: {error})"
    parts = []
    for item in requires:
        check = item.get("check")
        if check == "phase-passed":
            parts.append(f"phase {item.get('phase')} passed")
        elif check == "feature":
            parts.append(f"feature {item.get('feature_id')} done")
        elif check == "ledger-row":
            parts.append(f"{item.get('ledger')} row {item.get('where') or ''}".strip())
        elif check == "artifact":
            parts.append(f"file {item.get('path')}")
    return "; ".join(parts) or "none"


def cmd_candidates(args) -> int:
    root = Path(args.features_root)
    registry = fp.read_registry(root)
    if not registry:
        print("No external features are registered; record nothing (the features gate does not ask for a selection).")
        return 0
    request = (args.request or "").lower()
    print("External features available for this migration (none is enabled unless the user selects it):")
    for phase, kind in HOOK_POINTS.items():
        group = []
        for feature_id, row in registry.items():
            if fp.host_phase(row) != phase:
                continue
            try:
                keywords = (fp.load_hook(root / row.get("package_path", "").strip()).get("trigger") or {}).get("keywords") or []
            except ValueError:
                keywords = []
            hits = [word for word in keywords if word.lower() in request] if request else []
            group.append((not hits, feature_id, row, hits))
        if not group:
            continue
        print(f"\nPhase {fp.PHASE_ORDER.index(phase) + 1} `{phase}` ({kind}):")
        for _, feature_id, row, hits in sorted(group):
            flags = []
            if hits:
                flags.append("mentioned in request: " + ", ".join(hits))
            print(f"- {feature_id} — {row.get('title')}: {row.get('summary')}"
                  + (f" [{'; '.join(flags)}]" if flags else ""))
            print(f"  owner {row.get('owner') or '-'}; entry needs: {_entry_summary(root / row.get('package_path', '').strip())}")
    state = Path(args.root) / "STATE.md"
    if state.is_file() and feature_selection(state.read_text(encoding="utf-8", errors="replace")) != "answered":
        set_feature_selection(Path(args.root), "`pending`")
    print("\nAsk the user which to enable (default: none; never in decisions.tsv; the phase is blocked until the "
          "answer). Record the answer, also when nothing is selected: feature_hooks.py activate <root> --answer "
          "\"<user's words>\" [--select <id> ...]")
    return 0


def _next_feat_id(rows: list[dict[str, str]]) -> str:
    numbers = [int(match.group(1)) for row in rows if (match := re.match(r"FEAT-(\d+)$", row.get("id", "").strip()))]
    return f"FEAT-{max(numbers, default=0) + 1:03d}"


def cmd_activate(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    errors = []
    # Selection belongs to the features phase: the base migration must have
    # passed diagnostics first, and a closed features phase takes no new ones.
    reason = fp.host_phase_open(root, SELECTION_PHASE)
    if reason:
        errors.append(f"external features are selected in the {SELECTION_PHASE} phase only: {reason}")
    if not args.answer.strip():
        errors.append("--answer is empty: pass the user's answer to the feature question")
    registry = fp.read_registry(features_root)
    rows = fp.read_adoption(root)
    active = {row.get("feature_id", "").strip() for row in rows}
    for feature_id in args.select:
        row = registry.get(feature_id)
        if row is None:
            errors.append(f"{feature_id} is not registered in features/registry.tsv")
        elif not fp.host_phase(row):
            errors.append(f"{feature_id} has unknown kind '{row.get('kind')}' in registry.tsv")
    if errors:
        print("ERROR activate")
        for error in errors:
            print(f"- {error}")
        return 1
    added = []
    for feature_id in args.select:
        if feature_id in active:
            continue
        registered = registry[feature_id]
        package = features_root / registered["package_path"].strip()
        hook = fp.load_hook(package)
        row = {name: "" for name in fp.ADOPTION_FIELDS}
        row.update({
            "id": _next_feat_id(rows), "feature_id": feature_id, "kind": hook.get("kind", ""),
            "status": "planned", "attempts": "0",
            "notes": fp.clean(f"activated @{_now()}: user answer: {args.answer}"),
        })
        rows.append(row)
        added.append(f"{row['id']} {feature_id} ({row['kind']}, hooks into {fp.host_phase(row)})")
    if added:
        fp.write_adoption(root, rows)
    set_feature_selection(root, f"`answered` @{_now()}: {fp.clean(args.answer)}")
    if args.select:
        print("activated:" if added else "already active:", "; ".join(added) or ", ".join(sorted(args.select)))
    else:
        print("the user selected no external feature; no FEAT rows written")
    return 0


def cmd_close(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    errors = []
    if row is None:
        errors.append(f"{args.feat} is not in features.tsv")
    elif fp.status_of(row) in fp.TERMINAL:
        errors.append(f"{args.feat} is already {fp.status_of(row)}")
    if not args.answer.strip():
        errors.append("--answer is empty: closing a feature needs the user's answer")
    if errors:
        print(f"ERROR close {args.feat}")
        for error in errors:
            print(f"- {error}")
        return 1
    row.update({
        "status": "deferred-approved", "current_step": "",
        "notes": fp.clean(f"{row.get('notes', '')}; closed deferred-approved: user answer: {args.answer}"
                          + (f"; {args.note}" if args.note else "")).lstrip("; "),
    })
    fp.write_adoption(root, rows)
    print(f"{args.feat} deferred-approved; list it in report.md External features")
    return 0


def cmd_progress(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    if row is None or fp.status_of(row) != "in-progress":
        print(f"ERROR progress {args.feat}: only an in-progress feature (after feature_gate.py enter) reports steps")
        return 1
    row["current_step"] = args.step
    if args.note:
        row["notes"] = fp.clean(f"{row.get('notes', '')}; {args.note}").lstrip("; ")
    fp.write_adoption(root, rows)
    print(f"{args.feat} step: {args.step}")
    return 0


def _last_gate(row: dict[str, str]) -> str:
    for column, label in (("exit_gate", "last failed exit"), ("entry_gate", "enter")):
        value = row.get(column, "").strip()
        if value:
            return f"{label} {value}"
    return "activated"


def table_lines(rows: list[dict[str, str]]) -> list[str]:
    """Printed by ``status``; nothing copies this table into a document."""
    lines = ["| FEAT | feature_id | Phase | Kind | Status | Step | Last gate |", "|---|---|---|---|---|---|---|"]
    for row in rows:
        cells = [row.get("id", ""), row.get("feature_id", ""), fp.host_phase(row) or "features",
                 row.get("kind", "") or "capability", row.get("status", ""), row.get("current_step", "") or "—", _last_gate(row)]
        lines.append("| " + " | ".join(cell.replace("|", "/") for cell in cells) + " |")
    return lines


def cmd_status(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    if not rows:
        print("no external features activated")
        return 0
    for line in table_lines(rows):
        print(line)
    return 0


# --------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features-root", default=str(fp.default_features_root()), help="features/ directory (default: the skill's)")
    sub = parser.add_subparsers(dest="command", required=True)

    lint = sub.add_parser("lint", help="check feature packages before registration")
    lint.add_argument("feature_ids", nargs="*")
    lint.add_argument("--kb-root", help="upstream-kb/knowledge directory for refs (default: next to features/)")
    lint.set_defaults(func=cmd_lint)
    sub.add_parser("list", help="print registry.tsv").set_defaults(func=cmd_list)

    candidates = sub.add_parser("candidates", help="list registered features for the user to choose from (features phase)")
    candidates.add_argument("root")
    candidates.add_argument("--request", default="", help="the user's original migration request, used only for ranking")
    candidates.set_defaults(func=cmd_candidates)

    activate = sub.add_parser("activate", help="write FEAT rows for the features the user selected")
    activate.add_argument("root")
    activate.add_argument("--answer", required=True, help="the user's answer to the feature question (recorded in notes)")
    activate.add_argument("--select", action="append", default=[], metavar="FEATURE_ID")
    activate.set_defaults(func=cmd_activate)

    progress = sub.add_parser("progress", help="report the current step of an in-progress feature")
    progress.add_argument("root")
    progress.add_argument("feat")
    progress.add_argument("--step", required=True)
    progress.add_argument("--note", default="")
    progress.set_defaults(func=cmd_progress)

    close = sub.add_parser("close", help="defer a feature without passing it (user decision: deferred-approved)")
    close.add_argument("root")
    close.add_argument("feat")
    close.add_argument("--answer", required=True, help="the user's answer that closes the feature (recorded in notes)")
    close.add_argument("--note", default="")
    close.set_defaults(func=cmd_close)

    status = sub.add_parser("status", help="print the external features of a migration")
    status.add_argument("root")
    status.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

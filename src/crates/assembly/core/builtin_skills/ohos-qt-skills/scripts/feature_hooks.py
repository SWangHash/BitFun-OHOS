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

Migration agent (``<root>`` is ``<app>/migration/ohos``)::

    python scripts/feature_hooks.py candidates <root> --request "<user request>"
    python scripts/feature_hooks.py activate <root> --decision DEC-005 [--select <feature-id> ...]
    python scripts/feature_hooks.py progress <root> FEAT-001 --step "<milestone>" [--note TEXT]
    python scripts/feature_hooks.py close <root> FEAT-001 --status deferred-approved|blocked --decision DEC-009
    python scripts/feature_hooks.py repin <root> FEAT-001 --decision DEC-010
    python scripts/feature_hooks.py status <root>

Features are never activated automatically: the user selects them at the
contract phase (default: none), and ``activate`` only accepts a user-approved
``decisions.tsv`` row with ``feature_or_scope=external-features``.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

import feature_predicates as fp
from gate_state import _now
from phase_gate import read_rows, user_approved

# Host phases a feature may hook into, and the kind each one accepts.
# Phases 4, 5 and 7 are reserved; phases 1-3 build the contract and are closed.
HOOK_POINTS = {"features": "capability", "handoff": "verification"}
REGISTRY_FIELDS = ["feature_id", "title", "kind", "hook_phase", "status", "package_path", "owner", "summary"]
REGISTRY_STATUSES = {"stable", "beta", "draft"}
# Every feature is delivered as a skill, kept untouched in the package (hook.json "skill");
# feature.md is only the adapter between the skill and the migration ledgers.
REQUIRED_SECTIONS = {
    "capability": ("前置条件", "执行入口", "结果记录", "准出对照", "失败处理"),
    "verification": ("前置条件", "执行入口", "证据产出", "判定规则", "失败处理"),
}
FEATURE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STATE_HEADING = "## External features"
STATE_INTRO = "Written by `feature_hooks.py` / `feature_gate.py`; do not edit by hand."


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
    if check == "validation-passed":
        ids = item.get("ids")
        if ids != "row" and not (isinstance(ids, list) and ids and all(str(value).startswith("VAL-") for value in ids)):
            errors.append(f"{where}: 'ids' must be \"row\" or a non-empty list of VAL-* ids")
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
        elif other in registry and registry[other].get("hook_phase") != point:
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
        if name not in ledger_names():
            errors.append(f"outputs.ledgers: '{name}' is not a migration ledger")
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
        if row.get("kind") != kind or row.get("hook_phase") != point:
            errors.append(f"registry.tsv kind/hook_phase ({row.get('kind')}/{row.get('hook_phase')}) differ from hook.json ({kind}/{point})")
        if row.get("package_path", "").strip().rstrip("/") != package.name:
            errors.append(f"registry.tsv package_path '{row.get('package_path')}' must be '{package.name}/'")
        if row.get("status") not in REGISTRY_STATUSES:
            errors.append(f"registry.tsv status '{row.get('status')}' must be one of {', '.join(sorted(REGISTRY_STATUSES))}")
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
            print(f"OK    {name} package_sha256={fp.package_hash(package)}")
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
    registry = {key: row for key, row in fp.read_registry(root).items() if row.get("status") != "draft"}
    if not registry:
        print("No external features are registered; record nothing (the contract gate does not ask for a selection).")
        return 0
    request = (args.request or "").lower()
    print("External features available for this migration (none is enabled unless the user selects it):")
    for phase, kind in HOOK_POINTS.items():
        group = []
        for feature_id, row in registry.items():
            if row.get("hook_phase") != phase:
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
            if row.get("status") == "beta":
                flags.append("beta")
            print(f"- {feature_id} — {row.get('title')}: {row.get('summary')}"
                  + (f" [{'; '.join(flags)}]" if flags else ""))
            print(f"  owner {row.get('owner') or '-'}; entry needs: {_entry_summary(root / row.get('package_path', '').strip())}")
    print("\nAsk the user which to enable (default: none). Record the answer in decisions.tsv with "
          "feature_or_scope=external-features, selected=<ids or none>, owner=user, status=approved, "
          "evidence 'user: ...', then run: feature_hooks.py activate <root> --decision DEC-xxx [--select <id> ...]")
    return 0


def _next_feat_id(rows: list[dict[str, str]]) -> str:
    numbers = [int(match.group(1)) for row in rows if (match := re.match(r"FEAT-(\d+)$", row.get("id", "").strip()))]
    return f"FEAT-{max(numbers, default=0) + 1:03d}"


def _decision(root: Path, decision_id: str) -> dict[str, str] | None:
    return next((row for row in read_rows(root / "decisions.tsv") if row.get("id", "").strip() == decision_id), None)


def cmd_activate(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    errors = []
    fields = fp.adoption_fields(root)
    if fp.is_legacy(fields):
        print("BLOCKED activate: feature-adoption.tsv uses the old header; external features need the new ledger "
              "(only the user may decide to rebuild it from assets/templates/migration/ohos/feature-adoption.tsv)")
        return 1
    decision = _decision(root, args.decision)
    if decision is None:
        errors.append(f"{args.decision} is not in decisions.tsv")
    else:
        if decision.get("feature_or_scope", "").strip().lower() != fp.ACTIVATION_SCOPE:
            errors.append(f"{args.decision} must have feature_or_scope={fp.ACTIVATION_SCOPE}")
        if not user_approved(decision):
            errors.append(f"{args.decision} must be status=approved, owner=user, evidence quoting 'user: ...' "
                          "(a question that timed out or was skipped is not an answer); the agent never selects features")
        selected = fp.selected_features(decision)
        if selected != set(args.select):
            errors.append(f"--select {sorted(args.select) or 'nothing'} differs from {args.decision} selected={sorted(selected) or 'none'}")
    registry = fp.read_registry(features_root)
    rows = fp.read_adoption(root)
    active = {row.get("feature_id", "").strip() for row in rows}
    for feature_id in args.select:
        row = registry.get(feature_id)
        if row is None:
            errors.append(f"{feature_id} is not registered in features/registry.tsv")
        elif row.get("status") == "draft":
            errors.append(f"{feature_id} is draft and cannot be activated")
        elif row.get("hook_phase") not in HOOK_POINTS:
            errors.append(f"{feature_id} hooks into '{row.get('hook_phase')}', which is not an open hook point")
    if errors:
        print("BLOCKED activate")
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
            "host_phase": (hook.get("hook") or {}).get("phase", ""), "package_path": registered["package_path"].strip(),
            "package_sha256": fp.package_hash(package), "decision_id": args.decision, "status": "planned", "attempts": "0",
            "notes": f"activated by {args.decision} @{_now()}",
        })
        rows.append(row)
        added.append(f"{row['id']} {feature_id} ({row['kind']}, hooks into {row['host_phase']})")
    if added:
        fp.write_adoption(root, rows)
    write_state_table(root, rows)
    if args.select:
        print("activated:" if added else "already active:", "; ".join(added) or ", ".join(sorted(args.select)))
    else:
        print(f"recorded: the user selected no external feature ({args.decision}); no FEAT rows written")
    return 0


def cmd_close(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    decision = _decision(root, args.decision)
    errors = []
    if row is None:
        errors.append(f"{args.feat} is not in feature-adoption.tsv")
    elif fp.status_of(row) in fp.TERMINAL:
        errors.append(f"{args.feat} is already {fp.status_of(row)}")
    if decision is None:
        errors.append(f"{args.decision} is not in decisions.tsv")
    elif args.status == "deferred-approved" and not user_approved(decision):
        errors.append(f"deferring a feature needs a user decision: {args.decision} must be status=approved, owner=user, evidence 'user: ...'")
    if errors:
        print(f"BLOCKED close {args.feat}")
        for error in errors:
            print(f"- {error}")
        return 1
    previous = row.get("decision_id", "")
    row.update({
        "status": args.status, "decision_id": args.decision, "current_step": "",
        "exit_gate": f"CLOSED {args.status} by {args.decision} @{_now()}",
        "notes": fp.clean(f"{row.get('notes', '')}; closed by {args.decision} (activated by {previous})" + (f": {args.note}" if args.note else "")).lstrip("; "),
    })
    fp.write_adoption(root, rows)
    write_state_table(root, rows)
    print(f"{args.feat} {args.status} by {args.decision}; list it in report.md External features")
    return 0


def cmd_repin(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    decision = _decision(root, args.decision)
    if row is None or decision is None or not user_approved(decision):
        print(f"BLOCKED repin {args.feat}: needs an existing FEAT row and a user-approved decision (owner=user, evidence 'user: ...')")
        return 1
    if fp.status_of(row) in fp.TERMINAL:
        print(f"BLOCKED repin {args.feat}: it is already {fp.status_of(row)}")
        return 1
    package = features_root / row.get("package_path", "").strip()
    old, new = row.get("package_sha256", ""), fp.package_hash(package)
    row["package_sha256"] = new
    row["notes"] = fp.clean(f"{row.get('notes', '')}; repinned by {args.decision} {old[:12]}->{new[:12]}").lstrip("; ")
    fp.write_adoption(root, rows)
    write_state_table(root, rows)
    print(f"{args.feat} package_sha256 {old[:12]} -> {new[:12]} by {args.decision}")
    return 0


def cmd_progress(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    if row is None or fp.status_of(row) != "in-progress":
        print(f"BLOCKED progress {args.feat}: only an in-progress feature (after feature_gate.py enter) reports steps")
        return 1
    row["current_step"] = args.step
    if args.note:
        row["notes"] = fp.clean(f"{row.get('notes', '')}; {args.note}").lstrip("; ")
    fp.write_adoption(root, rows)
    write_state_table(root, rows)
    print(f"{args.feat} step: {args.step}")
    return 0


def cmd_status(args) -> int:
    root = Path(args.root)
    rows = fp.read_adoption(root)
    if not rows:
        print("no external features activated")
        return 0
    for line in table_lines(rows):
        print(line)
    return 0


# --------------------------------------------------------------------------- STATE.md table

def _last_gate(row: dict[str, str]) -> str:
    for column, label in (("exit_gate", "exit"), ("entry_gate", "enter")):
        value = row.get(column, "").strip()
        if value:
            return value if value.startswith("CLOSED") else f"{label} {value}"
    return f"activated by {row.get('decision_id', '')}"


def table_lines(rows: list[dict[str, str]]) -> list[str]:
    lines = ["| FEAT | feature_id | Phase | Kind | Status | Step | Last gate |", "|---|---|---|---|---|---|---|"]
    for row in rows:
        cells = [row.get("id", ""), row.get("feature_id", ""), row.get("host_phase", "") or "features",
                 row.get("kind", "") or "capability", row.get("status", ""), row.get("current_step", "") or "—", _last_gate(row)]
        lines.append("| " + " | ".join(cell.replace("|", "/") for cell in cells) + " |")
    return lines


def write_state_table(root: Path, rows: list[dict[str, str]]) -> str | None:
    """Rewrite the ``## External features`` section of STATE.md (appended when missing)."""
    state = root / "STATE.md"
    if not state.is_file():
        return "STATE.md missing; External features table not written"
    text = state.read_text(encoding="utf-8")
    body = [STATE_HEADING, "", STATE_INTRO, ""]
    body += table_lines(rows) if rows else ["No external feature activated."]
    block = "\n".join(body) + "\n"
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if line.strip() == STATE_HEADING), None)
    if start is None:
        new = text.rstrip("\n") + "\n\n" + block
    else:
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        tail = "".join(lines[end:])
        new = "".join(lines[:start]) + block + ("\n" + tail if tail else "")
    fd, tmp = tempfile.mkstemp(prefix=".STATE.", suffix=".tmp", dir=str(root))
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
        stream.write(new)
    os.replace(tmp, state)
    return None


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

    candidates = sub.add_parser("candidates", help="list registered features for the user to choose from (contract phase)")
    candidates.add_argument("root")
    candidates.add_argument("--request", default="", help="the user's original migration request, used only for ranking")
    candidates.set_defaults(func=cmd_candidates)

    activate = sub.add_parser("activate", help="write FEAT rows for the features the user selected")
    activate.add_argument("root")
    activate.add_argument("--decision", required=True)
    activate.add_argument("--select", action="append", default=[], metavar="FEATURE_ID")
    activate.set_defaults(func=cmd_activate)

    progress = sub.add_parser("progress", help="report the current step of an in-progress feature")
    progress.add_argument("root")
    progress.add_argument("feat")
    progress.add_argument("--step", required=True)
    progress.add_argument("--note", default="")
    progress.set_defaults(func=cmd_progress)

    close = sub.add_parser("close", help="close a feature without passing it (user decision)")
    close.add_argument("root")
    close.add_argument("feat")
    close.add_argument("--status", required=True, choices=["deferred-approved", "blocked"])
    close.add_argument("--decision", required=True)
    close.add_argument("--note", default="")
    close.set_defaults(func=cmd_close)

    repin = sub.add_parser("repin", help="accept a changed feature package (user decision)")
    repin.add_argument("root")
    repin.add_argument("feat")
    repin.add_argument("--decision", required=True)
    repin.set_defaults(func=cmd_repin)

    status = sub.add_parser("status", help="print the external features of a migration")
    status.add_argument("root")
    status.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

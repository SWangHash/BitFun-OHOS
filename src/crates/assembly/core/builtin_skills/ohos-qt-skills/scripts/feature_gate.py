#!/usr/bin/env python3
"""Entry and exit gates of an external feature (hook).

    python scripts/feature_gate.py enter <root> FEAT-001 [--restart]
    python scripts/feature_gate.py exit  <root> FEAT-001 [--decision DEC-xxx]

``enter`` moves a ``planned`` feature to ``in-progress`` when its host phase
is the open phase, the features named in ``hook.after`` are closed, no other
feature of the same host phase is running (features run one at a time), the
package still matches the hash pinned at activation, and every
``entry.requires`` predicate holds. ``--restart`` re-enters an in-progress
feature after the main flow fixed a defect it found: the source fingerprint
is taken again and the attempt counter is kept.

``exit`` evaluates ``exit.criteria`` plus the implicit criteria of the
feature's kind. READY sets ``passed`` and records an evidence digest that the
host-phase gate re-checks; BLOCKED counts one attempt. After
``exit.max_attempts`` failed attempts only a user decision (``--decision``)
allows another try. Both commands print every unmet condition.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import feature_predicates as fp
from feature_hooks import write_state_table
from gate_state import _now
from phase_gate import read_rows, user_approved


def _summary(unmet: list[str]) -> str:
    first = unmet[0].replace("|", "/")
    return f"{len(unmet)} unmet: {first[:157] + '...' if len(first) > 160 else first}"


def _report(verb: str, feat: str, unmet: list[str]) -> int:
    if unmet:
        print(f"BLOCKED {verb} {feat}")
        for message in unmet:
            print(f"- {message}")
        return 1
    print(f"READY {verb} {feat}")
    return 0


def cmd_enter(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    if row is None:
        return _report("enter", args.feat, [f"{args.feat} is not in feature-adoption.tsv (activate it at the contract phase)"])
    status = fp.status_of(row)
    wanted = "in-progress" if args.restart else "planned"
    if status != wanted:
        hint = " (use --restart to re-enter a running feature)" if status == "in-progress" else ""
        return _report("enter", args.feat, [f"{args.feat} is {status or 'empty'}, expected {wanted}{hint}"])
    try:
        ctx = fp.build_context(root, features_root, row, rows)
    except ValueError as error:
        return _report("enter", args.feat, [f"feature package unreadable: {error}"])
    unmet = []
    phase = row.get("host_phase", "").strip()
    reason = fp.host_phase_open(root, phase)
    if reason:
        unmet.append(reason)
    by_feature = {other.get("feature_id", "").strip(): fp.status_of(other) for other in rows}
    for other in (ctx.hook.get("hook") or {}).get("after", []) or []:
        if other in by_feature and by_feature[other] not in fp.TERMINAL:
            unmet.append(f"hook.after: {other} must be closed first (now {by_feature[other]})")
    if not args.restart:
        running = [other.get("id", "") for other in rows if other is not row
                   and other.get("host_phase", "").strip() == phase and fp.status_of(other) == "in-progress"]
        if running:
            unmet.append(f"{', '.join(running)} is already running in host phase {phase}; features of one phase run one at a time")
    current = fp.package_hash(ctx.package) if ctx.package.is_dir() else "missing"
    if current != row.get("package_sha256", "").strip():
        unmet.append(f"feature package {ctx.package} changed since activation (pinned {row.get('package_sha256', '')[:12]}, "
                     f"now {current[:12]}); ask the user, then feature_hooks.py repin --decision DEC-xxx")
    for item in (ctx.hook.get("entry") or {}).get("requires", []) or []:
        passed, message = fp.evaluate(item, ctx)
        if not passed:
            unmet.append(f"entry: {message}")
    stamp = _now()
    if unmet:
        row["entry_gate"] = f"BLOCKED @{stamp} ({_summary(unmet)})"
    else:
        row["status"] = "in-progress"
        row["entry_gate"] = f"READY @{stamp}" + (" restart" if args.restart else "")
        row["exit_gate"] = "" if not args.restart else row.get("exit_gate", "")
        if row.get("kind") == "verification":
            row["source_fingerprint"] = fp.source_fingerprint(ctx.app_root)
        ctx.workdir.mkdir(parents=True, exist_ok=True)
    fp.write_adoption(root, rows)
    write_state_table(root, rows)
    code = _report("enter", args.feat, unmet)
    if not unmet:
        print(f"Next: follow {ctx.package / ctx.hook.get('playbook', 'feature.md')}; private workdir {ctx.workdir}.")
        skill = fp.skill_dir(ctx.package, ctx.hook)
        if skill is not None:
            print(f"This feature wraps a skill: read {skill / 'SKILL.md'} now and resolve its relative paths against {skill}. "
                  f"The adapter and the migration rules win over the skill's own instructions; the skill writes its "
                  f"state and outputs only under {ctx.workdir}; never edit the skill directory.")
        if row.get("kind") == "verification":
            print("Do not edit application sources in this feature: record failures (VAL-*, record_diagnostic.py with "
                  f"--affected-ids {args.feat}), fix them in the main flow, then run feature_gate.py enter --restart.")
        print(f"Report steps with feature_hooks.py progress {root} {args.feat} --step <milestone>; "
              f"finish with feature_gate.py exit {root} {args.feat}.")
    return code


def cmd_exit(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    if row is None:
        return _report("exit", args.feat, [f"{args.feat} is not in feature-adoption.tsv"])
    if fp.status_of(row) != "in-progress":
        return _report("exit", args.feat, [f"{args.feat} is {fp.status_of(row) or 'empty'}; run feature_gate.py enter first"])
    try:
        ctx = fp.build_context(root, features_root, row, rows)
    except ValueError as error:
        return _report("exit", args.feat, [f"feature package unreadable: {error}"])
    maximum = int((ctx.hook.get("exit") or {}).get("max_attempts", fp.DEFAULT_MAX_ATTEMPTS))
    attempts = fp.attempts_of(row)
    if args.decision:
        decision = next((item for item in read_rows(root / "decisions.tsv") if item.get("id", "").strip() == args.decision), None)
        if decision is None or not user_approved(decision):
            return _report("exit", args.feat, [f"{args.decision} must be a user-approved decision (owner=user, evidence 'user: ...') to allow more attempts"])
        attempts = 0
        row["notes"] = fp.clean(f"{row.get('notes', '')}; attempts reset by {args.decision}").lstrip("; ")
    elif attempts >= maximum:
        return _report("exit", args.feat, [
            f"{args.feat} failed its exit gate {attempts} time(s) (max_attempts={maximum}). Ask the user: retry "
            f"(new decision, feature_gate.py exit --decision DEC-xxx), defer (feature_hooks.py close --status "
            "deferred-approved) or block (feature_hooks.py close --status blocked)"])
    reason = fp.host_phase_open(root, row.get("host_phase", "").strip())
    unmet = [reason] if reason else []
    ctx.attempt = attempts + 1
    for item in (ctx.hook.get("exit") or {}).get("criteria", []) or []:
        passed, message = fp.evaluate(item, ctx)
        if not passed:
            unmet.append(f"exit: {message}")
    for passed, message in fp.implicit_criteria(ctx):
        if not passed:
            unmet.append(f"implicit: {message}")
    stamp = _now()
    if unmet:
        row["attempts"] = str(attempts + 1)
        row["exit_gate"] = f"BLOCKED @{stamp} ({_summary(unmet)})"
    else:
        row["attempts"] = str(attempts + 1)
        row["status"] = "passed"
        row["current_step"] = ""
        row["exit_gate"] = f"READY @{stamp} digest={fp.evidence_digest(ctx)}"
    fp.write_adoption(root, rows)
    write_state_table(root, rows)
    code = _report("exit", args.feat, unmet)
    if unmet:
        print(f"attempt {attempts + 1}/{maximum}")
    else:
        print(f"{args.feat} passed; list it in report.md External features before handoff")
    return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features-root", default=str(fp.default_features_root()), help="features/ directory (default: the skill's)")
    sub = parser.add_subparsers(dest="command", required=True)
    enter = sub.add_parser("enter", help="entry gate")
    enter.add_argument("root")
    enter.add_argument("feat")
    enter.add_argument("--restart", action="store_true", help="re-enter a running feature after a fix in the main flow")
    enter.set_defaults(func=cmd_enter)
    exit_ = sub.add_parser("exit", help="exit gate")
    exit_.add_argument("root")
    exit_.add_argument("feat")
    exit_.add_argument("--decision", help="user decision that allows more attempts after max_attempts")
    exit_.set_defaults(func=cmd_exit)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

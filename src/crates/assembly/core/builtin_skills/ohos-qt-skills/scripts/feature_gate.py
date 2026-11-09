#!/usr/bin/env python3
"""Entry and exit gates of an external feature (hook).

    python scripts/feature_gate.py enter <root> FEAT-001 [--restart]
    python scripts/feature_gate.py exit  <root> FEAT-001 [--answer "<user's words>"]

``enter`` moves a ``planned`` feature to ``in-progress`` when its host phase
is the open phase, the features named in ``hook.after`` are closed, no other
feature of the same host phase is running (features run one at a time), and
every ``entry.requires`` predicate holds. ``--restart`` re-enters an
in-progress feature after the main flow fixed a defect it found; the attempt
counter is kept.

``exit`` evaluates ``exit.criteria`` plus the implicit criteria (no open
diagnostics; a device feature also needs a passed application run in
device-runs.tsv). READY sets ``passed`` and leaves ``exit_gate`` as it was: the
reason of the last failed attempt, empty when the first attempt passed. NOT-READY
counts one attempt and records its reason in ``exit_gate``. After ``exit.max_attempts`` failed attempts the feature
is ``blocked``, waiting for the user: only the user's answer (``--answer``, recorded in the row's notes) allows
another try, or ``feature_hooks.py close`` defers it. Both commands print every unmet condition.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import feature_predicates as fp
from gate_state import _now


def _summary(unmet: list[str]) -> str:
    first = unmet[0].replace("|", "/")
    return f"{len(unmet)} unmet: {first[:157] + '...' if len(first) > 160 else first}"


def _report(verb: str, feat: str, unmet: list[str]) -> int:
    if unmet:
        print(f"NOT-READY {verb} {feat}")
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
        return _report("enter", args.feat, [f"{args.feat} is not in features.tsv (the user selects features at the features phase; then feature_hooks.py activate)"])
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
    phase = fp.host_phase(row)
    reason = fp.host_phase_open(root, phase)
    if reason:
        unmet.append(reason)
    by_feature = {other.get("feature_id", "").strip(): fp.status_of(other) for other in rows}
    for other in (ctx.hook.get("hook") or {}).get("after", []) or []:
        if other in by_feature and by_feature[other] not in fp.TERMINAL:
            unmet.append(f"hook.after: {other} must be closed first (now {by_feature[other]})")
    if not args.restart:
        running = [other.get("id", "") for other in rows if other is not row
                   and fp.host_phase(other) == phase and fp.status_of(other) == "in-progress"]
        if running:
            unmet.append(f"{', '.join(running)} is already running in host phase {phase}; features of one phase run one at a time")
    for item in (ctx.hook.get("entry") or {}).get("requires", []) or []:
        passed, message = fp.evaluate(item, ctx)
        if not passed:
            unmet.append(f"entry: {message}")
    stamp = _now()
    if unmet:
        row["entry_gate"] = f"NOT-READY @{stamp} ({_summary(unmet)})"
    else:
        row["status"] = "in-progress"
        row["entry_gate"] = f"READY @{stamp}" + (" restart" if args.restart else "")
        row["exit_gate"] = "" if not args.restart else row.get("exit_gate", "")
        ctx.workdir.mkdir(parents=True, exist_ok=True)
    fp.write_adoption(root, rows)
    code = _report("enter", args.feat, unmet)
    if not unmet:
        print(f"Next: follow {ctx.package / ctx.hook.get('playbook', 'feature.md')}; private workdir {ctx.workdir}.")
        skill = fp.skill_dir(ctx.package, ctx.hook)
        if skill is not None:
            print(f"This feature wraps a skill: read {skill / 'SKILL.md'} now and resolve its relative paths against {skill}. "
                  f"The adapter and the migration rules win over the skill's own instructions; the skill writes its "
                  f"state and outputs only under {ctx.workdir}; never edit the skill directory.")
        if row.get("kind") == "verification":
            print("Do not edit application sources in this feature: record failures (VAL-*, record_diagnostic.py --id new "
                  f"naming {args.feat}), fix them in the main flow, then run feature_gate.py enter --restart.")
        print(f"Report steps with feature_hooks.py progress {root} {args.feat} --step <milestone>; "
              f"finish with feature_gate.py exit {root} {args.feat}.")
    return code


def cmd_exit(args) -> int:
    root, features_root = Path(args.root), Path(args.features_root)
    rows = fp.read_adoption(root)
    row = fp.find_row(rows, args.feat)
    if row is None:
        return _report("exit", args.feat, [f"{args.feat} is not in features.tsv"])
    status = fp.status_of(row)
    if status == "blocked" and args.answer is None:
        return _report("exit", args.feat, [f"{args.feat} is blocked, waiting for the user: retry (feature_gate.py exit "
                                           "--answer \"<user's words>\") or defer (feature_hooks.py close --answer "
                                           "\"<user's words>\")"])
    if status not in {"in-progress", "blocked"}:
        return _report("exit", args.feat, [f"{args.feat} is {status or 'empty'}; run feature_gate.py enter first"])
    try:
        ctx = fp.build_context(root, features_root, row, rows)
    except ValueError as error:
        return _report("exit", args.feat, [f"feature package unreadable: {error}"])
    maximum = int((ctx.hook.get("exit") or {}).get("max_attempts", fp.DEFAULT_MAX_ATTEMPTS))
    attempts = fp.attempts_of(row)
    if args.answer is not None:
        if not args.answer.strip():
            return _report("exit", args.feat, ["--answer is empty: pass the user's answer (retry)"])
        attempts = 0
        row["status"] = "in-progress"
        row["notes"] = fp.clean(f"{row.get('notes', '')}; attempts reset @{_now()}: user answer: {args.answer}").lstrip("; ")
    reason = fp.host_phase_open(root, fp.host_phase(row))
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
        row["exit_gate"] = f"NOT-READY @{stamp} ({_summary(unmet)})"
        if attempts + 1 >= maximum:
            row["status"] = "blocked"
    else:
        row["attempts"] = str(attempts + 1)
        row["status"] = "passed"
        row["current_step"] = ""
        # exit_gate keeps the reason of the last failed attempt (empty when the first one passed).
    fp.write_adoption(root, rows)
    code = _report("exit", args.feat, unmet)
    if unmet:
        print(f"attempt {attempts + 1}/{maximum}")
        if row["status"] == "blocked":
            print(f"{args.feat} is blocked after {maximum} failed attempts. Ask the user: retry (feature_gate.py exit "
                  "--answer \"<user's words>\") or defer (feature_hooks.py close --answer \"<user's words>\")")
    else:
        print(f"{args.feat} passed; list it in report.md External features before the validation gate")
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
    exit_.add_argument("--answer", help="the user's answer that allows more attempts after max_attempts (recorded in notes)")
    exit_.set_defaults(func=cmd_exit)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Print the one phase to work on now, what it may and may not do, and the next command.

Read-only: it never writes STATE.md or a ledger. The open phase is the first
phase whose Progress row has not been closed by a READY gate (legacy ledgers
without Progress rows fall back to ``Current phase``). Run it right after
initialization, after every gate, after a context compaction, and whenever
the next action is unclear.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from gate_state import _TERMINAL_PROGRESS, _gate_current_phase, _progress_statuses
from phase_gate import PHASES, evaluate

# phase id -> (display name, ledger, work allowed now, work that must wait)
PHASE_GUIDE = {
    "baseline": (
        "Environment preparation", "environment.tsv (+ baseline.tsv host smoke)",
        "probe the Qt distribution, HarmonyOS SDK/API/ABI, native toolchain, hvigor/DevEco CLI, "
        "template tree, signing and device; build or smoke-test the app on its existing host; "
        "write one environment.tsv / baseline.tsv row right after each probe",
        "copying the template, writing build files, editing app sources, HarmonyOS builds"),
    "inventory": (
        "Migration inventory", "inventory.tsv (+ work-queue.tsv, validation.tsv)",
        "scan the app's build files and sources for Qt modules, platform branches, OS APIs and "
        "third-party code; one CAP-* row with a linked VAL-* row per gap; queue rows name the "
        "inventory rows they close in inventory_ids",
        "any edit outside migration/ohos, copying the template, HarmonyOS builds"),
    "contract": (
        "Migration plan contract", "decisions.tsv (+ PORTING_CONTRACT.md, assessment.md)",
        "freeze Qt/SDK/ABI/template, bundle name, deliverables (receipt files, install steps), "
        "dispositions; show feature_hooks.py candidates and record the user's external-feature "
        "selection (default: none), then feature_hooks.py activate; ask the user for any degradation",
        "copying the template, writing build files, editing app sources, HarmonyOS builds"),
    "pilot": (
        "Pilot verification", "pilot.tsv",
        "create the HarmonyOS project from the template inside the output container's <app-name>-ohos "
        "subdirectory (never in the container root) and prove envelope, entry, Qt linkage, "
        "packaging and one risky boundary with batch_checks.py --phase pilot",
        "porting the application sources or building the application target"),
    "implementation": (
        "Capability migration", "work-queue.tsv",
        "build files and guarded source changes per CAP-* row; every build through "
        "batch_checks.py --diagnostics; when a queue row closes, close its inventory_ids rows too",
        "HarmonyOS-specific features"),
    "features": (
        "HarmonyOS capability features", "feature-adoption.tsv (kind capability)",
        "run the activated capability features hooked here, one at a time: feature_gate.py enter, "
        "follow its feature.md, feature_gate.py exit; nothing to do when none was activated",
        "features the user did not select at the contract phase"),
    "diagnostics": (
        "Build and diagnostics", "diagnostics.tsv",
        "application build/package/install/device rounds through batch_checks.py; classify "
        "every failure with record_diagnostic.py before the next attempt",
        "rewriting failed rows as passed"),
    "handoff": (
        "Acceptance and handoff", "validation.tsv (+ report.md)",
        "verify the real application artifact, package and device behavior; run the activated "
        "verification features hooked here (enter, feature.md, exit); write report.md incl. External features",
        "claiming success from pilot artifacts or source diffs; editing sources inside a verification feature"),
}


def open_phase(text: str) -> str:
    lines = text.splitlines(keepends=True)
    statuses = _progress_statuses(lines)
    for phase in PHASES:
        if phase in statuses and statuses[phase] not in _TERMINAL_PROGRESS:
            return phase
    current = _gate_current_phase(lines)
    if current in PHASES:
        return current
    return "handoff" if statuses else PHASES[0]


def hooked_features(root: Path, phase: str) -> list[str]:
    """One line per activated external feature hooked into ``phase``, with its next command."""
    import feature_predicates as fp
    if fp.is_legacy(fp.adoption_fields(root)):
        return []
    lines = []
    for row in fp.read_adoption(root):
        if row.get("host_phase", "").strip() != phase:
            continue
        feat, status = row.get("id", ""), fp.status_of(row)
        if status == "planned":
            todo = f"feature_gate.py enter {root} {feat}"
        elif status == "in-progress":
            last = row.get("exit_gate", "").strip()
            todo = f"follow {row.get('package_path', '')}feature.md, then feature_gate.py exit {root} {feat}"
            if last.startswith("BLOCKED"):
                todo += f" (last exit {last})"
        else:
            todo = "closed"
        step = row.get("current_step", "").strip()
        lines.append(f"- {feat} {row.get('feature_id', '')} [{row.get('kind', '')}] {status}"
                     + (f", step: {step}" if step else "") + f" -> {todo}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("--max-unmet", type=int, default=12)
    args = parser.parse_args()
    root = args.migration_root.resolve()
    state = root / "STATE.md"
    if not state.is_file():
        print(f"BLOCKED: {state} is missing. Run init_migration.py --target <Qt app root> first.")
        return 1
    phase = open_phase(state.read_text(encoding="utf-8", errors="replace"))
    name, ledger, allowed, wait = PHASE_GUIDE[phase]
    errors = evaluate(root, phase)
    validate = Path(__file__).resolve().parent / "validate_ledgers.py"
    print(f"Phase {PHASES.index(phase) + 1}/{len(PHASES)}: {name} (`{phase}`)")
    print(f"Ledger: {ledger}")
    print(f"Do now: {allowed}")
    print(f"Not yet: {wait}")
    hooked = hooked_features(root, phase)
    if hooked:
        print("Hooked features in this phase (run one at a time):")
        print("\n".join(hooked))
    if errors:
        print(f"Gate: BLOCKED, {len(errors)} unmet")
        for error in errors[:args.max_unmet]:
            print(f"- {error}")
        if len(errors) > args.max_unmet:
            print(f"- ... {len(errors) - args.max_unmet} more")
        print(f"Next: fill the rows above, then run `python {validate} {root} --phase {phase}`.")
    else:
        print("Gate: all conditions met")
        print(f"Next: run `python {validate} {root} --phase {phase}` now to record the gate, then run this script again.")
    print("Keep this phase's todo in progress until that command prints READY; do not start the next phase before.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

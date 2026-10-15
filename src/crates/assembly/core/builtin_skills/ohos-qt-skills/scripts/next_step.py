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
        "dispositions and HarmonyOS feature selection; ask the user for any degradation",
        "copying the template, writing build files, editing app sources, HarmonyOS builds"),
    "pilot": (
        "Pilot verification", "pilot.tsv",
        "create the HarmonyOS project from the template and prove envelope, entry, Qt linkage, "
        "packaging and one risky boundary with batch_checks.py --phase pilot",
        "porting the application sources or building the application target"),
    "implementation": (
        "Capability migration", "work-queue.tsv",
        "build files and guarded source changes per CAP-* row; every build through "
        "batch_checks.py --diagnostics; when a queue row closes, close its inventory_ids rows too",
        "HarmonyOS-specific features"),
    "features": (
        "HarmonyOS feature adaptation", "feature-adoption.tsv",
        "contract-approved catalog features only; close the template row as not-applicable "
        "when none was selected",
        "features absent from features/registry.tsv"),
    "diagnostics": (
        "Build and diagnostics", "diagnostics.tsv",
        "application build/package/install/device rounds through batch_checks.py; classify "
        "every failure with record_diagnostic.py before the next attempt",
        "rewriting failed rows as passed"),
    "handoff": (
        "Acceptance and handoff", "validation.tsv (+ report.md)",
        "verify the real application artifact, package and device behavior; write report.md",
        "claiming success from pilot artifacts or source diffs"),
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

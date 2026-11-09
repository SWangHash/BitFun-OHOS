#!/usr/bin/env python3
"""Print the one phase to work on now, what it may and may not do, and the next command.

Read-only: it never writes STATE.md or a ledger. The open phase is the first
phase whose Progress row has not been closed by a READY gate. Run it right after
initialization, after every gate, after a context compaction, and whenever
the next action is unclear.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from gate_state import _TERMINAL_PROGRESS, _progress_statuses
from phase_gate import PHASES, evaluate

# The one description of each phase: what to do now, what must wait, what the
# gate needs. Gate conditions themselves are phase_gate.py; values are vocab.py.
# phase id -> (display name, ledger, do now, must wait)
PHASE_GUIDE = {
    "environment": (
        "Environment", "environment.tsv (+ env-smoke.json)",
        "env_probe.py --migration-root <root> --qt-sdk <bound toolchain> --template <bound template> [--qt-source "
        "<Qt source checkout>] (it writes the whole environment.tsv, one row per environment item; read the rows "
        "that are not ok, fix the environment as their issue says - e.g. install a tool, devecocli auth login, "
        "connect a device - and run env_probe.py again; never edit environment.tsv); env_smoke.py --migration-root "
        "<root> (a failing stage is an environment problem: fix it, rerun env_probe.py, then env_smoke.py; never "
        "patch the table or a plan); a bound toolchain or template this host cannot use (another platform's "
        "binaries, no executable qmake, an incomplete tree) is a question for the user, never a silent download: "
        "ask, record the answer as a decisions.tsv row with owner=user, and only then run an acquisition script "
        "(references/toolchain-template-inputs.md); init_migration.py already recorded the source revision, dirty "
        "paths and the Qt source root in STATE.md; when a desktop Qt is available, a host build of the app is a validation.tsv row whose "
        "scenario starts with 'host regression:' (rerun in the validation phase after shared-source edits); write each question the migration needs into "
        "decisions.tsv without an answer, always bundle name, signing and device (references/decisions.md). Gate: "
        "environment.tsv with the required items and no error/missing item, a passed env-smoke.json and, when "
        "environment.tsv reports a connected device, a passed runtime in it (env_smoke.py --runtime-only after "
        "connecting the device or fixing signing); a problem only the user can fix that stops the whole migration: "
        "ledger.py state --set Assessment=blocked with the reason in Verdict basis and Deciding risk, ask the "
        "user, and set it to ready once fixed: no gate passes before that (any other environment problem is a "
        "failure the agent fixes)",
        "asking the user anything else; copying the template into the project, writing build files, editing app "
        "sources"),
    "inventory": (
        "Inventory", "inventory.tsv (+ tasks.tsv, validation.tsv)",
        "preflight_build_files.py --migration-root <root> (found_by 'preflight: <PF ids>' on the INV row that fixes "
        "them); closure.py --migration-root <root> (closure rows become INV rows, found_by 'closure: <finding>', raw "
        "counts in cause; a DISPATCH line follows references/third-party-parallel-dispatch.md); the source scan with "
        "the fixed brief of references/inventory-scan.md in a background subagent while you write the PF/closure "
        "rows, its findings as INV rows with found_by 'scan: <item>'; "
        "scan_qt_api_gap.py when the app targets a newer Qt than the SDK (one qt-api-gap INV row). TASK rows "
        "(tasks.tsv) name the INV rows they handle in inventory_ids and their VAL rows in validation_ids; a handling the "
        "user must choose is disposition needs-decision plus a question in decisions.tsv. The inventory rows are final "
        "at this gate. Gate: real INV/VAL/TASK rows, every inventory row named by a TASK row, every TASK row with "
        "validation_ids, the PF error ids cited",
        "asking the user; any edit outside migration/ohos, copying the template, HarmonyOS builds"),
    "decisions": (
        "Decisions", "decisions.tsv (+ STATE.md Scope)",
        "ask every unanswered question once and write the answers into decisions.tsv (references/decisions.md); "
        "set Assessment, Verdict basis and Deciding risk (ledger.py state; the tasks phase needs ready); fill the "
        "STATE.md Scope (ledger.py state --scope/--evidence: Application target = the TARGET name of the "
        "authoritative build file, its evidence that build file; HarmonyOS output project = a "
        "subdirectory of the output container that holds migration/: the project directory the BitFun bound-inputs "
        "instruction names, otherwise <container>/<Application target>-ohos); "
        "record every user deliverable and the OHOS acceptance scenarios as VAL rows. Gate: Scope without TODO, "
        "Assessment ready, the output layout recorded, at least one open TASK row to implement",
        "copying the template, writing build files, editing app sources, HarmonyOS builds; HarmonyOS external "
        "features (phase 6)"),
    "tasks": (
        "Tasks", "tasks.tsv",
        "first batch: template_patch.py --project <HarmonyOS output project of the STATE.md Scope> --envelope --bundle-name <answer in decisions.tsv>, the preflight "
        "build-file fixes, the app configured with its own build system for OHOS (qmake -spec ohos-clang or the "
        "OHOS CMake toolchain) and preflight_build_files.py --configured <build dir> --app-library lib<Application target>.so "
        "(gate: a clean preflight-configured.json); then build before reading: each vendored library as its own "
        "target (one INV row each), then a keep-going build of the application, and let its errors choose what to "
        "read; the smallest guarded change per TASK row (SKILL.md hard rules: guards, `cond {` on one line), "
        "each TASK row closed with ledger.py update (status and evidence in one call), and each VAL row it checked "
        "updated with its own status and evidence. Every build through batch_checks.py --tasks <TASK> "
        "(references/build-diagnostics.md). A TASK row that cannot be done without the user is blocked and the "
        "user is asked; the answer makes it accepted-limitation (citing the DEC id) or in-progress. Gate: every "
        "TASK row closed with evidence (none blocked) and the output project a DevEco project root",
        "HarmonyOS-specific features (phase 6)"),
    "diagnostics": (
        "Diagnostics", "diagnostics.tsv",
        "application rounds through batch_checks.py: build, deploy_qt_libs.py, devecocli_build.py, "
        "hap_check.py, device_run.py sign (once), device_run.py run --migration-root <root> --record; the "
        "hap_check.py step writes the HAP's one device-runs.tsv row (checked / no-device / hap-failed), a passed "
        "device run sets it to run; a failure "
        "is an open problem row: verify a known-issue cause and fix, otherwise write the cause with "
        "record_diagnostic.py before the next batch, retry with --diag <DIAG>; after three failed fixes of one "
        "problem set it blocked and ask; the answer sets it open again (a new fix) or accepted-limitation (the "
        "user accepts it unfixed) (references/build-diagnostics.md). Gate: no open or blocked problem and "
        "device-runs.tsv status run (no-device when environment.tsv had no connected device)",
        "closing a problem without its cause and fix; HarmonyOS-specific features (next phase)"),
    "features": (
        "Features", "features.tsv",
        "feature_hooks.py candidates, ask the user which registered features to enable (default: none) and wait "
        "for the answer (the phase is blocked until then), feature_hooks.py activate --answer \"<user's words>\" "
        "[--select <id>] also when nothing is selected (the answer goes into STATE.md Feature selection and the FEAT "
        "row's notes, never into decisions.tsv; a feature writes no inventory, tasks or validation rows); run "
        "each activated capability feature one at a time: feature_gate.py enter, its feature.md, rebuild/package/"
        "device rounds through batch_checks.py, feature_gate.py exit; a feature blocked after max_attempts waits "
        "for the user: retry (exit --answer) or defer (feature_hooks.py close) (references/external-features.md)",
        "features the user did not select; selecting a feature on the user's behalf; running verification "
        "features (validation)"),
    "validation": (
        "Validation", "validation.tsv (+ report.md)",
        "verify the real application artifact (hap_check.py: ABI, HAP contents, entry identity) and device "
        "behavior; rerun host regression after shared-source changes; audit unknowns, limitations and TODOs; run "
        "the activated verification features (enter, feature.md, exit; a defect goes back to the main flow, then "
        "feature_gate.py enter --restart); set Completion tier to the strongest tier proven (ledger.py state); "
        "write report.md incl. External features and Decisions made on the user's behalf. Gate also needs the HAP "
        "of device-runs.tsv (status run or no-device) still present",
        "claiming success from smoke-test artifacts, source diffs or a verifier summary; editing sources inside a "
        "verification feature"),
}

LEDGER_HINT = ("ledgers and STATE.md: only through ledger.py (get/list/add/update/state, "
               "columns <ledger.tsv> for the columns and their values) and the scripts that own them")


def open_phase(text: str) -> str:
    lines = text.splitlines(keepends=True)
    statuses = _progress_statuses(lines)
    for phase in PHASES:
        if statuses.get(phase, "") not in _TERMINAL_PROGRESS:
            return phase
    return PHASES[-1]


def pending_decisions(root: Path) -> list[str]:
    from phase_gate import read_rows

    return [f"- {row.get('id')}: {row.get('question', '')[:120]}"
            for row in read_rows(root / "decisions.tsv") if not row.get("answer", "").strip()]


def hooked_features(root: Path, phase: str) -> list[str]:
    """One line per activated external feature hooked into ``phase``, with its next command."""
    import feature_predicates as fp
    lines = []
    for row in fp.read_adoption(root):
        if fp.host_phase(row) != phase:
            continue
        feat, status = row.get("id", ""), fp.status_of(row)
        if status == "planned":
            todo = f"feature_gate.py enter {root} {feat}"
        elif status == "in-progress":
            last = row.get("exit_gate", "").strip()
            todo = f"follow features/{row.get('feature_id', '')}/feature.md, then feature_gate.py exit {root} {feat}"
            if last.startswith("NOT-READY"):
                todo += f" (last exit {last})"
        else:
            todo = "closed"
        step = row.get("current_step", "").strip()
        lines.append(f"- {feat} {row.get('feature_id', '')} [{row.get('kind', '')}] {status}"
                     + (f", step: {step}" if step else "") + f" -> {todo}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("--max-unmet", type=int, default=12)
    parser.add_argument("--schema", action="store_true", help="also print the batch plan schema")
    args = parser.parse_args()
    root = args.migration_root.resolve()
    state = root / "STATE.md"
    if not state.is_file():
        print(f"ERROR: {state} is missing. Run init_migration.py --target <Qt app root> first.")
        return 1
    phase = open_phase(state.read_text(encoding="utf-8", errors="replace"))
    name, ledger, allowed, wait = PHASE_GUIDE[phase]
    errors = evaluate(root, phase)
    validate = Path(__file__).resolve().parent / "validate_ledgers.py"
    print(f"Phase {PHASES.index(phase) + 1}/{len(PHASES)}: {name} (`{phase}`)")
    print(f"Ledger: {ledger}")
    print(f"Do now: {allowed}")
    print(f"Not yet: {wait}")
    pending = pending_decisions(root)
    if pending:
        print("Unanswered questions (asked together in the decisions phase, references/decisions.md):")
        print("\n".join(pending))
    hooked = hooked_features(root, phase)
    if hooked:
        print("Hooked features in this phase (run one at a time):")
        print("\n".join(hooked))
    if errors:
        print(f"Gate: NOT-READY, {len(errors)} unmet")
        for error in errors[:args.max_unmet]:
            print(f"- {error}")
        if len(errors) > args.max_unmet:
            print(f"- ... {len(errors) - args.max_unmet} more")
        print(f"Next: fill the rows above, then run `python {validate} {root} --phase {phase}`.")
    else:
        print("Gate: all conditions met")
        print(f"Next: run `python {validate} {root} --phase {phase}` now to record the gate, then run this script again.")
    print("Keep this phase's todo in progress until that command prints READY; do not start the next phase before.")
    print(LEDGER_HINT)
    if args.schema:
        from batch_checks import PLAN_SCHEMA

        print(PLAN_SCHEMA)
    else:
        print("Batch plan schema: next_step.py --schema; script usage: <script> --help; never read script sources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

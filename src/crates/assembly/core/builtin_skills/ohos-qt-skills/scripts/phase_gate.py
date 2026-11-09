#!/usr/bin/env python3
"""Exit conditions of every phase, evaluated from the ledgers (no conversation evidence).

    python <skill>/scripts/phase_gate.py <container>/migration/ohos <phase> [--no-record]

validate_ledgers.py --phase runs the same rules together with the structural
checks; next_step.py prints the unmet conditions of the open phase.
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from gate_state import feature_selection
from ohos_env import ENV_PROFILE, ENV_SMOKE, load_profile
from vocab import (ASSESSMENTS, DEVICE_RUN_DONE, ENV_BLOCKING_STATUSES, ENV_REQUIRED_ITEMS, PHASES,
                   PLACEHOLDERS, QUEUE_CLOSE_STATUSES, QUEUE_DONE, QUEUE_OPEN, VALIDATION_DONE)

ASSESSMENT_RE = re.compile(r"^\s*-\s*Assessment:\s*`?([A-Za-z-]+)`?", re.MULTILINE)
# The ledger lives in the output container (`<container>/migration/ohos`, init_migration.py
# --output-project); the HarmonyOS project is another subdirectory of that container,
# recorded in the decisions phase. The Qt sources are recorded, not derived.
SCOPE_SOURCE = "Qt source root"
SCOPE_PROJECT = "HarmonyOS output project"
OHOS_PROJECT_MARKERS = (
    "AppScope/app.json5",
    "hvigorfile.ts",
    "build-profile.json5",
    "oh-package.json5",
)


def read_rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    # Short rows yield None values and long rows a None key. validate_ledgers.py
    # reports the column mismatch; the gate must still evaluate without crashing.
    return [{key: value or "" for key, value in row.items() if key is not None} for row in rows]


def non_placeholder(value: str) -> bool:
    return value.strip().lower() not in PLACEHOLDERS


def no_device(root: Path) -> bool:
    """environment.tsv reports no connected device (env_probe.py writes the ``device`` item)."""
    profile = load_profile(root)
    return bool(profile) and profile["items"].get("device", {}).get("status", "") != "ok"


def scope_value(state: str, field: str) -> str:
    """The recorded value of a STATE.md Scope field; empty when the row is missing, empty or TODO."""
    values = {name.strip().lower(): value.strip().strip("`") for name, value, _ in scope_rows(state)}
    value = values.get(field.lower(), "")
    return value if non_placeholder(value) and "TODO" not in value else ""


def has_ohos_project_markers(path: Path) -> bool:
    """A HarmonyOS (hvigor) project directory: the template's own top-level files."""
    return any((path / marker).is_file() for marker in OHOS_PROJECT_MARKERS)


def layout_errors(root: Path, state: str, phase: str) -> list[str]:
    """The output layout: the HarmonyOS project is a subdirectory of the output container.

    The container is the directory holding the ledger (`<container>/migration/ohos`).
    From decisions on the project must be recorded, from tasks on (template_patch.py
    creates it) it must exist as a DevEco project root.
    """
    if PHASES.index(phase) < PHASES.index("decisions"):
        return []
    container = Path(root).resolve().parent.parent
    project_raw = scope_value(state, SCOPE_PROJECT)
    if not project_raw:
        return [f"STATE.md Scope does not record the {SCOPE_PROJECT}: ledger.py state <root> --scope "
                f'"{SCOPE_PROJECT}=<subdirectory of the output container {container}>"']
    project = Path(project_raw)
    errors: list[str] = []
    if project.resolve().parent != container:
        errors.append(f"output layout: the {SCOPE_PROJECT} {project} must be a subdirectory of the output "
                      f"container {container} (the directory that holds migration/)")
    if PHASES.index(phase) >= PHASES.index("tasks"):
        if not project.is_dir():
            errors.append(
                f"output layout: {project} does not exist; create the HarmonyOS project there "
                f"(template_patch.py --project {project})")
        elif not has_ohos_project_markers(project):
            errors.append(
                f"output layout: {project} is not a DevEco project root (missing all of "
                + ", ".join(OHOS_PROJECT_MARKERS) + ")")
    return errors


def report(phase: str, errors: list[str]) -> int:
    if errors:
        print(f"NOT-READY phase={phase}")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"READY phase={phase}")
    return 0


def hook_errors(root: Path, phase: str, validation: list[dict[str, str]], features_root: Path | None = None) -> list[str]:
    """External features (hooks) that ``phase`` depends on.

    From the features phase on: when features are registered, the user answered
    the selection (STATE.md ``Feature selection``, written by ``feature_hooks.py``);
    for every feature whose host phase is not later than ``phase``: it is closed
    (passed or deferred-approved; a blocked feature waits for the user). The
    user's selection is what ``feature_hooks.py activate`` wrote (one FEAT row per
    selected feature, the answer in its notes). Validation also needs every FEAT
    id in report.md's External features section.
    """
    import feature_predicates as fp  # lazy: feature_predicates imports this module

    features_root = features_root or fp.default_features_root()
    rows = read_rows(root / fp.ADOPTION)
    errors: list[str] = []
    gated = PHASES.index(phase)
    # Activation and every hook belong to the features phase or later; earlier
    # gates never ask about external features.
    if gated < PHASES.index("features"):
        return errors
    registry = fp.read_registry(features_root)
    state = root / "STATE.md"
    selection = feature_selection(state.read_text(encoding="utf-8", errors="replace")) if state.is_file() else ""
    if selection != "answered" and registry:
        errors.append("the user has not answered which external features to enable"
                      + (" (asked, waiting for the answer)" if selection == "pending" else "")
                      + ": feature_hooks.py candidates, ask the user, then feature_hooks.py activate --answer "
                        "\"<user's words>\" [--select <id> ...]")
    for row in rows:
        row_id, feature_id = row.get("id", "").strip(), row.get("feature_id", "").strip()
        status = fp.status_of(row)
        if feature_id not in registry:
            errors.append(f"{row_id} ({feature_id}) is not registered in features/registry.tsv")
        host = fp.host_phase(row)
        if host not in PHASES:
            errors.append(f"{row_id} has unknown kind '{row.get('kind', '')}'")
            continue
        if status not in fp.STATUSES:
            errors.append(f"{row_id} has unknown status '{row.get('status', '')}'")
            continue
        if PHASES.index(host) > gated:
            continue
        if status == "blocked":
            errors.append(f"{row_id} ({feature_id}) is blocked, waiting for the user: retry (feature_gate.py exit "
                          "--answer \"<user's words>\") or defer (feature_hooks.py close --answer \"<user's words>\")")
        elif status not in fp.TERMINAL:
            errors.append(
                f"{row_id} ({feature_id}) hooks into {host} and is still {status}; "
                + ("run feature_gate.py enter" if status == "planned" else "finish it and run feature_gate.py exit")
                + ", or ask the user to defer it (feature_hooks.py close)"
            )
    if phase == "validation" and rows:
        report_path = root / "report.md"
        text = report_path.read_text(encoding="utf-8", errors="replace") if report_path.is_file() else ""
        section = re.search(r"^##\s+External features\s*$(.*?)(?=^##\s|\Z)", text, re.MULTILINE | re.DOTALL)
        body = section.group(1) if section else ""
        for row in rows:
            row_id = row.get("id", "").strip()
            if not any(row_id in line and fp.status_of(row) in line.lower() for line in body.splitlines()):
                errors.append(f"report.md External features does not list {row_id} with its final status {fp.status_of(row)}")
    return errors


def split_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip() and item.strip().lower() != "none"]


def parse_found_by(value: str) -> list[tuple[str, list[str]]]:
    """``"preflight: PF-A, PF-B; scan: processes"`` -> ``[("preflight", ["PF-A", "PF-B"]), ("scan", ["processes"])]``."""
    entries = []
    for part in value.split(";"):
        source, _, detail = part.partition(":")
        if source.strip() or detail.strip():
            entries.append((source.strip().lower(), [item.strip() for item in detail.split(",") if item.strip()]))
    return entries


def cited_findings(inventory: list[dict[str, str]], source: str) -> set[str]:
    return {item for row in inventory for name, details in parse_found_by(row.get("found_by", "")) if name == source
            for item in details}


def inventory_link_errors(inventory: list[dict[str, str]], queue: list[dict[str, str]]) -> list[str]:
    """Every inventory row is named by a TASK row: the TASK closes it, its VAL rows prove it,
    so even a no-change row needs one."""
    named = {value for row in queue for value in split_ids(row.get("inventory_ids", ""))}
    return [
        f"{row.get('id', '').strip()} is not named by any TASK row; list it in a TASK row's inventory_ids "
        "(a verification-only row with its VAL rows is the proof for keep/no-change capabilities)"
        for row in inventory if row.get("id", "").strip() not in named
    ]


def scope_rows(state: str) -> list[tuple[str, str, str]]:
    """``(field, value, evidence)`` of the STATE.md Scope table (application target, output layout, ...)."""
    section = re.search(r"^##\s+Scope.*?$(.*?)(?=^##\s|\Z)", state, re.MULTILINE | re.DOTALL)
    rows = []
    for line in (section.group(1) if section else "").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 3 and cells[0] not in {"Field", ""} and not set(cells[0]) <= {"-", ":"}:
            rows.append((cells[0], cells[1], cells[2]))
    return rows


def read_json(path: Path) -> dict | None:
    import json

    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def evaluate(root: Path, phase: str, features_root: Path | None = None) -> list[str]:
    """Return the unmet gate conditions for ``phase``; empty means READY."""
    errors: list[str] = []

    inventory = read_rows(root / "inventory.tsv")
    queue = read_rows(root / "tasks.tsv")
    validation = read_rows(root / "validation.tsv")
    diagnostics = read_rows(root / "diagnostics.tsv")
    device = read_rows(root / "device-runs.tsv")
    hap = device[-1] if device else {}
    state = (root / "STATE.md").read_text(encoding="utf-8", errors="replace") if (root / "STATE.md").is_file() else ""

    # Gates are cumulative: every later phase re-checks the earlier exit
    # conditions, so a READY gate also proves the phases before it.
    if phase in PHASES:
        # No gate passes while the migration waits for the user; a stale verdict is set back here.
        match = ASSESSMENT_RE.search(state)
        assessment = match.group(1).lower() if match else ""
        if assessment in {"blocked", "not-recommended"}:
            errors.append(f"STATE.md Assessment is '{assessment}', waiting for the user: once solved, ledger.py state "
                          '<root> --set "Assessment=ready" --set "Next executable action=..."')
        profile = load_profile(root)
        if profile is None:
            errors.append(f"{ENV_PROFILE} has no rows: run env_probe.py --migration-root <root> (it writes the "
                          "environment table every later command runs with)")
        else:
            items = profile["items"]
            absent = [item for item in ENV_REQUIRED_ITEMS if item not in items]
            if absent:
                errors.append(f"{ENV_PROFILE} lacks the required items {', '.join(absent)}: rerun env_probe.py")
            blocking = [f"{item} {row.get('status')}: {row.get('issue') or 'no detail'}"
                        for item, row in items.items() if row.get("status") in ENV_BLOCKING_STATUSES]
            if blocking:
                errors.append(f"{ENV_PROFILE} has broken or missing items (fix them as the issue says, rerun "
                              "env_probe.py; never edit the table): " + "; ".join(blocking)[:500])
        smoke = read_json(root / ENV_SMOKE)
        if smoke is None:
            errors.append(f"{ENV_SMOKE} is missing: run env_smoke.py --migration-root <root> "
                          "(the hello app through the application's whole pipeline, cached per machine)")
        elif smoke.get("status") != "passed":
            errors.append(f"{ENV_SMOKE} reports {smoke.get('status') or 'no status'}: {str(smoke.get('summary', ''))[:200]}; "
                          "fix the environment with env_probe.py and rerun env_smoke.py --migration-root <root>")
        elif (smoke.get("runtime") or {}).get("status") != "passed" and not no_device(root):
            # With a connected device the hello app must also have been installed and launched.
            errors.append(
                f"environment.tsv reports a connected device but {ENV_SMOKE} has no passed runtime "
                f"({(smoke.get('runtime') or {}).get('reason') or 'not run on the device'}): make signing work "
                "(devecocli auth login) and run env_smoke.py --migration-root <root> --runtime-only")
        errors.extend(layout_errors(root, state, phase))

    if phase in {"inventory", "decisions", "tasks", "diagnostics", "features", "validation"}:
        if not inventory:
            errors.append("inventory.tsv has no INV rows")
        if not queue:
            errors.append("tasks.tsv has no TASK rows")
        if not validation:
            errors.append("validation.tsv has no VAL rows")
        errors.extend(inventory_link_errors(inventory, queue))
        for row in queue:
            if not row.get("validation_ids", "").strip():
                errors.append(f"{row.get('id')} has no validation_ids")
        preflight = read_json(root / "preflight.json")
        if preflight is None:
            errors.append("preflight.json is missing: run preflight_build_files.py --migration-root <root> "
                          "(static build-file checks before the first OHOS build)")
        else:
            cited = cited_findings(inventory, "preflight")
            unlisted = [f.get("id", "") for f in preflight.get("findings", [])
                        if f.get("severity") == "error" and not f.get("waived") and f.get("id", "") not in cited]
            if unlisted:
                errors.append("preflight error findings are not named by any inventory.tsv row: " + ", ".join(unlisted)
                              + " (found_by 'preflight: <PF ids>' of the INV row that fixes it; a checked false "
                              "positive: preflight_build_files.py --waive <id>=\"<reason>\")")

    if phase in {"decisions", "tasks", "diagnostics", "features", "validation"}:
        unset = [field for field, value, evidence in scope_rows(state) if "TODO" in value + evidence]
        if unset:
            errors.append("STATE.md Scope still has TODO in: " + ", ".join(unset)
                          + ' (ledger.py state <root> --scope "<field>=<value>" --evidence "<field>=<evidence>")')
        # From this phase on only a recorded ready passes (blocked and not-recommended are reported above).
        if assessment not in ASSESSMENTS:
            errors.append(f"STATE.md Assessment is '{assessment or 'missing'}'; phase {phase} requires ready")
        # Leaving the decisions phase needs open TASK rows to implement. From
        # the tasks phase on, a fully closed tasks.tsv is the goal, not a defect
        # (the validation gate separately rejects rows that are still open).
        queue_closed = bool(queue) and all(row.get("status", "") in QUEUE_DONE for row in queue)
        if phase == "decisions" and not queue_closed and not any(
            row.get("status", "") in QUEUE_OPEN
            and non_placeholder(row.get("task", ""))
            for row in queue
        ):
            errors.append("tasks.tsv has no open TASK row to implement")

    if phase in {"tasks", "diagnostics", "features", "validation"}:
        configured = read_json(root / "preflight-configured.json")
        if configured is None:
            errors.append("preflight-configured.json is missing: the first step of the tasks phase configures the app with "
                          "its own build system for OHOS (qmake -spec ohos-clang / the OHOS CMake toolchain) and runs "
                          "preflight_build_files.py --configured <build dir> --app-library <APP_LIBRARY_NAME>")
        elif any(f.get("severity") == "error" and not f.get("waived") for f in configured.get("findings", [])):
            errors.append("preflight-configured.json has error findings: "
                          + ", ".join(f.get("id", "") + " " + f.get("message", "")[:80]
                                      for f in configured["findings"] if f.get("severity") == "error" and not f.get("waived"))[:400])

    if phase in {"tasks", "diagnostics", "features", "validation"}:
        # The tasks phase ends when every TASK row is closed; a blocked row waits for the user. Every
        # inventory row is named by a TASK row (inventory gate), so this also settles every inventory row.
        waiting = [row.get("id", "") for row in queue if row.get("status", "").strip() == "blocked"]
        if waiting:
            errors.append("tasks.tsv rows are blocked, waiting for the user: " + ", ".join(waiting)
                          + " (with the answer: status accepted-limitation citing the DEC id, or in-progress)")
        open_rows = [row.get("id", "") for row in queue
                     if row.get("status", "").strip() not in QUEUE_CLOSE_STATUSES and row.get("status", "").strip() != "blocked"]
        if open_rows:
            errors.append("tasks.tsv rows are still open: " + ", ".join(open_rows)
                          + ' (ledger.py update <root> tasks.tsv <TASK> --set status=<' + "|".join(QUEUE_CLOSE_STATUSES)
                          + '> --set "evidence=...")')

    if phase in {"diagnostics", "features", "validation"}:
        # Every problem met is closed: fixed with its cause and fix, or accepted-limitation with its cause
        # and the user's answer in fix. A blocked problem waits for the user.
        for row in diagnostics:
            row_id, status = row.get("id", ""), row.get("status", "").strip()
            if status == "open":
                errors.append(f"{row_id} is still open: fix it and record the fix (record_diagnostic.py --id {row_id} "
                              "--fix ... --status fixed); after three failed fixes set it blocked and ask the user")
            elif status == "fixed" and not (row.get("cause", "").strip() and row.get("fix", "").strip()):
                errors.append(f"{row_id} is fixed but does not record its cause and fix: "
                              f"record_diagnostic.py --id {row_id} --cause ... --fix ...")
            elif status == "accepted-limitation" and not (row.get("cause", "").strip() and row.get("fix", "").strip()):
                errors.append(f"{row_id} is accepted-limitation but does not record its cause and the user's answer: "
                              f"record_diagnostic.py --id {row_id} --cause ... --fix \"user accepted: ...\"")
            elif status == "blocked":
                errors.append(f"{row_id} is blocked, waiting for the user: with the answer set it open (a new fix to "
                              f"try) or accepted-limitation (record_diagnostic.py --id {row_id} --fix \"user accepted: "
                              "...\" --status accepted-limitation)")
        # The base migration is done when the application HAP passed hap_check.py and ran on the device
        # (no-device: environment.tsv had no connected device). device-runs.tsv holds that one row.
        status = hap.get("status", "").strip()
        if status not in DEVICE_RUN_DONE:
            errors.append({
                "": "device-runs.tsv has no application HAP: package it in a batch with a hap_check.py step "
                    "(batch_checks.py), then device_run.py run --project <ohos project> "
                    "--migration-root <root> --record as a later step",
                "hap-failed": "the application HAP failed hap_check.py (device-runs.tsv hap-failed): fix the "
                              "diagnostics problem and rerun the packaging batch; if it stays blocked, ask the user",
                "checked": "the application HAP passed hap_check.py but has not run on the device: run device_run.py "
                           "run --project <ohos project> --migration-root <root> --record (as a batch step)",
            }.get(status, f"device-runs.tsv has unknown status '{status}'"))

    # External features: the capability features from the features phase on
    # (after the base migration passed diagnostics), verification features in validation.
    errors.extend(hook_errors(root, phase, validation, features_root))

    if phase == "validation":
        unverified = [row.get("id", "") for row in validation if row.get("status", "") not in VALIDATION_DONE]
        if unverified:
            errors.append("validation rows remain unverified: " + ", ".join(unverified))
        # The deliverable is the HAP of device-runs.tsv; it must still be where hvigor wrote it.
        path = hap.get("hap", "").rsplit(" (", 1)[0].strip()
        if hap.get("status", "").strip() in DEVICE_RUN_DONE and not Path(path).is_file():
            errors.append(f"the application HAP {path} of device-runs.tsv is gone: rerun the packaging batch")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("phase", choices=PHASES)
    parser.add_argument("--features-root", type=Path, help="features/ directory (default: the skill's)")
    parser.add_argument("--no-record", action="store_true",
                        help="do not write the verdict into STATE.md (Gate / Progress)")
    args = parser.parse_args()
    root = args.migration_root.resolve()
    errors = evaluate(root, args.phase, args.features_root)
    code = report(args.phase, errors)
    if not args.no_record:
        from gate_state import record_gate
        warning = record_gate(root, args.phase, errors, "phase_gate.py")
        if warning:
            print(f"WARNING {warning}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())

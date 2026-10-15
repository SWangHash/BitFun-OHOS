#!/usr/bin/env python3
"""Append or update one root-cause diagnostic row in diagnostics.tsv or pilot.tsv.

diagnostics.tsv is the problem log of the migration, not only a list of build
receipts. Every problem met on the way (a failed configure/build/package/
install/launch step, a broken toolchain or SDK file, a wrong deployment path)
keeps its own row: what failed, why, and what fixed it. A later success never
replaces that row; it moves it to ``resolved``.

Record a problem that did not go through batch_checks.py with ``--id new``::

    record_diagnostic.py <diagnostics.tsv> --id new --phase build \
        --category toolchain --signature "<first error line>" \
        --root-cause "<why it failed>" --next-action "<fix applied>" \
        --status resolved --affected-ids CAP-003

Pilot attempts live in pilot.tsv (same columns, ``PILOT-*`` ids). A ``--phase
pilot`` row or a ``PILOT-*`` id given with diagnostics.tsv is written to the
sibling pilot.tsv.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path


FIELDS = [
    "id",
    "build_or_device_run_id",
    "phase",
    "category",
    "first_causal_signature",
    "root_cause",
    "attempts",
    "command",
    "tree_or_environment_hash",
    "log_path",
    "fix_or_next_action",
    "affected_ids",
    "evidence",
    "status",
    "recurrence",
]
# passed: the attempt succeeded; resolved: the root cause was fixed and verified
# by a later attempt. phase_gate.py accepts only these two for a pilot receipt.
DIAGNOSTIC_STATUSES = ("planned", "in-progress", "failed", "timeout", "blocked", "resolved", "passed", "not-applicable")
# Rows in these states describe a problem; they may become `resolved`, never `passed`.
FAILURE_STATUSES = {"failed", "timeout", "blocked"}
# What batch_checks.py writes into fix_or_next_action until the agent classifies the failure.
CLASSIFY_HINT = "classify with record_diagnostic.py"
UNSET = {"", "todo", "tbd", "n/a", "none", "unknown", "unclassified"}


def is_classified(row: dict[str, str]) -> bool:
    """True when the row names a category, a root cause and a real fix or next action."""
    fix = row.get("fix_or_next_action", "").strip().lower()
    return (
        row.get("category", "").strip().lower() not in UNSET
        and row.get("root_cause", "").strip().lower() not in UNSET
        and fix not in UNSET
        and not fix.startswith(CLASSIFY_HINT)
    )


def read_diagnostics(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def write_diagnostics(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows({field: row.get(field) or "" for field in FIELDS} for row in rows)


PILOT_LEDGER = "pilot.tsv"


def id_prefix(path: Path) -> str:
    """``PILOT-`` for pilot.tsv, ``DIAG-`` for diagnostics.tsv."""
    return "PILOT-" if path.name == PILOT_LEDGER else "DIAG-"


def route_ledger(path: Path, phase: str | None = None, row_id: str | None = None) -> Path:
    """Send pilot rows to pilot.tsv next to the given diagnostics ledger."""
    if path.name == PILOT_LEDGER:
        return path
    if (phase or "").strip().lower() == "pilot" or (row_id or "").startswith("PILOT-"):
        return path.with_name(PILOT_LEDGER)
    return path


def next_diagnostic_id(rows: list[dict[str, str]], prefix: str = "DIAG-") -> str:
    numbers = [
        int(row["id"][len(prefix):]) for row in rows
        if row.get("id", "").startswith(prefix) and row["id"][len(prefix):].isdigit()
    ]
    return f"{prefix}{max(numbers, default=0) + 1:03d}"


def upsert_diagnostic(path: Path, record: dict[str, str]) -> bool:
    """Replace the row with the same id or append it; return True when replaced."""
    path = path.resolve()
    rows = read_diagnostics(path)
    replaced = False
    for index, row in enumerate(rows):
        if row.get("id") == record["id"]:
            rows[index] = record
            replaced = True
            break
    if not replaced:
        rows.append(record)
    write_diagnostics(path, rows)
    return replaced


# CLI option -> ledger field. On update, omitted options keep the stored value,
# so classifying a batch_checks.py receipt needs only the changed fields.
OPTIONS = {
    "build_or_device_run_id": "build_or_device_run_id",
    "phase": "phase",
    "category": "category",
    "signature": "first_causal_signature",
    "root_cause": "root_cause",
    "attempts": "attempts",
    "command": "command",
    "tree_or_environment_hash": "tree_or_environment_hash",
    "log_path": "log_path",
    "next_action": "fix_or_next_action",
    "affected_ids": "affected_ids",
    "evidence": "evidence",
    "status": "status",
    "recurrence": "recurrence",
}
# A new row must say what failed, why, and what was or will be done about it.
REQUIRED_FOR_NEW = ("phase", "category", "signature", "root_cause", "next_action", "status")
# Everything else has a default so a problem solved outside a batch is cheap to record.
NEW_ROW_DEFAULTS = {
    "build_or_device_run_id": "manual",
    "attempts": "1",
    "command": "not-recorded",
    "tree_or_environment_hash": "not-computed",
    "log_path": "none",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("diagnostics", type=Path)
    parser.add_argument("--id", required=True, help="DIAG-*/PILOT-* id to update, or 'new' to append with the next free id")
    for option in OPTIONS:
        flag = "--" + option.replace("_", "-")
        if option == "attempts":
            parser.add_argument(flag, type=int)
        elif option == "status":
            parser.add_argument(flag, choices=DIAGNOSTIC_STATUSES)
        else:
            parser.add_argument(flag)
    args = parser.parse_args()
    args.diagnostics = route_ledger(args.diagnostics, args.phase, args.id)
    prefix = id_prefix(args.diagnostics)
    if args.diagnostics.name == PILOT_LEDGER:
        args.phase = "pilot"
    rows = read_diagnostics(args.diagnostics.resolve())
    if args.id.lower() == "new":
        args.id = next_diagnostic_id(rows, prefix)
    if not args.id.startswith(prefix):
        raise SystemExit(f"--id must start with {prefix} for {args.diagnostics.name} (or be 'new')")
    if args.attempts is not None and args.attempts < 0:
        raise SystemExit("--attempts must be non-negative")

    existing = next((row for row in rows if row.get("id") == args.id), None)
    given = {field: getattr(args, option) for option, field in OPTIONS.items() if getattr(args, option) is not None}
    if existing is None:
        missing = ["--" + option.replace("_", "-") for option in REQUIRED_FOR_NEW if OPTIONS[option] not in given]
        if given.get("status") in FAILURE_STATUSES:
            # An open failure must stay reproducible: phase_gate.py checks these too.
            missing += ["--" + option.replace("_", "-") for option in ("command", "log_path", "evidence")
                        if OPTIONS[option] not in given]
        if missing:
            raise SystemExit(f"new diagnostic {args.id} requires: " + " ".join(missing))
    record = {field: (existing or NEW_ROW_DEFAULTS).get(field, "") for field in FIELDS}
    record.update({field: str(value) for field, value in given.items()})
    record["id"] = args.id
    if not record["build_or_device_run_id"].strip():
        raise SystemExit("--build-or-device-run-id cannot be empty")

    old_status = (existing or {}).get("status", "").strip().lower()
    if old_status in FAILURE_STATUSES | {"resolved"} and record["status"] == "passed":
        raise SystemExit(
            f"{args.id} records a failure and must not be rewritten as passed; "
            "use --status resolved with --root-cause and --next-action describing the fix. "
            "The passing attempt keeps its own receipt row."
        )
    if record["status"] == "resolved" and not is_classified(record):
        raise SystemExit(
            f"{args.id} cannot be resolved without --category, --root-cause and --next-action "
            "that state what was wrong and what fixed it"
        )
    replaced = upsert_diagnostic(args.diagnostics, record)
    print(f"{'updated' if replaced else 'recorded'} {args.id} attempts={record['attempts']} status={record['status']}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

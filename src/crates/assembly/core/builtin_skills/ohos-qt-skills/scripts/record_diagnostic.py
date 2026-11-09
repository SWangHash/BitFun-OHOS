#!/usr/bin/env python3
"""Record or update one problem in diagnostics.tsv.

diagnostics.tsv is the problem list of the migration: one row per problem met
on the way (a failed configure/build/package/install/launch step, a broken
toolchain or SDK file, a wrong deployment path), with where it showed, what
was seen, why, how to reproduce it and what fixes it. A retry of the same
problem updates its row; passing batches write nothing. How many fixes were
tried is not recorded: after three failed fixes of one problem set it
``blocked`` and ask the user; the gates wait until the answer sets it ``open``
again (a new fix to try) or ``accepted-limitation`` (the user accepts it unfixed).

Write the cause (and the planned fix) of a problem batch_checks.py recorded,
before the next batch::

    record_diagnostic.py <diagnostics.tsv> --id DIAG-004 --cause "<why it fails>" --fix "<the change to make>"

Close it once the fix is proven (``batch_checks.py --diag DIAG-004`` does this
itself when the retry passes and cause and fix are recorded)::

    record_diagnostic.py <diagnostics.tsv> --id DIAG-004 --fix "<what fixed it>" --status fixed

Record a problem met outside a batch with ``--id new``::

    record_diagnostic.py <diagnostics.tsv> --id new --location "environment: OpenHarmony SDK native/llvm" \\
        --symptom "<first error line>" --cause "<why>" --reproduce "<command>; log: <path>" \\
        --fix "<fix applied>" --status fixed

``--location`` starts with a stage of vocab.STAGES (``build: ...``); statuses
are vocab.DIAGNOSTIC_STATUSES: ``open``, ``fixed`` (needs cause and fix),
``blocked`` (needs cause), ``accepted-limitation`` (needs cause, and the user's
answer in ``--fix``). Omitted options keep the stored value.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

from gate_state import refresh_progress
from vocab import DIAGNOSTIC_STATUSES, STAGES


FIELDS = ["id", "location", "symptom", "cause", "reproduce", "fix", "status"]
PREFIX = "DIAG-"


def problems(record: dict[str, str]) -> list[str]:
    """What a row still lacks for its status (empty when it is consistent)."""
    missing = []
    if record.get("location", "").partition(":")[0].strip() not in STAGES:
        missing.append(f"--location '<stage>: <detail>' with a stage of {', '.join(STAGES)}")
    if not record.get("symptom", "").strip():
        missing.append("--symptom")
    status = record.get("status", "")
    if status in {"fixed", "blocked", "accepted-limitation"} and not record.get("cause", "").strip():
        missing.append("--cause")
    if status in {"fixed", "accepted-limitation"} and not record.get("fix", "").strip():
        missing.append("--fix")
    return missing


def read_diagnostics(path: Path) -> list[dict[str, str]]:
    """Rows of diagnostics.tsv; a ledger with another header (an older layout) is refused, never rewritten."""
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        rows = list(reader)
    if reader.fieldnames and list(reader.fieldnames) != FIELDS:
        raise SystemExit(f"{path} has the columns {', '.join(reader.fieldnames)}, not {', '.join(FIELDS)}: "
                         "rewrite it with the current columns (ledger.py columns diagnostics.tsv)")
    return rows


def write_diagnostics(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows({field: " ".join((row.get(field) or "").split()) for field in FIELDS} for row in rows)
    refresh_progress(path.parent)


def next_diagnostic_id(rows: list[dict[str, str]]) -> str:
    numbers = [int(row["id"][len(PREFIX):]) for row in rows
               if row.get("id", "").startswith(PREFIX) and row["id"][len(PREFIX):].isdigit()]
    return f"{PREFIX}{max(numbers, default=0) + 1:03d}"


def uncaused(rows: list[dict[str, str]]) -> list[str]:
    """Open problems without a cause: the next batch waits for them."""
    return [row.get("id", "") for row in rows
            if row.get("status", "").strip() == "open" and not row.get("cause", "").strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("diagnostics", type=Path)
    parser.add_argument("--id", required=True, help="DIAG-* id to update, or 'new' to append with the next free id")
    for field in FIELDS[1:]:
        if field == "status":
            parser.add_argument("--status", choices=DIAGNOSTIC_STATUSES)
        else:
            parser.add_argument("--" + field)
    args = parser.parse_args()
    path = args.diagnostics.resolve()
    rows = read_diagnostics(path)
    if args.id.lower() == "new":
        args.id = next_diagnostic_id(rows)
    if not args.id.startswith(PREFIX):
        raise SystemExit(f"--id must start with {PREFIX} (or be 'new')")
    existing = next((row for row in rows if row.get("id") == args.id), None)
    record = {field: (existing or {"status": "open"}).get(field, "") for field in FIELDS}
    record.update({field: str(getattr(args, field)) for field in FIELDS[1:] if getattr(args, field) is not None})
    record["id"] = args.id
    missing = problems(record)
    if missing:
        raise SystemExit(f"{args.id} ({record['status']}) needs: " + "; ".join(missing))
    if existing is None:
        rows.append(record)
    else:
        existing.update(record)
    write_diagnostics(path, rows)
    print(f"{'updated' if existing else 'recorded'} {args.id} status={record['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

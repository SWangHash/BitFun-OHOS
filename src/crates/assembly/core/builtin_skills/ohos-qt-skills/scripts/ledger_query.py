#!/usr/bin/env python3
"""Query only the migration-ledger rows needed for the current action.

This keeps the model context small: use ``context`` with a capability/validation
ID instead of loading every TSV, or ``ready`` to retrieve the next queue rows.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

LEDGERS = (
    "baseline.tsv", "decisions.tsv", "device-runs.tsv", "diagnostics.tsv",
    "environment.tsv", "feature-adoption.tsv", "inventory.tsv",
    "knowledge-manifest.tsv", "pilot.tsv",
    "package-manifest.tsv", "validation.tsv", "work-queue.tsv",
)
DONE = {"passed", "accepted-limitation", "not-applicable", "verified"}


def read_rows(root: Path, name: str) -> list[dict[str, str]]:
    path = root / name
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def emit(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def prerequisites(row: dict[str, str]) -> list[str]:
    return [v.strip() for v in row.get("prerequisites", "").split(",")
            if v.strip() and v.strip() != "none"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("command", choices=("summary", "row", "context", "ready"))
    parser.add_argument("--ledger", choices=LEDGERS)
    parser.add_argument("--id", dest="ids", action="append", default=[])
    parser.add_argument("--status", action="append", default=[])
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    root = args.migration_root.resolve()

    if args.command == "summary":
        emit({name: len(read_rows(root, name)) for name in LEDGERS})
        return 0

    if args.command == "row":
        if not args.ledger or not args.ids:
            parser.error("row requires --ledger and at least one --id")
        wanted = set(args.ids)
        rows = [row for row in read_rows(root, args.ledger)
                if row.get("id") in wanted]
        emit(rows)
        return 0 if rows else 1

    if args.command == "ready":
        rows = read_rows(root, "work-queue.tsv")
        by_id = {row.get("id", ""): row for row in rows}
        ready = [row for row in rows
                 if row.get("status") in {"planned", "ready"}
                 and all(by_id.get(dep, {}).get("status") in DONE
                         for dep in prerequisites(row))]
        if args.status:
            ready = [row for row in ready if row.get("status") in set(args.status)]
        emit(ready[:args.limit])
        return 0

    if not args.ids:
        parser.error("context requires at least one --id")
    wanted = set(args.ids)
    result: dict[str, list[dict[str, str]]] = {}
    for name in LEDGERS:
        rows = read_rows(root, name)
        selected = []
        for row in rows:
            values = set(row.values())
            if row.get("id") in wanted or values & wanted:
                selected.append(row)
        if selected:
            result[name] = selected
    emit(result)
    return 0 if result else 1


if __name__ == "__main__":
    raise SystemExit(main())

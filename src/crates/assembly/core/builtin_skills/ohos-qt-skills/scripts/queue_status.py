#!/usr/bin/env python3
"""Report or select ready capability work from work-queue.tsv."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

DONE = {"passed", "accepted-limitation", "not-applicable"}
BOOTSTRAP_IDS = {"CAP-BOOT-001"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("queue", type=Path)
    parser.add_argument("command", choices=("status", "next", "verify"), nargs="?", default="status")
    parser.add_argument("--limit", type=int, default=1)
    args = parser.parse_args()
    with args.queue.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    operational_rows = [row for row in rows if row.get("id", "").strip() not in BOOTSTRAP_IDS]
    by_id = {row["id"]: row for row in operational_rows}
    duplicates = len(operational_rows) - len(by_id)

    def prerequisites(row: dict[str, str]) -> list[str]:
        value = row.get("prerequisites", "").strip()
        return [part.strip() for part in value.split(",") if part.strip() and part.strip() != "none"]

    def ready(row: dict[str, str]) -> bool:
        return row.get("status") in {"planned", "ready"} and all(
            dependency in by_id and by_id[dependency].get("status") in DONE
            for dependency in prerequisites(row)
        )

    if args.command == "status":
        counts = Counter(row.get("status", "") for row in operational_rows)
        print(f"total={len(operational_rows)} bootstrap={len(rows) - len(operational_rows)} ready={sum(ready(row) for row in operational_rows)}")
        for status, count in sorted(counts.items()):
            print(f"{status or '<empty>'}={count}")
        return 0
    if args.command == "next":
        print(json.dumps([row for row in operational_rows if ready(row)][:args.limit], ensure_ascii=False, indent=2))
        return 0
    errors: list[str] = []
    if duplicates:
        errors.append(f"duplicate ids={duplicates}")
    for row in operational_rows:
        for dependency in prerequisites(row):
            if dependency not in by_id:
                errors.append(f"{row['id']} missing prerequisite {dependency}")
            elif dependency == row["id"]:
                errors.append(f"{row['id']} depends on itself")
        if row.get("status") in DONE and not row.get("evidence", "").strip():
            errors.append(f"{row['id']} is {row['status']} without evidence")
    if errors:
        print("INVALID")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print(f"OK units={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

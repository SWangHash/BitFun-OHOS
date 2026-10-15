#!/usr/bin/env python3
"""Mark skill-baseline pages (upstream-kb/knowledge/...) as consulted in a project knowledge-manifest.tsv."""
from __future__ import annotations
import argparse
import csv
from pathlib import Path

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("paths", nargs="+", help="snapshot-relative source paths")
    args = parser.parse_args()
    if not args.manifest.exists():
        raise SystemExit(f"manifest does not exist: {args.manifest}")
    with args.manifest.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    wanted = set(args.paths)
    found = set()
    for row in rows:
        if row["source_path"] in wanted:
            row["used"] = "yes"
            found.add(row["source_path"])
    missing = wanted - found
    if missing:
        raise SystemExit("paths are not present in manifest: " + ", ".join(sorted(missing)))
    fields = list(rows[0].keys()) if rows else []
    with args.manifest.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"marked_used={len(found)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

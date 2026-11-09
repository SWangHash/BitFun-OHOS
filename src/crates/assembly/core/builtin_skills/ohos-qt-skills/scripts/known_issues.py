#!/usr/bin/env python3
"""Known-issue signatures: match a failure to a reviewed root cause and fix.

``assets/known-issues.tsv`` holds generic problems met in real migrations
(environment, toolchain, build-system, packaging, device), each with a regex
signature, its root cause, the fix, and the skill script that prevents it.

``batch_checks.py`` matches every failed step against it: a hit is written
into the problem's diagnostics row as its cause and fix,
so the next attempt can start right after the fix instead of after a fresh
investigation. Agents use it directly too::

    python scripts/known_issues.py match --log <build.log> [--command "<cmd>"]
    python scripts/known_issues.py match --text "<first error line>"
    python scripts/known_issues.py list

A migration agent reads the table but never edits it. Maintainers grow it from
finished migrations::

    python scripts/known_issues.py candidates <container>/migration/ohos/diagnostics.tsv

lists fixed problems that no signature matches yet; review them, keep the
generic ones (environment, toolchain, build system, packaging, dependency,
device; not the application's own code) and add them to the TSV (one line per
issue, tab separated, no tabs inside fields).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

DEFAULT_TABLE = Path(__file__).resolve().parent.parent / "assets" / "known-issues.tsv"
FIELDS = ["id", "scope", "category", "signature", "command_regex", "root_cause", "fix", "prevented_by", "source"]


def load(path: Path | None = None) -> list[dict[str, str]]:
    path = Path(path or DEFAULT_TABLE)
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t", quoting=csv.QUOTE_NONE))
    issues = []
    for row in rows:
        row = {key: (value or "") for key, value in row.items() if key}
        try:
            row["_sig"] = re.compile(row.get("signature", ""), re.IGNORECASE) if row.get("signature") else None
            row["_cmd"] = re.compile(row.get("command_regex", ""), re.IGNORECASE) if row.get("command_regex") else None
        except re.error:
            continue
        if row["_sig"] is not None:
            issues.append(row)
    return issues


def match(text: str, command: str = "", issues: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    """Known issues whose signature occurs in ``text`` (and whose command regex fits ``command``)."""
    hits = []
    for issue in issues if issues is not None else load():
        if not issue["_sig"].search(text or ""):
            continue
        if issue.get("_cmd") is not None and not issue["_cmd"].search(command or ""):
            continue
        hits.append({key: value for key, value in issue.items() if not key.startswith("_")})
    return hits


def describe(issue: dict[str, str]) -> str:
    return f"{issue['id']}: {issue['root_cause']} -> fix: {issue['fix']}"


def read_logs(path: Path, limit_files: int = 200) -> str:
    """A log file, or every ``*.log``/``*.txt`` below a directory (a batch output dir)."""
    path = Path(path)
    if not path.exists():
        raise SystemExit(f"--log {path} does not exist")
    if path.is_file():
        return path.read_text(encoding="utf-8", errors="replace")
    files = sorted(item for pattern in ("*.log", "*.txt") for item in path.rglob(pattern) if item.is_file())
    parts = []
    for item in files[:limit_files]:
        try:
            parts.append(item.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
    return "\n".join(parts)


def cmd_match(args) -> int:
    text = args.text or ""
    if args.log:
        text += "\n" + read_logs(Path(args.log))
    hits = match(text, args.command or "", load(args.table))
    if args.json:
        print(json.dumps(hits, ensure_ascii=False, indent=2))
    elif hits:
        for hit in hits:
            print(describe(hit))
    else:
        print("no known issue matches; diagnose from the first causal error")
    return 0 if hits else 1


def cmd_list(args) -> int:
    for issue in load(args.table):
        print(f"{issue['id']}\t{issue['scope']}\t{issue['root_cause'][:100]}")
    return 0


def cmd_candidates(args) -> int:
    issues = load(args.table)
    with Path(args.diagnostics).open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    found = 0
    for row in rows:
        if row.get("status", "").strip() != "fixed":
            continue
        text = " ".join(row.get(key, "") for key in ("symptom", "cause"))
        if match(text, row.get("reproduce", ""), issues):
            continue
        found += 1
        print(f"{row.get('id')}\t{row.get('location', '')}\t{row.get('symptom', '')[:160]}")
        print(f"\tcause: {row.get('cause', '')[:240]}")
        print(f"\tfix: {row.get('fix', '')[:240]}")
    if not found:
        print("no fixed problem without a known-issue signature")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", type=Path, default=DEFAULT_TABLE)
    sub = parser.add_subparsers(dest="command_name", required=True)
    m = sub.add_parser("match", help="match a log or error line")
    m.add_argument("--log", help="a log file or a directory of logs (for example a batch output dir)")
    m.add_argument("--text")
    m.add_argument("--command", help="the command that produced the log (some signatures depend on it)")
    m.add_argument("--json", action="store_true")
    m.set_defaults(func=cmd_match)
    sub.add_parser("list").set_defaults(func=cmd_list)
    c = sub.add_parser("candidates", help="fixed problems not covered by a signature")
    c.add_argument("diagnostics")
    c.set_defaults(func=cmd_candidates)
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

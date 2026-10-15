#!/usr/bin/env python3
"""Run build/package/device checks as one resumable batch.

The plan is JSON with ``steps`` entries. Each entry has a name and either a
shell command string or an argv list. The script emits one compact summary and
stores full stdout/stderr per step, avoiding repeated foreground polling. A
failed step lists ``first_error``, ``error_count`` and the distinct ``errors``;
use a keep-going build (``cmake --build <dir> -- -k 0`` for Ninja) so one
attempt reports every failing translation unit.

Optional plan key ``artifact_receipts`` lists ``{"pattern", "receipt",
"archive"}`` entries. After every passed step the newest file matching
``pattern`` (glob, relative to --cwd, ``**`` allowed) has its absolute path
written to ``receipt`` immediately, and is copied under ``<output-dir>/artifacts``
when ``archive`` is true, so a later clean or failed step cannot lose it.

With ``--diagnostics`` the batch writes its own ``diagnostics.tsv`` receipt
(``--phase pilot`` writes ``pilot.tsv`` next to it, with ``PILOT-*`` ids):
the first error-like line of the failed step, the command, the tree hash and
log paths. A failed row is written as ``unclassified``; classify it with
record_diagnostic.py (same id) before the next attempt. A batch whose tree
and plan hash equal a previously failed row is refused unless --allow-repeat.

Failure history is never overwritten. Every attempt gets a new row; when a
batch passes, the earlier failed rows of the same first affected id become
``resolved`` (they keep their signature, root cause and log). Rerunning into an
``--output-dir`` that already holds an attempt first moves that attempt's logs
to ``<output-dir>/attempt-N`` and repoints the ledger rows at them.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from gate_state import open_phases_before
from record_diagnostic import id_prefix, is_classified, next_diagnostic_id, read_diagnostics, route_ledger, write_diagnostics

# Case-sensitive on purpose: source paths such as src/error/ must not match.
# Compiler/linker/packager lines win over ninja's generic "FAILED:" line,
# which precedes the real error in the log.
ERROR_RE = re.compile(
    r"fatal error|\berror( C\d+)?:|CMake Error|undefined (reference|symbol)"
    r"|ld(\.lld)?: error|\bERROR\b|\bError:"
)
FALLBACK_RE = re.compile(r"^FAILED:|\bfailed\b")


def first_error_line(*texts: str) -> str:
    for pattern in (ERROR_RE, FALLBACK_RE):
        for text in texts:
            for line in text.splitlines():
                if pattern.search(line):
                    return line.strip()[:300]
    return ""


def error_lines(*texts: str, limit: int = 40) -> tuple[int, list[str]]:
    """Count error-like lines and keep the first ``limit`` distinct ones.

    With a keep-going build (``ninja -k 0``) this lists every failing
    translation unit in one attempt, so fixes can be grouped by root cause.
    """
    count, seen = 0, []
    for text in texts:
        for line in text.splitlines():
            if ERROR_RE.search(line):
                count += 1
                line = line.strip()[:300]
                if line not in seen and len(seen) < limit:
                    seen.append(line)
    return count, seen


SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".qml", ".qrc", ".ui",
                   ".pro", ".pri", ".cmake", ".json5", ".ets", ".ts", ".in"}


def tree_hash(cwd: Path, plan_text: str, excluded: list[Path]) -> str:
    """Hash git HEAD, the tracked diff, untracked source files and the plan.

    ``excluded`` (the migration root and evidence directory) change on every
    batch and must not make an unchanged source tree look different.
    Returns 'not-computed' outside a git work tree.
    """
    digest = hashlib.sha256(plan_text.encode("utf-8"))

    def git(*argv: str) -> bytes:
        return subprocess.run(["git", *argv], cwd=cwd, capture_output=True, check=True, timeout=120).stdout

    try:
        top = Path(git("rev-parse", "--show-toplevel").decode().strip()).resolve()
        # Never exclude the work tree itself (e.g. --output-dir directly under it).
        skip = [p for p in (path.resolve() for path in excluded) if p != top and p not in top.parents]
        specs = [f":(exclude,top){p.relative_to(top).as_posix()}" for p in skip if top in p.parents]
        digest.update(git("rev-parse", "HEAD"))
        digest.update(git("diff", "HEAD", "--binary", "--", ".", *specs))
        for name in sorted(git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")):
            path = (cwd / name).resolve()
            if not name or not path.is_file() or (path.suffix.lower() not in SOURCE_SUFFIXES and path.name != "CMakeLists.txt"):
                continue
            if any(path == p or p in path.parents for p in skip):
                continue
            digest.update(name.encode() + hashlib.sha256(path.read_bytes()).digest())
    except (OSError, ValueError, subprocess.SubprocessError):
        return "not-computed"
    return digest.hexdigest()[:16]


def write_receipts(receipts: list[dict], base_cwd: Path, output: Path) -> list[dict]:
    written = []
    for receipt in receipts:
        pattern = str(receipt["pattern"])
        if not os.path.isabs(pattern):
            pattern = str(base_cwd / pattern)
        matches = [Path(p) for p in glob.glob(pattern, recursive=True) if Path(p).is_file()]
        if not matches:
            continue
        artifact = max(matches, key=lambda p: p.stat().st_mtime).resolve()
        target = Path(receipt["receipt"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(artifact), encoding="utf-8")
        entry = {"artifact": str(artifact), "receipt": str(target)}
        if receipt.get("archive"):
            archive = output / "artifacts" / artifact.name
            archive.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(artifact, archive)
            entry["archive"] = str(archive)
        written.append(entry)
    return written


def one_line(value: object) -> str:
    return " ".join(str(value).split())


def archive_previous_attempt(output: Path, rows: list[dict[str, str]]) -> Path | None:
    """Move an earlier attempt's logs out of the way instead of overwriting them.

    Ledger rows whose ``log_path`` pointed at the moved files are repointed in
    ``rows`` (the caller writes them back). Returns the archive directory.
    """
    if not (output / "batch-summary.json").is_file():
        return None
    number = 1
    while (output / f"attempt-{number}").exists():
        number += 1
    archive = output / f"attempt-{number}"
    archive.mkdir()
    for path in list(output.iterdir()):
        if path.is_file():
            shutil.move(str(path), str(archive / path.name))
    for row in rows:
        log = row.get("log_path", "")
        if log and Path(log).parent == output:
            row["log_path"] = str(archive / Path(log).name)
    return archive


FAILED = {"failed", "timeout"}


def affects(row: dict[str, str], item_id: str) -> bool:
    return item_id in [value.strip() for value in row.get("affected_ids", "").split(",")]


def is_batch_row(row: dict[str, str]) -> bool:
    return row.get("evidence", "").strip().lower().startswith("batch ")


def attempt_number(previous: list[dict[str, str]], item_id: str) -> int:
    """1 + failed batch attempts for this item since its last passing batch."""
    count = 0
    for row in previous:
        if not is_batch_row(row) or not affects(row, item_id):
            continue
        status = row.get("status", "").strip().lower()
        if status == "passed":
            count = 0
        elif status in FAILED | {"blocked", "resolved"}:
            count += 1
    return count + 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("plan", type=Path, help="JSON batch plan")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cwd", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--diagnostics", type=Path, default=None,
                        help="diagnostics.tsv to receive the batch receipt (pilot.tsv for --phase pilot)")
    parser.add_argument("--affected-ids", default="", help="CAP-*/VAL-* ids for the receipt (required with --diagnostics)")
    parser.add_argument("--phase", default="build", help="receipt phase, e.g. pilot, build, package, device")
    parser.add_argument("--diag-id", default=None, help="receipt id; defaults to the next DIAG-NNN (PILOT-NNN)")
    parser.add_argument("--allow-repeat", action="store_true", help="run even if an identical tree/plan already failed")
    args = parser.parse_args()
    if args.diagnostics:
        args.diagnostics = route_ledger(args.diagnostics, args.phase)
        if args.diagnostics.name == "pilot.tsv":
            args.phase = "pilot"
    if args.diagnostics and not (args.diagnostics.resolve().parent / "STATE.md").is_file():
        raise SystemExit(
            f"BLOCKED: {args.diagnostics.resolve().parent} is not an initialized migration ledger. "
            "Run init_migration.py --target <app> --template-root <skill>/assets/templates/migration/ohos first.")
    if args.diagnostics:
        # A pilot batch needs the contract gate; any other batch needs the pilot gate.
        root = args.diagnostics.resolve().parent
        stage = "pilot" if args.phase == "pilot" else "implementation"
        _, open_phases = open_phases_before((root / "STATE.md").read_text(encoding="utf-8", errors="replace"), stage)
        if open_phases:
            raise SystemExit(
                f"BLOCKED: a {args.phase} batch needs these phase gates to pass first: {', '.join(open_phases)}. "
                f"Run validate_ledgers.py {root} --phase {open_phases[0]} and finish that phase; "
                "do not edit Current phase or Progress by hand.")
    if args.diagnostics and not args.affected_ids.strip():
        raise SystemExit("--affected-ids is required with --diagnostics")
    plan_text = args.plan.read_text(encoding="utf-8-sig")
    plan = json.loads(plan_text)
    steps = plan.get("steps", [])
    if not isinstance(steps, list) or not steps:
        raise SystemExit("batch plan must contain a non-empty steps list")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    base_cwd = (args.cwd or Path.cwd()).resolve()

    previous = read_diagnostics(args.diagnostics) if args.diagnostics else []
    hash_value = tree_hash(base_cwd, plan_text, [args.diagnostics.parent, output.parent]) if args.diagnostics else ""
    if args.diagnostics and hash_value != "not-computed" and not args.allow_repeat:
        for row in previous:
            if row.get("tree_or_environment_hash") == hash_value and row.get("status") in {"failed", "timeout"}:
                raise SystemExit(
                    f"refusing to repeat {row.get('id')}: tree and plan are unchanged since it failed; "
                    "make a recorded change first or pass --allow-repeat"
                )
    if args.diagnostics:
        first_id = args.affected_ids.split(",")[0].strip()
        pending = [row.get("id", "") for row in previous
                   if is_batch_row(row) and affects(row, first_id)
                   and row.get("status", "").strip().lower() in FAILED and not is_classified(row)]
        if pending:
            raise SystemExit(
                f"classify {', '.join(pending)} first: record_diagnostic.py <diagnostics.tsv> --id {pending[-1]} "
                "--category ... --root-cause ... --next-action <the change made for this attempt>"
            )
    archived = archive_previous_attempt(output, previous)
    if archived:
        print(f"previous attempt in {output} kept under {archived}")
        if args.diagnostics:
            write_diagnostics(args.diagnostics.resolve(), previous)

    summary = []
    receipts: list[dict] = []
    for index, step in enumerate(steps, 1):
        name = str(step.get("name") or f"step-{index}")
        command = step.get("command")
        if not command:
            raise SystemExit(f"step {name} has no command")
        shell = isinstance(command, str)
        argv = command if shell else [str(value) for value in command]
        cwd = (base_cwd / step["cwd"]).resolve() if step.get("cwd") else base_cwd
        started = time.time()
        try:
            result = subprocess.run(
                argv, cwd=cwd, shell=shell, text=True,
                capture_output=True, timeout=float(step.get("timeout", args.timeout)),
                env={**os.environ, **{str(k): str(v) for k, v in step.get("env", {}).items()}},
                check=False,
            )
            status = "passed" if result.returncode == 0 else "failed"
            exit_code = result.returncode
            stdout, stderr = result.stdout, result.stderr
        except subprocess.TimeoutExpired as exc:
            status, exit_code = "timeout", None
            stdout = exc.stdout or ""
            stderr = (exc.stderr or "") + "\nstep timed out"
            if isinstance(stdout, bytes):
                stdout = stdout.decode("utf-8", errors="replace")
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", errors="replace")
        elapsed = round(time.time() - started, 3)
        stem = f"{index:02d}-{''.join(c if c.isalnum() else '_' for c in name)[:48]}"
        (output / f"{stem}.stdout.log").write_text(stdout, encoding="utf-8", errors="replace")
        (output / f"{stem}.stderr.log").write_text(stderr, encoding="utf-8", errors="replace")
        row = {"name": name, "command": command, "cwd": str(cwd),
               "status": status, "exit_code": exit_code,
               "duration_sec": elapsed,
               "stdout_path": f"{stem}.stdout.log",
               "stderr_path": f"{stem}.stderr.log"}
        if status != "passed":
            row["first_error"] = first_error_line(stdout, stderr)
            row["error_count"], row["errors"] = error_lines(stdout, stderr)
        summary.append(row)
        if status == "passed" and plan.get("artifact_receipts"):
            receipts = write_receipts(plan["artifact_receipts"], base_cwd, output) or receipts
        if status != "passed" and not step.get("continue_on_failure", False):
            break
    result_doc = {"steps": summary, "artifact_receipts": receipts}
    (output / "batch-summary.json").write_text(json.dumps(result_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result_doc, ensure_ascii=False, indent=2))
    passed = bool(summary) and all(row["status"] == "passed" for row in summary)

    if args.diagnostics:
        failed = next((row for row in summary if row["status"] != "passed"), None)
        diag_id = args.diag_id or next_diagnostic_id(previous, id_prefix(args.diagnostics))
        taken = next((row for row in previous if row.get("id") == diag_id), None)
        if taken and taken.get("status", "").strip().lower() not in {"planned", "in-progress"}:
            # A finished attempt (above all a failure) is history; never replace it.
            diag_id = next_diagnostic_id(previous, id_prefix(args.diagnostics))
            print(f"{taken.get('id')} already records an attempt; this run is recorded as {diag_id}")
        first_id = args.affected_ids.split(",")[0].strip()
        attempts = attempt_number(previous, first_id)
        focus = failed or summary[-1]
        record = {
            "id": diag_id,
            "build_or_device_run_id": output.name,
            "phase": args.phase,
            "category": "unclassified" if failed else "receipt",
            "first_causal_signature": one_line(focus.get("first_error") or f"step {focus['name']} exit={focus['exit_code']}")
            if failed else f"all {len(summary)} steps passed",
            "root_cause": "unclassified" if failed else "none",
            "attempts": str(attempts),
            "command": one_line(focus["command"] if isinstance(focus["command"], str) else " ".join(map(str, focus["command"]))),
            "tree_or_environment_hash": hash_value,
            "log_path": str(output / (focus["stdout_path"] if failed else "batch-summary.json")),
            "fix_or_next_action": f"classify with record_diagnostic.py --id {diag_id} before the next attempt"
            if failed else "update the affected queue, validation and package rows",
            "affected_ids": args.affected_ids,
            "evidence": one_line(
                f"batch {output.name}: step {focus['name']} {focus['status']} after {focus['duration_sec']}s"
                + (f"; {focus['error_count']} error lines" if failed else "")
                + "".join(f"; receipt {r['receipt']} -> {r['artifact']}" for r in receipts)
            ),
            "status": failed["status"] if failed else "passed",
            "recurrence": "",
        }
        rows = [row for row in previous if row.get("id") != diag_id]
        if not failed:
            # The pass proves the fix: close the failures it supersedes, keep their content.
            for row in rows:
                if is_batch_row(row) and affects(row, first_id) and row.get("status", "").strip().lower() in FAILED:
                    row["status"] = "resolved"
                    row["evidence"] = one_line(f"{row.get('evidence', '')}; resolved by {diag_id}")
                    if is_classified(row):
                        print(f"{row['id']} resolved by {diag_id}")
                    else:
                        print(
                            f"{row['id']} resolved by {diag_id} but has no root cause or fix recorded; run "
                            f"record_diagnostic.py --id {row['id']} --category ... --root-cause ... "
                            "--next-action <the fix that worked>"
                        )
        rows.append(record)
        write_diagnostics(args.diagnostics.resolve(), rows)
        print(f"diagnostic {diag_id} status={record['status']} attempts={attempts}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

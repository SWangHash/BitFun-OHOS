#!/usr/bin/env python3
"""Run configure/build/deploy/package/device steps as one resumable batch.

    python <skill>/scripts/batch_checks.py <plan.json> --output-dir <root>/batches/<name> --cwd <app> \
        [--tasks TASK-003] [--diag DIAG-004] [--stage build]

``<root>`` is the migration (``<container>/migration/ohos``); the output directory
names it, so every batch belongs to its migration: it refuses to start before
the environment, inventory and decisions gates passed or while an open problem
has no cause, runs with that migration's environment.tsv and records into its
diagnostics.tsv, tasks.tsv and device-runs.tsv.

Every configure, build, package and device attempt of the application runs
through this command, so the receipt is written by the command that produced
the result. The plan format is ``PLAN_SCHEMA`` below (``next_step.py
--schema`` prints it); ``assets/templates/migration/ohos/batch-checks.example.json``
is a starting point. Each step is a shell string (platform shell; ``"shell":
"powershell"``/``"bash"`` to choose) or an argv list (no shell). The summary
lists, per step, status, exit code, duration, log paths and, for a failed step,
``first_error``, ``error_count`` and the distinct ``errors``: read the failing
step's log from there instead of printing whole logs (a passed application run
on the device is recorded by ``device_run.py run --record`` itself). Build keep-going
(``make -k``, ``cmake --build <dir> -- -k 0``) so one attempt reports every
failing translation unit; group the errors by root cause and fix a group per
attempt. A failed step stops the batch unless ``continue_on_failure`` is set.

Environment: every step runs with the ``command_env`` of the migration's ``environment.tsv`` applied, and ``$OHOS_QT_ENV_PROFILE``
names it, so deploy_qt_libs.py, devecocli_build.py, hap_check.py and
device_run.py inside a step find it without ``--env-profile``, also for an
output project outside the application tree. A plan must not set PATH,
NATIVE_OHOS_SDK or DEVECO_SDK_HOME itself (``"inline_env": true`` with a reason
opts a step out), must build the HAP with devecocli_build.py (not a bare
``devecocli build`` or hvigor call: the script checks the project has the hvigor
daemon off, KI-004, and reports the HAP), and must not deploy with qmake's
``make ohosdeploy`` (it only echoes, KI-019; use deploy_qt_libs.py).

Watchdog: each step has a total ``timeout`` and an ``idle_timeout`` (no growth
of stdout, stderr or the ``watch`` files; 0 disables); a hung step's process
tree is killed and the step ends ``timeout``. Logs stream to
``<output-dir>/NN-<step>.stdout.log`` while the step runs. Never poll a long build in the
foreground: start the batch and read its summary.

Problems: a failed batch records the problem in
``diagnostics.tsv`` (one row per problem, status ``open``): ``location`` from
``--stage`` (vocab.STAGES) and the failed step, the first error-like line as
``symptom``, the command and log path as ``reproduce``. A failure that matches
``assets/known-issues.tsv`` also gets its cause and fix from there: verify them
and apply the fix. Otherwise write the cause with record_diagnostic.py; no batch
starts while an open problem has no cause. A retry of a recorded problem passes
``--diag DIAG-NNN``: a failure refreshes that row instead of adding one, a pass
sets it ``fixed`` when its cause and fix are recorded. A passing batch without
``--diag`` writes no problem row. ``--tasks`` names the TASK rows the batch works on:
they become ``in-progress`` with the last batch in their evidence; closing a
row stays ``ledger.py update`` (status and evidence).

Application HAP: ``device-runs.tsv`` keeps one row,
the latest result of the application HAP. A ``hap_check.py`` step overwrites
it as soon as the step ends: ``checked`` when it passed (``no-device`` when
environment.tsv has no connected device), ``hap-failed`` when it failed (the
failure is also a diagnostics problem). A ``device_run.py run --record`` step
later in the same batch then finds the row. Nothing is written while the
project still packs the envelope app, and nothing is copied: the HAP stays
where hvigor wrote it. Rerunning into an ``--output-dir`` that holds an attempt
moves that attempt's logs to ``<output-dir>/attempt-N`` first.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path

import known_issues
import ohos_env
from gate_state import open_phases_before
from record_diagnostic import next_diagnostic_id, read_diagnostics, uncaused, write_diagnostics
from template_patch import ENVELOPE_LIBRARY
from vocab import STAGES


PLAN_SCHEMA = """batch plan (JSON) for batch_checks.py:
{
  "timeout": 1800, "idle_timeout": 600,            # optional plan defaults (seconds; 0 disables idle)
  "steps": [
    {"name": "qmake-configure", "command": ["qmake", "../App.pro", "-spec", "ohos-clang"], "cwd": "src/build-ohos"},
    {"name": "build", "command": "mingw32-make -k -j8", "cwd": "src/build-ohos", "timeout": 3600},
    {"name": "deploy", "command": ["python", "<skill>/scripts/deploy_qt_libs.py", "--project", "project",
                                   "--library", "src/build-ohos/libApp.so"]},
    {"name": "hap", "command": ["python", "<skill>/scripts/devecocli_build.py", "--project", "project"]},
    {"name": "hap-check", "command": ["python", "<skill>/scripts/hap_check.py", "--project", "project"]},
    {"name": "device", "command": ["python", "<skill>/scripts/device_run.py", "run", "--project", "project",
                                   "--migration-root", "migration/ohos", "--record"]}
  ]
}
step keys: name, command (string = shell, list = argv), cwd, shell, timeout, idle_timeout, watch (files whose
growth counts as progress), env (extra variables), continue_on_failure, inline_env (opt out of the environment.tsv
rule, give a reason). Runtime data the app needs on the device goes under entry/src/main/resources/resfile/<dir>
and is checked with hap_check.py --expect resources/resfile/<dir>:<min files>, not with a hand-written step."""

# Variables owned by environment.tsv (command_env); a plan that sets them by hand drifts from the
# environment phase (the cause of repeated "fixed once, broken again" failures).
INLINE_ENV_RE = re.compile(
    r"(?i:\$env:(PATH|NATIVE_OHOS_SDK|DEVECO_SDK_HOME)\s*\+?=)"
    r"|(?i:\bset\s+\"?(PATH|NATIVE_OHOS_SDK|DEVECO_SDK_HOME)=)"
    r"|(?:^|[\s;&(])(?:export\s+)?(PATH|NATIVE_OHOS_SDK|DEVECO_SDK_HOME)=(?!\$PATH\b)"
)
SHELLS = {
    "powershell": ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
    "pwsh": ["pwsh", "-NoProfile", "-NonInteractive", "-Command"],
    "bash": ["bash", "-c"],
    "cmd": None,
}
DEVECOCLI_BUILD_RE = re.compile(r"devecocli(\.ps1|\.cmd|\.exe)?\W+build\b", re.IGNORECASE)
HVIGOR_RE = re.compile(r"hvigor(w|\.js|w\.js|w\.bat)?\b[^\n]*\bassemble", re.IGNORECASE)
OHOSDEPLOY_RE = re.compile(r"\bmake(\.exe)?\b[^\n]*\bohosdeploy\b", re.IGNORECASE)


def plan_problems(steps: list[dict]) -> list[str]:
    """Plan rules that keep the environment single-sourced and builds bounded."""
    problems = []
    for index, step in enumerate(steps, 1):
        name = str(step.get("name") or f"step-{index}")
        command = step.get("command")
        text = command if isinstance(command, str) else " ".join(map(str, command or []))
        managed = {key for key in (step.get("env") or {}) if key.upper() in {"PATH", "NATIVE_OHOS_SDK", "DEVECO_SDK_HOME"}}
        if not step.get("inline_env") and (INLINE_ENV_RE.search(text) or managed):
            problems.append(
                f"step {name} sets PATH/NATIVE_OHOS_SDK/DEVECO_SDK_HOME itself; these come from environment.tsv "
                "(env_probe.py) and are applied to every step. Fix the environment and rerun env_probe.py instead, or mark "
                "the step \"inline_env\": true with a reason in the plan")
        if (DEVECOCLI_BUILD_RE.search(text) or HVIGOR_RE.search(text)) and "devecocli_build.py" not in text:
            problems.append(
                f"step {name} calls devecocli build or hvigor directly; use: python <skill>/scripts/devecocli_build.py "
                "--project <ohos project> (it checks the hvigor daemon is off, KI-004, and reports the HAP)")
        if OHOSDEPLOY_RE.search(text):
            problems.append(
                f"step {name} runs make ohosdeploy, which only echoes the openharmonydeployqt call (KI-019); "
                "use: python <skill>/scripts/deploy_qt_libs.py --project <ohos project> --library <build>/lib<App>.so")
    return problems

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


def is_hap_check(step: dict) -> bool:
    command = step["command"] if isinstance(step["command"], str) else " ".join(map(str, step["command"]))
    return "hap_check.py" in command


def hap_check_report(step: dict, output: Path) -> dict | None:
    """The JSON report a ``hap_check.py`` step printed (None when it printed none)."""
    text = (output / step["stdout_path"]).read_text(encoding="utf-8", errors="replace").lstrip()
    try:
        report, _ = json.JSONDecoder().raw_decode(text)
    except ValueError:
        return None
    return report if isinstance(report, dict) and report.get("hap") else None


def record_hap_check(root: Path, output: Path, step: dict, problem: str = "") -> str:
    """Overwrite the device-runs.tsv row with a ``hap_check.py`` step's result; returns a note."""
    import ledger
    from phase_gate import no_device

    report = hap_check_report(step, output)
    passed = step["status"] == "passed" and report is not None and not report.get("problems")
    if report and report.get("app_library") == ENVELOPE_LIBRARY:
        return f"device-runs.tsv not written: the project still packs the envelope app ({ENVELOPE_LIBRARY})"
    try:
        batch = output.relative_to(root).as_posix()
    except ValueError:
        batch = str(output)
    hap = str(Path(report["hap"]).resolve()) if report else "none"
    if passed:
        status = "no-device" if no_device(root) else "checked"
        evidence = f"batch {batch}: hap_check.py passed; " + ("signed" if report.get("signed") else "unsigned")
    else:
        status = "hap-failed"
        first = ((report or {}).get("problems") or [step.get("first_error") or f"exit={step.get('exit_code')}"])[0]
        evidence = f"batch {batch}: hap_check.py failed: {one_line(first)[:200]}" + (f"; problem {problem}" if problem else "")
    try:
        ledger.record_hap(root, {"hap": f"{hap} ({(report or {}).get('bundle_name') or 'unknown'})",
                                 "status": status, "evidence": evidence})
    except SystemExit as error:  # ledger.LedgerError: an older device-runs.tsv header
        return f"device-runs.tsv not written: {error}"
    return f"device-runs.tsv {status}: {hap}"


def one_line(value: object) -> str:
    return " ".join(str(value).split())


def archive_previous_attempt(output: Path, rows: list[dict[str, str]]) -> Path | None:
    """Move an earlier attempt's logs out of the way instead of overwriting them.

    Problem rows whose ``reproduce`` pointed at the moved logs are repointed in
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
            try:
                shutil.move(str(path), str(archive / path.name))
            except OSError:
                # A leftover process (an hdc server started by devecocli) may still hold the log open on
                # Windows: keep a copy in the archive and leave the original in place.
                try:
                    shutil.copy2(str(path), str(archive / path.name))
                except OSError:
                    pass
    for row in rows:
        for moved in archive.iterdir():
            row["reproduce"] = row.get("reproduce", "").replace(str(output / moved.name), str(moved))
    return archive


def main() -> int:
    ohos_env.utf8_console()
    parser = argparse.ArgumentParser(description=__doc__ + "\n" + PLAN_SCHEMA, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("plan", type=Path, help="JSON batch plan")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cwd", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=1800, help="default total timeout per step (s)")
    parser.add_argument("--idle-timeout", type=float, default=600,
                        help="default idle timeout per step: kill when no output grows for this long (0 = off)")
    parser.add_argument("--tasks", default="", help="TASK-* rows this batch works on (comma-separated)")
    parser.add_argument("--diag", default=None, help="DIAG-* problem this batch retries (its row is updated, not a new one)")
    parser.add_argument("--stage", default="build", choices=STAGES,
                        help="pipeline stage a failure is recorded under (vocab.STAGES)")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    root = output.parent.parent
    if output.parent.name != "batches" or not (root / "STATE.md").is_file():
        raise SystemExit(
            f"ERROR: --output-dir must be <container>/migration/ohos/batches/<name> of an initialized migration; "
            f"{root} has no STATE.md. Run init_migration.py --target <app> --template-root "
            "<skill>/assets/templates/migration/ohos first.")
    # Every batch builds the application: the decisions gate must have passed.
    _, open_phases = open_phases_before((root / "STATE.md").read_text(encoding="utf-8", errors="replace"), "tasks")
    if open_phases:
        raise SystemExit(
            f"ERROR: a {args.stage} batch needs these phase gates to pass first: {', '.join(open_phases)}. "
            f"Run validate_ledgers.py {root} --phase {open_phases[0]} and finish that phase; "
            "do not edit Current phase or Progress by hand.")
    plan_text = args.plan.read_text(encoding="utf-8-sig")
    plan = json.loads(plan_text)
    steps = plan.get("steps", [])
    if not isinstance(steps, list) or not steps:
        raise SystemExit("batch plan must contain a non-empty steps list")
    for index, step in enumerate(steps, 1):
        if not step.get("command"):
            raise SystemExit(f"step {step.get('name') or index} has no command "
                             "(key 'command': a shell string or an argv list)")
    problems = plan_problems(steps)
    if problems:
        raise SystemExit("ERROR: batch plan rejected:\n- " + "\n- ".join(problems))
    if "artifacts" in plan:
        print("note: the plan's \"artifacts\" is no longer used; the hap_check.py step records the HAP in device-runs.tsv")
    profile_file = root / ohos_env.ENV_PROFILE
    profile = ohos_env.load_profile(profile_file)
    if profile is None:
        raise SystemExit(
            f"ERROR: {profile_file} is missing or empty. Run env_probe.py --migration-root {root} first: "
            "every batch runs with that environment.")
    base_env = ohos_env.apply_profile(profile)
    # Scripts run by a step (deploy_qt_libs.py, devecocli_build.py, hap_check.py, device_run.py) find the
    # same environment table through this variable, also for an output project outside the application tree.
    base_env[ohos_env.ENV_PROFILE_VAR] = str(profile_file.resolve())
    output.mkdir(parents=True, exist_ok=True)
    base_cwd = (args.cwd or Path.cwd()).resolve()

    diagnostics_file = root / "diagnostics.tsv"
    previous = read_diagnostics(diagnostics_file)
    pending = uncaused(previous)
    if pending:
        raise SystemExit(
            f"write the cause of {', '.join(pending)} first: record_diagnostic.py {diagnostics_file} --id {pending[0]} "
            "--cause ... --fix <the change to make>")
    if args.diag and not any(row.get("id") == args.diag and row.get("status", "").strip() == "open" for row in previous):
        raise SystemExit(f"--diag {args.diag} is not an open problem in diagnostics.tsv")
    archived = archive_previous_attempt(output, previous)
    if archived:
        print(f"previous attempt in {output} kept under {archived}")
        write_diagnostics(diagnostics_file, previous)

    summary = []
    hap_notes: list[str] = []
    hap_failed: dict | None = None
    issues = known_issues.load()
    for index, step in enumerate(steps, 1):
        name = str(step.get("name") or f"step-{index}")
        command = step.get("command")
        argv = command if isinstance(command, str) else [str(value) for value in command]
        shell_name = str(step.get("shell", plan.get("shell", ""))).lower()
        if isinstance(command, str) and SHELLS.get(shell_name):
            # Strings run in cmd.exe (Windows) or /bin/sh by default; "shell": "powershell" for PowerShell syntax.
            argv = SHELLS[shell_name] + [command]
        cwd = (base_cwd / step["cwd"]).resolve() if step.get("cwd") else base_cwd
        stem = f"{index:02d}-{''.join(c if c.isalnum() else '_' for c in name)[:48]}"
        env = ohos_env.merge_env(dict(base_env), step.get("env") or {})
        watch = [Path(item) if os.path.isabs(str(item)) else cwd / str(item) for item in step.get("watch", [])]
        idle = step.get("idle_timeout", plan.get("idle_timeout", args.idle_timeout))
        result = ohos_env.run_watched(
            argv, cwd=cwd, env=env,
            stdout_path=output / f"{stem}.stdout.log", stderr_path=output / f"{stem}.stderr.log",
            timeout=float(step.get("timeout", plan.get("timeout", args.timeout))),
            idle_timeout=float(idle) if idle else None, watch_files=watch,
        )
        stdout, stderr = result.stdout(), result.stderr()
        row = {"name": name, "command": command, "cwd": str(cwd),
               "status": result.status, "exit_code": result.exit_code,
               "duration_sec": result.duration_sec,
               "stdout_path": f"{stem}.stdout.log",
               "stderr_path": f"{stem}.stderr.log"}
        if result.status != "passed":
            row["first_error"] = first_error_line(stdout, stderr) or result.reason
            row["error_count"], row["errors"] = error_lines(stdout, stderr)
            if result.reason:
                row["timeout_reason"] = result.reason
            text = "\n".join([row["first_error"], *row["errors"], ohos_env.tail(stdout, 200), ohos_env.tail(stderr, 200)]
                             + [ohos_env.tail(ohos_env._read(path), 200) for path in watch])
            hits = known_issues.match(text, argv if isinstance(argv, str) else " ".join(argv), issues)
            if hits:
                row["known_issues"] = [{"id": hit["id"], "fix": hit["fix"]} for hit in hits]
                row["_hit"] = hits[0]
            row["log_tail"] = ohos_env.tail(stderr if stderr.strip() else stdout, 15)
        summary.append(row)
        if is_hap_check(row):
            # Written right away: a device_run.py --record step later in this batch reads the row.
            if row["status"] == "passed":
                hap_notes.append(record_hap_check(root, output, row))
            else:
                hap_failed = row  # written below, naming its diagnostics problem
        if result.status != "passed" and not step.get("continue_on_failure", False):
            break
    hit_of = {row["name"]: row.pop("_hit") for row in summary if "_hit" in row}
    result_doc = {"steps": summary}
    (output / "batch-summary.json").write_text(json.dumps(result_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result_doc, ensure_ascii=False, indent=2))
    for note in hap_notes:
        print(note)
    passed = bool(summary) and all(row["status"] == "passed" for row in summary)

    failed = next((row for row in summary if row["status"] != "passed"), None)
    rows = previous
    problem_id = ""
    if failed:
        hit = hit_of.get(failed["name"])
        command = failed["command"] if isinstance(failed["command"], str) else " ".join(map(str, failed["command"]))
        seen = {
            "location": f"{args.stage}: step {failed['name']}",
            "symptom": one_line(failed.get("first_error") or f"step {failed['name']} exit={failed['exit_code']}")
            + (f" ({failed['timeout_reason']})" if failed.get("timeout_reason") else ""),
            "reproduce": one_line(f"{command} (cwd {failed['cwd']}); log: {output / failed['stdout_path']}"),
        }
        row = next((item for item in rows if item.get("id") == args.diag), None) if args.diag else None
        if row is None:
            row = {"id": next_diagnostic_id(rows), "status": "open",
                   "cause": f"{hit['id']}: {hit['root_cause']}" if hit else "",
                   "fix": hit["fix"] if hit else ""}
            rows.append(row)
            print(f"problem {row['id']} recorded (open)"
                  + ("" if hit else f"; write its cause before the next batch: record_diagnostic.py "
                     f"<diagnostics.tsv> --id {row['id']} --cause ... --fix ..."))
        else:
            print(f"{row['id']} still open: the retry failed again (after three failed fixes set it blocked and ask the user)")
        row.update(seen)
        write_diagnostics(diagnostics_file, rows)
        problem_id = row["id"] if failed is hap_failed else ""
        if hit:
            print(f"known issue {hit['id']}: {hit['root_cause']}\n  fix: {hit['fix']}")
    elif args.diag:
        row = next(item for item in rows if item.get("id") == args.diag)
        if row.get("cause", "").strip() and row.get("fix", "").strip():
            row["status"] = "fixed"
            write_diagnostics(diagnostics_file, rows)
            print(f"{args.diag} fixed: {row['fix']}")
        else:
            print(f"{args.diag} passed this retry; record what fixed it: record_diagnostic.py <diagnostics.tsv> "
                  f"--id {args.diag} --cause ... --fix ... --status fixed")
    if hap_failed is not None:
        print(record_hap_check(root, output, hap_failed, problem_id))
    import ledger
    queue_ids = [item.strip() for item in args.tasks.split(",") if item.strip()]
    touched = ledger.note_batch(root, queue_ids, output.name, not failed)
    if touched:
        print(f"TASK rows updated with this batch: {', '.join(touched)}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

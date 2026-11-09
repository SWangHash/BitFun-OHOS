#!/usr/bin/env python3
"""Sign, install and launch the app on a device through devecocli, the same way in every phase.

The environment smoke test (phase 1) and the application's device rounds use
this one script, so a device problem solved in phase 1 is solved for good and
no batch plan needs hand-written device commands::

    python scripts/device_run.py sign --project <ohos project> [--product default]
    python scripts/device_run.py run --project <ohos project> [--product default] [--ability QAbility]
        [--wait 6] [--migration-root <root> --record]

``sign`` runs ``devecocli signature generate`` in the project (it writes the
signing config into build-profile.json5; ``devecocli auth login`` must have
been done once by the user). ``run``:

1. finds the device with ``devecocli device list`` (exit 3 when none is
   connected); on a HarmonyOS PC the PC itself is the device;
2. checks the entry module's HAP is signed (an unsigned HAP cannot be
   installed, KI-017) and reads the bundle name from its module.json;
3. ``devecocli run --skip-build --uninstall --module entry`` installs the built
   HAP and starts its ability (a locked screen, 10106102, is KI-022);
4. after ``--wait`` seconds, ``devecocli log --bundle-name`` must still find
   the process; its hilog is scanned for crash/load-failure lines, and a crash
   log newer than the one before the launch (``devecocli log --crash``) fails
   the run.

The result is JSON; exit 0 passed, 1 failed, 3 no device. ``device-runs.tsv``
has one row, the application HAP's latest result, which ``batch_checks.py``
writes when its ``hap_check.py`` step ends. With ``--record`` a passed run sets
that row to ``run``, provided the row names this HAP and its hap_check passed
(``checked`` or ``no-device``); otherwise nothing is recorded. A failed run is a
problem in ``diagnostics.tsv`` (the batch records it) and leaves the row as it
is; a run of the envelope app (the project's ``APP_LIBRARY_NAME`` is still
``libQtHarmonyApp.so``) is not recorded either.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import zipfile
from pathlib import Path

import ohos_env

LOCKED_RE = re.compile(r"10106102|screen is locked", re.IGNORECASE)
# The skill's envelope app (template_patch.py --envelope); its runs prove the pipeline, not the application.
ENVELOPE_LIBRARY = "libQtHarmonyApp.so"
CRASH_RE = re.compile(r"cppcrash|jscrash|SIGSEGV|SIGABRT|Fatal signal|dlopen failed|cannot locate symbol|"
                      r"library \"?[\w.+-]+\"? not found|qFatal|Aborted", re.IGNORECASE)


def find_profile(project: Path | None, explicit: Path | None) -> dict | None:
    return ohos_env.app_profile(project, explicit)[0]


ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
NO_PROCESS_RE = re.compile(r"No running process found", re.IGNORECASE)
CRASH_FILE_RE = re.compile(r"Latest Crash Log File:\s*(\S+)")


class Cli:
    """Runs devecocli commands with their output logged to ``log_dir``."""

    def __init__(self, tool: str, env: dict[str, str], log_dir: Path):
        self.tool, self.env, self.log_dir = tool, env, log_dir
        self.count = 0

    def __call__(self, *args: str, cwd: Path | None = None, timeout: float = 120) -> tuple[int | None, str]:
        self.count += 1
        name = f"{self.count:02d}-{re.sub(r'[^a-z0-9]+', '-', ' '.join(args[:2]).lower())[:40]}"
        result = ohos_env.run_watched([self.tool, *args], cwd=cwd or self.log_dir, env=self.env,
                                      stdout_path=self.log_dir / f"{name}.out.log",
                                      stderr_path=self.log_dir / f"{name}.err.log",
                                      timeout=timeout, idle_timeout=None)
        return result.exit_code, ANSI_RE.sub("", result.stdout() + result.stderr()).strip()


def list_devices(tool: str, env: dict[str, str], log_dir: Path) -> list[str]:
    """Serials of the connected devices (``devecocli device list``: a table under a dashed rule)."""
    log_dir.mkdir(parents=True, exist_ok=True)
    code, out = Cli(tool, env, log_dir)("device", "list", timeout=60)
    if code != 0:
        return []
    lines = out.splitlines()
    rule = next((i for i, line in enumerate(lines) if re.fullmatch(r"-+(\s+-+)*", line.strip())), None)
    if rule is None:
        return []  # "No active devices."
    rows = [re.split(r"\s{2,}", line.strip()) for line in lines[rule + 1:] if line.strip()]
    return [row[1] for row in rows if len(row) > 1]


def hap_identity(hap: Path) -> tuple[str | None, str | None]:
    """(bundle name, main ability) from the HAP's module.json."""
    try:
        with zipfile.ZipFile(hap) as archive:
            name = next((item for item in archive.namelist() if item.endswith("module.json")), None)
            data = json.loads(archive.read(name).decode("utf-8")) if name else {}
    except (OSError, ValueError, zipfile.BadZipFile, KeyError):
        return None, None
    module = data.get("module") or {}
    abilities = module.get("abilities") or []
    ability = module.get("mainElement") or (abilities[0].get("name") if abilities else None)
    return (data.get("app") or {}).get("bundleName"), ability


def cmd_sign(args) -> int:
    project = args.project.resolve()
    profile = find_profile(project, args.env_profile)
    env = ohos_env.apply_profile(profile)
    tool = ohos_env.devecocli_path(profile, env)
    if not tool:
        return finish({"status": "failed", "problems": [
            "devecocli not found (environment.tsv devecocli row, PATH); install the DevEco CLI and rerun env_probe.py"]}, 1)
    log_dir = project / ".hvigor" / "bitfun-sign"
    result = ohos_env.run_watched([tool, "signature", "generate", "--product", args.product], cwd=project, env=env,
                                  stdout_path=log_dir / "sign.out.log", stderr_path=log_dir / "sign.err.log",
                                  timeout=args.timeout, idle_timeout=None)
    output = result.stdout() + result.stderr()
    ok = result.status == "passed" and "completed successfully" in output.lower()
    problems = []
    if not ok:
        hint = ("not logged in: the user runs `devecocli auth login` once" if re.search(r"log ?in|auth", output, re.I)
                else ohos_env.tail(output, 8))
        problems.append(f"devecocli signature generate failed ({result.status}): {hint}")
    return finish({"status": "signed" if ok else "failed", "problems": problems, "project": str(project),
                   "log": str(result.stdout_path)}, 0 if ok else 1)


def cmd_run(args) -> int:
    project = args.project.resolve()
    profile = find_profile(project, args.env_profile)
    env = ohos_env.apply_profile(profile)
    hap = ohos_env.pick_entry_hap(path for path in project.glob("**/build/**/outputs/**/*.hap") if path.is_file())
    report: dict = {"hap": str(hap) if hap else None, "steps": {}, "problems": [], "notes": []}
    if not hap:
        report["problems"].append("no HAP found: build it with devecocli_build.py first")
        return finish({"status": "failed", **report}, 1)
    if not ohos_env.hap_is_signed(hap):
        report["problems"].append(f"[KI-017] {hap.name} carries no signing block and cannot be installed: "
                                  "device_run.py sign, then rebuild (devecocli_build.py)")
        return finish({"status": "failed", **report}, 1)
    tool = ohos_env.devecocli_path(profile, env)
    if not tool:
        report["problems"].append("devecocli not found: run env_probe.py (devecocli row)")
        return finish({"status": "failed", **report}, 1)
    bundle, _ = hap_identity(hap)
    report["bundle_name"] = bundle
    if not bundle:
        report["problems"].append(f"bundle name unknown: {hap.name} has no readable module.json")
        return finish({"status": "failed", **report}, 1)
    log_dir = (args.log_dir or project / ".hvigor" / "bitfun-device").resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    cli = Cli(tool, env, log_dir)

    target: list[str] = []
    if ohos_env.IS_HARMONYOS:
        report["device"] = "this HarmonyOS PC"
    else:
        serials = list_devices(tool, env, log_dir)
        if not serials:
            report["problems"].append("no device connected (devecocli device list): connect and unlock a device with "
                                      "developer mode; without a device install/launch stay unverified (env_probe.py "
                                      "records it)")
            return finish({"status": "no-device", **report}, 3)
        target = ["--device", serials[0]]
        report["device"] = serials[0][:4] + "…" + serials[0][-2:] if len(serials[0]) > 8 else "…"

    def latest_crash() -> str:
        _, out = cli("log", "--crash", "--bundle-name", bundle, *target, timeout=120)
        match = CRASH_FILE_RE.search(out)
        return match.group(1) if match else ""

    crash_before = latest_crash()
    code, out = cli("run", "--skip-build", "--uninstall", "--module", "entry", "--product", args.product, *target,
                    *(["--ability", args.ability] if args.ability else []), cwd=project, timeout=600)
    report["steps"]["install_launch"] = "passed" if code == 0 else f"failed: {ohos_env.tail(out, 3)[:300]}"
    if code != 0:
        if LOCKED_RE.search(out):
            report["problems"].append("[KI-022] the device screen is locked (10106102): the user unlocks it "
                                      "(developer mode stays on), then rerun device_run.py")
        elif re.search(r"sign|certificate|profile", out, re.I):
            report["problems"].append(f"[KI-017] install rejected the signature/profile: {ohos_env.tail(out, 2)[:200]}")
        else:
            report["problems"].append(f"devecocli run failed: {ohos_env.tail(out, 3)[:300]}")
        return finish({"status": "failed", **report}, 1)

    time.sleep(max(0.0, args.wait))
    code, log = cli("log", "--bundle-name", bundle, *target, timeout=120)
    alive = code == 0 and not NO_PROCESS_RE.search(log)
    report["steps"]["process"] = (f"passed: running after {args.wait:g}s" if alive
                                  else "failed: process not running" if NO_PROCESS_RE.search(log)
                                  else f"failed: devecocli log: {ohos_env.tail(log, 2)[:200]}")
    crash = [row.strip()[:240] for row in log.splitlines() if CRASH_RE.search(row)][:20] if alive else []
    report["steps"]["log"] = "passed: no crash or load-failure lines" if not crash else f"failed: {len(crash)} crash lines"
    report["crash_lines"] = crash
    crash_after = latest_crash()
    if crash_after and crash_after != crash_before:
        report["steps"]["crash_log"] = f"failed: new crash log {crash_after}"
        report["problems"].append(f"the app crashed: new crash log {crash_after} (devecocli log --crash "
                                  f"--bundle-name {bundle})")
    if not alive:
        report["problems"].append("the process is gone after launch: the app crashed or exited; see the crash log and "
                                  "hilog (a missing library shows as dlopen failed)" if NO_PROCESS_RE.search(log)
                                  else f"devecocli log failed: {ohos_env.tail(log, 2)[:200]}")
    if crash:
        report["problems"].append(f"hilog has {len(crash)} crash/load-failure line(s) for the app")
    passed = not report["problems"]
    report["status"] = "passed" if passed else "failed"
    report["logs"] = str(log_dir)
    if args.record and args.migration_root and passed:
        if envelope_project(project):
            report["notes"].append(f"not recorded: the project still runs the envelope app ({ENVELOPE_LIBRARY}); "
                                   "device-runs.tsv holds the application HAP only")
        else:
            try:
                ledger_row, note = record(args.migration_root, report)
            except SystemExit as error:  # ledger.LedgerError: unreadable or older device-runs.tsv
                ledger_row, note = None, f"not recorded: {error}"
            if ledger_row:
                report["ledger_row"] = ledger_row
            else:
                report["notes"].append(note)
    return finish(report, 0 if passed else 1)


def envelope_project(project: Path | None) -> bool:
    """The output project still packs the envelope app (template_patch.py --envelope), not the application."""
    from hap_check import app_library_from

    return bool(project) and app_library_from(project) == ENVELOPE_LIBRARY


def hap_path(cell: str) -> str:
    """The path part of a device-runs.tsv ``hap`` cell (``<path> (<bundle>)``)."""
    return cell.rsplit(" (", 1)[0].strip() if cell.rstrip().endswith(")") else cell.strip()


def record(root: Path, report: dict) -> tuple[str | None, str]:
    """Set the device-runs.tsv row of this HAP to ``run``; returns (row id or None, note)."""
    import ledger

    root = root.resolve()
    row = ledger.read_hap_row(root)
    if row is None:
        return None, ("not recorded: device-runs.tsv has no HAP row; package through batch_checks.py "
                      "with a hap_check.py step first")
    if row.get("status") == "hap-failed":
        return None, "not recorded: the HAP in device-runs.tsv failed hap_check.py; fix it and rerun the packaging batch"
    if Path(hap_path(row.get("hap", ""))).resolve() != Path(report["hap"]).resolve():
        return None, (f"not recorded: device-runs.tsv names {hap_path(row.get('hap', ''))}, not this HAP; check this "
                      "HAP with hap_check.py in a batch first")
    steps = report["steps"]
    run = "; ".join([re.sub(r"^passed:\s*", "", steps.get("process", "")),
                     "hilog clean of crash/load-failure lines, no new crash log", f"logs {report.get('logs')}"])
    checked = row.get("evidence", "").split("; device:")[0]
    return ledger.record_hap(root, {"hap": row.get("hap", ""), "status": "run",
                                    "evidence": f"{checked}; device: {run}"}), ""


def finish(report: dict, code: int) -> int:
    print(json.dumps(report, ensure_ascii=False, indent=2))
    for problem in report.get("problems", []):
        print(f"problem: {problem}", file=sys.stderr)
    return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("sign", help="devecocli signature generate in the project")
    s.add_argument("--project", type=Path, required=True)
    s.add_argument("--product", default="default")
    s.add_argument("--env-profile", type=Path)
    s.add_argument("--timeout", type=float, default=300)
    s.set_defaults(func=cmd_sign)
    r = sub.add_parser("run", help="install, launch and check the app on the connected device")
    r.add_argument("--project", type=Path, required=True)
    r.add_argument("--product", default="default")
    r.add_argument("--ability", help="ability to start (default: the entry module's mainElement)")
    r.add_argument("--wait", type=float, default=6)
    r.add_argument("--env-profile", type=Path)
    r.add_argument("--log-dir", type=Path)
    r.add_argument("--migration-root", type=Path)
    r.add_argument("--record", action="store_true",
                   help="set the device-runs.tsv row of this HAP to run when the run passed (needs --migration-root)")
    r.set_defaults(func=cmd_run)
    args = parser.parse_args(argv)
    ohos_env.utf8_console()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

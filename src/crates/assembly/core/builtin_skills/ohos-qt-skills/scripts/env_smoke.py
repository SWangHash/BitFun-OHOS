#!/usr/bin/env python3
"""Environment smoke test: the whole application pipeline on a hello app, once per machine.

Phase 1 proves the environment with exactly the tools and steps the
application uses later, so an environment problem is met and fixed here and
never again during the migration:

1. ``template_patch.py`` materializes the template with every known edit and
   the Qt envelope app (CMake route inside hvigor);
2. a Qt Widgets hello app (AUTOMOC) is configured with qmake for OHOS and
   audited (``preflight_build_files.configured_audit``), then built with the
   profile's make: the qmake route of a real application;
3. ``deploy_qt_libs.py`` deploys it with its Qt closure and switches
   ``APP_LIBRARY_NAME``; ``devecocli_build.py`` packs the HAP; ``hap_check.py``
   checks it;
4. runtime, when a device is connected (always on a HarmonyOS PC, which is
   its own device): ``device_run.py sign`` (CLI self-signing, needs
   ``devecocli auth login`` once), rebuild, then ``device_run.py run``
   installs, launches and checks the process, hilog and crash logs.

Every command runs with the environment table's ``command_env`` through
``ohos_env.run_watched`` (the batch runner), with ``$OHOS_QT_ENV_PROFILE`` set
for the scripts it starts. Every run builds afresh in ``<short_cache_dir>/smoke``
(the smoke test runs once per migration, and again only after an environment
fix). ``--no-device`` skips the runtime, ``--runtime-only`` runs only the
device part on the last build there (a device connected, or signing fixed,
after the smoke test). A HAP counts as signed only when it carries a signing
block (``ohos_env.hap_is_signed``).

    python scripts/env_smoke.py --migration-root <container>/migration/ohos [--no-device | --runtime-only]

With ``--migration-root`` it writes ``<root>/env-smoke.json``: the phase 1 gate
needs it passed and, when environment.tsv reports a connected device, its
``runtime`` passed as well. The hello app's device run is
never the ``device-runs.tsv`` row: that ledger holds the application HAP. A failure prints the
stage, its first errors and the matching known issues. A failing stage is an
environment problem: fix it with env_probe.py (or the user action it names,
such as ``devecocli auth login`` or unlocking the device) and rerun; never
edit environment.tsv or a batch plan by hand. When the environment changes (new
SDK, new DevEco, moved template), rerun env_probe.py and then this script.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
from datetime import datetime
from pathlib import Path

import device_run
import hap_check
import known_issues
import ohos_env
import preflight_build_files
import template_patch
from vocab import ENV_BLOCKING_STATUSES

SCRIPTS = Path(__file__).resolve().parent
SKILL = SCRIPTS.parent
ASSETS = SKILL / "assets" / "smoke"
SMOKE_BUNDLE = "com.bitfun.qtsmoke"
QMAKE_TARGET = "qtsmoke"
SMOKE_LIBRARY = f"lib{QMAKE_TARGET}.so"
BUILD_STAGES = ("template", "qmake-configure", "configured-audit", "make", "deploy", "build", "hap-check")


def _force_remove(function, path, _info) -> None:
    try:
        os.chmod(path, stat.S_IWRITE)
        function(path)
    except OSError:
        pass


class Smoke:
    def __init__(self, base: Path, profile: dict, profile_file: Path, timeout: float):
        self.base, self.profile, self.profile_file, self.timeout = base, profile, profile_file, timeout
        self.env = ohos_env.apply_profile(profile)
        self.env["PYTHONIOENCODING"] = "utf-8"
        self.env[ohos_env.ENV_PROFILE_VAR] = str(Path(profile_file).resolve())
        self.logs = base / "logs"
        self.project = base / "project"
        self.stages: dict[str, dict] = {}

    def run(self, stage: str, command: list[str], cwd: Path, timeout: float | None = None) -> ohos_env.RunResult:
        return ohos_env.run_watched(command, cwd=cwd, env=self.env,
                                    stdout_path=self.logs / f"{stage}.out.log", stderr_path=self.logs / f"{stage}.err.log",
                                    timeout=timeout or self.timeout, idle_timeout=600)

    def script(self, stage: str, name: str, *args: str, timeout: float | None = None) -> tuple[ohos_env.RunResult, dict]:
        result = self.run(stage, [ohos_env.python(), str(SCRIPTS / name), *args], SCRIPTS, timeout)
        text = result.stdout()
        try:
            data = json.loads(text[text.index("{"):text.rindex("}") + 1])
        except ValueError:
            data = {}
        return result, data

    def record(self, stage: str, ok: bool, detail: str, **extra) -> bool:
        self.stages[stage] = {"status": "passed" if ok else "failed", "detail": detail[:600], **extra}
        return ok

    def failure_text(self, result: ohos_env.RunResult) -> str:
        return ohos_env.tail(result.stderr() or result.stdout(), 6) or result.reason or f"exit {result.exit_code}"

    # ---------------------------------------------------------------- build stages
    def build(self) -> bool:
        profile = self.profile
        template = Path(p) if (p := ohos_env.profile_value(profile, "paths", "template")) else None
        qt_sdk = Path(p) if (p := ohos_env.profile_value(profile, "paths", "qt_sdk")) else None
        abi = profile.get("abi", "arm64-v8a")
        changes, problems = template_patch.apply(self.project, template, qt_sdk, abi, None, SMOKE_BUNDLE,
                                                 check=False, envelope=True, env_profile=self.profile_file)
        if not self.record("template", not problems, "; ".join(problems) or f"{len(changes)} edit(s)", changes=changes):
            return False
        source, build = self.base / "qmake-src", self.base / "qmake-build"
        source.mkdir(parents=True, exist_ok=True)
        build.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ASSETS / "qmake" / "qtsmoke.pro", source / "qtsmoke.pro")
        shutil.copy2(ASSETS / "main.cpp", source / "main.cpp")
        # Bare tool names on purpose: they must resolve through the injected PATH, as in every batch plan.
        result = self.run("qmake-configure", ["qmake", str(source / "qtsmoke.pro"), "-spec", "ohos-clang", "CONFIG+=release"],
                          build, 300)
        if not self.record("qmake-configure", result.status == "passed", self.failure_text(result) if result.status != "passed"
                           else "qmake -spec ohos-clang generated the Makefile"):
            return False
        modules = {module.lower() for module in profile.get("qt_modules", [])}
        audit = preflight_build_files.configured_audit(build, SMOKE_LIBRARY, modules)
        errors = [finding for finding in audit["findings"] if finding["severity"] == "error"]
        if not self.record("configured-audit", not errors,
                           "; ".join(f"{f['id']} {f['message']}" for f in errors) or f"main target {audit.get('main_target')}"):
            return False
        make = ohos_env.profile_value(profile, "paths", "make") or "make"
        result = self.run("make", [make, "-j8"], build, 1800)
        library = build / SMOKE_LIBRARY
        ok = result.status == "passed" and library.is_file()
        if not self.record("make", ok, self.failure_text(result) if not ok else f"built {SMOKE_LIBRARY}"):
            return False
        result, report = self.script("deploy", "deploy_qt_libs.py", "--project", str(self.project), "--library",
                                     str(library), "--env-profile", str(self.profile_file), timeout=900)
        ok = result.status == "passed" and report.get("status") == "deployed"
        if not self.record("deploy", ok, "; ".join(report.get("problems", [])) or self.failure_text(result) if not ok
                           else f"deployed {len(report.get('qt_libraries', []))} Qt libraries"):
            return False
        return self.package()

    def package(self) -> bool:
        result, report = self.script("build", "devecocli_build.py", "--project", str(self.project), "--env-profile",
                                     str(self.profile_file), "--timeout", str(self.timeout),
                                     "--log-dir", str(self.logs / "build"))
        haps = report.get("haps") or []
        ok = report.get("status") == "built" and bool(haps)
        if not self.record("build", ok, "; ".join(report.get("errors", [])[:3]) or self.failure_text(result) if not ok
                           else f"HAP {Path(str(haps[0])).name}", known_issues=report.get("known_issues", [])):
            return False
        hap = ohos_env.pick_entry_hap(haps)
        check = hap_check.check(hap, self.project, SMOKE_LIBRARY, self.profile.get("abi", "arm64-v8a"), SMOKE_BUNDLE, [],
                                hap_check.sysroot_libs(ohos_env.profile_value(self.profile, "paths", "native_sdk")))
        self.stages["hap-check"] = {"status": "passed" if not check["problems"] else "failed",
                                    "detail": "; ".join(check["problems"])[:600] or "clean", "hap": str(hap),
                                    "signed": bool(check.get("signed"))}
        return not check["problems"]

    # ---------------------------------------------------------------- runtime
    def device_connected(self) -> bool:
        if ohos_env.IS_HARMONYOS:
            return True
        tool = ohos_env.devecocli_path(self.profile, self.env)
        return bool(tool) and bool(device_run.list_devices(tool, self.env, self.logs / "device-list"))

    def runtime(self) -> dict:
        if not self.device_connected():
            return {"status": "not-covered", "reason": "no device connected (devecocli device list)"}
        signed = bool(self.stages.get("hap-check", {}).get("signed"))
        if not signed:
            result, report = self.script("sign", "device_run.py", "sign", "--project", str(self.project),
                                         "--env-profile", str(self.profile_file), timeout=300)
            if report.get("status") != "signed":
                return {"status": "not-covered",
                        "reason": "signing not possible: " + ("; ".join(report.get("problems", [])) or self.failure_text(result))}
            if not self.package() or not self.stages["hap-check"].get("signed"):
                return {"status": "failed", "reason": "rebuild after signing failed: " + self.stages["hap-check"]["detail"]
                        if self.stages.get("hap-check") else self.stages.get("build", {}).get("detail", "")}
        args = ["run", "--project", str(self.project), "--env-profile", str(self.profile_file),
                "--log-dir", str(self.logs / "device")]
        result, report = self.script("device", "device_run.py", *args, timeout=600)
        if result.exit_code == 3:
            return {"status": "not-covered", "reason": "no device connected"}
        if report.get("status") == "passed":
            return {"status": "passed", "steps": report.get("steps", {})}
        return {"status": "failed", "reason": "; ".join(report.get("problems", [])) or self.failure_text(result),
                "steps": report.get("steps", {})}


def capabilities(stages: dict, runtime: dict) -> list[str]:
    proven = [stage for stage in BUILD_STAGES if stages.get(stage, {}).get("status") == "passed"]
    if stages.get("hap-check", {}).get("signed"):
        proven.append("signed")
    if runtime.get("status") == "passed":
        proven += ["install", "launch"]
    return proven


def write_receipt(root: Path, result: dict) -> Path:
    """``<root>/env-smoke.json``: the latest smoke result."""
    receipt = {**result, "recorded_at": datetime.now().astimezone().isoformat(timespec="seconds")}
    path = root / ohos_env.ENV_SMOKE
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    from gate_state import refresh_progress
    refresh_progress(root)
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--migration-root", type=Path)
    parser.add_argument("--env-profile", type=Path)
    parser.add_argument("--no-device", action="store_true", help="skip signing and the device run")
    parser.add_argument("--runtime-only", action="store_true",
                        help="only sign, rebuild if needed and run the last hello app build on the device (a device "
                             "connected or signing fixed after the smoke test); needs a passing build")
    parser.add_argument("--timeout", type=float, default=1800)
    args = parser.parse_args(argv)
    ohos_env.utf8_console()
    if not args.migration_root and not args.env_profile:
        parser.error("--migration-root or --env-profile is required")
    root = args.migration_root.resolve() if args.migration_root else None
    profile_file = (args.env_profile or (root / ohos_env.ENV_PROFILE)).resolve()
    profile = ohos_env.load_profile(profile_file)
    if profile is None:
        print(f"ERROR: {profile_file} missing or empty; run env_probe.py first")
        return 1
    broken = [check for check in profile.get("checks", []) if check.get("status") in ENV_BLOCKING_STATUSES]
    if broken:
        print("ERROR: environment.tsv has broken or missing items: "
              + "; ".join(f"{c['id']} {c['status']}: {c['detail']}" for c in broken))
        return 1
    base = Path(profile.get("short_cache_dir") or ohos_env.machine_cache_dir()) / "smoke"
    result_file = base / "result.json"
    if args.runtime_only and args.no_device:
        parser.error("--runtime-only cannot be combined with --no-device")
    last = None
    if args.runtime_only:
        # The migration's receipt names the build directory (a locked directory on Windows may have
        # sent the build to a sibling); without a migration root, the default directory's result.
        source = root / ohos_env.ENV_SMOKE if root else result_file
        try:
            last = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            last = None
        if not last or last.get("build_status") != "passed":
            print("ERROR: no passing hello app build; run env_smoke.py without --runtime-only first")
            return 1
        base = Path(last.get("dir") or base)
        result_file = base / "result.json"
    smoke = Smoke(base, profile, profile_file, args.timeout)
    started = datetime.now().astimezone().isoformat(timespec="seconds")
    if last:
        smoke.stages = last.get("stages", {})
        built = True
        print(f"env smoke: device part only, on the last build in {base}")
    else:
        if base.exists():
            shutil.rmtree(base, onerror=_force_remove)
            if base.exists():
                # Something still holds a file (Windows): build into a fresh sibling directory.
                base = base.with_name(f"{base.name}-{int(datetime.now().timestamp())}")
                result_file = base / "result.json"
                smoke = Smoke(base, profile, profile_file, args.timeout)
        built = smoke.build()
    if not built:
        runtime = {"status": "not-covered", "reason": "the build stages failed"}
    elif args.no_device:
        runtime = {"status": "not-covered", "reason": "--no-device"}
    else:
        runtime = smoke.runtime()
    failed_stage = next((stage for stage, item in smoke.stages.items() if item.get("status") == "failed"), None)
    passed = built and runtime.get("status") != "failed"
    proven = capabilities(smoke.stages, runtime)
    if passed:
        summary = (f"pass: {', '.join(proven)}" + ("" if runtime.get("status") == "passed"
                                                    else f"; runtime not covered ({runtime.get('reason')})"))
    elif failed_stage:
        summary = f"failed at {failed_stage}: {smoke.stages[failed_stage]['detail']}"
    else:
        summary = f"failed at runtime: {runtime.get('reason')}"
    result = {
        "status": "passed" if passed else "failed", "build_status": "passed" if built else "failed",
        "dir": str(base), "started_at": started,
        "finished_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stages": smoke.stages, "runtime": runtime, "capabilities": proven, "summary": summary[:600],
    }
    base.mkdir(parents=True, exist_ok=True)
    result_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: result[name] for name in ("status", "summary", "capabilities", "runtime", "dir")},
                     ensure_ascii=False, indent=2))
    if failed_stage:
        hits = smoke.stages[failed_stage].get("known_issues") or [
            {"id": hit["id"], "fix": hit["fix"]} for hit in known_issues.match(smoke.stages[failed_stage]["detail"])]
        for item in hits:
            print(f"known issue {item['id']} fix: {item['fix']}")
        print(f"logs: {smoke.logs}; fix the environment with env_probe.py (never by hand) and rerun env_smoke.py")
    if root:
        print(f"receipt {write_receipt(root, result)} written")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())

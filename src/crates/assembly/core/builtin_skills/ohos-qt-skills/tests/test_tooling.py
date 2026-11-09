"""Tests of the migration tooling: environment profile, watched runner, build
driver, template patch, HAP check, preflight, known issues, ledger CLI,
closure wrapper, env smoke cache and the gate rules that depend on them.

Everything runs on fake toolchains in a temp directory (POSIX shell scripts
stand in for qmake/moc/clang/node), so the suite needs no Qt or DevEco
installation. Run with ``python -m unittest discover -s tests``.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import closure  # noqa: E402
import deploy_qt_libs  # noqa: E402
import device_run  # noqa: E402
import env_probe  # noqa: E402
import env_smoke  # noqa: E402
import hap_check  # noqa: E402
import init_migration  # noqa: E402
import known_issues  # noqa: E402
import ledger  # noqa: E402
import next_step  # noqa: E402
import ohos_env  # noqa: E402
import vocab  # noqa: E402
import gate_state  # noqa: E402
import phase_gate  # noqa: E402
import preflight_build_files as preflight  # noqa: E402
import template_patch  # noqa: E402
from test_external_features import make_app, pass_phases, write_env, write_tsv  # noqa: E402

read_tsv = phase_gate.read_rows

POSIX = os.name != "nt"
SCRIPTS = REPO / "scripts"


def run_script(name: str, *argv: str, env: dict | None = None, timeout: float = 120) -> tuple[int, str]:
    done = subprocess.run([sys.executable, str(SCRIPTS / name), *argv], capture_output=True, text=True,
                          timeout=timeout, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", **(env or {})})
    return done.returncode, done.stdout + done.stderr


def run_main(module, *argv: str) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            code = module.main(list(argv))
        except SystemExit as exit_:
            code = exit_.code if isinstance(exit_.code, int) else 1
            if not isinstance(exit_.code, int) and exit_.code:
                out.write(str(exit_.code))
    return code, out.getvalue()


def script(path: Path, body: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n" + body + "\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


# A fake devecocli. `build` runs @BUILD@ in the project; `run` fails with the locked-screen error when
# the file `locked` sits next to the script; `log --bundle-name` finds no process when `dead` does;
# `log --crash` names the file in `crash` (`run` writes a new one when `crashonrun` exists);
# `device list` prints one device unless `nodevice` exists.
FAKE_DEVECOCLI = r"""
here=$(dirname "$0")
case "$1 $2" in
  "build "*) @BUILD@
    ;;
  "signature generate") echo "// SIGNED" >> build-profile.json5; echo "Signature generation completed successfully.";;
  "device list") if [ -f "$here/nodevice" ]; then echo "  No active devices."; else
    printf 'Name       Serial           Kind    Device Type\n---------  ---------------  ------  -----------\n'
    printf 'Mate 60    SERIAL123456789  device  phone\n'; fi;;
  "run "*) [ -f "$here/crashonrun" ] && echo new-crash > "$here/crash"
    if [ -f "$here/locked" ]; then echo "error: failed to start ability. Error Code:10106102 The device screen is locked during the application launch"; exit 1; fi
    echo "Application 'com.example.app': start ability successfully.";;
  "log --crash") if [ -f "$here/crash" ]; then echo "--- Latest Crash Log File: $(cat "$here/crash") ---"; else echo "No crash logs found."; fi;;
  "log --bundle-name") if [ -f "$here/dead" ]; then echo "No running process found for bundle '$3'."; exit 1; fi
    echo "I QtForOhos: calling main";;
  *) echo "ok";;
esac
"""


def fake_devecocli(directory: Path, build: str = "echo built") -> Path:
    return script(directory / "devecocli", FAKE_DEVECOCLI.replace("@BUILD@", build))


def make_elf(needed: list[str]) -> bytes:
    """Minimal ELF64 LE shared object with a .dynstr and a .dynamic listing ``needed``."""
    dynstr = b"\0"
    offsets = []
    for name in needed:
        offsets.append(len(dynstr))
        dynstr += name.encode() + b"\0"
    dynamic = b"".join(struct.pack("<qQ", 1, off) for off in offsets) + struct.pack("<qQ", 0, 0)
    header_size, shentsize = 64, 64
    dynstr_off = header_size
    dynamic_off = dynstr_off + len(dynstr)
    shoff = dynamic_off + len(dynamic)
    ident = b"\x7fELF" + bytes([2, 1, 1]) + bytes(9)
    header = ident + struct.pack("<HHIQQQIHHHHHH", 3, 183, 1, 0, 0, shoff, 0, header_size, 0, 0, shentsize, 3, 0)
    null = bytes(shentsize)
    sec_dynstr = struct.pack("<IIQQQQIIQQ", 0, 3, 0, 0, dynstr_off, len(dynstr), 0, 0, 1, 0)
    sec_dynamic = struct.pack("<IIQQQQIIQQ", 0, 6, 0, 0, dynamic_off, len(dynamic), 1, 0, 8, 16)
    return header + dynstr + dynamic + null + sec_dynstr + sec_dynamic


SIGN_HAP = """
import sys
data = open(sys.argv[1], 'rb').read()
end = data.rfind(b'PK\\x05\\x06')
cd = int.from_bytes(data[end + 16:end + 20], 'little')
block = b'\\0' * 12 + b'HAP Sig Block 42' + (2).to_bytes(4, 'little')
open(sys.argv[1], 'wb').write(data[:cd] + block + data[cd:end + 16] + (cd + len(block)).to_bytes(4, 'little') + data[end + 20:])
"""


def sign_hap(path: Path) -> Path:
    """Insert a (fake) HAP signing block before the central directory, as hap-sign-tool does."""
    subprocess.run([sys.executable, "-c", SIGN_HAP, str(path)], check=True)
    return path


def make_hap(path: Path, libs: dict[str, bytes], extra: dict[str, bytes] | None = None, bundle: str = "com.example.app",
             signed: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in libs.items():
            archive.writestr(f"libs/arm64-v8a/{name}", data)
        for name, data in (extra or {}).items():
            archive.writestr(name, data)
        archive.writestr("module.json", json.dumps({"app": {"bundleName": bundle}}))
    return sign_hap(path) if signed else path


def make_template(root: Path, lazy: bool = True) -> Path:
    (root / "AppScope").mkdir(parents=True)
    (root / "AppScope" / "app.json5").write_text('{\n  "app": {\n    "bundleName": "com.ohos.ohosqttemplate",\n  }\n}\n', encoding="utf-8")
    (root / "build-profile.json5").write_text(
        '{\n  "app": {\n    "products": [\n      {\n        "name": "default",\n        "signingConfig": "default",\n'
        '        "compatibleSdkVersion": "5.0.0(12)",\n        "runtimeOS": "HarmonyOS",\n      }\n    ],\n  },\n}\n', encoding="utf-8")
    (root / "hvigorfile.ts").write_text("export default {}\n", encoding="utf-8")
    (root / "hvigor").mkdir()
    (root / "hvigor" / "hvigor-config.json5").write_text("{}\n", encoding="utf-8")
    entry = root / "entry"
    (entry / "src" / "main" / "ets" / "common").mkdir(parents=True)
    (entry / "src" / "main" / "module.json5").write_text("{}\n", encoding="utf-8")
    (entry / "build-profile.json5").write_text(
        '{\n  "apiType": \'stageMode\',\n  "buildOption": {\n    "externalNativeOptions": {\n'
        '      "path": "./src/main/cpp/CMakeLists.txt",\n      "arguments": "",\n      "cppFlags": "",\n'
        '      "abiFilters": [\n        "arm64-v8a",\n        "x86_64"\n      ]\n    }\n  }\n}\n', encoding="utf-8")
    (entry / "src" / "main" / "ets" / "common" / "QtAppConstants.ets").write_text(
        "export const APP_LIBRARY_NAME = 'libQtHarmonyApp.so';\nexport const LOG_DOMAIN = 0x0000;\n", encoding="utf-8")
    (entry / "src" / "main" / "ets" / "OhosExportModules.ts").write_text(
        ("export lazy import x from 'y';\n" if lazy else "export {}\n"), encoding="utf-8")
    (entry / "src" / "main" / "cpp").mkdir(parents=True)
    (entry / "src" / "main" / "cpp" / "CMakeLists.txt").write_text("project(x)\n", encoding="utf-8")
    return root


class Temp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tool-test-"))
        self.cache = self.tmp / "cache"
        self._env = {key: os.environ.get(key) for key in ("OHOS_QT_SKILLS_CACHE", "BITFUN_QT_MIGRATION_ROOT")}
        os.environ["OHOS_QT_SKILLS_CACHE"] = str(self.cache)
        os.environ.pop("BITFUN_QT_MIGRATION_ROOT", None)

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmp, ignore_errors=True)


# --------------------------------------------------------------------------- runner and profile

class RunnerTest(Temp):
    def test_apply_profile_prepends_path_and_sets_vars(self):
        env = ohos_env.apply_profile({"env": {"path_prepend": ["/x/bin", "/y"], "set": {"A": "1"}}},
                                     {"PATH": os.pathsep.join(["/usr/bin", "/y"])})
        self.assertEqual(env["PATH"].split(os.pathsep), ["/x/bin", "/y", "/usr/bin"])
        self.assertEqual(env["A"], "1")

    @unittest.skipUnless(POSIX, "uses /bin/sh")
    def test_idle_timeout_kills_the_whole_tree(self):
        marker = self.tmp / "child.pid"
        result = ohos_env.run_watched(
            f"sh -c 'sleep 60 & echo $! > {marker}; echo started; wait'", cwd=self.tmp, env=dict(os.environ),
            stdout_path=self.tmp / "o.log", stderr_path=self.tmp / "e.log", timeout=30, idle_timeout=1.5, poll=0.2)
        self.assertEqual(result.status, "timeout")
        self.assertIn("idle timeout", result.reason)
        self.assertIn("started", result.stdout())
        pid = int(marker.read_text().strip())
        time.sleep(0.3)
        with self.assertRaises(OSError):
            os.kill(pid, 0)

    @unittest.skipUnless(POSIX, "uses /bin/sh")
    def test_watched_file_growth_keeps_a_quiet_step_alive(self):
        log = self.tmp / "build.log"
        result = ohos_env.run_watched(
            f"sh -c 'for i in 1 2 3 4 5 6; do echo x >> {log}; sleep 0.4; done'", cwd=self.tmp, env=dict(os.environ),
            stdout_path=self.tmp / "o.log", stderr_path=self.tmp / "e.log", timeout=30, idle_timeout=1.0,
            watch_files=[log], poll=0.1)
        self.assertEqual(result.status, "passed")

    def test_total_timeout_and_exit_codes(self):
        quick = ohos_env.run_watched([sys.executable, "-c", "import sys; sys.exit(3)"], cwd=self.tmp, env=dict(os.environ),
                                     stdout_path=self.tmp / "a.log", stderr_path=self.tmp / "b.log")
        self.assertEqual((quick.status, quick.exit_code), ("failed", 3))
        slow = ohos_env.run_watched([sys.executable, "-c", "import time; print('x', flush=True); time.sleep(20)"],
                                    cwd=self.tmp, env=dict(os.environ), stdout_path=self.tmp / "c.log",
                                    stderr_path=self.tmp / "d.log", timeout=1.5, poll=0.2)
        self.assertEqual(slow.status, "timeout")
        self.assertIn("total timeout", slow.reason)


# --------------------------------------------------------------------------- known issues

class KnownIssueTest(unittest.TestCase):
    def test_signatures_cover_the_observed_failures(self):
        cases = {
            "KI-001": "Project ERROR: Cannot run target compiler 'D:/x y/clang++'. Output empty.",
            "KI-002": 'CMake Error: AUTOMOC for target X: Test run of "moc" executable "D:/q/bin/moc.exe" failed.',
            "KI-003": "ArkTS:ERROR 10705000 Current configuration does not support using lazy import.",
            "KI-005": r"[Errno 2] No such file or directory: 'C:\ws\ohos-libs\.staging\boost\lib\cmake\x.cmake'",
            "KI-007": "ohos_deployment skipped for Notepad--",
            "KI-008": "ld.lld: error: undefined symbol: Foo::~Foo()\n>>> referenced by moc_foo.cpp",
            "KI-009": "mingw32-make: *** No rule to make target '*.ui', needed by 'ui_x.h'.",
            "KI-011": "Project ERROR: Unknown module(s) in QT: xmlpatterns",
            "KI-012": "ld.lld: error: unable to find library -lgomp",
            "KI-004": "SystemExit: project/hvigor/hvigor-config.json5 does not set execution.daemon to false (KI-004)",
            "KI-020": "runtime_error: Failed to find llvm-readobj. Either set --sdk-dir argument or OHOS_SDK_DIR",
        }
        for wanted, text in cases.items():
            self.assertIn(wanted, [hit["id"] for hit in known_issues.match(text)], text)
        self.assertIn("KI-019", [h["id"] for h in known_issues.match(
            "Deploying current project using openharmonydeployqt", "mingw32-make ohosdeploy")])

    def test_match_reads_a_log_directory(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "nested").mkdir()
            (tmp / "01-qmake.stdout.log").write_text("Info: creating Makefile\n", encoding="utf-8")
            (tmp / "nested" / "02-make.stderr.log").write_text("ld.lld: error: unable to find library -lgomp\n", encoding="utf-8")
            code, out = run_main(known_issues, "match", "--log", str(tmp))
            self.assertEqual(code, 0, out)
            self.assertIn("KI-012", out)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_command_dependent_signature(self):
        self.assertIn("KI-017", [h["id"] for h in known_issues.match(
            "install failed: signature verification error", "devecocli run --skip-build")])
        self.assertNotIn("KI-017", [h["id"] for h in known_issues.match(
            "install failed: signature verification error", "qmake App.pro")])

    def test_candidates_lists_unmatched_fixed_rows(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            path = tmp / "diagnostics.tsv"
            write_tsv(path, [
                {"id": "DIAG-001", "location": "configure: qmake", "symptom": "Cannot run target compiler", "status": "fixed"},
                {"id": "DIAG-002", "location": "package: hvigor", "symptom": "brand new packaging trap", "status": "fixed"},
                {"id": "DIAG-003", "location": "build: make", "symptom": "still open trap", "status": "open"},
            ], ["id", "location", "symptom", "cause", "reproduce", "fix", "status"])
            code, out = run_main(known_issues, "candidates", str(path))
            self.assertIn("DIAG-002", out)
            self.assertNotIn("DIAG-001", out)
            self.assertNotIn("DIAG-003", out)
        finally:
            shutil.rmtree(tmp)


# --------------------------------------------------------------------------- batch_checks

class BatchTest(Temp):
    def setUp(self):
        super().setUp()
        self.root = make_app(self.tmp)
        self.out = self.root / "batches" / "out"
        pass_phases(self.root, "environment", "inventory", "decisions")
        write_env(self.root, path_prepend=[str(self.tmp / "tools")], env_set={"OHOS_PROBE_VALUE": "from-profile"})
        write_tsv(self.root / "tasks.tsv", [
            {"id": "TASK-001", "task": "build", "inventory_ids": "INV-001", "validation_ids": "VAL-001", "status": "planned",
             "evidence": "TODO"}])

    def batch(self, steps, *extra, **plan_keys):
        plan = self.tmp / "plan.json"
        plan.write_text(json.dumps({"steps": steps, **plan_keys}), encoding="utf-8")
        return run_script("batch_checks.py", str(plan), "--output-dir", str(self.out), "--cwd", str(self.tmp),
                          "--tasks", "TASK-001", *extra)

    def py(self, code: str) -> list[str]:
        return [sys.executable, "-c", code]

    def test_plan_rules(self):
        code, out = self.batch([{"name": "b", "command": "$env:PATH = 'C:/x;' + $env:PATH; make"}])
        self.assertNotEqual(code, 0)
        self.assertIn("environment.tsv", out)
        code, out = self.batch([{"name": "b", "command": ["devecocli", "build", "--build-mode", "debug"]}])
        self.assertIn("devecocli_build.py", out)
        code, out = self.batch([{"name": "b", "command": "node hvigor.js assembleApp --no-daemon"}])
        self.assertIn("devecocli_build.py", out)
        code, out = self.batch([{"name": "b", "command": "echo PATH=/x", "inline_env": True}])
        self.assertEqual(code, 0, out)

    def test_output_dir_names_the_migration(self):
        plan = self.tmp / "plan.json"
        plan.write_text(json.dumps({"steps": [{"name": "b", "command": self.py("print(1)")}]}), encoding="utf-8")
        code, out = run_script("batch_checks.py", str(plan), "--output-dir", str(self.tmp / "out"), "--cwd", str(self.tmp))
        self.assertNotEqual(code, 0)
        self.assertIn("--output-dir must be <container>/migration/ohos/batches/<name>", out)
        # The gates before the tasks phase must have passed.
        (self.root / "STATE.md").write_text((self.root / "STATE.md").read_text(encoding="utf-8")
                                            .replace("| passed |", "| planned |"), encoding="utf-8")
        code, out = self.batch([{"name": "b", "command": self.py("print(1)")}])
        self.assertNotEqual(code, 0)
        self.assertIn("needs these phase gates to pass first: environment", out)

    def test_profile_applied_and_required(self):
        code, out = self.batch([{"name": "probe", "command": self.py(
            "import os; print(os.environ['OHOS_PROBE_VALUE']); print(os.environ['PATH'].split(os.pathsep)[0])")}])
        self.assertEqual(code, 0, out)
        log = (self.out / "01-probe.stdout.log").read_text()
        self.assertIn("from-profile", log)
        self.assertIn(str(self.tmp / "tools"), log)
        (self.root / "environment.tsv").unlink()
        code, out = self.batch([{"name": "probe", "command": self.py("print(1)")}])
        self.assertIn("env_probe.py", out)

    def test_steps_get_the_env_profile_and_problems_name_the_stage(self):
        code, out = self.batch([{"name": "probe", "command": self.py(
            "import os; print('profile=' + os.environ['OHOS_QT_ENV_PROFILE'])")}], "--stage", "package")
        self.assertEqual(code, 0, out)
        log = (self.out / "01-probe.stdout.log").read_text()
        self.assertIn("profile=" + str((self.root / "environment.tsv").resolve()), log)
        self.assertEqual([r["id"] for r in read_tsv(self.root / "diagnostics.tsv")], ["DIAG-001"])  # a pass writes no row
        code, out = self.batch([{"name": "pack", "command": self.py("import sys; print('Error: no HAP'); sys.exit(2)")}],
                               "--stage", "package")
        self.assertEqual(code, 1, out)
        row = read_tsv(self.root / "diagnostics.tsv")[-1]
        self.assertEqual((row["location"], row["symptom"], row["status"]), ("package: step pack", "Error: no HAP", "open"))
        self.assertIn("log: " + str(self.out / "01-pack.stdout.log"), row["reproduce"])

    def test_argv_steps_resolve_tools_on_the_profile_path(self):
        script(self.tmp / "tools" / "fake-qmake", "echo resolved-through-profile")
        code, out = self.batch([{"name": "q", "command": ["fake-qmake"]}])
        self.assertEqual(code, 0, out)
        self.assertIn("resolved-through-profile", (self.out / "01-q.stdout.log").read_text())

    def test_known_issue_gives_cause_and_retry_closes_the_problem(self):
        code, out = self.batch([{"name": "build", "command": self.py(
            "import sys; print('CMake Error: AUTOMOC for target X: Test run of \"moc\" executable \"m.exe\" failed.'); sys.exit(1)")}])
        self.assertEqual(code, 1)
        self.assertIn("known issue KI-002", out)
        row = read_tsv(self.root / "diagnostics.tsv")[-1]
        self.assertEqual((row["id"], row["status"]), ("DIAG-002", "open"))
        self.assertTrue(row["cause"].startswith("KI-002"))
        self.assertTrue(row["fix"])
        queue = read_tsv(self.root / "tasks.tsv")[0]
        self.assertEqual(queue["status"], "in-progress")
        self.assertIn("[last batch out failed]", queue["evidence"])
        # The retry of the same problem fails again: the row is updated, not duplicated.
        code, out = self.batch([{"name": "build2", "command": self.py("import sys; print('error: again'); sys.exit(1)")}],
                               "--diag", "DIAG-002")
        self.assertEqual(code, 1, out)
        rows = read_tsv(self.root / "diagnostics.tsv")
        self.assertEqual([r["id"] for r in rows], ["DIAG-001", "DIAG-002"])
        self.assertEqual((rows[-1]["symptom"], rows[-1]["location"]), ("error: again", "build: step build2"))
        # The retry passes: with cause and fix recorded the problem is fixed.
        code, out = self.batch([{"name": "build", "command": self.py("print('ok')")}], "--diag", "DIAG-002")
        self.assertEqual(code, 0, out)
        self.assertEqual(read_tsv(self.root / "diagnostics.tsv")[-1]["status"], "fixed")
        queue = read_tsv(self.root / "tasks.tsv")[0]
        self.assertIn("[last batch out passed]", queue["evidence"])
        self.assertEqual(queue["evidence"].count("[last batch"), 1)
        code, out = self.batch([{"name": "build", "command": self.py("print('ok')")}], "--diag", "DIAG-002")
        self.assertNotEqual(code, 0)
        self.assertIn("not an open problem", out)

    def test_open_problem_without_cause_blocks_the_next_batch(self):
        code, out = self.batch([{"name": "build", "command": self.py("import sys; print('error: brand new'); sys.exit(1)")}])
        self.assertEqual(code, 1, out)
        row = read_tsv(self.root / "diagnostics.tsv")[-1]
        self.assertEqual(row["cause"], "")
        code, out = self.batch([{"name": "build", "command": self.py("print('ok')")}])
        self.assertNotEqual(code, 0)
        self.assertIn(f"write the cause of {row['id']} first", out)
        code, out = run_script("record_diagnostic.py", str(self.root / "diagnostics.tsv"), "--id", row["id"],
                               "--status", "fixed", "--cause", "missing include path")
        self.assertNotEqual(code, 0)
        self.assertIn("--fix", out)
        code, out = run_script("record_diagnostic.py", str(self.root / "diagnostics.tsv"), "--id", row["id"],
                               "--cause", "missing include path", "--fix", "add the include dir")
        self.assertEqual(code, 0, out)
        self.assertTrue(any(f"{row['id']} is still open" in e for e in phase_gate.evaluate(self.root, "diagnostics")))
        code, out = self.batch([{"name": "build", "command": self.py("print('ok')")}], "--diag", row["id"])
        self.assertEqual(code, 0, out)
        fixed = read_tsv(self.root / "diagnostics.tsv")[-1]
        self.assertEqual(fixed["status"], "fixed")
        # The failed attempt's logs moved to attempt-1; the problem's reproduce follows them.
        self.assertIn(str(self.out / "attempt-1" / "01-build.stdout.log"), fixed["reproduce"])
        self.assertFalse(any(row["id"] in e for e in phase_gate.evaluate(self.root, "diagnostics")))

    def test_idle_timeout_is_a_problem(self):
        code, out = self.batch([{"name": "hang", "command": self.py("import time; print('done', flush=True); time.sleep(30)"),
                                 "idle_timeout": 1.5}])
        self.assertEqual(code, 1)
        row = read_tsv(self.root / "diagnostics.tsv")[-1]
        self.assertEqual(row["status"], "open")
        self.assertIn("idle timeout", row["symptom"])

    def hap_check_step(self, app_library: str, problems: list[str] | None = None) -> dict:
        """A stand-in for hap_check.py: prints its JSON report (the step command names hap_check.py)."""
        report = {"hap": str(self.tmp / "project" / "entry-default-signed.hap"), "signed": True, "abi": "arm64-v8a",
                  "app_library": app_library, "bundle_name": "com.example.demo", "native_libs": [],
                  "problems": problems or [], "notes": []}
        code = f"import json, sys; print(json.dumps({report!r})); sys.exit({1 if problems else 0})"
        return {"name": "hap-check", "command": [sys.executable, "-c", code, "hap_check.py"]}

    def test_hap_check_step_writes_the_one_device_runs_row(self):
        (self.tmp / "project").mkdir()
        hap = self.tmp / "project" / "entry-default-signed.hap"
        hap.write_bytes(b"hap-1")
        runs = self.root / "device-runs.tsv"
        write_tsv(runs, [])  # make_app() fills it for the gate tests
        # No hap_check.py step: nothing is written; a leftover plan "artifacts" key is only noted.
        code, out = self.batch([{"name": "build", "command": self.py("print('built')")}],
                               artifacts=[{"artifact": "application-hap"}])
        self.assertEqual(code, 0, out)
        self.assertEqual(read_tsv(runs), [])
        self.assertIn("no longer used", out)
        # The project still packs the envelope app: nothing is written.
        code, out = self.batch([self.hap_check_step(template_patch.ENVELOPE_LIBRARY)])
        self.assertEqual(code, 0, out)
        self.assertEqual(read_tsv(runs), [])
        self.assertIn("envelope", out)
        # hap_check.py passed on the application, no device in environment.tsv: no-device.
        code, out = self.batch([self.hap_check_step("libdemo.so")])
        self.assertEqual(code, 0, out)
        [row] = read_tsv(runs)
        self.assertEqual((row["id"], row["status"]), ("DEV-RUN-001", "no-device"))
        self.assertEqual(row["hap"], f"{hap.resolve()} (com.example.demo)")
        self.assertIn("hap_check.py passed; signed", row["evidence"])
        self.assertFalse(list((self.out).glob("artifacts")))  # nothing is copied
        # With a connected device: checked, overwriting the same row.
        write_env(self.root, path_prepend=[str(self.tmp / "tools")], status={"device": "ok"})
        code, out = self.batch([self.hap_check_step("libdemo.so")])
        self.assertEqual([(r["id"], r["status"]) for r in read_tsv(runs)], [("DEV-RUN-001", "checked")])
        # An older layout is reported, never written half-way.
        runs.write_text("id\thap\tscenario_ids\tevidence\n", encoding="utf-8")
        code, out = self.batch([self.hap_check_step("libdemo.so")])
        self.assertIn("older header", out)
        self.assertEqual(read_tsv(runs), [])
        write_tsv(runs, [], ["id", "hap", "status", "evidence"])
        # hap_check.py failed: hap-failed, naming the diagnostics problem.
        code, out = self.batch([self.hap_check_step("libdemo.so", ["libqohos.so is not packed"])])
        self.assertEqual(code, 1, out)
        [row] = read_tsv(runs)
        problem = read_tsv(self.root / "diagnostics.tsv")[-1]["id"]
        self.assertEqual(row["status"], "hap-failed")
        self.assertIn(f"hap_check.py failed: libqohos.so is not packed; problem {problem}", row["evidence"])
        # The diagnostics gate rejects a HAP that failed hap_check.py.
        errors = phase_gate.evaluate(self.root, "diagnostics")
        self.assertTrue(any("failed hap_check.py" in e for e in errors), errors)
        # The ledger belongs to batch_checks.py / device_run.py.
        with self.assertRaises(ledger.LedgerError):
            ledger.add_row(self.root, "device-runs.tsv", {"hap": "x"})


# --------------------------------------------------------------------------- env probe

@unittest.skipUnless(POSIX, "fake toolchain uses /bin/sh scripts")
class EnvProbeTest(Temp):
    def make_toolchain(self, space_in_native: bool = True) -> dict[str, Path]:
        qt = self.tmp / "ohos-qt" / "Qt-5.12.12"
        script(qt / "bin" / "qmake", 'if [ "$1" = "-query" ]; then echo QT_VERSION:5.12.12; echo QMAKE_XSPEC:ohos-clang; fi')
        script(qt / "bin" / "moc", "echo moc 5.12.12")
        (qt / "mkspecs" / "modules").mkdir(parents=True)
        for module in ("core", "gui", "widgets", "network", "core_private"):
            (qt / "mkspecs" / "modules" / f"qt_lib_{module}.pri").write_text("", encoding="utf-8")
        (qt / "plugins" / "styles").mkdir(parents=True)
        (qt / "plugins" / "styles" / "libqohosstyle.so").write_bytes(b"style")
        deveco = self.tmp / ("DevEco Studio" if space_in_native else "deveco")
        fake_devecocli(deveco / "tools")
        (qt / "mkspecs" / "ohos-clang").mkdir(parents=True, exist_ok=True)
        (deveco / "jbr" / "bin").mkdir(parents=True)
        (deveco / "product-info.json").write_text(json.dumps({"version": "6.1.1.300"}), encoding="utf-8")
        openharmony = deveco / "sdk" / "default" / "openharmony"
        script(openharmony / "native" / "llvm" / "bin" / "clang++", "echo 'OHOS (dev) clang version 15.0.4'")
        (openharmony / "native" / "sysroot" / "usr" / "lib" / "aarch64-linux-ohos").mkdir(parents=True)
        (openharmony / "native" / "sysroot" / "usr" / "lib" / "aarch64-linux-ohos" / "libc.so").write_bytes(b"")
        (openharmony / "oh-uni-package.json").write_text(json.dumps({"apiVersion": "24", "version": "6.1.1.125"}), encoding="utf-8")
        template = make_template(self.tmp / "templates" / "glue")
        return {"qt": qt, "deveco": deveco, "template": template}

    def probe(self, root: Path, paths: dict[str, Path], *extra: str) -> tuple[int, str]:
        # The bound inputs may be the kit directories that hold the SDK and the template.
        return run_main(env_probe, "--migration-root", str(root), "--qt-sdk", str(paths["qt"].parent),
                        "--deveco-home", str(paths["deveco"]), "--template", str(paths["template"].parent),
                        "--no-device", *extra)

    def test_probe_writes_one_row_per_item_and_fixes_spaces(self):
        root = make_app(self.tmp)
        paths = self.make_toolchain()
        for tool in ("make", "cmake", "ninja"):
            script(self.tmp / "bin" / tool, f"echo {tool} 4.4")
        os.environ["PATH"] = str(self.tmp / "bin") + os.pathsep + os.environ["PATH"]
        try:
            code, out = self.probe(root, paths)
        finally:
            os.environ["PATH"] = os.environ["PATH"].split(os.pathsep, 1)[1]
        self.assertEqual(code, 0, out)
        self.assertFalse(any((root / name).exists() for name in ("env.json", "env.ps1", "env.sh")))
        rows = read_tsv(root / "environment.tsv")
        items = [row["item"] for row in rows]
        # One row per environment item, core items always, in the fixed order; no row per check.
        self.assertEqual(len(items), len(set(items)))
        self.assertTrue(set(vocab.ENV_CORE_ITEMS) <= set(items), items)
        self.assertEqual(items, sorted(items, key=env_probe.order_key))
        self.assertNotIn("qt-source", items)  # no Qt source checkout: the conditional item is not written
        if not (Path.home() / ".ohos" / "config").is_dir():
            self.assertNotIn("signing", items)  # no signing materials: no row
        self.assertIn("jbr", items)  # the fake DevEco ships a JBR
        # make_app builds with a CMakeLists.txt: cmake and ninja are needed, so they get rows.
        self.assertIn("cmake", items)
        self.assertIn("ninja", items)
        by_item = {row["item"]: row for row in rows}
        self.assertEqual(by_item["qt-sdk"]["version"], "5.12.12")
        self.assertIn("arm64-v8a", by_item["qt-sdk"]["detail"])
        # devecocli builds, signs and runs: found under DevEco's tools, which DEVECO_HOME names for it.
        self.assertEqual(by_item["devecocli"]["path"], str(paths["deveco"] / "tools" / "devecocli"))
        self.assertIn(f"DEVECO_HOME={paths['deveco']}", by_item["deveco"]["command_env"])
        self.assertNotIn("node", items)
        self.assertNotIn("hvigor", items)
        # The space in the native SDK path is fixed on the ohos-sdk row (KI-001).
        self.assertEqual(by_item["ohos-sdk"]["status"], "fixed")
        self.assertIn("KI-001", by_item["ohos-sdk"]["issue"])
        self.assertIn("API 24", by_item["ohos-sdk"]["version"])
        self.assertIn("clang 15.0.4", by_item["ohos-sdk"]["version"])
        self.assertIn("lazy import", by_item["qt-template"]["detail"])
        self.assertEqual(by_item["qt-template"]["version"], "")  # the template has no version
        profile = ohos_env.load_profile(root)
        self.assertEqual(Path(profile["paths"]["qt_sdk"]), paths["qt"])
        self.assertEqual(Path(profile["paths"]["template"]), paths["template"])
        self.assertEqual(profile["paths"]["make"], str(self.tmp / "bin" / "make"))
        # openharmonydeployqt needs the OpenHarmony root whose native child is NATIVE_OHOS_SDK (KI-020).
        sdk_dir = Path(profile["env"]["set"]["OHOS_SDK_DIR"])
        self.assertNotIn(" ", str(sdk_dir))
        self.assertEqual(Path(profile["paths"]["native_sdk"]), sdk_dir / "native")
        self.assertTrue((Path(profile["paths"]["native_sdk"]) / "llvm" / "bin" / "clang++").is_file())
        self.assertIn("network", profile["qt_modules"])
        self.assertNotIn("core_private", profile["qt_modules"])
        self.assertEqual(profile["abi"], "arm64-v8a")
        self.assertEqual(profile["env"]["set"]["PYTHONIOENCODING"], "utf-8")
        self.assertEqual(profile["env"]["path_prepend"][0], str(paths["qt"] / "bin"))
        # Only env_probe.py writes the table.
        with self.assertRaises(SystemExit):
            ledger.add_row(root, "environment.tsv", {"item": "make"})
        code, out = run_script("validate_ledgers.py", str(root), "--no-skill-check")
        self.assertNotIn("environment.tsv", out)

    def test_harmonyos_pc_uses_deveco_sdk_home_and_is_its_own_device(self):
        root = make_app(self.tmp)
        paths = self.make_toolchain(space_in_native=False)
        for tool in ("make", "cmake", "ninja"):
            script(self.tmp / "bin" / tool, f"echo {tool} 4.4")
        saved = {key: os.environ.get(key) for key in ("PATH", "DEVECO_SDK_HOME")}
        os.environ["PATH"] = os.pathsep.join([str(self.tmp / "bin"), str(paths["deveco"] / "tools"), os.environ["PATH"]])
        os.environ["DEVECO_SDK_HOME"] = str(paths["deveco"] / "sdk")
        ohos_env.IS_HARMONYOS = True
        try:
            code, out = run_main(env_probe, "--migration-root", str(root), "--qt-sdk", str(paths["qt"]),
                                 "--template", str(paths["template"]))
        finally:
            ohos_env.IS_HARMONYOS = False
            for key, value in saved.items():
                os.environ.pop(key, None) if value is None else os.environ.__setitem__(key, value)
        rows = {row["item"]: row for row in read_tsv(root / "environment.tsv")}
        self.assertEqual(rows["deveco"]["path"], str(paths["deveco"] / "sdk"))
        self.assertEqual(rows["ohos-sdk"]["status"], "ok", rows["ohos-sdk"])
        self.assertEqual(rows["devecocli"]["path"], str(paths["deveco"] / "tools" / "devecocli"))
        self.assertEqual(rows["device"]["status"], "ok")
        self.assertIn("HarmonyOS PC", rows["device"]["detail"])
        self.assertNotIn("jbr", rows)
        self.assertEqual(code, 0, out)
        self.assertFalse(phase_gate.no_device(root))  # so the smoke runtime is required

    def test_device_list_is_parsed_from_devecocli(self):
        tool = fake_devecocli(self.tmp / "cli")
        self.assertEqual(device_run.list_devices(str(tool), dict(os.environ), self.tmp / "logs"), ["SERIAL123456789"])
        (self.tmp / "cli" / "nodevice").write_text("", encoding="utf-8")
        self.assertEqual(device_run.list_devices(str(tool), dict(os.environ), self.tmp / "logs"), [])

    def test_conditional_items_qt_source_and_tools_are_kept_on_rerun(self):
        root = make_app(self.tmp)
        paths = self.make_toolchain(space_in_native=False)
        source = self.tmp / "qt-src" / "qt5.12"
        (source / "qtbase").mkdir(parents=True)
        (source / "qtbase" / ".qmake.conf").write_text("MODULE_VERSION = 5.12.12\n", encoding="utf-8")
        for tool in ("perl", "make", "cmake", "ninja"):
            script(self.tmp / "bin" / tool, f"echo {tool} 5")
        os.environ["PATH"] = str(self.tmp / "bin") + os.pathsep + os.environ["PATH"]
        try:
            self.probe(root, paths, "--qt-source", str(source), "--tools", "perl,gperf-missing")
            first = {row["item"]: row for row in read_tsv(root / "environment.tsv")}
            self.probe(root, paths)  # no options: the conditional items of the last table are probed again
            second = {row["item"]: row for row in read_tsv(root / "environment.tsv")}
        finally:
            os.environ["PATH"] = os.environ["PATH"].split(os.pathsep, 1)[1]
        for rows in (first, second):
            self.assertEqual(rows["qt-source"]["path"], str(source))
            self.assertEqual(rows["qt-source"]["version"], "5.12.12")
            self.assertEqual(rows["qt-source"]["status"], "ok")
            self.assertEqual(rows["tool:perl"]["status"], "ok")
            self.assertEqual(rows["tool:gperf-missing"]["status"], "missing")
        self.assertTrue(any("tool:gperf-missing missing" in e for e in phase_gate.evaluate(root, "environment")))

    def test_qt_source_found_from_the_template_inside_it(self):
        root = make_app(self.tmp)
        paths = self.make_toolchain(space_in_native=False)
        source = self.tmp / "qt5.12"
        template = make_template(source / "qtbase" / "src" / "harmonyos" / "templates")
        paths["template"] = template
        code, out = run_main(env_probe, "--migration-root", str(root), "--qt-sdk", str(paths["qt"]),
                             "--deveco-home", str(paths["deveco"]), "--template", str(template), "--no-device")
        rows = {row["item"]: row for row in read_tsv(root / "environment.tsv")}
        self.assertEqual(rows["qt-source"]["path"], str(source))
        self.assertIn("found via template", rows["qt-source"]["detail"])

    def test_probe_reports_missing_inputs(self):
        root = make_app(self.tmp)
        code, out = run_main(env_probe, "--migration-root", str(root), "--qt-sdk", str(self.tmp / "missing"),
                             "--deveco-home", str(self.tmp / "nodeveco"), "--template", str(self.tmp / "none"), "--no-device")
        self.assertEqual(code, 1)
        self.assertIn("ERROR:", out)
        rows = {row["item"]: row for row in read_tsv(root / "environment.tsv")}
        self.assertEqual(rows["qt-sdk"]["status"], "missing")
        self.assertEqual(rows["deveco"]["status"], "missing")
        errors = phase_gate.evaluate(root, "environment")
        self.assertTrue(any("broken or missing items" in e and "qt-sdk missing" in e for e in errors), errors)


# --------------------------------------------------------------------------- devecocli_build and env smoke

@unittest.skipUnless(POSIX, "fake devecocli uses /bin/sh")
class BuildTest(Temp):
    def fake_profile(self, build_body: str) -> Path:
        tool = fake_devecocli(self.tmp / "cli", build_body)
        profile = self.tmp / "environment.tsv"
        write_env(profile, paths={"devecocli": str(tool)})
        return profile

    def project(self) -> Path:
        project = make_template(self.tmp / "project")
        (project / "hvigor" / "hvigor-config.json5").write_text('{\n  "execution": {\n    "daemon": false,\n  }\n}\n',
                                                                 encoding="utf-8")
        return project

    HAP_SCRIPT = (
        'mkdir -p .hvigor/outputs/build-logs entry/build/default/outputs/default; echo "[INFO] BUILD" >> .hvigor/outputs/build-logs/build.log; '
        "python3 -c \"import zipfile; z=zipfile.ZipFile('entry/build/default/outputs/default/entry-default-unsigned.hap','w'); "
        "[z.writestr('libs/arm64-v8a/'+n, b'x') for n in ('libQtHarmonyApp.so','libqohos.so','libc++_shared.so','libQt5Core.so')]; "
        "z.writestr('libs/arm64-v8a/styles/libqohosstyle.so', b'x'); z.writestr('module.json', '{}'); z.close()\"")

    def test_build_success_and_failure(self):
        project = self.project()
        profile = self.fake_profile(self.HAP_SCRIPT)
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile", str(profile))
        self.assertEqual(code, 0, out)
        self.assertIn('"status": "built"', out)
        self.assertIn("devecocli build --product default --build-mode debug", out)
        profile = self.fake_profile('mkdir -p .hvigor/outputs/build-logs; '
                                    'echo "[ERROR] ArkTS 10705000 does not support using lazy import" >> .hvigor/outputs/build-logs/build.log; exit 1')
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile", str(profile))
        self.assertEqual(code, 1, out)
        self.assertIn("KI-003", out)

    def test_project_with_the_hvigor_daemon_on_is_refused(self):
        project = make_template(self.tmp / "project")  # the template keeps hvigor's default: daemon on
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile",
                               str(self.fake_profile(self.HAP_SCRIPT)))
        self.assertEqual(code, 1, out)
        self.assertIn("KI-004", out)
        self.assertIn("KI-004", [hit["id"] for hit in known_issues.match(out)])
        changes, _ = template_patch.apply(project, None, None, "arm64-v8a", None, None, check=False)
        self.assertTrue(any("execution.daemon -> false" in change for change in changes), changes)
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile",
                               str(self.fake_profile(self.HAP_SCRIPT)))
        self.assertEqual(code, 0, out)

    def test_up_to_date_build_reports_the_existing_hap(self):
        project = self.project()
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile", str(self.fake_profile(self.HAP_SCRIPT)))
        self.assertEqual(code, 0, out)
        time.sleep(1.2)
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile", str(self.fake_profile("exit 0")))
        self.assertEqual(code, 0, out)
        self.assertIn('"up_to_date": true', out)

    def test_build_hang_becomes_timeout(self):
        project = self.project()
        profile = self.fake_profile("echo BUILD SUCCESSFUL; sleep 60")
        code, out = run_script("devecocli_build.py", "--project", str(project), "--env-profile", str(profile),
                               "--idle-timeout", "1.5")
        self.assertEqual(code, 2, out)
        self.assertIn("idle timeout", out)

    PIPELINE_HVIGOR = (
        'mkdir -p .hvigor/outputs/build-logs entry/build/default/outputs/default; echo "[INFO] BUILD" >> .hvigor/outputs/build-logs/build.log\n'
        "python3 - <<'PY'\n"
        "import glob, json, os, zipfile\n"
        "signed = 'SIGNED' in open('build-profile.json5').read()\n"
        "name = 'entry/build/default/outputs/default/entry-default-%s.hap' % ('signed' if signed else 'unsigned')\n"
        "z = zipfile.ZipFile(name, 'w')\n"
        "for p in glob.glob('entry/libs/arm64-v8a/**/*', recursive=True):\n"
        "    if os.path.isfile(p):\n"
        "        z.writestr('libs/arm64-v8a/' + os.path.relpath(p, 'entry/libs/arm64-v8a').replace(os.sep, '/'), open(p, 'rb').read())\n"
        "z.writestr('libs/arm64-v8a/libc++_shared.so', b'x')\n"
        "z.writestr('module.json', json.dumps({'app': {'bundleName': 'com.bitfun.qtsmoke'}, 'module': {'mainElement': 'QAbility'}}))\n"
        "z.close()\n"
        "# hvigor also leaves an unsigned app/entry-default.hap whose name does not say so\n"
        "os.makedirs('entry/build/default/outputs/default/app', exist_ok=True)\n"
        "import shutil; shutil.copy(name, 'entry/build/default/outputs/default/app/entry-default.hap')\n"
        "if signed:\n"
        "    import subprocess, sys\n"
        "    subprocess.run([sys.executable, '-c', " + repr(SIGN_HAP) + ", name], check=True)\n"
        "PY")

    def pipeline_profile(self, root: Path, *, device: bool = False) -> str:
        """A fake toolchain on which the whole smoke pipeline runs: qmake, make, deploy, devecocli, hap_check."""
        tools = self.tmp / "tools"
        qt = self.tmp / "qt"
        script(qt / "bin" / "qmake", 'printf "# Project:  %s\\nCXX = clang++ --target=aarch64-linux-ohos --sysroot=/s\\n'
               'TARGET = libqtsmoke.so\\n" "$1" > Makefile')
        script(qt / "bin" / "openharmonydeployqt",
               'out=""; libs=""\nwhile [ $# -gt 0 ]; do case "$1" in --output-dir) out="$2"; shift 2;; '
               '--library) libs="$libs $2"; shift 2;; *) shift;; esac; done\n'
               'mkdir -p "$out/entry/libs/arm64-v8a"; for l in $libs; do cp "$l" "$out/entry/libs/arm64-v8a/"; done')
        (qt / "lib").mkdir(parents=True)
        for name, needed in {"libQt5Core.so": ["libc.so"], "libQt5Gui.so": ["libQt5Core.so"],
                             "libQt5Widgets.so": ["libQt5Gui.so", "libQt5Core.so"]}.items():
            (qt / "lib" / name).write_bytes(make_elf(needed))
        (qt / "plugins" / "platforms").mkdir(parents=True)
        (qt / "plugins" / "platforms" / "libqohos.so").write_bytes(make_elf(["libQt5Gui.so"]))
        (qt / "plugins" / "styles").mkdir(parents=True)
        (qt / "plugins" / "styles" / "libqohosstyle.so").write_bytes(b"x")
        (qt / "src" / "openharmony").mkdir(parents=True)
        elf = self.tmp / "qtsmoke.elf"
        elf.write_bytes(make_elf(["libQt5Widgets.so", "libc.so"]))
        make = script(tools / "make", f'cp "{elf}" libqtsmoke.so')
        sdk = self.tmp / "openharmony"
        (sdk / "native" / "llvm" / "bin").mkdir(parents=True)
        (sdk / "native" / "sysroot" / "usr" / "lib").mkdir(parents=True)
        (sdk / "native" / "sysroot" / "usr" / "lib" / "libc.so").write_bytes(b"")
        tool = fake_devecocli(self.tmp / "cli", self.PIPELINE_HVIGOR)
        if not device:
            (self.tmp / "cli" / "nodevice").write_text("", encoding="utf-8")
        template = make_template(self.tmp / "templates")
        return write_env(root, short_cache_dir=str(self.tmp / "short"), qt_modules=["core", "gui", "widgets"],
                         paths={"devecocli": str(tool), "template": str(template), "qt_sdk": str(qt),
                                "make": str(make), "native_sdk": str(sdk / "native"), "ohos_sdk_dir": str(sdk)},
                         path_prepend=[str(qt / "bin"), str(tools)])

    def test_env_smoke_runs_the_app_pipeline(self):
        root = make_app(self.tmp)
        self.pipeline_profile(root)
        code, out = run_main(env_smoke, "--migration-root", str(root))
        self.assertEqual(code, 0, out)
        smoke = json.loads((root / "env-smoke.json").read_text(encoding="utf-8"))
        self.assertEqual(smoke["status"], "passed")
        self.assertNotIn("env_fingerprint", smoke)
        for stage in ("qmake-configure", "configured-audit", "make", "deploy", "build", "hap-check"):
            self.assertIn(stage, smoke["capabilities"])
        self.assertEqual(smoke["runtime"]["status"], "not-covered")
        self.assertFalse((root / "baseline.tsv").exists())
        project = self.tmp / "short" / "smoke" / "project"
        self.assertIn('"beta3"', (project / "build-profile.json5").read_text())
        self.assertTrue(template_patch.daemon_disabled((project / "hvigor" / "hvigor-config.json5").read_text()))
        self.assertIn("libqtsmoke.so", (project / "entry/src/main/ets/common/QtAppConstants.ets").read_text())
        # --runtime-only reuses that build (no device here: the runtime stays not covered).
        code, out = run_main(env_smoke, "--migration-root", str(root), "--runtime-only")
        self.assertEqual(code, 0, out)
        self.assertIn("device part only", out)

    def test_env_smoke_runtime_only_needs_a_passing_build(self):
        root = make_app(self.tmp)
        self.pipeline_profile(root)
        code, out = run_main(env_smoke, "--migration-root", str(root), "--runtime-only")
        self.assertEqual(code, 1, out)
        self.assertIn("no passing hello app build", out)

    def test_env_smoke_failure_names_the_stage(self):
        root = make_app(self.tmp)
        self.pipeline_profile(root)
        script(self.tmp / "tools" / "make", 'echo "ld.lld: error: unable to find library -lgomp" >&2; exit 2')
        code, out = run_main(env_smoke, "--migration-root", str(root))
        self.assertEqual(code, 1, out)
        self.assertIn("failed at make", out)
        self.assertIn("KI-012", out)

    def test_env_smoke_signs_installs_and_launches_on_a_device(self):
        root = make_app(self.tmp)
        self.pipeline_profile(root, device=True)
        code, out = run_main(env_smoke, "--migration-root", str(root))
        self.assertEqual(code, 0, out)
        smoke = json.loads((root / "env-smoke.json").read_text(encoding="utf-8"))
        self.assertEqual(smoke["runtime"]["status"], "passed")
        self.assertIn("signed", smoke["capabilities"])
        self.assertIn("launch", smoke["capabilities"])
        # The hello app's run is the smoke receipt only, never the device-runs.tsv row.
        self.assertNotIn("hello", read_tsv(root / "device-runs.tsv")[0]["hap"])  # the fixture's row only


@unittest.skipUnless(POSIX, "fake devecocli uses /bin/sh")
class DeviceRunTest(Temp):
    def setUp(self):
        super().setUp()
        self.cli = fake_devecocli(self.tmp / "cli")
        self.profile = write_env(self.tmp / "env.tsv", paths={"devecocli": str(self.cli)})
        self.project = self.tmp / "project"

    def hap(self) -> Path:
        return make_hap(self.project / "entry" / "build" / "default" / "outputs" / "default" / "entry-default-signed.hap",
                        {"libApp.so": b"x"}, bundle="com.example.app", signed=True)

    def flag(self, name: str, on: bool = True) -> None:
        path = self.tmp / "cli" / name
        path.write_text("old-crash" if name == "crash" else "", encoding="utf-8") if on else path.unlink()

    def run_device(self, *extra: str) -> tuple[int, str]:
        return run_main(device_run, "run", "--project", str(self.project), "--env-profile", str(self.profile),
                        "--wait", "0", *extra)

    def test_install_launch_and_record(self):
        root = make_app(self.tmp)
        hap = self.hap()
        runs = root / "device-runs.tsv"
        flags = ("--migration-root", str(root), "--record")
        # The row names another HAP (make_app's): the run passes but is not recorded.
        code, out = self.run_device(*flags)
        self.assertEqual(code, 0, out)
        self.assertIn("not this HAP", out)
        self.assertNotIn(str(hap), read_tsv(runs)[0]["hap"])
        # batch_checks.py checked this HAP: a passed run sets the row to run.
        checked = {"hap": f"{hap} (com.example.app)", "status": "checked", "evidence": "batch b: hap_check.py passed; signed"}
        ledger.record_hap(root, checked)
        code, out = self.run_device(*flags)
        report = json.loads(out[out.index("{"):out.rindex("}") + 1])
        self.assertEqual(code, 0, out)
        self.assertEqual(report["steps"]["process"], "passed: running after 0s")
        self.assertEqual(report["bundle_name"], "com.example.app")
        [row] = read_tsv(runs)
        self.assertEqual((row["id"], row["hap"], row["status"]), ("DEV-RUN-001", f"{hap} (com.example.app)", "run"))
        self.assertIn("batch b: hap_check.py passed; signed; device: running after 0s", row["evidence"])
        # A failed run is a diagnostics problem and leaves the row as it is.
        ledger.record_hap(root, checked)
        self.flag("locked")
        code, out = self.run_device(*flags)
        self.assertEqual(code, 1, out)
        self.assertIn("KI-022", out)
        self.assertEqual(read_tsv(runs)[0]["status"], "checked")
        self.flag("locked", False)
        # A HAP that failed hap_check.py is never recorded as run.
        ledger.record_hap(root, {**checked, "status": "hap-failed"})
        code, out = self.run_device(*flags)
        self.assertIn("failed hap_check.py", out)
        self.assertEqual(read_tsv(runs)[0]["status"], "hap-failed")
        ledger.record_hap(root, checked)
        # The envelope app (template_patch.py --envelope) passes but is not the application: not recorded.
        constants = self.project / "entry" / "src" / "main" / "ets" / "common" / "QtAppConstants.ets"
        constants.parent.mkdir(parents=True)
        constants.write_text("export const APP_LIBRARY_NAME = 'libQtHarmonyApp.so';\n", encoding="utf-8")
        code, out = self.run_device(*flags)
        self.assertEqual(code, 0, out)
        self.assertIn("envelope app", out)
        self.assertEqual(read_tsv(runs)[0]["status"], "checked")
        constants.write_text("export const APP_LIBRARY_NAME = 'libApp.so';\n", encoding="utf-8")
        code, out = self.run_device(*flags)
        self.assertEqual([r["status"] for r in read_tsv(runs)], ["run"])
        with self.assertRaises(SystemExit):
            ledger.add_row(root, "device-runs.tsv", {"hap": "x"})

    def test_crash_dead_process_missing_device_and_unsigned_hap(self):
        self.hap()
        # An old crash log is not this run's; a new one after the launch fails the run.
        self.flag("crash")
        code, out = self.run_device()
        self.assertEqual(code, 0, out)
        self.flag("crashonrun")
        code, out = self.run_device()
        self.assertEqual(code, 1, out)
        self.assertIn("new crash log new-crash", out)
        self.flag("crashonrun", False)
        self.flag("crash", False)
        self.flag("dead")
        code, out = self.run_device()
        self.assertEqual(code, 1, out)
        self.assertIn("the process is gone", out)
        self.flag("dead", False)
        self.flag("nodevice")
        code, out = self.run_device()
        self.assertEqual(code, 3, out)
        # On a HarmonyOS PC the PC is the device: no device list.
        ohos_env.IS_HARMONYOS = True
        try:
            code, out = self.run_device()
        finally:
            ohos_env.IS_HARMONYOS = False
        self.assertEqual(code, 0, out)
        self.assertIn("this HarmonyOS PC", out)
        # The name says nothing: hvigor's app/entry-default.hap carries no signing block.
        self.project = self.tmp / "u"
        make_hap(self.project / "entry" / "build" / "default" / "outputs" / "default" / "app" / "entry-default.hap",
                 {"libApp.so": b"x"})
        code, out = self.run_device()
        self.assertEqual(code, 1)
        self.assertIn("KI-017", out)


# --------------------------------------------------------------------------- template patch and HAP check

class ProfileLocationTest(Temp):
    def test_output_project_outside_the_app_finds_the_environment_table(self):
        root = make_app(self.tmp)
        profile = root / "environment.tsv"
        project = make_template(self.tmp / "elsewhere" / "project")  # a sibling of the app, not below it
        self.assertEqual(ohos_env.app_profile(project, None), (None, None))
        changes, problems = template_patch.apply(project, None, None, "arm64-v8a", None, None, check=False,
                                                 env_profile=profile)
        self.assertTrue(any(".ohos-qt-env" in change for change in changes), changes)
        self.assertEqual(ohos_env.locate_profile(project), profile.resolve())
        # The variable batch_checks.py sets for its steps wins over the pointer.
        other = self.tmp / "other.json"
        other.write_text("{}", encoding="utf-8")
        os.environ[ohos_env.ENV_PROFILE_VAR] = str(other)
        try:
            self.assertEqual(ohos_env.locate_profile(project), other)
        finally:
            del os.environ[ohos_env.ENV_PROFILE_VAR]
        self.assertEqual(ohos_env.locate_profile(project, self.tmp / "explicit.json"), self.tmp / "explicit.json")
        hap = make_hap(self.tmp / "a.hap", {"libApp.so": b"x"})
        code, out = run_main(hap_check, "--hap", str(hap), "--app-library", "libApp.so", "--env-profile", str(profile))
        self.assertNotIn("unrecognized arguments", out)
        self.assertIn('"signed": false', out)


class TemplatePatchTest(Temp):
    def test_both_lazy_import_spellings_need_beta3(self):
        self.assertTrue(template_patch.LAZY_RE.search("export lazy import { a } from 'b';"))
        self.assertTrue(template_patch.LAZY_RE.search("import lazy { QtWindow } from './QtWindow';"))
        self.assertFalse(template_patch.LAZY_RE.search("import { lazyLoad } from 'x'; // lazy importer"))

    def test_entry_hap_is_preferred_over_auxiliary_modules(self):
        build = self.tmp / "project"
        aux = build / "qEmbeddedUiExtensionHost" / "build" / "default" / "outputs" / "default" / "qEmbeddedUiExtensionHost-default-signed.hap"
        unsigned = build / "entry" / "build" / "default" / "outputs" / "default" / "entry-default-unsigned.hap"
        signed = unsigned.with_name("entry-default-signed.hap")
        app = unsigned.parent / "app" / "entry-default.hap"
        for path in (unsigned, app):
            make_hap(path, {"libApp.so": b"x"})
        for path in (signed, aux):
            make_hap(path, {"libApp.so": b"x"}, signed=True)
        os.utime(aux, (time.time() + 60, time.time() + 60))
        os.utime(app, (time.time() + 30, time.time() + 30))
        self.assertFalse(ohos_env.hap_is_signed(app))
        self.assertTrue(ohos_env.hap_is_signed(signed))
        self.assertEqual(ohos_env.pick_entry_hap([str(aux), str(unsigned), str(app), str(signed)]), signed)
        self.assertEqual(hap_check.newest_hap(build), signed)
        self.assertIsNone(ohos_env.pick_entry_hap([]))

    def test_patch_is_complete_and_idempotent(self):
        template = make_template(self.tmp / "template")
        qt = self.tmp / "qt-sdk"
        (qt / "plugins" / "styles").mkdir(parents=True)
        (qt / "plugins" / "styles" / "libqohosstyle.so").write_bytes(b"style")
        project = self.tmp / "project"
        changes, problems = template_patch.apply(project, template, qt, "arm64-v8a", "libNotepad--.so", "com.hmja.notepad", False)
        self.assertEqual(problems, [])
        profile = (project / "build-profile.json5").read_text()
        self.assertIn('"compatibleSdkVersionStage": "beta3"', profile)
        entry = (project / "entry" / "build-profile.json5").read_text()
        self.assertIn(f"-DCMAKE_PREFIX_PATH={qt.as_posix()}", entry)
        self.assertNotIn("x86_64", entry)
        self.assertIn("libNotepad--.so", (project / "entry/src/main/ets/common/QtAppConstants.ets").read_text())
        self.assertIn("com.hmja.notepad", (project / "AppScope/app.json5").read_text())
        self.assertTrue((project / "entry/libs/arm64-v8a/styles/libqohosstyle.so").is_file())
        again, problems = template_patch.apply(project, template, qt, "arm64-v8a", "libNotepad--.so", "com.hmja.notepad", False)
        self.assertEqual((again, problems), ([], []))
        self.assertEqual(profile.count("compatibleSdkVersionStage"), 1)

    def test_envelope_and_check_mode(self):
        template = make_template(self.tmp / "template", lazy=False)
        project = self.tmp / "project"
        shutil.copytree(template, project)
        code, out = run_main(template_patch, "--project", str(project), "--qt-sdk", str(self.tmp / "noqt"), "--envelope", "--check")
        self.assertEqual(code, 1)
        self.assertIn("envelope CMakeLists.txt", out)
        self.assertNotIn("beta3", (project / "build-profile.json5").read_text())
        changes, _ = template_patch.apply(project, None, None, "arm64-v8a", None, None, False, envelope=True)
        self.assertIn("libQtHarmonyApp.so", (project / "entry/src/main/ets/common/QtAppConstants.ets").read_text())
        self.assertIn("QOhosPlatformIntegrationPlugin", (project / "entry/src/main/cpp/CMakeLists.txt").read_text())
        self.assertNotIn("compatibleSdkVersionStage", (project / "build-profile.json5").read_text())


class HapCheckTest(Temp):
    def test_problems_are_named(self):
        project = make_template(self.tmp / "project")
        (project / "entry" / "libs" / "arm64-v8a" / "themes").mkdir(parents=True)
        (project / "entry" / "libs" / "arm64-v8a" / "themes" / "dark.xml").write_text("x")
        hap = make_hap(self.tmp / "a.hap", {
            "libqohos.so": make_elf(["libc.so", "libhilog_ndk.z.so"]),
            "libc++_shared.so": make_elf([]),
            "libQt5Core.so": make_elf(["libicu.so", "libc++_shared.so"]),
        })
        report = hap_check.check(hap, project, "libApp.so", "arm64-v8a", "com.other.app", ["resources/resfile/themes:3"],
                                 {"libc.so"})
        text = "\n".join(report["problems"])
        self.assertIn("[KI-007] APP_LIBRARY_NAME libApp.so", text)
        self.assertIn("libicu.so is needed by libQt5Core.so", text)
        self.assertNotIn("libhilog_ndk", text)
        self.assertIn("[KI-010] 1 non-.so file", text)
        self.assertIn("resources/resfile/themes/ has 0", text)
        self.assertIn("bundleName in the HAP is com.example.app", text)
        # Without a known sysroot an unresolved library is only a note.
        report = hap_check.check(hap, None, "libApp.so", "arm64-v8a", None, [], set())
        self.assertFalse(any("libicu" in p for p in report["problems"]))
        self.assertTrue(any("libicu" in n for n in report["notes"]))

    def test_clean_hap_passes(self):
        hap = make_hap(self.tmp / "b.hap", {"libApp.so": make_elf(["libQt5Core.so"]), "libQt5Core.so": make_elf([]),
                                            "libqohos.so": make_elf([]), "libc++_shared.so": make_elf([]),
                                            "styles/libqohosstyle.so": make_elf([])},
                       {"resources/resfile/themes/a": b"1"})
        report = hap_check.check(hap, None, "libApp.so", "arm64-v8a", "com.example.app", ["resources/resfile/themes:1"], {"libc.so"})
        self.assertEqual(report["problems"], [])
        self.assertEqual(hap_check.dt_needed(make_elf(["libz.so", "liba.so"])), ["libz.so", "liba.so"])


# --------------------------------------------------------------------------- preflight

PRO = """TEMPLATE = app
TARGET = Demo
QT += core gui widgets xmlpatterns
HEADERS += *.h \\
        sub/a.h
SOURCES += *.cpp
FORMS += *.ui
unix{
    LIBS += -L/home/dev/build -lgomp
    QMAKE_CXXFLAGS += -fopenmp
}
unix:!macx: LIBS += -L$$PWD/x64 -lqmyedit
win32: LIBS += -LC:/libs -lfoo
"""

FIXED_PRO = """TEMPLATE = app
TARGET = Demo
QT += core gui widgets xmlpatterns
HEADERS += main.h sub/a.h
SOURCES += *.cpp
unix:!ohos {
    LIBS += -L/home/dev/build -lgomp
}
ohos {
    QT -= xmlpatterns
    DESTDIR = $$PWD/build-ohos
    target.path = $$DESTDIR
    INSTALLS += target
}
"""


@unittest.skipUnless(POSIX, "fake openharmonydeployqt uses /bin/sh")
class DeployTest(Temp):
    def setUp(self):
        super().setUp()
        qt = self.qt = self.tmp / "qt"
        (qt / "lib").mkdir(parents=True)
        for name, needed in {"libQt5Core.so": ["libc.so"], "libQt5Gui.so": ["libQt5Core.so", "libEGL.so"],
                             "libQt5Widgets.so": ["libQt5Gui.so", "libQt5Core.so"], "libQt5Test.so": ["libQt5Core.so"],
                             "libQt5OhosExtras.so": ["libQt5Core.so"]}.items():
            (qt / "lib" / name).write_bytes(make_elf(needed))
        (qt / "plugins" / "platforms").mkdir(parents=True)
        (qt / "plugins" / "platforms" / "libqohos.so").write_bytes(make_elf(["libQt5Gui.so", "libQt5OhosExtras.so"]))
        (qt / "plugins" / "styles").mkdir(parents=True)
        (qt / "plugins" / "styles" / "libqohosstyle.so").write_bytes(b"style")
        (qt / "src" / "openharmony").mkdir(parents=True)
        script(qt / "bin" / "openharmonydeployqt",
               'echo "$*" > "$OHOS_DEPLOY_ARGS"; out=""; libs=""\n'
               'while [ $# -gt 0 ]; do case "$1" in --output-dir) out="$2"; shift 2;; '
               '--library) libs="$libs $2"; shift 2;; *) shift;; esac; done\n'
               'mkdir -p "$out/entry/libs/arm64-v8a"; for l in $libs; do cp "$l" "$out/entry/libs/arm64-v8a/"; done')
        sdk = self.tmp / "openharmony"
        (sdk / "native" / "llvm" / "bin").mkdir(parents=True)
        (sdk / "native" / "sysroot" / "usr" / "lib" / "aarch64-linux-ohos").mkdir(parents=True)
        (sdk / "native" / "sysroot" / "usr" / "lib" / "aarch64-linux-ohos" / "libc.so").write_bytes(b"")
        third = self.tmp / "short" / "ohos-libs" / "boost" / "1.92.0" / "lib"
        third.mkdir(parents=True)
        (third / "libboost_regex.so.1.92.0").write_bytes(make_elf(["libc.so"]))
        self.project = make_template(self.tmp / "app" / "project")
        self.build = self.tmp / "app" / "build-ohos"
        self.build.mkdir(parents=True)
        (self.tmp / "app" / "App.pro").write_text("TEMPLATE = app\n", encoding="utf-8")
        (self.build / "Makefile").write_text("#####\n# Project:  ../App.pro\n# Template: app\n", encoding="utf-8")
        self.library = self.build / "libApp.so"
        self.library.write_bytes(make_elf(["libQt5Widgets.so", "libboost_regex.so.1.92.0", "libc.so"]))
        self.profile = self.tmp / "environment.tsv"
        write_env(self.profile, short_cache_dir=str(self.tmp / "short"),
                  paths={"qt_sdk": str(qt), "native_sdk": str(sdk / "native")},
                  env_set={"OHOS_SDK_DIR": str(sdk), "OHOS_DEPLOY_ARGS": str(self.tmp / "args.txt")})

    def deploy(self, *extra: str) -> tuple[int, dict]:
        code, out = run_main(deploy_qt_libs, "--project", str(self.project), "--library", str(self.library),
                             "--env-profile", str(self.profile), *extra)
        return code, json.loads(out[out.index("{"):out.rindex("}") + 1])

    def test_deploys_the_closure_and_switches_the_app_library(self):
        code, report = self.deploy()
        self.assertEqual(code, 0, report)
        libs = self.project / "entry" / "libs" / "arm64-v8a"
        for name in ("libApp.so", "libQt5Core.so", "libQt5Gui.so", "libQt5Widgets.so", "libQt5OhosExtras.so",
                     "libqohos.so", "libboost_regex.so.1.92.0"):
            self.assertTrue((libs / name).is_file(), name)
        # Only what the app loads: no fixed prf list.
        self.assertFalse((libs / "libQt5Test.so").exists())
        self.assertIn("--sdk-dir " + str(self.tmp / "openharmony"), (self.tmp / "args.txt").read_text())
        self.assertIn("libApp.so", (self.project / "entry/src/main/ets/common/QtAppConstants.ets").read_text())
        self.assertEqual(report["third_party_copied"], ["libboost_regex.so.1.92.0"])

    def test_unresolved_library_and_stale_link_stop_the_deploy(self):
        self.library.write_bytes(make_elf(["libQt5Core.so", "libicuuc.so.74"]))
        old = time.time() - 120
        os.utime(self.library, (old, old))
        code, report = self.deploy()
        self.assertEqual(code, 1)
        text = " ".join(report["problems"])
        self.assertIn("libicuuc.so.74", text)
        self.assertIn("[KI-021] stale application library", text)
        self.assertFalse((self.tmp / "args.txt").exists())

    def test_sdk_dir_must_be_the_openharmony_root(self):
        sdk = self.tmp / "openharmony"
        write_env(self.profile, short_cache_dir=str(self.tmp / "short"),
                  paths={"qt_sdk": str(self.tmp / "qt"), "native_sdk": str(sdk / "native")},
                  env_set={"OHOS_SDK_DIR": str(sdk / "native"), "OHOS_DEPLOY_ARGS": str(self.tmp / "args.txt")})
        code, report = self.deploy("--dry-run")
        self.assertEqual(code, 1)
        self.assertTrue(any("KI-020" in problem for problem in report["problems"]), report)

    def test_plan_rejects_make_ohosdeploy(self):
        import batch_checks
        problems = batch_checks.plan_problems([{"name": "deploy", "command": "mingw32-make ohosdeploy"}])
        self.assertTrue(any("KI-019" in problem for problem in problems), problems)


class PreflightTest(Temp):
    def make(self, pro: str) -> Path:
        app = self.tmp / "app"
        (app / "sub").mkdir(parents=True, exist_ok=True)
        (app / "Demo.pro").write_text(pro, encoding="utf-8")
        (app / "main.cpp").write_text('#include "main.h"\nMain::Main() {}\nint main() {}\n', encoding="utf-8")
        (app / "main.h").write_text("class Main : public QObject {\n    Q_OBJECT\npublic:\n    Main();\n};\n", encoding="utf-8")
        (app / "sub" / "a.h").write_text(
            "// class Old { Q_OBJECT };\nclass Orphan : public QObject\n{\n    Q_OBJECT\npublic:\n    Orphan();\n"
            "    ~Orphan();\n    void paint() const;\n};\n", encoding="utf-8")
        (app / "macpro").mkdir(exist_ok=True)
        (app / "macpro" / "Mac.pro").write_text("QT += macextras\nHEADERS += *.h\n", encoding="utf-8")
        return app

    def codes(self, report: dict, severity: str = "error") -> list[str]:
        return sorted(f["code"] for f in report["findings"] if f["severity"] == severity)

    def test_finds_the_generic_traps(self):
        app = self.make(PRO)
        report = preflight.static_preflight(app, {"core", "gui", "widgets", "network"})
        self.assertEqual(self.codes(report), sorted([
            "PF-QT-MODULE", "PF-EMPTY-GLOB", "PF-ORPHAN-QOBJECT", "PF-UNIX-LEAK", "PF-UNIX-LEAK", "PF-TARGET-PATH"]))
        orphan = next(f for f in report["findings"] if f["code"] == "PF-ORPHAN-QOBJECT")
        self.assertIn("Orphan", orphan["message"])
        self.assertEqual(orphan["known_issue"], "KI-008")
        # Projects not reachable from the top-level .pro only warn.
        self.assertIn("PF-QT-MODULE", self.codes(report, "warn"))

    def test_condition_and_brace_on_separate_lines(self):
        app = self.make("TEMPLATE = app\nTARGET = Demo\nQT += core\nunix:!ohos\n{\n    LIBS += -L/home/me/x -lfoo\n}\n"
                        "ohos {\n    target.path = $$OUT_PWD\n    INSTALLS += target\n}\n")
        report = preflight.static_preflight(app, {"core"})
        brace = [f for f in report["findings"] if f["code"] == "PF-SCOPE-BRACE"]
        self.assertEqual(len(brace), 1, report["findings"])
        self.assertEqual((brace[0]["line"], brace[0]["known_issue"], brace[0]["severity"]), (4, "KI-023", "error"))
        self.assertIn("unix:!ohos {", brace[0]["fix"])
        same_line = self.make("TEMPLATE = app\nTARGET = Demo\nQT += core\nunix:!ohos {\n    LIBS += -lfoo\n}\n"
                              "ohos {\n    target.path = $$OUT_PWD\n    INSTALLS += target\n}\n")
        self.assertNotIn("PF-SCOPE-BRACE", self.codes(preflight.static_preflight(same_line, {"core"})))

    def test_fixed_project_is_clean(self):
        app = self.make(FIXED_PRO)
        (app / "sub" / "a.cpp").write_text("Orphan::Orphan() {}\nOrphan::~Orphan() {}\nvoid Orphan::paint() const {}\n")
        report = preflight.static_preflight(app, {"core", "gui", "widgets"})
        self.assertEqual(self.codes(report), [])

    def test_configured_audit(self):
        build = self.tmp / "build"
        build.mkdir()
        (build / "Makefile").write_text("CXX = clang++ --target=aarch64-linux-ohos --sysroot=/s\nTARGET = libDemo.so\n"
                                        "LFLAGS = -shared\nLIBS = -lQt5Core -lQt5Gui\n", encoding="utf-8")
        report = preflight.configured_audit(build, "libDemo.so", {"core", "gui"})
        self.assertEqual(report["findings"], [])
        (build / "Makefile").write_text("CXX = clang++ --target=aarch64-linux-ohos --sysroot=/s\nTARGET = Demo\n"
                                        "LIBS = -lgomp -lQt5XmlPatterns\n", encoding="utf-8")
        report = preflight.configured_audit(build, "libDemo.so", {"core", "gui"})
        self.assertEqual(sorted(f["code"] for f in report["findings"]),
                         ["PF-CFG-APP-LIBRARY", "PF-CFG-LEAK", "PF-CFG-NOT-SHARED", "PF-CFG-QT-MODULE"])


# --------------------------------------------------------------------------- ledger CLI

class LedgerTest(Temp):
    def setUp(self):
        super().setUp()
        self.root = make_app(self.tmp)

    def test_add_update_and_close_task(self):
        cap = ledger.add_row(self.root, "inventory.tsv", {"category": "qt-module", "disposition": "guarded-adaptation",
                                                          "found_by": "preflight: PF-QT-MODULE-01\tsplit"})
        self.assertEqual(cap, "INV-002")
        queue = ledger.add_row(self.root, "tasks.tsv", {"task": "drop module", "status": "planned",
                                                             "inventory_ids": cap, "validation_ids": "VAL-001"})
        self.assertEqual(queue, "TASK-002")
        with self.assertRaises(SystemExit):
            ledger.add_row(self.root, "tasks.tsv", {"task": "x"}, "INV-Q001")
        with self.assertRaises(SystemExit):
            ledger.add_row(self.root, "validation.tsv", {"scenario": "x"}, "INV-9")
        with self.assertRaises(SystemExit):
            ledger.add_row(self.root, "inventory.tsv", {"nonexistent": "x"})
        with self.assertRaises(SystemExit):
            ledger.add_row(self.root, "inventory.tsv", {"status": "planned"})  # inventory rows have no status
        with self.assertRaises(SystemExit):
            ledger.add_row(self.root, "diagnostics.tsv", {"symptom": "x"})
        validation_before = read_tsv(self.root / "validation.tsv")
        inventory_before = read_tsv(self.root / "inventory.tsv")
        ledger.update_row(self.root, "tasks.tsv", queue, {"status": "passed", "evidence": "batch b1 passed"})
        # Each ledger keeps its own state: closing a TASK touches neither its INV nor its VAL rows.
        self.assertEqual(read_tsv(self.root / "validation.tsv"), validation_before)
        self.assertEqual(read_tsv(self.root / "inventory.tsv"), inventory_before)
        rows = {r["id"]: r for r in inventory_before}
        self.assertNotIn("status", rows[cap])
        self.assertNotIn("\t", rows[cap]["found_by"])
        ledger.update_row(self.root, "tasks.tsv", queue, append={"evidence": "; reviewed"})
        self.assertTrue(read_tsv(self.root / "tasks.tsv")[-1]["evidence"].endswith("; reviewed"))
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertNotIn("columns, header", out)

    def test_get_and_list_read_any_ledger(self):
        ledger.add_row(self.root, "tasks.tsv", {"task": "a", "status": "planned"})
        ledger.add_row(self.root, "tasks.tsv", {"task": "b", "status": "passed"})
        total, rows = ledger.select_rows(self.root, "tasks.tsv", ["status=planned,in-progress"], ["id", "task"])
        self.assertTrue(total >= 1)
        self.assertIn({"id": "TASK-002", "task": "a"}, rows)
        self.assertNotIn("TASK-003", [row["id"] for row in rows])
        _, rows = ledger.select_rows(self.root, "tasks.tsv", ["status!=planned"], ["id"])
        self.assertIn({"id": "TASK-003"}, rows)
        with self.assertRaises(SystemExit):
            ledger.select_rows(self.root, "tasks.tsv", ["nope=1"])
        # Script-owned ledgers are readable, only not writable through ledger.py.
        code, out = run_main(ledger, "list", str(self.root), "diagnostics.tsv", "--limit", "1")
        self.assertEqual(code, 0, out)
        self.assertIn("diagnostics.tsv:", out)
        code, out = run_main(ledger, "get", str(self.root), "tasks.tsv", "TASK-002", "TASK-003")
        self.assertEqual([row["id"] for row in json.loads(out)], ["TASK-002", "TASK-003"])

    def test_state_writes_only_agent_fields(self):
        changed = ledger.update_state(self.root, {"Next executable action": "run app-2", "Assessment": "ready (contract frozen)",
                                                  "Deciding risk": "qscint links on OHOS"},
                                      {"HarmonyOS output project": "D:/app/project"}, {"HarmonyOS output project": "user request"})
        self.assertEqual(len(changed), 5)
        text = (self.root / "STATE.md").read_text(encoding="utf-8")
        self.assertIn("- Next executable action: run app-2", text)
        self.assertIn("- Assessment: `ready` (contract frozen)", text)
        self.assertIn("- Deciding risk: qscint links on OHOS", text)
        self.assertIn("| HarmonyOS output project | D:/app/project | user request |", text)
        self.assertEqual(phase_gate.ASSESSMENT_RE.search(text).group(1), "ready")
        for field in ("Current phase", "Last gate"):
            with self.assertRaises(SystemExit):
                ledger.update_state(self.root, {field: "x"}, {}, {})
        with self.assertRaises(SystemExit):
            ledger.update_state(self.root, {"Assessment": "great"}, {}, {})
        with self.assertRaises(SystemExit):
            ledger.update_state(self.root, {"Completion tier": "installed-ish"}, {}, {})
        ledger.update_state(self.root, {"Completion tier": "installed-launched (VAL-004 not run)"}, {}, {})
        self.assertIn("- Completion tier: `installed-launched` (VAL-004 not run)",
                      (self.root / "STATE.md").read_text(encoding="utf-8"))
        with self.assertRaises(SystemExit):
            ledger.update_state(self.root, {}, {"Nope": "x"}, {})

    def test_documents_keep_no_ledger_data(self):
        row_id = ledger.add_row(self.root, "decisions.tsv", {"question": "Bundle name?"})
        # The ledger is the only copy; the views read it when they are printed.
        self.assertNotIn(row_id, (self.root / "STATE.md").read_text(encoding="utf-8"))
        code, out = run_main(ledger, "state", str(self.root))
        self.assertEqual(code, 0, out)
        for heading in ("## Gate", "## Progress", "## Environment (environment.tsv)", "## Environment smoke (env-smoke.json)",
                        "## Decisions (decisions.tsv)", "## External features (features.tsv)"):
            self.assertIn(heading, out)
        self.assertIn(f"- {row_id} Bundle name? -> not answered", out)
        self.assertIn("## Capability dispositions (inventory.tsv)", out)
        ledger.update_row(self.root, "decisions.tsv", row_id, {"answer": "com.example.app", "owner": "user"})
        code, out = run_main(ledger, "state", str(self.root))
        self.assertIn(f"- {row_id} Bundle name? -> user: com.example.app", out)
        templates = Path(ledger.TEMPLATES)
        self.assertFalse((templates / "assessment.md").exists())
        self.assertFalse((templates / "PORTING_CONTRACT.md").exists())

    def test_contract_gate_needs_the_scope_filled(self):
        state = self.root / "STATE.md"
        text = state.read_text(encoding="utf-8")
        state.write_text(text.replace("| Application target | app | CMakeLists.txt |", "| Application target | TODO | TODO |"),
                         encoding="utf-8")
        self.assertEqual(phase_gate.evaluate(self.root, "inventory"), [])
        errors = phase_gate.evaluate(self.root, "decisions")
        self.assertTrue(any("STATE.md Scope still has TODO in: Application target" in e for e in errors), errors)
        ledger.update_state(self.root, {}, {"Application target": "app"}, {"Application target": "TARGET in CMakeLists.txt"})
        self.assertEqual(phase_gate.evaluate(self.root, "decisions"), [])


class SourceRevisionTest(Temp):
    """init_migration.py records the starting source revision in STATE.md instead of a baseline ledger."""

    def test_records_head_and_dirty_paths_outside_the_ledger(self):
        app = self.tmp / "app"
        (app / "src").mkdir(parents=True)
        (app / "CMakeLists.txt").write_text("project(demo)\n", encoding="utf-8")
        (app / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")
        value, _ = init_migration.source_revision(app)
        self.assertEqual(value, "not a git checkout")
        if shutil.which("git") is None:
            self.skipTest("git not installed")
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
        subprocess.run(git + ["init", "-q"], cwd=app, check=True)
        subprocess.run(git + ["add", "CMakeLists.txt", "src"], cwd=app, check=True)
        subprocess.run(git + ["commit", "-qm", "init"], cwd=app, check=True)
        (app / "src" / "main.cpp").write_text("int main() { return 1; }\n", encoding="utf-8")
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=app, capture_output=True, text=True).stdout.strip()
        # The repository itself is the output container: its migration/ is not a source change.
        code, out = run_script("init_migration.py", "--target", str(app), "--output-project", str(app),
                               "--template-root", str(REPO / "assets" / "templates" / "migration" / "ohos"))
        self.assertEqual(code, 0, out)
        text = (app / "migration" / "ohos" / "STATE.md").read_text(encoding="utf-8")
        self.assertIn(f"| Source revision at start | {head[:12]}; dirty: src/main.cpp |", text)


class OutputLayoutInitTest(Temp):
    """init_migration.py puts the ledger into the output container and records the Qt source root."""

    def test_ledger_goes_into_the_container_and_the_project_waits_for_decisions(self):
        app = self.tmp / "repo"
        (app / "how_build").mkdir(parents=True)
        (app / "how_build" / "CMakeLists.txt").write_text("project(NotePad--)\n", encoding="utf-8")
        (app / "src").mkdir()
        (app / "src" / "RealCompare.pro").write_text("TARGET = Notepad--\n", encoding="utf-8")
        container = self.tmp / "out"
        code, out = run_script("init_migration.py", "--target", str(app), "--output-project", str(container),
                               "--template-root", str(REPO / "assets" / "templates" / "migration" / "ohos"))
        self.assertEqual(code, 0, out)
        root = container.resolve() / "migration" / "ohos"
        self.assertFalse((app / "migration").exists())
        text = (root / "STATE.md").read_text(encoding="utf-8")
        self.assertEqual(ohos_env.source_root(root), app.resolve())
        # init never guesses the project directory from whichever build file it meets first.
        self.assertIn("| HarmonyOS output project | TODO | TODO |", text)
        self.assertIn("| Application target | TODO | TODO |", text)
        # The container is not checked: the Qt repository root itself may be the container.
        code, out = run_script("init_migration.py", "--target", str(app), "--output-project", str(app / "src"),
                               "--template-root", str(REPO / "assets" / "templates" / "migration" / "ohos"))
        self.assertEqual(code, 0, out)
        self.assertTrue((app / "src" / "migration" / "ohos" / "STATE.md").is_file())


# --------------------------------------------------------------------------- closure

class ClosureTest(Temp):
    FAKE = r'''
import json, sys
args = [a for a in sys.argv[1:] if a != "--compact"]
state = sys.argv[0] + ".state"
import os
ingested = os.path.exists(state)
cmd = args[0]
if cmd == "stats":
    print(json.dumps({"nodes": 5000 if ingested else 3}))
elif cmd == "ingest":
    open(state, "w").write("1"); print(json.dumps({"ok": True}))
elif cmd == "scan":
    print(json.dumps({"app_id": "app:demo", "name": "demo"}))
elif cmd == "analyze":
    print(json.dumps({"verdict": "blocked", "blockers": [{"kind": "iface", "node": "X11", "reason": "r"}], "unknowns": [
        {"kind": "lib", "node": "a", "reason": "r"}, {"kind": "lib", "node": "b", "reason": "r"}]}))
elif cmd == "deps":
    print(json.dumps({"deps": []}))
elif cmd == "fetch-deps":
    if "--dry-run" in args:
        print(json.dumps({"closure_size": 3, "summary": {"would_download": 2, "need_port": 1}}))
    else:
        print("[1/3] progress line")
        print(json.dumps({"closure_size": 3, "summary": {"downloaded": 1, "failed": 1, "need_port": 1},
                          "deps": [{"name": "boost", "status": "failed", "error": "Errno 2 .staging"},
                                   {"name": "qscint", "status": "need_port"}]}))
'''

    def test_sequence_counts_and_libs_dir(self):
        root = make_app(self.tmp)
        fake = self.tmp / "portgraph.py"
        fake.write_text(self.FAKE, encoding="utf-8")
        write_env(root, short_cache_dir=str(self.tmp / "short"))
        code, out = run_script("closure.py", "--migration-root", str(root), "--portgraph", str(fake))
        self.assertEqual(code, 1, out)  # one failed row
        summary = json.loads((root / "closure" / "summary.json").read_text())
        self.assertEqual(summary["triggers"]["judgment"]["value"], 3)
        self.assertEqual(summary["triggers"]["fetch"]["value"], 1)
        self.assertEqual(summary["triggers"]["cross_compile"]["value"], 2)
        self.assertEqual(summary["libs_dir"], str(self.tmp / "short" / "ohos-libs"))
        self.assertIn("judgment = analyze.blockers(1) + analyze.unknowns(2) = 3 -> DISPATCH", out)
        self.assertTrue((root / "closure" / "ingest.out.log").is_file())  # graph was empty -> ingested once
        # A portgraph without the scanner package: the closure still completes and says why.
        self.assertIn("error", summary["interface_hits"])
        self.assertIn("interface hits: not listed", out)

    def test_interface_hits_list_every_location_compiled_on_ohos(self):
        app = self.tmp / "app"
        (app / "src").mkdir(parents=True)
        (app / "app.pro").write_text("TEMPLATE = app\nSOURCES += src/main.cpp\n", encoding="utf-8")
        (app / "src" / "main.cpp").write_text(
            "#include <QApplication>\n"
            "#ifdef Q_OS_WIN\n#include <windows.h>\nstatic HWND guarded;\n#endif\n"
            "static HWND unguarded;\n"
            "// ::SendMessage(hwnd, WM_NOTIFY, 0, 0);\n"
            "int main() { return 0; }\n", encoding="utf-8")
        result = closure.interface_hits(app, closure.PORTGRAPH)
        located = {(hit["file"].replace("\\", "/"), hit["line"]): hit for hit in result["hits"]}
        self.assertIn(("src/main.cpp", 6), located)
        self.assertEqual(located[("src/main.cpp", 6)]["likely_false_positive"], "")
        self.assertEqual(located[("src/main.cpp", 7)]["likely_false_positive"], "comment")
        self.assertNotIn(("src/main.cpp", 3), located)  # Q_OS_WIN only: not compiled on OHOS
        self.assertGreaterEqual(result["counts"].get("platform-excluded", 0), 2)
        self.assertEqual(result["likely_real"], 1)


# --------------------------------------------------------------------------- gates

class GateRulesTest(Temp):
    def setUp(self):
        super().setUp()
        self.root = make_app(self.tmp)

    def test_baseline_needs_profile_and_smoke(self):
        (self.root / "environment.tsv").unlink()
        (self.root / "env-smoke.json").unlink()
        errors = phase_gate.evaluate(self.root, "environment")
        self.assertTrue(any("environment.tsv has no rows" in e for e in errors))
        self.assertTrue(any("env-smoke.json is missing" in e for e in errors))
        # A passed gate does not exempt a phase from its rules.
        pass_phases(self.root, "environment")
        self.assertTrue(any("env-smoke.json is missing" in e for e in phase_gate.evaluate(self.root, "environment")))

    def test_inventory_needs_preflight_ids_in_rows(self):
        (self.root / "preflight.json").write_text(json.dumps({"findings": [
            {"id": "PF-TARGET-PATH-01", "severity": "error"}, {"id": "PF-QT-MODULE-01", "severity": "warn"}]}))
        errors = phase_gate.evaluate(self.root, "inventory")
        self.assertTrue(any("PF-TARGET-PATH-01" in e for e in errors), errors)
        # Only found_by counts, not a PF id mentioned anywhere else in the row.
        ledger.update_row(self.root, "inventory.tsv", "INV-001", append={"cause": "fixes PF-TARGET-PATH-01"})
        self.assertTrue(any("PF-TARGET-PATH-01" in e for e in phase_gate.evaluate(self.root, "inventory")))
        ledger.update_row(self.root, "inventory.tsv", "INV-001", append={"found_by": "; preflight: PF-TARGET-PATH-01"})
        self.assertEqual(phase_gate.evaluate(self.root, "inventory"), [])

    def test_preflight_false_positive_is_waived_not_an_inventory_row(self):
        app = self.tmp / "waived-app"
        app.mkdir()
        (app / "demo.pro").write_text("TEMPLATE = app\nSOURCES += main.cpp\n", encoding="utf-8")
        (app / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")
        code, out = run_main(preflight, "--migration-root", str(self.root), "--app", str(app))
        self.assertEqual(code, 1, out)
        report = json.loads((self.root / "preflight.json").read_text(encoding="utf-8"))
        ids = [f["id"] for f in report["findings"] if f["severity"] == "error"]
        self.assertTrue(ids, report)
        self.assertTrue(any(ids[0] in e for e in phase_gate.evaluate(self.root, "inventory")))
        code, out = run_main(preflight, "--migration-root", str(self.root), "--app", str(app), "--waive", "PF-NOPE-01=x")
        self.assertNotEqual(code, 0)
        self.assertIn("names no error finding", out)
        waive = [arg for finding_id in ids for arg in ("--waive", f"{finding_id}=checked: not a problem here")]
        code, out = run_main(preflight, "--migration-root", str(self.root), "--app", str(app), *waive)
        self.assertEqual(code, 0, out)
        report = json.loads((self.root / "preflight.json").read_text(encoding="utf-8"))
        self.assertTrue(all(f.get("waived") for f in report["findings"] if f["severity"] == "error"))
        self.assertEqual(phase_gate.evaluate(self.root, "inventory"), [])

    def test_inventory_found_by_is_not_gated(self):
        # found_by is the agent's record of where a row came from; its format is no gate condition.
        ledger.update_row(self.root, "inventory.tsv", "INV-001", {"found_by": "grep: whatever"})
        self.assertEqual(phase_gate.evaluate(self.root, "inventory"), [])

    def test_tasks_gate_needs_every_task_closed(self):
        self.assertEqual(phase_gate.evaluate(self.root, "tasks"), [])
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "in-progress"})
        errors = phase_gate.evaluate(self.root, "tasks")
        self.assertTrue(any("tasks.tsv rows are still open: TASK-001" in e for e in errors), errors)
        self.assertFalse(any("inventory" in e for e in errors), errors)
        # The decisions gate is satisfied by that open TASK row.
        self.assertEqual(phase_gate.evaluate(self.root, "decisions"), [])
        # A blocked TASK waits for the user; the answer makes it accepted-limitation.
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "blocked", "evidence": "needs the user's device"})
        errors = phase_gate.evaluate(self.root, "tasks")
        self.assertTrue(any("blocked, waiting for the user: TASK-001" in e for e in errors), errors)
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "accepted-limitation",
                                                               "evidence": "DEC-001: the user accepts it"})
        self.assertEqual(phase_gate.evaluate(self.root, "tasks"), [])

    def test_no_gate_passes_while_the_assessment_waits_for_the_user(self):
        for verdict in ("blocked", "not-recommended"):
            ledger.update_state(self.root, {"assessment": verdict}, {}, {})
            for phase in phase_gate.PHASES:
                errors = phase_gate.evaluate(self.root, phase)
                self.assertEqual([e for e in errors if "Assessment" in e],
                                 [e for e in errors if f"Assessment is '{verdict}', waiting for the user" in e], phase)
                self.assertEqual(len([e for e in errors if "Assessment" in e]), 1, phase)
        ledger.update_state(self.root, {"assessment": "ready"}, {}, {})
        self.assertEqual(phase_gate.evaluate(self.root, "validation"), [])
        # Before the decisions phase an unset Assessment is fine; from it on only ready passes.
        state = self.root / "STATE.md"
        state.write_text("\n".join("- Assessment: `TODO`" if line.startswith("- Assessment:") else line
                                   for line in state.read_text(encoding="utf-8").splitlines()) + "\n", encoding="utf-8")
        self.assertEqual(phase_gate.evaluate(self.root, "inventory"), [])
        self.assertTrue(any("requires ready" in e for e in phase_gate.evaluate(self.root, "decisions")))

    def test_blocked_problem_waits_for_the_users_answer(self):
        self.assertEqual(phase_gate.evaluate(self.root, "diagnostics"), [])
        ledger.write_ledger(self.root / "diagnostics.tsv", ["id", "location", "symptom", "cause", "reproduce", "fix", "status"], [
            {"id": "DIAG-001", "location": "device: launch", "symptom": "crash", "cause": "no GPU driver",
             "reproduce": "hdc", "fix": "", "status": "blocked"}])
        errors = phase_gate.evaluate(self.root, "diagnostics")
        self.assertTrue(any("DIAG-001 is blocked, waiting for the user" in e for e in errors), errors)
        diagnostics = str(self.root / "diagnostics.tsv")
        code, out = run_script("record_diagnostic.py", diagnostics, "--id", "DIAG-001", "--status", "accepted-limitation")
        self.assertNotEqual(code, 0)
        self.assertIn("--fix", out)
        code, out = run_script("record_diagnostic.py", diagnostics, "--id", "DIAG-001", "--status", "accepted-limitation",
                               "--fix", "user accepted: software rendering only")
        self.assertEqual(code, 0, out)
        self.assertEqual(phase_gate.evaluate(self.root, "diagnostics"), [])

    def test_progress_follows_the_ledgers_of_the_open_phase(self):
        state = self.root / "STATE.md"
        state.write_text(state.read_text(encoding="utf-8").replace("- Current phase: `TODO`", "- Current phase: `tasks`")
                         .replace("| Tasks (`tasks`, tasks.tsv) | planned |", "| Tasks (`tasks`, tasks.tsv) | in-progress |"),
                         encoding="utf-8")
        pass_phases(self.root, "environment", "inventory", "decisions")

        def progress():
            return gate_state._progress_statuses(state.read_text(encoding="utf-8").splitlines(keepends=True))["tasks"]

        # An open problem: failed; a blocked TASK row: blocked (waiting for the user wins).
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "in-progress"})
        self.assertEqual(progress(), "in-progress")
        code, out = run_script("record_diagnostic.py", str(self.root / "diagnostics.tsv"), "--id", "new",
                               "--location", "build: make", "--symptom", "error: x")
        self.assertEqual(code, 0, out)
        self.assertEqual(progress(), "failed")
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "blocked"})
        self.assertEqual(progress(), "blocked")
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "in-progress"})
        run_script("record_diagnostic.py", str(self.root / "diagnostics.tsv"), "--id", "DIAG-002",
                   "--cause", "x", "--fix", "y", "--status", "fixed")
        self.assertEqual(progress(), "in-progress")
        # A problem only the user can solve that stops the migration: Assessment blocked.
        ledger.update_state(self.root, {"assessment": "blocked"}, {}, {})
        self.assertEqual(progress(), "blocked")
        ledger.update_state(self.root, {"assessment": "ready"}, {}, {})
        self.assertEqual(progress(), "in-progress")
        # The Gate column keeps each phase's own verdict; a READY gate also covers earlier phases.
        gate_state.record_gate(self.root, "tasks", ["tasks.tsv rows are still open: TASK-001"], "test")
        text = state.read_text(encoding="utf-8")
        self.assertRegex(text, r"\| Tasks \(`tasks`, tasks.tsv\) \| in-progress \| NOT-READY @\S+ \(1 unmet: tasks.tsv rows are still open: TASK-001\) \|")
        self.assertIn("- Last gate: `NOT-READY tasks`", text)
        # A passed phase is never rewritten.
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "passed", "evidence": "b1"})
        gate_state.record_gate(self.root, "tasks", [], "test")
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "blocked"})
        self.assertEqual(progress(), "passed")
        text = state.read_text(encoding="utf-8")
        self.assertRegex(text, r"\| Tasks \(`tasks`, tasks.tsv\) \| passed \| READY @\S+ \|")
        self.assertRegex(text, r"\| Environment \(`environment`, environment.tsv\) \| \S+ \| READY @\S+ \|")
        self.assertRegex(text, r"\| Diagnostics \(`diagnostics`, diagnostics.tsv\) \| blocked \|\s+\|")

    def test_task_status_values_and_closed_task_needs_evidence(self):
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "done"})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("task TASK-001 has unknown status 'done'", out)
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"status": "passed", "evidence": ""})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("task TASK-001 is passed without evidence", out)
        ledger.update_row(self.root, "tasks.tsv", "TASK-001", {"evidence": "batch b1 passed"})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertNotIn("TASK-001", out)

    def test_every_inventory_row_is_named_by_a_queue_row(self):
        # Even a row that turns out not to matter: its outcome is the TASK row (and VAL rows) that names it.
        ledger.add_row(self.root, "inventory.tsv", {"category": "qt-module", "location": "build-file: app.pro:3",
                                                    "cause": "macOS-only module", "found_by": "closure: blocker",
                                                    "disposition": "packaging-only"})
        self.assertTrue(any("INV-002 is not named by any TASK row" in e
                            for e in phase_gate.evaluate(self.root, "inventory")))
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertNotIn("INV-002", out)
        # An exception list: no "unchanged"/"not-applicable"/"blocked" disposition (blocked is a TASK status);
        # a handling the user chooses is needs-decision, never rewritten to the answer.
        for value in ("decision", "unchanged", "not-applicable", "blocked", "unknown", "degraded-approved"):
            ledger.update_row(self.root, "inventory.tsv", "INV-002", {"disposition": value})
            code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
            self.assertIn(f"inventory INV-002 has unknown disposition '{value}'", out)
        ledger.update_row(self.root, "inventory.tsv", "INV-002", {"disposition": "needs-decision"})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertNotIn("INV-002", out)

    def connect_device(self, status: str = "ok") -> None:
        """environment.tsv as env_probe.py writes it with (ok) or without (warn) a connected device."""
        write_env(self.root, status={"device": status})

    def test_smoke_runtime_at_environment_and_configured_audit_at_implementation(self):
        write_tsv(self.root / "device-runs.tsv", [])
        self.connect_device()
        smoke = self.root / "env-smoke.json"
        receipt = json.loads(smoke.read_text(encoding="utf-8"))
        smoke.write_text(json.dumps({**receipt, "runtime": {"status": "not-covered", "reason": "signing not possible"}}),
                         encoding="utf-8")
        errors = phase_gate.evaluate(self.root, "environment")
        self.assertTrue(any("connected device but env-smoke.json has no passed runtime (signing not possible)" in e
                            for e in errors), errors)
        # Without a connected device install/launch stay unverified; no gate waits for them.
        self.connect_device("warn")
        self.assertEqual(phase_gate.evaluate(self.root, "decisions"), [])
        self.connect_device()
        # The smoke test's passed runtime (env-smoke.json) proves the device.
        smoke.write_text(json.dumps({**json.loads(smoke.read_text(encoding="utf-8")), "runtime": {"status": "passed"}}),
                         encoding="utf-8")
        self.assertEqual(phase_gate.evaluate(self.root, "decisions"), [])
        # ...but not the application's own HAP that diagnostics needs.
        self.assertTrue(any("device-runs.tsv has no application HAP" in e
                            for e in phase_gate.evaluate(self.root, "diagnostics")))
        (self.root / "preflight-configured.json").write_text(json.dumps({"findings": [
            {"id": "PF-CFG-NOT-SHARED-01", "severity": "error", "message": "main target is an executable"}]}))
        self.assertTrue(any("PF-CFG-NOT-SHARED-01" in e for e in phase_gate.evaluate(self.root, "tasks")))
        self.assertEqual(phase_gate.evaluate(self.root, "decisions"), [])
        (self.root / "preflight-configured.json").unlink()
        self.assertTrue(any("preflight-configured.json is missing" in e
                            for e in phase_gate.evaluate(self.root, "tasks")))

    def test_device_runs_status_gates_diagnostics_and_validation(self):
        [row] = read_tsv(self.root / "device-runs.tsv")
        expected = {"hap-failed": "failed hap_check.py", "checked": "has not run on the device", "run": None, "no-device": None}
        for status, message in expected.items():
            write_tsv(self.root / "device-runs.tsv", [{**row, "status": status}])
            for phase in ("diagnostics", "features", "validation"):
                errors = phase_gate.evaluate(self.root, phase)
                if message:
                    self.assertTrue(any(message in e for e in errors), (status, phase, errors))
                else:
                    self.assertEqual(errors, [], (status, phase))
        # The validation gate needs the HAP still on disk.
        Path(row["hap"].rsplit(" (", 1)[0]).unlink()
        self.assertEqual(phase_gate.evaluate(self.root, "diagnostics"), [])
        self.assertTrue(any("is gone" in e for e in phase_gate.evaluate(self.root, "validation")))
        # validate_ledgers: one row, known status.
        write_tsv(self.root / "device-runs.tsv", [row, {**row, "id": "DEV-RUN-002", "status": "done"}])
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("device-runs.tsv has 2 rows", out)
        self.assertIn("unknown status 'done'", out)

    def test_baseline_needs_a_passed_env_smoke(self):
        self.assertEqual(phase_gate.evaluate(self.root, "environment"), [])
        smoke = self.root / "env-smoke.json"
        receipt = json.loads(smoke.read_text(encoding="utf-8"))
        smoke.write_text(json.dumps({**receipt, "status": "failed", "summary": "failed at make"}), encoding="utf-8")
        self.assertTrue(any("env-smoke.json reports failed: failed at make" in e
                            for e in phase_gate.evaluate(self.root, "environment")))

    def test_decisions_are_a_plain_answer_store(self):
        # Unanswered questions and answers chosen for the user never block a gate.
        ledger.add_row(self.root, "decisions.tsv", {"question": "bundleName?"})
        ledger.add_row(self.root, "decisions.tsv", {"question": "Open folder on OHOS?",
                                                    "answer": "hide on OHOS (Recommended)", "owner": "agent-default"})
        for phase in phase_gate.PHASES:
            self.assertEqual(phase_gate.evaluate(self.root, phase), [], phase)
        lines = next_step.pending_decisions(self.root)
        self.assertEqual(lines, ["- DEC-002: bundleName?"])
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertEqual(code, 0, out)
        # owner says who answered; it stays empty until there is an answer.
        ledger.update_row(self.root, "decisions.tsv", "DEC-002", {"owner": "user"})
        ledger.update_row(self.root, "decisions.tsv", "DEC-003", {"owner": "agent"})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("decision DEC-002 has no answer yet but owner 'user'", out)
        self.assertIn("decision DEC-003 has owner 'agent'", out)
        # validation.tsv status values are checked; only finished ones let validation pass.
        ledger.update_row(self.root, "validation.tsv", "VAL-001", {"status": "not-run"})
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("validation VAL-001 has unknown status 'not-run'", out)
        ledger.update_row(self.root, "validation.tsv", "VAL-001", {"status": "accepted-limitation"})
        self.assertFalse(any("unverified" in e for e in phase_gate.evaluate(self.root, "validation")))
        ledger.update_row(self.root, "validation.tsv", "VAL-001", {"status": "failed"})
        self.assertTrue(any("VAL-001" in e and "unverified" in e for e in phase_gate.evaluate(self.root, "validation")))
        # The removed assessment value is no longer accepted.
        state = (self.root / "STATE.md").read_text().replace("- Assessment: `ready`", "- Assessment: `ready-with-decisions`")
        (self.root / "STATE.md").write_text(state)
        self.assertTrue(any("requires ready" in e for e in phase_gate.evaluate(self.root, "tasks")))

    def test_old_ledger_layouts_are_reported(self):
        (self.root / "decisions.tsv").write_text(
            "id\tphase\tquestion\toptions\tselected\towner\tstatus\nDEC-001\tcontract\tQ\ta|b\ta\tuser\tapproved\n",
            encoding="utf-8")
        (self.root / "tasks.tsv").write_text(
            "id\tcapability\tstatus\tinventory_ids\tvalidation_ids\nCAP-Q001\tbuild\tpassed\tCAP-001\tVAL-001\n",
            encoding="utf-8")
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertNotEqual(code, 0)
        self.assertIn("decisions.tsv header differs from the skill template", out)
        self.assertIn("tasks.tsv header differs from the skill template", out)
        self.assertIn("invalid id prefix: CAP-Q001 (expected TASK-)", out)
        (self.root / "diagnostics.tsv").write_text(
            "id\tstage\tcategory\tstatus\nDIAG-001\tbuild\treceipt\tpassed\n", encoding="utf-8")
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("diagnostics.tsv header differs from the skill template", out)
        code, out = run_script("record_diagnostic.py", str(self.root / "diagnostics.tsv"), "--id", "DIAG-001", "--status", "fixed")
        self.assertNotEqual(code, 0)
        self.assertIn("not id, location, symptom", out)
        (self.root / "validation.tsv").write_text(
            "id\tscenario\tplatform\tstatus\nVAL-001\tlaunch\tohos\tnot-run\n", encoding="utf-8")
        code, out = run_script("validate_ledgers.py", str(self.root), "--no-skill-check")
        self.assertIn("validation.tsv header differs from the skill template", out)

    def test_next_step_schema(self):
        code, out = run_script("next_step.py", str(self.root), "--schema")
        self.assertEqual(code, 0, out)
        self.assertIn("idle_timeout", out)
        self.assertIn("devecocli_build.py", out)


# --------------------------------------------------------------------------- robustness regressions

class RobustnessTest(Temp):
    def test_inline_env_regex(self):
        import batch_checks
        hits = ["$env:PATH = 'x'", "$env:PATH += ';x'", 'set "PATH=x"', "export PATH=/x:$PATH", "PATH=/x make"]
        misses = ["cmake -DCMAKE_PREFIX_PATH=x", "LD_LIBRARY_PATH=x make", "curl a?b=1&path=/z", "echo PATH=$PATH",
                  "INCLUDEPATH+=x"]
        for text in hits:
            self.assertTrue(batch_checks.INLINE_ENV_RE.search(text), text)
        for text in misses:
            self.assertFalse(batch_checks.INLINE_ENV_RE.search(text), text)

    def test_ledger_reads_bom_files(self):
        root = make_app(self.tmp)
        path = root / "validation.tsv"
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        self.assertEqual(ledger.add_row(root, "validation.tsv", {"scenario": "x"}), "VAL-002")

    def test_stage_patch_tolerates_comments(self):
        text = '{\n  "products": [{\n    "compatibleSdkVersion": "5.0.0(12)"  // min\n  }]\n}\n'
        new, added = template_patch.patch_products_stage(text)
        self.assertEqual(added, 1)
        self.assertIn('"5.0.0(12)", // min', new)
        self.assertIn('"compatibleSdkVersionStage": "beta3"', new)

    def test_parse_json_with_trailing_text(self):
        import closure
        self.assertEqual(closure.parse_json('[1/2] x\n{"a": 1}\nmanifest: done\n'), {"a": 1})
        self.assertIsNone(closure.parse_json("no json"))

    def test_invalid_hap(self):
        bad = self.tmp / "bad.hap"
        bad.write_bytes(b"truncated")
        report = hap_check.check(bad, None, "libApp.so", "arm64-v8a", None, [])
        self.assertIn("not a valid HAP", report["problems"][0])

    @unittest.skipUnless(POSIX, "uses bash")
    def test_shell_key_runs_the_named_shell(self):
        root = make_app(self.tmp)
        pass_phases(root, "environment", "inventory", "decisions")
        plan = self.tmp / "plan.json"
        plan.write_text(json.dumps({"steps": [{"name": "b", "command": "echo $BASH_VERSION", "shell": "bash"}]}))
        code, out = run_script("batch_checks.py", str(plan), "--output-dir", str(root / "batches" / "out"),
                               "--cwd", str(self.tmp))
        self.assertEqual(code, 0, out)
        self.assertRegex((root / "batches" / "out" / "01-b.stdout.log").read_text(), r"\d+\.\d+")


if __name__ == "__main__":
    unittest.main()


class KnowledgeRepinTest(Temp):
    def test_changed_baseline_is_reported_and_repinned(self):
        target = self.tmp / "migration" / "ohos"
        code, out = run_script("sync_knowledge.py", "--target", str(target))
        self.assertEqual(code, 0, out)
        current = read_tsv(target / "knowledge-manifest.tsv")[0]["baseline_manifest_sha256"]
        rows = read_tsv(target / "knowledge-manifest.tsv")
        for row in rows:
            row["baseline_manifest_sha256"] = "old"
        rows[0]["used"] = "yes"
        rows[0]["source_sha256"] = "changed"
        write_tsv(target / "knowledge-manifest.tsv", rows)
        code, out = run_script("sync_knowledge.py", "--target", str(target))
        self.assertEqual(code, 0, out)
        self.assertIn("re-pinned", out)
        self.assertIn("[used]", out)
        repinned = read_tsv(target / "knowledge-manifest.tsv")
        self.assertEqual({row["baseline_manifest_sha256"] for row in repinned}, {current})
        self.assertEqual(repinned[0]["used"], "yes")

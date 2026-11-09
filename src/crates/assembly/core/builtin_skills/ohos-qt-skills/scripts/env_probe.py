#!/usr/bin/env python3
"""Probe the Qt/HarmonyOS toolchain and write the migration's environment table.

Replaces hand-probing in the environment phase. One run finds and checks every
environment item the migration needs, fixes the environment problems it can fix
without touching any SDK, and writes ``<root>/environment.tsv``: **one row per
environment item** (``vocab.ENV_ITEM_ORDER``) with its path, version, other
facts (``detail``), ``status`` (ok/fixed/warn/error/missing), the problem found
and what was done about it (``issue``, with KI ids) and ``command_env``: the
variables and PATH directories the skill's scripts inject into every external
tool they start (batch steps, devecocli, deploy, portgraph).
Every check belongs to an item; there is no row per check.

Items: the core items (``vocab.ENV_CORE_ITEMS``) are always written, ``missing``
when not found (``device`` only ``warn``: without a device the migration still
completes, only the device checks are skipped);
conditional items only when needed or found: ``llvm-mingw`` (Windows, the
Qt host tools or make need it), ``jbr`` (DevEco's Java runtime, when found),
``signing`` (when signing materials exist), ``cmake``/``ninja`` (a CMake application),
``qt-host`` (a Qt 6 SDK), ``qt-source`` (``--qt-source``, ``QT5_12_SRC`` /
``QT5_15_SRC``, or a template inside a Qt source tree) and ``tool:<name>``
(``--tools``, e.g. the host tools a third-party cross-compile needs). A rerun
keeps the conditional items of the previous table and probes them again.

Fixes applied (status ``fixed`` with the fix in ``issue``, never by editing an SDK):

* Qt host tools that cannot start for missing runtime DLLs (0xC0000135,
  known issue KI-002): the llvm-mingw ``bin`` that holds ``libc++.dll`` goes
  on the injected PATH;
* a native SDK path with spaces (KI-001): its 8.3 short form, else a junction
  in a space-free cache directory, becomes ``NATIVE_OHOS_SDK``; when the
  native SDK sits in the OpenHarmony SDK, the alias is made for that root, so
  ``OHOS_SDK_DIR`` (the root openharmonydeployqt needs, KI-020) is written too
  and ``NATIVE_OHOS_SDK`` is its ``native`` child;
* ``PYTHONIOENCODING=utf-8`` for Python tools on GBK consoles (KI-006).

``--qt-sdk``/``--template`` may name the bound kit directories; the SDK and
template inside them are found.

On Windows and macOS the ``deveco`` item is the DevEco Studio installation
(``DEVECO_HOME`` tells devecocli where it is). A HarmonyOS PC has no DevEco
Studio: the command line tools (devecocli, hvigor, ohpm, node) are on PATH and
``DEVECO_SDK_HOME`` names the SDK, which becomes the ``deveco`` item; the PC is
the device, so no device is listed.

    python scripts/env_probe.py --migration-root <container>/migration/ohos \
        [--qt-sdk <dir>] [--deveco-home <dir>] [--template <dir>] [--qt-source <dir>] [--tools perl,pkg-config]

Paths default to the BitFun intake environment (``QT5_12_OHOS_SDK``,
``OHOS_TEMPLATE_SRC``, ``DEVECO_HOME``/``DEVECO_SDK_HOME``, ``BITFUN_QT_MIGRATION_ROOT``) and
common install locations; ``--native-sdk``/``--llvm-mingw-bin`` override. The
machine cache is ``$BITFUN_QT_MIGRATION_ROOT/cache/ohos-qt-skills`` (or
``OHOS_QT_SKILLS_CACHE``); the ``host`` row's path is the space-free build and
download directory. Exit code 1 when an item is ``error`` or ``missing``.

environment.tsv is written only by this script, always as a whole table; never
edit it or put its variables into a batch plan. A problem is fixed in the
environment (the ``issue`` says how) and this script is run again. When the
environment changes (new SDK, new DevEco, moved template) rerun this script and
then env_smoke.py.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

import device_run
import ohos_env
import template_patch
from vocab import ENV_BLOCKING_STATUSES, ENV_CORE_ITEMS, ENV_ITEM_ORDER, ENV_STATUSES, ENV_TOOL_PREFIX

TEMPLATE_MARKERS = ("AppScope/app.json5", "build-profile.json5", "hvigorfile.ts",
                    "entry/build-profile.json5", "entry/src/main/module.json5", "hvigor/hvigor-config.json5")
DEVECO_GUESSES = ("C:/Program Files/Huawei/DevEco Studio", "D:/Program Files/Huawei/DevEco Studio",
                  "C:/software/DevEco Studio", "D:/software/DevEco Studio",
                  "/Applications/DevEco-Studio.app/Contents", str(Path.home() / "DevEco-Studio"))
DLL_NOT_FOUND = {3221225781, -1073741515}


def run(argv: list[str], env: dict[str, str], timeout: float = 60, cwd: str | None = None) -> tuple[int | None, str]:
    try:
        done = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=timeout, cwd=cwd,
                              encoding="utf-8", errors="replace")
        return done.returncode, (done.stdout or "") + (done.stderr or "")
    except FileNotFoundError as error:
        return None, str(error)
    except (OSError, subprocess.SubprocessError) as error:
        return None, str(error)


def first_existing(*paths: Path | str | None) -> Path | None:
    for path in paths:
        if path and Path(path).exists():
            return Path(path)
    return None


def env_path(*names: str) -> Path | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            value = value.split(os.pathsep)[0].strip().rstrip("/\\")
            if value.lower().endswith(("/bin", "\\bin")):
                value = value[:-4]
            if Path(value).exists():
                return Path(value)
    return None


def bitfun_root() -> Path | None:
    value = os.environ.get("BITFUN_QT_MIGRATION_ROOT")
    return Path(value) if value and Path(value).is_dir() else None


def qt_sdk_under(root: Path) -> Path:
    """The Qt OHOS SDK at or below ``root``: a bound toolchain may be a kit
    directory that holds the SDK (``<kit>/Qt-5.12.12-.../bin/qmake``)."""
    if (root / "bin" / ohos_env.exe("qmake")).is_file() or not root.is_dir():
        return root
    for depth in ("*", "*/*", "*/*/*"):
        for qmake in sorted(root.glob(f"{depth}/bin/{ohos_env.exe('qmake')}")):
            if (qmake.parent.parent / "mkspecs" / "ohos-clang").is_dir():
                return qmake.parent.parent
    return root


def find_qt_sdk(explicit: Path | None) -> Path | None:
    if explicit:
        return qt_sdk_under(Path(explicit))
    found = env_path("QT5_12_OHOS_SDK", "QT_OHOS_SDK", "QT_SDK")
    if found:
        return qt_sdk_under(found)
    qmake = shutil.which("qmake")
    if qmake and (Path(qmake).parent.parent / "mkspecs" / "ohos-clang").is_dir():
        return Path(qmake).parent.parent
    root = bitfun_root()
    if root:
        for candidate in sorted((root / "toolchains").glob("*/*")):
            if (candidate / "bin" / ohos_env.exe("qmake")).is_file():
                return candidate
    return None


def is_template(path: Path) -> bool:
    return (path / "AppScope").is_dir() and (path / "entry").is_dir() and (path / "build-profile.json5").is_file()


def template_under(root: Path) -> Path:
    """The glue template at or below ``root`` (a bound template may be its parent directory)."""
    if is_template(root) or not root.is_dir():
        return root
    for candidate in sorted(root.glob("**/AppScope"))[:20]:
        if "node_modules" not in candidate.parts and is_template(candidate.parent):
            return candidate.parent
    return root


def find_template(explicit: Path | None, qt_sdk: Path | None) -> Path | None:
    if explicit:
        return template_under(Path(explicit))
    found = env_path("OHOS_TEMPLATE_SRC")
    if found:
        return template_under(found)
    roots = [bitfun_root() / "templates"] if bitfun_root() else []
    if qt_sdk:
        roots += [qt_sdk.parent / "templates", qt_sdk.parent]
    for root in roots:
        if root and root.is_dir():
            if is_template(root):
                return root
            for candidate in sorted(root.glob("**/AppScope"))[:20]:
                if is_template(candidate.parent):
                    return candidate.parent
    return None


def find_deveco(explicit: Path | None) -> Path | None:
    if explicit:
        return explicit
    found = env_path("DEVECO_HOME", "DevEco Studio", "DEVECO_STUDIO_HOME")
    if found:
        return found
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if "deveco" in entry.lower():
            path = Path(entry)
            for parent in [path, *path.parents]:
                if (parent / "tools" / "hvigor").is_dir() or (parent / "sdk").is_dir() and (parent / "jbr").is_dir():
                    return parent
    for guess in DEVECO_GUESSES:
        if Path(guess).is_dir():
            return Path(guess)
    return None


def sdk_layout(sdk: Path | None) -> dict[str, Path | None]:
    """The OpenHarmony SDK and its native part under a DevEco/command-line-tools ``sdk`` directory."""
    openharmony = first_existing(sdk / "default" / "openharmony", sdk / "openharmony") if sdk else None
    return {"sdk": sdk, "openharmony": openharmony,
            "native": first_existing(openharmony / "native") if openharmony else None}


def deveco_layout(home: Path) -> dict[str, Path | None]:
    roots = [home, home / "Contents"]

    def pick(*relative: str) -> Path | None:
        return first_existing(*(root / rel for root in roots for rel in relative))

    return {
        **sdk_layout(pick("sdk")),
        "jbr_bin": pick("jbr/bin", "jbr/Contents/Home/bin"),
        "product_info": pick("product-info.json", "Resources/product-info.json"),
    }


def read_json(path: Path | None) -> dict:
    if not path or not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def llvm_mingw_candidates(qt_sdk: Path | None) -> list[Path]:
    roots: list[Path] = []
    if qt_sdk:
        roots += [qt_sdk.parent, qt_sdk.parent.parent]
    if bitfun_root():
        roots.append(bitfun_root() / "toolchains")
    found = []
    for root in roots:
        if not root.is_dir():
            continue
        for dll in list(root.glob("llvm-mingw*/bin/libc++.dll")) + list(root.glob("llvm-mingw*/*/bin/libc++.dll")) \
                + list(root.glob("*/llvm-mingw*/bin/libc++.dll")):
            if dll.parent not in found:
                found.append(dll.parent)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and (Path(entry) / "libc++.dll").is_file() and Path(entry) not in found:
            found.append(Path(entry))
    return found


def choose_cache_dir(qt_sdk: Path | None) -> Path:
    candidates = []
    if qt_sdk:
        candidates.append(qt_sdk.parent / ".ohos-qt-cache")
    candidates.append(ohos_env.machine_cache_dir())
    for candidate in candidates:
        if " " not in str(candidate):
            return candidate
    return candidates[-1]


def long_paths_enabled() -> bool | None:
    if not ohos_env.IS_WINDOWS:
        return None
    try:
        import winreg  # type: ignore

        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as key:
            return bool(winreg.QueryValueEx(key, "LongPathsEnabled")[0])
    except OSError:
        return None


def tool_version(name: str, env: dict[str, str], args: tuple[str, ...] = ("--version",)) -> tuple[str | None, str]:
    path = shutil.which(name, path=env.get("PATH"))
    if not path:
        return None, ""
    code, out = run([path, *args], env, timeout=30)
    first = next((line.strip() for line in out.splitlines() if line.strip()), "")
    return path, first[:160] if code == 0 else ""


STATUS_RANK = {status: rank for rank, status in enumerate(ENV_STATUSES)}
MODULE_VERSION_RE = re.compile(r"^\s*MODULE_VERSION\s*=\s*([\d.]+)", re.MULTILINE)
CLANG_RE = re.compile(r"clang version ([\d.]+)")


def order_key(item: str) -> tuple[int, str]:
    slot = ENV_TOOL_PREFIX if item.startswith(ENV_TOOL_PREFIX) else item
    return (ENV_ITEM_ORDER.index(slot) if slot in ENV_ITEM_ORDER else len(ENV_ITEM_ORDER), item)


def first_line(text: str, limit: int = 120) -> str:
    return next((line.strip() for line in (text or "").splitlines() if line.strip()), "")[:limit]


def app_uses_cmake(app: Path | None) -> bool:
    """The application's own build system is CMake: the shallowest project file is a CMakeLists.txt."""
    if not app or not app.is_dir():
        return False
    level = [app]
    for _ in range(4):
        names = {path.name for directory in level for path in directory.iterdir() if path.is_file()} if level else set()
        if any(name.endswith(".pro") for name in names):
            return False
        if "CMakeLists.txt" in names:
            return True
        level = [child for directory in level for child in directory.iterdir()
                 if child.is_dir() and child.name not in {".git", "migration", "build", "node_modules", "oh_modules"}]
    return False


def find_devecocli(home: Path | None) -> Path | None:
    found = shutil.which("devecocli")
    if found:
        return Path(found)
    roots = [home, home / "Contents"] if home else []
    names = ("devecocli.bat", "devecocli.cmd", "devecocli.exe", "devecocli") if ohos_env.IS_WINDOWS else ("devecocli",)
    return first_existing(*(root / "tools" / name for root in roots for name in names))


def qt_source_candidate(args: argparse.Namespace, template: Path | None, previous: dict) -> tuple[str, Path] | None:
    """Where a Qt source checkout comes from: the option, the kb-init variables, the template, the last table."""
    if args.qt_source:
        return "--qt-source", Path(args.qt_source)
    for name in ("QT5_12_SRC", "QT5_15_SRC"):
        if os.environ.get(name):
            return name, Path(os.environ[name])
    if template and "qtbase" in template.parts:
        parts = template.parts
        return "template", Path(*parts[:parts.index("qtbase")])
    if previous.get("path"):
        return "previous table", Path(previous["path"])
    return None


class Probe:
    """Probes the environment item by item; every finding lands on the item it belongs to."""

    def __init__(self, args: argparse.Namespace, previous_rows: list[dict[str, str]]):
        self.args = args
        self.previous = {row.get("item", ""): row for row in previous_rows}
        self.items: dict[str, dict] = {}
        self.qt_modules: list[str] = []
        self.cache: Path | None = None

    # ------------------------------------------------------------------ bookkeeping
    def item(self, name: str) -> dict:
        return self.items.setdefault(name, {"path": "", "version": "", "detail": [], "status": "ok", "issues": [],
                                            "env": []})

    def note(self, name: str, status: str, text: str = "", known_issue: str = "") -> None:
        """Record a finding on an item: the worst status wins, every non-ok finding is listed in ``issue``."""
        entry = self.item(name)
        if STATUS_RANK[status] > STATUS_RANK[entry["status"]]:
            entry["status"] = status
        if text and status != "ok":
            entry["issues"].append(text + (f" ({known_issue})" if known_issue and known_issue not in text else ""))

    def export(self, name: str, variable: str, value: Path | str) -> None:
        """Add ``variable=value`` (``PATH``: a directory to prepend) to the item's command_env."""
        entry = self.item(name)
        value = str(value)
        if variable == "PATH":
            if any(var == "PATH" and val == value for other in self.items.values() for var, val in other["env"]):
                return
        else:
            entry["env"] = [(var, val) for var, val in entry["env"] if var != variable]
        entry["env"].append((variable, value))

    def env(self) -> dict[str, str]:
        """The command environment built so far, for the probes' own tool runs."""
        prepend, variables = [], {}
        for name in sorted(self.items, key=order_key):
            for variable, value in self.items[name]["env"]:
                if variable == "PATH":
                    prepend.append(value)
                else:
                    variables[variable] = value
        return ohos_env.apply_profile({"env": {"path_prepend": prepend, "set": variables}})

    def version_of(self, executable: Path | str, *args: str) -> str:
        code, out = run([str(executable), *(args or ("--version",))], self.env(), timeout=30)
        return first_line(out) if code == 0 else ""

    # ------------------------------------------------------------------ host and Python
    def probe_python(self) -> None:
        entry = self.item("python")
        entry["path"], entry["version"] = sys.executable, platform.python_version()
        self.export("python", "PYTHONIOENCODING", "utf-8")

    def probe_host(self) -> None:
        entry = self.item("host")
        entry["path"] = str(self.cache or ohos_env.machine_cache_dir())
        entry["version"] = f"{platform.system().lower()} {platform.machine()}"
        entry["detail"].append("path: space-free build and download cache")
        if long_paths_enabled() is False:
            self.note("host", "warn", "Windows LongPathsEnabled is off: deep dependency trees fail with Errno 2; "
                                      "closure.py fetches into the short cache directory", "KI-005")

    # ------------------------------------------------------------------ Qt
    def probe_qt(self) -> Path | None:
        self.export("qt-sdk", "OHOS_TARGET_ARCH", self.args.abi)
        qt = find_qt_sdk(self.args.qt_sdk)
        if not qt or not (qt / "bin").is_dir():
            self.note("qt-sdk", "missing", f"Qt OHOS SDK not found ({qt or 'no candidate'}); pass --qt-sdk or set QT5_12_OHOS_SDK")
            return None
        # abspath, not resolve(): resolve() would follow a space-free junction back to a path with spaces.
        qt = Path(os.path.abspath(qt))
        entry = self.item("qt-sdk")
        entry["path"] = str(qt)
        self.export("qt-sdk", "QT_OHOS_SDK", qt)
        self.export("qt-sdk", "PATH", qt / "bin")
        self.qt_modules = sorted(path.name[len("qt_lib_"):-len(".pri")]
                                 for path in (qt / "mkspecs" / "modules").glob("qt_lib_*.pri")
                                 if not path.name.endswith("_private.pri"))
        qmake = qt / "bin" / ohos_env.exe("qmake")
        moc = qt / "bin" / ohos_env.exe("moc")
        code, out = run([str(moc), "-v"], self.env(), timeout=30) if moc.is_file() else (None, "moc missing")
        if code != 0 and ohos_env.IS_WINDOWS:
            for candidate in ([self.args.llvm_mingw_bin] if self.args.llvm_mingw_bin else []) + llvm_mingw_candidates(qt):
                trial = ohos_env.apply_profile({"env": {"path_prepend": [str(candidate)]}}, self.env())
                retry, retry_out = run([str(moc), "-v"], trial, timeout=30)
                if retry == 0:
                    self.use_llvm_mingw(Path(candidate), "runtime DLLs (libc++.dll) for the Qt host tools")
                    self.note("qt-sdk", "fixed", f"moc failed to start (exit {code}); runtime DLLs found in {candidate}, "
                                                 "added to the injected PATH (llvm-mingw row)", "KI-002")
                    code, out = retry, retry_out
                    break
        if code != 0:
            known = "KI-002" if code in DLL_NOT_FOUND else ""
            self.note("qt-sdk", "error", f"moc cannot run (exit {code}): {out.strip()[:200]}; on Windows put the "
                                         "llvm-mingw bin holding libc++.dll next to the SDK or pass --llvm-mingw-bin", known)
        code, out = run([str(qmake), "-query"], self.env(), timeout=60) if qmake.is_file() else (None, "qmake missing")
        query = dict(line.split(":", 1) for line in out.splitlines() if ":" in line) if code == 0 else {}
        if query.get("QT_VERSION"):
            entry["version"] = query["QT_VERSION"].strip()
            entry["detail"].append(f"xspec {query.get('QMAKE_XSPEC', '').strip()}")
        else:
            self.note("qt-sdk", "error", f"qmake -query failed (exit {code}): {out.strip()[:200]}")
        entry["detail"] += [f"ABI {self.args.abi}", f"{len(self.qt_modules)} modules: " + ", ".join(self.qt_modules)]
        return qt

    def use_llvm_mingw(self, directory: Path, role: str) -> None:
        entry = self.item("llvm-mingw")
        entry["path"] = str(directory)
        match = re.search(r"llvm-mingw-(\d{8})", str(directory))
        entry["version"] = match.group(1) if match else entry["version"]
        if role not in entry["detail"]:
            entry["detail"].append(role)
        self.export("llvm-mingw", "PATH", directory)

    def probe_qt_host(self) -> None:
        version = self.item("qt-sdk")["version"]
        if not version.startswith("6") and "qt-host" not in self.previous:
            return
        host = self.args.qt_host or os.environ.get("QT_HOST_PATH") or self.previous.get("qt-host", {}).get("path")
        entry = self.item("qt-host")
        entry["detail"].append("desktop Qt for the Qt 6 cross build (QT_HOST_PATH)")
        if not host or not (Path(host) / "bin").is_dir():
            self.note("qt-host", "missing", "a Qt 6 cross build needs a desktop Qt of the same version: "
                                            "pass --qt-host or set QT_HOST_PATH")
            return
        entry["path"] = str(Path(host))
        entry["version"] = self.version_of(Path(host) / "bin" / ohos_env.exe("qmake"), "-query", "QT_VERSION")
        self.export("qt-host", "QT_HOST_PATH", host)

    def probe_qt_source(self, template: Path | None) -> None:
        found = qt_source_candidate(self.args, template, self.previous.get("qt-source", {}))
        if not found:
            return
        origin, root = found
        root = Path(os.path.abspath(root))
        entry = self.item("qt-source")
        entry["path"] = str(root)
        entry["detail"].append(f"found via {origin}")
        if not (root / "qtbase").is_dir():
            self.note("qt-source", "error", f"{root} is not a Qt source tree (no qtbase/)")
            return
        conf = root / "qtbase" / ".qmake.conf"
        match = MODULE_VERSION_RE.search(conf.read_text(encoding="utf-8", errors="replace")) if conf.is_file() else None
        entry["version"] = match.group(1) if match else ""
        if (root / ".git").exists():
            revision = self.version_of("git", "-C", str(root), "rev-parse", "--short", "HEAD")
            if revision:
                entry["detail"].append(f"git {revision}")
        if template and root in template.parents:
            entry["detail"].append("the glue template is taken from this tree")
        sdk = self.item("qt-sdk")["version"]
        if entry["version"] and sdk and entry["version"].split(".")[:2] != sdk.split(".")[:2]:
            self.note("qt-source", "warn", f"Qt source {entry['version']} does not match the Qt OHOS SDK {sdk}")

    # ------------------------------------------------------------------ DevEco
    def probe_deveco(self, qt: Path | None) -> None:
        if ohos_env.IS_HARMONYOS:
            self.probe_harmonyos_sdk(qt)
            return
        home = find_deveco(self.args.deveco_home)
        if not home or not Path(home).is_dir():
            self.note("deveco", "missing", f"DevEco Studio not found ({home or 'no candidate'}); pass --deveco-home "
                                           "or set DEVECO_HOME")
            self.note("ohos-sdk", "missing", "comes with DevEco Studio, which was not found")
            self.probe_devecocli(None)
            return
        layout = deveco_layout(home)
        deveco = self.item("deveco")
        deveco["path"] = str(home)
        self.export("deveco", "DEVECO_HOME", home)
        info = read_json(layout["product_info"])
        deveco["version"] = str(info.get("version") or "")
        if layout["sdk"]:
            self.export("deveco", "DEVECO_SDK_HOME", layout["sdk"])
        self.probe_jbr(layout)
        self.probe_devecocli(home)
        self.probe_ohos_sdk(layout, qt)

    def probe_harmonyos_sdk(self, qt: Path | None) -> None:
        """A HarmonyOS PC: the command line tools are on PATH and DEVECO_SDK_HOME names the SDK."""
        sdk = env_path("DEVECO_SDK_HOME")
        self.probe_devecocli(None)
        if not sdk or not sdk.is_dir():
            self.note("deveco", "missing", "DEVECO_SDK_HOME is not set or not a directory: the HarmonyOS command line "
                                           "tools set it; check their installation")
            self.note("ohos-sdk", "missing", "comes with the SDK of DEVECO_SDK_HOME, which was not found")
            return
        deveco = self.item("deveco")
        deveco["path"] = str(sdk)
        deveco["detail"].append("HarmonyOS PC: SDK of DEVECO_SDK_HOME; command line tools on PATH")
        self.export("deveco", "DEVECO_SDK_HOME", sdk)
        self.probe_ohos_sdk(sdk_layout(sdk), qt)

    def probe_jbr(self, layout: dict) -> None:
        if not layout["jbr_bin"]:
            return  # conditional: no row (hvigor may then fail with 'spawn java ENOENT', KI-015)
        jbr = self.item("jbr")
        home = Path(layout["jbr_bin"]).parent
        jbr["path"] = str(home)
        jbr["detail"].append("DevEco's bundled Java runtime")
        self.export("jbr", "JAVA_HOME", home)
        self.export("jbr", "PATH", layout["jbr_bin"])
        code, out = run([str(Path(layout["jbr_bin"]) / ohos_env.exe("java")), "-version"], self.env(), timeout=30)
        jbr["version"] = first_line(out) if code == 0 else ""

    def probe_devecocli(self, home: Path | None) -> None:
        cli = find_devecocli(home)
        entry = self.item("devecocli")
        entry["detail"].append("builds (devecocli_build.py), signs, installs and runs (device_run.py)")
        if not cli:
            self.note("devecocli", "missing", "devecocli not found (PATH, <DevEco>/tools): it builds, signs, installs "
                                              "and runs the app; install the DevEco CLI and run env_probe.py again")
            return
        entry["path"] = str(cli)
        entry["version"] = self.version_of(cli)
        self.export("devecocli", "PATH", cli.parent)

    def probe_ohos_sdk(self, layout: dict, qt: Path | None) -> None:
        sdk = self.item("ohos-sdk")
        native = Path(self.args.native_sdk) if self.args.native_sdk else layout["native"]
        openharmony = Path(layout["openharmony"]) if layout["openharmony"] else None
        versions = []
        if openharmony:
            meta = read_json(openharmony / "oh-uni-package.json") or read_json(
                Path(native) / "oh-uni-package.json" if native else None)
            if meta.get("apiVersion"):
                versions.append(f"API {meta.get('apiVersion')}")
            if meta.get("version"):
                versions.append(f"SDK {meta.get('version')}")
        if not native or not Path(native).is_dir():
            sdk["path"] = str(openharmony or "")
            sdk["version"] = "; ".join(versions)
            self.note("ohos-sdk", "missing", "OHOS native SDK (llvm, sysroot) not found; pass --native-sdk")
            return
        native = Path(native)
        # The native SDK's parent is the OpenHarmony SDK root: openharmonydeployqt
        # (and ohos_deployment.prf's `$$(NATIVE_OHOS_SDK)/../`) find llvm-readobj
        # at <root>/native/llvm/bin, so keep native a real child of a space-free root.
        nested = openharmony is not None and os.path.normcase(os.path.abspath(native)) == os.path.normcase(
            os.path.abspath(openharmony / "native"))
        usable = str(native)
        sdk_root = str(openharmony) if nested else ""
        original = openharmony if nested else native
        if " " in usable:
            short = ohos_env.short_path(openharmony) if nested else ohos_env.short_path(native)
            if " " not in short:
                sdk_root = short if nested else ""
                usable = str(Path(short) / "native") if nested else short
                self.note("ohos-sdk", "fixed", f"native SDK path has spaces; using 8.3 path {usable}", "KI-001")
            else:
                link = (self.cache or choose_cache_dir(qt)) / ("ohos-sdk" if nested else "native-sdk")
                if ohos_env.make_junction(link, original):
                    sdk_root = str(link) if nested else ""
                    usable = str(link / "native") if nested else str(link)
                    self.note("ohos-sdk", "fixed", f"native SDK path has spaces; junction {link} -> {original}", "KI-001")
                else:
                    self.note("ohos-sdk", "error", f"native SDK path has spaces ({native}) and no space-free alias could "
                                                   "be made; copy or link it to a path without spaces and pass --native-sdk",
                              "KI-001")
        sdk["path"] = sdk_root or usable
        if (sdk_root or usable) != str(original):
            sdk["detail"].append(f"original path {original}")
        if not nested:
            sdk["detail"].append(f"native SDK {usable}")
        self.export("ohos-sdk", "NATIVE_OHOS_SDK", usable)
        if sdk_root and " " not in sdk_root:
            self.export("ohos-sdk", "OHOS_SDK_DIR", sdk_root)
        elif openharmony is not None:
            self.note("ohos-sdk", "warn", f"no space-free OpenHarmony SDK root for openharmonydeployqt --sdk-dir "
                                          f"({openharmony}); deploy_qt_libs.py needs one (it must contain "
                                          "native/llvm/bin/llvm-readobj)", "KI-020")
        clang = Path(usable) / "llvm" / "bin" / ohos_env.exe("clang++")
        code, out = run([str(clang), "--version"], self.env(), timeout=30) if clang.is_file() else (None, "clang++ missing")
        if code == 0:
            match = CLANG_RE.search(out)
            versions.append(f"clang {match.group(1)}" if match else first_line(out))
        else:
            self.note("ohos-sdk", "error", f"OHOS clang++ cannot run (exit {code}): {out.strip()[:160]}")
        if not (Path(usable) / "sysroot").is_dir():
            self.note("ohos-sdk", "error", f"sysroot missing under {usable}")
        sdk["version"] = "; ".join(versions)

    # ------------------------------------------------------------------ host build tools
    def probe_build_tools(self, app: Path | None) -> None:
        env = self.env()
        make_names = ("mingw32-make", "make") if ohos_env.IS_WINDOWS else ("make",)
        make = next((shutil.which(name, path=env.get("PATH")) for name in make_names
                     if shutil.which(name, path=env.get("PATH"))), None)
        if not make and ohos_env.IS_WINDOWS:
            for candidate in llvm_mingw_candidates(Path(self.item("qt-sdk")["path"]) if self.item("qt-sdk")["path"] else None):
                if (candidate / ohos_env.exe("mingw32-make")).is_file():
                    make = str(candidate / ohos_env.exe("mingw32-make"))
                    break
        if make:
            entry = self.item("make")
            entry["path"] = make
            entry["version"] = self.version_of(make)
            if "llvm-mingw" in make.lower() and ohos_env.IS_WINDOWS:
                self.use_llvm_mingw(Path(make).parent, "provides mingw32-make")
            self.export("make", "PATH", Path(make).parent)
        else:
            self.note("make", "missing", "make not found (mingw32-make from llvm-mingw on Windows); env_smoke.py and "
                                         "qmake builds need it")
        cmake_needed = app_uses_cmake(app)
        for name, needed in (("cmake", cmake_needed), ("ninja", False)):
            if not (cmake_needed or name in self.previous):
                continue
            path, version = tool_version(name, self.env())
            if path:
                self.item(name)["path"], self.item(name)["version"] = path, version
                self.export(name, "PATH", Path(path).parent)
            else:
                self.note(name, "missing" if needed else "warn",
                          f"{name} not found on PATH" + ("; the application builds with CMake" if needed else ""))
        tools = [name.strip() for name in (self.args.tools or "").split(",") if name.strip()]
        tools += [item[len(ENV_TOOL_PREFIX):] for item in self.previous if item.startswith(ENV_TOOL_PREFIX)]
        for name in dict.fromkeys(tools):
            item = ENV_TOOL_PREFIX + name
            path, version = tool_version(name, self.env())
            if path:
                self.item(item)["path"], self.item(item)["version"] = path, version
                self.export(item, "PATH", Path(path).parent)
            else:
                self.note(item, "missing", f"{name} not found on PATH; install it (a third-party cross-compile needs it), "
                                           "then rerun env_probe.py")

    # ------------------------------------------------------------------ device and signing
    def probe_device(self) -> None:
        entry = self.item("device")
        if ohos_env.IS_HARMONYOS:
            entry["detail"].append("this HarmonyOS PC is the device: devecocli installs and runs the app here")
            return
        cli = self.item("devecocli")["path"]
        if not cli:
            self.note("device", "warn", "devecocli not found: no device verification possible")
            return
        serials: list[str] = []
        if not self.args.no_device:
            serials = device_run.list_devices(cli, self.env(), ohos_env.machine_cache_dir() / "env-probe")
        redacted = [s[:4] + "…" + s[-2:] if len(s) > 8 else "…" for s in serials]
        entry["detail"].append(f"{len(serials)} device(s) connected" + (": " + ", ".join(redacted) if redacted else ""))
        if not serials:
            self.note("device", "warn", "no device connected (devecocli device list); install/launch checks "
                                        "(env_smoke.py runtime, diagnostics) stay unverified until a device is "
                                        "connected and env_probe.py runs again")

    def probe_signing(self) -> None:
        config = Path.home() / ".ohos" / "config"
        materials = [p for p in config.glob("**/*") if p.suffix.lower() in {".p12", ".cer", ".p7b", ".csr"}] if config.is_dir() else []
        if not materials:
            return  # conditional: no row until devecocli auth login + signature generate made the materials
        entry = self.item("signing")
        entry["path"] = str(config)
        entry["detail"].append(f"{len(materials)} signing material file(s)")

    # ------------------------------------------------------------------ template
    def probe_template(self, qt: Path | None) -> Path | None:
        template = find_template(self.args.template, qt)
        if not template or not template.is_dir():
            self.note("qt-template", "missing", "glue template not found; pass --template, or ask the user before downloading one with bitfun-download-template.sh")
            return None
        template = Path(os.path.abspath(template))
        entry = self.item("qt-template")
        entry["path"] = str(template)
        self.export("qt-template", "OHOS_TEMPLATE_SRC", template)
        missing = [marker for marker in TEMPLATE_MARKERS if not (template / marker).exists()]
        lazy = any(template_patch.LAZY_RE.search(path.read_text(encoding="utf-8", errors="replace"))
                   for path in list(template.glob("**/*.ts"))[:200] + list(template.glob("**/*.ets"))[:400]
                   if path.is_file() and "node_modules" not in path.parts)
        if lazy:
            entry["detail"].append("uses lazy import: template_patch.py adds compatibleSdkVersionStage beta3 (KI-003)")
        if missing:
            self.note("qt-template", "error", f"template {template} is incomplete: missing {', '.join(missing)}")
        return template

    # ------------------------------------------------------------------ result
    def rows(self) -> list[dict[str, str]]:
        for name in ENV_CORE_ITEMS:
            self.item(name)
        return [{"item": name, "path": entry["path"], "version": entry["version"],
                 "detail": "; ".join(entry["detail"]), "status": entry["status"],
                 "issue": "; ".join(entry["issues"]), "command_env": ohos_env.format_command_env(entry["env"])}
                for name, entry in sorted(self.items.items(), key=lambda pair: order_key(pair[0]))]

    def run(self, app: Path | None) -> list[dict[str, str]]:
        self.probe_python()
        qt = self.probe_qt()
        self.cache = choose_cache_dir(qt)
        self.probe_host()
        self.probe_qt_host()
        template = self.probe_template(qt)
        self.probe_qt_source(template)
        self.probe_deveco(qt)
        self.probe_build_tools(app)
        self.probe_device()
        self.probe_signing()
        return self.rows()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--migration-root", type=Path, help="<container>/migration/ohos (environment.tsv is written there)")
    parser.add_argument("--out", type=Path, help="environment table path when there is no migration root")
    parser.add_argument("--app", type=Path, help="application root (default: Qt source root of the STATE.md Scope)")
    parser.add_argument("--qt-sdk", type=Path)
    parser.add_argument("--deveco-home", type=Path)
    parser.add_argument("--template", type=Path)
    parser.add_argument("--qt-source", type=Path, help="Qt source checkout (adds the qt-source item)")
    parser.add_argument("--qt-host", type=Path, help="desktop Qt for a Qt 6 cross build (QT_HOST_PATH)")
    parser.add_argument("--tools", help="comma-separated host tools to add as tool:<name> items (kept on later runs)")
    parser.add_argument("--native-sdk", type=Path)
    parser.add_argument("--llvm-mingw-bin", type=Path)
    parser.add_argument("--abi", default="arm64-v8a")
    parser.add_argument("--no-device", action="store_true", help="do not list devices")
    parser.add_argument("--write-ledger", action="store_true", help=argparse.SUPPRESS)  # the table is always written
    args = parser.parse_args(argv)
    ohos_env.utf8_console()
    if not args.migration_root and not args.out:
        parser.error("--migration-root or --out is required")
    target = args.out or ohos_env.profile_path(args.migration_root)
    app = args.app or (ohos_env.source_root(args.migration_root) if args.migration_root else None)
    previous = ohos_env.read_environment(target) if target.is_file() else []
    rows = Probe(args, previous).run(app)
    ohos_env.write_environment(target, rows)
    print(f"environment table: {target}")
    for row in rows:
        version = f" ({row['version']})" if row["version"] else ""
        issue = f" | {row['issue']}" if row["issue"] else ""
        print(f"{row['status'].upper():7} {row['item']}: {row['path'] or '-'}{version}{issue}")
    blocking = [row for row in rows if row["status"] in ENV_BLOCKING_STATUSES]
    if blocking:
        print(f"ERROR: {len(blocking)} item(s) missing or broken ({', '.join(row['item'] for row in blocking)}); "
              "fix them as their issue says and run env_probe.py again (never edit environment.tsv)")
        return 1
    print("Next: python <skill>/scripts/env_smoke.py --migration-root <root>  (cached per machine)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

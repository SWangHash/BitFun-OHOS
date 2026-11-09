#!/usr/bin/env python3
"""Static preflight of the application's build files, before the first OHOS build.

The build-system problems a Qt app meets on OHOS are generic and visible in the
.pro/.pri/CMakeLists files; finding them by compiling costs a failed build and
an investigation each. This script finds them up front and writes
``<root>/preflight.json``; every ``error`` finding must be named (by its
``PF-...`` id) in an inventory.tsv row before the inventory gate passes.

    python scripts/preflight_build_files.py --migration-root <container>/migration/ohos [--app <app root>] [--waive PF-ID="<reason>" ...]

An error finding checked in the source and found to be a false positive is
waived with ``--waive <id>="<reason>"`` (repeat it on every rerun): the finding
stays in the JSON with its ``waived`` reason, and no gate counts it. A real
problem is never waived; it gets an inventory row.

Checks (qmake; CMake where it applies):

* PF-QT-MODULE   ``QT +=``/``find_package`` modules the Qt OHOS SDK lacks (KI-011)
* PF-EMPTY-GLOB  HEADERS/SOURCES/FORMS wildcards that match nothing (KI-009)
* PF-ORPHAN-QOBJECT  Q_OBJECT classes in HEADERS whose members are never
  defined: their moc vtable breaks the OHOS link (KI-008)
* PF-TARGET-PATH ``TEMPLATE = app`` without ``target.path``: no lib<TARGET>.so
  on OHOS (KI-007); CMake: ``add_executable`` main target (PF-EXECUTABLE)
* PF-UNIX-LEAK   ``unix`` scopes (true for the OHOS spec too) adding OpenMP,
  X11/ALSA/PulseAudio/D-Bus or host paths without ``!ohos`` (KI-012)
* PF-HOST-PATH   absolute host paths (/home, /usr/local, C:\\...) in LIBS or
  INCLUDEPATH outside any guard
* PF-SCOPE-BRACE a scope condition alone on its line with ``{`` on the next
  line: qmake evaluates the condition, discards it and opens an unconditional
  block, so the "guarded" content applies to every platform, OHOS included
  (KI-023). Write ``cond {`` on one line.

At the start of the tasks phase, after the app is configured with its own
build system for OHOS, audit the generated build files (the tasks
gate requires a clean audit; env_smoke.py runs the same audit on its hello app)::

    python scripts/preflight_build_files.py --migration-root <root> --configured <build dir> [--app-library libApp.so]

which checks the OHOS target triple and sysroot, that the main target is a
shared library named like APP_LIBRARY_NAME, and that no host-only flag,
library or path leaked, and writes ``<root>/preflight-configured.json``.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import ohos_env

LIST_VARS = {"HEADERS", "SOURCES", "FORMS", "RESOURCES"}
SKIP_DIRS = {".git", "migration", "build", "node_modules", "oh_modules", "project", ".hvigor"}
LEAK_RE = re.compile(r"-fopenmp|-lgomp|-lX11\b|-lxcb|-lasound|-lpulse|-ldbus|/home/|/usr/local/|/usr/lib/x86_64", re.IGNORECASE)
HOST_PATH_RE = re.compile(r"(^|[\s=])(-[LI])?(/home/|/usr/local/|[A-Za-z]:[\\/])")
ASSIGN_RE = re.compile(r"^\s*([\w.]+)\s*([+\-*~]?=)\s*(.*)$")
SCOPED_ASSIGN_RE = re.compile(r"^\s*([!\w:|()$.,\s\"'-]+?)\s*:\s*([\w.]+)\s*([+\-*~]?=)\s*(.*)$")
CLASS_RE = re.compile(r"class\s+(?:\w+_EXPORT\s+)?(\w+)\s*(?::[^{;]*)?\{(.*?)\n\s*\};", re.DOTALL)
DECL_RE = re.compile(r"^\s*(?:virtual\s+|static\s+|explicit\s+|inline\s+)*[~\w:<>,\s*&]*\b(~?\w+)\s*\([^;{}]*\)\s*(?:const)?\s*(?:override|final)?\s*(?:=\s*0)?\s*;", re.MULTILINE)


class Finder:
    def __init__(self, app: Path, qt_modules: set[str]):
        self.app = app
        self.qt_modules = qt_modules
        self.findings: list[dict] = []
        self.counters: dict[str, int] = {}
        self.scanned: list[str] = []
        # Projects not reachable from the top-level project (SUBDIRS/include)
        # may not be built for OHOS at all: their findings are warnings.
        self.reachable = True

    def add(self, code: str, severity: str, file: Path, line: int, message: str, known: str = "", fix: str = "") -> None:
        if not self.reachable and severity == "error":
            severity = "warn"
            message += " (project not reachable from the top-level .pro; fix it if it is built for OHOS)"
        self.counters[code] = self.counters.get(code, 0) + 1
        self.findings.append({
            "id": f"{code}-{self.counters[code]:02d}", "code": code, "severity": severity,
            "file": file.relative_to(self.app).as_posix() if file.is_relative_to(self.app) else str(file),
            "line": line, "message": message, "known_issue": known, "fix": fix,
        })


def logical_lines(text: str) -> list[tuple[int, str]]:
    """Join backslash continuations and strip comments; keep the first line number."""
    out, buffer, start = [], "", 0
    for number, raw in enumerate(text.splitlines(), 1):
        line = re.sub(r"(^|\s)#.*$", "", raw).rstrip()
        if not buffer:
            start = number
        if line.endswith("\\"):
            buffer += line[:-1] + " "
            continue
        buffer += line
        out.append((start, buffer))
        buffer = ""
    if buffer:
        out.append((start, buffer))
    return out


def parse_qmake(path: Path) -> list[dict]:
    """Assignments with the scope condition stack in effect: [{var, op, values, scope, line}]."""
    entries, stack, pending, pending_line = [], [], None, 0
    for number, line in logical_lines(path.read_text(encoding="utf-8", errors="replace")):
        stripped = line.strip()
        if not stripped:
            continue
        # "cond {" or "cond{" (also "} else {"), possibly followed by content on the same line
        while stripped.startswith("}"):
            if stack:
                stack.pop()
            stripped = stripped[1:].strip()
            if stripped.startswith("else"):
                stripped = stripped[4:].strip().lstrip(":").strip()
                previous = pending or "else"
                pending = f"!({previous})"
        if not stripped:
            continue
        if stripped == "{":
            if pending and pending_line and not pending.startswith("!("):
                # qmake: a condition on its own line is a test whose result is discarded; the
                # "{" on the next line opens an unconditional block.
                entries.append({"var": "__detached_brace__", "op": "=", "values": [pending],
                                "scope": " && ".join(filter(None, stack)), "line": pending_line})
            stack.append("")
            pending, pending_line = None, 0
            continue
        match = re.match(r"^([^={}]*?)\s*\{\s*(.*)$", stripped)
        if match and "=" not in match.group(1):
            condition = match.group(1).strip()
            stack.append(condition)
            pending = condition
            rest = match.group(2).strip()
            if rest.endswith("}"):
                rest = rest[:-1].strip()
                inner = rest
                stack.pop()
                if inner:
                    entries.extend(_assignment(inner, number, stack + [condition]))
            elif rest:
                entries.extend(_assignment(rest, number, stack))
            continue
        assigned = _assignment(stripped, number, stack)
        if assigned:
            entries.extend(assigned)
            pending = None
        elif re.match(r"^[!\w:|()$.,\s\"'-]+$", stripped) and not stripped.startswith(("include", "load")):
            pending, pending_line = stripped, number  # a condition alone on its line (see PF-SCOPE-BRACE)
        if stripped.startswith("include(") or stripped.startswith("include ("):
            target = re.search(r"include\s*\(\s*([^)]+)\)", stripped)
            if target:
                entries.append({"var": "__include__", "op": "=", "values": [target.group(1).strip()],
                                "scope": " && ".join(filter(None, stack)), "line": number})
    return entries


def _assignment(text: str, number: int, stack: list[str]) -> list[dict]:
    match = ASSIGN_RE.match(text)
    scope = [item for item in stack if item]
    if not match:
        scoped = SCOPED_ASSIGN_RE.match(text)
        if not scoped:
            return []
        scope = scope + [scoped.group(1).strip()]
        var, op, value = scoped.group(2), scoped.group(3), scoped.group(4)
    else:
        var, op, value = match.groups()
    return [{"var": var, "op": op, "values": value.split(), "scope": " && ".join(scope), "line": number}]


def scope_reaches_ohos(scope: str) -> bool:
    """Whether a scope condition can be true for the ohos-clang spec (unix/linux are)."""
    text = scope.replace(" ", "")
    if not text:
        return True
    if "!ohos" in text:
        return False
    for token in re.findall(r"!?[\w-]+", text):
        if token.startswith("!"):
            continue
        if token in {"win32", "macx", "macos", "ios", "android", "wasm", "msvc", "mingw", "else"}:
            return False
    return True


def is_unix_scope(scope: str) -> bool:
    return bool(re.search(r"(^|[^!\w])(unix|linux|linux-g\+\+\S*)\b", scope)) and "!ohos" not in scope.replace(" ", "")


def expand(base: Path, value: str) -> list[Path]:
    value = value.replace("$$PWD", str(base)).replace("$${PWD}", str(base))
    if "$$" in value:
        return []
    path = Path(value) if Path(value).is_absolute() else base / value
    if any(ch in value for ch in "*?["):
        return [Path(p) for p in glob.glob(str(path))]
    return [path] if path.exists() else []


def walk_files(app: Path):
    """Files under ``app``, never descending into build output, ledgers or the OHOS project."""
    for directory, names, files in os.walk(app):
        names[:] = [name for name in names if name not in SKIP_DIRS and not name.startswith(".")
                    and not name.lower().startswith(("build-", "build_"))]
        for name in files:
            yield Path(directory) / name


def defined_classes(app: Path) -> str:
    chunks = []
    for path in walk_files(app):
        if path.suffix.lower() not in {".cpp", ".cc", ".cxx"}:
            continue
        try:
            chunks.append(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
    return "\n".join(chunks)


def check_qmake(finder: Finder, pro: Path, sources_text: str, seen: set[Path]) -> None:
    if pro in seen or not pro.is_file():
        return
    seen.add(pro)
    finder.scanned.append(pro.relative_to(finder.app).as_posix() if pro.is_relative_to(finder.app) else str(pro))
    base = pro.parent
    entries = parse_qmake(pro)
    template = next((entry["values"][0].lower() for entry in entries if entry["var"] == "TEMPLATE" and entry["values"]
                     and scope_reaches_ohos(entry["scope"])), "app")
    for entry in entries:
        if entry["var"] == "__include__":
            include = entry["values"][0].replace("$$PWD", str(base)).strip("\"'")
            check_qmake(finder, Path(include) if Path(include).is_absolute() else base / include, sources_text, seen)
    if template == "subdirs":
        for entry in entries:
            if entry["var"] == "SUBDIRS" and entry["op"] in {"=", "+="}:
                for value in entry["values"]:
                    sub = base / value
                    candidates = [sub] if sub.suffix == ".pro" else list(sub.glob("*.pro"))
                    for candidate in candidates:
                        check_qmake(finder, candidate, sources_text, seen)
        return
    removed_in_ohos = {value for entry in entries if entry["var"] == "QT" and entry["op"] == "-="
                       and "ohos" in entry["scope"] for value in entry["values"]}
    has_target_path = any(entry["var"] == "target.path" and scope_reaches_ohos(entry["scope"]) and entry["values"]
                          for entry in entries)
    for entry in entries:
        var, scope, line = entry["var"], entry["scope"], entry["line"]
        if var == "__detached_brace__":
            condition = entry["values"][0]
            finder.add("PF-SCOPE-BRACE", "error", pro, line,
                       f"'{condition}' stands alone on its line and the '{{' on the next line opens an unconditional "
                       "block in qmake: its content applies to every platform, OHOS included", "KI-023",
                       f"write the brace on the condition line: '{condition} {{'")
            continue
        if not scope_reaches_ohos(scope):
            continue
        if var == "QT" and entry["op"] in {"+=", "=", "*="} and finder.qt_modules:
            for module in entry["values"]:
                name = module.replace("-private", "_private").lower()
                if name.endswith("_private") or name in removed_in_ohos or module in removed_in_ohos:
                    continue
                if name not in finder.qt_modules:
                    finder.add("PF-QT-MODULE", "error", pro, line,
                               f"QT += {module}: the Qt OHOS SDK has no {module} module", "KI-011",
                               f"check its real use; drop or replace it in an ohos scope (QT -= {module})")
        if var in LIST_VARS and entry["op"] in {"+=", "="}:
            for value in entry["values"]:
                if any(ch in value for ch in "*?[") and not expand(base, value):
                    finder.add("PF-EMPTY-GLOB", "error", pro, line,
                               f"{var} += {value} matches no file; qmake keeps the literal glob and make fails", "KI-009",
                               "remove the wildcard or guard it with !ohos")
            if var == "HEADERS":
                for header in [p for value in entry["values"] for p in expand(base, value)]:
                    check_header(finder, header, sources_text)
        if var in {"LIBS", "QMAKE_CXXFLAGS", "QMAKE_CFLAGS", "QMAKE_LFLAGS", "INCLUDEPATH", "PRE_TARGETDEPS"}:
            joined = " ".join(entry["values"])
            leak = LEAK_RE.search(joined)
            if is_unix_scope(scope) and leak:
                finder.add("PF-UNIX-LEAK", "error", pro, line,
                           f"'{scope}' scope adds {leak.group(0)!r} ({var}) and is also true for the OHOS spec",
                           "KI-012", "guard the host-only block with unix:!ohos and add an ohos scope")
            elif not scope and HOST_PATH_RE.search(joined):
                finder.add("PF-HOST-PATH", "error", pro, line,
                           f"{var} uses an absolute host path ({joined[:80]}) outside any platform guard", "KI-013",
                           "move it into the host platform's scope or use $$PWD-relative paths")
    if template == "app" and not has_target_path:
        finder.add("PF-TARGET-PATH", "error", pro, 1,
                   "TEMPLATE = app without target.path reachable on OHOS: ohos_deployment.prf is skipped and no "
                   "lib<TARGET>.so is produced", "KI-007",
                   "in an ohos scope: DESTDIR = <dir>; target.path = $$DESTDIR; INSTALLS += target")


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def check_header(finder: Finder, header: Path, sources_text: str) -> None:
    if not header.is_file() or header.suffix.lower() not in {".h", ".hpp", ".hh", ".hxx"}:
        return
    text = strip_comments(header.read_text(encoding="utf-8", errors="replace"))
    if "Q_OBJECT" not in text:
        return
    for match in CLASS_RE.finditer(text):
        name, body = match.group(1), match.group(2)
        if "Q_OBJECT" not in body:
            continue
        declared = [decl for decl in DECL_RE.findall(body) if decl not in {"Q_OBJECT", "signals", "Q_SIGNALS"}]
        if not declared or re.search(r"\b" + re.escape(name) + r"\s*::", sources_text + text):
            continue
        if re.search(r"signals\s*:|Q_SIGNALS\s*:", body) and all(decl == name for decl in declared):
            continue
        line = text[:match.start()].count("\n") + 1
        finder.add("PF-ORPHAN-QOBJECT", "error", header, line,
                   f"Q_OBJECT class {name} declares {', '.join(sorted(set(declared))[:4])} but nothing defines {name}:: "
                   "anywhere; its moc vtable breaks the OHOS link (-Wl,--no-undefined)", "KI-008",
                   "define the class, or keep the header away from moc on OHOS (list HEADERS explicitly; HEADERS -= "
                   "cannot remove a wildcard match) or drop Q_OBJECT from the dead class")


def check_cmake(finder: Finder, path: Path) -> None:
    finder.scanned.append(path.relative_to(finder.app).as_posix())
    text = path.read_text(encoding="utf-8", errors="replace")
    for match in re.finditer(r"add_executable\s*\(\s*([\w${}-]+)", text, re.IGNORECASE):
        line = text[:match.start()].count("\n") + 1
        if re.search(r"(OHOS|CMAKE_SYSTEM_NAME|OHOS_ARCH)", text[max(0, match.start() - 400):match.start()]):
            continue
        finder.add("PF-EXECUTABLE", "error", path, line,
                   f"add_executable({match.group(1)}): on OHOS the app must be a SHARED library loaded by libqohos",
                   "KI-007", "add an if(OHOS) branch with add_library(<name> SHARED ...) named like APP_LIBRARY_NAME")
    if finder.qt_modules:
        for match in re.finditer(r"find_package\s*\(\s*Qt[56x$]\S*\s+[^)]*COMPONENTS\s+([^)]*)\)", text, re.IGNORECASE):
            for component in match.group(1).split():
                name = component.lower()
                if name in {"required", "optional_components", "quiet"} or not name.isalnum():
                    continue
                if name not in finder.qt_modules and f"{name}" not in {"core5compat"}:
                    line = text[:match.start()].count("\n") + 1
                    finder.add("PF-QT-MODULE", "error", path, line, f"find_package component {component} is not in the Qt OHOS SDK",
                               "KI-011", "drop or replace it for OHOS")


def project_files(app: Path) -> tuple[list[Path], list[Path]]:
    pros, cmakes = [], []
    for path in walk_files(app):
        if path.suffix == ".pro":
            pros.append(path)
        elif path.name == "CMakeLists.txt":
            cmakes.append(path)
    # Top-level projects first: a SUBDIRS root pulls its children in.
    pros.sort(key=lambda p: (len(p.relative_to(app).parts), str(p)))
    return pros, sorted(cmakes, key=lambda p: (len(p.relative_to(app).parts), str(p)))


def static_preflight(app: Path, qt_modules: set[str]) -> dict:
    finder = Finder(app, qt_modules)
    pros, cmakes = project_files(app)
    sources_text = defined_classes(app)
    seen: set[Path] = set()
    if pros:
        top = len(pros[0].relative_to(app).parts)
        for pro in [p for p in pros if len(p.relative_to(app).parts) == top]:
            check_qmake(finder, pro, sources_text, seen)
        finder.reachable = False
        for pro in pros:
            check_qmake(finder, pro, sources_text, seen)
    if not pros:
        for cmake in cmakes:
            check_cmake(finder, cmake)
    return {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "app": str(app), "build_system": "qmake" if pros else ("cmake" if cmakes else "unknown"),
        "qt_modules_known": bool(qt_modules), "files_scanned": finder.scanned, "findings": finder.findings,
    }


def configured_audit(build: Path, app_library: str | None, qt_modules: set[str]) -> dict:
    texts = []
    for pattern in ("Makefile*", "build.ninja", "CMakeCache.txt", "**/flags.make", "**/link.txt"):
        for path in list(build.glob(pattern))[:200]:
            if path.is_file() and path.stat().st_size < 64 * 1024 * 1024:
                texts.append(path.read_text(encoding="utf-8", errors="replace"))
    text = "\n".join(texts)
    findings = []

    def add(code: str, message: str, known: str = "", fix: str = "") -> None:
        findings.append({"id": f"{code}-{len(findings) + 1:02d}", "code": code, "severity": "error",
                         "message": message, "known_issue": known, "fix": fix})

    if not text:
        add("PF-CFG-MISSING", f"no Makefile/build.ninja/CMakeCache.txt in {build}: configure the app first")
        return {"build_dir": str(build), "findings": findings, "targets": []}
    if not re.search(r"aarch64-linux-ohos|--target=aarch64|ohos\.toolchain\.cmake|ohos-clang", text):
        add("PF-CFG-TRIPLE", "generated build files do not target aarch64-linux-ohos (wrong spec/toolchain file)", "",
            "configure with -spec ohos-clang (qmake) or the OHOS toolchain file (CMake)")
    if "--sysroot" not in text and "CMAKE_SYSROOT" not in text and "ohos.toolchain.cmake" not in text:
        add("PF-CFG-SYSROOT", "no --sysroot in the generated flags", "KI-001", "check NATIVE_OHOS_SDK in environment.tsv (ohos-sdk row)")
    targets = sorted(set(re.findall(r"\blib[\w.+-]+\.so\b", text)))
    declared = re.findall(r"^TARGET\s*=\s*(\S+)", text, re.MULTILINE)
    main_target = declared[0] if declared else None
    if main_target and not main_target.endswith(".so"):
        add("PF-CFG-NOT-SHARED", f"the main target is {main_target}, not a lib<name>.so", "KI-007",
            "qmake: target.path in the ohos scope; CMake: add_library(... SHARED)")
    if app_library and app_library not in text:
        add("PF-CFG-APP-LIBRARY", f"{app_library} (APP_LIBRARY_NAME) is not produced by these build files", "KI-007",
            "make the main target name match APP_LIBRARY_NAME")
    leak = LEAK_RE.search(text)
    if leak:
        add("PF-CFG-LEAK", f"host-only flag/path {leak.group(0)!r} reached the OHOS build files", "KI-012",
            "guard the host block with unix:!ohos")
    if qt_modules:
        for module in sorted(set(re.findall(r"-lQt5(\w+)", text))):
            if module.lower() not in qt_modules and module.lower() not in {"core", "gui", "widgets"}:
                add("PF-CFG-QT-MODULE", f"links Qt5{module}, which the Qt OHOS SDK lacks", "KI-011")
    return {"build_dir": str(build), "main_target": main_target, "targets": targets[:40], "findings": findings,
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds")}


def open_errors(report: dict) -> list[dict]:
    """Error findings that count: not waived as a false positive (``--waive``)."""
    return [f for f in report.get("findings", []) if f.get("severity") == "error" and not f.get("waived")]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--migration-root", type=Path, required=True, help="<container>/migration/ohos")
    parser.add_argument("--app", type=Path, help="Qt application root (default: Qt source root of the STATE.md Scope)")
    parser.add_argument("--configured", type=Path, help="audit a configured build directory instead")
    parser.add_argument("--app-library", help="expected APP_LIBRARY_NAME for --configured")
    parser.add_argument("--waive", action="append", default=[], metavar='ID="REASON"',
                        help="mark an error finding a false positive, with the reason (repeatable)")
    args = parser.parse_args(argv)
    waivers: dict[str, str] = {}
    for item in args.waive:
        finding_id, sep, reason = item.partition("=")
        if not sep or not finding_id.strip() or not reason.strip():
            parser.error(f"--waive {item!r}: expected <finding id>=<reason>")
        waivers[finding_id.strip()] = reason.strip()
    ohos_env.utf8_console()
    root = args.migration_root.resolve()
    app = ohos_env.require_source_root(root, args.app)
    profile = ohos_env.load_profile(root)
    modules = {m.lower() for m in (profile or {}).get("qt_modules", [])}
    if args.configured:
        report = configured_audit(args.configured.resolve(), args.app_library, modules)
        out = root / "preflight-configured.json"
    else:
        report = static_preflight(app, modules)
        out = root / "preflight.json"
        if not modules:
            print("note: environment.tsv lists no Qt modules (run env_probe.py); Qt module checks were skipped")
    by_id = {finding["id"]: finding for finding in report["findings"]}
    unknown = [finding_id for finding_id in waivers if by_id.get(finding_id, {}).get("severity") != "error"]
    if unknown:
        parser.error("--waive names no error finding of this run: " + ", ".join(unknown))
    for finding_id, reason in waivers.items():
        by_id[finding_id]["waived"] = reason
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    errors = open_errors(report)
    for finding in report["findings"]:
        where = f"{finding.get('file', report.get('build_dir'))}:{finding.get('line', '')}"
        tag = f" [{finding['known_issue']}]" if finding.get("known_issue") else ""
        waived = f" (waived: {finding['waived']})" if finding.get("waived") else ""
        print(f"{finding['severity'].upper()} {finding['id']} {where} {finding['message']}{tag}{waived}")
        if finding.get("fix"):
            print(f"    fix: {finding['fix']}")
    print(f"{out.name}: {len(errors)} error finding(s), {len(report['findings']) - len(errors)} other"
          + (f" ({len(waivers)} waived)" if waivers else ""))
    if errors and not args.configured:
        print("Record each error finding id in the found_by of an inventory.tsv row ('preflight: PF-...'); "
              "the inventory gate checks it. Fix them in the first TASK. A false positive is waived with "
              "--waive <id>=\"<reason>\" instead.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

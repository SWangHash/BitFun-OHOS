#!/usr/bin/env python3
"""Deploy the application library and everything it loads into the HarmonyOS project.

qmake's ``make ohosdeploy`` only prints its ``openharmonydeployqt`` call (the
SDK's ``ohos_deployment.prf`` puts it into an ``@echo`` recipe, KI-019), its
``--sdk-dir`` must be the OpenHarmony SDK root (KI-020), it deploys a fixed
list of Qt libraries whatever the app links, and it never deploys third-party
shared libraries. This script replaces that step for qmake and CMake apps::

    python scripts/deploy_qt_libs.py --project <app>/project --library <build>/libApp.so \\
        [--build-file <app>/src/App.pro ...] [--lib-dir <third-party lib dir> ...] \\
        [--plugin imageformats/libqjpeg.so ...] [--env-profile <environment.tsv>] [--dry-run]

1. Stale check: the library must be newer than every ``--build-file`` (the
   ``.pro``/``.pri``/``CMakeLists.txt`` that decide what it links; default the
   build directory's qmake ``# Project:`` file or CMake home ``CMakeLists.txt``);
   a changed build file with an unchanged library means make skipped the link
   (KI-021).
2. Closure: starting from the library, the platform plugin ``libqohos.so`` and
   any ``--plugin``, every ``DT_NEEDED`` name is resolved in the Qt SDK
   (``lib/``), in the third-party lib dirs (``--lib-dir``, default every
   ``lib`` dir under ``<short_cache_dir>/ohos-libs`` from closure.py) or in the
   OHOS NDK sysroot. A name found nowhere is a load failure on the device and
   stops the deploy.
3. ``openharmonydeployqt`` (from the environment table's Qt SDK, with ``OHOS_SDK_DIR``)
   deploys the library and the Qt libraries it really needs into
   ``<project>/entry/libs/<abi>``; third-party libraries are copied there under
   their ``DT_NEEDED`` name.
4. ``APP_LIBRARY_NAME`` is switched to the library (``--keep-app-library``
   keeps the current value, for example the envelope app).

Run it as a batch_checks.py step between the app build and ``devecocli_build.py``.
Output is JSON; exit 0 deployed (or planned with ``--dry-run``), 1 a problem.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

import hap_check
import ohos_env
import template_patch

PLATFORM_PLUGIN = Path("platforms") / "libqohos.so"


def find_profile(project: Path, explicit: Path | None) -> tuple[dict | None, Path | None]:
    return ohos_env.app_profile(project, explicit)


def default_lib_dirs(profile: dict | None) -> list[Path]:
    cache = ohos_env.profile_value(profile, "short_cache_dir")
    root = Path(cache) / "ohos-libs" if cache else None
    if not root or not root.is_dir():
        return []
    return sorted({path for path in root.glob("**/lib") if path.is_dir() and ".staging" not in path.parts})


def stale_build_files(library: Path, build_files: list[Path]) -> list[str]:
    built = library.stat().st_mtime
    return [str(path) for path in build_files if path.is_file() and path.stat().st_mtime > built + 1]


def detected_build_files(library: Path) -> list[Path]:
    """The project file of the build directory holding ``library``: qmake's
    ``# Project: <file>.pro`` Makefile header, or CMake's home ``CMakeLists.txt``."""
    found: list[Path] = []
    for directory in (library.parent, library.parent.parent):
        makefile = directory / "Makefile"
        if makefile.is_file():
            for line in ohos_env._read(makefile).splitlines()[:15]:
                if line.startswith("# Project:"):
                    path = Path(line.split(":", 1)[1].strip())
                    path = path if path.is_absolute() else (directory / path)
                    if path.is_file():
                        found.append(Path(os.path.abspath(path)))
        cache = directory / "CMakeCache.txt"
        if cache.is_file():
            for line in ohos_env._read(cache).splitlines():
                if line.startswith("CMAKE_HOME_DIRECTORY:"):
                    path = Path(line.split("=", 1)[-1].strip()) / "CMakeLists.txt"
                    if path.is_file():
                        found.append(path)
        if found:
            break
    return found


def index_dir(directory: Path) -> dict[str, Path]:
    """soname-ish file name -> file, for *.so and *.so.N files directly in ``directory``."""
    found: dict[str, Path] = {}
    if directory.is_dir():
        for path in directory.iterdir():
            if path.is_file() and (path.name.endswith(".so") or ".so." in path.name):
                found.setdefault(path.name, path)
    return found


def closure(roots: list[Path], qt_libs: dict[str, Path], third_party: dict[str, Path],
            system: set[str]) -> tuple[dict[str, Path], dict[str, Path], dict[str, list[str]]]:
    """Walk DT_NEEDED from ``roots``: (Qt libraries, third-party libraries, unresolved name -> users)."""
    qt: dict[str, Path] = {}
    extra: dict[str, Path] = {}
    unresolved: dict[str, list[str]] = {}
    queue = list(roots)
    seen: set[str] = set()
    while queue:
        current = queue.pop(0)
        key = os.path.normcase(str(current))
        if key in seen:
            continue
        seen.add(key)
        try:
            needed = hap_check.dt_needed(current.read_bytes())
        except OSError:
            needed = []
        for name in needed:
            if name in system or hap_check.SYSTEM_LIB_RE.search(name) or name in {r.name for r in roots}:
                continue
            if name in qt_libs:
                if name not in qt:
                    qt[name] = qt_libs[name]
                    queue.append(qt_libs[name])
            elif name in third_party:
                if name not in extra:
                    extra[name] = third_party[name]
                    queue.append(third_party[name])
            elif name == "libc++_shared.so":
                continue  # packed by the template's native build
            else:
                unresolved.setdefault(name, []).append(current.name)
    return qt, extra, unresolved


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", type=Path, required=True, help="HarmonyOS project root (has entry/)")
    parser.add_argument("--library", type=Path, required=True, help="the application library lib<App>.so")
    parser.add_argument("--build-file", action="append", type=Path, default=[],
                        help=".pro/.pri/CMakeLists.txt deciding what the library links (repeatable; stale check)")
    parser.add_argument("--lib-dir", action="append", type=Path, default=[],
                        help="directory with third-party OHOS .so files (repeatable; default: closure.py downloads)")
    parser.add_argument("--plugin", action="append", default=[],
                        help="extra Qt plugin relative to <qt>/plugins, e.g. imageformats/libqjpeg.so (repeatable)")
    parser.add_argument("--qt-sdk", type=Path, help="default: the qt-sdk path of environment.tsv")
    parser.add_argument("--sdk-dir", type=Path, help="OpenHarmony SDK root (default: OHOS_SDK_DIR of environment.tsv)")
    parser.add_argument("--abi", help="default: the ABI of environment.tsv")
    parser.add_argument("--env-profile", type=Path)
    parser.add_argument("--keep-app-library", action="store_true", help="do not switch APP_LIBRARY_NAME")
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--dry-run", action="store_true", help="resolve and print the plan only")
    args = parser.parse_args(argv)
    ohos_env.utf8_console()

    project = args.project.resolve()
    library = Path(os.path.abspath(args.library))
    profile, profile_file = find_profile(project, args.env_profile)
    env = ohos_env.apply_profile(profile)
    abi = args.abi or (profile or {}).get("abi") or "arm64-v8a"
    qt_value = args.qt_sdk or ohos_env.profile_value(profile, "paths", "qt_sdk")
    qt = Path(qt_value) if qt_value else None
    sdk_value = args.sdk_dir or ohos_env.profile_value(profile, "env", "set", "OHOS_SDK_DIR") \
        or ohos_env.profile_value(profile, "paths", "ohos_sdk_dir")
    sdk_dir = Path(sdk_value) if sdk_value else None
    native = ohos_env.profile_value(profile, "paths", "native_sdk")
    problems: list[str] = []
    notes: list[str] = []

    if not library.is_file():
        problems.append(f"{library} does not exist: build the application library first")
    if not (project / "entry").is_dir():
        problems.append(f"{project} is not a HarmonyOS project (no entry/)")
    if not qt or not (qt / "lib").is_dir():
        problems.append("Qt OHOS SDK unknown: run env_probe.py (paths.qt_sdk) or pass --qt-sdk")
    deployer = qt / "bin" / ohos_env.exe("openharmonydeployqt") if qt else None
    if deployer is not None and not deployer.is_file():
        problems.append(f"{deployer} is missing from the Qt SDK")
    if not sdk_dir or not (sdk_dir / "native" / "llvm" / "bin").is_dir():
        problems.append(f"[KI-020] OpenHarmony SDK root unknown or without native/llvm/bin ({sdk_dir}); rerun env_probe.py "
                        "(writes OHOS_SDK_DIR) or pass --sdk-dir <DevEco>/sdk/default/openharmony (space-free alias)")
    elif " " in str(sdk_dir):
        problems.append(f"[KI-001] --sdk-dir {sdk_dir} contains a space; use the space-free OHOS_SDK_DIR from env_probe.py")
    if problems:
        return finish({"status": "failed", "problems": problems, "notes": notes}, 1)

    build_files = [Path(os.path.abspath(path)) for path in args.build_file] or detected_build_files(library)
    stale = stale_build_files(library, build_files)
    if stale:
        problems.append(f"[KI-021] stale application library: {library.name} is older than {', '.join(stale)}; make skipped "
                        "the link, so the edited LIBS never took effect. Delete the .so (or touch a source) and rebuild")

    qt_libs = index_dir(qt / "lib")
    plugin_paths = [qt / "plugins" / PLATFORM_PLUGIN] + [qt / "plugins" / Path(item) for item in args.plugin]
    for path in plugin_paths:
        if not path.is_file():
            problems.append(f"Qt plugin {path} does not exist")
    lib_dirs = [Path(os.path.abspath(path)) for path in args.lib_dir] or default_lib_dirs(profile)
    third_party: dict[str, Path] = {}
    for directory in lib_dirs:
        for name, path in index_dir(directory).items():
            third_party.setdefault(name, path)
    system = hap_check.sysroot_libs(native)
    if not system:
        notes.append("OHOS sysroot unknown (run env_probe.py): unresolved names are checked against the system pattern only")
    roots = [library] + [path for path in plugin_paths if path.is_file()]
    qt_needed, extra, unresolved = closure(roots, qt_libs, third_party, system)
    for name, users in sorted(unresolved.items()):
        problems.append(f"{name} (needed by {', '.join(sorted(set(users))[:3])}) is not in the Qt SDK, the lib dirs "
                        f"({len(lib_dirs)}) or the OHOS sysroot: pass --lib-dir with its OHOS build, link it statically, "
                        "or drop the dependency; it would fail to load on the device")

    command = [str(deployer), "--sdk-dir", str(sdk_dir), "--template-dir", str(qt / "src" / "openharmony"),
               "--output-dir", str(project), "--library", str(library)]
    for path in [*sorted(qt_needed.values()), *[p for p in plugin_paths if p.is_file()]]:
        command += ["--library", str(path)]
    libs_dir = project / "entry" / "libs" / abi
    plan = {
        "library": str(library), "abi": abi, "qt_libraries": sorted(qt_needed),
        "plugins": [str(p.relative_to(qt / "plugins")) for p in plugin_paths if p.is_file()],
        "third_party": {name: str(path) for name, path in sorted(extra.items())},
        "lib_dirs": [str(path) for path in lib_dirs], "build_files": [str(path) for path in build_files],
        "command": command, "env_profile": str(profile_file or ""),
    }
    if problems or args.dry_run:
        return finish({"status": "failed" if problems else "planned", "problems": problems, "notes": notes, **plan},
                      1 if problems else 0)

    log_dir = project / ".hvigor" / "bitfun-deploy"
    started = time.time()
    result = ohos_env.run_watched(command, cwd=project, env=env, stdout_path=log_dir / "openharmonydeployqt.stdout.log",
                                  stderr_path=log_dir / "openharmonydeployqt.stderr.log", timeout=args.timeout,
                                  idle_timeout=None)
    output = "\n".join([result.stdout(), result.stderr()])
    if result.status != "passed":
        problems.append(f"openharmonydeployqt {result.status} (exit {result.exit_code}): {ohos_env.tail(output, 15)[:800]}")
    libs_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for name, path in sorted(extra.items()):
        target = libs_dir / name
        shutil.copy2(path.resolve(), target)  # follow symlinks: the device loads the DT_NEEDED name
        copied.append(name)
    missing = [name for name in [library.name, *qt_needed, "libqohos.so", *copied] if not (libs_dir / name).is_file()]
    if result.status == "passed" and missing:
        problems.append(f"after openharmonydeployqt {', '.join(missing)} are not in {libs_dir}")
    elif result.status == "passed" and (libs_dir / library.name).stat().st_mtime < started - 1 and \
            not os.path.samefile(libs_dir / library.name, library):
        notes.append(f"{library.name} in {libs_dir} was not refreshed by openharmonydeployqt; check it is the new build")
    changes: list[str] = []
    if not problems and not args.keep_app_library:
        changes, patch_problems = template_patch.apply(project, None, qt, abi, library.name, None, check=False)
        problems.extend(patch_problems)
    report = {"status": "failed" if problems else "deployed", "problems": problems, "notes": notes, **plan,
              "third_party_copied": copied, "template_changes": changes,
              "stdout_log": str(result.stdout_path), "stderr_log": str(result.stderr_path)}
    return finish(report, 1 if problems else 0)


def finish(report: dict, code: int) -> int:
    print(json.dumps(report, ensure_ascii=False, indent=2))
    for problem in report.get("problems", []):
        print(f"problem: {problem}", file=sys.stderr)
    return code


if __name__ == "__main__":
    raise SystemExit(main())

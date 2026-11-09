#!/usr/bin/env python3
"""Check a built HAP against what the Qt runtime needs, before any device run.

    python scripts/hap_check.py --project <app>/project [--hap <file.hap>] [--env-profile <environment.tsv>] \
        [--app-library libMyApp.so] [--bundle-name com.x.y] [--expect resources/resfile/themes:600]

Checks (each failure names its known issue when there is one):

* the app library ``APP_LIBRARY_NAME`` (from ``QtAppConstants.ets`` unless
  given) is packed in ``libs/<abi>/`` (KI-007 when it is missing);
* the Qt platform plugin ``libqohos.so``, ``libc++_shared.so`` and the style
  plugin ``styles/libqohosstyle.so`` are packed;
* every ``DT_NEEDED`` entry of the packed native libraries resolves to a
  packed library or a library of the OHOS NDK sysroot (a missing one is a load
  failure on the device; without a known sysroot it is only a note);
* no non-.so file placed under the project's ``entry/libs/<abi>`` was dropped
  by hvigor (KI-010: runtime data belongs in resources/resfile);
* ``--expect <dir>:<min files>`` directories are packed with at least that many
  files (runtime data shipped under ``resources/resfile/<dir>``); ``--bundle-name``
  matches the HAP's module.json.

``signed`` in the report means the HAP carries a signing block (read from the
file, not guessed from its name); only a signed HAP installs on a device. The
HAP defaults to the entry module's newest signed one among the project's outputs.

Exit code 1 when any check fails. Output is JSON plus one line per problem.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

import ohos_env

# Fallback when the native SDK sysroot is unknown: C runtime, graphics and the
# ``*.z.so`` system NDK libraries. Anything else is then only reported as a note.
SYSTEM_LIB_RE = re.compile(r"^(libc|libm|libdl|libpthread|librt|libz|libEGL|libGLESv\d(_CM)?|libvulkan)\.so(\.\d+)*$|\.z\.so$")


def sysroot_libs(native: str | None) -> set[str]:
    """Library names the device provides: everything in the OHOS NDK sysroot."""
    if not native:
        return set()
    root = Path(native) / "sysroot" / "usr" / "lib"
    if not root.is_dir():
        return set()
    return {path.name for path in root.rglob("*.so*") if path.is_file() or path.is_symlink()}


def dt_needed(data: bytes) -> list[str]:
    """DT_NEEDED names of an ELF64/ELF32 little-endian shared object (empty on parse failure)."""
    try:
        if data[:4] != b"\x7fELF":
            return []
        is64 = data[4] == 2
        if data[5] != 1:
            return []
        if is64:
            shoff = struct.unpack_from("<Q", data, 0x28)[0]
            shentsize, shnum = struct.unpack_from("<HH", data, 0x3A)
        else:
            shoff = struct.unpack_from("<I", data, 0x20)[0]
            shentsize, shnum = struct.unpack_from("<HH", data, 0x2E)
        sections = []
        for index in range(shnum):
            base = shoff + index * shentsize
            if is64:
                _, sh_type, _, _, offset, size, link = struct.unpack_from("<IIQQQQI", data, base)
            else:
                _, sh_type, _, _, offset, size, link = struct.unpack_from("<IIIIIII", data, base)
            sections.append((sh_type, offset, size, link))
        needed = []
        for sh_type, offset, size, link in sections:
            if sh_type != 6:  # SHT_DYNAMIC
                continue
            strtab = sections[link]
            entry = 16 if is64 else 8
            for pos in range(offset, offset + size, entry):
                tag, value = struct.unpack_from("<qQ" if is64 else "<iI", data, pos)
                if tag == 0:
                    break
                if tag == 1:  # DT_NEEDED
                    start = strtab[1] + value
                    end = data.index(b"\0", start)
                    needed.append(data[start:end].decode("utf-8", errors="replace"))
        return needed
    except (struct.error, IndexError, ValueError):
        return []


def app_library_from(project: Path) -> str | None:
    for path in sorted(project.glob("entry/src/main/ets/**/QtAppConstants.ets")):
        match = re.search(r"APP_LIBRARY_NAME\s*=\s*['\"]([^'\"]+)['\"]", path.read_text(encoding="utf-8", errors="replace"))
        if match:
            return match.group(1)
    return None


def newest_hap(project: Path) -> Path | None:
    """The entry module's newest (signed) HAP; auxiliary template modules carry no native code."""
    haps = [path for path in project.glob("**/build/**/outputs/**/*.hap") if path.is_file()]
    return ohos_env.pick_entry_hap(haps)


def check(hap: Path, project: Path | None, app_library: str | None, abi: str, bundle: str | None,
          expects: list[str], system: set[str] | None = None) -> dict:
    system = system or set()
    problems: list[str] = []
    notes: list[str] = []
    if not zipfile.is_zipfile(hap):
        return {"hap": str(hap), "signed": False, "abi": abi, "app_library": app_library, "bundle_name": None,
                "native_libs": [], "notes": [],
                "problems": [f"{hap} is not a valid HAP (zip) file: the build was interrupted or the file is truncated"]}
    with zipfile.ZipFile(hap) as archive:
        names = archive.namelist()
        libs_prefix = f"libs/{abi}/"
        libs = {name[len(libs_prefix):]: name for name in names if name.startswith(libs_prefix) and not name.endswith("/")}
        so_names = {Path(rel).name for rel in libs if rel.endswith(".so") or ".so." in rel}
        if not libs:
            problems.append(f"no native libraries under {libs_prefix} (wrong abiFilters or the native build was skipped)")
        if app_library:
            if app_library not in so_names:
                problems.append(f"[KI-007] APP_LIBRARY_NAME {app_library} is not packed in {libs_prefix}; "
                                "deploy it with deploy_qt_libs.py before hvigor (make ohosdeploy only echoes, KI-019), "
                                "or the app library is missing or was built under another name/as an executable")
        else:
            problems.append("APP_LIBRARY_NAME unknown (pass --app-library or --project with QtAppConstants.ets)")
        for required in ("libqohos.so", "libc++_shared.so"):
            if required not in so_names:
                problems.append(f"{required} is not packed in {libs_prefix} (Qt platform plugin/runtime missing)")
        if "styles/libqohosstyle.so" not in libs:
            notes.append(f"{libs_prefix}styles/libqohosstyle.so not packed (template_patch.py copies it); widgets fall back to the default style")
        unresolved: dict[str, list[str]] = {}
        for rel, name in libs.items():
            if not rel.endswith(".so"):
                continue
            for needed in dt_needed(archive.read(name)):
                if needed in so_names or needed in system or SYSTEM_LIB_RE.search(needed):
                    continue
                unresolved.setdefault(needed, []).append(rel)
        for needed, users in sorted(unresolved.items()):
            message = f"{needed} is needed by {', '.join(sorted(users)[:3])} but not packed"
            if system:
                problems.append(f"{message} and not in the OHOS sysroot: the library will fail to load on the device; "
                                "deploy it with deploy_qt_libs.py --lib-dir <its lib dir> or link it statically")
            else:
                notes.append(f"{message}; sysroot unknown (run env_probe.py), verify it is a system library")
        module = next((name for name in names if name.endswith("module.json")), None)
        bundle_name = None
        if module:
            try:
                bundle_name = json.loads(archive.read(module).decode("utf-8")).get("app", {}).get("bundleName")
            except ValueError:
                bundle_name = None
        if bundle and bundle_name and bundle_name != bundle:
            problems.append(f"bundleName in the HAP is {bundle_name}, expected {bundle}")
        for spec in expects:
            directory, _, minimum = spec.partition(":")
            directory = directory.strip("/") + "/"
            count = sum(1 for name in names if name.startswith(directory) and not name.endswith("/"))
            if count < int(minimum or 1):
                problems.append(f"{directory} has {count} packed file(s), expected at least {minimum or 1}")
        if project:
            source = project / "entry" / "libs" / abi
            dropped = [path.relative_to(source).as_posix() for path in source.rglob("*")
                       if path.is_file() and not (path.name.endswith(".so") or ".so." in path.name)
                       and path.relative_to(source).as_posix() not in libs] if source.is_dir() else []
            if dropped:
                problems.append(f"[KI-010] {len(dropped)} non-.so file(s) under entry/libs/{abi} were dropped by hvigor "
                                f"(e.g. {', '.join(dropped[:3])}); ship runtime data under entry/src/main/resources/resfile")
    return {
        "hap": str(hap), "signed": ohos_env.hap_is_signed(hap), "abi": abi, "app_library": app_library,
        "bundle_name": bundle_name, "native_libs": sorted(libs), "problems": problems, "notes": notes,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", type=Path)
    parser.add_argument("--hap", type=Path)
    parser.add_argument("--app-library")
    parser.add_argument("--abi")
    parser.add_argument("--bundle-name")
    parser.add_argument("--native-sdk", help="OHOS native SDK (default: NATIVE_OHOS_SDK of environment.tsv) for system libraries")
    parser.add_argument("--env-profile", type=Path, help="environment.tsv (default: see ohos_env.locate_profile)")
    parser.add_argument("--expect", action="append", default=[], help="<dir in HAP>:<min files> (repeatable)")
    args = parser.parse_args(argv)
    ohos_env.utf8_console()
    for spec in args.expect:
        directory, _, minimum = spec.partition(":")
        if not directory or (minimum and not minimum.isdigit()):
            parser.error(f"--expect {spec!r}: use <dir in HAP>:<min files>, e.g. resources/resfile/themes:100")
    project = args.project.resolve() if args.project else None
    hap = args.hap or (newest_hap(project) if project else None)
    if not hap or not Path(hap).is_file():
        print("ERROR: no .hap found (pass --hap or build the project first)")
        return 1
    profile, _ = ohos_env.app_profile(project, args.env_profile)
    abi = args.abi or ohos_env.profile_value(profile, "abi", default="arm64-v8a")
    app_library = args.app_library or (app_library_from(project) if project else None)
    system = sysroot_libs(args.native_sdk or ohos_env.profile_value(profile, "paths", "native_sdk"))
    report = check(Path(hap), project, app_library, abi, args.bundle_name, args.expect, system)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    for problem in report["problems"]:
        print(f"error: {problem}", file=sys.stderr)
    for note in report["notes"]:
        print(f"note: {note}", file=sys.stderr)
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())

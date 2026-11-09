#!/usr/bin/env python3
"""Materialize the Qt HarmonyOS glue template and apply the known required edits.

Every migration (and the environment smoke test) needs the same edits to a
fresh template; doing them by hand costs a failed build each time they are
forgotten. This script copies the complete template tree (when the project
does not exist yet) and applies, idempotently:

* project ``build-profile.json5``: ``compatibleSdkVersionStage: "beta3"`` in
  every product when the template's ArkTS glue uses ``lazy import`` (KI-003);
* ``hvigor/hvigor-config.json5``: ``execution.daemon: false``, so every
  ``devecocli build`` runs hvigor with the current environment instead of a
  daemon that keeps the variables of its first build (KI-004);
* ``entry/build-profile.json5``: ``externalNativeOptions.arguments`` =
  ``-DCMAKE_PREFIX_PATH=<Qt SDK>`` and ``abiFilters`` = ``[<abi>]`` (KI-016);
* ``QtAppConstants.ets``: ``APP_LIBRARY_NAME`` (``--app-library``);
* ``AppScope/app.json5``: ``bundleName`` (``--bundle-name``, only when given);
* ``entry/libs/<abi>/styles/libqohosstyle.so`` copied from the Qt SDK;
* with ``--envelope``: the skill's Qt Widgets envelope app (assets/smoke) as
  ``entry/src/main/cpp`` and ``APP_LIBRARY_NAME = libQtHarmonyApp.so`` — a
  project that builds and runs (the smoke test proved it) until
  deploy_qt_libs.py switches it to the application library.

    python scripts/template_patch.py --project <app>/project [--template <dir>] \
        [--envelope | --app-library libMyApp.so] [--bundle-name com.example.app] [--check]

Paths default to environment.tsv (template, Qt SDK, ABI). ``--check`` reports what
would change and exits 1 when something is missing. Record the printed edits
in tasks.tsv evidence; never edit SDK files or OhosExportModules.ts.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

import ohos_env

# Both spellings of an ArkTS lazy import: `lazy import { x } from` (older) and
# `import lazy { x } from` (current templates); either needs the beta3 stage (KI-003).
LAZY_RE = re.compile(r"\blazy\s+import\b|\bimport\s+lazy\b")
ENVELOPE_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "smoke"
ENVELOPE_LIBRARY = "libQtHarmonyApp.so"


CACHE_NAMES = {".hvigor", "build", "oh_modules", "node_modules", ".idea", ".cxx", "local.properties", ".preview"}


def _ignore_caches(directory: str, names: list[str]) -> set[str]:
    """Do not copy a template's build caches or machine-local files into a project."""
    return {name for name in names if name in CACHE_NAMES}


def uses_lazy_import(project: Path) -> bool:
    for pattern in ("**/*.ts", "**/*.ets"):
        for path in project.glob(pattern):
            if "node_modules" in path.parts or "oh_modules" in path.parts or "build" in path.parts:
                continue
            try:
                if LAZY_RE.search(path.read_text(encoding="utf-8", errors="replace")):
                    return True
            except OSError:
                continue
    return False


def patch_products_stage(text: str) -> tuple[str, int]:
    """Add compatibleSdkVersionStage beta3 after every compatibleSdkVersion line lacking it."""
    out, added = [], 0
    lines = text.splitlines(keepends=True)
    block = "\n".join(lines)
    has_stage = "compatibleSdkVersionStage" in block
    if has_stage:
        return text, 0
    for line in lines:
        out.append(line)
        match = re.match(r"^(\s*)([\"']?)compatibleSdkVersion\2\s*:\s*([\"'][^\"']*[\"']|[^,\s]+)\s*(,?)\s*(//.*)?$",
                         line.rstrip("\r\n"))
        if match:
            indent, quote = match.group(1), match.group(2) or '"'
            ending = "\r\n" if line.endswith("\r\n") else "\n"
            if not match.group(4):
                body = line.rstrip("\r\n")
                comment = match.group(5) or ""
                body = body[:len(body) - len(comment)].rstrip() if comment else body.rstrip()
                out[-1] = body + "," + (f" {comment}" if comment else "") + ending
            out.append(f'{indent}{quote}compatibleSdkVersionStage{quote}: "beta3",{ending}')
            added += 1
    return "".join(out), added


# No "/" before the key on its line: a commented-out `// "daemon": true` does not count.
DAEMON_RE = re.compile(r"""^([^\n/]*?["']?\bdaemon["']?\s*:\s*)(true|false)""", re.MULTILINE)


def daemon_disabled(text: str) -> bool:
    """hvigor-config.json5 sets execution.daemon to false (a commented line does not count)."""
    match = DAEMON_RE.search(text)
    return bool(match) and match.group(2) == "false"


def patch_daemon(text: str) -> tuple[str, bool]:
    """Set execution.daemon to false in hvigor-config.json5 (KI-004)."""
    if daemon_disabled(text):
        return text, False
    if DAEMON_RE.search(text):
        return DAEMON_RE.sub(r"\1false", text, count=1), True
    if re.search(r"""["']?execution["']?\s*:\s*\{""", text):
        return re.sub(r"""(["']?execution["']?\s*:\s*\{)""", r'\1\n    "daemon": false,', text, count=1), True
    return text.replace("{", '{\n  "execution": { "daemon": false },', 1), True


def patch_entry_profile(text: str, qt_sdk: str, abi: str) -> tuple[str, list[str]]:
    changes = []
    prefix = f"-DCMAKE_PREFIX_PATH={Path(qt_sdk).as_posix()}"
    pattern = re.compile(r"([\"']?arguments[\"']?\s*:\s*)([\"'])(.*?)\2")
    match = pattern.search(text)
    if match:
        current = match.group(3)
        if prefix in current:
            updated = current
        elif "CMAKE_PREFIX_PATH" in current:
            updated = re.sub(r"-DCMAKE_PREFIX_PATH=.*?(?=\s+-D|$)", lambda _m: prefix, current)
        else:
            updated = (current + " " + prefix).strip()
        if updated != current:
            text = text[:match.start(3)] + updated + text[match.end(3):]
            changes.append(f"externalNativeOptions.arguments -> {updated}")
    elif "externalNativeOptions" in text:
        text = re.sub(r"([\"']?externalNativeOptions[\"']?\s*:\s*\{)", r'\1\n      "arguments": "' + prefix.replace("\\", "/") + '",',
                      text, count=1)
        changes.append(f"externalNativeOptions.arguments added: {prefix}")
    abi_pattern = re.compile(r"([\"']?abiFilters[\"']?\s*:\s*)\[(.*?)\]", re.DOTALL)
    match = abi_pattern.search(text)
    if match:
        values = re.findall(r"[\"']([^\"']+)[\"']", match.group(2))
        if values != [abi]:
            text = text[:match.start(2)] + f'\n        "{abi}"\n      ' + text[match.end(2):]
            changes.append(f"abiFilters {values} -> ['{abi}']")
    return text, changes


def patch_constant(text: str, name: str, value: str) -> tuple[str, bool]:
    pattern = re.compile(r"(export\s+const\s+" + re.escape(name) + r"\s*=\s*)(['\"])(.*?)\2")
    match = pattern.search(text)
    if not match or match.group(3) == value:
        return text, False
    return text[:match.start(3)] + value + text[match.end(3):], True


def patch_bundle(text: str, bundle: str) -> tuple[str, bool]:
    pattern = re.compile(r"([\"']?bundleName[\"']?\s*:\s*)(['\"])(.*?)\2")
    match = pattern.search(text)
    if not match or match.group(3) == bundle:
        return text, False
    return text[:match.start(3)] + bundle + text[match.end(3):], True


def apply(project: Path, template: Path | None, qt_sdk: Path | None, abi: str, app_library: str | None,
          bundle: str | None, check: bool, envelope: bool = False,
          env_profile: Path | None = None) -> tuple[list[str], list[str]]:
    """Return (changes, problems). ``env_profile`` is recorded in the project's
    ``.ohos-qt-env`` pointer so every script finds it from the project."""
    changes, problems = [], []
    if envelope:
        app_library = ENVELOPE_LIBRARY
    if not (project / "hvigorfile.ts").is_file():
        if not template or not (template / "hvigorfile.ts").is_file():
            return changes, [f"{project} is not a hvigor project and no complete template was given"]
        if check:
            changes.append(f"would copy template {template} -> {project}")
            return changes, problems
        shutil.copytree(template, project, dirs_exist_ok=True, ignore=_ignore_caches)
        changes.append(f"copied complete template {template} -> {project}")

    def edit(rel: str, func) -> None:
        path = project / rel
        if not path.is_file():
            problems.append(f"{rel} missing in the project")
            return
        text = path.read_text(encoding="utf-8")
        new, notes = func(text)
        if new != text:
            changes.extend(f"{rel}: {note}" for note in notes)
            if not check:
                path.write_text(new, encoding="utf-8", newline="")

    if uses_lazy_import(project):
        def stage(text):
            new, added = patch_products_stage(text)
            if not added and "compatibleSdkVersionStage" not in text:
                problems.append("build-profile.json5: the glue uses lazy import but no compatibleSdkVersion line could be "
                                "patched; add \"compatibleSdkVersionStage\": \"beta3\" to every product by hand (KI-003)")
            return new, [f"compatibleSdkVersionStage beta3 added to {added} product(s) (KI-003)"] if added else []
        edit("build-profile.json5", stage)

    def daemon(text):
        new, changed = patch_daemon(text)
        return new, ["execution.daemon -> false (KI-004)"] if changed else []
    edit("hvigor/hvigor-config.json5", daemon)
    if qt_sdk:
        cmake_path = ohos_env.short_path(qt_sdk)
        if " " in cmake_path:
            problems.append(f"Qt SDK path {qt_sdk} contains spaces; CMake splits the arguments string at them. "
                            "Use a space-free location (junction) for the SDK")
        edit("entry/build-profile.json5", lambda text: patch_entry_profile(text, cmake_path, abi))
    else:
        problems.append("Qt SDK unknown (environment.tsv qt-sdk path or --qt-sdk): CMAKE_PREFIX_PATH not set")
    if app_library:
        if not re.fullmatch(r"lib[\w.+-]+\.so", app_library):
            problems.append(f"--app-library must look like lib<name>.so, got {app_library}")
        else:
            constants = next(iter(sorted(project.glob("entry/src/main/ets/**/QtAppConstants.ets"))), None)
            if constants:
                def lib(text):
                    new, changed = patch_constant(text, "APP_LIBRARY_NAME", app_library)
                    return new, [f"APP_LIBRARY_NAME -> {app_library}"] if changed else []
                edit(constants.relative_to(project).as_posix(), lib)
            else:
                problems.append("QtAppConstants.ets not found under entry/src/main/ets")
    if bundle:
        if not re.fullmatch(r"[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){2,}", bundle):
            problems.append(f"bundleName {bundle} must look like com.company.app (no spaces or special characters)")
        else:
            def bundle_edit(text):
                new, changed = patch_bundle(text, bundle)
                return new, [f"bundleName -> {bundle}"] if changed else []
            edit("AppScope/app.json5", bundle_edit)
    if envelope and (project / "hvigorfile.ts").is_file():
        cpp = project / "entry" / "src" / "main" / "cpp"
        for name in ("CMakeLists.txt", "main.cpp"):
            source, target = ENVELOPE_ASSETS / name, cpp / name
            if not target.is_file() or target.read_bytes() != source.read_bytes():
                changes.append(f"envelope {name} -> entry/src/main/cpp/{name}")
                if not check:
                    cpp.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
    if env_profile and (project / "hvigorfile.ts").is_file():
        pointer = project / ohos_env.PROJECT_PROFILE_POINTER
        value = str(Path(env_profile).resolve())
        if not pointer.is_file() or pointer.read_text(encoding="utf-8").strip() != value:
            changes.append(f"{ohos_env.PROJECT_PROFILE_POINTER} -> {value}")
            if not check:
                pointer.write_text(value + "\n", encoding="utf-8")
    if qt_sdk:
        style = Path(qt_sdk) / "plugins" / "styles" / "libqohosstyle.so"
        target = project / "entry" / "libs" / abi / "styles" / "libqohosstyle.so"
        if style.is_file():
            if not target.is_file() or target.stat().st_size != style.stat().st_size:
                changes.append(f"copied {style.name} -> {target.relative_to(project).as_posix()}")
                if not check:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(style, target)
        else:
            problems.append(f"{style} not found: the style plugin cannot be deployed")
    return changes, problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--template", type=Path)
    parser.add_argument("--qt-sdk", type=Path)
    parser.add_argument("--abi")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--app-library", help="lib<name>.so loaded by libqohos (APP_LIBRARY_NAME)")
    group.add_argument("--envelope", action="store_true", help="install the Qt envelope app (a working project until the app library is deployed)")
    parser.add_argument("--bundle-name")
    parser.add_argument("--env-profile", type=Path)
    parser.add_argument("--check", action="store_true", help="report only; exit 1 when an edit is still needed")
    args = parser.parse_args(argv)
    ohos_env.utf8_console()
    project = args.project.resolve()
    profile, profile_path = ohos_env.app_profile(project, args.env_profile)
    template = args.template or (Path(p) if (p := ohos_env.profile_value(profile, "paths", "template")) else None)
    qt_sdk = args.qt_sdk or (Path(p) if (p := ohos_env.profile_value(profile, "paths", "qt_sdk")) else None)
    abi = args.abi or ohos_env.profile_value(profile, "abi", default="arm64-v8a")
    changes, problems = apply(project, template, qt_sdk, abi, args.app_library, args.bundle_name, args.check,
                              envelope=args.envelope, env_profile=profile_path)
    print(json.dumps({"project": str(project), "check": args.check, "changes": changes, "problems": problems},
                     ensure_ascii=False, indent=2))
    if problems:
        return 1
    return 1 if args.check and changes else 0


if __name__ == "__main__":
    sys.exit(main())

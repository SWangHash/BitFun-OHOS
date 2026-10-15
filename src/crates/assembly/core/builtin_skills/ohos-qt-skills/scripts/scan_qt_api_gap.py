#!/usr/bin/env python3
"""Find Qt APIs that are newer than the target Qt-for-HarmonyOS SDK.

Applications often declare (or silently rely on) a newer Qt than the OHOS SDK
provides, e.g. ksnip needs Qt 5.15 while the SDK is Qt 5.12. Each such API
fails in a different translation unit, and a build that stops at the first
error reveals them one by one. Run this scan during the inventory phase,
record one ``CAP-*`` row for the gap, and fix the hits in one slice before the
first full application build.

The pattern table is a heuristic, not a compiler: inspect every hit in context
(a hit inside an ``#if`` that tests ``QT_VERSION`` is reported as
``guarded?``) and record the scan command, scope and counts as
``inventory.tsv`` scan evidence.
"""
from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path

# (introduced in, label, regex). Extend when a new gap is diagnosed.
API_TABLE: list[tuple[tuple[int, int], str, str]] = [
    ((5, 13), "QList/QVector::swapItemsAt", r"\.swapItemsAt\("),
    ((5, 13), "QImage::convertTo", r"\.convertTo\(\s*QImage::"),
    ((5, 14), "Qt:: stream manipulators (Qt::endl, Qt::hex, ...)",
     r"\bQt::(endl|flush|hex|dec|oct|bin|fixed|scientific|left|right|center|ws|reset|showbase|noshowbase)\b"),
    ((5, 14), "Qt::SplitBehavior (Qt::SkipEmptyParts/KeepEmptyParts)", r"\bQt::(SkipEmptyParts|KeepEmptyParts|SplitBehavior)\b"),
    ((5, 14), "QRecursiveMutex", r"\bQRecursiveMutex\b"),
    ((5, 14), "QColorSpace", r"\bQColorSpace\b"),
    ((5, 14), "QCalendar", r"\bQCalendar\b"),
    ((5, 14), "QDate/QDateTime startOfDay/endOfDay", r"\.(startOfDay|endOfDay)\("),
    ((5, 14), "input event position()/globalPosition() (QWheelEvent 5.14, mouse/drag events 6.0)",
     r"->(position|globalPosition|scenePosition)\(\)"),
    ((5, 14), "Markdown text (setMarkdown/toMarkdown/Qt::MarkdownText)", r"\b(setMarkdown|toMarkdown)\(|\bQt::MarkdownText\b"),
    ((5, 15), "QScreen::virtualSiblingAt", r"\bvirtualSiblingAt\("),
    ((5, 15), "QNetworkRequest::setTransferTimeout", r"\bsetTransferTimeout\("),
    ((5, 15), "QProcess::splitCommand", r"\bQProcess::splitCommand\("),
    ((5, 15), "QFile::moveToTrash", r"\bmoveToTrash\("),
    ((5, 15), "QMetaType::fromType", r"\bQMetaType::fromType<"),
    ((5, 15), "Qt::ReturnByValue (QLabel::pixmap)", r"\bQt::ReturnByValue\b"),
    ((6, 0), "QProcess::startCommand", r"\bstartCommand\("),
    ((6, 0), "QVariant::typeId/metaType", r"\.(typeId|metaType)\(\)"),
    ((6, 0), "Qt 6 only headers", r"#\s*include\s*<(QtCore5Compat|QStringConverter|QPromise|QUtf8StringView|QAnyStringView)"),
]

SOURCE_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".mm", ".qml"}
DEFAULT_EXCLUDES = {".git", "build", "migration", "node_modules", "oh_modules", ".hvigor", "HarmonyOS"}
GUARD_RE = re.compile(r"QT_VERSION\s*[<>=]|QT_VERSION_CHECK")
DECLARED_RES = [
    re.compile(r"find_package\s*\(\s*Qt[56]?\w*\s+(\d+\.\d+(?:\.\d+)?)", re.IGNORECASE),
    re.compile(r"set\s*\(\s*QT_MIN(?:IMUM)?_VERSION\s+\"?(\d+\.\d+(?:\.\d+)?)", re.IGNORECASE),
    re.compile(r"versionAtLeast\s*\(\s*QT_VERSION\s*,\s*(\d+\.\d+(?:\.\d+)?)"),
]


def parse_version(text: str) -> tuple[int, int]:
    parts = [int(part) for part in text.split(".")[:2]]
    return (parts[0], parts[1] if len(parts) > 1 else 0)


def walk(root: Path, excludes: set[str]):
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in excludes or part.startswith("build-") for part in relative.parts[:-1]):
            continue
        if path.is_file():
            yield path, relative


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source_root", type=Path)
    parser.add_argument("--target-qt", required=True, help="Qt version of the OHOS SDK, e.g. 5.12.12")
    parser.add_argument("--exclude", action="append", default=[], help="extra directory names to skip (repeatable)")
    parser.add_argument("--max-locations", type=int, default=8)
    args = parser.parse_args()
    root = args.source_root.resolve()
    target = parse_version(args.target_qt)
    excludes = DEFAULT_EXCLUDES | set(args.exclude)
    patterns = [(version, label, re.compile(regex)) for version, label, regex in API_TABLE if version > target]

    declared: list[str] = []
    hits: dict[str, list[str]] = defaultdict(list)
    versions = {label: version for version, label, _ in patterns}
    scanned = 0
    for path, relative in walk(root, excludes):
        name = path.name
        if name == "CMakeLists.txt" or path.suffix.lower() in {".cmake", ".pro", ".pri"}:
            text = path.read_text(encoding="utf-8", errors="replace")
            for regex in DECLARED_RES:
                declared.extend(f"{relative.as_posix()}: Qt {match}" for match in regex.findall(text))
            continue
        if path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        scanned += 1
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        conditionals: list[bool] = []  # one entry per open #if; True when it tests QT_VERSION
        for number, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                directive = stripped[1:].lstrip()
                if directive.startswith("if"):
                    conditionals.append(bool(GUARD_RE.search(directive)))
                elif directive.startswith("elif") and conditionals:
                    conditionals[-1] = conditionals[-1] or bool(GUARD_RE.search(directive))
                elif directive.startswith("endif") and conditionals:
                    conditionals.pop()
            if stripped.startswith("//"):
                continue
            for _, label, regex in patterns:
                if regex.search(line):
                    guarded = any(conditionals)
                    hits[label].append(f"{relative.as_posix()}:{number}" + (" (guarded?)" if guarded else ""))

    print(f"scope: {root} ({scanned} source files; excluded dirs: {', '.join(sorted(excludes))}, build-*)")
    print(f"target Qt: {args.target_qt}; checked {len(patterns)} API patterns newer than {target[0]}.{target[1]}")
    newer = [item for item in declared if parse_version(item.rsplit(" ", 1)[1]) > target]
    for item in declared:
        print(f"declared minimum: {item}" + ("  <-- newer than target SDK" if item in newer else ""))
    if not declared:
        print("declared minimum: none found in CMake/qmake files")
    total = sum(len(locations) for locations in hits.values())
    for label in sorted(hits, key=lambda item: (versions[item], item)):
        locations = hits[label]
        version = versions[label]
        print(f"\n[Qt {version[0]}.{version[1]}] {label}: {len(locations)} hit(s)")
        for location in locations[: args.max_locations]:
            print(f"  {location}")
        if len(locations) > args.max_locations:
            print(f"  ... {len(locations) - args.max_locations} more")
    print(f"\ntotal hits: {total}")
    if total or newer:
        print("next: record one CAP row (category qt-api-gap) listing these files, add OHOS/Qt-version "
              "shims in one slice, and verify with a keep-going build (-k 0)")
    else:
        print("no known newer-API hits; this table is a heuristic, so keep compiler receipts as the final proof")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

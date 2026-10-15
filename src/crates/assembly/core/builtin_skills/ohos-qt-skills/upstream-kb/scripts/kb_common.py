"""Shared paths and file formats for the upstream knowledge-base folder.

Everything that touches the upstream ``ohos_qt-skills`` repository lives under
``<skill>/upstream-kb/``:

    upstream-kb/
      AGENTS.md            sync guide for the agent (entry point)
      upstream.json        default upstream repo/branch + last synced revision
      exclusions.tsv       upstream paths deliberately left out (path, reason, decided_at)
      required-paths.txt   upstream pages the skill's own documents depend on
      manifest.tsv         skill-level baseline manifest (one row per upstream path)
      SYNC_LOG.md          append-only history of applied syncs
      knowledge/           the released baseline: upstream bytes, never hand-edited
      scripts/             sync_upstream.py, verify_kb.py, this module
      .sync/               (gitignored) plan, review sheet and incoming files
"""
from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

KB_DIR = Path(__file__).resolve().parent.parent
SKILL_ROOT = KB_DIR.parent
KNOWLEDGE_DIR = KB_DIR / "knowledge"
MANIFEST = KB_DIR / "manifest.tsv"
EXCLUSIONS = KB_DIR / "exclusions.tsv"
REQUIRED = KB_DIR / "required-paths.txt"
UPSTREAM_LOCK = KB_DIR / "upstream.json"
SYNC_LOG = KB_DIR / "SYNC_LOG.md"
WORK_DIR = KB_DIR / ".sync"

# snapshot_path values are relative to the skill root, so a project manifest's
# skill_snapshot_path resolves directly against the installed skill.
SNAPSHOT_PREFIX = KNOWLEDGE_DIR.relative_to(SKILL_ROOT).as_posix() + "/"

MANIFEST_FIELDS = [
    "source_revision", "source_path", "source_sha256", "snapshot_path",
    "snapshot_sha256", "used", "modified", "action", "last_synced_at",
]
EXCLUSION_FIELDS = ["path", "reason", "decided_at"]

# Rows whose page is part of the released baseline.
ACTIVE_ACTIONS = {"copied", "updated", "unchanged", "kept-local"}
# Rows kept for audit only; no file exists under knowledge/.
INACTIVE_ACTIONS = {"excluded-by-policy", "source-removed"}

# Local files that may live under knowledge/ without being baseline pages.
IGNORED_PARTS = {"__pycache__", ".DS_Store"}
IGNORED_PREFIXES = ("portgraph/workspace/",)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_path(source_path: str) -> str:
    return SNAPSHOT_PREFIX + source_path


def is_ignored_local(rel: str) -> bool:
    parts = rel.split("/")
    return any(part in IGNORED_PARTS for part in parts) or rel.endswith(".pyc") \
        or rel.startswith(IGNORED_PREFIXES)


def read_manifest(path: Path = MANIFEST) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as stream:
        return {row["source_path"]: row for row in csv.DictReader(stream, delimiter="\t")}


def write_manifest(rows: list[dict[str, str]], path: Path = MANIFEST) -> None:
    rows = sorted(rows, key=lambda row: row["source_path"])
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=MANIFEST_FIELDS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows({key: row.get(key, "") for key in MANIFEST_FIELDS} for row in rows)


def read_exclusion_rows(path: Path = EXCLUSIONS) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return [
            {key: (row.get(key) or "").strip() for key in EXCLUSION_FIELDS}
            for row in csv.DictReader(stream, delimiter="\t")
        ]


def read_exclusions(path: Path = EXCLUSIONS) -> dict[str, str]:
    """path -> reason. A blank reason is a hard error: no cut without justification."""
    exclusions: dict[str, str] = {}
    for row in read_exclusion_rows(path):
        rel = row["path"].replace("\\", "/")
        if not rel:
            continue
        if not row["reason"]:
            raise SystemExit(f"exclusion entry without a reason is not allowed: {rel}")
        exclusions[rel] = row["reason"]
    return exclusions


def write_exclusions(rows: list[dict[str, str]], path: Path = EXCLUSIONS) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=EXCLUSION_FIELDS, delimiter="\t",
                                lineterminator="\n", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


def excluded_by(rel: str, exclusions: dict[str, str]) -> str | None:
    """Return the exclusion entry covering rel (exact file or directory prefix)."""
    if rel in exclusions:
        return rel
    matches = [key for key in exclusions if key.endswith("/") and rel.startswith(key)]
    return max(matches, key=len) if matches else None


def read_required(path: Path = REQUIRED) -> list[str]:
    if not path.exists():
        return []
    entries = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


def required_missing(required: list[str], active: set[str]) -> list[str]:
    missing = []
    for entry in required:
        if entry.endswith("/"):
            if not any(path.startswith(entry) for path in active):
                missing.append(entry)
        elif entry not in active:
            missing.append(entry)
    return missing


def read_lock(path: Path = UPSTREAM_LOCK) -> dict[str, str]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_lock(data: dict[str, str], path: Path = UPSTREAM_LOCK) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

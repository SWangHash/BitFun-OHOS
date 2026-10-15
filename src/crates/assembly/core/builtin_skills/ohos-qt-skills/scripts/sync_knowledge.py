#!/usr/bin/env python3
"""Record skill-baseline knowledge provenance for a Qt migration project.

Projects never copy the skill knowledge baseline. This script verifies the
released baseline, then writes <target>/knowledge-manifest.tsv: the single
evidence chain that pins, per page, the baseline set, upstream revision, and
content hash the migration consulted. Local files exist only for pages the
project adapted for the target (--register-modified).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
from datetime import datetime, timezone
from pathlib import Path

FIELDS = [
    "baseline_manifest_sha256", "source_revision", "source_path",
    "source_sha256", "skill_snapshot_path", "skill_snapshot_sha256",
    "snapshot_path", "snapshot_sha256", "used", "modified", "action",
    "last_synced_at",
]

INACTIVE_ACTIONS = {"source-removed", "not-selected", "retired-from-skill-baseline", "excluded-by-policy"}
# Skill baseline: upstream-kb/manifest.tsv + upstream-kb/knowledge/ (maintained by
# upstream-kb/scripts/sync_upstream.py; never by a migration).


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def skill_root() -> Path:
    return Path(__file__).resolve().parent.parent


def read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return list(csv.DictReader(stream, delimiter="\t"))


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def active_baseline(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [row for row in rows if row.get("action", "") not in INACTIVE_ACTIONS]


def verify_baseline(rows: list[dict[str, str]]) -> None:
    """Every active baseline row's file must match its recorded hash."""
    root = skill_root()
    for row in rows:
        rel = row.get("source_path", "").strip()
        snapshot_rel = row.get("snapshot_path", "").strip()
        expected = row.get("snapshot_sha256", "").strip()
        if not rel or not snapshot_rel or not expected:
            raise SystemExit(f"invalid skill baseline row: {rel or '<missing source_path>'}")
        source = (root / snapshot_rel).resolve()
        if root not in source.parents or not source.is_file():
            raise SystemExit(f"skill baseline file missing or outside skill: {snapshot_rel}")
        if sha256(source) != expected:
            raise SystemExit(f"skill baseline hash mismatch: {snapshot_rel}")


def local_knowledge_path(target: Path, source_path: str) -> Path:
    return target / "knowledge" / Path(source_path)


def build_row(baseline: dict[str, str], old: dict[str, str], baseline_hash: str,
              target: Path, now: str) -> dict[str, str]:
    rel = baseline["source_path"]
    provenance = {
        "baseline_manifest_sha256": baseline_hash,
        "source_revision": baseline.get("source_revision", ""),
        "source_path": rel,
        "source_sha256": baseline.get("source_sha256", ""),
        "skill_snapshot_path": baseline.get("snapshot_path", ""),
        "skill_snapshot_sha256": baseline.get("snapshot_sha256", ""),
    }
    if old.get("modified") == "yes":
        local = local_knowledge_path(target, rel)
        if not local.is_file():
            raise SystemExit(
                f"registered modified page is missing on disk: {local}\n"
                "Restore it or record the disposal decision, then re-run."
            )
        return {
            **provenance,
            "snapshot_path": local.relative_to(target).as_posix(),
            "snapshot_sha256": sha256(local),
            "used": "yes",
            "modified": "yes",
            "action": "locally-modified",
            "last_synced_at": now,
        }
    return {
        **provenance,
        "snapshot_path": "",
        "snapshot_sha256": "",
        "used": old.get("used", "no"),
        "modified": "no",
        "action": "referenced",
        "last_synced_at": now,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target", required=True, type=Path,
        help="target migration directory, normally <Qt project>/migration/ohos",
    )
    parser.add_argument(
        "--register-modified", metavar="SOURCE_PATH",
        help="register a locally adapted copy stored at <target>/knowledge/<source_path>; "
             "the manifest records the local file and the baseline page it was adapted from",
    )
    args = parser.parse_args()

    root = skill_root()
    target = args.target.resolve()
    if target == root or root in target.parents:
        raise SystemExit("target must be a Qt migration project, not the skill directory")
    target.mkdir(parents=True, exist_ok=True)

    skill_manifest = root / "upstream-kb" / "manifest.tsv"
    baseline_rows = active_baseline(read_rows(skill_manifest))
    if not baseline_rows:
        raise SystemExit("skill knowledge baseline is empty")
    baseline_hash = sha256(skill_manifest)
    # Excluded policy rows are provenance records, not files that belong to
    # the installed baseline. Verify only the active snapshot set.
    verify_baseline(baseline_rows)

    manifest = target / "knowledge-manifest.tsv"
    if manifest.exists():
        previous_rows = read_rows(manifest)
        if not previous_rows or "baseline_manifest_sha256" not in previous_rows[0]:
            raise SystemExit(
                f"project knowledge manifest is corrupt or unreadable: {manifest}\n"
                "Restore it from version control or delete it after an explicit "
                "user decision, then re-run."
            )
    else:
        previous_rows = []
    previous = {row["source_path"]: row for row in previous_rows if row.get("source_path")}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if previous_rows:
        pinned = {row.get("baseline_manifest_sha256", "") for row in previous_rows}
        if pinned != {baseline_hash}:
            old_hash = next(iter(pinned)) or "<none>"
            differing = [
                row["source_path"] for row in baseline_rows
                if previous.get(row["source_path"], {}).get("source_sha256") != row.get("source_sha256", "")
            ]
            print("skill baseline changed since this migration pinned it:")
            print(f"  pinned_baseline={old_hash}")
            print(f"  current_baseline={baseline_hash}")
            print(f"  new_or_changed_pages={len(differing)}")
            for rel in differing[:20]:
                print(f"  - {rel}")
            print("A migration runs against one frozen baseline. Report this to the user;")
            print("only the user decides to restart the migration (delete the project")
            print("knowledge-manifest.tsv, or the whole migration directory, and re-run).")
            return 2

    if args.register_modified:
        rel = args.register_modified.strip().replace("\\", "/").strip("/")
        baseline = next((row for row in baseline_rows if row["source_path"] == rel), None)
        if baseline is None:
            raise SystemExit(f"source_path is not an active skill baseline page: {rel}")
        local = local_knowledge_path(target, rel)
        if not local.is_file():
            raise SystemExit(
                f"local adapted copy missing: {local}\n"
                "Create it from the pinned baseline page first, then register."
            )
        local_hash = sha256(local)
        if local_hash == baseline.get("snapshot_sha256"):
            raise SystemExit("local file is identical to the skill baseline page; nothing modified to register")
        rows = []
        for row in baseline_rows:
            if row["source_path"] == rel:
                rows.append({
                    "baseline_manifest_sha256": baseline_hash,
                    "source_revision": baseline.get("source_revision", ""),
                    "source_path": rel,
                    "source_sha256": baseline.get("source_sha256", ""),
                    "skill_snapshot_path": baseline.get("snapshot_path", ""),
                    "skill_snapshot_sha256": baseline.get("snapshot_sha256", ""),
                    "snapshot_path": local.relative_to(target).as_posix(),
                    "snapshot_sha256": local_hash,
                    "used": "yes",
                    "modified": "yes",
                    "action": "locally-modified",
                    "last_synced_at": now,
                })
            else:
                rows.append(build_row(row, previous.get(row["source_path"], {}), baseline_hash, target, now))
        write_manifest(manifest, rows)
        print(f"registered_modified={rel}")
        print(f"snapshot_path={local.relative_to(target).as_posix()}")
        print(f"snapshot_sha256={local_hash}")
        return 0

    counts = {"referenced": 0, "locally-modified": 0, "used": 0}
    rows = []
    for row in baseline_rows:
        new_row = build_row(row, previous.get(row["source_path"], {}), baseline_hash, target, now)
        rows.append(new_row)
        if new_row["modified"] == "yes":
            counts["locally-modified"] += 1
        else:
            counts["referenced"] += 1
        if new_row["used"] == "yes":
            counts["used"] += 1

    tracked = {row["snapshot_path"] for row in rows if row["snapshot_path"]}
    untracked = 0
    knowledge_dir = target / "knowledge"
    if knowledge_dir.exists():
        for path in knowledge_dir.rglob("*"):
            if path.is_file() and path.relative_to(target).as_posix() not in tracked:
                untracked += 1
                print(f"untracked knowledge file (register with --register-modified or remove): {path}")

    write_manifest(manifest, rows)
    print(f"skill_baseline_manifest_sha256={baseline_hash}")
    print(f"pages={len(rows)} " + " ".join(f"{key}={value}" for key, value in counts.items()))
    return 2 if untracked else 0


if __name__ == "__main__":
    raise SystemExit(main())

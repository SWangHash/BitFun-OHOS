#!/usr/bin/env python3
"""Verify the skill's upstream knowledge baseline (upstream-kb/).

Checks, without network access:
  1. exclusions.tsv  - header, a reason on every row, no duplicates
  2. manifest.tsv    - header, known actions, every active page present with its
                       recorded hash, modified flag consistent (snapshot != source),
                       no active page matched by an exclusion, no file left behind
                       for inactive rows
  3. knowledge/      - no file that the manifest does not track
  4. required-paths.txt - every page the skill documents depend on is active
  5. upstream.json   - present; its revision matches the active rows
  6. skill documents - every `upstream-kb/knowledge/...` path they cite exists
  --smoke            - also seed a throw-away migration with init_migration.py and
                       run validate_ledgers.py against it (proves the baseline can
                       be pinned by a project)

Exit code 1 when any error is found; warnings do not fail.
"""
from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kb_common import (  # noqa: E402
    ACTIVE_ACTIONS, EXCLUSION_FIELDS, EXCLUSIONS, INACTIVE_ACTIONS, KB_DIR, KNOWLEDGE_DIR,
    MANIFEST, MANIFEST_FIELDS, SKILL_ROOT, SNAPSHOT_PREFIX, UPSTREAM_LOCK, WORK_DIR,
    excluded_by, is_ignored_local, read_lock, read_required, required_missing,
    sha256_file, snapshot_path,
)

DOC_GLOBS = ["SKILL.md", "README.md", "AGENTS.md", "references/*.md", "features/*.md", "upstream-kb/AGENTS.md"]
CITE_RE = re.compile(r"upstream-kb/knowledge/([A-Za-z0-9_.\-/]+)")


def check_exclusions(errors: list[str]) -> dict[str, str]:
    if not EXCLUSIONS.exists():
        errors.append("exclusions.tsv is missing")
        return {}
    with EXCLUSIONS.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if reader.fieldnames != EXCLUSION_FIELDS:
            errors.append(f"exclusions.tsv header must be {EXCLUSION_FIELDS}, got {reader.fieldnames}")
        exclusions: dict[str, str] = {}
        for number, row in enumerate(reader, 2):
            rel = (row.get("path") or "").strip()
            reason = (row.get("reason") or "").strip()
            if not rel:
                errors.append(f"exclusions.tsv line {number}: empty path")
                continue
            if not reason:
                errors.append(f"exclusions.tsv line {number}: {rel} has no reason")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", (row.get("decided_at") or "").strip()):
                errors.append(f"exclusions.tsv line {number}: {rel} decided_at must be YYYY-MM-DD")
            if rel in exclusions:
                errors.append(f"exclusions.tsv: duplicate entry {rel}")
            exclusions[rel] = reason
    return exclusions


def git_ignored(paths: list[str]) -> set[str]:
    if not paths:
        return set()
    try:
        result = subprocess.run(["git", "-C", str(SKILL_ROOT), "check-ignore", "--stdin"],
                                input="\n".join(paths), capture_output=True, text=True)
    except OSError:
        return set()
    return set(result.stdout.split("\n")) if result.returncode in (0, 1) else set()


def verify(smoke: bool = False) -> int:
    errors: list[str] = []
    warnings: list[str] = []
    exclusions = check_exclusions(errors)

    rows: list[dict[str, str]] = []
    if not MANIFEST.exists():
        errors.append("manifest.tsv is missing")
    else:
        with MANIFEST.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream, delimiter="\t")
            if reader.fieldnames != MANIFEST_FIELDS:
                errors.append(f"manifest.tsv header must be {MANIFEST_FIELDS}")
            rows = list(reader)
        if b"\r\n" in MANIFEST.read_bytes():
            errors.append("manifest.tsv has CRLF line endings; its hash is the baseline id - restore LF")

    seen: set[str] = set()
    active: set[str] = set()
    revisions: set[str] = set()
    for row in rows:
        rel, action = row.get("source_path", ""), row.get("action", "")
        if rel in seen:
            errors.append(f"manifest: duplicate source_path {rel}")
        seen.add(rel)
        if action in ACTIVE_ACTIONS:
            active.add(rel)
            revisions.add(row.get("source_revision", ""))
            expected_path = snapshot_path(rel)
            if row.get("snapshot_path") != expected_path:
                errors.append(f"manifest: {rel} snapshot_path should be {expected_path}")
                continue
            page = SKILL_ROOT / expected_path
            if not page.is_file():
                errors.append(f"baseline page missing: {expected_path}")
                continue
            actual = sha256_file(page)
            if actual != row.get("snapshot_sha256"):
                errors.append(f"baseline page edited (hash mismatch): {expected_path}")
            diverged = row.get("snapshot_sha256") != row.get("source_sha256")
            if row.get("modified") != ("yes" if diverged else "no"):
                errors.append(f"manifest: {rel} modified flag inconsistent with hashes")
            if diverged and action != "kept-local":
                warnings.append(f"{rel} diverges from upstream but action is {action}")
            rule = excluded_by(rel, exclusions)
            if rule:
                errors.append(f"active page {rel} is matched by exclusion {rule}; re-run sync plan/apply")
        elif action in INACTIVE_ACTIONS:
            if row.get("snapshot_path") or row.get("snapshot_sha256"):
                errors.append(f"manifest: inactive row {rel} must not carry snapshot fields")
            if (KNOWLEDGE_DIR / rel).exists():
                errors.append(f"file present for inactive row ({action}): {SNAPSHOT_PREFIX}{rel}")
            if action == "excluded-by-policy" and not excluded_by(rel, exclusions):
                warnings.append(f"{rel} is recorded excluded but no exclusion covers it; next sync will offer it as new")
        else:
            errors.append(f"manifest: {rel} has unknown action '{action}'")

    local = []
    if KNOWLEDGE_DIR.exists():
        for path in KNOWLEDGE_DIR.rglob("*"):
            rel = path.relative_to(KNOWLEDGE_DIR).as_posix()
            if path.is_file() and rel not in active and not is_ignored_local(rel):
                local.append(rel)
    ignored = git_ignored([SNAPSHOT_PREFIX + rel for rel in local])
    for rel in sorted(local):
        if SNAPSHOT_PREFIX + rel not in ignored:
            errors.append(f"untracked file in baseline (not upstream bytes): {SNAPSHOT_PREFIX}{rel}")

    for entry in required_missing(read_required(), active):
        errors.append(f"required upstream path missing from baseline: {entry} (see required-paths.txt)")

    lock = read_lock()
    if not lock:
        errors.append("upstream.json is missing")
    else:
        for key in ("repo", "revision"):
            if not lock.get(key):
                errors.append(f"upstream.json has no {key}")
        if revisions and revisions != {lock.get("revision")}:
            warnings.append(f"active rows carry revisions {sorted(revisions)} but upstream.json pins {lock.get('revision')}")

    for pattern in DOC_GLOBS:
        for doc in SKILL_ROOT.glob(pattern):
            for match in CITE_RE.finditer(doc.read_text(encoding="utf-8", errors="replace")):
                cited = match.group(1).rstrip(".,)")
                if not cited or "..." in cited:
                    continue
                target = KNOWLEDGE_DIR / cited
                if not target.exists() and SNAPSHOT_PREFIX + cited not in git_ignored([SNAPSHOT_PREFIX + cited]):
                    errors.append(f"{doc.relative_to(SKILL_ROOT)} cites missing page upstream-kb/knowledge/{cited}")

    if (WORK_DIR / "plan.json").exists():
        warnings.append("a sync plan is pending (upstream-kb/.sync/plan.json); apply it or delete .sync/")

    if smoke and not errors:
        errors.extend(smoke_test())

    if warnings:
        print("WARNINGS")
        print("\n".join(f"- {w}" for w in warnings))
    if errors:
        print("INVALID")
        print("\n".join(f"- {e}" for e in errors))
        return 1
    print(f"OK baseline pages={len(active)} manifest_rows={len(rows)} exclusions={len(exclusions)} "
          f"revision={lock.get('revision', '-')}" + (" smoke=passed" if smoke else ""))
    return 0


def smoke_test() -> list[str]:
    scripts = SKILL_ROOT / "scripts"
    with tempfile.TemporaryDirectory() as tmp:
        app = Path(tmp) / "app"
        app.mkdir()
        init = subprocess.run([sys.executable, str(scripts / "init_migration.py"), "--target", str(app),
                               "--template-root", str(SKILL_ROOT / "assets" / "templates" / "migration" / "ohos")],
                              capture_output=True, text=True)
        if init.returncode:
            return [f"smoke: init_migration.py failed:\n{init.stdout}{init.stderr}"]
        check = subprocess.run([sys.executable, str(scripts / "validate_ledgers.py"),
                                str(app / "migration" / "ohos")], capture_output=True, text=True)
        out = check.stdout + check.stderr
        if check.returncode:
            return [f"smoke: validate_ledgers.py failed on a fresh migration:\n{out}"]
        skill_warnings = [line for line in out.splitlines() if line.startswith("- ") and "skill" in line]
        if skill_warnings:
            return ["smoke: " + line[2:] for line in skill_warnings]
    return []


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--smoke", action="store_true", help="also seed and validate a throw-away migration")
    args = parser.parse_args()
    return verify(smoke=args.smoke)


if __name__ == "__main__":
    raise SystemExit(main())

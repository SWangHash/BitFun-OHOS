#!/usr/bin/env python3
"""Maintainer-only sync of the skill knowledge baseline from upstream ohos_qt-skills.

Two steps, with an agent/maintainer review in between (see upstream-kb/AGENTS.md):

  plan   Resolve one upstream commit (local checkout or git URL + branch), compare
         it with upstream-kb/manifest.tsv, and write upstream-kb/.sync/:
           plan.json      the computed change set (pinned to the commit)
           review.tsv     one row per new/changed/blocked path; fill in decisions
           incoming/      the new and changed upstream files, for reading
           diffs/         unified diffs of changed text files
         Nothing under knowledge/ is touched.

  apply  Execute the reviewed plan: copy included files, record excluded ones in
         exclusions.tsv with their reason, delete pages removed or excluded
         upstream, rewrite manifest.tsv and upstream.json, append SYNC_LOG.md,
         and run verify_kb.py. All-or-nothing: any undecided or invalid review
         row aborts before a single file changes.

  status Show the pinned upstream and any pending plan.

Upstream files are always read from a git commit (never a dirty working tree),
so every baseline page carries exact provenance.

Policy: keep by default, exclude only with a sufficient reason - but a file
that upstream adds is never taken silently; each one needs an include/exclude
decision in review.tsv.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kb_common import (  # noqa: E402
    ACTIVE_ACTIONS, EXCLUSIONS, KB_DIR, KNOWLEDGE_DIR, MANIFEST, SKILL_ROOT, SYNC_LOG,
    WORK_DIR, excluded_by, is_ignored_local, read_exclusion_rows, read_exclusions,
    read_lock, read_manifest, read_required, required_missing, sha256_bytes,
    sha256_file, snapshot_path, write_exclusions, write_lock, write_manifest,
)

REVIEW_FIELDS = ["path", "change", "size", "hint", "decision", "reason"]
DECISIONS = {
    "new": {"include", "exclude"},
    "changed": {"update", "exclude", "keep-local"},
    "blocked-local-edit": {"take-upstream", "keep-local"},
    "blocked-diverged": {"take-upstream", "keep-local"},
}
NEEDS_REASON = {"exclude", "keep-local"}
DEFAULT_DECISION = {"changed": "update"}
DEFAULT_CACHE = Path.home() / ".cache" / "qt-harmonyos-migration" / "upstream"

BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tar", ".gz", ".tgz",
              ".xz", ".7z", ".so", ".a", ".dll", ".exe", ".hap", ".har", ".bin", ".jar", ".whl"}
SECRET_RE = re.compile(
    rb"-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}"
    rb"|AKIA[0-9A-Z]{16}|(?i:(?:password|passwd|token|secret)\s*[:=]\s*['\"][^'\"\s]{8,}['\"])"
)
ARCHIVED_RE = re.compile(rb"^status:\s*(archived|deprecated|superseded)", re.M)


# --------------------------------------------------------------------------- git

def git(repo: Path, *args: str, binary: bool = False) -> str | bytes:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if result.returncode:
        raise SystemExit(f"git {' '.join(args)} failed in {repo}:\n"
                         + result.stderr.decode("utf-8", "replace").strip())
    return result.stdout if binary else result.stdout.decode("utf-8", "replace").strip()


def git_ok(repo: Path, *args: str) -> bool:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True).returncode == 0


class Tree:
    """Read-only view of one upstream commit."""

    def __init__(self, repo: Path, commit: str):
        self.repo, self.commit = repo, commit
        self.entries: dict[str, tuple[str, str]] = {}  # path -> (mode, blob sha)
        self.skipped: list[str] = []
        raw = git(repo, "ls-tree", "-r", "-z", "--full-tree", commit, binary=True)
        for item in raw.split(b"\0"):
            if not item:
                continue
            meta, path = item.split(b"\t", 1)
            mode, kind, sha = meta.decode().split()
            rel = path.decode("utf-8", "surrogateescape")
            if kind != "blob":
                self.skipped.append(f"{rel} ({kind})")
            else:
                self.entries[rel] = (mode, sha)
        self._proc = None

    def read(self, rel: str) -> bytes:
        if self._proc is None:
            self._proc = subprocess.Popen(["git", "-C", str(self.repo), "cat-file", "--batch"],
                                          stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        sha = self.entries[rel][1]
        self._proc.stdin.write(sha.encode() + b"\n")
        self._proc.stdin.flush()
        header = self._proc.stdout.readline().split()
        size = int(header[2])
        data = self._proc.stdout.read(size)
        self._proc.stdout.read(1)
        return data

    def close(self) -> None:
        if self._proc:
            self._proc.stdin.close()
            self._proc.wait()


def cache_dir_for(url: str, base: Path) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", re.sub(r"^[a-z]+://", "", url)).strip("_")
    return base / slug


def resolve_source(args, lock: dict) -> tuple[Path, str, dict]:
    """Return (git dir, commit, source description) for plan."""
    branch = args.branch
    if args.source:
        repo = Path(args.source).expanduser().resolve()
        if not repo.is_dir():
            raise SystemExit(f"local upstream path does not exist: {repo}")
        if repo == SKILL_ROOT or SKILL_ROOT in repo.parents:
            raise SystemExit("the upstream checkout must live outside this skill")
        if not git_ok(repo, "rev-parse", "--git-dir"):
            raise SystemExit(f"{repo} is not a git checkout; provenance needs a commit. "
                             "Clone ohos_qt-skills there or pass --repo <url>.")
        if args.fetch:
            git(repo, "fetch", "--quiet", "origin")
        warnings = []
        if args.ref:
            ref = args.ref
        elif branch:
            local_ok = git_ok(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}")
            remote_ok = git_ok(repo, "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{branch}")
            if args.fetch and remote_ok:
                ref = f"origin/{branch}"
            elif local_ok:
                ref = branch
                if remote_ok and git(repo, "rev-parse", branch) != git(repo, "rev-parse", f"origin/{branch}"):
                    warnings.append(f"local branch {branch} differs from origin/{branch}; "
                                    "pass --fetch to sync the remote branch instead")
            elif remote_ok:
                ref = f"origin/{branch}"
            else:
                raise SystemExit(f"branch {branch} not found in {repo} (try --fetch)")
        else:
            ref = "HEAD"
            branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
            if git(repo, "status", "--porcelain"):
                warnings.append("local checkout has uncommitted changes; only committed content of HEAD is synced")
        commit = git(repo, "rev-parse", f"{ref}^{{commit}}")
        url = git(repo, "remote", "get-url", "origin") if git_ok(repo, "remote", "get-url", "origin") else ""
        return repo, commit, {"kind": "local", "path": str(repo), "repo": url or lock.get("repo", ""),
                              "branch": branch or "", "ref": ref, "warnings": warnings}

    url = args.repo or lock.get("repo")
    if not url:
        raise SystemExit("no upstream given: pass --source <local checkout> or --repo <git url>")
    if not branch and not args.ref and url.rstrip("/") == (lock.get("repo") or "").rstrip("/"):
        # Same upstream as pinned: stay on the pinned branch (its default HEAD may be older).
        branch = lock.get("branch") or None
    cache = cache_dir_for(url, Path(args.cache_dir).expanduser() if args.cache_dir else DEFAULT_CACHE)
    if not (cache / "HEAD").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        print(f"cloning {url} -> {cache}")
        result = subprocess.run(["git", "clone", "--mirror", "--quiet", url, str(cache)])
        if result.returncode:
            raise SystemExit(f"cannot clone {url}; check network/credentials or pass --source <local checkout>")
    elif getattr(args, "offline", False):
        print(f"offline: using cached clone {cache} without fetching")
    else:
        print(f"fetching {url} (cache {cache})")
        result = subprocess.run(["git", "-C", str(cache), "remote", "update", "--prune"], capture_output=True)
        if result.returncode:
            raise SystemExit(f"cannot fetch {url}: {result.stderr.decode('utf-8', 'replace').strip()}\n"
                             "retry, pass --source <local checkout>, or --offline to plan from the cached clone")
    ref = args.ref or (f"refs/heads/{branch}" if branch else "HEAD")
    if not git_ok(cache, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"):
        raise SystemExit(f"ref {args.ref or branch} not found in {url}")
    if not branch and not args.ref:
        branch = git(cache, "symbolic-ref", "--short", "HEAD") if git_ok(cache, "symbolic-ref", "HEAD") else ""
    commit = git(cache, "rev-parse", f"{ref}^{{commit}}")
    return cache, commit, {"kind": "remote", "path": str(cache), "repo": url,
                           "branch": branch or "", "ref": args.ref or branch or "HEAD", "warnings": []}


# --------------------------------------------------------------------------- plan

def hint_for(rel: str, data: bytes) -> str:
    name = rel.rsplit("/", 1)[-1]
    hints = []
    if SECRET_RE.search(data):
        hints.append("POSSIBLE SECRET - never include; tell the user")
    if rel.startswith((".gitcode/", ".github/", ".gitlab/")) or (name.startswith(".") and "/" not in rel):
        hints.append("repo metadata -> likely exclude")
    if name.split(".")[0].upper() in {"CHANGELOG", "CONTRIBUTING", "LICENSE", "SECURITY", "TODO", "CODEOWNERS"}:
        hints.append("repo governance -> likely exclude")
    if "/_drafts/" in f"/{rel}" or name.startswith("_template"):
        hints.append("contribution draft/template -> likely exclude")
    if rel.startswith("tests/") or "/tests/" in rel:
        hints.append("test suite -> check whether it serves upstream maintenance only")
    if rel.startswith("tools/"):
        hints.append("upstream tool -> check whether it competes with this skill's workflow")
    if rel.startswith("skills/"):
        hints.append("upstream agent skill -> check whether it competes with this skill's workflow")
    if Path(name).suffix.lower() in BINARY_EXT:
        hints.append("binary -> toolchain/template binaries are external inputs, not baseline")
    if len(data) > 200_000:
        hints.append(f"large file ({len(data) // 1024} KiB) -> confirm it is knowledge")
    if ARCHIVED_RE.search(data[:2000]):
        hints.append("self-declared archived/superseded -> likely exclude")
    return "; ".join(hints) or "knowledge content -> likely include"


def precedent_for(rel: str, manifest: dict[str, dict[str, str]]) -> str:
    """How earlier syncs treated the nearest directory that already has rows."""
    parts = rel.split("/")[:-1]
    while parts:
        prefix = "/".join(parts) + "/"
        rows = [row for path, row in manifest.items() if path.startswith(prefix)]
        kept = sum(row.get("action") in ACTIVE_ACTIONS for row in rows)
        cut = sum(row.get("action") == "excluded-by-policy" for row in rows)
        if kept or cut:
            return f"precedent {prefix}: {kept} in baseline, {cut} excluded"
        parts.pop()
    return "precedent: new top-level area - decide deliberately"


def write_diff(rel: str, old: bytes, new: bytes) -> bool:
    if b"\0" in old[:8000] or b"\0" in new[:8000] or max(len(old), len(new)) > 1_000_000:
        return False
    lines = difflib.unified_diff(
        old.decode("utf-8", "replace").splitlines(keepends=True),
        new.decode("utf-8", "replace").splitlines(keepends=True),
        f"baseline/{rel}", f"upstream/{rel}")
    target = WORK_DIR / "diffs" / (rel + ".diff")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("".join(lines), encoding="utf-8")
    return True


def local_files() -> set[str]:
    found = set()
    if KNOWLEDGE_DIR.exists():
        for path in KNOWLEDGE_DIR.rglob("*"):
            rel = path.relative_to(KNOWLEDGE_DIR).as_posix()
            if path.is_file() and not is_ignored_local(rel):
                found.add(rel)
    return found


def cmd_plan(args) -> int:
    lock = read_lock()
    repo, commit, source = resolve_source(args, lock)
    tree = Tree(repo, commit)
    manifest = read_manifest()
    exclusions = read_exclusions()
    required = read_required()
    if WORK_DIR.exists():
        shutil.rmtree(WORK_DIR)
    (WORK_DIR / "incoming").mkdir(parents=True)

    entries, review = [], []
    for rel in sorted(tree.entries):
        mode, blob = tree.entries[rel]
        data = tree.read(rel)
        src_hash = sha256_bytes(data)
        old = manifest.get(rel)
        active = bool(old and old.get("action") in ACTIVE_ACTIONS)
        rule = excluded_by(rel, exclusions)
        entry = {"path": rel, "mode": mode, "blob": blob, "sha256": src_hash, "size": len(data)}
        if rule:
            entry["category"] = "newly-excluded" if active else "excluded"
            entry["rule"] = rule
        elif not active:
            entry["category"] = "new"
            if old and old.get("action") == "excluded-by-policy":
                entry["note"] = "previously excluded; its exclusion row was removed"
        else:
            dest = SKILL_ROOT / old["snapshot_path"]
            dest_hash = sha256_file(dest) if dest.is_file() else ""
            if dest_hash != old["snapshot_sha256"]:
                entry["category"] = "blocked-local-edit"
                entry["note"] = "baseline file missing" if not dest_hash else "baseline file edited without a recorded decision"
            elif src_hash == old["source_sha256"]:
                entry["category"] = "unchanged"
            elif old["snapshot_sha256"] != old["source_sha256"]:
                entry["category"] = "blocked-diverged"
                entry["note"] = "page intentionally diverged from upstream (kept-local) and upstream changed it"
            else:
                entry["category"] = "changed"
        if entry["category"] in DECISIONS:
            out = WORK_DIR / "incoming" / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            hint = entry.get("note", "")
            if entry["category"] == "new":
                hint = "; ".join(filter(None, [hint, hint_for(rel, data), precedent_for(rel, manifest)]))
            elif entry["category"] != "unchanged":
                dest = SKILL_ROOT / old["snapshot_path"]
                if dest.is_file() and write_diff(rel, dest.read_bytes(), data):
                    hint = "; ".join(filter(None, [hint, f"diff: .sync/diffs/{rel}.diff"]))
                if SECRET_RE.search(data):
                    hint = "; ".join(filter(None, [hint, "POSSIBLE SECRET - never include; tell the user"]))
            review.append({"path": rel, "change": entry["category"], "size": str(len(data)),
                           "hint": hint, "decision": DEFAULT_DECISION.get(entry["category"], ""), "reason": ""})
        entries.append(entry)
    tree.close()

    upstream_paths = set(tree.entries)
    for rel, old in sorted(manifest.items()):
        if rel not in upstream_paths and old.get("action") in ACTIVE_ACTIONS:
            entries.append({"path": rel, "category": "removed"})
    tracked = {rel for rel, row in manifest.items() if row.get("action") in ACTIVE_ACTIONS}
    untracked = sorted(local_files() - tracked)
    stale = sorted(key for key in exclusions
                   if (key.endswith("/") and not any(p.startswith(key) for p in upstream_paths))
                   or (not key.endswith("/") and key not in upstream_paths))

    # Required pages after the sync, assuming every new file is included.
    after = {e["path"] for e in entries if e["category"] in {"unchanged", "changed", "new",
                                                             "blocked-local-edit", "blocked-diverged"}}
    blockers = [f"required path would disappear: {p} (upstream removed or excluded it; "
                "update SKILL.md/references and required-paths.txt first)"
                for p in required_missing(required, after)]
    blockers += [f"untracked file under knowledge/ (not upstream bytes; move it out): {p}" for p in untracked]

    plan = {
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source, "commit": commit,
        "commit_date": git(repo, "show", "-s", "--format=%cI", commit),
        "previous_revision": lock.get("revision", ""),
        "manifest_sha256": sha256_file(MANIFEST) if MANIFEST.exists() else "",
        "exclusions_sha256": sha256_file(EXCLUSIONS) if EXCLUSIONS.exists() else "",
        "entries": entries, "stale_exclusions": stale, "blockers": blockers,
        "skipped_non_blob": tree.skipped,
    }
    (WORK_DIR / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    with (WORK_DIR / "review.tsv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=REVIEW_FIELDS, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        writer.writerows(review)

    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["category"]] = counts.get(entry["category"], 0) + 1
    print(f"upstream={source['repo'] or source['path']} branch={source['branch'] or '-'} ref={source['ref']}")
    print(f"commit={commit} ({plan['commit_date']}) previous={lock.get('revision', '-')}")
    for warning in source["warnings"]:
        print(f"WARNING {warning}")
    for item in tree.skipped:
        print(f"WARNING skipped non-file entry (submodule?): {item}")
    print(" ".join(f"{key}={counts.get(key, 0)}" for key in
                   ["unchanged", "changed", "new", "removed", "newly-excluded", "excluded",
                    "blocked-local-edit", "blocked-diverged"]))
    for category in ["new", "changed", "removed", "newly-excluded", "blocked-local-edit", "blocked-diverged"]:
        paths = [e["path"] for e in entries if e["category"] == category]
        if paths:
            print(f"\n[{category}] {len(paths)}")
            for rel in paths[:200]:
                print(f"  {rel}")
            if len(paths) > 200:
                print(f"  ... {len(paths) - 200} more (see .sync/plan.json)")
    if stale:
        print("\n[stale exclusions] no longer match any upstream path:")
        for key in stale:
            print(f"  {key}")
    if blockers:
        print("\nBLOCKERS")
        for item in blockers:
            print(f"  - {item}")
    pending = sum(1 for row in review if not row["decision"])
    print(f"\nreview sheet: {(WORK_DIR / 'review.tsv').relative_to(SKILL_ROOT)} "
          f"({len(review)} rows, {pending} need a decision)")
    print("incoming files: upstream-kb/.sync/incoming/   diffs: upstream-kb/.sync/diffs/")
    if not review and not blockers and counts.get("removed", 0) == 0 and counts.get("newly-excluded", 0) == 0 \
            and commit == lock.get("revision"):
        print("baseline already matches this commit; nothing to apply")
    return 2 if blockers else 0


# --------------------------------------------------------------------------- apply

def read_review() -> tuple[dict[str, dict], dict[str, dict]]:
    path = WORK_DIR / "review.tsv"
    if not path.exists():
        raise SystemExit("no review sheet; run `sync_upstream.py plan` first")
    exact, dirs = {}, {}
    with path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream, delimiter="\t"):
            rel = (row.get("path") or "").strip().replace("\\", "/")
            if not rel:
                continue
            item = {key: (row.get(key) or "").strip() for key in REVIEW_FIELDS}
            (dirs if rel.endswith("/") else exact)[rel] = item
    return exact, dirs


def decision_for(rel: str, exact: dict, dirs: dict) -> dict | None:
    row = exact.get(rel)
    if row and row["decision"]:
        return row
    matches = [key for key in dirs if rel.startswith(key) and dirs[key]["decision"]]
    return dirs[max(matches, key=len)] if matches else row


def remove_tracked(rel: str, old: dict, errors: list[str]) -> Path | None:
    path = SKILL_ROOT / old["snapshot_path"]
    if path.is_file() and sha256_file(path) != old["snapshot_sha256"]:
        errors.append(f"{rel}: baseline file was edited locally; refusing to delete it")
        return None
    return path


def cmd_apply(args) -> int:
    plan_path = WORK_DIR / "plan.json"
    if not plan_path.exists():
        raise SystemExit("no pending plan; run `sync_upstream.py plan` first")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if (sha256_file(MANIFEST) if MANIFEST.exists() else "") != plan["manifest_sha256"] or \
            (sha256_file(EXCLUSIONS) if EXCLUSIONS.exists() else "") != plan["exclusions_sha256"]:
        raise SystemExit("manifest.tsv or exclusions.tsv changed after the plan; re-run plan "
                         "(record exclusions through review.tsv, not by editing exclusions.tsv in between)")
    repo, commit = Path(plan["source"]["path"]), plan["commit"]
    if not git_ok(repo, "cat-file", "-e", f"{commit}^{{commit}}"):
        raise SystemExit(f"planned commit {commit} is no longer readable in {repo}; re-run plan")
    if plan["blockers"]:
        print("plan has blockers; resolve them and re-run plan:")
        for item in plan["blockers"]:
            print(f"  - {item}")
        return 2

    exact, dirs = read_review()
    manifest = read_manifest()
    errors: list[str] = []
    actions: list[tuple[str, dict, dict | None]] = []  # (category, entry, decision row)
    for entry in plan["entries"]:
        category = entry["category"]
        if category in DECISIONS:
            row = decision_for(entry["path"], exact, dirs)
            decision = (row or {}).get("decision") or DEFAULT_DECISION.get(category, "")
            if not decision:
                errors.append(f"{entry['path']}: {category} file has no decision "
                              f"({' / '.join(sorted(DECISIONS[category]))})")
                continue
            if decision not in DECISIONS[category]:
                errors.append(f"{entry['path']}: decision '{decision}' is not valid for {category} "
                              f"({' / '.join(sorted(DECISIONS[category]))})")
                continue
            if decision in NEEDS_REASON and not (row or {}).get("reason"):
                errors.append(f"{entry['path']}: decision '{decision}' needs a reason")
                continue
            if decision == "keep-local" and not (SKILL_ROOT / snapshot_path(entry["path"])).is_file():
                errors.append(f"{entry['path']}: keep-local needs the baseline file on disk")
                continue
            actions.append((category, entry, {"decision": decision, "reason": (row or {}).get("reason", "")}))
        else:
            actions.append((category, entry, None))
    known = {e["path"] for e in plan["entries"]}
    for rel in exact:
        if rel not in known:
            errors.append(f"review.tsv row does not match any planned path: {rel}")

    final_active = set()
    for category, entry, dec in actions:
        if category == "unchanged" or (dec and dec["decision"] in {"include", "update", "take-upstream", "keep-local"}):
            final_active.add(entry["path"])
    for item in required_missing(read_required(), final_active):
        errors.append(f"required path would disappear: {item}")

    # Pre-check deletions before touching anything.
    deletions: list[Path] = []
    for category, entry, dec in actions:
        old = manifest.get(entry["path"])
        if category in {"removed", "newly-excluded"} or (dec and dec["decision"] == "exclude" and category == "changed"):
            path = remove_tracked(entry["path"], old, errors)
            if path:
                deletions.append(path)
    if errors:
        print("apply refused; fix review.tsv (or re-run plan) and try again:")
        for item in errors:
            print(f"  - {item}")
        return 2

    tree = Tree(repo, commit)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    today = now[:10]
    exclusion_rows = read_exclusion_rows()
    log: dict[str, list[str]] = {}
    rows: dict[str, dict] = {rel: dict(row) for rel, row in manifest.items()}

    def write_page(rel: str) -> str:
        data = tree.read(rel)
        dest = KNOWLEDGE_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if tree.entries[rel][0] == "100755":
            try:
                os.chmod(dest, 0o755)
            except OSError:
                pass
        return sha256_bytes(data)

    def page_row(entry: dict, action: str, snap_hash: str) -> dict:
        old = manifest.get(entry["path"], {})
        return {"source_revision": commit, "source_path": entry["path"], "source_sha256": entry["sha256"],
                "snapshot_path": snapshot_path(entry["path"]), "snapshot_sha256": snap_hash,
                "used": old.get("used", "no"), "modified": "yes" if snap_hash != entry["sha256"] else "no",
                "action": action, "last_synced_at": now}

    def excluded_row(entry: dict) -> dict:
        old = manifest.get(entry["path"], {})
        return {"source_revision": commit, "source_path": entry["path"], "source_sha256": entry.get("sha256", ""),
                "snapshot_path": "", "snapshot_sha256": "", "used": old.get("used", "no"), "modified": "no",
                "action": "excluded-by-policy", "last_synced_at": now}

    def note(key: str, text: str) -> None:
        log.setdefault(key, []).append(text)

    for path in deletions:
        if path.exists():
            path.unlink()
    for category, entry, dec in actions:
        rel = entry["path"]
        decision = dec["decision"] if dec else ""
        reason = dec["reason"] if dec else ""
        if category == "unchanged":
            row = rows[rel]
            row.update(source_revision=commit, last_synced_at=now, action="unchanged")
        elif category == "excluded":
            rows[rel] = excluded_row(entry)
        elif category == "newly-excluded":
            rows[rel] = excluded_row(entry)
            note("excluded (matched existing exclusion)", f"`{rel}` <- `{entry['rule']}`")
        elif category == "removed":
            row = rows[rel]
            row.update(snapshot_path="", snapshot_sha256="", modified="no", action="source-removed",
                       last_synced_at=now)
            note("removed upstream", f"`{rel}`")
        elif decision == "exclude":
            rows[rel] = excluded_row(entry)
            if not excluded_by(rel, {r["path"]: r["reason"] for r in exclusion_rows}):
                exclusion_rows.append({"path": rel, "reason": reason, "decided_at": today})
            note("excluded by review", f"`{rel}`: {reason}")
        elif decision == "include":
            rows[rel] = page_row(entry, "copied", write_page(rel))
            note("added", f"`{rel}`" + (f": {reason}" if reason else ""))
        elif decision in {"update", "take-upstream"}:
            rows[rel] = page_row(entry, "updated", write_page(rel))
            note("updated" if category == "changed" else f"{category} -> took upstream", f"`{rel}`")
        elif decision == "keep-local":
            dest = SKILL_ROOT / snapshot_path(rel)
            rows[rel] = page_row(entry, "kept-local", sha256_file(dest))
            note("kept local version (diverges from upstream)", f"`{rel}`: {reason}")
    tree.close()

    # Collapse exclusion rows that a directory decision in review.tsv covers.
    for key, row in dirs.items():
        # Only when nothing under the directory stays in the baseline; a
        # directory rule also excludes files upstream adds there later.
        if row["decision"] == "exclude" and row["reason"] \
                and not any(path.startswith(key) for path in final_active):
            covered = [r for r in exclusion_rows if r["path"].startswith(key) and r["decided_at"] == today]
            if covered:
                exclusion_rows = [r for r in exclusion_rows if r not in covered]
                exclusion_rows.append({"path": key, "reason": row["reason"], "decided_at": today})
    if args.prune_stale_exclusions and plan["stale_exclusions"]:
        stale = set(plan["stale_exclusions"])
        exclusion_rows = [r for r in exclusion_rows if r["path"] not in stale]
        for key in sorted(stale):
            note("pruned stale exclusion", f"`{key}`")

    # Remove directories emptied by deletions.
    for directory in sorted((p for p in KNOWLEDGE_DIR.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()

    write_manifest(list(rows.values()))
    write_exclusions(exclusion_rows)
    source = plan["source"]
    lock = read_lock()
    lock.update({"repo": source.get("repo") or lock.get("repo", ""), "branch": source.get("branch") or lock.get("branch", ""),
                 "revision": commit, "synced_at": now})
    write_lock(lock)

    entry_lines = [f"\n## {today} — {commit[:12]}\n",
                   f"- upstream: {lock['repo']} @ {lock['branch'] or source['ref']} "
                   f"(commit {commit}, committed {plan['commit_date']})",
                   f"- previous revision: {plan['previous_revision'] or '-'}"]
    counts: dict[str, int] = {}
    for category, _, _ in actions:
        counts[category] = counts.get(category, 0) + 1
    entry_lines.append("- counts: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    for key, items in log.items():
        entry_lines.append(f"- {key} ({len(items)}):")
        entry_lines.extend(f"  - {item}" for item in items)
    if not SYNC_LOG.exists():
        SYNC_LOG.write_text("# Upstream knowledge sync log\n\nAppend-only; written by "
                            "`upstream-kb/scripts/sync_upstream.py apply`.\n", encoding="utf-8", newline="\n")
    with SYNC_LOG.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write("\n".join(entry_lines) + "\n")
    plan_path.rename(WORK_DIR / "applied-plan.json")

    print(f"applied commit={commit}")
    print("summary: " + ", ".join(f"{k}={len(v)}" for k, v in log.items()) if log else "summary: no content changes")
    from verify_kb import verify
    return verify(smoke=False)


def cmd_status(_args) -> int:
    lock = read_lock()
    print(f"pinned upstream: {lock.get('repo', '-')} branch={lock.get('branch', '-')} "
          f"revision={lock.get('revision', '-')} synced_at={lock.get('synced_at', '-')}")
    plan_path = WORK_DIR / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        print(f"pending plan for commit {plan['commit']} created {plan['created_at']}")
    else:
        print("no pending plan")
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan", help="compute the change set from one upstream commit")
    plan.add_argument("--source", help="local ohos_qt-skills git checkout")
    plan.add_argument("--repo", help="upstream git URL (default: upstream.json)")
    plan.add_argument("--branch", help="branch to sync (default: upstream.json, else remote HEAD)")
    plan.add_argument("--ref", help="explicit commit or tag (overrides --branch)")
    plan.add_argument("--offline", action="store_true", help="with --repo/default: use the cached clone without fetching")
    plan.add_argument("--fetch", action="store_true", help="with --source: git fetch origin first and use origin/<branch>")
    plan.add_argument("--cache-dir", help=f"clone cache for --repo (default {DEFAULT_CACHE})")
    plan.set_defaults(func=cmd_plan)
    apply = sub.add_parser("apply", help="execute the reviewed plan")
    apply.add_argument("--prune-stale-exclusions", action="store_true",
                       help="drop exclusion rows that no longer match any upstream path")
    apply.set_defaults(func=cmd_apply)
    status = sub.add_parser("status", help="show pinned upstream and pending plan")
    status.set_defaults(func=cmd_status)
    args = parser.parse_args()
    if args.command == "plan" and args.source and args.repo:
        print("note: both --source and --repo given; using the local checkout")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

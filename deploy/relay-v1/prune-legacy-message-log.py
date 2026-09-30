#!/usr/bin/env python3
"""Online pruner for the pre-1.0.2 relay realtime message log.

A 1.0.x Relay persisted an unbounded, never-pruned message log (the retired
`realtime/store.rs` tracked `log_bytes` but enforced no ceiling), so its
`relay.db` grew until the disk filled. 1.0.2 stores no session content and drops
those tables at startup; until a legacy version is retired, this tool keeps its
log bounded by hand. See README.md in this directory for the operational
procedure and for what a legacy database may lose without affecting users.

How it stays invisible to users:
  - WAL plus batched, committed deletes of primary-key ranges: each statement
    holds the single write lock for milliseconds, far below the Relay's
    `busy_timeout` of 5 seconds.
  - nothing newer than --safety-minutes is deleted;
  - every session always keeps its newest --min-keep messages;
  - older rows go only beyond --keep-hours or --max-msgs;
  - `realtime_sessions`, both sequence counters and every other table stay
    untouched, so existing client cursors and session ids remain valid.

Usage:
  prune-legacy-message-log.py                # dry run (the default)
  prune-legacy-message-log.py --apply        # delete
  prune-legacy-message-log.py --report       # current size and statistics
"""
import argparse
import fcntl
import os
import sqlite3
import sys
import time

DEFAULT_DB = "/srv/bitfun-relay-v1.0.1/data/relay.db"
LOCK_FILE = "/var/lock/bitfun-relay-1.0.1-prune.lock"


def human(n):
    n = float(n)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(n) < 1024 or unit == "TiB":
            return f"{int(n)} B" if unit == "B" else f"{n:.2f} {unit}"
        n /= 1024


def connect(db, readonly=False):
    if readonly:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10.0)
        con.execute("PRAGMA query_only=ON")
    else:
        con = sqlite3.connect(db, timeout=10.0, isolation_level=None)
        con.execute("PRAGMA busy_timeout=8000")
    return con


def boundary_seq(cur, account, sid, lo, hi, cutoff_ms):
    """Smallest seq in [lo,hi] whose created_at >= cutoff_ms (hi+1 if none).

    created_at is monotonic in seq because the log is append-only, so a binary
    search over the primary key needs ~log2(n) single-row probes instead of a
    full walk over the session.
    """
    probe = cur.connection.cursor()  # own cursor: never reset the caller's iteration
    lo, hi = lo, hi + 1
    while lo < hi:
        mid = (lo + hi) // 2
        row = probe.execute(
            "SELECT created_at FROM realtime_messages WHERE account_id=? AND session_id=? AND seq=?",
            (account, sid, mid),
        ).fetchone()
        if row is None:
            # Missing seq (already pruned): treat as older, keep searching right.
            lo = mid + 1
        elif row[0] >= cutoff_ms:
            hi = mid
        else:
            lo = mid + 1
    return lo


def plan(cur, now_ms, keep_hours, safety_minutes, max_msgs, min_keep):
    cutoff_ms = now_ms - int(keep_hours * 3600 * 1000)
    safety_ms = now_ms - int(safety_minutes * 60 * 1000)
    plan_rows = []
    sessions = cur.execute(
        "SELECT account_id, id, seq, updated_at FROM realtime_sessions WHERE seq>0"
    ).fetchall()
    for account, sid, seq, updated in sessions:
        if seq <= min_keep:
            continue  # everything sits inside the always-keep tail
        # Deletion ceiling: never cross the always-keep tail, the retention
        # window, or the safety line.
        keep_seq = min(
            seq - min_keep + 1,
            boundary_seq(cur, account, sid, 1, seq, cutoff_ms),
            boundary_seq(cur, account, sid, 1, seq, safety_ms),
        )
        # Size ceiling: the newest max_msgs always survive, even inside the window.
        keep_seq = max(keep_seq, seq - max_msgs + 1, 1)
        if keep_seq > 1:
            plan_rows.append((account, sid, keep_seq, keep_seq - 1))
    return plan_rows


def report(args):
    con = connect(args.db, readonly=True)
    cur = con.cursor()
    print(f"file        {human(os.path.getsize(args.db))}")
    print(f"messages    {cur.execute('SELECT count(*) FROM realtime_messages').fetchone()[0]:,} rows")
    print(f"sessions    {cur.execute('SELECT count(*) FROM realtime_sessions').fetchone()[0]:,}")
    freelist = cur.execute("PRAGMA freelist_count").fetchone()[0]
    print(f"freelist    {freelist:,} pages ({human(freelist * 4096)})")
    print(f"auto_vacuum {cur.execute('PRAGMA auto_vacuum').fetchone()[0]} (0=none, 2=incremental)")
    con.close()


def run(args):
    con = connect(args.db, readonly=not args.apply)
    cur = con.cursor()
    now_ms = int(time.time() * 1000)
    started = time.time()
    plan_rows = plan(cur, now_ms, args.keep_hours, args.safety_minutes, args.max_msgs, args.min_keep)
    total = sum(p[3] for p in plan_rows)
    print(f"plan: {total:,} rows in {len(plan_rows):,} sessions "
          f"(keep_hours={args.keep_hours}, safety={args.safety_minutes}min, "
          f"max_msgs={args.max_msgs}, min_keep={args.min_keep}) "
          f"[{time.time()-started:.0f}s]")
    if not args.apply:
        print("\nlargest deletions:")
        for account, sid, keep_seq, count in sorted(plan_rows, key=lambda p: -p[3])[:8]:
            print(f"  {account:>12} {sid[:16]:>16}  delete {count:>7,} rows (keep seq >= {keep_seq})")
        pages = cur.execute("PRAGMA page_count").fetchone()[0]
        print(f"\nDRY RUN: nothing changed. file={human(os.path.getsize(args.db))} pages={pages:,}")
        con.close()
        return 0
    deleted = 0
    for account, sid, keep_seq, _count in plan_rows:
        # A session whose lowest surviving seq already sits at the ceiling has
        # nothing left in the delete range: skip it instead of issuing empty
        # range deletes that would still take the write lock.
        lowest = cur.execute(
            "SELECT min(seq) FROM realtime_messages WHERE account_id=? AND session_id=?",
            (account, sid),
        ).fetchone()[0]
        if lowest is None or lowest >= keep_seq:
            continue
        before = con.total_changes
        start = lowest
        while start < keep_seq:
            end = min(start + args.batch_rows - 1, keep_seq - 1)
            cur.execute(
                "DELETE FROM realtime_messages WHERE account_id=? AND session_id=? "
                "AND seq>=? AND seq<=?",
                (account, sid, start, end),
            )
            start = end + 1
            if args.sleep_ms:
                time.sleep(args.sleep_ms / 1000.0)
        # Report rows that were really removed, never the planned range length.
        real = con.total_changes - before
        deleted += real
        if real:
            print(f"  {account}/{sid[:12]}: -{real:,} rows (keep seq >= {keep_seq}) "
                  f"[{time.time()-started:.0f}s]")
            sys.stdout.flush()
    cur.execute("PRAGMA wal_checkpoint(PASSIVE)")
    auto = cur.execute("PRAGMA auto_vacuum").fetchone()[0]
    if auto == 2 and args.incremental_vacuum_pages:
        # Only an incremental-auto-vacuum database returns freed pages online;
        # without it the file keeps its size and reuses free pages instead.
        cur.execute(f"PRAGMA incremental_vacuum({args.incremental_vacuum_pages})")
    con.close()
    print(f"deleted {deleted:,} rows (real) in {time.time()-started:.0f}s")
    print(f"file now {human(os.path.getsize(args.db))}, "
          f"wal {human(os.path.getsize(args.db + '-wal'))}, auto_vacuum={auto}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=DEFAULT_DB, help="legacy relay.db to prune")
    ap.add_argument("--keep-hours", type=float, default=24.0,
                    help="delete only messages older than this window")
    ap.add_argument("--safety-minutes", type=float, default=60.0,
                    help="never delete anything newer than this")
    ap.add_argument("--max-msgs", type=int, default=5000,
                    help="newest messages retained per session")
    ap.add_argument("--min-keep", type=int, default=200,
                    help="newest messages kept per session regardless of age")
    ap.add_argument("--batch-rows", type=int, default=2000,
                    help="rows per committed delete statement")
    ap.add_argument("--sleep-ms", type=int, default=20,
                    help="pause between statements so the relay keeps the write lock")
    ap.add_argument("--incremental-vacuum-pages", type=int, default=2000,
                    help="pages returned to the filesystem per run when auto_vacuum=2")
    ap.add_argument("--dry-run", action="store_true", help="analyse only (the default)")
    ap.add_argument("--apply", action="store_true", help="really delete")
    ap.add_argument("--report", action="store_true", help="print current size and statistics")
    args = ap.parse_args()
    if args.report:
        return report(args)
    if args.apply:
        lock = open(LOCK_FILE, "w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another prune is already running; exiting")
            return 0
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

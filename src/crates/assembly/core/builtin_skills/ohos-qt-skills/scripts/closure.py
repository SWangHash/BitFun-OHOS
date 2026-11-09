#!/usr/bin/env python3
"""Produce the mandatory portgraph dependency closure in one bounded command.

Runs the closure sequence the inventory gate depends on, with the migration's
environment profile (UTF-8 console output, short download directory) and
stores every output under ``<root>/closure/``::

    stats (ingest all only when the graph is empty or --refresh) -> scan <app>
    -> analyze <app-id> -> deps <app> -> fetch-deps --dry-run -> fetch-deps (real run)

    python scripts/closure.py --migration-root <container>/migration/ohos [--app <app root>] [--refresh]

It resolves the app id from ``scan`` (no guessing between paths and ids),
re-ingests once when the dry run shows the "never ingested" pattern (every row
need_port while analyze reports no blockers), downloads into
``<short_cache_dir>/ohos-libs`` (the environment table's host path; avoids the Windows MAX_PATH
failure of the deep skill workspace, KI-005), and prints the three dispatch
trigger counts with their sources (references/third-party-parallel-dispatch.md)::

    judgment = analyze.blockers(N) + analyze.unknowns(M)        (>=3 forced parallel)
    fetch    = fetch.cmd_only(N) + fetch.failed(M)              (>=2 forced parallel)
    cross    = fetch.need_port(N) + fetch.failed(M)             (>=1 forced dispatch)

The outputs are gate evidence to cite in inventory.tsv rows; the summary is
``closure/summary.json``. ``closure/interface-hits.json`` lists every
platform-interface hit (Win32, ...) that compiles on OHOS with file:line and
whether it sits on a comment/string line, so nobody has to hunt for the
locations behind portgraph's counts. A failed real fetch exits 1 but the
summary is still written, so every failed row gets its own disposition.

Run it before any per-dependency judgment, fetch or cross-compile; the real
fetch run is part of the inventory gate (a dry run never reports ``failed``).
The portgraph workspace is local scratch; downloaded bottles are external
binaries, recorded with path and hash like other toolchain inputs.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import ohos_env

PORTGRAPH = Path(__file__).resolve().parent.parent / "upstream-kb" / "knowledge" / "portgraph" / "portgraph.py"
MIN_GRAPH_NODES = 200


def parse_json(text: str):
    """The last top-level JSON object in ``text`` (tools may print progress lines around it)."""
    decoder = json.JSONDecoder()
    found, index = None, 0
    while True:
        start = text.find("{", index)
        if start < 0:
            return found
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            index = start + 1
            continue
        if isinstance(value, dict):
            found = value
        index = end


class Runner:
    def __init__(self, root: Path, portgraph: Path, env: dict[str, str], timeout: float):
        self.out = root / "closure"
        self.out.mkdir(parents=True, exist_ok=True)
        self.portgraph, self.env, self.timeout = portgraph, env, timeout

    def __call__(self, name: str, *args: str, timeout: float | None = None):
        command = [ohos_env.python(), str(self.portgraph), "--compact", *args]
        result = ohos_env.run_watched(command, cwd=self.portgraph.parent, env=self.env,
                                      stdout_path=self.out / f"{name}.out.log", stderr_path=self.out / f"{name}.err.log",
                                      timeout=timeout or self.timeout, idle_timeout=None)
        data = parse_json(result.stdout())
        if data is not None:
            (self.out / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[closure] {name}: {result.status} ({result.duration_sec}s)")
        return result, data


def interface_hits(app: Path, portgraph: Path, limit: int = 200) -> dict:
    """Every platform-interface hit that compiles on OHOS, with its location.

    ``portgraph scan`` classifies every hit (unconditional / ohos-active /
    platform-excluded) but keeps only five sample locations per interface, so
    its "4 unconditional" count names no file. This pass reuses portgraph's own
    rules and guard classifier (read-only import, nothing in the baseline is
    changed) and lists every hit that compiles on OHOS. A hit on a commented
    line or inside a string literal is flagged ``likely_false_positive``.
    """
    import importlib

    sys.path.insert(0, str(portgraph.parent))
    try:
        qt_scanner = importlib.import_module("port_graph.qt_scanner")
        scanner = importlib.import_module("port_graph.project_scanner")
    finally:
        sys.path.pop(0)
    info = qt_scanner.scan_project(app)
    counts: dict[str, int] = {}
    hits: list[dict] = []
    for source in info.get("sources", []):
        if source.get("ext") not in qt_scanner.TEXT_SCAN_EXTS:
            continue
        try:
            text = (app / source["path"]).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        matches = [(rule, match) for rule in scanner.PLATFORM_API_RULES
                   if any(anchor in text for anchor in rule.get("pre", ()))
                   for match in rule["re"].finditer(text)]
        if not matches:
            continue
        file_excluded = scanner._file_platform_excluded(source["path"])
        guards = scanner._macro_stack_status(text)
        lines = text.splitlines()
        seen: set[tuple[str, int]] = set()
        for rule, match in matches:
            line_no = text.count("\n", 0, match.start()) + 1
            if (rule["iface"], line_no) in seen:
                continue
            seen.add((rule["iface"], line_no))
            guard = "platform-file-excluded" if file_excluded else guards.get(line_no, "ohos-active")
            counts[guard] = counts.get(guard, 0) + 1
            if guard not in {"unconditional", "ohos-active"}:
                continue
            line = lines[line_no - 1] if line_no - 1 < len(lines) else ""
            column = match.start() - (text.rfind("\n", 0, match.start()) + 1)
            before = line[:column]
            in_comment = line.lstrip().startswith(("//", "/*", "*")) or "//" in before
            in_string = before.count('"') % 2 == 1
            hits.append({"iface": rule["iface"], "file": source["path"], "line": line_no, "guard": guard,
                         "likely_false_positive": "comment" if in_comment else "string" if in_string else "",
                         "snippet": line.strip()[:120]})
    hits.sort(key=lambda hit: (bool(hit["likely_false_positive"]), hit["file"], hit["line"]))
    real = [hit for hit in hits if not hit["likely_false_positive"]]
    return {"counts": counts, "compiled_on_ohos": len(hits), "likely_real": len(real),
            "likely_false_positive": len(hits) - len(real), "truncated": len(hits) > limit, "hits": hits[:limit]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--migration-root", type=Path, required=True)
    parser.add_argument("--app", type=Path, help="Qt application root (default: Qt source root of the STATE.md Scope)")
    parser.add_argument("--libs-dir", type=Path, help="download directory (default <short_cache_dir>/ohos-libs)")
    parser.add_argument("--refresh", action="store_true", help="re-run ingest all even if the graph exists")
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=3600)
    parser.add_argument("--portgraph", type=Path, default=PORTGRAPH)
    args = parser.parse_args(argv)
    ohos_env.utf8_console()

    root = args.migration_root.resolve()
    app = ohos_env.require_source_root(root, args.app)
    profile = ohos_env.load_profile(root)
    env = ohos_env.apply_profile(profile)
    env["PYTHONIOENCODING"] = "utf-8"
    libs = args.libs_dir or Path(ohos_env.profile_value(profile, "short_cache_dir", default=str(ohos_env.machine_cache_dir()))) / "ohos-libs"
    run = Runner(root, args.portgraph, env, args.timeout)

    _, stats = run("stats", "stats")
    nodes = (stats or {}).get("nodes", 0) if isinstance(stats, dict) else 0
    ingested = False
    if args.refresh or nodes < MIN_GRAPH_NODES:
        result, _ = run("ingest", "ingest", "all")
        ingested = True
        if result.status != "passed":
            print("ERROR: portgraph ingest all failed; see closure/ingest.err.log")
            return 1
    result, scan = run("scan", "scan", str(app))
    if result.status != "passed" or not isinstance(scan, dict) or not scan.get("app_id"):
        print(f"ERROR: portgraph scan of {app} failed; see closure/scan.err.log")
        return 1
    app_id = scan["app_id"]
    # Full locations of the platform-interface hits portgraph only counts.
    try:
        iface = interface_hits(app, args.portgraph)
    except Exception as error:  # the closure must not fail on this report
        iface = {"error": f"{type(error).__name__}: {error}"[:300], "hits": []}
    (run.out / "interface-hits.json").write_text(json.dumps(iface, ensure_ascii=False, indent=2), encoding="utf-8")
    _, analyze = run("analyze", "analyze", app_id)
    if not isinstance(analyze, dict):
        print("ERROR: portgraph analyze produced no JSON; see closure/analyze.err.log (counts would be wrong)")
        return 1
    run("deps", "deps", str(app), "--json")
    _, dry = run("fetch-dry", "fetch-deps", app_id, "--dry-run", "--json")
    blockers = len((analyze or {}).get("blockers", []))
    unknowns = len((analyze or {}).get("unknowns", []))
    dry_summary = (dry or {}).get("summary", {}) if isinstance(dry, dict) else {}
    closure_size = (dry or {}).get("closure_size", 0) if isinstance(dry, dict) else 0
    never_ingested = closure_size and dry_summary.get("need_port", 0) == closure_size and blockers == 0
    if never_ingested and not ingested:
        print("[closure] dry run shows every row need_port with no blockers: graph not ingested; running ingest all once")
        run("ingest", "ingest", "all")
        _, analyze = run("analyze", "analyze", app_id)
        _, dry = run("fetch-dry", "fetch-deps", app_id, "--dry-run", "--json")
        blockers = len((analyze or {}).get("blockers", []))
        unknowns = len((analyze or {}).get("unknowns", []))
    fetch_result, fetch = run("fetch", "fetch-deps", app_id, "--json", "--jobs", str(args.jobs), "--out", str(libs))
    if not isinstance(fetch, dict):
        print("ERROR: the real fetch-deps run produced no JSON manifest; see closure/fetch.err.log")
        return 1
    real = fetch.get("summary", {})
    failed_rows = [dep for dep in (fetch or {}).get("deps", []) if dep.get("status") == "failed"] if isinstance(fetch, dict) else []
    need_port = [dep.get("name") for dep in (fetch or {}).get("deps", []) if dep.get("status") == "need_port"] if isinstance(fetch, dict) else []
    counts = {
        "judgment": {"value": blockers + unknowns, "source": f"analyze.blockers({blockers}) + analyze.unknowns({unknowns})", "threshold": 3},
        "fetch": {"value": real.get("cmd_only", 0) + real.get("failed", 0),
                  "source": f"fetch.cmd_only({real.get('cmd_only', 0)}) + fetch.failed({real.get('failed', 0)})", "threshold": 2},
        "cross_compile": {"value": real.get("need_port", 0) + real.get("failed", 0),
                          "source": f"fetch.need_port({real.get('need_port', 0)}) + fetch.failed({real.get('failed', 0)})", "threshold": 1},
    }
    summary = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "app": str(app), "app_id": app_id, "libs_dir": str(libs),
        "verdict": (analyze or {}).get("verdict"),
        "blockers": [f"[{b.get('kind')}] {b.get('node')}: {b.get('reason')}" for b in (analyze or {}).get("blockers", [])],
        "unknowns": [f"[{u.get('kind')}] {u.get('node')}: {u.get('reason')}" for u in (analyze or {}).get("unknowns", [])],
        "dry_run": dry_summary, "real_run": real,
        "failed": [{"name": dep.get("name"), "error": str(dep.get("error"))[:300]} for dep in failed_rows],
        "need_port": need_port,
        "triggers": counts,
        "fetch_exit": fetch_result.status,
        "interface_hits": {**{key: iface.get(key) for key in
                              ("counts", "compiled_on_ohos", "likely_real", "likely_false_positive", "truncated", "error")
                              if key in iface}, "file": "closure/interface-hits.json"},
    }
    (root / "closure" / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("app_id", "verdict", "dry_run", "real_run", "triggers")}, ensure_ascii=False, indent=2))
    for name, item in counts.items():
        flag = "DISPATCH" if item["value"] >= item["threshold"] else "single"
        print(f"{name} = {item['source']} = {item['value']} -> {flag} (threshold {item['threshold']})")
    for dep in failed_rows:
        print(f"failed: {dep.get('name')}: {str(dep.get('error'))[:200]}")
    if iface.get("error"):
        print(f"interface hits: not listed ({iface['error']})")
    else:
        print(f"interface hits compiled on OHOS: {iface.get('compiled_on_ohos', 0)} "
              f"({iface.get('likely_real', 0)} likely real, {iface.get('likely_false_positive', 0)} on comment/string lines); "
              f"all: closure/interface-hits.json")
        for hit in iface["hits"][:40]:
            mark = f" [likely false positive: {hit['likely_false_positive']}]" if hit["likely_false_positive"] else ""
            print(f"  {hit['guard']:13s} {hit['file']}:{hit['line']} {hit['iface']}{mark} | {hit['snippet'][:80]}")
    print(f"evidence: {root / 'closure' / 'summary.json'}; record blockers/unknowns, need_port and failed rows as INV rows (found_by 'closure: <finding>')")
    if need_port or failed_rows:
        print("host tools: cross-compiling the need_port/failed libraries needs their build tools on this machine "
              "(perl, pkg-config, autoconf, meson, ...: see each library's build system); add them to the environment "
              "with env_probe.py --migration-root <root> --tools <name>[,<name>...] (rows tool:<name>)")
    return 1 if failed_rows or fetch_result.status != "passed" else 0


if __name__ == "__main__":
    sys.exit(main())

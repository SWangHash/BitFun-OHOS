#!/usr/bin/env python3
"""portgraph.py - Qt 应用鸿蒙化可移植性图谱统一 CLI。

    python tools/portgraph.py ingest harmonybrew   # 解析 Harmonybrew formula 入库
    python tools/portgraph.py ingest cmdpkgs       # clone + 解析 cmd-pkgs README
    python tools/portgraph.py ingest kb            # Qt 模块 + 接口白名单种子
    python tools/portgraph.py clone <git-url>      # shallow clone + 扫描入库
    python tools/portgraph.py scan <project-path>  # 扫描 Qt 工程生成 app 节点
    python tools/portgraph.py analyze <app-id|name># 可移植性判定 + 阻塞点
    python tools/portgraph.py deps <path|app>      # 综合依赖分析（分类+版本范围）
    python tools/portgraph.py fetch "zlib,openssl@3"  # 下载指定包的鸿蒙 bottle
    python tools/portgraph.py fetch-deps corpus_a    # 一键下载应用全部依赖产物
    python tools/portgraph.py stats                # 数据统计
    python tools/portgraph.py serve [--port 8000]  # FastAPI + 前端页面
    python tools/portgraph.py export [out.json]    # 导出焦点图数据
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from port_graph import (cloner, cmdpkgs, db, engine, harmonybrew,  # noqa: E402
                        kb_seed, project_scanner)


def _emit(payload, args) -> None:
    print(json.dumps(payload, ensure_ascii=False,
                     indent=None if getattr(args, "compact", False) else 1))


def _resolve_app(conn, name: str) -> str:
    if db.get_node(conn, name):
        return name
    node = db.find_node_by_name(conn, name)
    if node and node["kind"] == "app":
        return node["id"]
    row = conn.execute(
        "SELECT id FROM nodes WHERE kind='app' AND id LIKE ?",
        ("app:%" + name.lower() + "%",)).fetchone()
    if row:
        return row["id"]
    print("[portgraph] 应用不存在: %s（先 scan/clone 入库；若想传项目路径，"
          "请检查路径是否存在）" % name)
    sys.exit(1)


def cmd_ingest(args) -> None:
    conn = db.connect()
    db.init_db(conn)
    try:
        if args.source == "harmonybrew":
            _emit(harmonybrew.ingest(conn, pull=not args.offline), args)
        elif args.source == "cmdpkgs":
            _emit(cmdpkgs.ingest(conn, pull=not args.offline), args)
        elif args.source == "kb":
            _emit(kb_seed.ingest(conn), args)
        elif args.source == "all":
            out = {"kb": kb_seed.ingest(conn),
                   "harmonybrew": harmonybrew.ingest(
                       conn, pull=not args.offline),
                   "cmdpkgs": cmdpkgs.ingest(conn, pull=not args.offline)}
            _emit(out, args)
        else:
            print("未知数据源: %s" % args.source)
            sys.exit(1)
    finally:
        conn.close()


def cmd_clone(args) -> None:
    """shallow clone 一个 git 仓库到 workspace/ 并扫描入库。"""
    try:
        info = cloner.clone_repo(args.url, getattr(args, "name", None))
    except RuntimeError as exc:
        print("[portgraph] clone 失败: %s" % exc)
        sys.exit(1)
    conn = db.connect()
    db.init_db(conn)
    try:
        scan = project_scanner.scan_project(conn, info["path"])
        _emit({"clone": info, "scan": scan}, args)
    finally:
        conn.close()


def cmd_scan(args) -> None:
    conn = db.connect()
    db.init_db(conn)
    try:
        _emit(project_scanner.scan_project(conn, args.project), args)
    finally:
        conn.close()


def _print_links(art: Dict, indent: str = "      ") -> None:
    """打印节点的鸿蒙产物与源码链接（有则输出）。"""
    if not art:
        return
    if art.get("artifact_url"):
        print("%s鸿蒙产物: %s" % (indent, art["artifact_url"]))
    elif art.get("artifact_cmd"):
        print("%s鸿蒙产物: %s" % (indent, art["artifact_cmd"]))
    elif art.get("artifact_local"):
        print("%s鸿蒙产物(本地): %s" % (indent, art["artifact_local"]))
    elif art.get("provided"):
        print("%s鸿蒙产物: 由 Qt/鸿蒙框架提供，无需单独下载或移植" % indent)
    else:
        print("%s鸿蒙产物: 无 → 需自行交叉编译，可移植性由依赖递归判定"
              % indent)
    src = art.get("source_url")
    repo = art.get("repo_url")
    home = art.get("homepage")
    if src:
        print("%s源码下载: %s" % (indent, src))
    if repo:
        print("%s源码仓库: %s" % (indent, repo))
    if home:
        print("%s项目主页: %s" % (indent, home))


def _print_dep_artifacts(conn, app_id: str) -> None:
    """打印应用所有依赖的鸿蒙产物/源码链接清单。

    有产物   = 可直接下载使用，无需移植
    框架提供 = Qt 模块等由 Qt/鸿蒙框架本身提供
    需移植   = 无产物，需自行交叉编译，可移植性由递归判定给出
    """
    rows = conn.execute(
        "SELECT dst, type FROM edges WHERE src=? ORDER BY type, dst",
        (app_id,)).fetchall()
    if not rows:
        return
    groups = {"ready": [], "provided": [], "need_port": []}
    for r in rows:
        nd = db.get_node(conn, r["dst"])
        if nd is None:
            continue
        art = engine.artifact_info(nd)
        key = ("ready" if art["ready"]
               else "provided" if art["provided"] else "need_port")
        groups[key].append((nd, art, r["type"]))
    print("依赖产物清单: %d 个依赖（%d 个有鸿蒙产物 / %d 个框架提供 / "
          "%d 个需移植）" % (
              len(rows), len(groups["ready"]), len(groups["provided"]),
              len(groups["need_port"])))
    for key, label in (("ready", "有产物"), ("provided", "框架提供"),
                       ("need_port", "需移植")):
        for nd, art, etype in groups[key]:
            print("  [%s] %s v%s (%s) %s"
                  % (label, nd["name"], nd["version"] or "?", etype,
                     nd["port_status"]))
            _print_links(art)


def cmd_analyze(args) -> None:
    conn = db.connect()
    db.init_db(conn)
    try:
        app_id = _resolve_app(conn, args.app)
        result = engine.analyze(conn, app_id)
        if getattr(args, "summary", False):
            print("verdict: %s" % result["verdict"])
            print("blockers: %d" % len(result["blockers"]))
            for b in result["blockers"]:
                print("  [%s] %s: %s" % (b["kind"], b["node"], b["reason"]))
                _print_links(b.get("artifact"))
            print("unknowns: %d" % len(result["unknowns"]))
            for u in result["unknowns"]:
                print("  [%s] %s: %s" % (u["kind"], u["node"], u["reason"]))
                _print_links(u.get("artifact"))
            pe = result.get("platform_excluded", [])
            print("platform_excluded: %d" % len(pe))
            for p in pe:
                alts = ", ".join(a["name"] for a in p.get("alternatives", []))
                print("  [iface] %s (%s): %s"
                      " → 鸿蒙可替代: %s" % (
                          p["iface"], p.get("category"), p["reason"],
                          alts or "（无同类别替代接口，需自行实现）"))
            _print_dep_artifacts(conn, app_id)
        else:
            _emit(result, args)
    finally:
        conn.close()


def cmd_stats(args) -> None:
    conn = db.connect()
    db.init_db(conn)
    try:
        _emit(db.stats(conn), args)
    finally:
        conn.close()


def cmd_export(args) -> None:
    conn = db.connect()
    db.init_db(conn)
    try:
        nodes = db.all_nodes(conn)
        edges = db.all_edges(conn)
        data = {"nodes": nodes, "edges": edges,
                "clusters": db.all_clusters(conn),
                "interfaces": db.all_interfaces(conn)}
        out = Path(args.out) if args.out else Path("workspace/portgraph.json")
        out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print("exported %d nodes / %d edges -> %s" % (
            len(nodes), len(edges), out))
    finally:
        conn.close()


def cmd_fetch(args) -> None:
    """在任意平台下载 Harmonybrew bottle 作为交叉编译依赖。"""
    from port_graph import OHOS_LIBS
    conn = db.connect()
    db.init_db(conn)
    try:
        out = Path(getattr(args, "out", None) or OHOS_LIBS)
        pkgs = [p.strip() for p in args.package.split(",") if p.strip()]
        results = []
        for name in pkgs:
            try:
                r = harmonybrew.fetch_bottle(conn, name, out,
                                             force=getattr(args, "force", False))
            except RuntimeError as exc:
                print("[portgraph] %s" % exc)
                if len(pkgs) == 1:
                    sys.exit(1)
                continue
            results.append(r)
            if r.get("skipped"):
                print("[fetch] %s v%s 已存在: %s"
                      % (r["package"], r["version"], r["installed"]))
            else:
                print("[fetch] %s v%s -> %s" % (
                    r["package"], r["version"], r["installed"]))
                print("  bottle : %s" % r["bottle_url"])
                print("  sha256 : %s" % r["sha256"])
                if r.get("symlinks_fixed"):
                    print("  补链接: %d 个 .so 符号链接（NTFS 用拷贝落地）"
                          % len(r["symlinks_fixed"]))
                if r.get("libs"):
                    print("  库     : %s" % ", ".join(r["libs"]))
                print("  CMake  : %s" % r["hints"]["cmake"].replace(
                    "\n", "\n           "))
                print("  qmake  : %s" % r["hints"]["qmake"])
                print("  部署   : %s" % r["hints"]["deploy"])
        if not results:
            sys.exit(1)
    finally:
        conn.close()


def cmd_fetch_deps(args) -> None:
    """一键下载应用全部依赖的鸿蒙产物（agent 工具，docs/fetch-deps.md）。"""
    from port_graph import OHOS_LIBS, deps_fetch
    conn = db.connect()
    db.init_db(conn)
    try:
        app_id = _resolve_app(conn, args.app)
        out = Path(getattr(args, "out", None) or OHOS_LIBS)
        total = len(deps_fetch.dependency_closure(conn, app_id))
        done = {"n": 0}
        order = ["downloaded", "already_local", "failed", "covered",
                 "provided", "cmd_only", "need_port", "test",
                 "would_download", "target"]

        def on_entry(e):
            done["n"] += 1
            st = e["status"]
            if st in ("downloaded", "already_local", "would_download"):
                print("[%d/%d] %s v%s %s -> %s"
                      % (done["n"], total, e["name"], e["version"] or "?",
                         "需下载" if st == "would_download" else "就绪",
                         e.get("installed") or e.get("artifact_url")))
            elif st == "failed":
                print("[%d/%d] %s 失败: %s (%s)"
                      % (done["n"], total, e["name"], e.get("error"),
                         e.get("artifact_url")))
            elif st == "covered":
                print("[%d/%d] %s 同名产物已获取: %s"
                      % (done["n"], total, e["name"], e["installed"]))
            elif st == "cmd_only":
                print("[%d/%d] %s 命令获取: %s"
                      % (done["n"], total, e["name"], e["artifact_cmd"]))
            elif st == "test":
                print("[%d/%d] %s 测试专用依赖（不进发行包，跳过）"
                      % (done["n"], total, e["name"]))
            elif st == "need_port":
                src = (e.get("repo_url") or e.get("source_url")
                       or e.get("homepage"))
                if src:
                    print("[%d/%d] %s 需自行移植（源码: %s）"
                          % (done["n"], total, e["name"], src))
                elif e.get("note"):
                    print("[%d/%d] %s %s"
                          % (done["n"], total, e["name"], e["note"]))
                else:
                    print("[%d/%d] %s 需自行移植（未入库，无源码链接："
                          "请确认依赖名是否正确，或手动检索源码）"
                          % (done["n"], total, e["name"]))

        m = deps_fetch.fetch_app_deps(
            conn, app_id, out, force=getattr(args, "force", False),
            dry_run=getattr(args, "dry_run", False),
            jobs=getattr(args, "jobs", 8),
            # --json 时 stdout 只输出 manifest（进度打印会污染机器解析）
            progress=None if getattr(args, "json", False) else on_entry)

        if getattr(args, "json", False):
            _emit(m, args)
            return
        s = m["summary"]
        print("\n[%s] 依赖闭包 %d 项: %s" % (
            m["app"]["name"], m["closure_size"],
            " / ".join("%s %d" % (k, s.get(k, 0)) for k in order
                       if s.get(k))))
        if m["toolchain"]["cmake_prefix_path"]:
            print("\nCMake 交叉编译集成:")
            print("  " + m["toolchain"]["cmake"].replace("\n", "\n  "))
        if m.get("manifest_path"):
            print("\nmanifest: %s" % m["manifest_path"])
        if s.get("failed"):
            sys.exit(1)
    finally:
        conn.close()


def cmd_deps(args) -> None:
    """综合依赖分析：link/build-tool/runtime/test/vendored 分类 + 版本范围。

    见 docs/deps-report.md。target 为项目路径或已扫描应用名。
    """
    from port_graph import deps_report, qt_scanner
    conn = db.connect()
    db.init_db(conn)
    try:
        target = args.target
        p = Path(target)
        if p.is_dir():
            root = p
        elif p.exists() or "/" in target or "\\" in target \
                or target.startswith("."):
            # 用户传的是路径形态（含分隔符/存在但非目录），按路径报错
            # 而非误导性的 "app not found"
            print("[portgraph] 项目路径不存在或不是目录: %s"
                  "（若想按已扫描应用分析，请传应用名如 corpus_a）" % target)
            sys.exit(1)
        else:
            app_id = _resolve_app(conn, target)
            root_path = db.get_meta(conn, "root_%s" % app_id)
            if not root_path or not Path(root_path).is_dir():
                print("[portgraph] 未找到 %s 的项目路径：先用 scan/clone 入库，"
                      "或直接传项目路径" % target)
                sys.exit(1)
            root = Path(root_path)
        info = qt_scanner.scan_project(root)
        # 顺手入库（幂等）：让 analyze/fetch-deps 随后可用同一目标
        project_scanner.scan_project(conn, root, info=info)
        report = deps_report.analyze_dependencies(conn, root, info=info)
        if getattr(args, "json", False):
            _emit(report, args)
        else:
            print(deps_report.render_text(report))
    finally:
        conn.close()


def cmd_serve(args) -> None:
    try:
        import uvicorn
        from port_graph.api import create_app
    except ImportError as exc:
        print("[portgraph] 缺少依赖: %s\n请先运行: pip install fastapi uvicorn"
              % exc)
        sys.exit(1)
    app = create_app()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="portgraph.py",
        description="Qt 应用鸿蒙化可移植性拓扑图谱")
    parser.add_argument("--compact", action="store_true",
                        help="输出紧凑 JSON")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("ingest", help="采集数据入库")
    p.add_argument("source", choices=["harmonybrew", "cmdpkgs", "kb", "all"])
    p.add_argument("--offline", action="store_true",
                   help="cmdpkgs 不执行 git pull")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("clone", help="shallow clone + 扫描入库")
    p.add_argument("url", help="git 仓库 http(s) 地址")
    p.add_argument("--name", help="自定义 workspace 目录名")
    p.set_defaults(func=cmd_clone)

    p = sub.add_parser("scan", help="扫描 Qt 工程")
    p.add_argument("project")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("analyze", help="可移植性分析")
    p.add_argument("app")
    p.add_argument("--summary", action="store_true")
    p.set_defaults(func=cmd_analyze)

    p = sub.add_parser(
        "deps", help="综合依赖分析（link/build-tool/runtime/test/vendored "
                     "分类 + 版本范围 + 产物获取途径，见 docs/deps-report.md）")
    p.add_argument("target", help="项目路径或已扫描应用名（如 corpus_a）")
    p.add_argument("--json", action="store_true",
                   help="输出完整报告 JSON（机器可读，供 agent 解析）")
    p.set_defaults(func=cmd_deps)

    p = sub.add_parser("stats", help="数据统计")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("fetch", help="下载 Harmonybrew bottle（任意平台可用的鸿蒙依赖，"
                      "供 OHOS NDK 交叉编译）")
    p.add_argument("package",
                   help="包名（支持逗号分隔多个；@ 变体如 openssl@3）")
    p.add_argument("--out", help="解压目录（默认 workspace/ohos-libs）")
    p.add_argument("--force", action="store_true", help="已存在也重新下载")
    p.set_defaults(func=cmd_fetch)

    p = sub.add_parser("fetch-deps",
                       help="一键下载应用全部依赖的鸿蒙产物（agent 工具，"
                            "见 docs/fetch-deps.md）")
    p.add_argument("app", help="应用 ID 或名称（如 corpus_a / app:corpus_a）")
    p.add_argument("--out", help="下载解压目录（默认 workspace/ohos-libs，跨应用共享缓存）")
    p.add_argument("--force", action="store_true", help="已存在也重新下载")
    p.add_argument("--jobs", type=int, default=8,
                   help="并行下载线程数（默认 8；弱网下串行曾 90 分钟超时，"
                        "并行后同规模约 8 分钟；0/1 = 关闭并行预取）")
    p.add_argument("--dry-run", action="store_true",
                   help="只输出分类清单，不下载不写盘")
    p.add_argument("--json", action="store_true",
                   help="输出完整 manifest JSON（机器可读，供 agent 解析）")
    p.set_defaults(func=cmd_fetch_deps)

    p = sub.add_parser("export", help="导出全图 JSON")
    p.add_argument("out", nargs="?")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("serve", help="启动 Web 服务")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="127.0.0.1")
    p.set_defaults(func=cmd_serve)

    # --compact 后置支持：全局 --compact 必须写在子命令前，用户习惯写在
    # 子命令后（如 `deps X --json --compact`），为所有子命令补上该旗标
    # （argparse 子解析器不会覆盖主解析器已写入的命名空间值，两处位置均生效）
    for p in sub.choices.values():
        p.add_argument("--compact", action="store_true",
                       help="输出紧凑 JSON（与全局 --compact 等效）")

    args = parser.parse_args()
    if not getattr(args, "func", None):
        parser.print_help()
        sys.exit(1)
    args.func(args)


if __name__ == "__main__":
    main()

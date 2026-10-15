"""SQLite graph storage: nodes / edges / interfaces / clusters / meta."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from . import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  source TEXT NOT NULL,
  port_status TEXT NOT NULL,
  port_evidence TEXT,
  cluster_id TEXT,
  source_url TEXT,
  repo_url TEXT,
  homepage TEXT,
  artifact_url TEXT,
  artifact_cmd TEXT,
  artifact_local TEXT,
  bottle_sha256 TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  type TEXT NOT NULL,
  platform_cond TEXT,
  PRIMARY KEY (src, dst, type)
);
CREATE TABLE IF NOT EXISTS interfaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  ohos_status TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS node_interfaces (
  node_id TEXT NOT NULL,
  interface_id TEXT NOT NULL,
  evidence TEXT,
  PRIMARY KEY (node_id, interface_id)
);
CREATE TABLE IF NOT EXISTS clusters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_name_nocase
    ON nodes(name COLLATE NOCASE);
"""


def connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = Path(db_path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()


# 产物/链接相关列，旧库缺列时自动补齐（CREATE TABLE IF NOT EXISTS 不改已有表）
_LINK_COLS = ("source_url", "repo_url", "homepage",
              "artifact_url", "artifact_cmd", "artifact_local",
              "bottle_sha256")


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {r["name"] for r in
                conn.execute("PRAGMA table_info(nodes)").fetchall()}
    for col in _LINK_COLS:
        if col not in existing:
            conn.execute("ALTER TABLE nodes ADD COLUMN %s TEXT" % col)


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------- nodes

def upsert_node(conn, node_id: str, kind: str, name: str, source: str,
                port_status: str, version: str = None, description: str = None,
                port_evidence: str = None, cluster_id: str = None,
                links: Dict = None) -> None:
    """写入/更新节点。

    links: 可选的链接信息 dict，键取自 _LINK_COLS
      source_url    源码下载地址（formula url / SBOM downloadLocation）
      repo_url      源码 git 仓库（formula head）
      homepage      项目主页
      artifact_url  鸿蒙可运行产物的直链（cmd-pkgs tar.gz / bottle 直链）
      artifact_cmd  获取鸿蒙产物的命令（brew install / install.sh）
      artifact_local 本地已就绪的鸿蒙产物路径
      bottle_sha256 bottle 的 sha256（下载校验用）
    链接字段用 COALESCE 保留旧值，避免重扫时被 None 覆盖。
    """
    links = links or {}
    lk = [links.get(c) for c in _LINK_COLS]
    conn.execute(
        """INSERT INTO nodes(id, kind, name, version, description, source,
                             port_status, port_evidence, cluster_id,
                             source_url, repo_url, homepage,
                             artifact_url, artifact_cmd, artifact_local,
                             bottle_sha256, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             kind=excluded.kind, name=excluded.name,
             version=COALESCE(excluded.version, nodes.version),
             description=COALESCE(excluded.description, nodes.description),
             source=excluded.source, port_status=excluded.port_status,
             port_evidence=excluded.port_evidence,
             cluster_id=excluded.cluster_id,
             source_url=COALESCE(excluded.source_url, nodes.source_url),
             repo_url=COALESCE(excluded.repo_url, nodes.repo_url),
             homepage=COALESCE(excluded.homepage, nodes.homepage),
             artifact_url=COALESCE(excluded.artifact_url, nodes.artifact_url),
             artifact_cmd=COALESCE(excluded.artifact_cmd, nodes.artifact_cmd),
             artifact_local=COALESCE(excluded.artifact_local,
                                     nodes.artifact_local),
             bottle_sha256=COALESCE(excluded.bottle_sha256,
                                    nodes.bottle_sha256),
             updated_at=excluded.updated_at""",
        (node_id, kind, name, version, description, source, port_status,
         port_evidence, cluster_id, *lk, now()))


def get_node(conn, node_id: str) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM nodes WHERE id=?", (node_id,)).fetchone()
    return dict(row) if row else None


def find_node_by_name(conn, name: str) -> Optional[Dict]:
    # name COLLATE NOCASE 走 idx_nodes_name_nocase 索引；
    # 与 lower(name)=lower(?) 语义等价（SQLite lower()/NOCASE 均仅折 ASCII），
    # 但后者对 nodes 全表扫描，大库下是 deps 报告的热点。
    row = conn.execute(
        "SELECT * FROM nodes WHERE name=? COLLATE NOCASE LIMIT 1", (name,)
    ).fetchone()
    return dict(row) if row else None


def all_nodes(conn) -> List[Dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM nodes").fetchall()]


# ------------------------------------------------------------- edges

def upsert_edge(conn, src: str, dst: str, etype: str,
                platform_cond: str = None) -> None:
    conn.execute(
        """INSERT INTO edges(src, dst, type, platform_cond) VALUES(?,?,?,?)
           ON CONFLICT(src, dst, type) DO UPDATE SET
             platform_cond=COALESCE(excluded.platform_cond, edges.platform_cond)""",
        (src, dst, etype, platform_cond))


def out_edges(conn, node_id: str, etypes: Iterable[str] = None) -> List[Dict]:
    sql = "SELECT * FROM edges WHERE src=?"
    args: List = [node_id]
    if etypes:
        marks = ",".join("?" * len(etypes))
        sql += " AND type IN (%s)" % marks
        args.extend(etypes)
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def in_edges(conn, node_id: str) -> List[Dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM edges WHERE dst=?", (node_id,)).fetchall()]


def all_edges(conn) -> List[Dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM edges").fetchall()]


# ------------------------------------------------------------- interfaces

def upsert_interface(conn, iface_id: str, name: str, category: str,
                     ohos_status: str, note: str = None) -> None:
    conn.execute(
        """INSERT INTO interfaces(id, name, category, ohos_status, note)
           VALUES(?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name,
             category=excluded.category, ohos_status=excluded.ohos_status,
             note=excluded.note""",
        (iface_id, name, category, ohos_status, note))


def get_interface(conn, iface_id: str) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM interfaces WHERE id=?",
                       (iface_id,)).fetchone()
    return dict(row) if row else None


def all_interfaces(conn) -> List[Dict]:
    # ORDER BY id：行序确定（无序时 SQLite 行序随查询计划漂移，合入
    # NOCASE 函数索引后即出现基线报告“替代接口”顺序抖动，e2e 实证）
    return [dict(r) for r in conn.execute(
        "SELECT * FROM interfaces ORDER BY id").fetchall()]


def add_node_interface(conn, node_id: str, iface_id: str,
                       evidence: str = None) -> None:
    conn.execute(
        """INSERT INTO node_interfaces(node_id, interface_id, evidence)
           VALUES(?,?,?)
           ON CONFLICT(node_id, interface_id) DO UPDATE SET
             evidence=COALESCE(excluded.evidence, node_interfaces.evidence)""",
        (node_id, iface_id, evidence))


def node_interfaces(conn, node_id: str) -> List[Dict]:
    return [dict(r) for r in conn.execute(
        """SELECT i.*, ni.evidence FROM node_interfaces ni
           JOIN interfaces i ON i.id = ni.interface_id
           WHERE ni.node_id=?""", (node_id,)).fetchall()]


# ------------------------------------------------------------- clusters

def upsert_cluster(conn, cluster_id: str, name: str, kind: str) -> None:
    conn.execute(
        """INSERT INTO clusters(id, name, kind) VALUES(?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind""",
        (cluster_id, name, kind))


def all_clusters(conn) -> List[Dict]:
    return [dict(r) for r in conn.execute("SELECT * FROM clusters").fetchall()]


# ------------------------------------------------------------- meta

def set_meta(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def get_meta(conn, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


# ------------------------------------------------------------- stats

def stats(conn) -> Dict:
    s: Dict = {}
    s["nodes"] = conn.execute("SELECT COUNT(*) c FROM nodes").fetchone()["c"]
    s["edges"] = conn.execute("SELECT COUNT(*) c FROM edges").fetchone()["c"]
    s["interfaces"] = conn.execute(
        "SELECT COUNT(*) c FROM interfaces").fetchone()["c"]
    s["nodes_by_status"] = {
        r["port_status"]: r["c"] for r in conn.execute(
            "SELECT port_status, COUNT(*) c FROM nodes GROUP BY port_status")}
    s["nodes_by_source"] = {
        r["source"]: r["c"] for r in conn.execute(
            "SELECT source, COUNT(*) c FROM nodes GROUP BY source")}
    s["nodes_by_kind"] = {
        r["kind"]: r["c"] for r in conn.execute(
            "SELECT kind, COUNT(*) c FROM nodes GROUP BY kind")}
    s["meta"] = {r["key"]: r["value"] for r in
                 conn.execute("SELECT key, value FROM meta")}
    return s

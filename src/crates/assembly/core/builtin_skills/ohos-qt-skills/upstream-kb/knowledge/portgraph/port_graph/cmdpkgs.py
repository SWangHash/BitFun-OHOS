"""cmd-pkgs 采集：OpenHarmony aarch64 预编译包 README 表解析（见计划 §4.2）。

README.md 含两张表（语言运行时 / 命令行&&三方库），列均为 |软件|版本|安装命令|。
表中出现 = 已发布（移植状态 ported）。同名多版本取最后出现的版本（列表按序更新）。
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Dict, List

from . import CMDPKGS_DIR, OHOS_LIBS, db

REPO_URL = "https://gitcode.com/OpenHarmonyPCDeveloper/cmd-pkgs"
EXPECTED_COUNT = 1247          # README 声明的软件数量
TOLERANCE = 0.10

_HEADER_RE = re.compile(r"^\|[^|]*软件[^|]*\|[^|]*版本[^|]*\|")
_SEP_RE = re.compile(r"^\|[\s:|-]+\|?\s*$")

# 产物直链模板（取自 cmd-pkgs/scripts/install.sh 的 URL 构造，已验证）
#   URL=".../releases/download/pkgs/${NAME}-${VER}-ohos-aarch64.tar.gz"
PKG_BASE = ("https://gitcode.com/OpenHarmonyPCDeveloper/cmd-pkgs"
            "/releases/download/pkgs")
INSTALL_SH = PKG_BASE + "/install.sh"


def artifact_url(name: str, version: str) -> str:
    """鸿蒙 aarch64 预编译产物 tar.gz 直链。"""
    return "%s/%s-%s-ohos-aarch64.tar.gz" % (PKG_BASE, name, version)


def install_cmd(name: str, version: str) -> str:
    """一键安装该鸿蒙产物的命令。"""
    return ("curl -fsSL %s | sh -s -- %s %s"
            % (INSTALL_SH, name, version))


def scan_local_artifacts(libs_dir: Path) -> Dict[str, str]:
    """扫描本地已下载的鸿蒙产物目录 -> {包名: 本地路径}。

    目录形如 ohos-libs/<name>/<version>/（内容可能再嵌一层 <version>/）。
    命中即说明该库的鸿蒙产物已就绪，可直接用于交叉编译链接。
    """
    libs_dir = Path(libs_dir)
    found: Dict[str, str] = {}
    if not libs_dir.is_dir():
        return found
    for pkg in libs_dir.iterdir():
        if not pkg.is_dir():
            continue
        for ver in pkg.iterdir():
            if ver.is_dir():
                found[pkg.name.lower()] = str(ver)
                break
    return found


def annotate_local_artifacts(conn, libs_dir: Path) -> int:
    """把本地已就绪的鸿蒙产物路径写入同名节点的 artifact_local。

    同名库可能有多个节点（hb:<name> / cmdpkgs:<name>），一并标注。
    返回标注的节点数。
    """
    local = scan_local_artifacts(libs_dir)
    if not local:
        return 0
    marked = 0
    for name, path in local.items():
        for nid in ("hb:%s" % name, "cmdpkgs:%s" % name):
            node = db.get_node(conn, nid)
            if node and not node.get("artifact_local"):
                conn.execute(
                    "UPDATE nodes SET artifact_local=? WHERE id=?", (path, nid))
                marked += 1
    conn.commit()
    return marked


def crossfill_links(conn) -> int:
    """同名包跨数据源互补链接信息。

    hb:<name> 有源码链接但产物只有 brew 命令；cmdpkgs:<name> 有产物直链
    但 README 表不含源码地址。双向补全后，任一节点都能给出完整的
    「源码下载 + 鸿蒙产物」信息。返回补全的字段数。

    含版本号的字段（artifact_url/artifact_cmd/source_url 的 URL 里带版本）
    仅在两源版本一致时互补，避免把 8.1.1 的产物直链挂到 9.0.1 的节点上。
    """
    versioned = ("artifact_url", "artifact_cmd", "source_url")
    stable = ("repo_url", "homepage")   # 与版本无关，可无条件互补
    filled = 0
    rows = conn.execute(
        "SELECT name FROM nodes WHERE id LIKE 'cmdpkgs:%'").fetchall()
    for r in rows:
        name = r["name"]
        hb = db.get_node(conn, "hb:%s" % name)
        cp = db.get_node(conn, "cmdpkgs:%s" % name)
        if not hb or not cp:
            continue
        same_ver = (hb.get("version") or "") == (cp.get("version") or "")
        for f in (versioned if same_ver else ()) + stable:
            if not hb.get(f) and cp.get(f):
                conn.execute("UPDATE nodes SET %s=? WHERE id=?" % f,
                             (cp[f], "hb:%s" % name))
                filled += 1
            elif not cp.get(f) and hb.get(f):
                conn.execute("UPDATE nodes SET %s=? WHERE id=?" % f,
                             (hb[f], "cmdpkgs:%s" % name))
                filled += 1
    conn.commit()
    return filled


def ensure_repo(dest: Path = CMDPKGS_DIR) -> Path:
    """克隆或更新 cmd-pkgs 仓库。"""
    dest = Path(dest)
    if (dest / ".git").exists():
        subprocess.run(["git", "-C", str(dest), "pull", "--ff-only"],
                       capture_output=True, text=True, timeout=300)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", REPO_URL, str(dest)],
                       capture_output=True, text=True, timeout=600, check=True)
    return dest


def _split_row(line: str) -> List[str]:
    """拆分表格行，保护转义的 \\|。"""
    protected = line.replace("\\|", "\x00")
    cells = [c.strip().replace("\x00", "|") for c in protected.strip().split("|")]
    return [c for c in cells[1:-1]] if len(cells) >= 2 else cells


def parse_readme(readme_path: Path) -> List[Dict]:
    """解析 README 表 -> [{name, version}]（同名取最后出现版本）。"""
    entries: Dict[str, Dict] = {}
    in_table = False
    for raw in readme_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if _HEADER_RE.match(line):
            in_table = True
            continue
        if in_table and _SEP_RE.match(line):
            continue
        if in_table:
            if not line.startswith("|"):
                in_table = False
                continue
            cells = _split_row(line)
            if len(cells) < 2 or not cells[0]:
                continue
            name, version = cells[0], cells[1]
            entries[name] = {"name": name, "version": version}
    return list(entries.values())


def ingest(conn, repo_dir: Path = CMDPKGS_DIR, pull: bool = False) -> Dict:
    """解析 README 并写库。返回统计。"""
    repo_dir = Path(repo_dir)
    if pull or not (repo_dir / "README.md").exists():
        ensure_repo(repo_dir)
    entries = parse_readme(repo_dir / "README.md")

    db.init_db(conn)
    for e in entries:
        db.upsert_node(
            conn, "cmdpkgs:%s" % e["name"], "package", e["name"], "cmdpkgs",
            "ported", version=e["version"],
            description="OpenHarmony aarch64 预编译包",
            port_evidence="cmd-pkgs README 已发布鸿蒙 aarch64 预编译产物，"
                          "可直接下载安装，无需移植",
            links={"artifact_url": artifact_url(e["name"], e["version"]),
                   "artifact_cmd": install_cmd(e["name"], e["version"])})
    db.set_meta(conn, "ingest_cmdpkgs_at", db.now())
    db.set_meta(conn, "cmdpkgs_count", str(len(entries)))
    conn.commit()

    # 标注本地已就绪的鸿蒙产物（ohos-libs/<name>/<version>/）
    local_marked = annotate_local_artifacts(conn, OHOS_LIBS)
    # 同名包跨源互补源码链接与产物直链
    crossfilled = crossfill_links(conn)

    deviation = abs(len(entries) - EXPECTED_COUNT) / EXPECTED_COUNT
    return {
        "parsed": len(entries), "expected": EXPECTED_COUNT,
        "deviation": round(deviation, 3),
        "gate": "PASS" if deviation <= TOLERANCE else "WARN",
        "local_artifacts_marked": local_marked,
        "links_crossfilled": crossfilled,
        "sample": entries[:3],
    }

"""Harmonybrew homebrew-core formula 解析器（纯 Python，正则 + 块级状态机）。

提取（见计划 §4.1）：
- 普通属性：desc / homepage / url -> version
- 依赖边：depends_on（含 => :build/:test 条件、on_linux/on_macos 平台条件块）
- 移植状态：bottle do 块内出现 arm64_ohos: 键 => ported
- 平台接口绑定：uses_from_macos / keg_only :provided_by_macos => iface:macos-system
- bottle 直链下载（任意平台可用，供非鸿蒙主机交叉编译取依赖）
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import subprocess
import tarfile
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import HB_CORE, db

# 块上下文：进入这些块后整块忽略
_IGNORE_BLOCKS = ("head", "test", "livecheck")
# do 行: `<expr> do |args|`
_DO_RE = re.compile(r"^\s*(.+?)\s+do\b\s*(?:\|[^|]*\|)?\s*$")
_DEF_RE = re.compile(r"^\s*def\s+\w+")
_BLOCK_KW_RE = re.compile(r"^\s*(if|unless|case|begin|for)\b")
_END_RE = re.compile(r"^\s*end\b")
_DESC_RE = re.compile(r'^\s*desc\s+"((?:[^"\\]|\\.)*)"')
_HOMEPAGE_RE = re.compile(r'^\s*homepage\s+"([^"]+)"')
_URL_RE = re.compile(r'^\s*url\s+"([^"]+)"')
_VERSION_RE = re.compile(r'^\s*version\s+"([^"]+)"')
_DEPENDS_RE = re.compile(r'^\s*depends_on\s+(.+)$')
_USES_MACOS_RE = re.compile(r'^\s*uses_from_macos\s+(.+)$')
_KEG_ONLY_MACOS_RE = re.compile(r"^\s*keg_only\s+:provided_by_macos")
_OHOS_BOTTLE_RE = re.compile(r"arm64_ohos:\s*\"")
# head "https://github.com/x/y.git", branch: "..." -> 源码 git 仓库
_HEAD_RE = re.compile(r'^\s*head\s+"([^"]+)"')
# arm64_ohos: "<sha256 digest>" -> 鸿蒙 bottle 产物摘要
_OHOS_BOTTLE_DIGEST_RE = re.compile(r'arm64_ohos:\s*"([0-9a-f]{64})"')
# 顶层 revision N -> 版本后缀 _N（如 pcre2 10.47_1）
_REVISION_RE = re.compile(r"^\s*revision\s+(\d+)")
# bottle 块内 rebuild N -> 文件名 .bottle.N.tar.gz（如 curl 8.21.0）
_REBUILD_RE = re.compile(r"^\s*rebuild\s+(\d+)")

# Harmonybrew bottle 公开下载域（可在任意平台直接下载，无需 brew/鸿蒙设备）
# 命名规则（实测验证）：<name>-<version>[_<revision>].arm64_ohos.bottle[.<rebuild>].tar.gz
# 注意名与版本间是单短横线，非 Homebrew 默认的双短横线
BOTTLE_DOMAIN = "https://harmonybrew.atomgit.com/bottles"

_STRING_ARG_RE = re.compile(r'^"([^"]+)"\s*(?:=>\s*(.+))?$')
# 从 url 提取版本号。覆盖实测形态：
#   name-1.2.3.tar.gz / name_2.42.2_1.tar.xz / name-9.6p1.tgz   （分隔 -/_）
#   .../tags/20260817.0.tar.gz  .../tags/v1.0.2.tar.gz          （GitHub archive）
#   name-v1.5.6.tar.gz                                           （v 前缀）
#   name-20260408.tar.gz                                         （日期版本 ≥6 位）
#   https://site/ack-v3.10.0                                     （无扩展名，URL 即止）
#   name-1.2.3-b2-nodocs.tar.xz / ant-1.10.18-bin.tar.xz         （版本后带
#     -bin/-src 等名称后缀段，boost/antlr 实证）
#   xxx-0.9.0.crate                                              （Rust crate）
#   ImageMagick-7.1.2-31.7z                                      （7z 扩展 +
#     连字符补丁号版本，imagemagick/imagemagick@6 实证；此前 7z 不在
#     扩展清单，正则把尾部 "31.7z" 误当版本 → bottle URL 404）
#   .../tarball/v8.14.18/download.tar.gz                         （版本是独立
#     路径段而文件名不含版本，chiselapp 实证；作为兜底规则，仅在
#     文件名锚定未命中时尝试）
_URL_VER_RE = re.compile(
    r"[-_/][vV]?(\d+(?:\.\d+)+(?:[a-zA-Z]\d*)?(?:[_-]\d+)?|\d{6,})"
    r"(?=(?:[-_.][A-Za-z][\w.]*)*\."
    r"(?:tar\.(?:gz|bz2|xz|lz)|t(?:gz|bz2|xz)|zip|tar|gz|bz2|xz|7z|jar|crate)"
    r"(?:[?#]|$)|$)")
# 兜底：版本是完整路径段（v1.2.3/），文件名本身不含版本
_URL_VER_SEG_RE = re.compile(
    r"[-_/][vV]?(\d+(?:\.\d+)+(?:[a-zA-Z]\d*)?(?:[_-]\d+)?|\d{6,})/")

MACOS_SYSTEM_IFACE = (
    "iface:macos-system", "macOS 系统库绑定", "os-api", "convertible",
    "formula 依赖 macOS 系统自带库；鸿蒙上需改为显式打包依赖（多为可转化的开源库）")


def bottle_url(name: str, version: Optional[str],
               revision: Optional[int] = None,
               rebuild: Optional[int] = None) -> Optional[str]:
    """构造 arm64-OpenHarmony bottle 直链；缺版本时返回 None。

    实测规则（HTTP 200 验证）：
      zlib    1.3.2            -> zlib-1.3.2.arm64_ohos.bottle.tar.gz
      curl    8.21.0 rebuild 1 -> curl-8.21.0.arm64_ohos.bottle.1.tar.gz
      pcre2   10.47  revision 1-> pcre2-10.47_1.arm64_ohos.bottle.tar.gz
      ffmpeg  9.0.1  rebuild 1 -> ffmpeg-9.0.1.arm64_ohos.bottle.1.tar.gz
      openssl@3 3.6.4          -> openssl@3-3.6.4.arm64_ohos.bottle.tar.gz
    """
    if not version:
        return None
    # 防重：url 派生的版本可能已含 _N 后缀（如 name-2.42.2_1.tar.xz）
    ver = version
    if revision and not version.endswith("_%d" % revision):
        ver = "%s_%d" % (version, revision)
    suffix = ".bottle.%d.tar.gz" % rebuild if rebuild else ".bottle.tar.gz"
    return "%s/%s-%s.arm64_ohos%s" % (BOTTLE_DOMAIN, name, ver, suffix)


def _parse_dep_arg(arg: str) -> Optional[Tuple[str, List[str]]]:
    """解析 depends_on / uses_from_macos 参数 -> (包名, 类型列表)。"""
    m = _STRING_ARG_RE.match(arg.strip())
    if not m:
        return None  # depends_on xcode:/macos:/arch: 等非包依赖
    name, arrow = m.group(1), (m.group(2) or "").strip()
    types: List[str] = ["runtime"]
    if arrow.startswith(":"):
        tag = arrow[1:].strip()
        types = [tag] if tag in ("build", "test") else ["runtime"]
    elif arrow.startswith("["):
        tags = re.findall(r":(\w+)", arrow)
        types = [t for t in tags if t in ("build", "test")] or ["runtime"]
    return name, types


def _platform_cond_of(stack: List[str]) -> Optional[str]:
    """从块栈推导平台条件（鸿蒙属 Linux 内核族，on_linux 视为有效依赖）。"""
    conds = []
    for ctx in stack:
        if ctx.startswith("on_linux"):
            conds.append("linux")
        elif ctx.startswith("on_macos"):
            conds.append("macos")
        elif ctx.startswith("on_system"):
            conds.append("linux+macos-old")
        elif ctx.startswith(("on_arm", "on_intel")):
            conds.append("arch")
    return "+".join(conds) if conds else None


def _unquote(s: str) -> str:
    return s.replace('\\"', '"').replace("\\\\", "\\")


def parse_formula(path: Path) -> Dict:
    """解析单个 formula 文件。"""
    name = path.stem
    info: Dict = {
        "name": name, "desc": None, "homepage": None, "version": None,
        "url": None, "head_url": None, "deps": [], "uses_from_macos": [],
        "keg_only_macos": False, "ohos_bottle": False,
        "ohos_bottle_digest": None, "revision": None, "rebuild": None,
    }
    stack: List[str] = []       # 块上下文栈
    ignored = 0                 # 处于忽略块内的嵌套深度计数
    in_bottle = False
    url_version: Optional[str] = None
    explicit_version: Optional[str] = None

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if _END_RE.match(line):
            if stack:
                ctx = stack.pop()
                if ctx in _IGNORE_BLOCKS:
                    ignored -= 1
                elif ctx == "bottle":
                    in_bottle = False
            continue

        # 块开启：`<expr> do |args|` / `def name` / 行首 if|unless|case|begin|for
        opened = None
        m = _DO_RE.match(line)
        if m:
            expr = m.group(1).strip()
            opened = expr.split()[0].split("(")[0] if expr.split() else "do"
        elif _DEF_RE.match(line):
            opened = "def"
        elif _BLOCK_KW_RE.match(line):
            opened = stripped.split()[0]

        if opened is not None:
            stack.append(opened)
            if opened in _IGNORE_BLOCKS:
                ignored += 1
            elif opened == "bottle":
                in_bottle = True
            continue

        if ignored > 0:
            continue

        # bottle 块内：检测 arm64_ohos、产物摘要与 rebuild 号
        if in_bottle:
            if _OHOS_BOTTLE_RE.search(line):
                info["ohos_bottle"] = True
            dm = _OHOS_BOTTLE_DIGEST_RE.search(line)
            if dm and info["ohos_bottle_digest"] is None:
                info["ohos_bottle_digest"] = dm.group(1)
            rm = _REBUILD_RE.match(line)
            if rm and info["rebuild"] is None:
                info["rebuild"] = int(rm.group(1))
            continue

        # 标量属性
        m = _DESC_RE.match(line)
        if m and info["desc"] is None:
            info["desc"] = _unquote(m.group(1))
            continue
        m = _HOMEPAGE_RE.match(line)
        if m and info["homepage"] is None:
            info["homepage"] = m.group(1)
            continue
        m = _VERSION_RE.match(line)
        if m and explicit_version is None:
            explicit_version = m.group(1)
            continue
        m = _REVISION_RE.match(line)
        if m and info["revision"] is None:
            info["revision"] = int(m.group(1))
            continue
        m = _URL_RE.match(line)
        if m and info["url"] is None:
            info["url"] = m.group(1)
            if url_version is None:
                vm = _URL_VER_RE.search(m.group(1))
                if vm:
                    url_version = vm.group(1)
                elif url_version is None:
                    # 兑底：版本作为独立路径段（.../tarball/v8.14.18/xx.tar.gz）
                    vm = _URL_VER_SEG_RE.search(m.group(1))
                    if vm:
                        url_version = vm.group(1)
            continue
        m = _HEAD_RE.match(line)
        if m and info["head_url"] is None:
            info["head_url"] = m.group(1)
            continue
        if _KEG_ONLY_MACOS_RE.match(line):
            info["keg_only_macos"] = True
            continue

        # 依赖（考虑所在平台条件块）
        cond = _platform_cond_of(stack)
        m = _DEPENDS_RE.match(line)
        if m:
            parsed = _parse_dep_arg(m.group(1))
            if parsed:
                info["deps"].append((parsed[0], parsed[1], cond))
            continue
        m = _USES_MACOS_RE.match(line)
        if m:
            parsed = _parse_dep_arg(m.group(1))
            if parsed:
                info["uses_from_macos"].append((parsed[0], parsed[1]))
            continue

    info["version"] = explicit_version or url_version
    return info


def iter_formula_files(formula_dir: Path = HB_CORE):
    return sorted(Path(formula_dir).glob("*/*.rb"))


# Harmonybrew formula 主仓（sparse checkout 仅 Formula/，避免拉全量 git 历史）
HB_REPO_URL = "https://atomgit.com/Harmonybrew/homebrew-core.git"


def ensure_core(repo_dir: Path = None) -> Path:
    """克隆或更新 Harmonybrew hb-core（blob:none 浅克隆 + sparse checkout
    仅 Formula/）。此前 ingest 在目录缺失时静默返回 0 文件（多轮实测反复
    通到的坑），现改为自动获取或显式报错。"""
    dest = Path(repo_dir) if repo_dir else HB_CORE.parent
    if (dest / ".git").exists():
        subprocess.run(["git", "-C", str(dest), "pull", "--ff-only"],
                       capture_output=True, text=True, timeout=300)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(
            ["git", "clone", "--depth", "1", "--filter=blob:none",
             "--sparse", HB_REPO_URL, str(dest)],
            capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            raise RuntimeError(
                "hb-core 克隆失败（%s）：%s" % (HB_REPO_URL,
                                                 (r.stderr or "").strip()[:200]))
        subprocess.run(["git", "-C", str(dest), "sparse-checkout", "set",
                        "Formula"], capture_output=True, text=True,
                       timeout=300, check=True)
    return dest


def ingest(conn, formula_dir: Path = HB_CORE, limit: int = 0,
           pull: bool = False) -> Dict:
    """解析全部 formula 并写库。返回统计。

    pull=True 或 formula 目录缺失时自动克隆/更新 hb-core（--offline 时
    仅在目录缺失时报错退出，不再静默返回 0 文件）。"""
    db.init_db(conn)
    if pull or not Path(formula_dir).exists():
        try:
            ensure_core(Path(formula_dir).parent
                        if formula_dir != HB_CORE else None)
        except RuntimeError:
            if not iter_formula_files(formula_dir):
                raise   # 目录仍缺失且无本地数据：显式失败
    files = iter_formula_files(formula_dir)
    if limit:
        files = files[:limit]

    parsed: List[Dict] = []
    errors: List[str] = []
    for f in files:
        try:
            parsed.append(parse_formula(f))
        except Exception as exc:  # 单文件失败不阻断整体
            errors.append("%s: %s" % (f.name, exc))

    names = {p["name"] for p in parsed}
    db.upsert_interface(conn, *MACOS_SYSTEM_IFACE)

    ported = 0
    for p in parsed:
        node_id = "hb:%s" % p["name"]
        status = "ported" if p["ohos_bottle"] else "unknown"
        if p["ohos_bottle"]:
            ported += 1
        if p["ohos_bottle"]:
            digest = p.get("ohos_bottle_digest")
            evidence = "arm64_ohos bottle（鸿蒙预编译产物已发布）"
            if digest:
                evidence += "，bottle sha256:%s…" % digest[:12]
            # bottle 直链可从任意平台（含 Windows）直接下载，无需 brew/鸿蒙设备
            b_url = bottle_url(p["name"], p["version"],
                               p.get("revision"), p.get("rebuild"))
            if b_url:
                evidence += "，下载: %s" % b_url
            artifact_cmd = "brew install %s" % p["name"]
        else:
            evidence = ("Harmonybrew formula 存在，但无 arm64_ohos bottle："
                        "无鸿蒙预编译产物，需自行交叉编译，"
                        "可移植性由其依赖与平台接口递归判定")
            b_url = None
            artifact_cmd = None
        db.upsert_node(conn, node_id, "package", p["name"], "harmonybrew",
                       status, version=p["version"], description=p["desc"],
                       port_evidence=evidence,
                       links={"source_url": p["url"],
                              "repo_url": p.get("head_url"),
                              "homepage": p["homepage"],
                              "artifact_url": b_url,
                              "artifact_cmd": artifact_cmd,
                              "bottle_sha256": p.get("ohos_bottle_digest")})
        for dep_name, types, cond in p["deps"]:
            dst = "hb:%s" % dep_name
            for t in types:
                db.upsert_edge(conn, node_id, dst, t, platform_cond=cond)
        # uses_from_macos: 接口绑定 + （若存在同名 formula）依赖边
        for dep_name, types in p["uses_from_macos"]:
            db.add_node_interface(conn, node_id, MACOS_SYSTEM_IFACE[0],
                                  evidence="uses_from_macos %s" % dep_name)
            if dep_name in names:
                for t in types:
                    db.upsert_edge(conn, node_id, "hb:%s" % dep_name, t,
                                   platform_cond="macos")
        if p["keg_only_macos"]:
            db.add_node_interface(conn, node_id, MACOS_SYSTEM_IFACE[0],
                                  evidence="keg_only :provided_by_macos")

    db.set_meta(conn, "ingest_harmonybrew_at", db.now())
    db.set_meta(conn, "harmonybrew_formula_count", str(len(parsed)))
    db.set_meta(conn, "harmonybrew_ported_count", str(ported))
    conn.commit()
    return {
        "files": len(files), "parsed": len(parsed), "ported": ported,
        "errors": errors[:10], "error_count": len(errors),
        "edges_written": conn.execute(
            "SELECT COUNT(*) c FROM edges WHERE src LIKE 'hb:%'").fetchone()["c"],
    }


# ------------------------------------------------------------- bottle 下载
# 供非鸿蒙主机（Windows/Linux/macOS）获取 arm64-OpenHarmony 依赖，
# 用于 OHOS NDK 交叉编译，无需 brew 或鸿蒙设备。
# 流程：查库取直链 -> 下载 -> sha256 校验 -> 解压 -> NTFS 补建 .so 链接名。

_UA = {"User-Agent": "portgraph/1.0 (+bottle-fetch)"}


def _find_package(conn, name: str) -> Optional[Dict]:
    """按名/ID 查 hb 包节点（支持 openssl@3 等变体、模糊匹配）。"""
    for nid in (name if name.startswith("hb:") else "hb:%s" % name, name):
        node = db.get_node(conn, nid)
        if node:
            return node
    row = conn.execute(
        "SELECT id FROM nodes WHERE id LIKE 'hb:%' AND name=? LIMIT 1",
        (name,)).fetchone()
    if row:
        return db.get_node(conn, row["id"])
    # 前缀模糊：pkg-config -> pkgconf 等
    row = conn.execute(
        "SELECT id FROM nodes WHERE id LIKE 'hb:%' AND id LIKE ? LIMIT 1",
        ("hb:%" + name + "%",)).fetchone()
    return db.get_node(conn, row["id"]) if row else None


def _download(url: str, dest: Path, sha256: Optional[str],
              timeout: int = 300) -> None:
    """下载并校验 sha256（不匹配则删除并抛错）。

    缓存命中跳过：dest 已存在且 sha256 匹配（无 sha 时非空即视为完整）
    不重下——支持并行预取后再逐个解压，也提供断点续传语义（重跑只补缺）。
    """
    if dest.exists() and dest.stat().st_size > 0:
        if sha256:
            h = hashlib.sha256(dest.read_bytes()).hexdigest()
            if h == sha256:
                return
        else:
            return  # 无 sha 元数据：信任已存在文件，解压失败会兜底报错
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp, \
            open(dest, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    if sha256:
        h = hashlib.sha256(dest.read_bytes()).hexdigest()
        if h != sha256:
            dest.unlink(missing_ok=True)
            raise RuntimeError("sha256 不匹配: 期望 %s 实际 %s" % (sha256, h))


def _rmtree(path: Path) -> None:
    """删除目录树；Windows 下 brew 产物的只读文件（mode 444/555）
    先恢复写权限再删，否则 PermissionError。"""
    def _onerr(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)
        func(p)
    shutil.rmtree(path, onerror=_onerr)


def _extract_with_retry(tar: tarfile.TarFile, member: tarfile.TarInfo,
                        dest: Path, attempts: int = 3) -> None:
    """解压单个成员，瞬时文件锁（杀毒扫描刚写入的文件）重试。"""
    for i in range(attempts):
        try:
            tar.extract(member, dest, filter="data")
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.6)


def _extract_bottle(tar_path: Path, out_dir: Path) -> Dict:
    """解压 bottle 到 out_dir，返回 {installed: 路径, symlinks_fixed: [...]}。

    bottle 结构 <name>/<version>/{lib,include,...}。
    Windows/NTFS 建不了符号链接：包内相对链接改为拷贝目标文件，
    使 -lfoo 能被 OHOS 交叉链接器解析（知识库 fetch 脚本同款策略）。
    """
    symlinks_fixed: List[str] = []
    with tarfile.open(tar_path, "r:gz") as tar:
        members = tar.getmembers()
        # 先取顶层 <name> 作为安装根
        top = members[0].name.split("/", 1)[0] if members else ""
        pending_links = []
        for m in members:
            if m.isdir():
                (out_dir / m.name).mkdir(parents=True, exist_ok=True)
            elif m.isreg():
                _extract_with_retry(tar, m, out_dir)
            elif m.issym():
                pending_links.append(m)
        # 补建符号链接：目标在包内且存在 -> 拷贝；否则跳过。
        # linkname 相对链接所在目录（如 lib/libz.so -> libz.so.1.3.2）
        for m in pending_links:
            link_path = out_dir / m.name
            target = None
            if not m.linkname.startswith("/"):
                target = (link_path.parent / m.linkname).resolve()
            if target and target.is_file() and not link_path.exists():
                shutil.copy2(target, link_path)
                symlinks_fixed.append(m.name)
    installed = _locate_installed(out_dir, top)
    return {"installed": str(installed), "symlinks_fixed": symlinks_fixed}


def _locate_installed(out_dir: Path, top: str) -> Path:
    """定位真正含 lib/include 的安装根（bottle 为 <name>[/<version>] 两级）。

    顶层即含 lib/ 或 include/ -> 取顶层；否则取其下唯一含 lib/include 的
    子目录（如 jsoncpp/1.9.8）。
    """
    if not top:
        return out_dir
    top_dir = out_dir / top
    if (top_dir / "lib").is_dir() or (top_dir / "include").is_dir():
        return top_dir
    cands = [c for c in sorted(top_dir.iterdir()) if c.is_dir() and
             ((c / "lib").is_dir() or (c / "include").is_dir())]
    return cands[0] if cands else top_dir


def fetch_bottle(conn, name: str, out_dir: Path,
                 force: bool = False) -> Dict:
    """下载一个 Harmonybrew 包的 arm64_ohos bottle 并解压到 out_dir。

    返回 {package, version, bottle_url, sha256, installed, libs, hints}
    hints 含 CMake/qmake 集成片段。已在 out_dir/<name>/<ver>/ 存在时跳过
    （force 强制重下）。
    """
    node = _find_package(conn, name)
    if node is None:
        raise RuntimeError("包不存在: %s（先 ingest harmonybrew；"
                           "裸名可能需要 @ 变体，如 openssl@3）" % name)
    url = node.get("artifact_url")
    if not url:
        raise RuntimeError("%s 无 arm64_ohos bottle 直链（缺版本或无 bottle），"
                           "需走源码交叉编译" % name)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pkg_dir = out_dir / node["name"] / (node.get("version") or "")
    if pkg_dir.exists() and any(pkg_dir.iterdir()) and not force:
        return {"package": node["name"], "version": node["version"],
                "bottle_url": url, "installed": str(pkg_dir),
                "skipped": "already-exists"}

    cache = out_dir / ".cache"
    cache.mkdir(exist_ok=True)
    tar_path = cache / url.rsplit("/", 1)[-1]
    sha_full = node.get("bottle_sha256")
    _download(url, tar_path, sha_full)

    # 先解压到 staging，成功后原子落位：中途失败不留半成品目录，
    # 保证 pkg_dir 非空 == 产物完整（already-exists 跳过才可信）
    staging = out_dir / ".staging" / ("%s-%s" % (
        node["name"], node.get("version") or "x"))
    if staging.exists():
        _rmtree(staging)
    try:
        info = _extract_bottle(tar_path, staging)
    except Exception:
        _rmtree(staging)
        raise
    finally:
        tar_path.unlink(missing_ok=True)

    installed = Path(info["installed"])
    if pkg_dir.exists():          # force 覆盖旧产物（可能含只读文件）
        _rmtree(pkg_dir)
    pkg_dir.parent.mkdir(parents=True, exist_ok=True)
    if installed == staging:
        # 无顶层目录的异常结构：搬内容而非整目录
        pkg_dir.mkdir(parents=True, exist_ok=True)
        for item in staging.iterdir():
            item.rename(pkg_dir / item.name)
        _rmtree(staging)
    else:
        installed.rename(pkg_dir)
        _rmtree(staging)
    installed = pkg_dir
    lib_dir = installed / "lib"
    libs = sorted(p.stem[3:] for p in lib_dir.glob("lib*.so")) if lib_dir.is_dir() else []
    hints = {
        "cmake": (
            "cmake -S . -B build_ohos \\\n"
            "  -DCMAKE_TOOLCHAIN_FILE=$NATIVE_OHOS_SDK/build/cmake/ohos.toolchain.cmake \\\n"
            "  -DOHOS_ARCH=arm64-v8a \\\n"
            "  -DCMAKE_PREFIX_PATH=%s \\\n"
            "  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH" % installed),
        "qmake": ("LIBS += -L%s/lib %s" % (
            installed, " ".join("-l%s" % l for l in libs))),
        "deploy": "部署 .so 到 entry/libs/arm64-v8a/ 后才能在设备运行",
    }
    return {"package": node["name"], "version": node["version"],
            "bottle_url": url, "sha256": "verified" if sha_full else "n/a",
            "installed": str(installed), "libs": libs,
            "symlinks_fixed": info["symlinks_fixed"][:10],
            "hints": hints}


def prefetch_bottles(conn, names: List[str], out_dir: Path,
                     force: bool = False, jobs: int = 8) -> Dict:
    """并行预取多个 bottle 的 tar 到 out_dir/.cache（只下载，不解压）。

    供 fetch_app_deps 在逐包处理前批量拉取——实测弱网下串行下载 57KB/s
    拖垮全流程（90 分钟超时），8 线程并行后同样规模约 8 分钟。已安装
    （pkg_dir 存在）与缓存命中（tar 已在且 sha 匹配）自动跳过；单个
    失败不抛出（记录在 errors，后续串行阶段会对该包正确报 failed）。
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = out_dir / ".cache"
    cache.mkdir(exist_ok=True)

    plans = []          # (name, url, tar_path, sha)
    skipped_installed = 0
    for name in names:
        try:
            node = _find_package(conn, name)
        except Exception:
            node = None
        if node is None or not node.get("artifact_url"):
            continue    # 解析失败/无 bottle：留给串行阶段按 need_port 报告
        pkg_dir = out_dir / node["name"] / (node.get("version") or "")
        if pkg_dir.exists() and any(pkg_dir.iterdir()) and not force:
            skipped_installed += 1
            continue
        tar_path = cache / node["artifact_url"].rsplit("/", 1)[-1]
        plans.append((node["name"], node["artifact_url"], tar_path,
                      node.get("bottle_sha256")))

    ok, failed = 0, []
    if plans:
        with ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
            futs = {ex.submit(_download, u, t, s): (n, u) for
                    n, u, t, s in plans}
            for fut in as_completed(futs):
                n, u = futs[fut]
                try:
                    fut.result()
                    ok += 1
                except Exception as exc:
                    failed.append({"name": n, "url": u, "error": str(exc)})
    return {"planned": len(plans), "downloaded_or_cached": ok,
            "skipped_installed": skipped_installed, "failed": failed}

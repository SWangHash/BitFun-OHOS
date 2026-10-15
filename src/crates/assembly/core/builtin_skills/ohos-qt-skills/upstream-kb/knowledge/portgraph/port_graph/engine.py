"""可移植性递归推导引擎（计划 §3.2 / §5.1）。

规则：
  portable(n) = n 自身状态为 ported
             AND n 的全部平台接口 ∈ {supported, convertible}
             AND n 的全部有效依赖（runtime/uses-module，排除 macos 条件依赖）递归 portable
  blocked    = 任一硬性条件失败（blocked 依赖 / 不支持接口 / 不支持模块）
  uncertain  = 无硬阻塞但存在 unknown 依赖或接口

特殊：被非鸿蒙平台条件编译守卫包裹的接口（guard=platform-excluded）
  → 鸿蒙构建时不编译，不计入硬阻塞
  → 但记录到 platform_excluded，并分析其功能类别在鸿蒙是否有对应替代接口

只沿 runtime / uses-module 边递归；build/test 边不参与判定。
platform_cond == "macos" 的依赖在鸿蒙上不需要，跳过。
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

from . import db

RECURSE_EDGE_TYPES = ("runtime", "uses-module")
_SKIP_PLATFORM_CONDS = ("macos",)

KIND_LABELS = {
    "qt-module": "不支持的 Qt 模块",
    "package": "依赖包阻塞",
    "app": "依赖应用阻塞",
}

_GUARD_RE = re.compile(r"guard=(\S+)")
# 匹配证据串中的计数: (A 处无条件 / B 处鸿蒙可编译 / C 处宏守卫排除 / D 处文件级排除)
_COUNT_RE = re.compile(
    r"\((\d+)\s*处无条件\s*/\s*(\d+)\s*处鸿蒙可编译\s*/\s*"
    r"(\d+)\s*处宏守卫排除\s*/\s*(\d+)\s*处文件级排除\)")


def _risk_from_evidence(evidence: str) -> Optional[str]:
    """根据命中分布估算修改风险等级。

    risk = (无条件 + 鸿蒙可编译) / 总命中数
      - >= 0.8 → high（大部分代码鸿蒙会编译，需大量改写）
      - 0.3 ~ 0.8 → medium
      - < 0.3 → low（大部分被平台守卫排除，只需少量适配）
    """
    if not evidence:
        return None
    m = _COUNT_RE.search(evidence)
    if not m:
        return None
    uncond, active, macro_excl, file_excl = map(int, m.groups())
    total = uncond + active + macro_excl + file_excl
    if total == 0:
        return None
    ratio = (uncond + active) / total
    if ratio >= 0.8:
        return "high"
    if ratio >= 0.3:
        return "medium"
    return "low"


class _Cache:
    def __init__(self):
        self.status: Dict[str, str] = {}
        self.blockers: Dict[str, List[Dict]] = {}
        self.unknowns: Dict[str, List[Dict]] = {}
        self.platform_excluded: Dict[str, List[Dict]] = {}
        self.on_stack: List[str] = []
        self.cycles: List[List[str]] = []


def _parse_guard(evidence: str) -> str:
    """从证据串中提取 guard 状态，默认 ohos-active。"""
    if not evidence:
        return "ohos-active"
    m = _GUARD_RE.search(evidence)
    return m.group(1) if m else "ohos-active"


def _find_ohos_alternatives(iface: Dict, alt_by_cat: Dict[str, List[Dict]]) -> List[Dict]:
    """查找同功能类别下鸿蒙支持/可转化的替代接口（使用预计算索引）。"""
    cat = iface.get("category")
    if not cat:
        return []
    return [a for a in alt_by_cat.get(cat, []) if a["id"] != iface["id"]]


def _node_blocker(conn, node: Dict, iface_status_map: Dict) -> Optional[Dict]:
    """节点自身基础状态产生的硬阻塞（无依赖递归）。"""
    if node["kind"] in ("app", "framework"):
        return None  # app / framework 子项目的状态由本引擎递归计算
    if node["port_status"] == "blocked":
        reason = node.get("port_evidence") or "基础状态为 blocked"
        kind = ("unsupported-module" if node["kind"] == "qt-module"
                else "blocked-package")
        return {"node": node["id"], "name": node["name"], "kind": kind,
                "reason": reason, "artifact": artifact_info(node)}
    return None


def artifact_info(node: Dict) -> Dict:
    """汇总节点的鸿蒙产物与源码链接信息。

    ready=True   有可直接使用的鸿蒙产物（无需移植）
    provided=True 由 Qt/鸿蒙框架本身提供（如 Qt 模块），无需单独下载或移植
    两者皆 False  无产物，需自行交叉编译，可移植性由依赖/接口递归判定
    """
    url = node.get("artifact_url")
    cmd = node.get("artifact_cmd")
    local = node.get("artifact_local")
    kind = node.get("kind")
    status = node.get("port_status")
    provided = kind in ("qt-module", "platform-api") or (
        status == "ported" and not (url or cmd or local))
    return {
        "ready": bool(url or cmd or local),
        "provided": provided,
        "artifact_url": url,        # 鸿蒙产物直链（cmd-pkgs tar.gz）
        "artifact_cmd": cmd,        # 获取产物命令（brew install / install.sh）
        "artifact_local": local,    # 本地已就绪产物路径
        "source_url": node.get("source_url"),   # 源码下载地址
        "repo_url": node.get("repo_url"),       # 源码 git 仓库
        "homepage": node.get("homepage"),       # 项目主页
    }


def _evaluate(conn, node_id: str, cache: _Cache,
              iface_map: Dict[str, Dict],
              alt_by_cat: Dict[str, List[Dict]]) -> str:
    """返回 portable / blocked / uncertain，并填充 cache 中的局部阻塞列表。"""
    if node_id in cache.status:
        return cache.status[node_id]
    if node_id in cache.on_stack:
        cache.cycles.append(cache.on_stack[cache.on_stack.index(node_id):]
                            + [node_id])
        cache.status.setdefault(node_id, "portable")
        cache.blockers.setdefault(node_id, [])
        cache.unknowns.setdefault(node_id, [])
        cache.platform_excluded.setdefault(node_id, [])
        return "portable"  # 环内先按通过处理，避免死循环

    cache.on_stack.append(node_id)
    blockers: List[Dict] = []
    unknowns: List[Dict] = []
    platform_excluded: List[Dict] = []

    node = db.get_node(conn, node_id)
    if node is None:
        blockers.append({"node": node_id, "name": node_id,
                         "kind": "missing-node", "reason": "依赖节点不存在"})
        status = "blocked"
    else:
        status = "portable"
        base = _node_blocker(conn, node, iface_map)
        if base:
            blockers.append(base)
            status = "blocked"
        elif (node["port_status"] == "unknown"
              and node["kind"] not in ("app", "framework")):
            art = artifact_info(node)
            if art["ready"]:
                reason = "已有鸿蒙产物（%s），无需移植" % (
                    art["artifact_url"] or art["artifact_cmd"]
                    or art["artifact_local"])
            else:
                reason = ("无鸿蒙预编译产物，需自行交叉编译移植；"
                          + (node.get("port_evidence") or "移植状态未知"))
            unknowns.append({
                "node": node_id, "name": node["name"],
                "kind": ("unknown-package" if node["kind"] == "package"
                         else "unknown-status"),
                "reason": reason,
                "artifact": art})

        # 平台接口检查
        for ni in db.node_interfaces(conn, node_id):
            ist = ni["ohos_status"]
            guard = _parse_guard(ni.get("evidence"))
            if ist == "unsupported" and guard == "platform-excluded":
                # 被非鸿蒙平台守卫包裹，鸿蒙不编译 → 非硬阻塞
                alts = _find_ohos_alternatives(ni, alt_by_cat)
                platform_excluded.append({
                    "node": node_id, "name": node["name"],
                    "iface": ni["name"], "category": ni.get("category"),
                    "guard": guard,
                    "reason": "接口 %s 被非鸿蒙平台条件编译守卫包裹（鸿蒙不编译）"
                              "，功能类别=%s" % (ni["name"], ni.get("category")),
                    "alternatives": alts,
                    "evidence": ni.get("evidence", "")})
            elif ist == "unsupported":
                alts = _find_ohos_alternatives(ni, alt_by_cat)
                reason = "使用鸿蒙不支持的平台接口 %s（%s）%s" % (
                    ni["name"], ni.get("category") or "",
                    ni.get("note") or "")
                if alts:
                    alt_names = "、".join(a["name"] for a in alts)
                    reason += "；同类鸿蒙替代接口: %s" % alt_names
                if ni.get("evidence"):
                    reason += "［证据: %s］" % ni["evidence"]
                blockers.append({
                    "node": node_id, "name": node["name"],
                    "kind": "unsupported-interface", "reason": reason,
                    "guard": guard, "alternatives": alts,
                    "risk": _risk_from_evidence(ni.get("evidence"))})
                status = "blocked"
            elif ist == "unknown":
                unknowns.append({
                    "node": node_id, "name": node["name"],
                    "kind": "unknown-interface",
                    "reason": "平台接口 %s 的鸿蒙支持性未确认（guard=%s）"
                              % (ni["name"], guard)})

        # 依赖递归
        for edge in db.out_edges(conn, node_id, RECURSE_EDGE_TYPES):
            if edge.get("platform_cond") in _SKIP_PLATFORM_CONDS:
                continue
            sub = _evaluate(conn, edge["dst"], cache, iface_map, alt_by_cat)
            if sub == "blocked":
                status = "blocked"
            elif sub == "uncertain" and status == "portable":
                status = "uncertain"
            for b in cache.blockers.get(edge["dst"], []):
                item = dict(b)
                item["path"] = [node_id] + b.get("path", [edge["dst"]])
                blockers.append(item)
            for u in cache.unknowns.get(edge["dst"], []):
                item = dict(u)
                item["path"] = [node_id] + u.get("path", [edge["dst"]])
                unknowns.append(item)
            for p in cache.platform_excluded.get(edge["dst"], []):
                item = dict(p)
                item["path"] = [node_id] + p.get("path", [edge["dst"]])
                platform_excluded.append(item)

    cache.on_stack.pop()
    for item in blockers:
        item.setdefault("path", [node_id])
    for item in unknowns:
        item.setdefault("path", [node_id])
    for item in platform_excluded:
        item.setdefault("path", [node_id])
    cache.status[node_id] = "blocked" if blockers else status
    cache.blockers[node_id] = blockers
    cache.unknowns[node_id] = unknowns
    cache.platform_excluded[node_id] = platform_excluded
    return cache.status[node_id]


def _dedupe(items: List[Dict]) -> List[Dict]:
    seen = set()
    out = []
    for it in items:
        # platform_excluded 条目无 kind 字段（见 _evaluate 中构造处），用 .get 兜底
        key = (it["node"], it.get("kind", ""), it.get("iface", ""), it["reason"])
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def analyze(conn, app_id: str) -> Dict:
    """对目标应用做可移植性判定。"""
    node = db.get_node(conn, app_id)
    if node is None:
        raise ValueError("app node not found: %s" % app_id)
    iface_map = {i["id"]: i for i in db.all_interfaces(conn)}
    # 预计算同类别替代接口索引，避免每个接口都查库
    alt_by_cat: Dict[str, List[Dict]] = {}
    for i in iface_map.values():
        if i["ohos_status"] in ("supported", "convertible"):
            alt_by_cat.setdefault(i.get("category") or "", []).append(i)
    cache = _Cache()
    _evaluate(conn, app_id, cache, iface_map, alt_by_cat)

    blockers = _dedupe(cache.blockers.get(app_id, []))
    unknowns = _dedupe(cache.unknowns.get(app_id, []))
    platform_excluded = _dedupe(cache.platform_excluded.get(app_id, []))
    verdict = ("blocked" if blockers
               else "uncertain" if unknowns else "portable")

    evidence = {"portable": "全部依赖与平台接口可鸿蒙化",
                "blocked": "存在 %d 个硬阻塞点" % len(blockers),
                "uncertain": "无硬阻塞，但有 %d 项未确认" % len(unknowns)
                }[verdict]
    if platform_excluded and verdict != "blocked":
        evidence += "；%d 个平台排除项（含功能替代分析）" % len(platform_excluded)
    db.upsert_node(conn, app_id, node["kind"], node["name"], node["source"],
                   verdict, version=node.get("version"),
                   description=node.get("description"), port_evidence=evidence,
                   cluster_id=node.get("cluster_id"))
    conn.commit()

    return {
        "app_id": app_id,
        "verdict": verdict,
        "blockers": blockers,
        "unknowns": unknowns,
        "platform_excluded": platform_excluded,
        "cycles": cache.cycles[:10],
        "stats": {"visited_nodes": len(cache.status)},
    }

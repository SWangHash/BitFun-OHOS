#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cpp20-gap-scan.py — OHOS NDK clang15/libc++15 的 C++20 缺口预检与机械修复。

背景
----
OHOS NDK 的 clang 15 / libc++ 15 缺若干 C++20 语言与库特性（详见
``problems/build-clang15-libcpp15-cpp20-gaps.md``）。大工程全量编译会反复
撞这些缺口，每轮"编译→报错→定位→修复"成本高（单工程数十分钟到数小时）。
本工具把该流程前移：**编译前静态扫描已知缺口模式**，机械可修项可自动修复。

用法
----
    python tools/cpp20-gap-scan.py scan <src_dir> [--json]
        扫描并报告；发现缺口 exit 1（CI 友好），无缺口 exit 0。
    python tools/cpp20-gap-scan.py fix <src_dir> [--apply]
        机械可修项（GAP-02）自动修复；默认 dry-run，--apply 落盘。

规则表（与 problems 页章节对应）
--------------------------------
GAP-01  lambda 捕获结构化绑定（P1091, §1）            研判
GAP-02  make_unique_for_overwrite（libc++15 缺）      自动修复
GAP-03  std::stop_token / jthread（libc++ 19+ 才有）  研判（需 shim）
GAP-04  std::atomic_ref（libc++ 19 才有）             研判（需 polyfill）
GAP-05  std::ranges:: 算法（libc++ 15 只有部分）      研判
GAP-06  defaulted operator<=> 含 shared_ptr（§7）     研判
GAP-07  纯 init-capture lambda（§1 同族，this 捕获）  研判
GAP-08  pthread_setaffinity_np（musl 无）             研判（守卫宏）

以下缺口**只能编译期发现**，本工具不覆盖（见 problems 页对应章节）：
P0634 省略 typename（§3）、P0960 圆括号聚合初始化（§2）、
allocator_traits::construct_at 实例化失败、variant __best_match（§8）。

注意：扫描是启发式的（无语义分析），GAP-01/06/07 会有少量误报，
命中后按 problems 页写法人工研判。自动修复仅覆盖语义等价性明确的项。
"""
import argparse
import json
import re
import sys
from pathlib import Path

SOURCE_EXTS = {".h", ".hpp", ".hh", ".hxx", ".cc", ".cpp", ".cxx", ".c", ".ipp", ".tpp"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".qt-ohos", "out", "build"}

# ---------------------------------------------------------------- 规则定义

# GAP-02：make_unique_for_overwrite（唯一自动修复项）
MUFO_RE = re.compile(
    r"(?<![\w:.])(?:std::)?make_unique_for_overwrite<\s*(?P<type>[^<>]+?)\s*>\s*"
    r"\(\s*(?P<args>[^()]*)\s*\)"
)

# GAP-01：结构化绑定声明（auto [a, b] = / const auto &[k, v] :）
BINDING_RE = re.compile(r"\bauto\s*(&|\&&)?\s*\[(?P<names>[^\]]+)\]\s*[=:]")
# lambda 捕获列表（后跟 ( { < ~ 标记为 lambda 而非数组下标）
LAMBDA_RE = re.compile(r"\[(?P<caps>[^\[\]]*)\]\s*[\(\{<~]")

# GAP-03：stop_token / jthread
STOPTOKEN_RE = re.compile(r"\bstd::(stop_token|stop_source|stop_callback|jthread)\b|#include\s*<stop_token>")

# GAP-04：atomic_ref
ATOMICREF_RE = re.compile(r"\bstd::atomic_ref\s*<")

# GAP-05：std::ranges::算法（常见集合）
RANGES_RE = re.compile(r"\bstd::ranges::(?P<algo>[a-zA-Z_]\w*)")
RANGES_KNOWN = {
    "any_of", "all_of", "none_of", "find", "find_if", "find_if_not",
    "count", "count_if", "sort", "stable_sort", "copy", "copy_if",
    "transform", "remove", "remove_if", "unique", "reverse", "rotate",
    "min_element", "max_element", "min", "max", "clamp", "equal",
    "lexicographical_compare", "fill", "generate", "for_each",
    "includes", "set_intersection", "set_union",
    "begin", "end", "size", "data", "empty",  # 这几个有 std:: 等价
}

# GAP-08：musl 缺失
SETAFFINITY_RE = re.compile(r"\bpthread_setaffinity_np\s*\(")

RULES = [
    ("GAP-01", "P1091", "report",
     "lambda 捕获结构化绑定（clang 16+ 才支持）：init-capture 复制或先拷成普通局部（§1）"),
    ("GAP-02", "make_unique_for_overwrite", "auto",
     "libc++15 无 make_unique_for_overwrite：数组型换 std::unique_ptr<T[]>(new T[n])（可自动修复）"),
    ("GAP-03", "stop_token/jthread", "report",
     "libc++ 19+ 才有：需自写 shim（mutex+condvar，§4）"),
    ("GAP-04", "atomic_ref", "report",
     "libc++ 19 才有：__atomic_* 透传 polyfill（§5）"),
    ("GAP-05", "std::ranges", "report",
     "先试加 -D_LIBCPP_ENABLE_EXPERIMENTAL（实测解锁 libc++15 全部 ranges 算法与 <format>，"
     "jthread/clock_cast/expected/source_location 仍缺）；不行再换 std::X(iter...) 或自带 range-v3（§6/§9）"),
    ("GAP-06", "operator<=> shared_ptr", "report",
     "P1614 未落地：defaulted <=> 含 shared_ptr 成员会隐式删除，需显式 operator==/<（§7）"),
    ("GAP-07", "init-capture this", "report",
     "纯 init-capture 的 lambda 若体内用 this/成员，需补 =（[=, name = val]）——§1 同族"),
    ("GAP-08", "pthread_setaffinity_np", "report",
     "musl 无此函数：#if defined(__GLIBC__) 守卫"),
]


# ---------------------------------------------------------------- 扫描实现

def iter_sources(root: Path):
    if root.is_file():
        yield root
        return
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in SOURCE_EXTS:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        yield p


def _binding_names(text):
    names = set()
    for m in BINDING_RE.finditer(text):
        for part in m.group("names").split(","):
            part = part.strip()
            # 去掉可能的修饰残留（正常应为纯标识符）
            ident = re.match(r"[A-Za-z_]\w*$", part)
            if ident:
                names.add(part)
    return names


def _lambda_captures_uses(caps: str, names) -> bool:
    """捕获列表里出现裸绑定名（值/引用捕获均触发 P1091；init-capture 安全）。"""
    for seg in caps.split(","):
        seg = seg.strip()
        if not seg:
            continue
        if seg in names:            # 裸名：值捕获
            return True
        if seg.startswith("&") and seg[1:].strip() in names:
            return True             # &name：引用捕获
        # name = expr 是 init-capture，安全
    return False


def _lambda_body(text: str, cap_start: int) -> str:
    """从捕获列表 `[` 起，取 lambda 体的文本（到配对 `}` 或语句边界）。"""
    depth = 0
    i = cap_start
    n = len(text)
    # 找到捕获列表的闭合 ]
    while i < n:
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                i += 1
                break
        i += 1
    # 向后找 lambda 体 `{`（越过参数表/说明符），最多看 200 字符
    brace = text.find("{", i, min(n, i + 200))
    if brace < 0:
        return ""
    depth, j = 0, brace
    while j < n:
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[brace:j + 1]
        j += 1
    return ""


# lambda 体内"隐式 this"的代理特征：this 关键字 / _、m_ 前缀成员标识符
THIS_USE_RE = re.compile(r"\bthis\b|\b_[A-Za-z]\w*\b|\bm_[A-Za-z]\w*\b")


def scan_file(path: Path):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    hits = []
    lines = text.splitlines()

    def lineno(pos):
        return text.count("\n", 0, pos) + 1

    # GAP-01：结构化绑定被 lambda 捕获（启发式）
    bnames = _binding_names(text)
    if bnames:
        for m in LAMBDA_RE.finditer(text):
            if _lambda_captures_uses(m.group("caps"), bnames):
                hits.append(("GAP-01", lineno(m.start()), m.group(0)[:60]))

    # GAP-02：make_unique_for_overwrite
    for m in MUFO_RE.finditer(text):
        hits.append(("GAP-02", lineno(m.start()), m.group(0)[:80]))

    # GAP-03：stop_token 族
    for m in STOPTOKEN_RE.finditer(text):
        hits.append(("GAP-03", lineno(m.start()), m.group(0)[:60]))

    # GAP-04：atomic_ref
    for m in ATOMICREF_RE.finditer(text):
        hits.append(("GAP-04", lineno(m.start()), m.group(0)[:60]))

    # GAP-05：std::ranges 算法
    for m in RANGES_RE.finditer(text):
        if m.group("algo") in RANGES_KNOWN:
            hits.append(("GAP-05", lineno(m.start()), m.group(0)[:60]))

    # GAP-06：operator<=> 与 shared_ptr 同文件（粗粒度，文件级一次）
    if "operator<=>" in text and "std::shared_ptr" in text:
        ln = next((i + 1 for i, l in enumerate(lines) if "operator<=>" in l), 1)
        hits.append(("GAP-06", ln, "operator<=> + shared_ptr 同文件（文件级研判）"))

    # GAP-07：纯 init-capture lambda，且体内出现 this / _、m_ 前缀成员（隐式 this）
    for m in LAMBDA_RE.finditer(text):
        caps = m.group("caps").strip()
        if not caps or "&" in caps or re.match(r"^=", caps) or "this" in caps:
            continue
        segs = [s.strip() for s in caps.split(",") if s.strip()]
        if segs and all(re.match(r"^[A-Za-z_]\w*\s*=", s) for s in segs):
            body = _lambda_body(text, m.start())
            if body and THIS_USE_RE.search(body):
                hits.append(("GAP-07", lineno(m.start()), m.group(0)[:60]))

    # GAP-08：pthread_setaffinity_np
    for m in SETAFFINITY_RE.finditer(text):
        hits.append(("GAP-08", lineno(m.start()), m.group(0)[:60]))

    # 去重（同行同规则同片段只报一次）
    seen, uniq = set(), []
    for rid, ln, frag in hits:
        key = (rid, ln)
        if key not in seen:
            seen.add(key)
            uniq.append((rid, ln, frag))
    return uniq


def cmd_scan(root: Path, as_json=False):
    all_hits = []
    for p in iter_sources(root):
        for rid, ln, frag in scan_file(p):
            all_hits.append({"rule": rid, "file": str(p), "line": ln, "fragment": frag})
    rule_meta = {r[0]: {"category": r[1], "mode": r[2], "advice": r[3]} for r in RULES}
    if as_json:
        print(json.dumps({"hits": all_hits, "rules": rule_meta}, ensure_ascii=False, indent=1))
    else:
        auto_n = sum(1 for h in all_hits if h["rule"] == "GAP-02")
        by_rule = {}
        for h in all_hits:
            by_rule[h["rule"]] = by_rule.get(h["rule"], 0) + 1
        for h in sorted(all_hits, key=lambda x: (x["file"], x["line"])):
            meta = rule_meta[h["rule"]]
            print(f"{h['rule']}  {h['file']}:{h['line']}")
            print(f"       {meta['advice']}")
            print(f"       -> {h['fragment']}")
        print(f"\n汇总: {len(all_hits)} 处（自动可修 {auto_n} / 需研判 {len(all_hits) - auto_n}）"
              f"  涉及 {len({h['file'] for h in all_hits})} 文件")
        for rid in sorted(by_rule):
            meta = rule_meta[rid]
            print(f"  {rid}: {by_rule[rid]} 处  ({meta['category']})")
        if all_hits:
            print("机械修复: python tools/cpp20-gap-scan.py fix <dir> --apply")
    return 1 if all_hits else 0


def _mugo_repl(m):
    typ, args = m.group("type").strip(), m.group("args").strip()
    if typ.endswith("[]"):
        elem = typ[:-2].strip()
        return f"std::unique_ptr<{typ}>(new {elem}[{args}])"
    call = f"({args})" if args else "()"
    return f"std::unique_ptr<{typ}>(new {typ}{call})"


def cmd_fix(root: Path, apply=False):
    total, files = 0, []
    for p in iter_sources(root):
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        new, n = MUFO_RE.subn(_mugo_repl, text)
        if n:
            total += n
            files.append((p, n))
            rel = p
            if apply:
                p.write_text(new, encoding="utf-8", newline="\n")
            preview = MUFO_RE.search(text)
            print(f"{'FIXED' if apply else 'DRY-RUN'}  {rel}  ({n} 处)")
            print(f"        例: {preview.group(0)[:70] if preview else ''}")
    mode = "已落盘" if apply else "（dry-run，加 --apply 落盘）"
    print(f"\n共修复 {total} 处 {mode}；GAP-01/03/04/05/06/07/08 需人工研判（见 problems 页）")
    return 0


def main():
    ap = argparse.ArgumentParser(description="OHOS clang15/libc++15 C++20 缺口预检与机械修复")
    ap.add_argument("mode", choices=["scan", "fix"], help="scan=只报告（CI 用 exit 1） / fix=机械修复")
    ap.add_argument("dir", help="源码目录（递归；自动跳过 .git/out/build 等）")
    ap.add_argument("--json", action="store_true", help="scan 输出 JSON")
    ap.add_argument("--apply", action="store_true", help="fix 实际落盘（默认 dry-run）")
    args = ap.parse_args()
    root = Path(args.dir)
    if not root.exists():
        print(f"目录不存在: {root}", file=sys.stderr)
        return 2
    if args.mode == "scan":
        return cmd_scan(root, args.json)
    return cmd_fix(root, args.apply)


if __name__ == "__main__":
    sys.exit(main())

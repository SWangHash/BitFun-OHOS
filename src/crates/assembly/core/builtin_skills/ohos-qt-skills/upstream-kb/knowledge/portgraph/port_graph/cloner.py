"""仓库克隆：把 GitHub 等 git 仓库 shallow clone 到 workspace/ 供扫描。

- 仅允许 http(s) URL（本地工具，防任意命令注入）
- 默认 --depth 1，避免大仓库全量历史
- 目标目录已存在（含 .git）时直接复用，不重复克隆
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Optional

from . import WORKSPACE

_NAME_RE = re.compile(r"[^a-z0-9]+")


def repo_name_from_url(url: str) -> str:
    """https://github.com/owner/Repo(.git) -> repo（归一化小写短横线）。"""
    u = url.strip().rstrip("/")
    if u.endswith(".git"):
        u = u[:-4]
    last = u.split("/")[-1] or "repo"
    return _NAME_RE.sub("-", last.lower()).strip("-") or "repo"


def validate_url(url: str) -> Optional[str]:
    """返回错误信息；合法返回 None。"""
    if not url or not re.match(r"^https?://", url.strip()):
        return "仅支持 http(s) git 地址"
    if any(ch in url for ch in (";", "&", "|", "`", "$", "\n")):
        return "URL 含非法字符"
    return None


def clone_repo(url: str, name: Optional[str] = None,
               depth: int = 1, timeout: int = 900) -> Dict:
    """shallow clone 到 workspace/<name>，并浅层初始化 submodule。

    返回 {path, cloned, reason?}。已存在则复用（cloned=False）。
    失败抛 RuntimeError。

    submodule 浅拉（--depth 1）：corpus_b 等项目的依赖清单/框架在
    submodule（corpus_b_deps、corpus_b_core），不初始化则扫描不到依赖声明
    （e2e corpus_b 复核确认）；已有克隆且 submodule 未初始化时也会补拉。
    """
    err = validate_url(url)
    if err:
        raise RuntimeError(err)
    name = name or repo_name_from_url(url)
    name = _NAME_RE.sub("-", name.lower()).strip("-") or "repo"
    target = WORKSPACE / name
    if (target / ".git").exists() or any(target.glob("*")):
        _init_submodules(target, timeout)
        return {"path": str(target), "name": name, "cloned": False,
                "reason": "目录已存在，复用本地副本"}
    target.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["git", "clone", "--depth", str(depth), url.strip(), str(target)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("git clone 超时（>%ds）: %s" % (timeout, url))
    if r.returncode != 0:
        tail = (r.stderr or "").strip().replace("\n", " ")[-400:]
        raise RuntimeError("git clone 失败: %s" % (tail or "unknown error"))
    _init_submodules(target, timeout)
    return {"path": str(target), "name": name, "cloned": True}


def _init_submodules(target: Path, timeout: int) -> None:
    """浅层初始化 submodule（无 submodule 时跳过；失败时警告，不阻断克隆）。"""
    if not (target / ".gitmodules").is_file():
        return
    # --init 必须带 -- 前缀：裸 init 会被 git 当 pathspec（回归：
    # 旧版裸 init 导致复用克隆的 submodule 永远拉不起来，
    # corpus_b 扫描范围缺失、deps 大面积漏检，且静默无报错）
    cmd = ["git", "-C", str(target), "submodule", "update", "--init",
           "--depth", "1", "--recursive"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=max(timeout, 1800))
    except (subprocess.TimeoutExpired, OSError) as e:
        # 网络受限/无 submodule 工具时降级：只扫主仓（可见警告）
        print("[cloner] submodule 初始化降级（%s）: %s" % (type(e).__name__, e),
              file=sys.stderr)
        return
    if r.returncode != 0:
        tail = (r.stderr or "").strip().replace("\n", " ")[-300:]
        print("[cloner] submodule 初始化失败（降级只扫主仓）: %s" % (tail or "unknown"),
              file=sys.stderr)

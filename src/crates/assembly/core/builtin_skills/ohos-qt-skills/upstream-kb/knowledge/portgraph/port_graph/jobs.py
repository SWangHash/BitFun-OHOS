"""后台克隆+扫描任务：异步执行、可查询进度，前端可随时刷新/后台运行。

任务状态存于进程内字典（_JOBS），由守护线程推进：
  clone(8%) -> scan(45%) -> done(100%) / error。
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Dict, Optional

from . import cloner, db, project_scanner

_JOBS: Dict[str, Dict] = {}
_LOCK = threading.Lock()


def start_clone_job(url: str, name: Optional[str] = None) -> str:
    """创建并启动一个克隆+扫描任务，返回 job_id。"""
    job_id = uuid.uuid4().hex[:8]
    with _LOCK:
        _JOBS[job_id] = {
            "id": job_id, "url": url, "status": "running",
            "stage": "clone", "percent": 5,
            "message": "正在克隆仓库…", "result": None, "error": None,
            "created": time.time(),
        }
    t = threading.Thread(target=_run, args=(job_id, url, name), daemon=True)
    t.start()
    return job_id


def get_job(job_id: str) -> Optional[Dict]:
    with _LOCK:
        j = _JOBS.get(job_id)
        return dict(j) if j else None


def list_jobs() -> list:
    with _LOCK:
        return [dict(j) for j in _JOBS.values()]


def _set(job_id: str, **kw) -> None:
    with _LOCK:
        if job_id in _JOBS:
            _JOBS[job_id].update(kw)


def _run(job_id: str, url: str, name: Optional[str]) -> None:
    try:
        _set(job_id, stage="clone", percent=8,
             message="正在 shallow clone（大仓库较慢）…")
        info = cloner.clone_repo(url, name)
        if not info.get("cloned"):
            _set(job_id, message="目录已存在，复用本地副本…")
        _set(job_id, stage="scan", percent=45,
             message="克隆完成，正在扫描源文件与依赖…")
        conn = db.connect()
        db.init_db(conn)
        try:
            scan = project_scanner.scan_project(conn, info["path"])
        finally:
            conn.close()
        _set(job_id, stage="done", status="done", percent=100,
             message="完成：%s（%d 个源文件）" % (
                 scan.get("app_id"), scan.get("sources", 0)),
             result={"clone": info, "scan": scan})
    except Exception as exc:  # noqa: BLE001
        _set(job_id, stage="error", status="error", percent=100,
             message="失败: %s" % exc, error=str(exc))

#!/usr/bin/env python3
"""Build a HarmonyOS project with ``devecocli build``: bounded, logged, with the environment table.

``devecocli build`` runs ohpm install, hvigor sync (when the configuration
changed) and the module build. The project's ``hvigor/hvigor-config.json5``
must set ``execution.daemon: false`` (template_patch.py writes it): with the
hvigor daemon on, every build after the first runs inside the daemon with the
environment variables of that first build, so a PATH or SDK fix made in
environment.tsv never reaches the build (KI-004). This script refuses a project
without that setting, applies ``environment.tsv``, streams the logs to files,
watches ``.hvigor/outputs/build-logs/build.log`` and kills the process tree when
the build exceeds ``--timeout`` or stops producing output for ``--idle-timeout``.

    python scripts/devecocli_build.py --project <app>/project [--mode debug] [--product default]

Use it as a batch_checks.py step. It builds the entry module and the modules it
depends on, prints the first ArkTS/native/packaging errors on failure, the
produced .hap files on success (the entry module's HAP first), and the matching
known issues either way. Exit codes: 0 built, 1 failed, 2 timed out.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import known_issues
import ohos_env
import template_patch

BUILD_LOG = Path(".hvigor") / "outputs" / "build-logs" / "build.log"
HVIGOR_CONFIG = Path("hvigor") / "hvigor-config.json5"
ERROR_RE = re.compile(r"\[ERROR\]|ERROR:|error:|Error:|CMake Error|BUILD FAILED|undefined (symbol|reference)", re.IGNORECASE)
NOISE_RE = re.compile(r"\[DEBUG\]")


def error_excerpt(text: str, limit: int = 25) -> list[str]:
    lines, seen = [], set()
    for line in text.splitlines():
        if NOISE_RE.search(line) or not ERROR_RE.search(line):
            continue
        line = line.strip()[:400]
        if line not in seen:
            seen.add(line)
            lines.append(line)
        if len(lines) >= limit:
            break
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", type=Path, required=True, help="HarmonyOS project root (has hvigorfile.ts)")
    parser.add_argument("--mode", default="debug", choices=["debug", "release"])
    parser.add_argument("--product", default="default")
    parser.add_argument("--env-profile", type=Path)
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--idle-timeout", type=float, default=300)
    parser.add_argument("--log-dir", type=Path, help="default <project>/.hvigor/bitfun-build")
    args = parser.parse_args(argv)
    ohos_env.utf8_console()

    project = args.project.resolve()
    if not (project / "hvigorfile.ts").is_file():
        raise SystemExit(f"{project} is not a hvigor project (no hvigorfile.ts)")
    config = project / HVIGOR_CONFIG
    if not config.is_file() or not template_patch.daemon_disabled(config.read_text(encoding="utf-8", errors="replace")):
        raise SystemExit(f"{config} does not set execution.daemon to false (KI-004): run template_patch.py --project "
                         f"{project} first")
    profile = ohos_env.app_profile(project, args.env_profile)[0]
    env = ohos_env.apply_profile(profile)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    tool = ohos_env.devecocli_path(profile, env)
    if not tool:
        raise SystemExit("devecocli not found: run env_probe.py (devecocli row)")
    command = [tool, "build", "--product", args.product, "--build-mode", args.mode]
    log_dir = (args.log_dir or project / ".hvigor" / "bitfun-build").resolve()
    build_log = project / BUILD_LOG
    started = time.time()
    print(f"devecocli_build: {' '.join(command)}", flush=True)
    result = ohos_env.run_watched(
        command, cwd=project, env=env,
        stdout_path=log_dir / "build.stdout.log", stderr_path=log_dir / "build.stderr.log",
        timeout=args.timeout, idle_timeout=args.idle_timeout or None, watch_files=[build_log],
    )
    stdout, stderr = result.stdout(), result.stderr()
    log_text = ""
    if build_log.is_file() and build_log.stat().st_mtime >= started - 1:
        log_text = ohos_env._read(build_log)
    all_haps = [path for path in project.glob("**/build/**/outputs/**/*.hap") if path.is_file()]
    haps = sorted(str(path) for path in all_haps if path.stat().st_mtime >= started - 1)
    up_to_date = False
    if result.status == "passed" and not haps and all_haps:
        # An incremental build with nothing to do does not rewrite the HAP.
        haps = [str(max(all_haps, key=lambda path: path.stat().st_mtime))]
        up_to_date = True
    # The application (entry module) HAP first: auxiliary template modules build HAPs without native code.
    entry = ohos_env.pick_entry_hap(haps)
    if entry is not None:
        haps = [str(entry)] + [hap for hap in haps if hap != str(entry)]
    errors = error_excerpt("\n".join([stdout, stderr, log_text]))
    built = result.status == "passed" and bool(haps)
    hits = known_issues.match("\n".join([*errors, result.reason, ohos_env.tail(stderr, 100), ohos_env.tail(log_text, 300)]),
                              " ".join(command)) if not built else []
    report = {
        "status": "built" if built else ("timeout" if result.status == "timeout" else "failed"),
        "exit_code": result.exit_code,
        "duration_sec": result.duration_sec,
        "timeout_reason": result.reason,
        "haps": haps,
        "up_to_date": up_to_date,
        "stdout_log": str(result.stdout_path),
        "stderr_log": str(result.stderr_path),
        "build_log": str(build_log) if log_text else "",
        "errors": errors,
        "known_issues": [{"id": hit["id"], "fix": hit["fix"]} for hit in hits],
    }
    if result.status == "passed" and not haps:
        report["errors"].insert(0, "devecocli build exited 0 but no new .hap was produced under */build/**/outputs")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    for line in report["errors"][:10]:
        print(f"error: {line}" if not line.lower().startswith("error") else line, file=sys.stderr)
    if built:
        return 0
    return 2 if result.status == "timeout" else 1


if __name__ == "__main__":
    raise SystemExit(main())

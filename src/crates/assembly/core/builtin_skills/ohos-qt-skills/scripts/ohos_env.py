#!/usr/bin/env python3
"""Shared runtime helpers: the environment table and a watched process runner.

The environment table ``<container>/migration/ohos/environment.tsv`` is written only
by ``env_probe.py``: one row per environment item (path, version, detail,
status, issue, ``command_env``). Its ``command_env`` column is the single source
of every PATH entry and variable the OHOS toolchain needs (llvm-mingw runtime
DLLs for the Qt host tools, the space-free ``NATIVE_OHOS_SDK``,
``DEVECO_HOME``/``DEVECO_SDK_HOME`` for devecocli, the DevEco JBR, ``PYTHONIOENCODING``...).
``batch_checks.py``, ``env_smoke.py``, ``devecocli_build.py``, ``deploy_qt_libs.py``,
``device_run.py``, ``closure.py`` and the feature gate apply it to every external
tool they start (never to themselves), so a problem fixed in the environment
phase stays fixed for every later build and a batch plan never needs to (and
may not) set PATH itself. :func:`load_profile` turns the table into the profile
dict those scripts read (``paths``, ``abi``, ``qt_modules``, ``env``, ``checks``,
``short_cache_dir``).

``run_watched`` runs a command with its output streamed to log files, a total
timeout and an idle timeout (no growth of the logs or of extra watched files),
and kills the whole process tree on expiry. A tool that hangs therefore turns
into a ``timeout`` receipt within minutes instead of an endless wait.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence

ENV_PROFILE = "environment.tsv"
# env_smoke.py's receipt next to environment.tsv; the phase 1 gate reads it.
ENV_SMOKE = "env-smoke.json"
# Set by batch_checks.py and env_smoke.py for every step: the environment table the step runs with.
ENV_PROFILE_VAR = "OHOS_QT_ENV_PROFILE"
# Written by template_patch.py into an output project: the environment table it was created from.
PROJECT_PROFILE_POINTER = ".ohos-qt-env"
ENV_SCHEMA = "ohos-qt-env/2"
ENV_COLUMNS = ["id", "item", "path", "version", "detail", "status", "issue", "command_env"]
# command_env: entries "NAME=value" or "PATH+=<dir>" joined by " | " (a value may hold ";" or ":").
ENV_SEPARATOR = " | "
# Profile ``paths`` keys the scripts read, and the item whose ``path`` holds them.
ITEM_PATHS = {"qt-sdk": "qt_sdk", "qt-template": "template", "deveco": "deveco_home",
              "devecocli": "devecocli", "make": "make", "llvm-mingw": "llvm_mingw_bin", "qt-source": "qt_source", "qt-host": "qt_host", "cmake": "cmake",
              "ninja": "ninja", "jbr": "jbr", "python": "python"}
IS_WINDOWS = os.name == "nt"


def _is_harmonyos() -> bool:
    """A HarmonyOS PC: the same test as bitfun-resource-root.sh (release file or os-release)."""
    if IS_WINDOWS:
        return False
    if Path("/etc/ohos-release").is_file() or Path("/etc/openharmony-release").is_file():
        return True
    try:
        text = Path("/etc/os-release").read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False
    return "openharmony" in text or "harmonyos" in text


# On a HarmonyOS PC the host is the device: no DevEco Studio (the command line tools are on PATH,
# DEVECO_SDK_HOME names the SDK) and devecocli installs and runs the app on this machine.
IS_HARMONYOS = _is_harmonyos()


# --------------------------------------------------------------------------- profile

def profile_path(migration_root: Path) -> Path:
    return Path(migration_root) / ENV_PROFILE


def source_root(migration_root: Path) -> Path | None:
    """The Qt application root of a migration: ``Qt source root`` of the STATE.md Scope.

    The ledger lives in the output container (``<container>/migration/ohos``),
    never in the Qt source tree, so the application root is recorded, not derived.
    """
    from phase_gate import SCOPE_SOURCE, scope_value  # lazy: phase_gate imports this module

    state = Path(migration_root) / "STATE.md"
    text = state.read_text(encoding="utf-8", errors="replace") if state.is_file() else ""
    value = scope_value(text, SCOPE_SOURCE)
    return Path(value) if value else None


def require_source_root(migration_root: Path, explicit: Path | None = None) -> Path:
    """``explicit`` (an ``--app`` option), else the recorded Qt source root; exits when neither exists."""
    app = explicit or source_root(migration_root)
    if app is None:
        raise SystemExit(f"ERROR: {Path(migration_root) / 'STATE.md'} records no Qt source root: run "
                         "init_migration.py --target <Qt source root> --output-project <container>")
    return Path(app).resolve()


def clean_cell(value) -> str:
    return " ".join(str(value if value is not None else "").replace("\t", " ").splitlines()).strip()


def format_command_env(entries: Sequence[tuple[str, str]]) -> str:
    """``[("PATH", dir), ("NAME", value)]`` -> ``"PATH+=dir | NAME=value"``."""
    return ENV_SEPARATOR.join(f"PATH+={value}" if name == "PATH" else f"{name}={value}" for name, value in entries)


def parse_command_env(value: str) -> list[tuple[str, str]]:
    """The inverse of :func:`format_command_env`; raises ``ValueError`` on a malformed entry."""
    entries = []
    for part in (value or "").split(ENV_SEPARATOR.strip()):
        part = part.strip()
        if not part:
            continue
        if part.startswith("PATH+="):
            entries.append(("PATH", part[len("PATH+="):].strip()))
            continue
        name, sep, rest = part.partition("=")
        if not sep or not name.strip() or not name.strip().replace("_", "").isalnum():
            raise ValueError(f"command_env entry {part!r} is neither NAME=value nor PATH+=<dir>")
        entries.append((name.strip(), rest.strip()))
    return entries


def read_environment(path: Path) -> list[dict[str, str]]:
    import csv

    with Path(path).open(newline="", encoding="utf-8-sig") as stream:
        return [{key: (value or "") for key, value in row.items() if key} for row in csv.DictReader(stream, delimiter="\t")]


def write_environment(path: Path, rows: Sequence[Mapping[str, str]]) -> None:
    """Write the table; ids follow the row order (ENV-001, ...)."""
    lines = ["\t".join(ENV_COLUMNS)]
    for number, row in enumerate(rows, 1):
        cells = {**row, "id": f"ENV-{number:03d}"}
        lines.append("\t".join(clean_cell(cells.get(column, "")) for column in ENV_COLUMNS))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    from gate_state import refresh_progress  # gate_state reads ENV_PROFILE from this module
    refresh_progress(Path(path).parent)


def profile_from_rows(rows: Sequence[Mapping[str, str]]) -> dict:
    """The profile dict the scripts read, rebuilt from the environment table."""
    items = {row.get("item", ""): row for row in rows}
    paths: dict[str, str] = {}
    for item, key in ITEM_PATHS.items():
        if items.get(item, {}).get("path"):
            paths[key] = items[item]["path"]
    path_prepend: list[str] = []
    variables: dict[str, str] = {}
    for row in rows:
        try:
            entries = parse_command_env(row.get("command_env", ""))
        except ValueError:
            entries = []
        for name, value in entries:
            if name == "PATH":
                if value and value not in path_prepend:
                    path_prepend.append(value)
            else:
                variables[name] = value
    for name, key in (("NATIVE_OHOS_SDK", "native_sdk"), ("OHOS_SDK_DIR", "ohos_sdk_dir")):
        if variables.get(name):
            paths[key] = variables[name]
    qt_detail = items.get("qt-sdk", {}).get("detail", "")
    modules = qt_detail.split("modules:", 1)[1] if "modules:" in qt_detail else ""
    host = items.get("host", {})
    return {
        "schema": ENV_SCHEMA,
        "rows": [dict(row) for row in rows],
        "items": {item: dict(row) for item, row in items.items()},
        "host": {"os": host.get("version", "")},
        "abi": variables.get("OHOS_TARGET_ARCH", "arm64-v8a"),
        "paths": paths,
        "versions": {item: row.get("version", "") for item, row in items.items() if row.get("version")},
        "qt_modules": [name.strip() for name in modules.split(",") if name.strip()],
        "short_cache_dir": host.get("path", ""),
        "env": {"path_prepend": path_prepend, "set": variables},
        "checks": [{"id": row.get("item", ""), "status": row.get("status", ""),
                    "detail": row.get("issue", "") or row.get("detail", "")} for row in rows],
    }


def load_profile(path: Path | None) -> dict | None:
    """The profile of an environment table (a file or a migration root); ``None`` when absent or empty."""
    if not path:
        return None
    path = Path(path)
    if path.is_dir():
        path = path / ENV_PROFILE
    if not path.is_file():
        return None
    try:
        rows = read_environment(path)
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return profile_from_rows(rows) if rows else None


def find_profile(*candidates: Path | None) -> Path | None:
    """First existing environment table among migration roots / files / their parents."""
    for candidate in candidates:
        if not candidate:
            continue
        candidate = Path(candidate)
        for path in (candidate, candidate / ENV_PROFILE, candidate.parent / ENV_PROFILE):
            if path.is_file() and path.name == ENV_PROFILE:
                return path.resolve()
    return None


def utf8_console() -> None:
    """Print UTF-8 whatever the console code page is (GBK pipes cannot encode tool output, KI-006)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError, OSError):
            pass


def merge_env(env: dict[str, str], extra: Mapping[str, str]) -> dict[str, str]:
    """``env`` updated with ``extra``; on Windows names are case-insensitive (no duplicate Path/PATH)."""
    for key, value in extra.items():
        key = str(key)
        if IS_WINDOWS:
            for existing in [name for name in env if name.upper() == key.upper() and name != key]:
                del env[existing]
        env[key] = str(value)
    return env


def apply_profile(profile: Mapping | None, base: Mapping[str, str] | None = None) -> dict[str, str]:
    """``base`` (default ``os.environ``) with the profile's variables and PATH prefix applied."""
    env = dict(os.environ if base is None else base)
    if not profile:
        return env
    spec = profile.get("env") or {}
    merge_env(env, {key: value for key, value in (spec.get("set") or {}).items() if value is not None})
    prepend = [str(item) for item in (spec.get("path_prepend") or []) if item]
    if prepend:
        key = next((name for name in env if name.upper() == "PATH"), "PATH")
        current = env.get(key, "")
        parts = [part for part in current.split(os.pathsep) if part]
        lowered = {os.path.normcase(os.path.normpath(p)) for p in prepend}
        parts = [part for part in parts if os.path.normcase(os.path.normpath(part)) not in lowered]
        env[key] = os.pathsep.join(prepend + parts)
    return env


def locate_profile(project: Path | None, explicit: Path | None = None) -> Path | None:
    """The environment table a tool working on ``project`` uses, in this order:
    ``--env-profile``; ``$OHOS_QT_ENV_PROFILE`` (set for every batch_checks.py
    and env_smoke.py step); the project's ``.ohos-qt-env`` pointer (written by
    template_patch.py, so an output project outside the application tree finds
    it); the nearest ``migration/ohos/environment.tsv`` above the project."""
    if explicit:
        return Path(explicit)
    if os.environ.get(ENV_PROFILE_VAR):
        return Path(os.environ[ENV_PROFILE_VAR])
    if project:
        for parent in [Path(project), *Path(project).parents]:
            pointer = parent / PROJECT_PROFILE_POINTER
            if pointer.is_file():
                target = Path(pointer.read_text(encoding="utf-8").strip())
                if target.is_file():
                    return target
            candidate = parent / "migration" / "ohos" / ENV_PROFILE
            if candidate.is_file():
                return candidate
    return None


def app_profile(project: Path | None, explicit: Path | None) -> tuple[dict | None, Path | None]:
    """``(profile, path)`` of :func:`locate_profile`; ``(None, None)`` when there is none."""
    path = locate_profile(project, explicit)
    if path is None:
        return None, None
    profile = load_profile(path)
    if profile is None:
        raise SystemExit(f"env profile {path} is not a readable environment table (environment.tsv from env_probe.py)")
    return profile, path


def profile_value(profile: Mapping | None, *keys: str, default=None):
    node = profile or {}
    for key in keys:
        if not isinstance(node, Mapping) or key not in node:
            return default
        node = node[key]
    return node


# --------------------------------------------------------------------------- machine cache

def machine_cache_dir() -> Path:
    """Per-machine cache shared by all migrations (env smoke results, closures).

    BitFun injects ``BITFUN_QT_MIGRATION_ROOT`` into every command; outside
    the app the user cache directory is used.
    """
    override = os.environ.get("OHOS_QT_SKILLS_CACHE")
    if override:
        return Path(override)
    root = os.environ.get("BITFUN_QT_MIGRATION_ROOT")
    if root:
        return Path(root) / "cache" / "ohos-qt-skills"
    if IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "ohos-qt-skills" / "cache"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "ohos-qt-skills"


# --------------------------------------------------------------------------- paths

def short_path(path: str | Path) -> str:
    """Windows 8.3 short form of an existing path (no spaces); the path itself elsewhere."""
    text = str(path)
    if not IS_WINDOWS or " " not in text:
        return text
    try:
        import ctypes
        from ctypes import wintypes

        get_short = ctypes.windll.kernel32.GetShortPathNameW  # type: ignore[attr-defined]
        get_short.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
        get_short.restype = wintypes.DWORD
        size = get_short(text, None, 0)
        if not size:
            return text
        buffer = ctypes.create_unicode_buffer(size)
        if get_short(text, buffer, size) and " " not in buffer.value:
            return buffer.value
    except Exception:  # noqa: BLE001 - best effort, the caller falls back to a junction
        pass
    return text


def make_junction(link: Path, target: Path) -> bool:
    """Directory junction (Windows) or symlink elsewhere; True when ``link`` points at ``target``."""
    link, target = Path(link), Path(target)
    if os.path.lexists(link):
        try:
            if link.exists() and os.path.samefile(link, target):
                return True
        except OSError:
            pass
        # A stale or broken alias (SDK moved or upgraded): remove only the link itself.
        try:
            if link.is_symlink() or (IS_WINDOWS and _is_junction(link)):
                os.rmdir(link) if IS_WINDOWS else link.unlink()
            else:
                return False
        except OSError:
            return False
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        if IS_WINDOWS:
            done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)],
                                  capture_output=True, text=True, timeout=30)
            return done.returncode == 0 and link.exists()
        link.symlink_to(target, target_is_directory=True)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def _is_junction(path: Path) -> bool:
    checker = getattr(os.path, "isjunction", None)
    if checker:
        return checker(path)
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT
    except (OSError, AttributeError):
        return False


def exe(name: str) -> str:
    return f"{name}.exe" if IS_WINDOWS and not name.lower().endswith(".exe") else name


# --------------------------------------------------------------------------- devecocli and HAP helpers

def devecocli_path(profile: Mapping | None, env: Mapping[str, str]) -> str | None:
    """The devecocli of environment.tsv, else the one on the command PATH."""
    return profile_value(profile, "paths", "devecocli") or shutil.which("devecocli", path=env.get("PATH"))


# Magic of the HAP signing block that hap-sign-tool inserts before the ZIP
# central directory: V2 (compatible version < 8) and V3.
HAP_SIGN_BLOCK_MAGICS = (b"HAP Sig Block 42", b"<hap sign block>")


def hap_is_signed(path: str | Path) -> bool:
    """Whether the HAP carries a signing block. The file name says nothing: hvigor's
    ``outputs/default/app/entry-default.hap`` is unsigned without "unsigned" in its name."""
    try:
        with open(path, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            tail_size = min(size, 65536 + 22)
            stream.seek(size - tail_size)
            tail = stream.read(tail_size)
            end = tail.rfind(b"PK\x05\x06")
            if end < 0 or end + 20 > len(tail):
                return False
            central_directory = int.from_bytes(tail[end + 16:end + 20], "little")
            if central_directory < 32 or central_directory > size:
                return False
            stream.seek(central_directory - 32)
            before = stream.read(32)
    except OSError:
        return False
    return any(magic in before for magic in HAP_SIGN_BLOCK_MAGICS)


def pick_entry_hap(haps: Iterable[str | Path]) -> Path | None:
    """The application HAP among a build's outputs.

    A Qt glue template also builds auxiliary modules (for example the pure
    ArkTS ``qEmbeddedUiExtensionHost``) whose HAP has no native code. Prefer
    the ``entry`` module, then a HAP that really carries a signing block, then
    the newest.
    """
    paths = [Path(hap) for hap in haps]
    if not paths:
        return None

    def rank(path: Path) -> tuple:
        parts = [part.lower() for part in path.parts]
        in_entry = "entry" in parts or path.name.lower().startswith("entry-")
        signed = hap_is_signed(path)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0.0
        return (in_entry, signed, mtime)

    return max(paths, key=rank)


# --------------------------------------------------------------------------- watched runner

@dataclass
class RunResult:
    status: str                      # passed | failed | timeout
    exit_code: int | None
    duration_sec: float
    stdout_path: Path
    stderr_path: Path
    reason: str = ""                 # why a timeout fired: total / idle
    watched: list[str] = field(default_factory=list)

    def stdout(self) -> str:
        return _read(self.stdout_path)

    def stderr(self) -> str:
        return _read(self.stderr_path)


def _read(path: Path) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def kill_tree(process: subprocess.Popen) -> None:
    """Kill ``process`` and every child it spawned (daemons included)."""
    if process.poll() is not None and not IS_WINDOWS:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
        return
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                           capture_output=True, timeout=60)
        else:
            os.killpg(process.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError, subprocess.SubprocessError):
        pass
    try:
        process.kill()
    except OSError:
        pass
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass


def _size(path: Path) -> int:
    try:
        return Path(path).stat().st_size
    except OSError:
        return -1


def _fsize(stream) -> int:
    """Exact size of a file we hold open (directory-entry sizes can lag on Windows)."""
    try:
        return os.fstat(stream.fileno()).st_size
    except (OSError, ValueError):
        return -1


def resolve_argv(argv: list[str], env: Mapping[str, str]) -> list[str]:
    """Resolve a bare program name against the PATH the command will run with.

    Windows ``CreateProcess`` (``subprocess`` without a shell) searches the
    parent's PATH, not the ``env`` passed to the child, so ``["qmake", ...]``
    failed although the environment table put the Qt SDK on PATH (WinError 2). Resolving
    here makes an argv step find exactly the tools the profile names.
    """
    if not argv:
        return argv
    program = argv[0]
    if os.path.dirname(program):
        return argv
    found = shutil.which(program, path=env.get("PATH") or env.get("Path"))
    return [found, *argv[1:]] if found else argv


def run_watched(
    command: str | Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    stdout_path: Path,
    stderr_path: Path,
    timeout: float = 1800,
    idle_timeout: float | None = None,
    watch_files: Sequence[Path] = (),
    poll: float = 1.0,
) -> RunResult:
    """Run ``command`` with logs streamed to files, a total timeout and an idle timeout.

    The idle clock restarts whenever stdout, stderr or one of ``watch_files``
    grows (for example a build tool's own log). ``idle_timeout`` of ``None`` or
    ``0`` disables it.
    """
    shell = isinstance(command, str)
    argv = command if shell else resolve_argv([str(item) for item in command], env)
    stdout_path, stderr_path = Path(stdout_path), Path(stderr_path)
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    kwargs: dict = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kwargs["start_new_session"] = True
    with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
        try:
            process = subprocess.Popen(argv, cwd=str(cwd), shell=shell, env=dict(env),
                                       stdout=out, stderr=err, stdin=subprocess.DEVNULL, **kwargs)
        except OSError as error:
            err.write(f"cannot start command: {error}\n".encode("utf-8"))
            return RunResult("failed", None, 0.0, stdout_path, stderr_path, reason=str(error))
        watched = [Path(path) for path in watch_files]
        sizes = [_fsize(out), _fsize(err)] + [_size(path) for path in watched]
        last_growth = time.time()
        reason = ""
        try:
            while True:
                code = process.poll()
                if code is not None:
                    break
                now = time.time()
                current = [_fsize(out), _fsize(err)] + [_size(path) for path in watched]
                if current != sizes:
                    sizes, last_growth = current, now
                if now - started > timeout:
                    reason = f"total timeout after {int(timeout)}s"
                elif idle_timeout and now - last_growth > idle_timeout:
                    reason = (f"idle timeout: no new output for {int(idle_timeout)}s "
                              "(the command finished its work but did not exit, or it hangs)")
                if reason:
                    kill_tree(process)
                    break
                time.sleep(poll)
        except BaseException:
            # Interrupted (Ctrl+C, error): never leave a build running in its own process group.
            kill_tree(process)
            raise
        if not reason and not IS_WINDOWS:
            # Reap daemons the command left behind in its process group.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
    duration = round(time.time() - started, 3)
    if reason:
        with stderr_path.open("a", encoding="utf-8") as stream:
            stream.write(f"\n[ohos_env] step killed: {reason}\n")
        return RunResult("timeout", None, duration, stdout_path, stderr_path, reason=reason,
                         watched=[str(path) for path in watch_files])
    status = "passed" if process.returncode == 0 else "failed"
    return RunResult(status, process.returncode, duration, stdout_path, stderr_path,
                     watched=[str(path) for path in watch_files])


def tail(text: str, lines: int = 20) -> str:
    return "\n".join(text.splitlines()[-lines:])


def python() -> str:
    return sys.executable or "python"

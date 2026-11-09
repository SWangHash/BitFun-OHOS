#!/usr/bin/env python3
"""Record a phase-gate verdict in ``STATE.md`` so the durable state follows the gate.

``phase_gate.py`` and ``validate_ledgers.py --phase`` used to print
``READY``/``NOT-READY`` only to stdout; unless the agent remembered to edit
``STATE.md`` afterwards, the navigation file (and every UI that reads it)
still showed the old phase. This module makes the gate command itself the
writer:

* always: ``- Last gate: `READY environment` @ <timestamp>`` in the Gate section
  (``NOT-READY`` verdicts include the unmet-condition count and the first one);
* on ``READY``: the gated phase's Progress row becomes ``passed``, the next phase's row becomes
  ``in-progress`` (only when it is still ``planned``), earlier phases that are
  still open become ``passed`` (gates are cumulative, so a later READY gate
  covers them), and ``Current phase`` advances to the next phase;
* always: the gated phase's Progress ``Gate`` cell gets ``READY @<timestamp>``
  or ``NOT-READY @<timestamp> (<count> unmet: <first>)``; on ``READY`` the earlier
  phases whose cell is not ``READY`` get ``READY`` too (gates are cumulative);
* always: ``Current phase`` is moved back to the first phase whose gate has
  not passed when it points past it (a hand edit cannot skip phases).

While a phase is open its Progress row follows the ledgers: ``refresh_progress``
(called after every ledger write and by the gate) sets it to ``blocked``,
``failed`` or ``in-progress`` (``phase_condition``; vocab.PROGRESS_STATUSES).
``set_feature_selection`` writes the Gate field ``Feature selection``
(feature_hooks.py).

Only lines that already exist are rewritten (``Last gate`` is inserted after
``Current phase`` when missing); an unexpected layout is left untouched and
reported as a warning instead of failing the gate. No new ledger is created.
"""
from __future__ import annotations

import csv
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Sequence

from vocab import ENV_BLOCKING_STATUSES, PHASES as PHASE_ORDER

# Progress-table labels in the STATE.md template → phase ids.
_PROGRESS_LABELS = (
    ("environment", re.compile(r"environment", re.I)),
    ("inventory", re.compile(r"inventory", re.I)),
    ("decisions", re.compile(r"decision", re.I)),
    ("features", re.compile(r"feature", re.I)),
    ("tasks", re.compile(r"task", re.I)),
    ("diagnostics", re.compile(r"diagnos", re.I)),
    ("validation", re.compile(r"validat", re.I)),
)

# Progress statuses that close a phase; never rewritten.
_TERMINAL_PROGRESS = {"passed", "accepted", "not-applicable", "skipped", "waived"}

_GATE_HEADING_RE = re.compile(r"^##\s+Gate\s*$", re.I)
_PROGRESS_HEADING_RE = re.compile(r"^##\s+Progress\s*$", re.I)
_HEADING_RE = re.compile(r"^##\s+")
_FIELD_RE = re.compile(r"^(\s*-\s*)(Current phase|Last gate)(\s*:\s*)(.*)$", re.I)
_SELECTION_FIELD_RE = re.compile(r"^(\s*-\s*Feature selection\s*:\s*)(.*?)(\r?\n)?$", re.I)
_ASSESSMENT_RE = re.compile(r"^\s*-\s*Assessment:\s*`?([A-Za-z-]+)`?", re.MULTILINE)


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _phase_of_label(label: str) -> str | None:
    # The template names the phase id in backticks; other labels fall back to keywords.
    for token in re.findall(r"`([a-z]+)`", label):
        if token in PHASE_ORDER:
            return token
    for phase, pattern in _PROGRESS_LABELS:
        if pattern.search(label):
            return phase
    return None


def _section(lines: list[str], heading: re.Pattern[str]) -> tuple[int, int] | None:
    start = next((i for i, line in enumerate(lines) if heading.match(line.strip())), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, len(lines)) if _HEADING_RE.match(lines[i])), len(lines))
    return start, end


def _current_phase(value: str) -> str | None:
    text = value.strip().strip("`").strip().lower()
    for phase in PHASE_ORDER:
        if text == phase or text.startswith(phase + " "):
            return phase
    return _phase_of_label(text)


def _progress_statuses(lines: list[str]) -> dict[str, str]:
    """Progress-table status per phase id (first row wins)."""
    statuses: dict[str, str] = {}
    section = _section(lines, _PROGRESS_HEADING_RE)
    if not section:
        return statuses
    for index in range(section[0] + 1, section[1]):
        line = lines[index]
        if not line.lstrip().startswith("|"):
            continue
        cells = line.strip().strip("|").split("|")
        if len(cells) < 2 or set(cells[0].strip()) <= {"-", ":"}:
            continue
        phase = _phase_of_label(cells[0])
        if phase is not None and phase not in statuses:
            statuses[phase] = cells[1].strip().strip("`").lower()
    return statuses


def _gate_current_phase(lines: list[str]) -> str | None:
    gate = _section(lines, _GATE_HEADING_RE)
    if not gate:
        return None
    for index in range(gate[0] + 1, gate[1]):
        match = _FIELD_RE.match(lines[index].rstrip("\r\n"))
        if match and match.group(2).lower() == "current phase":
            return _current_phase(match.group(4))
    return None


def open_phases_before(text: str, phase: str | None = None) -> tuple[str | None, list[str]]:
    """Return ``(current phase, earlier phases whose gate has not passed)``.

    Phases are compared with ``phase`` when given, else with STATE.md's
    ``Current phase``. A phase passes only through a READY gate, which marks
    its Progress row ``passed``.
    """
    lines = text.splitlines(keepends=True)
    current = _gate_current_phase(lines)
    target = phase or current
    if target not in PHASE_ORDER:
        return current, []
    statuses = _progress_statuses(lines)
    limit = PHASE_ORDER.index(target)
    open_phases = [
        name for name in PHASE_ORDER[:limit]
        if statuses.get(name, "") not in _TERMINAL_PROGRESS
    ]
    return current, open_phases


def _summarize(errors: Sequence[str]) -> str:
    first = errors[0].replace("`", "'").replace("|", "/").strip() if errors else ""
    if len(first) > 160:
        first = first[:157] + "..."
    return f"{len(errors)} unmet: {first}" if first else f"{len(errors)} unmet"


def _rewrite_progress(lines: list[str], gated: str, nxt: str | None) -> None:
    section = _section(lines, _PROGRESS_HEADING_RE)
    if not section:
        return
    for index in range(section[0] + 1, section[1]):
        line = lines[index]
        if not line.lstrip().startswith("|"):
            continue
        cells = line.strip().strip("|").split("|")
        if len(cells) < 2 or set(cells[0].strip()) <= {"-", ":"}:
            continue
        phase = _phase_of_label(cells[0])
        status = cells[1].strip().strip("`").lower()
        if phase is None:
            continue
        before_gated = PHASE_ORDER.index(phase) < PHASE_ORDER.index(gated)
        if phase == gated and status not in _TERMINAL_PROGRESS:
            cells[1] = " passed "
        elif before_gated and status not in _TERMINAL_PROGRESS:
            # A later gate is READY, so earlier phases are over even if their
            # own gates were never recorded (e.g. the agent moved on by hand).
            cells[1] = " passed "
        elif phase == nxt and status in {"planned", "todo", ""}:
            cells[1] = " in-progress "
        else:
            continue
        newline = "\n" if line.endswith("\n") else ""
        lines[index] = "|" + "|".join(cells) + "|" + newline


def _write_gate_cells(lines: list[str], gated: str, cell: str, ready: bool) -> None:
    """Progress ``Gate`` column: the gated phase's verdict; a READY gate also covers earlier phases."""
    section = _section(lines, _PROGRESS_HEADING_RE)
    if not section:
        return
    for index in range(section[0] + 1, section[1]):
        line = lines[index]
        if not line.lstrip().startswith("|"):
            continue
        cells = line.strip().strip("|").split("|")
        phase = _phase_of_label(cells[0]) if len(cells) >= 2 else None
        if phase is None:
            continue
        while len(cells) < 3:
            cells.append(" ")
        earlier = ready and PHASE_ORDER.index(phase) < PHASE_ORDER.index(gated)
        if phase == gated or (earlier and not cells[2].strip().startswith("READY")):
            cells[2] = f" {cell} "
            newline = "\n" if line.endswith("\n") else ""
            lines[index] = "|" + "|".join(cells) + "|" + newline


def _rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8-sig") as stream:
        return [{key: (value or "").strip() for key, value in row.items() if key}
                for row in csv.DictReader(stream, delimiter="\t")]


def feature_selection(text: str) -> str:
    """The Gate field ``Feature selection``: ``pending`` (the user was asked), ``answered`` or empty."""
    for line in text.splitlines():
        match = _SELECTION_FIELD_RE.match(line)
        if match:
            word = re.match(r"`?([a-z]+)", match.group(2).strip().lower())
            return word.group(1) if word and word.group(1) in {"pending", "answered"} else ""
    return ""


def phase_condition(root: Path, text: str, phase: str) -> str:
    """Progress status of the open ``phase`` from the ledgers and STATE.md ``text``.

    ``blocked``: waiting for the user (Assessment blocked or not-recommended, a
    blocked TASK row, problem or feature, or the feature selection asked and not
    answered); ``failed``: a problem the agent is fixing (a broken environment
    item or smoke test, an open problem, a failed HAP check or scenario, a failed
    feature exit); otherwise ``in-progress``.
    """
    from ohos_env import ENV_PROFILE, ENV_SMOKE

    def statuses(name: str) -> list[str]:
        return [row.get("status", "") for row in _rows(root / name)]

    features = _rows(root / "features.tsv")
    match = _ASSESSMENT_RE.search(text)
    assessment = match.group(1).lower() if match else ""
    if (assessment in {"blocked", "not-recommended"}
            or "blocked" in statuses("tasks.tsv") + statuses("diagnostics.tsv") + [row.get("status", "") for row in features]
            or (phase == "features" and feature_selection(text) == "pending")):
        return "blocked"
    try:
        smoke = json.loads((root / ENV_SMOKE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        smoke = None
    if (any(status in ENV_BLOCKING_STATUSES for status in statuses(ENV_PROFILE))
            or (isinstance(smoke, dict) and smoke.get("status") != "passed")
            or "open" in statuses("diagnostics.tsv")
            or "hap-failed" in statuses("device-runs.tsv")
            or "failed" in statuses("validation.tsv")
            or any(row.get("status") == "in-progress" and row.get("exit_gate", "").startswith("NOT-READY")
                   for row in features)):
        return "failed"
    return "in-progress"


def _apply_condition(lines: list[str], root: Path) -> None:
    """Set the Progress row of ``Current phase`` to its phase_condition (a closed phase is left alone)."""
    current = _gate_current_phase(lines)
    section = _section(lines, _PROGRESS_HEADING_RE)
    if current is None or not section:
        return
    for index in range(section[0] + 1, section[1]):
        line = lines[index]
        if not line.lstrip().startswith("|"):
            continue
        cells = line.strip().strip("|").split("|")
        if len(cells) < 2 or _phase_of_label(cells[0]) != current:
            continue
        status = cells[1].strip().strip("`").lower()
        if status in _TERMINAL_PROGRESS:
            return
        wanted = phase_condition(root, "".join(lines), current)
        if status != wanted:
            cells[1] = f" {wanted} "
            newline = "\n" if line.endswith("\n") else ""
            lines[index] = "|" + "|".join(cells) + "|" + newline
        return


def _replace(state: Path, text: str, updated: str) -> str | None:
    """Write ``updated`` over STATE.md when it differs from ``text``; returns an error or ``None``."""
    if updated == text:
        return None
    try:
        fd, tmp = tempfile.mkstemp(prefix=".STATE.", suffix=".tmp", dir=str(state.parent))
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(updated)
        os.replace(tmp, state)
    except OSError as error:
        return f"cannot write STATE.md ({error})"
    return None


def refresh_progress(root: Path) -> None:
    """Recompute the open phase's Progress status after a ledger write (no-op without STATE.md)."""
    state = Path(root) / "STATE.md"
    try:
        text = state.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return
    lines = text.splitlines(keepends=True)
    _apply_condition(lines, Path(root))
    _replace(state, text, "".join(lines))


def set_feature_selection(root: Path, value: str) -> None:
    """Write the Gate field ``Feature selection`` (``pending``, or ``answered`` with the user's words)."""
    state = Path(root) / "STATE.md"
    try:
        text = state.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return
    lines = text.splitlines(keepends=True)
    gate = _section(lines, _GATE_HEADING_RE)
    if not gate:
        return
    for index in range(gate[0] + 1, gate[1]):
        match = _SELECTION_FIELD_RE.match(lines[index])
        if match:
            lines[index] = f"{match.group(1)}{value}{match.group(3) or ''}"
            break
    else:
        last = max((i for i in range(gate[0] + 1, gate[1]) if lines[i].strip()), default=gate[0])
        ending = "\r\n" if lines[last].endswith("\r\n") else "\n"
        lines.insert(last + 1, f"- Feature selection: {value}{ending}")
    _apply_condition(lines, Path(root))
    _replace(state, text, "".join(lines))


def record_gate(root: Path, phase: str, errors: Sequence[str], tool: str) -> str | None:
    """Write the verdict into ``root/STATE.md``. Returns a warning, or ``None``."""
    state = root / "STATE.md"
    if not state.is_file():
        return f"gate not recorded: {state} does not exist"
    try:
        text = state.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return f"gate not recorded: cannot read STATE.md ({error})"

    lines = text.splitlines(keepends=True)
    gate = _section(lines, _GATE_HEADING_RE)
    if not gate:
        return "gate not recorded: STATE.md has no '## Gate' section"

    ready = not errors
    stamp = _now()
    verdict = f"`{'READY' if ready else 'NOT-READY'} {phase}` @ {stamp} via {tool}"
    if not ready:
        verdict += f" ({_summarize(errors)})"

    index_of = {name: PHASE_ORDER.index(name) for name in PHASE_ORDER}
    nxt = PHASE_ORDER[index_of[phase] + 1] if ready and index_of[phase] + 1 < len(PHASE_ORDER) else None

    fields: dict[str, int] = {}
    for index in range(gate[0] + 1, gate[1]):
        match = _FIELD_RE.match(lines[index].rstrip("\r\n"))
        if match:
            fields[match.group(2).lower()] = index

    def set_field(key: str, value: str) -> None:
        index = fields.get(key)
        if index is None:
            return
        match = _FIELD_RE.match(lines[index].rstrip("\r\n"))
        assert match
        ending = lines[index][len(lines[index].rstrip("\r\n")):] or "\n"
        lines[index] = f"{match.group(1)}{match.group(2)}{match.group(3)}{value}{ending}"

    if "last gate" in fields:
        set_field("last gate", verdict)
    else:
        anchor = fields.get("current phase", gate[0])
        ending = "\r\n" if lines[anchor].endswith("\r\n") else "\n"
        lines.insert(anchor + 1, f"- Last gate: {verdict}{ending}")
        fields = {key: (i + 1 if i > anchor else i) for key, i in fields.items()}
        fields["last gate"] = anchor + 1

    if ready:
        current_index = fields.get("current phase")
        if current_index is not None:
            match = _FIELD_RE.match(lines[current_index].rstrip("\r\n"))
            current = _current_phase(match.group(4)) if match else None
            target = nxt or phase
            if current is None or index_of[current] < index_of[target]:
                set_field("current phase", f"`{target}`")
        _rewrite_progress(lines, phase, nxt)
    _write_gate_cells(lines, phase, f"READY @{stamp}" if ready else f"NOT-READY @{stamp} ({_summarize(errors)})", ready)

    # Current phase never points past a phase whose gate has not passed: an
    # agent that edits it by hand to skip phases is moved back here.
    note = None
    current_index = fields.get("current phase")
    if current_index is not None:
        current, open_phases = open_phases_before("".join(lines))
        if open_phases:
            set_field("current phase", f"`{open_phases[0]}`")
            note = (f"Current phase reset from `{current}` to `{open_phases[0]}`: "
                    f"not passed yet: {', '.join(open_phases)}")

    _apply_condition(lines, root)
    error = _replace(state, text, "".join(lines))
    return f"gate not recorded: {error}" if error else note

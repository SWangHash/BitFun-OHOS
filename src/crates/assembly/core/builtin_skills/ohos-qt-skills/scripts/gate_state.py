#!/usr/bin/env python3
"""Record a phase-gate verdict in ``STATE.md`` so the durable state follows the gate.

``phase_gate.py`` and ``validate_ledgers.py --phase`` used to print
``READY``/``BLOCKED`` only to stdout; unless the agent remembered to edit
``STATE.md`` afterwards, the navigation file (and every UI that reads it)
still showed the old phase. This module makes the gate command itself the
writer:

* always: ``- Last gate: `READY baseline` @ <timestamp>`` in the Gate section
  (``BLOCKED`` verdicts include the unmet-condition count and the first one);
* on ``READY``: ``Last updated``/``Last completed action`` are refreshed, the
  gated phase's Progress row becomes ``passed``, the next phase's row becomes
  ``in-progress`` (only when it is still ``planned``), earlier phases that are
  still open become ``passed`` (gates are cumulative, so a later READY gate
  covers them), and ``Current phase`` advances to the next phase;
* always: ``Current phase`` is moved back to the first phase whose gate has
  not passed when it points past it (a hand edit cannot skip phases).

Only lines that already exist are rewritten (``Last gate`` is inserted after
``Current phase`` when missing); an unexpected layout is left untouched and
reported as a warning instead of failing the gate. No new ledger is created.
"""
from __future__ import annotations

import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Sequence

# Same order as phase_gate.PHASES; duplicated to keep this module import-free.
PHASE_ORDER = ("baseline", "inventory", "contract", "pilot", "implementation", "features", "diagnostics", "handoff")

# Progress-table labels in the STATE.md template → phase ids.
_PROGRESS_LABELS = (
    ("baseline", re.compile(r"baseline|kb snapshot|knowledge|environment", re.I)),
    ("inventory", re.compile(r"inventory|compatib", re.I)),
    ("contract", re.compile(r"contract|feasib|assessment", re.I)),
    ("pilot", re.compile(r"pilot", re.I)),
    ("features", re.compile(r"harmonyos feature|feature adapt|feature adoption", re.I)),
    ("implementation", re.compile(r"capability|queue|implement|slice", re.I)),
    ("diagnostics", re.compile(r"diagnos", re.I)),
    ("handoff", re.compile(r"handoff|verification|validat|deliver", re.I)),
)

# Progress statuses that close a phase; never rewritten.
_TERMINAL_PROGRESS = {"passed", "accepted", "not-applicable", "skipped", "waived"}

_GATE_HEADING_RE = re.compile(r"^##\s+Gate\s*$", re.I)
_PROGRESS_HEADING_RE = re.compile(r"^##\s+Progress\s*$", re.I)
_HEADING_RE = re.compile(r"^##\s+")
_FIELD_RE = re.compile(r"^(\s*-\s*)(Current phase|Last updated|Last completed action|Last gate)(\s*:\s*)(.*)$", re.I)


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _phase_of_label(label: str) -> str | None:
    # The template names the phase id in backticks; older labels fall back to keywords.
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
    its Progress row ``passed``; phases without a Progress row (older
    templates) are not checked.
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
        if name in statuses and statuses[name] not in _TERMINAL_PROGRESS
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
    verdict = f"`{'READY' if ready else 'BLOCKED'} {phase}` @ {stamp} via {tool}"
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
        set_field("last updated", f"`{stamp[:10]}`")
        set_field("last completed action", f"`{phase}` gate READY ({tool}, {stamp})")
        current_index = fields.get("current phase")
        if current_index is not None:
            match = _FIELD_RE.match(lines[current_index].rstrip("\r\n"))
            current = _current_phase(match.group(4)) if match else None
            target = nxt or phase
            if current is None or index_of[current] < index_of[target]:
                set_field("current phase", f"`{target}`")
        _rewrite_progress(lines, phase, nxt)

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

    updated = "".join(lines)
    if updated == text:
        return note
    try:
        fd, tmp = tempfile.mkstemp(prefix=".STATE.", suffix=".tmp", dir=str(root))
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(updated)
        os.replace(tmp, state)
    except OSError as error:
        return f"gate not recorded: cannot write STATE.md ({error})"
    return note

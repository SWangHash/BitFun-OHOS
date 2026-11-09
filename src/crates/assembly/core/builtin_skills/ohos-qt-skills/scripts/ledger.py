#!/usr/bin/env python3
"""Read and write the migration ledgers and STATE.md; the agent never opens them itself.

Every read, add and update of a TSV ledger and of STATE.md goes through this
command (or the script that owns the ledger), never through the agent's
Read/Edit/Write tools or a shell ``Get-Content``: hand edits lose or gain tabs,
use the wrong id prefix, and whole-file reads fill the context. Writes are
checked on the spot; one ``--set`` per column::

    ledger.py add <root> inventory.tsv --set category=qt-module --set "location=build-file: src/a.pro:7" \
        --set "found_by=preflight: PF-QT-MODULE-01" ...
    ledger.py add <root> tasks.tsv --set task="..." --set inventory_ids=INV-003 --set validation_ids=VAL-003
    ledger.py add <root> decisions.tsv --set "question=..." [--set "answer=..." --set owner=user]
    ledger.py update <root> validation.tsv VAL-004 --set status=passed --set evidence="batch app-2: ..."
    ledger.py update <root> tasks.tsv TASK-002 --set status=passed --set "evidence=batch task-002-3 passed"
    ledger.py update <root> tasks.tsv TASK-002 --append evidence="; DIAG-007 fixed"
    ledger.py get <root> inventory.tsv INV-003 [INV-004 ...]
    ledger.py list <root> tasks.tsv [--where status=planned,in-progress] [--where status!=passed] \
        [--columns id,task,status] [--limit 20]
    ledger.py columns decisions.tsv
    ledger.py state <root>        # STATE.md + live views: environment, env smoke, capability dispositions,
                                  # decisions, features, knowledge
    ledger.py state <root> --set "Next executable action=..." [--set "Assessment=ready"] \
        [--set "Verdict basis=..."] [--set "Deciding risk=..."] [--set "Completion tier=..."] \
        [--scope "HarmonyOS output project=D:/out/app-ohos"] [--evidence "HarmonyOS output project=user request"]

``get``/``list`` read any ledger, also the script-owned ones; never load a whole ledger into the conversation.

Each ledger keeps its own rows' state; nothing is closed on another ledger's
behalf. Inventory rows have no status: they are final once the inventory
phase ends, and what became of one is the state of the TASK rows that name
it. A TASK row is closed with ``update`` (``status`` and ``evidence`` in the
same call); each VAL row gets its own status and evidence with ``update`` once
that scenario was checked. Rows are never deleted: a TASK or VAL row recorded
by mistake is set to ``not-applicable`` with the reason in its evidence; an
inventory row recorded by mistake is closed through its TASK row the same way.

``<root>`` is ``<container>/migration/ohos``. ``add`` without ``--id`` takes the next
free id of the ledger's prefix (INV-NNN, TASK-NNN, VAL-NNN,
DEC-NNN). Diagnostics go through ``record_diagnostic.py``/``batch_checks.py``,
``environment.tsv`` through ``env_probe.py``, ``device-runs.tsv`` (the one
row of the application HAP) through ``batch_checks.py`` and ``device_run.py run --record``,
``features.tsv`` through ``feature_hooks.py``/``feature_gate.py``.

A fact lives in one place. STATE.md keeps only what no ledger holds; ``state``
prints it together with live views of the ledgers (environment, env smoke,
capability dispositions, decisions, external features, knowledge baseline), so
nothing is copied from a TSV into a document. ``state`` writes only the STATE.md fields the agent owns:
``Assessment``, ``Verdict basis``, ``Deciding risk``, ``Completion tier``,
``Next executable action`` and the Scope table (application target, Qt source root,
output project); ``Current phase``, ``Last
gate`` and the Progress status are
written by the gate (``validate_ledgers.py --phase``), and every ledger write
refreshes the open phase's Progress (blocked / failed / in-progress,
gate_state.refresh_progress); ``Feature selection`` by ``feature_hooks.py``.
``report.md`` is a prose document the agent writes itself.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

from gate_state import _GATE_HEADING_RE, _section, refresh_progress
from vocab import ASSESSMENTS, COMPLETION_TIERS, DEVICE_RUN_ID, DEVICE_RUN_STATUSES, QUEUE_CLOSE_STATUSES as QUEUE_CLOSED

TEMPLATES = Path(__file__).resolve().parent.parent / "assets" / "templates" / "migration" / "ohos"
# The meaning, values and writer of every ledger column (printed by `columns`).
COLUMN_DICTIONARY = Path(__file__).resolve().parent.parent / "assets" / "ledger-columns.tsv"
PREFIXES = {
    "inventory.tsv": ("INV-", "INV-"),
    "tasks.tsv": ("TASK-", "TASK-"),
    "validation.tsv": ("VAL-", "VAL-"),
    "decisions.tsv": ("DEC-", "DEC-"),
    "device-runs.tsv": ("DEV-RUN-", "DEV-RUN-"),
}
SCRIPT_OWNED = {
    "environment.tsv": "env_probe.py (the whole table, one row per environment item)",
    "diagnostics.tsv": "record_diagnostic.py or batch_checks.py",
    "device-runs.tsv": "batch_checks.py (hap_check.py result) and device_run.py run --record (one row)",
    "features.tsv": "feature_hooks.py / feature_gate.py",
    "knowledge-manifest.tsv": "sync_knowledge.py / mark_knowledge_used.py",
}


class LedgerError(SystemExit):
    pass


def clean(value: str) -> str:
    """One TSV cell: tabs and line breaks become spaces."""
    return re.sub(r"[\t\r\n]+", " ", str(value)).strip()


def read_ledger(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        template = TEMPLATES / path.name
        if not template.is_file():
            raise LedgerError(f"{path} does not exist and has no template")
        with template.open(newline="", encoding="utf-8") as stream:
            header = next(csv.reader(stream, delimiter="\t"), [])
        return header, []
    # utf-8-sig: a ledger saved by Notepad/Excel starts with a BOM that would hide the "id" column.
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.reader(stream, delimiter="\t")
        header = next(reader, [])
        rows = []
        for number, line in enumerate(reader, 2):
            if not line:
                continue
            if len(line) != len(header):
                raise LedgerError(f"{path.name} line {number} has {len(line)} columns, header has {len(header)}; "
                                  "fix that row first (validate_ledgers.py shows all of them)")
            rows.append(dict(zip(header, line)))
    return header, rows


def write_ledger(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as stream:
        # Same dialect as record_diagnostic.py and the readers (csv default quoting).
        writer = csv.writer(stream, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow([clean(row.get(column, "")) for column in header])
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            refresh_progress(path.parent)
            return
        except PermissionError:
            if attempt == 4:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise LedgerError(f"cannot write {path}: the file is locked (close it in Excel/editors) and retry")
            time.sleep(0.5)


def parse_sets(items: list[str] | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise LedgerError(f"--set/--append expects column=value, got {item!r}")
        key, value = item.split("=", 1)
        values[key.strip()] = value
    return values


def ensure_columns(name: str, header: list[str], rows: list[dict[str, str]], columns: list[str]) -> list[str]:
    unknown = [column for column in columns if column not in header]
    if unknown:
        raise LedgerError(f"{name} has no column(s) {', '.join(unknown)}; columns: {', '.join(header)}")
    return header


def next_id(name: str, rows: list[dict[str, str]]) -> str:
    _, prefix = PREFIXES[name]
    pattern = re.compile(re.escape(prefix) + r"(\d+)$")
    numbers = [int(match.group(1)) for row in rows if (match := pattern.match(row.get("id", "").strip()))]
    return f"{prefix}{max(numbers, default=0) + 1:03d}"


def check_name(name: str) -> None:
    if name in SCRIPT_OWNED:
        raise LedgerError(f"{name} is written by {SCRIPT_OWNED[name]}, not by ledger.py")
    if name not in PREFIXES:
        raise LedgerError(f"unknown ledger {name}; one of {', '.join(sorted(PREFIXES))}")


def add_row(root: Path, name: str, values: dict[str, str], row_id: str | None = None,
            script_owner: bool = False) -> str:
    """Append a row; ``script_owner`` is for the script that owns a script-owned ledger."""
    if not script_owner:
        check_name(name)
    path = root / name
    header, rows = read_ledger(path)
    header = ensure_columns(name, header, rows, list(values))
    row_id = row_id or values.pop("id", None) or next_id(name, rows)
    required, _ = PREFIXES[name]
    if not row_id.startswith(required):
        raise LedgerError(f"{name} ids start with {required}; got {row_id}")
    if any(row.get("id", "").strip() == row_id for row in rows):
        raise LedgerError(f"{row_id} already exists in {name}; use update")
    row = {column: "" for column in header}
    row.update({key: clean(value) for key, value in values.items()})
    row["id"] = row_id
    rows.append(row)
    write_ledger(path, header, rows)
    return row_id


def update_row(root: Path, name: str, row_id: str, values: dict[str, str] | None = None,
               append: dict[str, str] | None = None, allow_script_owned: bool = False) -> dict[str, str]:
    if not allow_script_owned:
        check_name(name)
    path = root / name
    header, rows = read_ledger(path)
    header = ensure_columns(name, header, rows, list(values or {}) + list(append or {}))
    row = next((item for item in rows if item.get("id", "").strip() == row_id), None)
    if row is None:
        raise LedgerError(f"{row_id} is not in {name}")
    for key, value in (values or {}).items():
        row[key] = clean(value)
    for key, value in (append or {}).items():
        current = row.get(key, "").strip()
        row[key] = clean(f"{current} {value}".strip() if current and current.upper() != "TODO" else value)
    write_ledger(path, header, rows)
    return row


def read_hap_row(root: Path) -> dict[str, str] | None:
    """The one device-runs.tsv row (the application HAP's latest result), None when there is none."""
    path = root / "device-runs.tsv"
    if not path.is_file():
        return None
    _, rows = read_ledger(path)
    return rows[-1] if rows else None


def record_hap(root: Path, values: dict[str, str]) -> str:
    """Overwrite device-runs.tsv with its one row (batch_checks.py / device_run.py only)."""
    name = "device-runs.tsv"
    path = root / name
    header, _ = read_ledger(path)
    template, _ = read_ledger(TEMPLATES / name)
    if header != template:
        raise LedgerError(f"{name} has an older header ({', '.join(header)}); replace it with the template's "
                          f"({', '.join(template)}) and rerun")
    if values.get("status") not in DEVICE_RUN_STATUSES:
        raise LedgerError(f"{name} status must be one of {', '.join(DEVICE_RUN_STATUSES)}")
    row = {column: "" for column in header}
    row.update({key: clean(value) for key, value in values.items() if key in header})
    row["id"] = DEVICE_RUN_ID
    write_ledger(path, header, [row])
    return DEVICE_RUN_ID


def note_batch(root: Path, ids: list[str], receipt: str, passed: bool) -> list[str]:
    """Called by batch_checks.py: mark the worked TASK rows in progress with the last batch receipt."""
    path = root / "tasks.tsv"
    if not path.is_file():
        return []
    header, rows = read_ledger(path)
    touched = []
    for row in rows:
        if row.get("id", "").strip() not in ids:
            continue
        status = row.get("status", "").strip()
        if status in QUEUE_CLOSED:
            continue
        if status in {"planned", ""}:
            row["status"] = "in-progress"
        evidence = re.sub(r"\s*\[last batch [^\]]*\]", "", row.get("evidence", "")).strip()
        marker = f"[last batch {receipt} {'passed' if passed else 'failed'}]"
        row["evidence"] = clean(f"{evidence} {marker}" if evidence and evidence.upper() != "TODO" else marker)
        touched.append(row.get("id", ""))
    if touched:
        write_ledger(path, header, rows)
    return touched


# --------------------------------------------------------------------------- reading

def column_dictionary(name: str) -> list[dict[str, str]]:
    with COLUMN_DICTIONARY.open(newline="", encoding="utf-8") as stream:
        return [row for row in csv.DictReader(stream, delimiter="\t") if row["ledger"] == name]


def expand_values(spec: str) -> str:
    """``vocab.NAME | extra`` -> the sorted values of vocab.NAME plus the extras."""
    import vocab

    words: list[str] = []
    for part in spec.replace("|", " ").split():
        if part.startswith("vocab."):
            value = getattr(vocab, part[len("vocab."):])
            words.extend(sorted(value) if isinstance(value, (set, frozenset)) else value)
        else:
            words.append(part)
    return " ".join(dict.fromkeys(words))


def describe_columns(name: str) -> str:
    """The header line, then one line per column: meaning, allowed values, writer."""
    entries = column_dictionary(name)
    if not entries:
        raise LedgerError(f"unknown ledger {name}; one of {', '.join(sorted(set(PREFIXES) | set(SCRIPT_OWNED)))}")
    template = TEMPLATES / name
    if template.is_file():
        header, _ = read_ledger(template)
    else:
        header = [entry["column"] for entry in entries]
    by_column = {entry["column"]: entry for entry in entries}
    lines = ["\t".join(header)]
    for column in header:
        entry = by_column.get(column, {})
        text = f"  {column}: {entry.get('meaning', '')}"
        if entry.get("values"):
            text += f" [values: {expand_values(entry['values'])}]"
        if entry.get("written_by"):
            text += f" (written by {entry['written_by']})"
        lines.append(text)
    return "\n".join(lines)


def parse_where(items: list[str] | None) -> list[tuple[str, bool, set[str]]]:
    """``col=a,b`` (one of) and ``col!=a,b`` (none of); values compare case-insensitively."""
    filters = []
    for item in items or []:
        match = re.match(r"^\s*([^!=\s]+)\s*(!?=)\s*(.*)$", item)
        if not match:
            raise LedgerError(f"--where expects column=value[,value] or column!=value, got {item!r}")
        values = {value.strip().lower() for value in match.group(3).split(",")}
        filters.append((match.group(1), match.group(2) == "=", values))
    return filters


def select_rows(root: Path, name: str, where: list[str] | None = None, columns: list[str] | None = None,
                limit: int = 0) -> tuple[int, list[dict[str, str]]]:
    header, rows = read_ledger(root / name)
    filters = parse_where(where)
    unknown = [column for column, _, _ in filters if column not in header]
    unknown += [column for column in columns or [] if column not in header]
    if unknown:
        raise LedgerError(f"{name} has no column(s) {', '.join(dict.fromkeys(unknown))}; columns: {', '.join(header)}")
    selected = [row for row in rows
                if all((row.get(column, "").strip().lower() in values) == wanted for column, wanted, values in filters)]
    total = len(selected)
    if limit > 0:
        selected = selected[:limit]
    if columns:
        selected = [{column: row.get(column, "") for column in columns} for row in selected]
    return total, selected


# --------------------------------------------------------------------------- STATE.md

STATE_FILE = "STATE.md"
# Gate fields the agent owns; the others are written by the gate scripts.
AGENT_GATE_FIELDS = {"assessment": "Assessment", "verdict basis": "Verdict basis", "deciding risk": "Deciding risk",
                     "completion tier": "Completion tier", "next executable action": "Next executable action"}
GATE_OWNED_FIELDS = {"current phase", "last gate"}
_ANY_FIELD_RE = re.compile(r"^(\s*-\s*)([^:]+?)(\s*:\s*)(.*)$")
_SCOPE_HEADING_RE = re.compile(r"^##\s+Scope", re.I)


def _read_state(root: Path) -> list[str]:
    path = root / STATE_FILE
    if not path.is_file():
        raise LedgerError(f"{path} does not exist: run init_migration.py first")
    return path.read_text(encoding="utf-8-sig").splitlines(keepends=True)


def _write_state(root: Path, lines: list[str]) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".STATE.", suffix=".tmp", dir=str(root))
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
        stream.write("".join(lines))
    os.replace(tmp, root / STATE_FILE)
    refresh_progress(root)


def _cells(line: str) -> list[str] | None:
    if not line.lstrip().startswith("|"):
        return None
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    if not cells or set(cells[0]) <= {"-", ":"}:
        return None
    return cells


def _row_line(cells: list[str], ending: str) -> str:
    return "| " + " | ".join(clean(cell).replace("|", "/") for cell in cells) + " |" + ending


def _table_rows(lines: list[str], heading: re.Pattern[str]) -> list[tuple[int, list[str]]]:
    section = _section(lines, heading)
    if not section:
        return []
    rows = [(index, cells) for index in range(section[0] + 1, section[1]) if (cells := _cells(lines[index]))]
    return rows[1:]  # drop the header row


def _set_gate_field(lines: list[str], key: str, value: str) -> None:
    key = key.strip().lower()
    if key in GATE_OWNED_FIELDS:
        raise LedgerError(f"'{key}' is written by the gate (validate_ledgers.py --phase <phase>), not by hand")
    if key not in AGENT_GATE_FIELDS:
        raise LedgerError(f"STATE.md has no agent field '{key}'; one of: {', '.join(AGENT_GATE_FIELDS.values())}")
    value = clean(value)
    if key in {"assessment", "completion tier"}:
        word, _, note = value.partition(" ")
        if key == "assessment" and word.strip("`").lower() not in ASSESSMENTS:
            raise LedgerError(f"Assessment must be one of {', '.join(ASSESSMENTS)}, got {word!r}")
        if key == "completion tier" and word.strip("`").lower() not in COMPLETION_TIERS:
            raise LedgerError(f"Completion tier must be one of {', '.join(COMPLETION_TIERS)} (weakest to strongest), "
                              f"got {word!r}")
        value = f"`{word.strip('`')}`" + (f" {note.strip()}" if note.strip() else "")
    gate = _section(lines, _GATE_HEADING_RE)
    if not gate:
        raise LedgerError("STATE.md has no '## Gate' section")
    for index in range(gate[0] + 1, gate[1]):
        match = _ANY_FIELD_RE.match(lines[index].rstrip("\r\n"))
        if match and match.group(2).strip().lower() == key:
            ending = lines[index][len(lines[index].rstrip("\r\n")):] or "\n"
            lines[index] = f"{match.group(1)}{match.group(2)}{match.group(3)}{value}{ending}"
            return
    lines.insert(gate[1] if gate[1] <= len(lines) else len(lines), f"- {AGENT_GATE_FIELDS[key]}: {value}\n")


def _set_scope(lines: list[str], field: str, value: str, column: int) -> None:
    rows = _table_rows(lines, _SCOPE_HEADING_RE)
    wanted = field.strip().lower()
    matches = [(index, cells) for index, cells in rows if cells[0].lower().startswith(wanted)]
    if len(matches) != 1:
        names = ", ".join(cells[0] for _, cells in rows)
        raise LedgerError(f"scope field {field!r} matches {len(matches)} rows; one of: {names}")
    index, cells = matches[0]
    cells += [""] * (3 - len(cells))
    cells[column] = value
    ending = lines[index][len(lines[index].rstrip("\r\n")):] or "\n"
    lines[index] = _row_line(cells, ending)


def update_state(root: Path, sets: dict[str, str], scope: dict[str, str], evidence: dict[str, str]) -> list[str]:
    lines = _read_state(root)
    changed = []
    for key, value in sets.items():
        _set_gate_field(lines, key, value)
        changed.append(key)
    for field, value in scope.items():
        _set_scope(lines, field, value, 1)
        changed.append(f"scope {field}")
    for field, value in evidence.items():
        _set_scope(lines, field, value, 2)
        changed.append(f"scope evidence {field}")
    _write_state(root, lines)
    return changed


def _rows(root: Path, name: str) -> list[dict[str, str]]:
    if not (root / name).is_file():
        return []
    return [row for row in read_ledger(root / name)[1] if row.get("id", "").strip()]


def _short(value: str, limit: int = 140) -> str:
    value = clean(value)
    return value if len(value) <= limit else value[:limit - 1] + "…"


def view_environment(root: Path) -> list[str]:
    lines = ["## Environment (environment.tsv)"]
    for row in _rows(root, "environment.tsv"):
        version = row.get("version", "").strip()
        issue = row.get("issue", "").strip()
        lines.append(f"- {row.get('item', '')}: {_short(row.get('path', '') or '-', 90)}"
                     + (f" ({_short(version, 40)})" if version else "")
                     + f" [{row.get('status', '')}]" + (f" {_short(issue, 120)}" if issue else ""))
    return lines if len(lines) > 1 else lines + ["- none yet: env_probe.py --migration-root <root>"]


def view_env_smoke(root: Path) -> list[str]:
    from ohos_env import ENV_SMOKE

    lines = [f"## Environment smoke ({ENV_SMOKE})"]
    try:
        smoke = json.loads((root / ENV_SMOKE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return lines + ["- none yet: env_smoke.py --migration-root <root>"]
    runtime = smoke.get("runtime") or {}
    return lines + [f"- {smoke.get('status', '?')} @ {smoke.get('finished_at', '?')}: {_short(smoke.get('summary', ''), 120)}"
                    + f" (runtime {runtime.get('status', '?')})"]


def view_decisions(root: Path) -> list[str]:
    lines = ["## Decisions (decisions.tsv)"]
    for row in _rows(root, "decisions.tsv"):
        answer = row.get("answer", "").strip()
        state = f"{row.get('owner', '').strip()}: {_short(answer, 80)}" if answer else "not answered"
        lines.append(f"- {row['id']} {_short(row.get('question', ''), 100)} -> {state}")
    return lines if len(lines) > 1 else lines + ["- none yet"]


def view_features(root: Path) -> list[str]:
    from feature_predicates import host_phase
    lines = ["## External features (features.tsv)"]
    for row in _rows(root, "features.tsv"):
        gate = row.get("exit_gate", "").strip() or row.get("entry_gate", "").strip() or "activated"
        lines.append(f"- {row['id']} {row.get('feature_id', '')} [{row.get('kind', '')}, {host_phase(row)}] "
                     f"{row.get('status', '')}, step {row.get('current_step', '') or '-'}; {_short(gate, 80)}")
    return lines if len(lines) > 1 else lines + ["- none activated"]


def view_knowledge(root: Path) -> list[str]:
    path = root / "knowledge-manifest.tsv"
    if not path.is_file():
        return ["## Knowledge baseline (knowledge-manifest.tsv)", "- missing: init_migration.py writes it"]
    with path.open(newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    pinned = rows[0].get("baseline_manifest_sha256", "")[:12] if rows else "-"
    used = sum(1 for row in rows if row.get("used", "").strip() == "yes")
    modified = sum(1 for row in rows if row.get("modified", "").strip() == "yes")
    return ["## Knowledge baseline (knowledge-manifest.tsv)",
            f"- pinned {pinned}, {len(rows)} pages, {used} used, {modified} locally modified"]


def view_inventory(root: Path) -> list[str]:
    lines = ["## Capability dispositions (inventory.tsv)"]
    for row in _rows(root, "inventory.tsv"):
        lines.append(f"- {row['id']} {row.get('category', '')} [{row.get('disposition', '')}] "
                     f"{_short(row.get('target_behavior', '') or row.get('cause', ''), 110)} "
                     f"({_short(row.get('found_by', ''), 60)})")
    return lines if len(lines) > 1 else lines + ["- none yet"]


def _document_sections(path: Path, keep: re.Pattern[str] | None = None) -> list[str]:
    """A document without its title and intro; with ``keep``, only the matching ``##`` sections."""
    out, take = [], False
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("## "):
            take = keep is None or bool(keep.match(line.strip()))
        if take and line.strip():
            out.append(line.rstrip())
    return out


def show_state(root: Path) -> str:
    """STATE.md's own fields plus the live views of the ledgers it no longer copies."""
    _read_state(root)  # existence check with the init hint
    own = _document_sections(root / STATE_FILE, re.compile(r"^##\s+(Scope|Gate|Progress)", re.I))
    views = (view_environment(root) + view_env_smoke(root) + view_inventory(root) + view_decisions(root)
             + view_features(root) + view_knowledge(root))
    return "\n".join(own + views)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    raw = argparse.RawDescriptionHelpFormatter
    set_help = "one column=value; repeat --set for each column (never join columns with ';' in one --set)"
    a = sub.add_parser("add", formatter_class=raw, epilog=(
        "example:\n"
        "  ledger.py add <root> inventory.tsv --set category=qt-module \\\n"
        "      --set \"location=build-file: src/a.pro:7\" --set \"cause=...\" \\\n"
        "      --set \"found_by=preflight: PF-QT-MODULE-01\" --set disposition=guarded-adaptation \\\n"
        "      --set \"target_behavior=...\"\n"
        "  ledger.py add <root> tasks.tsv --set \"task=...\" --set \"inventory_ids=INV-001, INV-002\" \\\n"
        "      --set validation_ids=VAL-001 --set status=planned\n"
        "columns and values: ledger.py columns <ledger>"))
    a.add_argument("root", type=Path)
    a.add_argument("ledger")
    a.add_argument("--id")
    a.add_argument("--set", action="append", default=[], metavar="COLUMN=VALUE", help=set_help)
    u = sub.add_parser("update", formatter_class=raw, epilog=(
        "example:\n"
        "  ledger.py update <root> validation.tsv VAL-004 --set status=passed --set \"evidence=batch app-2: ...\"\n"
        "  ledger.py update <root> tasks.tsv TASK-002 --set status=passed --set \"evidence=batch task-002-3 passed\"\n"
        "  ledger.py update <root> tasks.tsv TASK-002 --append \"evidence=; DIAG-007 fixed\""))
    u.add_argument("root", type=Path)
    u.add_argument("ledger")
    u.add_argument("id")
    u.add_argument("--set", action="append", default=[], metavar="COLUMN=VALUE", help=set_help)
    u.add_argument("--append", action="append", default=[], metavar="COLUMN=TEXT",
                   help="append TEXT to the column's current value; repeat for each column")
    g = sub.add_parser("get")
    g.add_argument("root", type=Path)
    g.add_argument("ledger")
    g.add_argument("id", nargs="+")
    li = sub.add_parser("list")
    li.add_argument("root", type=Path)
    li.add_argument("ledger")
    li.add_argument("--where", action="append", default=[], help="column=a,b or column!=a,b (repeatable, all must hold)")
    li.add_argument("--columns", help="comma-separated columns to print (default all)")
    li.add_argument("--limit", type=int, default=0)
    st = sub.add_parser("state")
    st.add_argument("root", type=Path)
    st.add_argument("--set", action="append", default=[],
                    help='"Assessment=...", "Verdict basis=...", "Deciding risk=...", "Completion tier=...", '
                         '"Next executable action=..."')
    st.add_argument("--scope", action="append", default=[], help='"<Scope field prefix>=<value>"')
    st.add_argument("--evidence", action="append", default=[], help='"<Scope field prefix>=<evidence>"')
    k = sub.add_parser("columns")
    k.add_argument("ledger")
    args = parser.parse_args(argv)
    try:
        if args.command == "add":
            row_id = add_row(args.root, args.ledger, parse_sets(args.set), args.id)
            print(f"added {row_id} to {args.ledger}")
        elif args.command == "update":
            update_row(args.root, args.ledger, args.id, parse_sets(args.set), parse_sets(args.append))
            print(f"updated {args.id} in {args.ledger}")
        elif args.command == "get":
            _, rows = read_ledger(args.root / args.ledger)
            by_id = {item.get("id", "").strip(): item for item in rows}
            missing = [row_id for row_id in args.id if row_id not in by_id]
            if missing:
                raise LedgerError(f"{', '.join(missing)} not in {args.ledger}")
            found = [by_id[row_id] for row_id in args.id]
            print(json.dumps(found[0] if len(found) == 1 else found, ensure_ascii=False, indent=2))
        elif args.command == "list":
            columns = [c.strip() for c in args.columns.split(",") if c.strip()] if args.columns else None
            total, rows = select_rows(args.root, args.ledger, args.where, columns, args.limit)
            print(f"{args.ledger}: {total} row(s)" + (f", showing {len(rows)}" if len(rows) < total else ""))
            for row in rows:
                print(json.dumps(row, ensure_ascii=False))
        elif args.command == "state":
            if args.set or args.scope or args.evidence:
                changed = update_state(args.root, parse_sets(args.set), parse_sets(args.scope), parse_sets(args.evidence))
                print(f"STATE.md updated: {', '.join(changed)}")
            else:
                print(show_state(args.root))
        elif args.command == "columns":
            print(describe_columns(args.ledger))
    except LedgerError as error:
        print(f"ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

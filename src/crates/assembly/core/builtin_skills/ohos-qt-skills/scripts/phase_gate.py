#!/usr/bin/env python3
"""Enforce migration phase exit gates from the durable ledgers.

The agent may choose how to perform a scan or build, but it cannot advance
past a phase with only conversational evidence.  Bootstrap rows created by
the initializer are receipts, not application evidence.
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


BOOTSTRAP_IDS = {"CAP-BOOT-001", "VAL-BOOT-001", "DIAG-BOOT-001", "PILOT-BOOT-001"}
PASS_STATUSES = {"passed", "verified", "accepted", "accepted-limitation", "not-applicable"}
# Keep in sync with DIAGNOSTIC_STATUSES in record_diagnostic.py and validate_ledgers.py.
PILOT_PASS_STATUSES = {"passed", "resolved"}
# One phase per SKILL.md step; each phase has one primary ledger:
# environment, inventory, decisions, pilot, work-queue, feature-adoption (external
# features hooked into `features`; `handoff` also hosts verification features),
# diagnostics, validation.
PHASES = ("baseline", "inventory", "contract", "pilot", "implementation", "features", "diagnostics", "handoff")
# Closed rows of a feature-adoption ledger created before external features
# (old header with playbook_path); the current lifecycle is in feature_predicates.py.
LEGACY_FEATURE_CLOSED = {"verified", "deferred-approved", "blocked", "not-applicable"}
ASSESSMENT_RE = re.compile(r"^\s*-\s*Assessment:\s*`?([A-Za-z-]+)`?", re.MULTILINE)
# A selected option that removes or fakes behavior is a user decision, never an agent default.
DEGRADING_RE = re.compile(r"degrad|\bstub|\bdrop|\bremov|\bdisabl|\bdefer|no-op|\bnull\w*|placeholder|not[- ]ported", re.IGNORECASE)
USER_EVIDENCE_RE = re.compile(r"\buser:\s*\S", re.IGNORECASE)
# A question the user never answered (prompt timed out, skipped, no reply) is
# not a user decision, even when the evidence is written as "user: ...".
# The non-answer word must describe the question itself ("question timed out",
# "提问超时"), not a topic the user talked about ("question about build timeout").
_ASKED = r"(?:askuserquestion|question|prompt|ask)(?:\s+for\s+(?:the\s+)?[\w.`'-]+)?"
_NON_ANSWER_EN = (
    r"(?:\s+(?:was|has|had|got|is|have))?(?:\s+been)?\s*[:(-]?\s*"
    r"(?:timed?[ -]?out|timeout|expired|skipped|dismissed|went unanswered|unanswered|got no (?:response|answer|reply))"
)
_ASKED_ZH = r"(?:提问|询问|问题|弹窗)(?:已|后)?\s*"
_NON_ANSWER_ZH = r"(?:超时|已过期|被跳过|被关闭|无人回答|无人回复|未获回复|未获回答|无响应|未响应|无回复)"
NON_ANSWER_RE = re.compile(
    r"\b" + _ASKED + _NON_ANSWER_EN
    + r"|" + _ASKED_ZH + _NON_ANSWER_ZH
    + r"|(?:user|用户)\s*(?:did ?n[o']t|never|has ?n[o']t|未|没有|没)\s*(?:respond|answer|reply|select|choose|回复|回答|作答|选择|响应)"
    + r"|no (?:response|answer|reply|input) from (?:the )?user|without (?:a |any )?(?:user )?(?:response|answer|reply|input)"
    # The agent applying a default in its own voice is not the user's answer either.
    + r"|skip[- ]and[- ]continue|(?:skill|tool|agent)['’]?s? default (?:is|=|applies|applied|used)"
    + r"|defaulted to|fell back to (?:the )?default|falling back to (?:the )?default|applied (?:the )?default"
    + r"|自动(?:按|采用|使用|套用)默认|按默认值处理|默认值生效",
    re.IGNORECASE,
)
QUEUE_DONE = {"passed", "accepted-limitation", "not-applicable"}
# An inventory row's status is its capability's migration state: `planned`
# while only recorded, closed once the linked queue work is done.
INVENTORY_CLOSED = PASS_STATUSES | {"blocked"}


def read_rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    # Short rows yield None values and long rows a None key. validate_ledgers.py
    # reports the column mismatch; the gate must still evaluate without crashing.
    return [{key: value or "" for key, value in row.items() if key is not None} for row in rows]


def meaningful(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [row for row in rows if row.get("id", "").strip() not in BOOTSTRAP_IDS]


def non_placeholder(value: str) -> bool:
    text = value.strip().lower()
    # "unclassified" is what batch_checks.py writes before the agent classifies a failure.
    return bool(text) and text not in {"todo", "tbd", "n/a", "none", "unknown", "unclassified"}


def has_receipt(row: dict[str, str], *fields: str) -> bool:
    return all(non_placeholder(row.get(field, "")) for field in fields)


def unanswered(row: dict[str, str]) -> bool:
    """The evidence says the user was asked but never answered (timeout, skip, tool default)."""
    return bool(NON_ANSWER_RE.search(row.get("evidence", "")))


def user_approved(row: dict[str, str]) -> bool:
    """A degradation needs owner=user and evidence quoting the user (``user: ...``).

    A prompt that timed out or was skipped is not an answer: such a row never
    counts as user-approved, whatever its owner/status say.
    """
    return (
        row.get("status", "").strip().lower() == "approved"
        and row.get("owner", "").strip().lower() == "user"
        and bool(USER_EVIDENCE_RE.search(row.get("evidence", "")))
        and not unanswered(row)
    )


def is_batch_receipt(row: dict[str, str]) -> bool:
    # batch_checks.py --diagnostics writes evidence as "batch <output-dir>: ...".
    return row.get("evidence", "").strip().lower().startswith("batch ")


def report(phase: str, errors: list[str]) -> int:
    if errors:
        print(f"BLOCKED phase={phase}")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"READY phase={phase}")
    return 0


def legacy_feature_errors(features: list[dict[str, str]], validation: list[dict[str, str]], root: Path) -> list[str]:
    """Feature rule of ledgers created before external features (``playbook_path`` header).

    Every row is closed; ``verified`` needs a pinned playbook and passed VAL
    rows. A ledger with no rows means no feature was selected.
    """
    errors: list[str] = []
    decision_ids = {row.get("id", "") for row in read_rows(root / "decisions.tsv")}
    validation_status = {row.get("id", ""): row.get("status", "") for row in validation}
    for row in features:
        row_id = row.get("id", "")
        status = row.get("status", "").strip().lower()
        if status not in LEGACY_FEATURE_CLOSED:
            errors.append(f"{row_id} is '{status or 'missing'}'; feature rows must end verified, deferred-approved, blocked or not-applicable")
            continue
        if status == "not-applicable":
            if not non_placeholder(row.get("evidence", "")):
                errors.append(f"{row_id} is not-applicable without evidence (cite the contract or decision)")
            continue
        if not non_placeholder(row.get("feature_id", "")):
            errors.append(f"{row_id} has no feature_id from features/registry.tsv")
        if status in {"deferred-approved", "blocked"} and row.get("decision_id", "").strip() not in decision_ids:
            errors.append(f"{row_id} is {status} without a decision_id in decisions.tsv")
        if status == "verified":
            if not non_placeholder(row.get("playbook_sha256", "")):
                errors.append(f"{row_id} is verified without a pinned playbook_sha256")
            ids = [value.strip() for value in row.get("validation_ids", "").split(",") if value.strip()]
            if not ids:
                errors.append(f"{row_id} is verified without validation_ids")
            for value in ids:
                if validation_status.get(value, "") not in PASS_STATUSES:
                    errors.append(f"{row_id} is verified but {value} is not a passed validation row")
    return errors


def hook_errors(root: Path, phase: str, validation: list[dict[str, str]], features_root: Path | None = None) -> list[str]:
    """External features (hooks) that ``phase`` depends on.

    From the contract phase on: when features are registered, the user's
    selection is recorded (a user-approved ``external-features`` decision,
    even ``selected=none``) and the FEAT rows match it. For every feature whose
    host phase is not later than ``phase``: it is closed, ``passed`` carries a
    script-written exit record, and, for the host phase itself, the evidence
    digest is unchanged since the exit gate. Handoff also needs every FEAT id
    in report.md's External features section.
    """
    import feature_predicates as fp  # lazy: feature_predicates imports this module

    features_root = features_root or fp.default_features_root()
    rows = read_rows(root / fp.ADOPTION)
    if fp.is_legacy(fp.adoption_fields(root)):
        return legacy_feature_errors(rows, validation, root) if phase in {"features", "diagnostics", "handoff"} else []
    errors: list[str] = []
    gated = PHASES.index(phase)
    if gated < PHASES.index("contract"):
        return errors
    registry = fp.read_registry(features_root)
    offered = {key for key, row in registry.items() if row.get("status", "").strip() != "draft"}
    decisions = read_rows(root / "decisions.tsv")
    activations = [row for row in decisions
                   if row.get("feature_or_scope", "").strip().lower() == fp.ACTIVATION_SCOPE and user_approved(row)]
    active = {row.get("feature_id", "").strip() for row in rows}
    if offered and not activations:
        errors.append(
            "external features are registered but the user's selection is not recorded; run feature_hooks.py candidates, "
            "ask the user (default: none) and wait for the answer (a timed-out or skipped question is not one), record a decisions.tsv row feature_or_scope=external-features owner=user "
            "status=approved evidence 'user: ...', then feature_hooks.py activate"
        )
    if activations:
        newest = fp.selected_features(activations[-1])
        missing = sorted(newest - active)
        if missing:
            errors.append(f"{activations[-1].get('id')} selects {', '.join(missing)} but feature-adoption.tsv has no row; run feature_hooks.py activate")
    allowed = {item for row in activations for item in fp.selected_features(row)}
    decision_by_id = {row.get("id", "").strip(): row for row in decisions}
    for row in rows:
        row_id, feature_id = row.get("id", "").strip(), row.get("feature_id", "").strip()
        status = fp.status_of(row)
        if feature_id not in allowed:
            errors.append(f"{row_id} ({feature_id}) was not selected by a user-approved external-features decision")
        if feature_id not in registry:
            errors.append(f"{row_id} ({feature_id}) is not registered in features/registry.tsv")
        if not non_placeholder(row.get("package_sha256", "")):
            errors.append(f"{row_id} has no pinned package_sha256; activate it with feature_hooks.py")
        host = row.get("host_phase", "").strip()
        if host not in PHASES:
            errors.append(f"{row_id} has unknown host_phase '{host}'")
            continue
        if status not in fp.STATUSES:
            errors.append(f"{row_id} has unknown status '{row.get('status', '')}'")
            continue
        if PHASES.index(host) > gated:
            continue
        if status not in fp.TERMINAL:
            errors.append(
                f"{row_id} ({feature_id}) hooks into {host} and is still {status}; "
                + ("run feature_gate.py enter" if status == "planned" else "finish it and run feature_gate.py exit")
                + ", or ask the user to close it (feature_hooks.py close)"
            )
        elif status == "passed":
            match = re.match(r"READY @\S+ digest=([0-9a-f]{16})", row.get("exit_gate", "").strip())
            if not match:
                errors.append(f"{row_id} is passed without a feature_gate.py exit record; only the exit gate sets passed")
            elif host == phase:
                try:
                    ctx = fp.build_context(root, features_root, row, rows, run_commands=False)
                except ValueError as error:
                    errors.append(f"{row_id}: {error}")
                else:
                    if fp.evidence_digest(ctx) != match.group(1):
                        errors.append(f"{row_id} evidence changed after its exit gate (evidence files, VAL status, sources or package); "
                                      "re-run it: feature_gate.py enter --restart, then exit")
        elif status == "deferred-approved":
            if not user_approved(decision_by_id.get(row.get("decision_id", "").strip(), {})):
                errors.append(f"{row_id} is deferred-approved without a user-approved decision (owner=user, evidence 'user: ...')")
        elif status == "blocked" and row.get("decision_id", "").strip() not in decision_by_id:
            errors.append(f"{row_id} is blocked without a decision_id in decisions.tsv")
    if phase == "handoff" and rows:
        report_path = root / "report.md"
        text = report_path.read_text(encoding="utf-8", errors="replace") if report_path.is_file() else ""
        section = re.search(r"^##\s+External features\s*$(.*?)(?=^##\s|\Z)", text, re.MULTILINE | re.DOTALL)
        body = section.group(1) if section else ""
        for row in rows:
            row_id = row.get("id", "").strip()
            if not any(row_id in line and fp.status_of(row) in line.lower() for line in body.splitlines()):
                errors.append(f"report.md External features does not list {row_id} with its final status {fp.status_of(row)}")
    return errors


def split_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip() and item.strip().lower() != "none"]


def inventory_link_errors(
    inventory: list[dict[str, str]], queue: list[dict[str, str]], queue_fields: list[str], check_sync: bool,
) -> list[str]:
    """Every inventory capability is closed by queue work that names it.

    A queue row closes the inventory rows listed in its ``inventory_ids`` (or
    the row with its own id). Ledgers created before the column existed are
    not checked. With ``check_sync``, an inventory row whose queue work is all
    done must be closed as well.
    """
    if "inventory_ids" not in queue_fields:
        return []
    errors: list[str] = []
    closers: dict[str, list[dict[str, str]]] = {}
    for row in queue:
        ids = set(split_ids(row.get("inventory_ids", "")))
        ids.add(row.get("id", "").strip())
        for value in ids:
            closers.setdefault(value, []).append(row)
    for row in inventory:
        row_id = row.get("id", "").strip()
        status = row.get("status", "").strip().lower()
        linked = closers.get(row_id, [])
        if not linked:
            if status not in INVENTORY_CLOSED:
                errors.append(
                    f"{row_id} is not closed by any work-queue row; list it in a queue row's inventory_ids "
                    "(a verification-only row is fine for keep/no-change capabilities)"
                )
            continue
        if check_sync and status not in INVENTORY_CLOSED and all(
            item.get("status", "").strip() in QUEUE_DONE | {"blocked"} for item in linked
        ):
            done = ", ".join(item.get("id", "") for item in linked)
            errors.append(
                f"{row_id} is still '{status or 'missing'}' although its queue work ({done}) is done; "
                "set its inventory status to passed/verified/accepted-limitation/not-applicable/blocked with evidence"
            )
    return errors


def queue_fields(path: Path) -> list[str]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as stream:
        return next(csv.reader(stream, delimiter="\t"), [])


def evaluate(root: Path, phase: str, features_root: Path | None = None) -> list[str]:
    """Return the unmet gate conditions for ``phase``; empty means READY."""
    errors: list[str] = []

    environment = read_rows(root / "environment.tsv")
    baseline = read_rows(root / "baseline.tsv")
    inventory = meaningful(read_rows(root / "inventory.tsv"))
    queue = meaningful(read_rows(root / "work-queue.tsv"))
    validation = meaningful(read_rows(root / "validation.tsv"))
    all_diagnostics = meaningful(read_rows(root / "diagnostics.tsv"))
    # Pilot attempts live in pilot.tsv; ledgers created before the split kept
    # them in diagnostics.tsv with phase=pilot.
    pilot_rows = meaningful(read_rows(root / "pilot.tsv")) + [
        row for row in all_diagnostics if row.get("phase", "").lower() == "pilot"
    ]
    diagnostics = [row for row in all_diagnostics if row.get("phase", "").lower() != "pilot"]
    package = read_rows(root / "package-manifest.tsv")
    device = read_rows(root / "device-runs.tsv")
    state = (root / "STATE.md").read_text(encoding="utf-8", errors="replace") if (root / "STATE.md").is_file() else ""
    contract = (root / "PORTING_CONTRACT.md").read_text(encoding="utf-8", errors="replace") if (root / "PORTING_CONTRACT.md").is_file() else ""

    required_environment_categories = {
        "qt-target",
        "ohos-sdk",
        "toolchain",
        "package",
        "qt-template",
        "ohos-native",
        "build-host",
        "package-runtime",
    }
    # Gates are cumulative: every later phase re-checks the earlier exit
    # conditions, so a READY gate also proves the phases before it.
    if phase in PHASES:
        present = {
            row.get("category", "")
            for row in environment
            if non_placeholder(row.get("value", "")) and non_placeholder(row.get("evidence", ""))
        }
        missing = sorted(required_environment_categories - present)
        if missing:
            errors.append("environment.tsv lacks evidence for: " + ", ".join(missing))
        if not any(
            row.get("kind") == "host-smoke"
            and non_placeholder(row.get("result", ""))
            and row.get("status", "") not in {"planned", "not-run"}
            and non_placeholder(row.get("evidence", ""))
            for row in baseline
        ):
            errors.append("baseline.tsv needs a completed host-smoke receipt with evidence")

    if phase in {"inventory", "contract", "pilot", "implementation", "features", "diagnostics", "handoff"}:
        if not inventory:
            errors.append("inventory.tsv has no application CAP rows; bootstrap receipt is not an inventory")
        if not queue:
            errors.append("work-queue.tsv has no application CAP rows")
        if not validation:
            errors.append("validation.tsv has no application VAL rows")
        if any(not row.get("validation_id", "").strip() for row in inventory):
            errors.append("every inventory row needs a validation_id")
        validation_ids = {row.get("id", "") for row in validation}
        for row in inventory:
            if row.get("validation_id", "").strip() not in validation_ids:
                errors.append(f"{row.get('id')} points to a missing validation row")
        errors.extend(inventory_link_errors(
            inventory, queue, queue_fields(root / "work-queue.tsv"),
            check_sync=phase not in {"inventory", "contract", "pilot"},
        ))
        queue_ids = {row.get("id", "") for row in queue}
        for row in queue:
            if not row.get("validation_ids", "").strip():
                errors.append(f"{row.get('id')} has no validation_ids")
            for prerequisite in row.get("prerequisites", "").split(","):
                prerequisite = prerequisite.strip()
                if prerequisite and prerequisite != "none" and prerequisite not in queue_ids:
                    errors.append(f"{row.get('id')} has missing prerequisite {prerequisite}")

    if phase in {"contract", "pilot", "implementation", "features", "diagnostics", "handoff"}:
        if "TODO" in contract:
            errors.append("PORTING_CONTRACT.md still contains TODO placeholders")
        # Parse the recorded value; the template's option list also contains "ready".
        match = ASSESSMENT_RE.search(state)
        assessment = match.group(1).lower() if match else ""
        # Only `ready` may enter implementation; open decisions must be closed first.
        allowed = {"ready", "ready-with-decisions"} if phase in {"contract", "pilot"} else {"ready"}
        if assessment not in allowed:
            errors.append(
                f"STATE.md Assessment is '{assessment or 'missing'}'; phase {phase} requires "
                + " or ".join(sorted(allowed))
            )
        # Leaving contract/pilot needs queued work for implementation. From
        # implementation on, a fully closed queue is the goal, not a defect
        # (handoff separately rejects rows that are still open).
        queue_closed = bool(queue) and all(row.get("status", "") in QUEUE_DONE for row in queue)
        if phase in {"contract", "pilot"} and not queue_closed and not any(
            row.get("status", "") in {"planned", "ready", "in-progress"}
            and non_placeholder(row.get("capability", ""))
            for row in queue
        ):
            errors.append("work-queue.tsv has no executable capability row")
        decisions = [row for row in read_rows(root / "decisions.tsv") if "-BOOT-" not in row.get("id", "")]
        for row in decisions:
            if (
                row.get("status", "").strip().lower() == "approved"
                and row.get("owner", "").strip().lower() == "user"
                and unanswered(row)
            ):
                errors.append(
                    f"{row.get('id')} is recorded as a user approval, but its evidence says the question was never "
                    "answered (timeout/skip/no reply); that is not a user decision. Ask again and wait for the "
                    "answer, then record the user's words as 'user: ...'"
                )
            if (
                row.get("status", "").strip().lower() == "approved"
                and DEGRADING_RE.search(row.get("selected", ""))
                and not user_approved(row)
            ):
                errors.append(
                    f"{row.get('id')} approves a degradation/stub without user approval; "
                    "set owner=user with evidence 'user: <quote or prompt reference>', or record it blocked"
                )
        approved_scope = {
            item.strip()
            for row in decisions if user_approved(row)
            for item in row.get("affected_ids", "").split(",")
        }
        for row in inventory:
            if row.get("disposition", "").strip().lower() == "degraded-approved" and row.get("id") not in approved_scope:
                errors.append(f"{row.get('id')} is degraded-approved but no user-approved decision lists it in affected_ids")

    if phase in {"pilot", "implementation", "features", "diagnostics", "handoff"}:
        if not pilot_rows:
            errors.append("pilot.tsv needs a pilot attempt row before implementation; run batch_checks.py --phase pilot")
        elif not any(
            row.get("status", "") in PILOT_PASS_STATUSES
            and non_placeholder(row.get("evidence", ""))
            and non_placeholder(row.get("first_causal_signature", ""))
            and non_placeholder(row.get("command", ""))
            for row in pilot_rows
        ):
            errors.append("pilot must have a reviewed result; a bootstrap or TODO row is insufficient")
        if not any(
            row.get("id", "").startswith("VAL-")
            and row.get("platform", "").lower() in {"ohos", "harmonyos", "host+ohos", "both"}
            for row in validation
        ):
            errors.append("validation.tsv needs an OHOS acceptance scenario before pilot exit")

    # External features: the user's selection from the contract on, closed
    # features from their host phase on (features: capability, handoff: verification).
    errors.extend(hook_errors(root, phase, validation, features_root))

    if phase in {"diagnostics", "handoff"}:
        for row in diagnostics + pilot_rows:
            status = row.get("status", "").strip().lower()
            if status in {"failed", "timeout", "blocked"}:
                required = ("first_causal_signature", "root_cause", "attempts", "command", "log_path", "fix_or_next_action", "evidence")
                if not has_receipt(row, *required):
                    errors.append(f"{row.get('id')} is a failure without a complete diagnostic receipt")
                try:
                    attempts = int(row.get("attempts", "0"))
                except ValueError:
                    attempts = 0
                if attempts >= 3 and status not in {"blocked"}:
                    errors.append(f"{row.get('id')} reached three attempts and must be blocked/escalated")
            elif status == "resolved":
                # A fixed problem is the most useful record of the migration: what broke and what fixed it.
                fix = row.get("fix_or_next_action", "").strip().lower()
                if not has_receipt(row, "category", "root_cause", "fix_or_next_action") or fix.startswith("classify with"):
                    errors.append(
                        f"{row.get('id')} is resolved but does not record its root cause and fix; "
                        f"run record_diagnostic.py --id {row.get('id')} --category ... --root-cause ... --next-action <fix>"
                    )
        if not diagnostics:
            errors.append("diagnostics.tsv has no build/package/device receipt")
        build_rows = diagnostics
        if not any(is_batch_receipt(row) for row in build_rows):
            errors.append("diagnostics.tsv has no batch_checks.py receipt; run builds through batch_checks.py --diagnostics")
        if build_rows and queue and all(
            row.get("status", "") == "planned" and row.get("attempts", "0").strip() in {"", "0"}
            for row in queue
        ):
            errors.append("work-queue.tsv is untouched after build attempts; update status/attempts/evidence of the worked rows")

    if phase == "handoff":
        unverified = [row.get("id", "") for row in validation if row.get("status", "") not in PASS_STATUSES]
        if unverified:
            errors.append("handoff is blocked while validation rows remain unverified: " + ", ".join(unverified))
        open_rows = [row.get("id", "") for row in queue if row.get("status", "") not in QUEUE_DONE | {"blocked"}]
        if open_rows:
            errors.append("work-queue.tsv rows are still open: " + ", ".join(open_rows))
        open_inventory = [
            row.get("id", "") for row in inventory if row.get("status", "").strip().lower() not in INVENTORY_CLOSED
        ]
        if open_inventory:
            errors.append(
                "inventory.tsv capabilities are not closed: " + ", ".join(open_inventory)
                + "; set each to passed/verified/accepted-limitation/not-applicable/blocked with evidence"
            )
        if not any(
            row.get("artifact_type") == "application-hap"
            and row.get("status", "") in PASS_STATUSES
            and non_placeholder(row.get("evidence", ""))
            for row in package
        ):
            errors.append("package-manifest.tsv lacks verified final application HAP evidence")
        if not any(
            row.get("artifact_type") == "native-library"
            and row.get("origin", "") == "application"
            and row.get("status", "") in PASS_STATUSES
            and non_placeholder(row.get("entry_path", ""))
            and "pilot" not in row.get("entry_path", "").lower()
            for row in package
        ):
            errors.append("package-manifest.tsv lacks verified final application native-library evidence")
        operational_device = [row for row in device if row.get("id", "").strip() not in {"DEV-RUN-001"}]
        if operational_device and any(row.get("status", "") in {"planned", "not-run"} for row in operational_device):
            errors.append("device-runs.tsv still has unexecuted rows; mark them blocked/deferred with a decision")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("migration_root", type=Path)
    parser.add_argument("phase", choices=PHASES)
    parser.add_argument("--features-root", type=Path, help="features/ directory (default: the skill's)")
    parser.add_argument("--no-record", action="store_true",
                        help="do not write the verdict into STATE.md (Gate / Progress)")
    args = parser.parse_args()
    root = args.migration_root.resolve()
    errors = evaluate(root, args.phase, args.features_root)
    code = report(args.phase, errors)
    if not args.no_record:
        from gate_state import record_gate
        warning = record_gate(root, args.phase, errors, "phase_gate.py")
        if warning:
            print(f"WARNING {warning}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())

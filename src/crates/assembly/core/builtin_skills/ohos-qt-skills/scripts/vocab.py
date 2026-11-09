#!/usr/bin/env python3
"""The one definition of every phase id and ledger value the migration uses.

Gates, ledger scripts and `ledger.py columns` read these sets; documents point
here instead of listing values. Change a value only here.
"""
from __future__ import annotations

# Gate order. Phases 1-5 are the base Qt migration; `features` holds the
# external-feature selection and capability features; `validation` also runs the
# selected verification features.
PHASES = ("environment", "inventory", "decisions", "tasks", "diagnostics", "features", "validation")

PLACEHOLDERS = {"", "todo", "tbd", "n/a", "none", "unknown", "unclassified"}

# environment.tsv: one row per environment item, written only by env_probe.py.
# Core items are always written (missing when not found; device only warns: without a device the
# migration completes, the device checks are skipped); conditional items only when this host or
# application needs them or they were found (or were added by an earlier run). On a HarmonyOS PC
# the deveco item is the SDK named by DEVECO_SDK_HOME and the device is the PC itself.
ENV_CORE_ITEMS = ("host", "python", "qt-sdk", "qt-template", "deveco", "devecocli", "ohos-sdk", "make", "device")
#   llvm-mingw: Windows, when the Qt host tools or make need it   qt-host: a Qt 6 SDK (QT_HOST_PATH)
#   qt-source: a Qt source checkout (--qt-source, QT5_12_SRC/QT5_15_SRC, or the template inside one)
#   cmake/ninja: a CMake application                              tool:<name>: env_probe.py --tools <name>
#   jbr: DevEco's Java runtime, when found                        signing: when signing materials exist
ENV_CONDITIONAL_ITEMS = ("llvm-mingw", "qt-host", "qt-source", "jbr", "signing", "cmake", "ninja")
ENV_TOOL_PREFIX = "tool:"
# Row order; PATH entries of command_env are prepended in this order.
ENV_ITEM_ORDER = ("host", "python", "llvm-mingw", "qt-sdk", "qt-host", "qt-source", "qt-template", "deveco",
                  "jbr", "devecocli", "ohos-sdk", "make", "cmake", "ninja", ENV_TOOL_PREFIX, "device", "signing")
# The gate needs these present and neither error nor missing.
ENV_REQUIRED_ITEMS = ("qt-sdk", "qt-template", "deveco", "devecocli", "ohos-sdk", "make")
ENV_STATUSES = ("ok", "fixed", "warn", "error", "missing")
ENV_BLOCKING_STATUSES = {"error", "missing"}

# tasks.tsv: a TASK row is closed (ledger.py update --set status=... --set evidence=...) with one of
# QUEUE_CLOSE_STATUSES and non-empty evidence. blocked = it cannot be done without the user: the user was
# asked and the row stays open until the answer turns it into accepted-limitation or back to in-progress.
QUEUE_STATUSES = ("planned", "in-progress", "passed", "accepted-limitation", "not-applicable", "blocked")
QUEUE_OPEN = {"planned", "in-progress"}
QUEUE_DONE = {"passed", "accepted-limitation", "not-applicable"}
QUEUE_CLOSE_STATUSES = ("passed", "accepted-limitation", "not-applicable")

# inventory.tsv `disposition`: how the migration plans to handle a gap, fixed in the inventory phase.
# The table lists only what does not work as is on OHOS, so there is no "unchanged"/"not-applicable".
# needs-decision: the handling is a question in decisions.tsv; the answer and the outcome live in
# decisions.tsv and the TASK row (which cites the DEC id), never back in the inventory row.
# An inventory row has no status: what became of it is the state of the TASK rows that name it.
DISPOSITIONS = ("guarded-adaptation", "ohos-replacement", "packaging-only", "needs-decision")
# inventory.tsv `found_by`: why the row exists, as "<source>: <detail>" entries joined by "; ".
#   preflight: PF-* ids of preflight.json        closure: closure/ finding (blocker, need_port, interface-hits, ...)
#   scan: SCAN_ITEMS names of the source scan    qt-api-gap: scan_qt_api_gap.py
# Only inventory-phase findings: problems met later stay in diagnostics.tsv, and
# external features (features.tsv) never add inventory rows.
FOUND_BY_SOURCES = ("preflight", "closure", "scan", "qt-api-gap")
# The source scan checklist items (references/inventory-scan.md); `found_by=scan: <item>` names them.
SCAN_ITEMS = ("platform-code", "non-qt-guards", "source-encoding", "x86-only", "processes", "dynamic-loading",
              "paths-storage", "single-instance-ipc", "startup-args", "desktop-integration", "runtime-resources")

# validation.tsv
# planned = not checked yet; accepted-limitation = cannot pass and the user accepted it (no device, a degradation).
VALIDATION_STATUSES = ("planned", "passed", "failed", "accepted-limitation", "not-applicable")
VALIDATION_DONE = {"passed", "accepted-limitation", "not-applicable"}  # the validation gate needs every row in one of these

# device-runs.tsv: one row (DEVICE_RUN_ID), the application HAP's latest result; overwritten each time.
#   hap-failed: hap_check.py did not pass (batch_checks.py)      checked: hap_check.py passed, not run yet
#   no-device: hap_check.py passed, environment.tsv has no device  run: passed on the device (device_run.py --record)
DEVICE_RUN_ID = "DEV-RUN-001"
DEVICE_RUN_STATUSES = ("hap-failed", "checked", "no-device", "run")
DEVICE_RUN_DONE = {"run", "no-device"}  # the diagnostics gate (and every later one) needs one of these

# diagnostics.tsv: one row per problem. open = not fixed yet; fixed = cause and fix recorded;
# blocked = three fixes failed (or it needs the user): cause recorded, the user asked, waiting for the answer;
# accepted-limitation = the user accepted leaving it unfixed: cause recorded, fix holds the user's answer.
DIAGNOSTIC_STATUSES = ("open", "fixed", "blocked", "accepted-limitation")
DIAGNOSTIC_CLOSED = {"fixed", "accepted-limitation"}  # the diagnostics gate (and every later one) needs one of these
# diagnostics.tsv `location`: "<stage>: <detail>", the stage where the problem showed.
STAGES = ("environment", "configure", "build", "deploy", "package", "sign", "device", "manual")

# decisions.tsv: a plain question/answer store; `owner` of an answered row.
#   user: the user answered   agent-default: AskUserQuestion auto-decided the recommended option
DECISION_OWNERS = ("user", "agent-default")

# STATE.md
ASSESSMENTS = ("ready", "blocked", "not-recommended")
# Progress status of a phase. The gate writes passed (and in-progress for the next phase); while a phase is
# open, every ledger write recomputes it: blocked = waiting for the user (Assessment blocked or not-recommended, a
# blocked TASK/problem/feature, an unanswered feature selection), failed = a problem the agent is fixing (a
# broken environment item or smoke test, an open problem, a failed HAP check or scenario, a failed feature
# exit), else in-progress (gate_state.phase_condition).
PROGRESS_STATUSES = ("planned", "in-progress", "blocked", "failed", "passed")
# Completion tier, weakest to strongest; the validation phase reports the strongest one actually proven.
COMPLETION_TIERS = ("implemented-unverified", "configured", "built", "packaged", "installed-launched",
                    "scenario-verified")

# features.tsv (written only by feature_hooks.py / feature_gate.py)
# blocked = the exit gate failed max_attempts times: waiting for the user to retry (feature_gate.py exit
# --answer) or defer (feature_hooks.py close).
FEATURE_STATUSES = {"planned", "in-progress", "passed", "deferred-approved", "blocked"}
FEATURE_TERMINAL = {"passed", "deferred-approved"}
FEATURE_KINDS = ("capability", "verification")

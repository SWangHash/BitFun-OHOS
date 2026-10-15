#!/usr/bin/env python3
"""Tests of the external feature (hook) mechanism.

Run from the repository root:  python -m unittest discover -s tests
Every test builds its own migration root and features/ directory in a temp
directory; the real features/registry.tsv is never used.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import feature_gate  # noqa: E402
import feature_hooks  # noqa: E402
import feature_register  # noqa: E402
import feature_predicates as fp  # noqa: E402
import gate_state  # noqa: E402
import next_step  # noqa: E402
import phase_gate  # noqa: E402

TEMPLATES = REPO / "assets" / "templates" / "migration" / "ohos"
FEATURE_TEMPLATES = REPO / "features" / "_templates"


# --------------------------------------------------------------------------- fixtures

def write_tsv(path: Path, rows: list[dict[str, str]], fields: list[str] | None = None) -> None:
    if fields is None:
        with path.open(newline="", encoding="utf-8") as stream:
            fields = next(csv.reader(stream, delimiter="\t"))
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in fields})


def append_tsv(path: Path, row: dict[str, str]) -> None:
    rows = phase_gate.read_rows(path)
    rows.append(row)
    write_tsv(path, rows)


def update_tsv(path: Path, row_id: str, **values: str) -> None:
    rows = phase_gate.read_rows(path)
    for row in rows:
        if row.get("id") == row_id:
            row.update(values)
    write_tsv(path, rows)


def run(module, *argv: str) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            code = module.main(list(argv))
        except SystemExit as error:  # argparse
            code = error.code if isinstance(error.code, int) else 1
    return code, out.getvalue()


def make_app(base: Path) -> Path:
    """A minimal Qt app whose ledgers satisfy every gate when no feature is involved."""
    app = base / "app"
    (app / "src").mkdir(parents=True)
    (app / "CMakeLists.txt").write_text("project(demo)\n", encoding="utf-8")
    (app / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")
    root = app / "migration" / "ohos"
    shutil.copytree(TEMPLATES, root)
    (root / "knowledge-manifest.tsv").write_text(
        "baseline_manifest_sha256\tsource_revision\tsource_path\tsource_sha256\tskill_snapshot_path\tskill_snapshot_sha256\t"
        "snapshot_path\tsnapshot_sha256\tused\tmodified\taction\tlast_synced_at\n", encoding="utf-8")
    ev = "log/receipt.txt sha256:abc"
    env = phase_gate.read_rows(root / "environment.tsv")
    for row in env:
        row.update(value="v1", version_or_revision="1", source_or_path="/opt", status="passed", last_verified_at="2026-10-12", evidence=ev)
    write_tsv(root / "environment.tsv", env)
    write_tsv(root / "baseline.tsv", [
        {"id": "BASE-001", "kind": "host-smoke", "platform": "host", "revision": "r1", "command_or_scenario": "run",
         "exit_code": "0", "result": "starts", "status": "passed", "evidence": ev, "run_at": "2026-10-12"}])
    write_tsv(root / "inventory.tsv", [
        {"id": "CAP-001", "category": "build", "source_location": "CMakeLists.txt", "source_kind": "build", "current_behavior": "x",
         "ohos_constraint": "y", "prerequisites": "none", "scan_scope": "all", "scan_evidence": ev, "disposition": "unchanged",
         "target_behavior": "same", "files": "CMakeLists.txt", "risk": "low", "status": "passed", "evidence": ev, "validation_id": "VAL-001"}])
    write_tsv(root / "work-queue.tsv", [
        {"id": "CAP-001", "capability": "build", "category": "build", "prerequisites": "none", "inputs": "x", "owner": "agent",
         "status": "passed", "attempts": "1", "next_action": "none", "change_refs": "a", "change_hashes": "b", "evidence": ev,
         "validation_ids": "VAL-001", "inventory_ids": "CAP-001"}])
    write_tsv(root / "validation.tsv", [
        {"id": "VAL-001", "scenario": "launch", "platform": "ohos", "command_or_steps": "hdc", "expected": "starts",
         "result": "starts", "status": "passed", "reviewer": "agent", "negative_control": "n", "evidence": ev}])
    write_tsv(root / "pilot.tsv", [
        {"id": "PILOT-001", "build_or_device_run_id": "B1", "phase": "pilot", "category": "build", "first_causal_signature": "ok",
         "root_cause": "none", "attempts": "1", "command": "batch", "tree_or_environment_hash": "h", "log_path": "l",
         "fix_or_next_action": "none", "affected_ids": "VAL-001", "evidence": ev, "status": "passed", "recurrence": "none"}])
    write_tsv(root / "diagnostics.tsv", [
        {"id": "DIAG-001", "build_or_device_run_id": "B2", "phase": "diagnostics", "category": "build", "first_causal_signature": "ok",
         "root_cause": "none", "attempts": "1", "command": "batch", "tree_or_environment_hash": "h", "log_path": "l",
         "fix_or_next_action": "none", "affected_ids": "CAP-001", "evidence": "batch out/: build ok", "status": "passed", "recurrence": "none"}])
    write_tsv(root / "decisions.tsv", [
        {"id": "DEC-001", "phase": "contract", "question": "Qt version", "options": "a|b", "selected": "a", "impact": "x",
         "owner": "agent", "approved_at": "2026-10-12", "feature_or_scope": "stack", "affected_ids": "none", "status": "approved", "evidence": ev}])
    pkg = phase_gate.read_rows(root / "package-manifest.tsv")
    for row in pkg:
        row.update(package_revision="r1", entry_path=row["entry_path"].replace("TODO", "app"), present="true", sha256="s",
                   needed_or_plugin="n", contract_check="ok", status="passed", evidence=ev)
    write_tsv(root / "package-manifest.tsv", pkg)
    write_tsv(root / "device-runs.tsv", [
        {"id": "DEV-RUN-001", "device_class": "phone", "redacted_device": "d", "package_revision": "r1", "install_result": "ok",
         "launch_result": "ok", "process_result": "ok", "ui_or_render_result": "ok", "log_result": "ok", "scenario_ids": "VAL-001",
         "status": "passed", "evidence": ev, "run_at": "2026-10-12"}])
    contract = (root / "PORTING_CONTRACT.md").read_text(encoding="utf-8").replace("TODO", "set")
    (root / "PORTING_CONTRACT.md").write_text(contract, encoding="utf-8")
    state = (root / "STATE.md").read_text(encoding="utf-8").replace("- Assessment: `TODO`", "- Assessment: `ready`")
    (root / "STATE.md").write_text(state, encoding="utf-8")
    report = (root / "report.md").read_text(encoding="utf-8").replace("- TODO\n", "- none activated\n")
    (root / "report.md").write_text(report, encoding="utf-8")
    return root


def pass_phases(root: Path, *phases: str) -> None:
    """Mark Progress rows passed (what a READY gate writes)."""
    path = root / "STATE.md"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for index, line in enumerate(lines):
        if any(f"(`{phase}`" in line for phase in phases):
            lines[index] = line.replace("| planned |", "| passed |").replace("| in-progress |", "| passed |")
    path.write_text("".join(lines), encoding="utf-8")


SKILL_MD = """---
name: vendor-acceptance
description: Runs the vendor acceptance suite against a built HAP.
---

# Vendor acceptance

Run `python scripts/judge.py --out <dir>` and read `references/cases.md`.
"""
JUDGE = """import argparse, json, pathlib, sys
parser = argparse.ArgumentParser()
parser.add_argument("--workdir", type=pathlib.Path, required=True)
args = parser.parse_args()
data = json.loads((args.workdir / "report.json").read_text(encoding="utf-8"))
print(json.dumps({"evidence": "vendor judge: " + data.get("result", "missing")}))
sys.exit(0 if data.get("result") == "pass" else 1)
"""


def make_feature(features: Path, feature_id: str, kind: str, register: str | None = "stable", **hook_changes) -> Path:
    """A package wrapping an untouched delivered skill: hook.json + feature.md outside, skill/ inside."""
    package = features / feature_id
    shutil.copytree(FEATURE_TEMPLATES / kind, package)
    skill = package / "skill"
    (skill / "scripts").mkdir(parents=True)
    (skill / "references").mkdir()
    (skill / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
    (skill / "scripts" / "judge.py").write_text(JUDGE, encoding="utf-8")
    (skill / "references" / "cases.md").write_text("# cases\n", encoding="utf-8")
    hook = json.loads((package / "hook.json").read_text(encoding="utf-8"))
    hook.update(feature_id=feature_id, owner="test", **hook_changes)
    (package / "hook.json").write_text(json.dumps(hook, ensure_ascii=False, indent=2), encoding="utf-8")
    if register:
        registry = features / "registry.tsv"
        if not registry.is_file():
            registry.write_text("\t".join(feature_hooks.REGISTRY_FIELDS) + "\n", encoding="utf-8")
        append_tsv(registry, {"feature_id": feature_id, "title": hook["title"], "kind": kind,
                                                "hook_phase": hook["hook"]["phase"], "status": register,
                                                "package_path": f"{feature_id}/", "owner": "test", "summary": "skill feature"})
    return package


def user_decision(root: Path, dec_id: str, selected: str, scope: str = fp.ACTIVATION_SCOPE, owner: str = "user") -> None:
    append_tsv(root / "decisions.tsv", {
        "id": dec_id, "phase": "contract", "question": "Which external features?", "options": "list", "selected": selected,
        "impact": "scope", "owner": owner, "approved_at": "2026-10-12", "feature_or_scope": scope, "affected_ids": "none",
        "status": "approved", "evidence": "user: 选这些" if owner == "user" else "agent guess"})


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="feat-test-"))
        self.features = self.tmp / "features"
        self.features.mkdir()
        (self.features / "registry.tsv").write_text("\t".join(feature_hooks.REGISTRY_FIELDS) + "\n", encoding="utf-8")
        self.kb = self.tmp / "kb"
        self.kb.mkdir()
        self.root = make_app(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def hooks(self, *argv):
        return run(feature_hooks, "--features-root", str(self.features), *argv)

    def gate(self, *argv):
        return run(feature_gate, "--features-root", str(self.features), *argv)

    def evaluate(self, phase):
        return phase_gate.evaluate(self.root, phase, self.features)

    def adoption(self, feat="FEAT-001"):
        return fp.find_row(fp.read_adoption(self.root), feat)


# --------------------------------------------------------------------------- 0. fixture sanity

class FixtureTest(Base):
    def test_fixture_passes_every_gate_without_features(self):
        for phase in phase_gate.PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)

    def test_fixture_passes_with_real_registry(self):
        # Whatever the shipped registry offers, a recorded user selection of
        # "none" lets every gate pass; this does not depend on its contents.
        user_decision(self.root, "DEC-900", "none")
        self.assertEqual(phase_gate.evaluate(self.root, "handoff"), [])

    def test_offered_features_require_a_recorded_selection(self):
        make_feature(self.features, "cap-a", "capability")
        self.assertTrue(any("selection is not recorded" in error for error in self.evaluate("contract")))
        user_decision(self.root, "DEC-900", "none")
        self.assertEqual(self.evaluate("handoff"), [])


# --------------------------------------------------------------------------- 1. lint

class LintTest(Base):
    def lint(self, feature_id):
        return self.hooks("lint", "--kb-root", str(self.kb), feature_id)

    def test_templates_lint_clean(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification")
        code, out = self.hooks("lint", "--kb-root", str(self.kb))
        self.assertEqual(code, 0, out)
        self.assertIn("OK    cap-a package_sha256=", out)

    def test_errors(self):
        cases = {
            "bad-phase": dict(hook={"phase": "pilot", "after": []}),
            "bad-kind": dict(hook={"phase": "handoff", "after": []}),
            "unknown-pred": dict(exit={"criteria": [{"check": "magic"}]}),
            "cmd-in-entry": dict(entry={"requires": [{"check": "command", "run": ["python", "{package}/x.py"]}]}),
            "no-keywords": dict(trigger={"keywords": []}),
            "trigger-mode": dict(trigger={"keywords": ["x"], "mode": "always"}),
            "no-exit": dict(exit={"criteria": []}),
            "bad-placeholder": dict(exit={"criteria": [{"check": "artifact", "path": "{home}/x"}]}),
            "no-skill": dict(skill=""),
        }
        expected = {
            "bad-phase": "not an open hook point", "bad-kind": "accepts kind 'verification'", "unknown-pred": "unknown predicate",
            "cmd-in-entry": "not allowed in entry", "no-keywords": "trigger.keywords", "trigger-mode": "unknown fields",
            "no-exit": "at least one explicit condition", "bad-placeholder": "unknown placeholder",
            "no-skill": "must name the delivered skill directory",
        }
        for name, change in cases.items():
            make_feature(self.features, name, "capability", **change)
            code, out = self.lint(name)
            self.assertEqual(code, 1, name)
            self.assertIn(expected[name], out, name)

    def test_verification_specific(self):
        make_feature(self.features, "ver-mod", "verification", permissions={"modify_sources": True})
        code, out = self.lint("ver-mod")
        self.assertIn("may not modify sources", out)
        outside = {"criteria": [{"check": "command", "run": ["python", "/tmp/evil.py"]}]}
        make_feature(self.features, "ver-cmd", "verification", exit=outside)
        code, out = self.lint("ver-cmd")
        self.assertIn("only run a script inside the package", out)
        missing = {"criteria": [{"check": "command", "run": ["python", "{package}/checks/nope.py"]}]}
        make_feature(self.features, "ver-missing", "verification", exit=missing)
        code, out = self.lint("ver-missing")
        self.assertIn("does not exist inside the package", out)

    def test_missing_section_and_registry_mismatch(self):
        package = make_feature(self.features, "cap-sec", "capability")
        text = (package / "feature.md").read_text(encoding="utf-8").replace("## 准出对照", "## Exit")
        (package / "feature.md").write_text(text, encoding="utf-8")
        code, out = self.lint("cap-sec")
        self.assertIn("missing adapter sections for kind capability: 准出对照", out)
        update_tsv(self.features / "registry.tsv", "", )  # no-op keeps header
        rows = phase_gate.read_rows(self.features / "registry.tsv")
        rows[0]["hook_phase"] = "handoff"
        write_tsv(self.features / "registry.tsv", rows)
        code, out = self.lint("cap-sec")
        self.assertIn("differ from hook.json", out)

    def test_refs_and_cycles(self):
        make_feature(self.features, "cap-ref", "capability", refs=["semantic/missing.md"])
        code, out = self.lint("cap-ref")
        self.assertIn("does not exist in the current upstream-kb", out)
        make_feature(self.features, "cap-x", "capability", hook={"phase": "features", "after": ["cap-y"]})
        make_feature(self.features, "cap-y", "capability", hook={"phase": "features", "after": ["cap-x"]})
        code, out = self.hooks("lint", "--kb-root", str(self.kb))
        self.assertIn("forms a cycle", out)


# --------------------------------------------------------------------------- 2. candidates / activate / contract gate

class ActivationTest(Base):
    def setUp(self):
        super().setUp()
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification",
                     trigger={"keywords": ["扩展验收", "acceptance suite"]})
        make_feature(self.features, "cap-draft", "capability", register="draft")

    def test_candidates_list_all_non_draft_and_rank_hits(self):
        code, out = self.hooks("candidates", str(self.root), "--request", "迁移并跑扩展验收")
        self.assertEqual(code, 0)
        self.assertIn("cap-a", out)
        self.assertIn("ver-a", out)
        self.assertNotIn("cap-draft", out)
        self.assertIn("mentioned in request: 扩展验收", out)
        self.assertIn("default: none", out)

    def test_contract_gate_needs_user_selection(self):
        errors = self.evaluate("contract")
        self.assertTrue(any("selection is not recorded" in error for error in errors), errors)
        self.assertEqual(self.evaluate("baseline"), [])
        self.assertEqual(self.evaluate("inventory"), [])

    def test_selected_none(self):
        user_decision(self.root, "DEC-002", "none")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002")
        self.assertEqual(code, 0, out)
        self.assertEqual(fp.read_adoption(self.root), [])
        self.assertEqual(self.evaluate("handoff"), [])

    def test_activate_rules(self):
        user_decision(self.root, "DEC-002", "cap-a", owner="agent")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002", "--select", "cap-a")
        self.assertEqual(code, 1)
        self.assertIn("never selects features", out)
        user_decision(self.root, "DEC-003", "cap-a")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-003", "--select", "ver-a")
        self.assertIn("differs from DEC-003", out)
        user_decision(self.root, "DEC-004", "cap-draft")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-004", "--select", "cap-draft")
        self.assertIn("draft", out)
        self.assertEqual(fp.read_adoption(self.root), [])

    def test_activate_writes_rows_and_state(self):
        user_decision(self.root, "DEC-002", "cap-a ver-a")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002", "--select", "cap-a", "--select", "ver-a")
        self.assertEqual(code, 0, out)
        rows = fp.read_adoption(self.root)
        self.assertEqual([(r["id"], r["feature_id"], r["host_phase"], r["status"]) for r in rows],
                         [("FEAT-001", "cap-a", "features", "planned"), ("FEAT-002", "ver-a", "handoff", "planned")])
        self.assertEqual(rows[0]["package_sha256"], fp.package_hash(self.features / "cap-a"))
        state = (self.root / "STATE.md").read_text(encoding="utf-8")
        self.assertIn("| FEAT-002 | ver-a | handoff | verification | planned |", state)
        self.assertEqual(self.evaluate("contract"), [])
        self.assertEqual(self.evaluate("implementation"), [])
        errors = self.evaluate("features")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("FEAT-001", errors[0])

    def test_unselected_row_rejected(self):
        user_decision(self.root, "DEC-002", "none")
        write_tsv(self.root / fp.ADOPTION, [{"id": "FEAT-001", "feature_id": "cap-a", "kind": "capability", "host_phase": "features",
                                             "package_path": "cap-a/", "package_sha256": "x", "status": "planned"}])
        self.assertTrue(any("was not selected" in error for error in self.evaluate("contract")))

    def test_unanswered_question_is_not_a_user_decision(self):
        # What an agent wrote after AskUserQuestion timed out (notepad-- run).
        user_decision(self.root, "DEC-002", "none")
        update_tsv(self.root / "decisions.tsv", "DEC-002", evidence=(
            "user: AskUserQuestion for cap-a timed out with no response (skip-and-continue), skill default is none"))
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002")
        self.assertEqual(code, 1, out)
        errors = self.evaluate("contract")
        self.assertTrue(any("selection is not recorded" in error for error in errors), errors)
        self.assertTrue(any("never answered" in error for error in errors), errors)
        self.assertTrue(any("never answered" in error for error in self.evaluate("handoff")))
        # The user's real words pass again.
        update_tsv(self.root / "decisions.tsv", "DEC-002", evidence="user: 不需要鸿蒙特性")
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.evaluate("handoff"), [])

    def test_unanswered_patterns(self):
        def row(evidence):
            return {"status": "approved", "owner": "user", "evidence": evidence}
        unanswered = [
            "user: AskUserQuestion timed out",
            "user: question timeout after 30s, default none",
            "user: prompt expired",
            "user: no response from the user",
            "user: user did not answer; skill default is none",
            "user: 提问超时，按默认 none",
            "user: 询问后用户未回复",
            "user: 用户没有回答",
            "user: skip-and-continue",
            "user: AskUserQuestion for the selection timed out",
            "user: the question was skipped",
            "user: prompt dismissed",
            "user: 弹窗无人回答",
            "user: none (defaulted to none)",
            "user: 自动按默认 none",
        ]
        answered = [
            "user: 不需要鸿蒙特性",
            "user: 用默认的就行",
            "user: none",
            "user: '最终要把应用安装到设备上并运行，确保不崩溃'",
            "user: build timeout is acceptable for now",
            "user: 这个问题先跳过，后面再说",
            "user: 问题出在 timeout 配置，同意降级",
            "user: question about build timeout: accept stub",
            "user: skip this question, no features",
            "user: the task timed out last time, still choose none",
        ]
        for evidence in unanswered:
            self.assertFalse(phase_gate.user_approved(row(evidence)), evidence)
        for evidence in answered:
            self.assertTrue(phase_gate.user_approved(row(evidence)), evidence)


# --------------------------------------------------------------------------- 3-4. enter / exit

class GateBase(Base):
    def activate(self, *features):
        user_decision(self.root, "DEC-002", " ".join(features))
        code, out = self.hooks("activate", str(self.root), "--decision", "DEC-002", *sum((["--select", f] for f in features), []))
        self.assertEqual(code, 0, out)


class GateTest(GateBase):
    def test_enter_requires_open_host_phase_and_entry(self):
        make_feature(self.features, "cap-a", "capability")
        self.activate("cap-a")
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("not open yet", out)
        self.assertIn("phase implementation has passed", out)
        self.assertTrue(self.adoption()["entry_gate"].startswith("BLOCKED"))
        pass_phases(self.root, "baseline", "inventory", "contract", "pilot", "implementation")
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.adoption()["status"], "in-progress")
        self.assertTrue((self.root / "features" / "FEAT-001").is_dir())

    def test_enter_after_serial_and_drift(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "cap-b", "capability", hook={"phase": "features", "after": ["cap-a"]})
        make_feature(self.features, "cap-c", "capability")
        self.activate("cap-a", "cap-b", "cap-c")
        pass_phases(self.root, "baseline", "inventory", "contract", "pilot", "implementation")
        code, out = self.gate("enter", str(self.root), "FEAT-002")
        self.assertIn("hook.after: cap-a must be closed first", out)
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        code, out = self.gate("enter", str(self.root), "FEAT-003")
        self.assertIn("one at a time", out)
        (self.features / "cap-c" / "feature.md").write_text("changed", encoding="utf-8")
        code, out = self.gate("enter", str(self.root), "FEAT-003")
        self.assertIn("changed since activation", out)
        user_decision(self.root, "DEC-010", "repin", scope="FEAT-003")
        self.assertEqual(self.hooks("repin", str(self.root), "FEAT-003", "--decision", "DEC-010")[0], 0)
        self.assertEqual(self.adoption("FEAT-003")["package_sha256"], fp.package_hash(self.features / "cap-c"))

    def test_exit_attempts_and_limit(self):
        make_feature(self.features, "cap-a", "capability", exit={"criteria": [{"check": "validation-passed", "ids": "row"}], "max_attempts": 2})
        self.activate("cap-a")
        pass_phases(self.root, "baseline", "inventory", "contract", "pilot", "implementation")
        self.gate("enter", str(self.root), "FEAT-001")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("lists no validation_ids", out)
        self.assertIn("capability_ids are listed", out)
        self.assertEqual(self.adoption()["attempts"], "1")
        self.gate("exit", str(self.root), "FEAT-001")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertIn("max_attempts=2", out)
        self.assertEqual(self.adoption()["attempts"], "2")
        user_decision(self.root, "DEC-009", "retry", scope="FEAT-001")
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", capability_ids="CAP-001", validation_ids="VAL-001")
        code, out = self.gate("exit", str(self.root), "FEAT-001", "--decision", "DEC-009")
        self.assertEqual(code, 0, out)
        row = self.adoption()
        self.assertEqual(row["status"], "passed")
        self.assertRegex(row["exit_gate"], r"^READY @\S+ digest=[0-9a-f]{16}$")

    def test_command_timeout_and_logs(self):
        package = make_feature(self.features, "ver-a", "verification", exit={"criteria": [
            {"check": "command", "run": ["python", "{package}/checks/slow.py"], "timeout_s": 1}]})
        (package / "checks").mkdir()
        (package / "checks" / "slow.py").write_text("import time\ntime.sleep(5)\n", encoding="utf-8")
        self.activate("ver-a")
        pass_phases(self.root, *phase_gate.PHASES[:-1])
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertIn("timeout after 1s", out)
        self.assertTrue((self.root / "features" / "FEAT-001" / "exit-1.log").is_file())

    def test_verification_source_change_and_restart(self):
        criteria = [{"check": "validation-passed", "ids": "row"},
                    {"check": "command", "run": ["python", "{package}/skill/scripts/judge.py", "--workdir", "{workdir}"]}]
        package = make_feature(self.features, "ver-a", "verification", exit={"criteria": criteria, "max_attempts": 3})
        self.activate("ver-a")
        pass_phases(self.root, *phase_gate.PHASES[:-1])
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        self.assertTrue(self.adoption()["source_fingerprint"].startswith("sha256:"))
        workdir = self.root / "features" / "FEAT-001"
        (workdir / "report.json").write_text(json.dumps({"result": "pass", "cases": [{"result": "pass"}]}), encoding="utf-8")
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", validation_ids="VAL-001")
        (self.root.parent.parent / "src" / "main.cpp").write_text("int main() { return 1; }\n", encoding="utf-8")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("they changed", out)
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001", "--restart")[0], 0)
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertIn("vendor judge: pass", (workdir / "exit-2.log").read_text(encoding="utf-8"))
        self.assertTrue(package.is_dir())


# --------------------------------------------------------------------------- 5. host-phase gate

class PhaseGateTest(GateBase):
    def run_cap(self):
        make_feature(self.features, "cap-a", "capability")
        self.activate("cap-a")
        pass_phases(self.root, "baseline", "inventory", "contract", "pilot", "implementation")
        self.gate("enter", str(self.root), "FEAT-001")
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", capability_ids="CAP-001", validation_ids="VAL-001")

    def test_in_progress_blocks_and_next_step_shows_it(self):
        self.run_cap()
        errors = self.evaluate("features")
        self.assertTrue(any("still in-progress" in error for error in errors), errors)
        self.hooks("progress", str(self.root), "FEAT-001", "--step", "接入代码")
        self.assertEqual(next_step.hooked_features(self.root, "features")[0].split(" -> ")[0],
                         "- FEAT-001 cap-a [capability] in-progress, step: 接入代码")
        self.assertIn("| 接入代码 |", (self.root / "STATE.md").read_text(encoding="utf-8"))

    def test_hand_written_passed_rejected(self):
        self.run_cap()
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", status="passed")
        self.assertTrue(any("without a feature_gate.py exit record" in error for error in self.evaluate("features")))

    def test_evidence_changed_after_exit(self):
        self.run_cap()
        self.assertEqual(self.gate("exit", str(self.root), "FEAT-001")[0], 0)
        self.assertEqual(self.evaluate("features"), [])
        update_tsv(self.root / "validation.tsv", "VAL-001", status="failed")
        errors = self.evaluate("features")
        self.assertTrue(any("evidence changed after its exit gate" in error for error in errors), errors)

    def test_deferred_needs_user_decision(self):
        self.run_cap()
        user_decision(self.root, "DEC-011", "defer", scope="FEAT-001", owner="agent")
        code, out = self.hooks("close", str(self.root), "FEAT-001", "--status", "deferred-approved", "--decision", "DEC-011")
        self.assertEqual(code, 1)
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", status="deferred-approved", decision_id="DEC-011")
        self.assertTrue(any("without a user-approved decision" in error for error in self.evaluate("features")))
        user_decision(self.root, "DEC-012", "defer", scope="FEAT-001")
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", status="in-progress")
        self.assertEqual(self.hooks("close", str(self.root), "FEAT-001", "--status", "deferred-approved", "--decision", "DEC-012")[0], 0)
        write_tsv(self.root / "decisions.tsv", [r for r in phase_gate.read_rows(self.root / "decisions.tsv") if r["id"] != "DEC-011"])
        self.assertEqual(self.evaluate("features"), [])

    def test_handoff_needs_report_lines(self):
        self.run_cap()
        self.gate("exit", str(self.root), "FEAT-001")
        errors = self.evaluate("handoff")
        self.assertTrue(any("report.md External features does not list FEAT-001" in error for error in errors), errors)


# --------------------------------------------------------------------------- 6. legacy ledgers

class LegacyTest(Base):
    LEGACY = ["id", "feature_id", "playbook_path", "playbook_sha256", "status", "capability_ids", "validation_ids", "decision_id", "notes", "evidence"]

    def test_not_applicable_row_passes(self):
        write_tsv(self.root / fp.ADOPTION, [{"id": "FEAT-001", "feature_id": "none", "playbook_path": "none", "playbook_sha256": "none",
                                             "status": "not-applicable", "evidence": "contract: no feature selected"}], self.LEGACY)
        self.assertEqual(self.evaluate("handoff"), [])

    def test_legacy_rules_still_apply(self):
        write_tsv(self.root / fp.ADOPTION, [{"id": "FEAT-001", "feature_id": "old", "playbook_path": "old/feature.md",
                                             "status": "planned"}], self.LEGACY)
        self.assertTrue(any("feature rows must end verified" in error for error in self.evaluate("features")))
        self.assertEqual(self.evaluate("implementation"), [])

    def test_validate_ledgers_warns(self):
        import subprocess
        write_tsv(self.root / fp.ADOPTION, [{"id": "FEAT-001", "feature_id": "none", "playbook_path": "none", "playbook_sha256": "none",
                                             "status": "not-applicable", "evidence": "x"}], self.LEGACY)
        done = subprocess.run([sys.executable, str(REPO / "scripts" / "validate_ledgers.py"), str(self.root), "--no-skill-check"],
                              capture_output=True, text=True)
        self.assertIn("compatibility mode", done.stdout)
        self.assertNotIn("feature-adoption.tsv has no data rows", done.stdout)


# --------------------------------------------------------------------------- 7. end to end

class EndToEndTest(GateBase):
    def test_contract_to_handoff(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification")
        self.activate("cap-a", "ver-a")
        for phase in ("baseline", "inventory", "contract", "pilot", "implementation"):
            self.assertEqual(self.evaluate(phase), [], phase)
            gate_state.record_gate(self.root, phase, [], "test")
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-002")[0], 1)  # handoff not open
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", capability_ids="CAP-001", validation_ids="VAL-001")
        self.assertEqual(self.gate("exit", str(self.root), "FEAT-001")[0], 0)
        for phase in ("features", "diagnostics"):
            self.assertEqual(self.evaluate(phase), [], phase)
            gate_state.record_gate(self.root, phase, [], "test")
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-002")[0], 0)
        workdir = self.root / "features" / "FEAT-002"
        (workdir / "report.json").write_text(json.dumps({"result": "pass", "cases": [{"result": "pass"}]}), encoding="utf-8")
        update_tsv(self.root / fp.ADOPTION, "FEAT-002", validation_ids="VAL-001")
        code, out = self.gate("exit", str(self.root), "FEAT-002")
        self.assertEqual(code, 0, out)
        report = (self.root / "report.md").read_text(encoding="utf-8").replace(
            "- none activated\n", "- FEAT-001 cap-a: passed\n- FEAT-002 ver-a: passed (features/FEAT-002/report.json)\n")
        (self.root / "report.md").write_text(report, encoding="utf-8")
        self.assertEqual(self.evaluate("handoff"), [])


# --------------------------------------------------------------------------- 8. the delivered skill stays intact

def tree(path: Path) -> dict[str, str]:
    return {item.relative_to(path).as_posix(): fp.sha256_file(item) for item in sorted(path.rglob("*")) if item.is_file()}


class SkillFeatureTest(GateBase):
    def lint(self, feature_id):
        return self.hooks("lint", "--kb-root", str(self.kb), feature_id)

    def test_lint_keeps_the_skill_complete_and_untouched(self):
        package = make_feature(self.features, "ver-skill", "verification")
        (package / "skill" / "SKILL.md").write_text("# no frontmatter\n", encoding="utf-8")
        self.assertIn("frontmatter lacks name, description", self.lint("ver-skill")[1])
        (package / "skill" / "SKILL.md").unlink()
        self.assertIn("has no SKILL.md", self.lint("ver-skill")[1])
        (package / "skill" / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
        (package / "skill" / "hook.json").write_text("{}", encoding="utf-8")
        self.assertIn("hook.json must stay outside the skill directory", self.lint("ver-skill")[1])
        (package / "skill" / "hook.json").unlink()
        self.assertEqual(self.lint("ver-skill")[0], 0)
        make_feature(self.features, "ver-inside", "verification", playbook="skill/SKILL.md")
        self.assertIn("must stay outside the skill directory", self.lint("ver-inside")[1])
        make_feature(self.features, "ver-escape", "verification", skill="../ver-skill/skill")
        self.assertIn("must be a subdirectory of the package", self.lint("ver-escape")[1])

    def test_adapter_sections(self):
        package = make_feature(self.features, "cap-skill", "capability")
        text = (package / "feature.md").read_text(encoding="utf-8").replace("## 执行入口", "## 入口")
        (package / "feature.md").write_text(text, encoding="utf-8")
        self.assertIn("missing adapter sections for kind capability: 执行入口", self.lint("cap-skill")[1])

    def test_skill_runs_through_the_same_gates_untouched(self):
        criteria = [{"check": "validation-passed", "ids": "row"},
                    {"check": "artifact", "path": "{workdir}/report.json", "json": {"result": "pass"}},
                    {"check": "command", "run": ["python", "{package}/skill/scripts/judge.py", "--workdir", "{workdir}"]}]
        package = make_feature(self.features, "ver-skill", "verification", exit={"criteria": criteria, "max_attempts": 3})
        self.assertEqual(self.lint("ver-skill")[0], 0)
        before = tree(package / "skill")
        self.activate("ver-skill")
        pass_phases(self.root, *phase_gate.PHASES[:-1])
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertIn(str(package / "skill" / "SKILL.md"), out)
        self.assertIn("never edit the skill directory", out)
        workdir = self.root / "features" / "FEAT-001"
        update_tsv(self.root / fp.ADOPTION, "FEAT-001", validation_ids="VAL-001")
        (workdir / "report.json").write_text(json.dumps({"result": "fail"}), encoding="utf-8")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("vendor judge: fail", out)
        (workdir / "report.json").write_text(json.dumps({"result": "pass"}), encoding="utf-8")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertEqual(tree(package / "skill"), before)
        report = (self.root / "report.md").read_text(encoding="utf-8").replace("- none activated\n", "- FEAT-001 ver-skill: passed\n")
        (self.root / "report.md").write_text(report, encoding="utf-8")
        self.assertEqual(self.evaluate("handoff"), [])

    def test_replacing_the_skill_is_drift(self):
        package = make_feature(self.features, "ver-skill", "verification")
        self.activate("ver-skill")
        pass_phases(self.root, *phase_gate.PHASES[:-1])
        (package / "skill" / "references" / "cases.md").write_text("# cases v2\n", encoding="utf-8")
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("changed since activation", out)


# --------------------------------------------------------------------------- 9. guided registration of a delivered skill

NFC_SKILL_MD = """---
name: nfc-share
description: 在 Qt 应用中接入“碰一碰分享”能力。当用户提到碰一碰、tap to share 时使用。
version: 1.2.0
---
# 碰一碰分享接入

## 步骤1 声明权限
在 module.json5 声明 ohos.permission.NFC_TAG 权限。

## 步骤2 接入代码
调用接口实现分享。先运行 `pip install pyyaml` 安装依赖。

## 步骤3 真机验证
用 hdc 安装到两台手机真机，碰一碰确认传输成功。
"""


class RegisterTest(Base):
    def setUp(self):
        super().setUp()
        shutil.copytree(FEATURE_TEMPLATES, self.features / "_templates")
        self.delivery = self.tmp / "delivery"
        self.cap = self.delivery / "nfc-share"
        (self.cap / "scripts").mkdir(parents=True)
        (self.cap / ".git").mkdir()
        (self.cap / ".git" / "HEAD").write_text("ref\n", encoding="utf-8")
        (self.cap / "SKILL.md").write_text(NFC_SKILL_MD, encoding="utf-8")
        (self.cap / "scripts" / "verify_share.py").write_text("print('ok')\n", encoding="utf-8")
        self.ver = self.delivery / "vendor-acceptance"
        (self.ver / "scripts").mkdir(parents=True)
        (self.ver / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
        (self.ver / "scripts" / "judge.py").write_text(JUDGE, encoding="utf-8")

    def register(self, *argv):
        return run(feature_register, "--features-root", str(self.features), *argv)

    def scaffold(self, skill, feature_id, kind, *extra):
        return self.register("scaffold", "--skill", str(skill), "--id", feature_id, "--kind", kind, "--title", "碰一碰分享",
                             "--owner", "team-x", "--summary", "两台设备碰一碰传输文件", "--keyword", "碰一碰", *extra)

    def test_inspect_suggests_options_from_the_skill(self):
        code, out = self.register("inspect", str(self.cap))
        self.assertEqual(code, 0, out)
        facts = json.loads(out)
        hints = facts["suggestions"]
        self.assertEqual(hints["kind"]["value"], "capability")
        self.assertEqual(hints["feature_id"][0]["value"], "harmonyos-nfc-share")
        self.assertIn("碰一碰", hints["keywords"])
        self.assertIn("tap to share", hints["keywords"])
        self.assertTrue(hints["device"]["value"])
        self.assertEqual(hints["milestones"][0], "步骤1 声明权限")
        self.assertEqual(hints["ohos_permissions"], ["ohos.permission.NFC_TAG"])
        self.assertIn("installs-dependencies", {item["signal"] for item in hints["overrides"]})
        self.assertTrue(any(item["predicate"]["check"] == "command" for item in hints["exit_options"]))
        code, out = self.register("inspect", str(self.ver))
        self.assertEqual(json.loads(out)["suggestions"]["kind"]["value"], "verification")

    def test_inspect_reports_an_incomplete_delivery(self):
        (self.cap / "hook.json").write_text("{}", encoding="utf-8")
        code, out = self.register("inspect", str(self.cap))
        self.assertEqual(code, 1)
        self.assertIn("hook.json belongs outside the skill", out)

    def test_scaffold_builds_a_lint_clean_draft_and_keeps_the_skill_intact(self):
        before = tree(self.cap)
        code, out = self.scaffold(self.cap, "harmonyos-nfc-share", "capability", "--keyword", "tap to share",
                                  "--device", "yes", "--milestone", "声明权限", "--milestone", "接入代码",
                                  "--exit-command", "python3 {package}/skill/scripts/verify_share.py")
        self.assertEqual(code, 0, out)
        package = self.features / "harmonyos-nfc-share"
        self.assertEqual(tree(self.cap), before)
        copied = tree(package / "skill")
        self.assertEqual(copied, {k: v for k, v in before.items() if not k.startswith(".git/")})
        hook = fp.load_hook(package)
        self.assertEqual((hook["version"], hook["owner"], hook["skill"]), ("1.2.0", "team-x", "skill"))
        self.assertEqual(hook["trigger"]["keywords"], ["碰一碰", "tap to share"])
        self.assertEqual(hook["milestones"], ["声明权限", "接入代码"])
        self.assertEqual([c["check"] for c in hook["exit"]["criteria"]], ["validation-passed", "command"])
        self.assertEqual(fp.read_registry(self.features)["harmonyos-nfc-share"]["status"], "draft")
        self.assertIn("# 碰一碰分享（capability", (package / "feature.md").read_text(encoding="utf-8"))
        code, out = self.hooks("lint", "--kb-root", str(self.kb), "harmonyos-nfc-share")
        self.assertEqual(code, 0, out)
        self.assertIn("TODO placeholder", out)

    def test_scaffold_without_device_drops_the_device_requirements(self):
        code, out = self.scaffold(self.cap, "harmonyos-nfc-share", "capability", "--device", "no")
        self.assertEqual(code, 0, out)
        hook = fp.load_hook(self.features / "harmonyos-nfc-share")
        self.assertFalse(hook["permissions"]["device"])
        self.assertNotIn("device-runs.tsv", hook["outputs"]["ledgers"])
        self.assertFalse(any(item.get("ledger") == "device-runs.tsv" for item in hook["entry"]["requires"]))

    def test_scaffold_verification_with_artifact_verdict(self):
        code, out = self.scaffold(self.ver, "ext-vendor-acceptance", "verification", "--device", "no",
                                  "--exit-artifact", "verdict.json", "--exit-json", "status=ok", "--exit-json", "clean=true")
        self.assertEqual(code, 0, out)
        hook = fp.load_hook(self.features / "ext-vendor-acceptance")
        self.assertEqual(hook["hook"]["phase"], "handoff")
        self.assertFalse(hook["permissions"]["modify_sources"])
        self.assertEqual(hook["exit"]["criteria"][1],
                         {"check": "artifact", "path": "{workdir}/verdict.json", "json": {"status": "ok", "clean": True}})
        self.assertEqual(hook["outputs"]["evidence_files"], ["{workdir}/verdict.json"])
        code, out = self.hooks("lint", "--kb-root", str(self.kb), "ext-vendor-acceptance")
        self.assertEqual(code, 0, out)

    def test_scaffold_accepts_a_skill_already_placed_in_the_package(self):
        target = self.features / "harmonyos-nfc-share" / "skill"
        shutil.copytree(self.cap, target, ignore=shutil.ignore_patterns(".git"))
        code, out = self.scaffold(target, "harmonyos-nfc-share", "capability", "--device", "yes")
        self.assertEqual(code, 0, out)
        self.assertTrue((self.features / "harmonyos-nfc-share" / "hook.json").is_file())

    def test_scaffold_refuses_conflicts(self):
        self.assertEqual(self.scaffold(self.cap, "harmonyos-nfc-share", "capability", "--device", "yes")[0], 0)
        code, out = self.scaffold(self.cap, "harmonyos-nfc-share", "capability", "--device", "yes")
        self.assertEqual(code, 1)
        self.assertIn("already exists", out)
        (self.ver / "hook.json").write_text("{}", encoding="utf-8")
        code, out = self.scaffold(self.ver, "ext-vendor-acceptance", "verification", "--device", "no")
        self.assertEqual(code, 1)
        self.assertIn("must stay outside the skill", out)
        self.assertFalse((self.features / "ext-vendor-acceptance").exists())


if __name__ == "__main__":
    unittest.main()

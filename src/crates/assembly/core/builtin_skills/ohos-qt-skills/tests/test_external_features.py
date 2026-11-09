#!/usr/bin/env python3
"""Tests of the external feature (hook) mechanism.

Run from the repository root:  python -m unittest discover -s tests
Every test builds its own migration root and features/ directory in a temp
directory; the real features/registry.tsv is never used.
"""
from __future__ import annotations

import contextlib
import csv
import hashlib
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
import ledger  # noqa: E402
import next_step  # noqa: E402
import ohos_env  # noqa: E402
import phase_gate  # noqa: E402
import vocab  # noqa: E402

TEMPLATES = REPO / "assets" / "templates" / "migration" / "ohos"
FEATURE_TEMPLATES = REPO / "features" / "_templates"
# The Qt application directory name the fixtures use; the migration project is
# a subdirectory of the output container, next to its `migration/ohos` ledger.
APP_NAME = "app"


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


def write_env(target: Path, *, paths: dict[str, str] | None = None, env_set: dict[str, str] | None = None,
              path_prepend: list[str] | None = None, abi: str = "arm64-v8a", qt_modules: list[str] | None = None,
              short_cache_dir: str = "", status: dict[str, str] | None = None) -> Path:
    """Write an environment table (a migration root or a file) the way env_probe.py lays it out; returns its path.

    ``paths`` uses the profile keys (qt_sdk, template, devecocli, make, native_sdk, ohos_sdk_dir...),
    ``env_set``/``path_prepend`` the injected environment, ``status`` overrides an item's status.
    """
    target = Path(target)
    path = target / ohos_env.ENV_PROFILE if target.is_dir() else target
    items = {name: {"item": name, "path": "", "version": "", "detail": "", "status": "ok", "issue": "", "command_env": []}
             for name in vocab.ENV_REQUIRED_ITEMS + ("host", "python")}
    by_key = {key: item for item, key in ohos_env.ITEM_PATHS.items()}
    variables = dict(env_set or {})
    for key, value in (paths or {}).items():
        if key in by_key:
            items.setdefault(by_key[key], {"item": by_key[key], "path": "", "version": "", "detail": "", "status": "ok",
                                           "issue": "", "command_env": []})["path"] = value
        elif key == "native_sdk":
            variables.setdefault("NATIVE_OHOS_SDK", value)
        elif key == "ohos_sdk_dir":
            variables.setdefault("OHOS_SDK_DIR", value)
    items["host"]["path"] = short_cache_dir
    items["host"]["command_env"] += [("PATH", entry) for entry in (path_prepend or [])]
    items["qt-sdk"]["command_env"].append(("OHOS_TARGET_ARCH", abi))
    items["qt-sdk"]["detail"] = f"ABI {abi}; {len(qt_modules or [])} modules: " + ", ".join(qt_modules or [])
    items["python"]["command_env"] += [(name, value) for name, value in variables.items() if name != "OHOS_TARGET_ARCH"]
    for name, value in (status or {}).items():
        items.setdefault(name, {"item": name, "path": "", "version": "", "detail": "", "issue": "", "command_env": []})
        items[name]["status"] = value
    order = {name: index for index, name in enumerate(vocab.ENV_ITEM_ORDER)}
    rows = [{**row, "command_env": ohos_env.format_command_env(row["command_env"])}
            for row in sorted(items.values(), key=lambda row: order.get(row["item"], 99))]
    ohos_env.write_environment(path, rows)
    return path


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


def set_scope(root: Path, **values: str) -> None:
    """Write STATE.md Scope rows: ``source`` (init), ``project`` (decisions phase)."""
    lines = (root / "STATE.md").read_text(encoding="utf-8").splitlines(keepends=True)
    fields = {"source": phase_gate.SCOPE_SOURCE, "project": phase_gate.SCOPE_PROJECT}
    values = {fields[key]: value for key, value in values.items()}
    for index, line in enumerate(lines):
        label = line.split("|")[1].strip() if line.startswith("|") else ""
        if label in values:
            lines[index] = f"| {label} | {values[label]} | test fixture |\n"
    (root / "STATE.md").write_text("".join(lines), encoding="utf-8")


def make_app(base: Path) -> Path:
    """A minimal Qt app whose ledgers satisfy every gate when no feature is involved.

    Returns the ledger root ``<base>/output/migration/ohos``; the Qt sources are ``<base>/app``.
    """
    app = base / APP_NAME
    (app / "src").mkdir(parents=True)
    (app / "CMakeLists.txt").write_text("project(demo)\n", encoding="utf-8")
    (app / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")
    # The output container holds the ledger and, next to it, the HarmonyOS project.
    container = base / "output"
    root = container / "migration" / "ohos"
    shutil.copytree(TEMPLATES, root)
    (root / "knowledge-manifest.tsv").write_text(
        "baseline_manifest_sha256\tsource_revision\tsource_path\tsource_sha256\tskill_snapshot_path\tskill_snapshot_sha256\t"
        "snapshot_path\tsnapshot_sha256\tused\tmodified\taction\tlast_synced_at\n", encoding="utf-8")
    ev = "log/receipt.txt sha256:abc"
    project = container / f"{APP_NAME}-ohos"
    (project / "AppScope").mkdir(parents=True)
    for marker in phase_gate.OHOS_PROJECT_MARKERS:
        (project / marker).write_text("{}\n", encoding="utf-8")
    # Tool outputs the gates read: environment profile, environment smoke and build-file preflights.
    write_env(root)
    (root / "env-smoke.json").write_text(json.dumps({"status": "passed", "summary": "pass",
                                                     "runtime": {"status": "passed"}}), encoding="utf-8")
    (root / "preflight.json").write_text(json.dumps({"findings": []}), encoding="utf-8")
    (root / "preflight-configured.json").write_text(json.dumps({"findings": []}), encoding="utf-8")
    write_tsv(root / "inventory.tsv", [
        {"id": "INV-001", "category": "build", "location": "build-file: CMakeLists.txt", "cause": "x builds on hosts; y on OHOS",
         "found_by": "scan: platform-code", "disposition": "guarded-adaptation", "target_behavior": "same"}])
    write_tsv(root / "tasks.tsv", [
        {"id": "TASK-001", "task": "build", "inventory_ids": "INV-001", "validation_ids": "VAL-001", "status": "passed",
         "evidence": ev}])
    write_tsv(root / "validation.tsv", [
        {"id": "VAL-001", "scenario": "launch", "steps": "hdc", "expected": "starts", "status": "passed",
         "evidence": "starts; " + ev}])
    write_tsv(root / "diagnostics.tsv", [
        {"id": "DIAG-001", "location": "build: step make", "symptom": "undefined reference to foo", "cause": "x not linked",
         "reproduce": "make; log: out/01-make.stdout.log", "fix": "link x", "status": "fixed"}])
    write_tsv(root / "decisions.tsv", [{"id": "DEC-001", "question": "Qt version", "answer": "a", "owner": "user"}])
    hap = root / "fixture-hap" / "entry-default-signed.hap"  # under migration/: not a source change
    hap.parent.mkdir(parents=True, exist_ok=True)
    hap.write_bytes(b"x")
    write_tsv(root / "device-runs.tsv", [
        {"id": "DEV-RUN-001", "hap": f"{hap} (com.example.demo)", "status": "run",
         "evidence": "batch batches/pack: hap_check.py passed; signed; device: pid 4242 alive after 6s; "
                     "hilog clean of crash/load-failure lines; logs l"}])
    state = (root / "STATE.md").read_text(encoding="utf-8").replace("- Assessment: `TODO`", "- Assessment: `ready`")
    state = state.replace("| TODO | TODO |", "| set | set |")  # the Scope table
    state = state.replace("| Application target | set | set |", f"| Application target | {APP_NAME} | CMakeLists.txt |")
    (root / "STATE.md").write_text(state, encoding="utf-8")
    set_scope(root, source=app.as_posix(), project=project.as_posix())
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


# Phases 1-5: the base Qt migration, which never deals with external features.
BASE_PHASES = phase_gate.PHASES[:phase_gate.PHASES.index("features")]


def open_features(root: Path) -> None:
    """The base migration passed diagnostics: the features phase is open."""
    pass_phases(root, *BASE_PHASES)


def reopen_phase(root: Path, phase: str) -> None:
    path = root / "STATE.md"
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    for index, line in enumerate(lines):
        if f"(`{phase}`" in line:
            lines[index] = line.replace("| passed |", "| in-progress |")
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


def make_feature(features: Path, feature_id: str, kind: str, **hook_changes) -> Path:
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
    registry = features / "registry.tsv"
    if not registry.is_file():
        registry.write_text("\t".join(feature_hooks.REGISTRY_FIELDS) + "\n", encoding="utf-8")
    append_tsv(registry, {"feature_id": feature_id, "title": hook["title"], "kind": kind,
                          "package_path": f"{feature_id}/", "owner": "test", "summary": "skill feature"})
    return package


def cap_verdict(root: Path, feat: str = "FEAT-001", result: str = "pass") -> None:
    """The verdict file the capability template's exit criterion reads."""
    workdir = root / "features" / feat
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "result.json").write_text(json.dumps({"result": result, "cases": []}), encoding="utf-8")


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
        # Whatever the shipped registry offers, selecting nothing (no FEAT
        # rows) lets every gate pass; this does not depend on its contents.
        self.assertEqual(phase_gate.evaluate(self.root, "validation"), [])

    def test_offered_features_wait_for_the_users_selection(self):
        # Offered features are optional (default: none), but the user answers the selection
        # before the features gate passes; until then the phase is blocked.
        make_feature(self.features, "cap-a", "capability")
        for phase in BASE_PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)
        self.assertTrue(any("has not answered which external features" in e for e in self.evaluate("features")))
        open_features(self.root)
        state = self.root / "STATE.md"
        state.write_text(state.read_text(encoding="utf-8").replace("- Current phase: `TODO`", "- Current phase: `features`")
                         .replace("| Features (`features`, features.tsv) | planned |",
                                  "| Features (`features`, features.tsv) | in-progress |"), encoding="utf-8")
        self.assertEqual(self.hooks("candidates", str(self.root))[0], 0)
        text = state.read_text(encoding="utf-8")
        self.assertIn("- Feature selection: `pending`", text)
        self.assertIn("| Features (`features`, features.tsv) | blocked |", text)
        self.assertTrue(any("waiting for the answer" in e for e in self.evaluate("features")))
        self.assertEqual(self.hooks("activate", str(self.root), "--answer", "都不需要")[0], 0)
        text = state.read_text(encoding="utf-8")
        self.assertRegex(text, r"- Feature selection: `answered` @\S+: 都不需要")
        self.assertIn("| Features (`features`, features.tsv) | in-progress |", text)
        for phase in phase_gate.PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)

    def test_phase_order_is_shared(self):
        self.assertEqual(phase_gate.PHASES, ("environment", "inventory", "decisions", "tasks",
                                             "diagnostics", "features", "validation"))
        self.assertEqual(gate_state.PHASE_ORDER, phase_gate.PHASES)
        self.assertEqual(tuple(next_step.PHASE_GUIDE), phase_gate.PHASES)
        template = (REPO / "assets" / "templates" / "migration" / "ohos" / "STATE.md").read_text(encoding="utf-8")
        statuses = gate_state._progress_statuses(template.splitlines(keepends=True))
        self.assertEqual(tuple(statuses), phase_gate.PHASES)


# --------------------------------------------------------------------------- layout

class LayoutTest(Base):
    """The HarmonyOS project is a subdirectory of the output container that holds migration/."""

    def project(self) -> Path:
        return Path(phase_gate.scope_value((self.root / "STATE.md").read_text(encoding="utf-8"),
                                           phase_gate.SCOPE_PROJECT))

    def test_project_is_required_from_the_decisions_phase_on(self):
        set_scope(self.root, project="TODO")
        for phase in phase_gate.PHASES[:2]:
            self.assertFalse(any("HarmonyOS output project" in error for error in self.evaluate(phase)), phase)
        for phase in phase_gate.PHASES[2:]:
            self.assertTrue(any("does not record the HarmonyOS output project" in error
                                for error in self.evaluate(phase)), phase)

    def test_project_must_be_a_subdirectory_of_the_container(self):
        elsewhere = self.root.parent.parent.parent / "elsewhere" / "app-ohos"
        set_scope(self.root, project=elsewhere.as_posix())
        self.assertTrue(any("must be a subdirectory of the output container" in error
                            for error in self.evaluate("decisions")))

    def test_any_name_and_any_container_content_pass(self):
        # The project name comes from the BitFun binding or the agent; the container may be
        # the repository itself, so nothing else in its root is checked.
        container = self.root.parent.parent
        renamed = container / "RealCompare-ohos-2"
        self.project().rename(renamed)
        set_scope(self.root, project=renamed.as_posix())
        (container / "src").mkdir()
        (container / "node-screenshot.jpeg").write_bytes(b"x")
        for phase in phase_gate.PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)

    def test_recorded_project_must_exist_from_the_tasks_gate_on(self):
        shutil.rmtree(self.project())
        self.assertEqual(self.evaluate("decisions"), [])
        self.assertTrue(any("does not exist" in error for error in self.evaluate("tasks")))


# --------------------------------------------------------------------------- 1. lint

class LintTest(Base):
    def lint(self, feature_id):
        return self.hooks("lint", "--kb-root", str(self.kb), feature_id)

    def test_templates_lint_clean(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification")
        code, out = self.hooks("lint", "--kb-root", str(self.kb))
        self.assertEqual(code, 0, out)
        self.assertIn("OK    cap-a", out)

    def test_errors(self):
        cases = {
            "bad-phase": dict(hook={"phase": "pilot", "after": []}),
            "bad-kind": dict(hook={"phase": "validation", "after": []}),
            "unknown-pred": dict(exit={"criteria": [{"check": "magic"}]}),
            "cmd-in-entry": dict(entry={"requires": [{"check": "command", "run": ["python", "{package}/x.py"]}]}),
            "no-keywords": dict(trigger={"keywords": []}),
            "trigger-mode": dict(trigger={"keywords": ["x"], "mode": "always"}),
            "no-exit": dict(exit={"criteria": []}),
            "bad-placeholder": dict(exit={"criteria": [{"check": "artifact", "path": "{home}/x"}]}),
            "no-skill": dict(skill=""),
            "other-ledger": dict(outputs={"ledgers": ["inventory.tsv", "validation.tsv"], "evidence_files": []}),
            "val-pred": dict(exit={"criteria": [{"check": "validation-passed", "ids": "row"}]}),
        }
        expected = {
            "bad-phase": "not an open hook point", "bad-kind": "accepts kind 'verification'", "unknown-pred": "unknown predicate",
            "cmd-in-entry": "not allowed in entry", "no-keywords": "trigger.keywords", "trigger-mode": "unknown fields",
            "no-exit": "at least one explicit condition", "bad-placeholder": "unknown placeholder",
            "no-skill": "must name the delivered skill directory",
            "other-ledger": "outputs.ledgers: 'inventory.tsv' is not allowed", "val-pred": "unknown predicate 'validation-passed'",
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
        rows[0]["kind"] = "verification"
        write_tsv(self.features / "registry.tsv", rows)
        code, out = self.lint("cap-sec")
        self.assertIn("differs from hook.json", out)

    def test_refs_and_cycles(self):
        make_feature(self.features, "cap-ref", "capability", refs=["semantic/missing.md"])
        code, out = self.lint("cap-ref")
        self.assertIn("does not exist in the current upstream-kb", out)
        make_feature(self.features, "cap-x", "capability", hook={"phase": "features", "after": ["cap-y"]})
        make_feature(self.features, "cap-y", "capability", hook={"phase": "features", "after": ["cap-x"]})
        code, out = self.hooks("lint", "--kb-root", str(self.kb))
        self.assertIn("forms a cycle", out)


# --------------------------------------------------------------------------- 2. candidates / activate / features gate

class ActivationTest(Base):
    def setUp(self):
        super().setUp()
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification",
                     trigger={"keywords": ["扩展验收", "acceptance suite"]})
        open_features(self.root)

    def test_candidates_list_all_registered_and_rank_hits(self):
        code, out = self.hooks("candidates", str(self.root), "--request", "迁移并跑扩展验收")
        self.assertEqual(code, 0)
        self.assertIn("cap-a", out)
        self.assertIn("ver-a", out)
        self.assertIn("mentioned in request: 扩展验收", out)
        self.assertIn("default: none", out)

    def test_activate_only_while_the_features_phase_is_open(self):
        reopen_phase(self.root, "diagnostics")
        code, out = self.hooks("activate", str(self.root), "--answer", "cap-a", "--select", "cap-a")
        self.assertEqual(code, 1, out)
        self.assertIn("selected in the features phase only", out)
        self.assertIn("diagnostics", out)
        self.assertEqual(fp.read_adoption(self.root), [])
        open_features(self.root)
        self.assertEqual(self.hooks("activate", str(self.root), "--answer", "cap-a", "--select", "cap-a")[0], 0)
        pass_phases(self.root, "features")
        code, out = self.hooks("activate", str(self.root), "--answer", "cap-a ver-a", "--select", "cap-a", "--select", "ver-a")
        self.assertEqual(code, 1, out)
        self.assertIn("already closed", out)

    def test_selected_none(self):
        code, out = self.hooks("activate", str(self.root), "--answer", "都不要")
        self.assertEqual(code, 0, out)
        self.assertEqual(fp.read_adoption(self.root), [])
        self.assertEqual(len(phase_gate.read_rows(self.root / "decisions.tsv")), 1)
        self.assertEqual(self.evaluate("validation"), [])

    def test_activate_rules(self):
        # The user's answer is required (it goes into notes, not decisions.tsv).
        code, out = self.hooks("activate", str(self.root), "--answer", " ", "--select", "cap-a")
        self.assertEqual(code, 1)
        self.assertIn("--answer is empty", out)
        code, out = self.hooks("activate", str(self.root), "--answer", "cap-x", "--select", "cap-x")
        self.assertIn("not registered", out)
        self.assertEqual(fp.read_adoption(self.root), [])

    def test_activate_writes_rows_and_state(self):
        code, out = self.hooks("activate", str(self.root), "--answer", "接入 cap-a 和 ver-a", "--select", "cap-a", "--select", "ver-a")
        self.assertEqual(code, 0, out)
        rows = fp.read_adoption(self.root)
        self.assertEqual([(r["id"], r["feature_id"], fp.host_phase(r), r["status"]) for r in rows],
                         [("FEAT-001", "cap-a", "features", "planned"), ("FEAT-002", "ver-a", "validation", "planned")])
        self.assertIn("user answer: 接入 cap-a 和 ver-a", rows[0]["notes"])
        self.assertEqual(fp.ADOPTION_FIELDS, fp.adoption_fields(self.root))
        # The answer is not a decisions.tsv row.
        self.assertEqual(len(phase_gate.read_rows(self.root / "decisions.tsv")), 1)
        # The rows live only in features.tsv; STATE.md shows them through ledger.py state.
        self.assertNotIn("FEAT-002", (self.root / "STATE.md").read_text(encoding="utf-8"))
        self.assertIn("- FEAT-002 ver-a [verification, validation] planned", ledger.show_state(self.root))
        for phase in BASE_PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)
        errors = self.evaluate("features")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("FEAT-001", errors[0])

    def test_hand_written_row_rejected(self):
        write_tsv(self.root / fp.ADOPTION, [{"id": "FEAT-001", "feature_id": "cap-x", "kind": "capability",
                                             "status": "planned"}])
        self.assertEqual(self.evaluate("diagnostics"), [])
        self.assertTrue(any("not registered" in error for error in self.evaluate("features")))


# --------------------------------------------------------------------------- 3-4. enter / exit

class GateBase(Base):
    def activate(self, *features):
        open_features(self.root)
        code, out = self.hooks("activate", str(self.root), "--answer", " ".join(features), *sum((["--select", f] for f in features), []))
        self.assertEqual(code, 0, out)


class GateTest(GateBase):
    def test_enter_requires_open_host_phase_and_entry(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification")
        self.activate("cap-a", "ver-a")
        code, out = self.gate("enter", str(self.root), "FEAT-002")
        self.assertEqual(code, 1)
        self.assertIn("host phase validation is not open yet", out)
        reopen_phase(self.root, "diagnostics")
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("not open yet", out)
        self.assertIn("phase diagnostics has passed", out)
        self.assertTrue(self.adoption()["entry_gate"].startswith("NOT-READY"))
        open_features(self.root)
        code, out = self.gate("enter", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.adoption()["status"], "in-progress")
        self.assertTrue((self.root / "features" / "FEAT-001").is_dir())

    def test_enter_after_and_serial(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "cap-b", "capability", hook={"phase": "features", "after": ["cap-a"]})
        make_feature(self.features, "cap-c", "capability")
        self.activate("cap-a", "cap-b", "cap-c")
        code, out = self.gate("enter", str(self.root), "FEAT-002")
        self.assertIn("hook.after: cap-a must be closed first", out)
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        code, out = self.gate("enter", str(self.root), "FEAT-003")
        self.assertIn("one at a time", out)

    def test_exit_attempts_and_limit(self):
        criteria = [{"check": "artifact", "path": "{workdir}/result.json", "json": {"result": "pass"}}]
        make_feature(self.features, "cap-a", "capability", exit={"criteria": criteria, "max_attempts": 2})
        self.activate("cap-a")
        self.gate("enter", str(self.root), "FEAT-001")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("result.json", out)
        self.assertNotIn("validation", out)
        self.assertEqual(self.adoption()["attempts"], "1")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertIn("blocked after 2 failed attempts", out)
        self.assertEqual((self.adoption()["attempts"], self.adoption()["status"]), ("2", "blocked"))
        # A blocked feature waits for the user: no further attempt, and the gate does not pass.
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertIn("is blocked, waiting for the user", out)
        self.assertEqual(self.adoption()["attempts"], "2")
        self.assertTrue(any("is blocked, waiting for the user" in e for e in self.evaluate("features")))
        cap_verdict(self.root)
        code, out = self.gate("exit", str(self.root), "FEAT-001", "--answer", "再试一次")
        self.assertEqual(code, 0, out)
        row = self.adoption()
        self.assertEqual(row["status"], "passed")
        # exit_gate keeps the reason of the last failed attempt.
        self.assertRegex(row["exit_gate"], r"^NOT-READY @\S+ \(.*result\.json")
        self.assertIn("attempts reset", row["notes"])
        self.assertIn("user answer: 再试一次", row["notes"])
        self.assertEqual(len(phase_gate.read_rows(self.root / "decisions.tsv")), 1)

    def test_implicit_exit_criteria(self):
        # Every feature: no open problem; a device feature: one passed application run. Nothing else.
        make_feature(self.features, "cap-a", "capability")
        self.activate("cap-a")
        self.gate("enter", str(self.root), "FEAT-001")
        cap_verdict(self.root)
        # A rebuilt HAP that has not run on the device yet (checked) does not satisfy device=true.
        update_tsv(self.root / "device-runs.tsv", "DEV-RUN-001", status="checked")
        append_tsv(self.root / "diagnostics.tsv", {"id": "DIAG-002", "location": "build: FEAT-001", "symptom": "x",
                                                   "reproduce": "make; log: l", "status": "open"})
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertIn("device-runs.tsv shows the latest application HAP ran on the device (status run; now: checked)", out)
        self.assertIn("open", out)
        update_tsv(self.root / "device-runs.tsv", "DEV-RUN-001", status="run")
        update_tsv(self.root / "diagnostics.tsv", "DIAG-002", cause="c", fix="f", status="fixed")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)

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

    def test_verification_restart_keeps_attempts(self):
        criteria = [{"check": "command", "run": ["python", "{package}/skill/scripts/judge.py", "--workdir", "{workdir}"]}]
        package = make_feature(self.features, "ver-a", "verification", exit={"criteria": criteria, "max_attempts": 3})
        self.activate("ver-a")
        pass_phases(self.root, *phase_gate.PHASES[:-1])
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        workdir = self.root / "features" / "FEAT-001"
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 1)
        self.assertEqual(self.adoption()["attempts"], "1")
        (workdir / "report.json").write_text(json.dumps({"result": "pass", "cases": [{"result": "pass"}]}), encoding="utf-8")
        # Application sources changed by the main flow: the feature re-enters and keeps its attempt count.
        (ohos_env.source_root(self.root) / "src" / "main.cpp").write_text("int main() { return 1; }\n", encoding="utf-8")
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001", "--restart")[0], 0)
        self.assertEqual(self.adoption()["attempts"], "1")
        code, out = self.gate("exit", str(self.root), "FEAT-001")
        self.assertEqual(code, 0, out)
        self.assertIn("vendor judge: pass", (workdir / "exit-2.log").read_text(encoding="utf-8"))
        self.assertTrue(package.is_dir())


# --------------------------------------------------------------------------- 5. host-phase gate

class PhaseGateTest(GateBase):
    def run_cap(self):
        make_feature(self.features, "cap-a", "capability")
        self.activate("cap-a")
        self.gate("enter", str(self.root), "FEAT-001")

    def test_in_progress_blocks_and_next_step_shows_it(self):
        self.run_cap()
        errors = self.evaluate("features")
        self.assertTrue(any("still in-progress" in error for error in errors), errors)
        self.hooks("progress", str(self.root), "FEAT-001", "--step", "接入代码")
        self.assertEqual(next_step.hooked_features(self.root, "features")[0].split(" -> ")[0],
                         "- FEAT-001 cap-a [capability] in-progress, step: 接入代码")
        self.assertIn("step 接入代码", ledger.show_state(self.root))

    def test_first_attempt_pass_leaves_exit_gate_empty(self):
        self.run_cap()
        cap_verdict(self.root)
        self.assertEqual(self.gate("exit", str(self.root), "FEAT-001")[0], 0)
        row = self.adoption()
        self.assertEqual((row["status"], row["exit_gate"]), ("passed", ""))
        # features.tsv belongs to the feature scripts.
        with self.assertRaises(ledger.LedgerError):
            ledger.update_row(self.root, fp.ADOPTION, "FEAT-001", {"status": "planned"})

    def test_deferred_needs_the_users_answer(self):
        self.run_cap()
        code, out = self.hooks("close", str(self.root), "FEAT-001", "--answer", "")
        self.assertEqual(code, 1)
        self.assertIn("--answer is empty", out)
        self.assertEqual(self.hooks("close", str(self.root), "FEAT-001", "--answer", "下个版本再做")[0], 0)
        row = self.adoption()
        self.assertEqual(row["status"], "deferred-approved")
        self.assertIn("closed deferred-approved: user answer: 下个版本再做", row["notes"])
        self.assertEqual(len(phase_gate.read_rows(self.root / "decisions.tsv")), 1)
        self.assertEqual(self.evaluate("features"), [])

    def test_handoff_needs_report_lines(self):
        self.run_cap()
        self.gate("exit", str(self.root), "FEAT-001")
        errors = self.evaluate("validation")
        self.assertTrue(any("report.md External features does not list FEAT-001" in error for error in errors), errors)


# --------------------------------------------------------------------------- 6. legacy ledgers

# --------------------------------------------------------------------------- 7. end to end

class EndToEndTest(GateBase):
    def test_base_migration_then_features_then_handoff(self):
        make_feature(self.features, "cap-a", "capability")
        make_feature(self.features, "ver-a", "verification")
        # Nothing about features happens during the base migration: no gate
        # asks for a selection, and activation is refused.
        for phase in BASE_PHASES:
            self.assertEqual(self.evaluate(phase), [], phase)
            code, out = self.hooks("activate", str(self.root), "--answer", "cap-a ver-a", "--select", "cap-a", "--select", "ver-a")
            self.assertEqual(code, 1, (phase, out))
            gate_state.record_gate(self.root, phase, [], "test")
        self.assertIn("- Current phase: `features`", (self.root / "STATE.md").read_text(encoding="utf-8"))
        self.assertEqual(next_step.open_phase((self.root / "STATE.md").read_text(encoding="utf-8")), "features")
        code, out = self.hooks("activate", str(self.root), "--answer", "cap-a ver-a", "--select", "cap-a", "--select", "ver-a")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-002")[0], 1)  # validation not open
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-001")[0], 0)
        cap_verdict(self.root)
        self.assertEqual(self.gate("exit", str(self.root), "FEAT-001")[0], 0)
        self.assertEqual(self.evaluate("features"), [])
        gate_state.record_gate(self.root, "features", [], "test")
        self.assertEqual(self.gate("enter", str(self.root), "FEAT-002")[0], 0)
        workdir = self.root / "features" / "FEAT-002"
        (workdir / "report.json").write_text(json.dumps({"result": "pass", "cases": [{"result": "pass"}]}), encoding="utf-8")
        code, out = self.gate("exit", str(self.root), "FEAT-002")
        self.assertEqual(code, 0, out)
        report = (self.root / "report.md").read_text(encoding="utf-8").replace(
            "- none activated\n", "- FEAT-001 cap-a: passed\n- FEAT-002 ver-a: passed (features/FEAT-002/report.json)\n")
        (self.root / "report.md").write_text(report, encoding="utf-8")
        self.assertEqual(self.evaluate("validation"), [])


# --------------------------------------------------------------------------- 8. the delivered skill stays intact

def tree(path: Path) -> dict[str, str]:
    return {item.relative_to(path).as_posix(): hashlib.sha256(item.read_bytes()).hexdigest()
            for item in sorted(path.rglob("*")) if item.is_file()}


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
        criteria = [{"check": "artifact", "path": "{workdir}/report.json", "json": {"result": "pass"}},
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
        self.assertEqual(self.evaluate("validation"), [])


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

    def test_scaffold_builds_a_lint_clean_package_and_keeps_the_skill_intact(self):
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
        self.assertEqual([c["check"] for c in hook["exit"]["criteria"]], ["command"])
        self.assertEqual(fp.read_registry(self.features)["harmonyos-nfc-share"]["package_path"], "harmonyos-nfc-share/")
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
        self.assertEqual(hook["hook"]["phase"], "validation")
        self.assertFalse(hook["permissions"]["modify_sources"])
        self.assertEqual(hook["exit"]["criteria"][0],
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

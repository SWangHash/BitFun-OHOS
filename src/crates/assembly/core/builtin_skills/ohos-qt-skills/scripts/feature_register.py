#!/usr/bin/env python3
"""Help an agent register a delivered skill as an external feature.

Used by maintainers (never during a migration). A developer only says
"register <skill> as an external feature"; the agent reads the skill, asks
the developer a few multiple-choice questions, and writes the package. This
script does the two mechanical parts of that conversation:

    python scripts/feature_register.py inspect <skill-dir>
        Read-only. Prints JSON facts and suggestions found in the skill
        (kind, feature ids, keywords, device need, milestones, exit options,
        skill instructions the main flow overrides). The agent turns them
        into the options it offers; they are hints, not answers.

    python scripts/feature_register.py scaffold --skill <skill-dir> --id <feature-id> \
        --kind capability|verification --title <title> --owner <owner> \
        --summary <one line> --keyword <word> [--keyword ...] --device yes|no \
        [--milestone <step> ...] [--after <feature-id> ...] [--exit-command "<cmd>" ...] \
        [--exit-artifact <path-in-workdir> [--exit-json key=value ...]] [--register draft|none]
        Copies features/_templates/<kind>/ to features/<feature-id>/,
        copies the skill unchanged to features/<feature-id>/skill/, fills
        hook.json from the answers, and adds a draft registry row. The agent
        then fills the adapter feature.md and runs feature_hooks.py lint.

The skill directory is never modified; scaffold checks that the copy is
byte-identical (only a top-level .git directory is left out).
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import sys
from pathlib import Path

import feature_predicates as fp
from feature_hooks import FEATURE_ID_RE, HOOK_POINTS, REGISTRY_FIELDS

TEXT_SUFFIXES = {".md", ".txt", ".rst"}
SCRIPT_SUFFIXES = {".py": "python3", ".sh": "bash", ".js": "node", ".mjs": "node"}
IGNORED_DIRS = {".git", "__pycache__", "node_modules"}

KIND_WORDS = {
    "verification": ["验收", "验证", "测试", "检查", "评审", "审查", "报告", "用例", "判定", "回归", "合规",
                     "test", "verify", "verification", "acceptance", "audit", "check", "report", "judge", "review"],
    "capability": ["接入", "集成", "实现", "能力", "开发", "适配", "权限", "接口", "调用", "改造",
                   "integrate", "implement", "capability", "permission", "api", "kit", "arkts", "module.json5"],
}
DEVICE_WORDS = ["hdc", "真机", "设备", "手机", "平板", "双机", "nfc", "蓝牙", "bluetooth", "device", "模拟器", "emulator"]
OVERRIDE_RULES = [
    ("installs-dependencies", re.compile(r"\b(pip3? install|npm (i|install)|ohpm install|apt(-get)? install|brew install|curl |wget )|联网|下载安装", re.I),
     "联网安装/下载依赖：改为在前置条件中列出，由用户预先准备；执行期间不联网安装"),
    ("own-state-or-output", re.compile(r"(state|状态|进度|输出|output|report|报告|日志|log)[^\n]{0,30}(文件|目录|dir|file|folder|写入|保存|save|write)", re.I),
     "skill 自带的状态/输出位置：一律改写到 {workdir}"),
    ("edits-sources", re.compile(r"(修复|直接修改|修改源码|改代码|自动修|fix (it|the|them|issues)|apply (a )?patch|patch the|edit the source)", re.I),
     "修改源码：verification 只记录缺陷，修复回主流程；capability 的改动必须在平台守卫内并落 CAP 行"),
    ("own-phases", re.compile(r"^(#+\s*)?(phase|stage|阶段|第[一二三四五六七八九十0-9]+[步阶])", re.I),
     "skill 自带的阶段划分：按本 feature 的 milestones 执行，门禁由主流程负责"),
    ("signing-material", re.compile(r"(签名|证书|keystore|\.p12|\.cer\b|profile|signing)", re.I),
     "签名材料：不读写、不记录密钥；签名沿用主流程的签名配置"),
    ("asks-user", re.compile(r"(询问用户|问用户|ask the user|confirm with the user|让用户选择)", re.I),
     "向用户提问：执行期间的问题按主流程的决策方式记录到 decisions.tsv"),
]
STEP_HEADING = re.compile(r"^(步骤|第[一二三四五六七八九十0-9]+步|step\s*\d+|\d+[.)、]\s*\S)", re.I)
QUOTED = re.compile(r"[“\"「`《]([^”\"」`》\n]{2,20})[”\"」`》]")
# "当用户提到碰一碰、tap to share 时使用" / "Use when the user mentions X, Y or Z."
MENTIONS = re.compile(r"(?:提到|提及|说到|包含|涉及|关键词[:：]?|mentions?|asks? (?:about|for)|says?)\s*([^。.;；\n]{2,80}?)(?:时|的时候|时使用|$|[。.;；\n])", re.I)


def kebab(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def text_files(skill: Path) -> list[Path]:
    return [path for path in sorted(skill.rglob("*"))
            if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES and not IGNORED_DIRS & set(path.relative_to(skill).parts)]


def all_files(skill: Path) -> list[Path]:
    return [path for path in sorted(skill.rglob("*"))
            if path.is_file() and not IGNORED_DIRS & set(path.relative_to(skill).parts)]


def headings(markdown: str) -> list[str]:
    result, fenced = [], False
    for line in markdown.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
        elif not fenced and re.match(r"^#{1,3}\s+\S", line):
            result.append(line.lstrip("#").strip())
    return result


def count_words(text: str, words: list[str]) -> dict[str, int]:
    lower = text.lower()
    return {word: lower.count(word.lower()) for word in words if lower.count(word.lower())}


def suggest_kind(description: str, heads: str, body: str) -> dict:
    scores, reasons = {}, {}
    for kind, words in KIND_WORDS.items():
        hits = {}
        for weight, text in ((3, description), (2, heads), (1, body)):
            for word, count in count_words(text, words).items():
                hits[word] = hits.get(word, 0) + weight * count
        scores[kind] = sum(hits.values())
        reasons[kind] = [f"{word}×{count}" for word, count in sorted(hits.items(), key=lambda item: -item[1])[:6]]
    value = "verification" if scores["verification"] > scores["capability"] else "capability"
    return {"value": value, "scores": scores, "reasons": reasons[value],
            "confidence": "low" if abs(scores["verification"] - scores["capability"]) < 5 else "high"}


def suggest_keywords(name: str, description: str, heads: list[str]) -> list[str]:
    found: list[str] = []
    mentioned = []
    for match in MENTIONS.findall(description):
        mentioned += re.split(r"\s*(?:[、,，/]|\bor\b|\band\b|或|和)\s*", match)
    for value in mentioned + QUOTED.findall(description) + QUOTED.findall(" ".join(heads)) + [name.replace("-", " ")]:
        value = value.strip(" \"'“”「」`")
        if 2 <= len(value) <= 30 and value not in found:
            found.append(value)
    return found[:10]


def overrides(skill: Path) -> list[dict]:
    result = []
    for path in text_files(skill):
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for name, pattern, advice in OVERRIDE_RULES:
                if pattern.search(line):
                    result.append({"signal": name, "where": f"{path.relative_to(skill).as_posix()}:{number}",
                                   "text": line.strip()[:160], "override": advice})
    # One signal may fire on many lines; keep the first five per signal so the agent can quote them.
    kept, seen = [], {}
    for item in result:
        seen[item["signal"]] = seen.get(item["signal"], 0) + 1
        if seen[item["signal"]] <= 5:
            kept.append(item)
    return kept


def exit_options(skill: Path, kind: str, body: str) -> list[dict]:
    options = [{"label": "迁移台账中本 feature 的 VAL-* 全部通过（默认，始终包含）",
                "predicate": {"check": "validation-passed", "ids": "row"}}]
    for path in all_files(skill):
        runner = SCRIPT_SUFFIXES.get(path.suffix.lower())
        rel = path.relative_to(skill).as_posix()
        if runner and re.search(r"(check|verify|judge|test|report|validate|lint|audit|exit|gate|验|检)", rel, re.I):
            options.append({"label": f"skill 自带脚本 {rel} 退出码为 0",
                            "predicate": {"check": "command", "run": [runner, f"{{package}}/skill/{rel}"], "timeout_s": 600},
                            "note": "先读脚本确认它只读迁移目录、只写 {workdir}、不联网、只用标准库；参数按脚本要求补齐"})
    for name in sorted(set(re.findall(r"\b([\w-]*(?:report|result|summary|verdict)[\w-]*\.json)\b", body, re.I))):
        options.append({"label": f"{{workdir}}/{name} 中的结论为通过",
                        "predicate": {"check": "artifact", "path": f"{{workdir}}/{name}", "json": {"result": "pass"}},
                        "note": "按 skill 实际输出的字段名改写 json 键值"})
    if kind == "verification" and len(options) == 1:
        options.append({"label": "skill 的结论转换成 {workdir}/report.json 且 result=pass（模板默认）",
                        "predicate": {"check": "artifact", "path": "{workdir}/report.json", "json": {"result": "pass"}}})
    return options


def cmd_inspect(args) -> int:
    skill = Path(args.skill).resolve()
    problems = []
    skill_md = skill / "SKILL.md"
    if not skill_md.is_file():
        print(json.dumps({"skill_path": str(skill), "problems": ["SKILL.md not found; this is not a complete skill"]},
                         ensure_ascii=False, indent=2))
        return 1
    front = fp.skill_frontmatter(skill_md)
    for key in ("name", "description"):
        if not front.get(key):
            problems.append(f"SKILL.md frontmatter lacks '{key}'; ask the developer for a complete skill")
    if (skill / "hook.json").exists():
        problems.append("the skill contains hook.json; hook.json belongs outside the skill — ask the developer to remove it from the delivery")
    main = skill_md.read_text(encoding="utf-8", errors="replace")
    body = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in text_files(skill))
    heads = headings(main)
    name = front.get("name") or skill.name
    description = front.get("description", "")
    kind = suggest_kind(description, " ".join(heads), body)
    registry = fp.read_registry(Path(args.features_root))
    existing = {path.name for path in Path(args.features_root).iterdir() if path.is_dir()} | set(registry)
    base = kebab(name) or "feature"
    ids = []
    for candidate in ([f"harmonyos-{base}" if not base.startswith("harmonyos-") else base, base] if kind["value"] == "capability"
                      else [f"ext-{base}" if not base.startswith("ext-") else base, base]):
        if candidate not in ids:
            ids.append(candidate)
    device_hits = count_words(body, DEVICE_WORDS)
    step_heads = [head for head in heads if STEP_HEADING.match(head)]
    files = all_files(skill)
    report = {
        "skill_path": str(skill),
        "name": name,
        "description": description,
        "version": front.get("version", ""),
        "files": {"count": len(files),
                  "scripts": [p.relative_to(skill).as_posix() for p in files if p.suffix.lower() in SCRIPT_SUFFIXES][:30],
                  "docs": [p.relative_to(skill).as_posix() for p in text_files(skill)][:30]},
        "headings": heads[:40],
        "problems": problems,
        "suggestions": {
            "kind": kind,
            "feature_id": [{"value": value, "taken": value in existing} for value in ids],
            "keywords": suggest_keywords(name, description, heads),
            "device": {"value": bool(device_hits), "reasons": [f"{w}×{c}" for w, c in sorted(device_hits.items(), key=lambda i: -i[1])[:6]]},
            "milestones": step_heads[:6] or (["阅读 skill", "按 skill 实施", "真机验证"] if kind["value"] == "capability"
                                             else ["阅读 skill", "按 skill 执行验收", "汇总报告"]),
            "exit_options": exit_options(skill, kind["value"], body),
            "ohos_permissions": sorted(set(re.findall(r"ohos\.permission\.[A-Z0-9_]+", body))),
            "overrides": overrides(skill),
        },
        "registered_features": [{"feature_id": fid, "kind": row.get("kind", ""), "title": row.get("title", ""),
                                 "status": row.get("status", "")} for fid, row in registry.items()],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if problems else 0


# --------------------------------------------------------------------------- scaffold

def tree_hashes(root: Path, skip_top_git: bool = True) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if skip_top_git and rel.parts[0] == ".git":
            continue
        if path.is_file():
            result[rel.as_posix()] = fp.sha256_file(path)
    return result


def append_registry(features_root: Path, row: dict[str, str]) -> None:
    path = features_root / "registry.tsv"
    if not path.is_file() or not path.read_text(encoding="utf-8").strip():
        path.write_text("\t".join(REGISTRY_FIELDS) + "\n", encoding="utf-8")
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        text += "\n"
    clean = {key: str(row.get(key, "")).replace("\t", " ").replace("\n", " ") for key in REGISTRY_FIELDS}
    path.write_text(text + "\t".join(clean[key] for key in REGISTRY_FIELDS) + "\n", encoding="utf-8")


def parse_json_pairs(pairs: list[str]) -> dict:
    result = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep or not key.strip():
            raise ValueError(f"--exit-json '{pair}' must be key=value")
        lowered = value.strip().lower()
        result[key.strip()] = True if lowered == "true" else False if lowered == "false" else value.strip()
    return result


def cmd_scaffold(args) -> int:
    features_root = Path(args.features_root)
    source = Path(args.skill).resolve()
    feature_id, kind = args.id, args.kind
    package = features_root / feature_id
    target = package / "skill"
    errors = []
    if not FEATURE_ID_RE.match(feature_id):
        errors.append(f"feature id '{feature_id}' must be kebab-case")
    if not (source / "SKILL.md").is_file():
        errors.append(f"{source} has no SKILL.md; it is not a complete skill")
    elif not all(fp.skill_frontmatter(source / "SKILL.md").get(key) for key in ("name", "description")):
        errors.append("SKILL.md frontmatter needs name and description; ask the developer for a complete skill")
    if (source / "hook.json").exists():
        errors.append("the delivered skill contains hook.json; it must stay outside the skill (ask the developer to remove it)")
    in_place = source == target.resolve()
    if package.exists() and not (in_place and sorted(p.name for p in package.iterdir()) == ["skill"]):
        errors.append(f"{package} already exists; pick another id or remove the old package after a user decision")
    if feature_id in fp.read_registry(features_root):
        errors.append(f"'{feature_id}' is already in registry.tsv")
    if not args.keyword:
        errors.append("give at least one --keyword")
    try:
        json_expect = parse_json_pairs(args.exit_json)
    except ValueError as error:
        errors.append(str(error))
        json_expect = {}
    if args.exit_json and not args.exit_artifact:
        errors.append("--exit-json needs --exit-artifact")
    if args.exit_artifact and (args.exit_artifact.startswith(("/", "..")) or ".." in Path(args.exit_artifact).parts):
        errors.append("--exit-artifact is a path inside {workdir}, e.g. report.json")
    if errors:
        for message in errors:
            print(f"ERROR {message}")
        return 1

    template = features_root / "_templates" / kind
    if in_place:
        for item in template.iterdir():
            (shutil.copytree if item.is_dir() else shutil.copy2)(item, package / item.name)
    else:
        shutil.copytree(template, package)
        shutil.copytree(source, target, copy_function=shutil.copy2, ignore=lambda d, names: [".git"] if Path(d) == source else [])
    if tree_hashes(source) != tree_hashes(target):
        print(f"ERROR the copy in {target} differs from {source}; remove {package} and retry")
        return 1

    hook = fp.load_hook(package)
    front = fp.skill_frontmatter(target / "SKILL.md")
    device = args.device == "yes"
    hook.update(feature_id=feature_id, title=args.title, owner=args.owner,
                version=args.version or front.get("version") or "0.1.0")
    hook["hook"] = {"phase": next(p for p, k in HOOK_POINTS.items() if k == kind), "after": list(args.after)}
    hook["trigger"] = {"keywords": list(dict.fromkeys(args.keyword))}
    hook.setdefault("permissions", {})["device"] = device
    if args.milestone:
        hook["milestones"] = list(args.milestone)
    outputs = hook.setdefault("outputs", {})
    ledgers = list(outputs.get("ledgers", []))
    if kind == "capability" and not device:
        hook["entry"]["requires"] = [item for item in hook["entry"]["requires"] if item.get("ledger") != "device-runs.tsv"]
        ledgers = [name for name in ledgers if name != "device-runs.tsv"]
    if device and "device-runs.tsv" not in ledgers:
        ledgers.append("device-runs.tsv")
    outputs["ledgers"] = ledgers
    criteria = [{"check": "validation-passed", "ids": "row"}]
    for command in args.exit_command:
        criteria.append({"check": "command", "run": shlex.split(command), "timeout_s": args.exit_timeout})
    evidence = []
    if args.exit_artifact:
        path = "{workdir}/" + args.exit_artifact
        item = {"check": "artifact", "path": path}
        if json_expect:
            item["json"] = json_expect
        criteria.append(item)
        evidence.append(path)
    elif kind == "verification" and not args.exit_command:
        criteria = hook["exit"]["criteria"]  # keep the template's report.json verdict
        evidence = list(outputs.get("evidence_files", []))
    hook["exit"]["criteria"] = criteria
    outputs["evidence_files"] = evidence
    (package / "hook.json").write_text(json.dumps(hook, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    playbook = package / "feature.md"
    text = playbook.read_text(encoding="utf-8").replace("<中文名称>", args.title).replace("<feature-id>", feature_id)
    playbook.write_text(text, encoding="utf-8")

    if args.register == "draft":
        append_registry(features_root, {"feature_id": feature_id, "title": args.title, "kind": kind,
                                        "hook_phase": hook["hook"]["phase"], "status": "draft",
                                        "package_path": f"{feature_id}/", "owner": args.owner, "summary": args.summary})
    todo = text.count("TODO")
    print(f"created {package}")
    print(f"skill copied unchanged: {len(tree_hashes(target))} files -> {target}")
    print(f"hook.json filled; registry: {'draft row added' if args.register == 'draft' else 'not registered'}")
    print(f"next: fill the {todo} TODO(s) in {playbook} from the skill, then run "
          f"python scripts/feature_hooks.py lint {feature_id}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features-root", default=str(fp.default_features_root()), help="features/ directory (default: the skill's)")
    sub = parser.add_subparsers(dest="command", required=True)

    inspect = sub.add_parser("inspect", help="print facts and suggestions read from a delivered skill (read-only)")
    inspect.add_argument("skill")
    inspect.set_defaults(func=cmd_inspect)

    scaffold = sub.add_parser("scaffold", help="create features/<id>/ from the developer's answers")
    scaffold.add_argument("--skill", required=True)
    scaffold.add_argument("--id", required=True)
    scaffold.add_argument("--kind", required=True, choices=sorted(set(HOOK_POINTS.values())))
    scaffold.add_argument("--title", required=True)
    scaffold.add_argument("--owner", required=True)
    scaffold.add_argument("--summary", required=True)
    scaffold.add_argument("--keyword", action="append", default=[])
    scaffold.add_argument("--device", required=True, choices=["yes", "no"])
    scaffold.add_argument("--milestone", action="append", default=[])
    scaffold.add_argument("--after", action="append", default=[], metavar="FEATURE_ID")
    scaffold.add_argument("--version", default="")
    scaffold.add_argument("--exit-command", action="append", default=[], help='e.g. "python3 {package}/skill/scripts/judge.py {workdir}"')
    scaffold.add_argument("--exit-timeout", type=int, default=600)
    scaffold.add_argument("--exit-artifact", default="", help="file inside {workdir} holding the verdict, e.g. report.json")
    scaffold.add_argument("--exit-json", action="append", default=[], metavar="KEY=VALUE")
    scaffold.add_argument("--register", choices=["draft", "none"], default="draft")
    scaffold.set_defaults(func=cmd_scaffold)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

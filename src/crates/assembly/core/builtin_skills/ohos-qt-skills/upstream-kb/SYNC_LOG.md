# Upstream knowledge sync log

Append-only; written by `upstream-kb/scripts/sync_upstream.py apply`.

## 2026-09-30 — 63e90f021548 (initial baseline)

- upstream: https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git @ bitfun-release (commit 63e90f0215481fa50ab2cbf041230f2889e2a846)
- imported before upstream-kb/ existed (via the former scripts/refresh_skill_knowledge.py); exclusions in exclusions.tsv decided 2026-09-30

## 2026-10-10 — 2f9e4a0c0e0f

- upstream: https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git @ bitfun-release (commit 2f9e4a0c0e0f079922b5b4ebf6686ec705c8d4a8, committed 2026-10-09T09:51:59+08:00)
- previous revision: 63e90f0215481fa50ab2cbf041230f2889e2a846
- counts: changed=12, excluded=178, new=4, unchanged=278
- updated (12):
  - `AGENTS.md`
  - `README.md`
  - `_index/_dashboard.md`
  - `_index/_task-routing.md`
  - `knowledge/errors/index.yaml`
  - `portgraph/docs/fetch-deps.md`
  - `portgraph/port_graph/deps_fetch.py`
  - `portgraph/port_graph/harmonybrew.py`
  - `portgraph/portgraph.py`
  - `problems/_lookup.md`
  - `problems/build-clang15-libcpp15-cpp20-gaps.md`
  - `procedural/qt-app-harmonyos-migration.md`
- added (4):
  - `knowledge/errors/QOH042.yaml`: QOH042 错误模式：harmonydeployqt 部署缺口（fontconfig 链/SONAME/libz）的匹配规则与修复，属迁移排障知识
  - `portgraph/tests/test_prefetch.py`: portgraph 并行预取的单测，与已纳入的 portgraph/tests/ 同性质，随 harmonybrew.py 变更配套
  - `problems/runtime-harmonydeployqt-deploy-gaps.md`: 实战踩坑页：签名 HAP 设备侧 dlopen 连环失败的 5 类根因与检查清单，属迁移排障知识
  - `tools/cpp20-gap-scan.py`: 只读扫描为主的 C++20 缺口预检工具（仅依赖标准库），对应 problems/build-clang15-libcpp15-cpp20-gaps.md；用户此前已决定纳入，不在 SKILL.md 加专门说明

## 2026-10-12 — 2f9e4a0c0e0f

- upstream: https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills.git @ bitfun-release (commit 2f9e4a0c0e0f079922b5b4ebf6686ec705c8d4a8, committed 2026-10-09T09:51:59+08:00)
- previous revision: 2f9e4a0c0e0f079922b5b4ebf6686ec705c8d4a8
- counts: excluded=177, new=1, newly-excluded=47, unchanged=247
- excluded (matched existing exclusion) (47):
  - `README.md` <- `README.md`
  - `SETUP.md` <- `SETUP.md`
  - `_index/_dashboard.md` <- `_index/_dashboard.md`
  - `faults/C-0017-curl-gbk-terminal-mojibake.md` <- `faults/C-0017-curl-gbk-terminal-mojibake.md`
  - `knowledge/errors/QOH033.yaml` <- `knowledge/errors/QOH033.yaml`
  - `portgraph/check_deps.py` <- `portgraph/check_deps.py`
  - `portgraph/docs/images/web-ui-detail.png` <- `portgraph/docs/images/`
  - `portgraph/docs/images/web-ui-main.png` <- `portgraph/docs/images/`
  - `portgraph/docs/opt-reports/2026-09-deps-opt-worker1.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-opt-worker2.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-regress-worker1.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-regress-worker2.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-regress-worker3.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-regress-worker4.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-test-worker1.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-test-worker2.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-test-worker3.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/docs/opt-reports/2026-09-deps-test-worker4.md` <- `portgraph/docs/opt-reports/`
  - `portgraph/tests/e2e/corpus.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/oracle/corpus-a.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/oracle/corpus-b.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/oracle/corpus-c.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/oracle/corpus-d.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/overrides/corpus-a.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/overrides/corpus-b.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/overrides/corpus-c.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/overrides/corpus-d.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-a.report.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-a.report.md` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-b.report.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-b.report.md` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-c.report.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-c.report.md` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-d.report.json` <- `portgraph/tests/`
  - `portgraph/tests/e2e/reports/corpus-d.report.md` <- `portgraph/tests/`
  - `portgraph/tests/e2e/run_e2e.py` <- `portgraph/tests/`
  - `portgraph/tests/test_port_graph.py` <- `portgraph/tests/`
  - `portgraph/tests/test_prefetch.py` <- `portgraph/tests/`
  - `portgraph/web/app.js` <- `portgraph/web/`
  - `portgraph/web/index.html` <- `portgraph/web/`
  - `portgraph/web/style.css` <- `portgraph/web/`
  - `procedural/demo-generation.md` <- `procedural/demo-generation.md`
  - `procedural/framework-fix-verification.md` <- `procedural/framework-fix-verification.md`
  - `procedural/framework-issue-analysis.md` <- `procedural/framework-issue-analysis.md`
  - `procedural/qt-app-harmonyos-completion.md` <- `procedural/qt-app-harmonyos-completion.md`
  - `semantic/qt-ohos-project-analyzer-workflow.md` <- `semantic/qt-ohos-project-analyzer-workflow.md`
  - `skills/kb-init/scripts/clone-kb.sh` <- `skills/kb-init/scripts/clone-kb.sh`
- added (1):
  - `skills/qt-sdk-forge/references/build-matrix.md`: Qt SDK 版本×渠道×平台矩阵（源码渠道、工具链前置、configure 差异、QOH037–041 对照、已验证 commit），被 QOH037/038/041、SDK 编译类问题页和 kb-init/references/qt-src-acquisition.md 引用；2026-10-12 全量审计后由用户决定从 qt-sdk-forge 目录规则中单独放行

# Qt/HarmonyOS toolchain and template inputs

This skill snapshots the complete knowledge-base files that explain how to
obtain and verify the build inputs. It does not redistribute proprietary Qt
artifacts, DevEco Studio, OHOS SDK files, or a fabricated template tree.

## What is inside the skill

The skill baseline contains these complete upstream files. Read them where
they live (`upstream-kb/knowledge/...` under the skill root);
`scripts/sync_knowledge.py` records their pinned provenance in the project
manifest:

- `ENV.md` and `skills/kb-init/SKILL.md` — supported Qt versions, acquisition
  choices, environment variables, and the end-to-end initialization sequence.
- `skills/kb-init/references/deveco-install.md` — DevEco Studio/Command Line
  Tools, `devecocli`, HDC, and platform-specific installation guidance.
- `skills/kb-init/references/qt-src-acquisition.md` — commercial/open-source Qt
  source and prebuilt SDK acquisition routes.
- `skills/kb-init/references/qt-compile-guide.md` — Qt OHOS SDK source-build
  inputs and troubleshooting.
- `skills/kb-init/scripts/*` — the upstream detection, dependency installation,
  Qt source/SDK download, SDK compilation, template download, environment file
  generation, and verification scripts. Use them byte-for-byte from the
  baseline; do not replace them with a hand-written excerpt.
- `semantic/qt-harmonyos-project-structure.md` and the Qt deployment pages —
  the expected glue/template layout, CMake targets, library naming, HAP
  placement, and deployment rules.
- `ohos-common-kb-public/semantic/*` and
  `ohos-common-kb-public/procedural/ohos-llvm-cross-compile.md` — OHOS native
  SDK/clang/sysroot, cross-compile, HAP, and DevEco boundaries that Qt relies
  on.

The project `knowledge-manifest.tsv` is the authority for the pinned skill
baseline hash, original source revision/path/hash, skill snapshot path/hash,
`used`, and `modified` state for every one of these pages; a project-local
file exists only for a registered adapted page.

## What is deliberately external

The following are runtime inputs, not documentation files, and therefore are
not bundled in this repository:

| Input | State in this skill | Acquisition/verification route |
|---|---|---|
| Qt OHOS SDK binaries | external-required | `<skill>/scripts/bitfun-download-qt-sdk.sh` (BitFun backstop; the runtime provisioner owns the normal install) or compile with `compile-qt-sdk.sh`; record exact path/version in `migration/ohos/environment.tsv` |
| Qt source tree | external-required | `clone-qt-src.sh`; its `qtbase/src/harmonyos/templates` directory is also a template source |
| OHOS SDK native (clang, sysroot, CMake toolchain) | external-required | DevEco/Command Line Tools installation; verify with `verify-env.sh` and record API/ABI/tool versions |
| DevEco Studio / `devecocli` / HDC / Hvigor / CMake / Ninja / JDK / Node | external-required | platform-specific `deveco-install.md` and dependency scripts; record executable paths and versions |
| Qt HarmonyOS glue template project | not-present-in-skill | copy the complete directory from `<QT_SRC>/qtbase/src/harmonyos/templates`, or run `<skill>/scripts/bitfun-download-template.sh` for `templates-0625.zip`; inspect expected files before use |

Do not mark a template or toolchain row `verified` merely because a path is
configured. Require the executable/version or complete template-tree checks
and attach the command output digest to the environment or pilot evidence.

## BitFun acquisition entry points

BitFun does not read the working directory for these two inputs: it scans the
shared Qt migration root and reports what it finds as the intake candidates
(`toolchains/` and `templates/`). Resource acquisition therefore goes through the
skill's own BitFun scripts, which resolve that root themselves
(`BITFUN_QT_MIGRATION_ROOT`, then `--platform`, then host detection) and verify
the result with the same predicates the scan uses:

| Resource | Entry point | Installed into |
|---|---|---|
| Template tree | `<skill>/scripts/bitfun-download-template.sh [--platform=<...>]` | `<qt_migration_root>/templates/qt5.12.12/templates-0625`; prints `OHOS_TEMPLATE_SRC` |
| Qt OHOS SDK (backstop) | `<skill>/scripts/bitfun-download-qt-sdk.sh --platform=<...>` | `<qt_migration_root>/toolchains/qt5.12.12/<platform>-arm64-gles`; prints `QT5_12_OHOS_SDK` |

Use the printed path as `OHOS_TEMPLATE_SRC` / the toolchain path; do not add
`--dest`, and do not substitute the vendored upstream copies under
`upstream-kb/knowledge/skills/kb-init/scripts/`: those are baseline references
that require an explicit `--dest` and install outside the scanned root, so the
intake would not see the result.


## Template handling contract

There are two distinct operations:

1. **Acquire the template** from the Qt source tree or the standalone archive.
   `<skill>/scripts/bitfun-download-template.sh` is the canonical fallback when no
   Qt source checkout exists.
2. **Materialize it into the migration project** as a whole directory: the
   template root is the migrated output container's `<app-name>-ohos`
   subdirectory, never the container itself — a template root placed in the
   container root is a layout error even when the container is the current
   workspace root. `environment.tsv` (`category=layout`) records the container
   and that project directory, and the pair recorded there is what the layout
   gate checks. Preserve
   `AppScope/`, `entry/`, `qEmbeddedUiExtensionHost/`, `build-profile.json5`,
   `hvigorfile.ts`, `oh-package.json5`, and all nested resources. Then record
   the template source path, archive/source revision, complete-tree hash, and
   any intentional edits in the migration ledgers (`environment.tsv`,
   `work-queue.tsv` 的 change/evidence 字段, and `knowledge-manifest.tsv` 的 used 字段和 evidence 引用).

Never copy only a convenient snippet from a template file into the skill. If a
real template tree is later made available, add it as a versioned, whole-tree
asset with its own manifest rows; until then, report the template as an
external prerequisite and do not claim it is bundled.

## Required startup gate

Before changing application source, resume in this order:

```text
pinned knowledge manifest
  -> environment detection
  -> Qt SDK/source and OHOS native path confirmation
  -> complete template acquisition and tree check
  -> pilot configure/build/package check
  -> Qt application migration
```

If any prerequisite is missing, keep the affected queue rows `blocked` or
`planned`; do not hide the gap by generating a substitute template or by
recording an unverified tool path.

## Credential boundary

The upstream commercial clone script accepts credentials as arguments for
compatibility. Never put the username/password, signing keys, tokens, or full
device identifiers in `STATE.md`, TSV ledgers, logs, shell history, or the
knowledge manifest. Prefer an authenticated credential helper or an ephemeral
environment supplied by the user, then record only the redacted command shape
and resulting revision/hash.


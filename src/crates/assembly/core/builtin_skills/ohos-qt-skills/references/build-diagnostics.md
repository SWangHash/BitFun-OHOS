# Diagnostics loop

The one description of how configure, build, deploy, package and device
attempts are run, recorded and repaired (phases 4-7, features included).
Commands and options: `batch_checks.py --help`, `record_diagnostic.py --help`;
`diagnostics.tsv` columns and values: `ledger.py columns diagnostics.tsv`.

## The loop

`diagnostics.tsv` is the problem list: one row per problem (where it showed,
symptom, cause, how to reproduce, fix, status `open`/`fixed`/`blocked`/`accepted-limitation`).
Passing batches write nothing there.

1. Before an attempt: the TASK row it works on and its planned validation are
   recorded; `Next executable action` names the attempt.
2. Run it through `batch_checks.py <plan> --output-dir <root>/batches/<name>
   --tasks <TASK ids>` (one build owner; never a hand-run build: the batch
   applies `environment.tsv`, rejects known-bad commands, kills hung steps and
   keeps the logs). A failure becomes a new `open` problem row.
3. A failure that matches `assets/known-issues.tsv` gets its cause and fix in
   the row: verify that its signature really is the first causal error,
   apply the fix, rerun. Correct the row with `record_diagnostic.py` when the
   match is wrong.
4. Any other failure: write its cause (and the fix you will try) with
   `record_diagnostic.py --id <DIAG> --cause ... --fix ...`; no batch starts
   while an open problem has no cause. A cause still under investigation is
   written as such.
5. Make one minimal source-of-truth change tied to the TASK row, rerun
   configure when build inputs changed, then retry with `--diag <DIAG>`: a
   failure updates the same row, a pass sets it `fixed` (with the recorded
   cause and fix; correct the fix text if what worked differs).
6. Count the fixes you tried yourself: after three failed fixes of one problem
   set it `blocked` (`record_diagnostic.py --id <DIAG> --status blocked`) and
   ask the user (references/decisions.md). The gates wait for the answer: it
   sets the problem `open` again (a new fix to try) or `accepted-limitation`
   (the user accepts it unfixed; the answer goes into `--fix`).

A problem found and fixed outside a batch (an SDK/CMake config file, a host
DLL, a deployment directory, a manifest field the build rejected) gets its own
row at once: `record_diagnostic.py --id new --location "<stage>: ..." --symptom
... --cause ... --fix ... --status fixed`. A different failure met while
retrying one problem is a new problem: record it with `--id new`. From the
diagnostics gate on no problem may stay `open`.

## Known issues first

Most known issues are prevented before the build by `env_probe.py`
(environment), `template_patch.py` (template), `preflight_build_files.py`
(build files), `devecocli_build.py` (hvigor daemon off), `deploy_qt_libs.py`
(deploy) and `hap_check.py` (packaging); a hit during a build usually means
one of them was skipped. `known_issues.py match --log <file>` looks a log up by
hand.

The application route uses the tools and environment the smoke test already
proved, so a failure is an application problem. If it is an environment one
after all, fix the environment, rerun `env_probe.py` (it rewrites `environment.tsv`) and `env_smoke.py`
before the next batch; never in a plan.

## Root-cause order

The first causal failure is the diagnostic, in this order:

1. configure or generator failure;
2. missing source, header, Qt module, plugin, or third-party dependency;
3. compiler, AUTOMOC, or API failure;
4. linker or ABI failure;
5. package-copy, native-library, entry identity, or HAP layout failure;
6. install, launch, runtime, or UI failure;
7. verifier summary.

A later verifier message never replaces an earlier compiler, linker or
packaging error. Record the first causal error as the problem's symptom and
its cause, then choose the smallest change. Do not repeatedly add
includes, rename libraries or toggle settings without a recorded hypothesis,
and never hide a failure by disabling the verifier or accepting an unrelated
artifact.

## Keep-going builds and grouped fixes

A build that stops at the first failing translation unit reveals one gap per
attempt. Build keep-going (`make -k`, `cmake --build <dir> -- -k 0`); the
failed step in `batch-summary.json` carries `error_count` and the distinct
`errors`. Group them by root cause (for example "Qt 5.14+ stream
manipulators", "missing include", "signal emitted from const method") and fix
a whole group per attempt. When the application needs a newer Qt than the
SDK, the `qt-api-gap` row from `scan_qt_api_gap.py` is fixed in one slice
before the first full build; prefer shims guarded by `QT_VERSION_CHECK`.

## Vendored library build order

Vendored third-party code (QScintilla, image/color-picker widgets, parsers,
bundled submodules) is built before the application and as separate targets:

1. one `INV-*` row per vendored library, with its upstream build file and the
   application targets that consume it;
2. reuse the library's upstream CMake/qmake project; write a small wrapper
   target only when none exists;
3. build each library alone for OHOS through `batch_checks.py`; fix its
   include paths, defines and platform guards there;
4. only then link the application against the verified libraries.

Never add third-party sources to the application target: a monolithic target
mixes AUTOMOC outputs, macros and include paths of unrelated code, so the
first error no longer names its owner and each fix rebuilds everything.

## Examples

These illustrate classification, not a fixed repair:

- `Position.h` missing: include/dependency closure; find the owning source
  tree or target include path, update its capability row, reconfigure.
- `SCN_*` macro and Qt signal/AUTOMOC collisions (`mocs_compilation.cpp` fails
  because `SCN_MODIFIED` from `Scintilla.h` expands inside a QScintilla signal
  name): third-party integration / translation-unit isolation. Build
  QScintilla as its own static library target with its own AUTOMOC; do not
  rename signals, add `#undef` blocks or toggle
  `CMAKE_AUTOMOC_MOCS_COMPILATION` by trial and error.

## Missing native library

`No .so files found` is a symptom, not a root cause. Prove which condition
failed: the application target was never compiled or linked; it emitted a
different name or ABI; it was emitted outside the staging directory; the
package copied the envelope/runtime library but not the application library;
`APP_LIBRARY_NAME`, the native target name and the HAP entry path disagree;
the HAP was not produced because an earlier step failed; `hap_check.py`
names which. Never close a build or validation row because some unrelated
`.so` exists.

## Smoke-test and envelope artifacts

The smoke test's hello app and the output project's envelope app
(`libQtHarmonyApp.so`; a template may emit `libentry.so`) prove the
environment only, never that the application compiled or that its package
holds the right library. Such a file is not the application `.so` unless it
is `lib<Application target>.so` of the STATE.md Scope and package inspection
proves it; the same ABI is not enough, the target name, sources, package path
and HAP contents must match the Scope. The application's deliverable is the
HAP of `device-runs.tsv`, written only for a HAP checked by `hap_check.py`
with the application library, never for the envelope (`device_run.py` does
not record smoke-test or envelope runs either). The diagnostics and
validation gates reject a smoke-only or envelope-only result.

Keep the envelope until the application `.so` is built, then switch to
the application in the same batch that packages it (`deploy_qt_libs.py`
deploys the library with its Qt and third-party closure and switches
`APP_LIBRARY_NAME`; qmake's `make ohosdeploy` only echoes, KI-019). Rewiring
first leaves neither a working project nor an application package when the
build stalls.

## The HAP and logs

`device-runs.tsv` has one row, the application HAP's latest result, rewritten
each time; nothing else is kept of a build but the batch logs (no copies of
the `.so` or of intermediate HAPs, no path files unless the user asked for
one as a VAL row). Every packaging batch ends its HAP steps with `hap_check.py`;
when that step ends `batch_checks.py` writes the row:

| status | meaning | next |
|---|---|---|
| `hap-failed` | `hap_check.py` failed (the failure is also a diagnostics problem, named in the evidence) | fix the problem and rerun the packaging batch; after three failed fixes set the problem blocked and ask the user |
| `checked` | `hap_check.py` passed, not run on the device yet | `device_run.py run --migration-root <root> --record`, usually the next step of the same batch |
| `no-device` | `hap_check.py` passed, environment.tsv has no connected device | nothing; the gates accept it |
| `run` | `device_run.py --record` passed with this HAP | nothing |

A failed device run is a diagnostics problem and leaves the row as it is.
The diagnostics gate needs `run` or `no-device`; the validation gate also
needs that HAP still on disk, so never clean the output project after the
last packaging batch.

Read a failing step's full log from the log path in the problem's `reproduce`
(or `batch-summary.json`), not truncated output. After a context compaction,
confirm an error quoted only in the summary against that log on disk;
if neither contains it, discard it and continue from the newest receipt.

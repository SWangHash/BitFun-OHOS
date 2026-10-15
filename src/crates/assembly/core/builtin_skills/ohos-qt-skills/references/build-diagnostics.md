# Build and artifact diagnostics

Read this reference when a configure, compile, link, package, install, launch,
or artifact-verification step fails. It contains concrete failure signatures
and examples; the phase gates and ledger-write rules in `SKILL.md` remain
authoritative.

## Root-cause order

Treat the first causal failure as the diagnostic record. Preserve the complete
batch logs, then record one root-cause row in `diagnostics.tsv` before making
the next change.

Use this order:

1. configure or generator failure;
2. missing source, header, Qt module, plugin, or third-party dependency;
3. compiler, AUTOMOC, or API failure;
4. linker or ABI failure;
5. package-copy, native-library, entry identity, or HAP layout failure;
6. install, launch, runtime, or UI failure;
7. verifier summary.

A later verifier message is not a substitute for an earlier compiler, linker,
or packaging error. Classify the first causal signature, associate it with
the affected `CAP-*` and `VAL-*` rows, and only then choose the smallest
source-of-truth change.

## Diagnostic status values

`diagnostics.tsv` `status` must be one of `planned`, `in-progress`, `failed`,
`timeout`, `blocked`, `resolved`, `passed`, or `not-applicable`.
`validate_ledgers.py` rejects any other value. Use `passed` when the attempt
itself succeeded and `resolved` when a failed root cause was fixed and a later
attempt proved it; the pilot gate accepts only these two.

## Missing native library reports

`No .so files found` is a verifier or packaging symptom, not a root cause by
itself. When it appears, inspect the batch logs and prove which of these
conditions failed:

- the final application target was never compiled or linked;
- the target emitted a different library name or ABI;
- the library was emitted outside the package staging directory;
- the package copied the pilot/runtime library but not the application library;
- `APP_LIBRARY_NAME`, the native target name, and the HAP entry path disagree;
- the HAP was not produced because an earlier package step failed.

Record the actual target path, ABI, HAP path, package entry path, and the
matching library-name configuration in `package-manifest.tsv`. Do not close a
build or handoff row because any unrelated `.so` exists.

## Pilot artifacts

The risk pilot proves the application envelope, toolchain, template, linkage,
and package route. Its artifacts are evidence for that pilot only. They are
not evidence that the migrated application target compiled or that the final
application package contains the correct native library.

For example, a template pilot may emit `libentry.so`. That file must not be
counted as the final application `.so` unless the contract explicitly defines
the application target itself as `libentry.so` and the package inspection
proves that identity. A pilot library with the same ABI is still not enough:
the final target name, source inputs, package path, and HAP contents must
match the application contract.

Keep pilot evidence in `pilot.tsv` (`PILOT-*` rows, phase `pilot`), and
keep final application artifacts in `package-manifest.tsv` rows with
`origin=application`. The handoff gate must reject a pilot-only result.

## Common Qt/CMake examples

These examples illustrate classification, not a fixed repair:

- `Position.h` missing from a source file: classify as include/dependency
  closure; identify the owning source tree or target include path, update the
  relevant capability row, and reconfigure when target inputs changed.
- `SCN_*` macro and Qt signal/AUTOMOC collisions (for example
  `mocs_compilation.cpp` fails because `SCN_MODIFIED` from `Scintilla.h`
  expands inside a QScintilla signal name): classify as third-party
  integration / generated-translation-unit isolation. The structural fix is
  to build QScintilla (or the offending vendored library) as its own static
  library target with its own AUTOMOC, so its moc output never shares a
  translation unit with application headers that include `Scintilla.h`. Do not
  rename signals, add `#undef` blocks, or toggle
  `CMAKE_AUTOMOC_MOCS_COMPILATION` in a trial-and-error loop.

Do not hide either failure by accepting a different library, disabling the
verifier, or repeatedly adding includes without a new tree/environment hash
and a recorded diagnostic hypothesis.

## Vendored library build order

Vendored third-party code (QScintilla, image/color-picker widgets, parsers,
bundled submodules) is built before the application and as separate targets:

1. inventory one `CAP-*` row per vendored library, with its upstream build
   file and the application targets that consume it;
2. reuse the library's upstream CMake/qmake project (`add_subdirectory` or an
   equivalent imported target); write a small wrapper target only when no
   upstream project exists;
3. build each library alone for OHOS through `batch_checks.py` and record the
   receipt; fix its include paths, defines, and platform guards there;
4. only then link the application target against the verified libraries.

Never add third-party sources to the application target's source list. A
monolithic target mixes AUTOMOC outputs, macros, and include paths of
unrelated code, so the first error no longer identifies its owner and each
fix triggers a full rebuild.

## Batch receipts and repeats

Run build attempts as
`batch_checks.py <plan> --output-dir <evidence>/<batch> --diagnostics
<app>/migration/ohos/diagnostics.tsv --affected-ids <CAP-*,VAL-*> --phase <phase>`.
The command writes the `diagnostics.tsv` row itself. A failure is recorded as
`unclassified` with the first error-like log line; classify it before the next
attempt:

```bash
python scripts/record_diagnostic.py <app>/migration/ohos/diagnostics.tsv \
  --id DIAG-004 --category include-closure \
  --root-cause "Position.h lives in the vendored Scintilla tree" \
  --next-action "add scintilla/include to the QScintilla target"
```

Omitted options keep the stored values. `batch_checks.py` refuses to rerun a
plan while the git tree and plan are identical to a failed receipt, or while a
failed receipt of the same first affected id is still unclassified; make and
record the change first.

Failure rows are never overwritten. Each attempt gets its own row (an
explicit `--diag-id` that already holds a finished attempt falls back to the
next free id), and rerunning into the same `--output-dir` moves the earlier
logs to `<output-dir>/attempt-N` and repoints their `log_path`. When a batch
passes, the earlier failed rows of the same first affected id become
`resolved`; `record_diagnostic.py` refuses to turn a failure row into
`passed`, and the diagnostics gate rejects a `resolved` row without category,
root cause, and fix.

Problems solved outside a batch (toolchain or SDK files, host DLLs,
deployment paths, manifest fields) get their own row:

```bash
python scripts/record_diagnostic.py <app>/migration/ohos/diagnostics.tsv \
  --id new --phase build --category toolchain \
  --signature "moc.exe exits 0xC0000135" \
  --root-cause "MinGW runtime DLLs are not on PATH for moc.exe" \
  --next-action "prepend the MinGW bin directory in the batch plan env" \
  --status resolved --affected-ids CAP-002
```

Read the full step log from the receipt's
`log_path` instead of truncating output with `tail`/`Select-Object -Last`.

## Keep-going builds and grouped fixes

A build that stops at the first failing translation unit reveals one API gap
per attempt; a large application then needs dozens of attempts. Build with
keep-going (`cmake --build <dir> -- -k 0` for Ninja, `make -k` for Make).
The failed step in `batch-summary.json` carries `error_count` and up to 40
distinct `errors`; group them by root cause (for example "Qt 5.14+ stream
manipulators", "missing include", "signal emitted from const method"), record
one diagnostic per group, and fix a whole group before the next attempt.

When the application requires a newer Qt than the SDK, run
`scripts/scan_qt_api_gap.py <app> --target-qt <sdk-version>` before the first
build and fix its hits under the `qt-api-gap` capability row. Prefer shims
guarded by `QT_VERSION_CHECK` over rewriting upstream code paths.

## Summaries versus logs

After a context compaction the summary may misquote an error, a file, or a
request. Before acting on an error mentioned only in the summary, confirm it
in the newest diagnostic row's `log_path` and in the file on disk. If neither
contains it, discard it and continue from the newest receipt; do not spend
attempts proving a phantom error.

## Artifact receipts and preservation

User-specified receipt files (for example `so-path.txt`, `hap-path.txt`) are
deliverables. Declare them in the batch plan so they are written as soon as
the artifact exists:

```json
"artifact_receipts": [
  {"pattern": "build/ohos/**/libMyApp.so", "receipt": "so-path.txt", "archive": true},
  {"pattern": "ohos-project/**/outputs/**/*-signed.hap", "receipt": "hap-path.txt", "archive": true}
]
```

The pattern must match the application target, not the pilot's `libentry.so`
(unless the contract defines that identity). With `archive` the artifact is
copied under `<output-dir>/artifacts`. Before any clean rebuild or directory
removal (`rm -rf build`, `Remove-Item entry\build`), confirm that every
verified or receipted artifact is archived and listed in
`package-manifest.tsv`; otherwise keep the directory and rebuild
incrementally.

The pilot envelope is also an artifact to preserve. Keep the pilot's native
sources and entry configuration until the application `.so` has a receipt;
then switch `build-profile.json5` and `APP_LIBRARY_NAME` to the application
target in the same batch that packages it. Rewiring the envelope first leaves
neither a working pilot nor an application package when the build stalls.

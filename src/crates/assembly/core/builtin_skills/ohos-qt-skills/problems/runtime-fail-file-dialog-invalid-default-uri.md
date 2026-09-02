---
id: problem-runtime-file-dialog-invalid-default-uri
type: problem
domain: runtime
tags: []
created: 2026-07-11
updated: 2026-07-11
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-qt6-status, procedural-qt-app-harmonyos-migration]
summary: >
  Qt6 OHOS native file picker receives an app-private default URI and a bare qmake glob as a suffix filter, causing an
  "Could no open file" popup or hiding qmake; omit unsupported optional picker fields and validate the selected qmake in Qt Creator.
leader_summary: >
  Repaired the Qt6 OHOS file picker bridge and Qt Creator caller so the Kit configuration workflow can select a no-extension qmake executable.
impact: [Qt Creator migration, Qt6 QPA stability, HarmonyOS file selection]
deliverables: [Qt Creator patch, Qt6 QPA patch, rebuilt libqtcreator.so, rebuilt libqohos.so]
evidence: [QtSupport incremental build, QOhosPlatformIntegrationPlugin incremental build]
error_message: >
  Could no open file "/data/storage/el2/base/files".
  Kits > Add Qt Versions cannot show or select the qmake executable.
error_code: ""
keywords: [DocumentViewPicker, defaultFilePathUri, fileSuffixFilters, qmake, qmake*, libqohos.so, libqtcreator.so]
symptoms: "Opening Add Qt Versions shows an invalid-path popup, or the system picker does not list a qmake file without an extension."
environment: "Qt 6 for HarmonyOS QPA with Qt Creator running as an OHOS HAP"
related_problems: [problem-runtime-qpa-plugin-not-found]
---

# Qt6 OHOS File Picker Receives an Invalid Default URI or qmake Filter

## Error Message

```text
Could no open file "/data/storage/el2/base/files".
```

The Qt Creator `Kits > Add Qt Versions` file picker can also omit the `qmake` executable even when it is present in a user-selected download directory.

## Scenario

Qt Creator opens a native `QFileDialog` to add a qmake-based Qt version on HarmonyOS. The selected `qmake` is a no-extension executable, for example under a downloaded Qt installation's `bin` directory.

## Root Cause

There are two independent incompatibilities between the desktop file-dialog contract and the HarmonyOS `DocumentViewPicker` contract:

1. Qt Creator used the current device root as the initial directory. On OHOS this can resolve to the app-private path `/data/storage/el2/base/files`. The QPA bridge converted and sent it as `defaultFilePathUri`, but the system picker expects a selectable user-document URI and shows the popup instead.
2. Qt Creator's desktop filter produces patterns such as `qmake*`. `DocumentViewPicker.fileSuffixFilters` accepts only suffixes such as `.txt` or `.so`; it cannot represent an executable filename or glob. Passing `qmake*` therefore hides the file rather than selecting it.

## Resolution

Apply both sides of the fix and deploy both rebuilt libraries:

1. In Qt Creator, leave the initial directory empty on OHOS for `Add Qt Versions`, and return an empty qmake filter. Qt Creator validates the selected file after the picker returns.
2. In the Qt6 OHOS QPA plugin:
   - set `defaultFilePathUri` only when the caller provides a nonempty path;
   - convert only `*.` extension patterns to HarmonyOS suffixes;
   - omit `fileSuffixFilters` completely when no valid suffix filters remain.
3. Replace these files in the HarmonyOS project, preserving their names:

```text
entry/libs/arm64-v8a/libqtcreator.so
entry/libs/arm64-v8a/libqohos.so
```

Then clean the HarmonyOS project's generated build output before rebuilding the HAP, so Hvigor does not reuse an older native library.

## Verification

- `QtSupport` rebuilt successfully after the Qt Creator caller/filter changes.
- `QOhosPlatformIntegrationPlugin` rebuilt successfully after the QPA picker changes.
- The resulting HAP should contain both libraries at `libs/arm64-v8a/`.

## Notes

This is not a permission request issue. The system document picker grants access to the selected user file; Qt Creator must not start the picker from the application's private sandbox directory.

## Related

- [[semantic-qt-harmonyos-qt6-status]]
- [[procedural-qt-app-harmonyos-migration]]

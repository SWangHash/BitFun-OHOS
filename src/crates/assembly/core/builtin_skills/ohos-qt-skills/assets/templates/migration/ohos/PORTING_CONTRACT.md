# Qt-to-HarmonyOS porting contract

Keep this contract stable during implementation and repair loops. Queue
amendments and apply them between rounds.

## Posture and pinned stack

- Posture: `minimal-invasive` (redesign requires approval)
- Shared C++/QML remains authoritative: TODO
- Qt distribution / host tools: TODO
- HarmonyOS SDK/API / ABI: TODO
- Template, generator, build and package route: TODO

## Platform and packaging rules

- Isolate differences with `Q_OS_OHOS`, `OHOS`, qmake `ohos` scopes, CMake
  platform guards, adapters, or platform-specific files.
- Modify source-of-truth files; generated output and SDK installations are
  read-only.
- Native library identity, QPA/plugins, QML/resources, bundle identity,
  permissions, signing, and install policy: TODO

## Capability and behavior decisions

| ID | Module/feature/dependency | Disposition | Host behavior | HarmonyOS behavior | Validation | Evidence |
|---|---|---|---|---|---|---|
| CAP-001 | TODO | unknown | TODO | TODO | VAL-001 | TODO |

Allowed dispositions: `unchanged`, `guarded-adaptation`, `ohos-replacement`,
`packaging-only`, `degraded-approved`, `blocked`, `unknown`.

## External features

User selection recorded in `decisions.tsv` (`feature_or_scope=external-features`;
default: none). Selected features run inside their host phase through
`feature_gate.py enter/exit`.

| Feature | Kind | Host phase | Decision |
|---|---|---|---|
| TODO (or `none selected`) | TODO | TODO | TODO |

## Amendments and deviations

| ID | Status | Trigger/evidence | Proposed change | Approval |
|---|---|---|---|---|
| AMD-001 | queued | TODO | TODO | TODO |

# Workspace resources

The workspace's folder entry opens one persistent navigation panel containing the workspace
file tree. Opening this panel leaves the active conversation or editor intact.
The existing `file-viewer` navigation id and `file-viewer-nav` appearance identity
remain compatible with navigation links and installed skins. Files follow the
[workbench opening policy](../../workbench/README.md):
prefer the matching workspace's already open session tab and its right panel, or
open a main resource tab when no matching session tab is open. A cached or selected
session alone never opens a session tab. Existing main views are reused; a right-panel tab can be
popped out from its menu or dragged onto the top tab bar. There is no File View
content scene or intermediate container in the main tab bar.

Resource navigation owns an explicit `(device surface, workspace id)` browse target
in `navSceneStore`. The folder action and the panel's workspace switcher update only
that target; they never activate the global workspace, initialize/select a chat, or
create an empty session. Back/forward navigation retains the target. A closed target
or another device cannot fall back to the active workspace. Legacy untargeted entry
points still use the current workspace.

`WorkspaceResourcePanel` passes the resolved workspace to `FilesPanel`. File reads,
downloads, mutations, menus, search and file-tree terminal requests carry that
origin, including its SSH connection. Main conversations and their canvas snapshots
continue to follow explicit session activation.

Terminal sessions keep their existing owners: the shell navigation projects them, and the
terminal views run them. This panel never lists, starts or stops a terminal; the file tree
can only request one for a directory through the existing global terminal action.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `WorkspaceResourcePanel` | Workspace identity, composition, accessible section controls |
| `workspaceResourceState` | Device/workspace-scoped layout preferences; no files, terminal processes or credentials |
| `FilesPanel` / file-explorer | File operations, tree state, search and navigation |

The panel reuses existing owners; it does not create an independent filesystem cache.
Search preferences are kept in the file-explorer owner under an
explicit resource key, while results are refreshed from the target.

`WorkspaceBody` owns the shared navigation background material. Resource navigation
uses the same `NavPanel` transition as other navigation pages, with transparent
content above that material. Retained inactive navigation layers are inert and hidden
from assistive technology; resource navigation does not add an opaque cover.

## Interaction contracts

- The file section scrolls and supports collapse.
- File content opens keep workspace navigation visible. Explicit
  navigation back to the main sidebar is respected; settings keep their own navigation.
- File-tree context menus can request a terminal in the selected directory. The request is
  answered by the global terminal action, which opens the resulting shell view; it never
  replaces the active conversation or the resource navigation.
- The panel keeps no terminal, action-error or split state of its own; it renders files and
  layout preferences only.

## Workspace and device scope

Layout preferences include the device surface, remote connection and workspace identity.
A panel unmount only detaches UI listeners. Remote paths use POSIX semantics even on a
Windows controller, and a host error leaves the panel in an empty or unavailable state
instead of falling back to another device's workspace.

## Compatibility

Layout preferences are keyed by device surface, remote connection and workspace ID. A layout
persisted under the earlier path-inclusive key is migrated once when it is loaded, and unknown
or invalid persisted fields are ignored, so a record written by another client version stays
readable and the panel falls back to defaults instead of failing.

The feature is a shared Web UI surface over existing adapters. Remote-workspace and
peer scoping have contract coverage; these tests do not establish live SSH/peer,
mobile Remote Control, or Detached Dispatch end-to-end behavior.

## Focused verification

```bash
pnpm --dir src/web-ui run test:run src/app/scenes/workspace-resources/workspaceResources.test.ts src/shared/stores/persistStorageFallback.test.ts src/tools/file-system/utils/fileTreeReveal.test.ts
pnpm --dir src/web-ui run test:run src/tools/file-explorer/controller/ExplorerController.test.ts src/infrastructure/api/service-api/WorkspaceAPI.test.ts src/shared/context-menu-system/core/ContextResolver.resourceScope.test.ts
pnpm run check:web
pnpm run i18n:audit
```

No mock-based visual validation or browser control is required for this change.

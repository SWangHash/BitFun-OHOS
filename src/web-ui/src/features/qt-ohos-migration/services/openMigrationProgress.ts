import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import { i18nService } from '@/infrastructure/i18n';
import { createTab } from '@/shared/utils/tabUtils';

export const MIGRATION_PROGRESS_PANEL_TYPE = 'migration-progress' as const;
const MIGRATION_PROGRESS_CONTENT_ROLE = 'migration-progress';

export interface MigrationProgressPanelData {
  /** Explicit ledger root (`<app>/migration/ohos`). Resolved from the workspace when absent. */
  ledgerRoot?: string;
  workspacePath?: string;
  remoteConnectionId?: string;
}

export function getMigrationProgressDuplicateKey(data: MigrationProgressPanelData): string {
  return `migration-progress:${data.workspacePath ?? data.ledgerRoot ?? 'default'}`;
}

export type OpenMigrationProgressOptions = MigrationProgressPanelData;

/**
 * Open (or focus) the migration progress tab in the agent-scene aux pane.
 * One tab per workspace; the panel re-resolves its ledger root itself.
 * Callers open it only for a workspace that holds `migration/ohos/STATE.md`.
 */
export function openMigrationProgressPanel(options: OpenMigrationProgressOptions): void {
  const data = { ...options };
  const duplicateCheckKey = getMigrationProgressDuplicateKey(data);
  createTab({
    type: MIGRATION_PROGRESS_PANEL_TYPE,
    // `common` is always loaded, unlike the lazily loaded `panels/migration`.
    title: i18nService.getT()('common:tabs.migrationProgress'),
    data,
    metadata: {
      duplicateCheckKey,
      contentRole: MIGRATION_PROGRESS_CONTENT_ROLE,
      workspacePath: data.workspacePath,
    },
    checkDuplicate: true,
    duplicateCheckKey,
    replaceExisting: false,
    mode: 'agent',
  });
}

/**
 * Close every migration progress tab of the agent canvas (the canvas holds the
 * current workspace's tabs; other workspaces' tabs live in their snapshots).
 */
export function closeMigrationProgressPanels(): void {
  const canvas = useAgentCanvasStore.getState();
  // Bounded: each pass removes one tab.
  for (let pass = 0; pass < 8; pass += 1) {
    const found = canvas.findTabByMetadata({ contentRole: MIGRATION_PROGRESS_CONTENT_ROLE });
    if (!found) return;
    useAgentCanvasStore.getState().closeTab(found.tab.id, found.groupId, { forceRemove: true });
  }
}

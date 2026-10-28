import { globalEventBus } from '@/infrastructure/event-bus';
import type { SurfaceScope } from '@/infrastructure/peer-device/deviceSurface';

export const HOOK_IMPORT_CHANGED = 'agent-hooks:import:changed';

export interface HookImportChanged {
  surfaceId: string;
  /**
   * Import snapshot revision the owner acknowledged. A reader that already
   * displays this revision holds the write result and must not reread it.
   */
  revision: string;
}

/** Emit only after the Hook import store acknowledged the write on this device. */
export function notifyHookImportChanged(scope: SurfaceScope, revision: string): void {
  scope.assertCurrent('publish Hook import change');
  globalEventBus.emit(
    HOOK_IMPORT_CHANGED,
    { surfaceId: scope.surfaceId, revision } satisfies HookImportChanged,
  );
}

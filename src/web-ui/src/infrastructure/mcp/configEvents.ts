import { globalEventBus } from '@/infrastructure/event-bus';
import type { SurfaceScope } from '@/infrastructure/peer-device/deviceSurface';

export const MCP_CONFIG_CHANGED = 'mcp:config:changed';
export interface MCPConfigChanged { surfaceId: string }

/** Emit only after persistence is acknowledged on the same device activation. */
export function notifyMcpConfigChanged(scope: SurfaceScope): void {
  scope.assertCurrent('publish MCP configuration change');
  globalEventBus.emit(MCP_CONFIG_CHANGED, { surfaceId: scope.surfaceId } satisfies MCPConfigChanged);
}

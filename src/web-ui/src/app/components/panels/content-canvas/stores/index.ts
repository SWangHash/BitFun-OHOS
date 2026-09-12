/**
 * Unified exports for stores module.
 */

export {
  CanvasStoreModeContext,
  useCanvasStore,
  useAgentCanvasStore,
  useGitCanvasStore,
  useBottomTerminalCanvasStore,
  useGroupTabs,
  useActiveTabId,
  useLayout,
  useDragging,
  switchAgentCanvasWorkspace,
  cacheAgentCanvasTabForWorkspace,
  removeAgentCanvasSnapshot,
  clearAgentCanvasForPeerSwitch,
} from './canvasStore';

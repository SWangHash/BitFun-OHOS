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
switchAgentCanvasScope,
  switchAgentCanvasWorkspace,
  cacheAgentCanvasTabForWorkspace,
  removeAgentCanvasSnapshot,
  clearAgentCanvasForPeerSwitch,
} from './canvasStore';

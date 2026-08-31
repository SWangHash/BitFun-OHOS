/**
 * Unified exports for stores module.
 */

export {
  CanvasStoreModeContext,
  useCanvasStore,
  useAgentCanvasStore,
  useProjectCanvasStore,
  useGitCanvasStore,
  usePanelViewCanvasStore,
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

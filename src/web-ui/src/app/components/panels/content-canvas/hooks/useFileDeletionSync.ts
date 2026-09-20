/**
 * useFileDeletionSync Hook
 * Listens for global file-deletion events and flags every open tab whose file
 * (or an ancestor directory of its file) was deleted, so background tabs show
 * the "deleted" state without waiting for their editor's active-only disk poll.
 */

import { useEffect } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import {
  useAgentCanvasStore,
  useProjectCanvasStore,
  useGitCanvasStore,
  usePanelViewCanvasStore,
  useBottomTerminalCanvasStore,
} from '../stores';

/**
 * Mark matching tabs in all canvas store instances (agent / project / git /
 * panel-view / bottom-terminal). Tabs live in independent stores per scene,
 * and a deletion is workspace-global.
 */
export const useFileDeletionSync = (): void => {
  useEffect(() => {
    const handleFileDeleted = (data: { filePath?: string }) => {
      if (!data?.filePath) {
        return;
      }
      useAgentCanvasStore.getState().markTabsFileDeletedByPath(data.filePath);
      useProjectCanvasStore.getState().markTabsFileDeletedByPath(data.filePath);
      useGitCanvasStore.getState().markTabsFileDeletedByPath(data.filePath);
      usePanelViewCanvasStore.getState().markTabsFileDeletedByPath(data.filePath);
      useBottomTerminalCanvasStore.getState().markTabsFileDeletedByPath(data.filePath);
    };

    return globalEventBus.on('editor:file-deleted', handleFileDeleted);
  }, []);
};

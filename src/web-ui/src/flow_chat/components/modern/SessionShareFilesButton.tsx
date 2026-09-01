import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Files } from 'lucide-react';
import { IconButton } from '@/component-library';
import { useSnapshotState } from '@/tools/snapshot_system/hooks/useSnapshotState';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance';
import './SessionShareFilesButton.scss';

interface SessionShareFilesButtonProps {
  sessionId?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

interface PanelPosition {
  top: number;
  left: number;
}

const PANEL_OFFSET_Y = 4;

function basename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Header button that lists files the agent wrote during the current session.
 * Sibling of `SessionTreePopover` in the FlowChat header right-actions area.
 *
 * Only renders on the OpenHarmony host — `isOpenHarmonyRuntime()` returns
 * false everywhere else, so the button stays hidden and the file-list fetch
 * is the only cost on unsupported runtimes. The file list itself comes from
 * the existing snapshot system (`useSnapshotState`), which already tracks
 * agent write_file / edit_file / create_file operations, so no new tracking
 * is introduced.
 *
 * UX (current scope — list-only):
 *  1. Click the files icon → popover lists session files (basename + path).
 *
 * The per-file share actions (隔空传送 / 碰一碰) are intentionally not
 * surfaced here. The underlying `share_file_ohos` ArkTS bridge and the
 * `shareLocalFile` helper in `services/fileShare` remain available for
 * when the share-mode UX is re-introduced.
 */
export const SessionShareFilesButton: React.FC<SessionShareFilesButtonProps> = ({
  sessionId,
  t,
}) => {
  const { files } = useSnapshotState(sessionId);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const supported = isOpenHarmonyRuntime();
  const hasFiles = files.length > 0;
  const visible = supported && hasFiles;

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setPanelPos(null);
  }, []);

  const repositionPanel = useCallback(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = 320;
    // Right-align the panel with the trigger button's right edge; clamp to
    // the viewport so a button near the right screen edge does not overflow.
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
    setPanelPos({ top: rect.bottom + PANEL_OFFSET_Y, left });
  }, [isOpen]);

  useLayoutEffect(() => {
    repositionPanel();
  }, [repositionPanel, isOpen, files.length]);

  // Close on outside click / Escape. The panel guards its own ref so an
  // internal click does not dismiss the popover.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointer = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closePanel();
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel();
    };
    const handleResize = (): void => {
      repositionPanel();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, closePanel, repositionPanel]);

  const handleTriggerClick = useCallback(() => {
    if (isOpen) {
      closePanel();
      return;
    }
    setIsOpen(true);
  }, [isOpen, closePanel]);

  if (!visible) {
    return null;
  }

  const buttonLabel = t('flow-chat:sessionShare.button');

  return (
    <div className="session-share-files-button" data-bf-component="flow-chat-header" data-bf-part="shareFiles">
      <IconButton
        ref={triggerRef}
        className={[
          'session-share-files-button__trigger',
          isOpen && 'session-share-files-button__trigger--active',
        ].filter(Boolean).join(' ')}
        variant="ghost"
        size="xs"
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={handleTriggerClick}
        data-testid="flowchat-header-session-share-files"
        data-bf-component="flow-chat-header"
        data-bf-part="shareFilesTrigger"
      >
        <Files size={14} />
      </IconButton>

      {isOpen && panelPos !== null && createPortal(
        <div
          ref={panelRef}
          className="session-share-files-button__panel"
          style={{ top: panelPos.top, left: panelPos.left }}
          role="dialog"
          aria-label={buttonLabel}
          data-bf-component="flow-chat-header"
          data-bf-part="shareFilesPanel"
        >
          <div
            className="session-share-files-button__panel-header"
            data-bf-component="flow-chat-header"
            data-bf-part="shareFilesHeader"
          >
            <span className="session-share-files-button__panel-title">
              {t('flow-chat:sessionShare.title')}
            </span>
            <span className="session-share-files-button__panel-count">
              {files.length}
            </span>
          </div>
          <ul
            className="session-share-files-button__file-list"
            data-bf-component="flow-chat-header"
            data-bf-part="shareFilesList"
          >
            {files.map(file => {
              const name = basename(file.filePath);
              return (
                <li
                  key={file.filePath}
                  className="session-share-files-button__file-item"
                  data-bf-component="flow-chat-header"
                  data-bf-part="shareFilesItem"
                >
                  <div className="session-share-files-button__file-name" title={file.filePath}>
                    {name}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="session-share-files-button__panel-footer">
            {t('flow-chat:sessionShare.footerHint')}
          </div>
        </div>,
        getAppearanceOverlayHost(),
      )}
    </div>
  );
};

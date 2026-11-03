/**
 * Export dialog turns as long images.
 * Uses React rendering to match FlowChat styles.
 * Uses modern-screenshot (fork of html-to-image with better CSS var / font / CORS handling).
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowChatStore } from '../../store/FlowChatStore';
import { notificationService, type LoadingController } from '@/shared/notification-system';
import { FlowTextBlock } from '../FlowTextBlock';
import { FlowToolCard } from '../FlowToolCard';
import { Icon, IconButton, Menu, MenuItem, Tooltip, createOverlayPortal, subscribeOverlayInteraction } from '@bitfun/ui';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useAnchoredPopoverPosition } from '@/shared/utils/useAnchoredPopoverPosition';
import type { DialogTurn, FlowTextItem, FlowToolItem, FlowThinkingItem } from '../../types/flow-chat';
import { i18nService, useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { getBuiltinAppearanceThemeToken } from '@/infrastructure/appearance/builtins/catalog';
import { elapsedMs, nowMs, withTimeout } from '@/shared/utils/timing';
import { savePngBlob, notifyPngExportSuccess } from '@/flow_chat/utils/saveExportedPng';
import { ModelThinkingDisplay } from '../../tool-cards/ModelThinkingDisplay';
import {
  captureExportImage, ImageCaptureError, ImageCaptureTimeoutError, LOGO_PLACEHOLDER_CLASS, type ImageCaptureStage,
} from './captureExportImage';
import './ExportImageButton.scss';

const log = createLogger('ExportImageButton');

/** Minimum time to wait for React render before capture (ms). */
const MIN_RENDER_WAIT_MS = 300;

/** Additional time per model-round item for complex content (ms). */
const PER_ROUND_WAIT_MS = 80;

/** Maximum total render wait time (ms). */
const MAX_RENDER_WAIT_MS = 2_000;

/** Collect ALL CSS custom properties from document :root so the offscreen
 *  render inherits the full appearance (fonts, radii, shadows, spacing, etc.).
 *  modern-screenshot resolves var() by cloning computed styles, but
 *  variables used inside the captured subtree must still be available on
 *  the wrapper element for correct initial layout. */
function collectAllCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  const computedStyle = getComputedStyle(document.documentElement);
  for (let i = 0; i < computedStyle.length; i++) {
    const prop = computedStyle[i];
    if (prop.startsWith('--')) {
      const value = computedStyle.getPropertyValue(prop).trim();
      if (value) {
        vars[prop] = value;
      }
    }
  }
  return vars;
}

interface ExportImageButtonProps {
  turnId: string;
  className?: string;
}

// Exported content renderer.
interface ExportContentProps {
  dialogTurn: DialogTurn;
  expandThinking: boolean;
}

const ExportContent: React.FC<ExportContentProps> = ({ dialogTurn, expandThinking }) => {
  return (
    <div data-bitfun-product-component="export-image" data-bitfun-product-part="root" className="export-content">
      <div className="export-content__header" data-bitfun-product-component="export-image" data-bitfun-product-part="header">
        {/* Placeholder reserves space for the logo. The actual logo is drawn
            onto the final image via canvas compositing to avoid issues with
            embedding <img>/data URLs inside an SVG foreignObject. */}
        <div
          className={`export-content__logo ${LOGO_PLACEHOLDER_CLASS}`}
          data-bitfun-product-component="export-image"
          data-bitfun-product-part="logo"
          aria-label="BitFun"
        />
        <div className="export-content__title-group" data-bitfun-product-component="export-image" data-bitfun-product-part="title">
          <div className="export-content__title">BitFun</div>
          <div className="export-content__subtitle">{i18nService.t('flow-chat:exportImage.subtitle').replace(/ /g, '\u00A0')}</div>
        </div>
        <div className="export-content__timestamp" data-bitfun-product-component="export-image" data-bitfun-product-part="timestamp">
          {i18nService.formatDate(new Date())}
        </div>
      </div>

      {dialogTurn.userMessage?.content && (
        <div className="export-content__user-section" data-bitfun-product-component="export-image" data-bitfun-product-part="user">
          <div className="export-content__user-bubble">
            {dialogTurn.userMessage.content}
          </div>
        </div>
      )}

      <div className="export-content__ai-section" data-bitfun-product-component="export-image" data-bitfun-product-part="assistant">
        
        {dialogTurn.modelRounds.map((modelRound) => (
          <div key={modelRound.id} className="export-content__model-round" data-bitfun-product-component="export-image" data-bitfun-product-part="round">
            {[...modelRound.items]
              .sort((a, b) => a.timestamp - b.timestamp)
              .map((item) => {
                if (item.type === 'text') {
                  const textItem = item as FlowTextItem;
                  if (textItem.content && textItem.content.trim()) {
                    return (
                      <div data-bitfun-product-component="export-image" data-bitfun-product-part="text" key={item.id} className="export-content__text-item">
                        <FlowTextBlock 
                          textItem={{
                            ...textItem,
                            isStreaming: false,
                          }}
                        />
                      </div>
                    );
                  }
                } else if (item.type === 'thinking') {
                  const thinkingItem = item as FlowThinkingItem;
                  return (
                    <div data-bitfun-product-component="export-image" data-bitfun-product-part="thinking" key={item.id} className={`export-content__thinking-item${expandThinking ? ' export-content__thinking-item--expanded' : ''}`}>
                      <ModelThinkingDisplay 
                        thinkingItem={{
                          ...thinkingItem,
                          isStreaming: false,
                        }}
                        isLastItem={false}
                        forceExpanded={expandThinking}
                      />
                    </div>
                  );
                } else if (item.type === 'tool') {
                  const toolItem = item as FlowToolItem;
                  return (
                    <div data-bitfun-product-component="export-image" data-bitfun-product-part="tool" key={item.id} className="export-content__tool-item">
                      <FlowToolCard toolItem={toolItem} />
                    </div>
                  );
                }
                return null;
              })}
          </div>
        ))}
      </div>

      <div className="export-content__footer" data-bitfun-product-component="export-image" data-bitfun-product-part="footer">
        <span>{i18nService.t('flow-chat:exportImage.poweredBy').replace(/ /g, '\u00A0')}</span>
        <span className="export-content__footer-brand">BitFun</span>
        <span>•</span>
        <span>{i18nService.t('flow-chat:exportImage.aiAssistant').replace(/ /g, '\u00A0')}</span>
      </div>
    </div>
  );
};

export const ExportImageButton: React.FC<ExportImageButtonProps> = ({
  turnId,
  className = ''
}) => {
  const { t } = useI18n('flow-chat');
  const [isExporting, setIsExporting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuLayout = useAnchoredPopoverPosition({
    open: isMenuOpen,
    anchorRef: buttonRef,
    popoverRef: menuRef,
    preferredPlacement: 'top',
    alignment: 'end',
    gap: 4,
  });

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    const removeMousedown = subscribeOverlayInteraction(menuRef, 'mousedown', handleClickOutside);
    const removeKeyDown = subscribeOverlayInteraction(menuRef, 'keydown', handleKeyDown);
    return () => {
      removeMousedown();
      removeKeyDown();
    };
  }, [isMenuOpen]);
  // Ref guard to prevent double-invocation while state update is pending.
  const isExportingRef = useRef(false);

  // Resolve the DialogTurn and its session title by turn id.
  const getDialogTurn = useCallback((): { turn: DialogTurn; sessionTitle: string } | null => {
    const flowChatStore = FlowChatStore.getInstance();
    const state = flowChatStore.getState();
    
    for (const [, session] of state.sessions) {
      const turn = session.dialogTurns.find((t: DialogTurn) => t.id === turnId);
      if (turn) return { turn, sessionTitle: session.title?.trim() || '' };
    }
    return null;
  }, [turnId]);

  const handleExport = useCallback(async (expandThinking: boolean) => {
    if (isExportingRef.current) return;
    setIsMenuOpen(false);
    isExportingRef.current = true;
    setIsExporting(true);
    
    // Let animations start rendering.
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Track offscreen DOM so we can clean up on any exit path.
    let root: ReturnType<typeof createRoot> | null = null;
    let wrapper: HTMLDivElement | null = null;
    let progress: LoadingController | null = null;
    
    const cleanupDom = () => {
      try {
        if (root) { root.unmount(); root = null; }
        if (wrapper && wrapper.parentNode) { wrapper.parentNode.removeChild(wrapper); wrapper = null; }
      } catch (e) {
        log.warn('DOM cleanup error', e);
      }
    };
    
    try {
      const result = getDialogTurn();
      
      if (!result) {
        notificationService.error(i18nService.t('flow-chat:exportImage.dialogNotFound'));
        return;
      }
      
      const { turn: dialogTurn, sessionTitle } = result;
      const stageMessages: Record<ImageCaptureStage | 'stopping', string> = {
        preparing: t('exportImage.preparing'),
        cloning: t('exportImage.preparing'),
        assets: t('exportImage.loadingImages'),
        rendering: t('exportImage.generating'),
        encoding: t('exportImage.encoding'),
        stopping: t('exportImage.stopping'),
      };
      progress = notificationService.loading({
        title: t('exportImage.exportToImage'),
        message: stageMessages.preparing,
      });
      
      // Read the resolved appearance background color.
      const computedStyle = getComputedStyle(document.documentElement);
      const bgColor = computedStyle.getPropertyValue('--bitfun-color-surface-scene').trim()
        || getBuiltinAppearanceThemeToken('--bitfun-color-surface-scene');

      // Pre-load the logo as an HTMLImageElement. We do NOT try to embed it
      // inside the captured DOM (unreliable with <img>/data URLs inside an
      // SVG foreignObject). Instead we reserve space with a placeholder
      // element and composite the logo onto the final raster via canvas.
      let logoImage: HTMLImageElement | null = null;
      try {
        logoImage = await withTimeout(
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new window.Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            // Cache-bust to avoid stale decoded copies when re-exporting.
            const colorScheme = document.documentElement.getAttribute('data-color-scheme');
            const logoPath = colorScheme === 'dark'
              ? '/brand/bitfun-mark-light.png'
              : '/brand/bitfun-mark-dark.png';
            img.src = `${logoPath}?t=${Date.now()}`;
          }),
          3_000,
          'Logo preload',
        );
      } catch (e) {
        log.warn('Logo preload failed; export will proceed without logo overlay', e);
      }
      
      // Create hidden wrapper for rendering.
      // Use left: -9999px (not z-index: -9999) so elements remain visible to capture.
      wrapper = document.createElement('div');
      wrapper.id = 'export-image-wrapper';
      wrapper.className = 'export-image-wrapper';

      // Measure the actual chat pane width so the exported image uses the
      // exact same text-wrap width as the live chat. Fallback to 1200px.
      const chatPane = document.querySelector('.bitfun-chat-pane__content');
      const chatWidth = chatPane?.getBoundingClientRect().width || 1200;

      wrapper.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        z-index: -9999;
        pointer-events: none;
        background: ${bgColor};
        visibility: visible;
        opacity: 1;
        overflow: visible;
        width: ${chatWidth}px;
      `;
      
      // Copy ALL CSS variables for consistent styling.
      const allVars = collectAllCssVariables();
      for (const [varName, value] of Object.entries(allVars)) {
        wrapper.style.setProperty(varName, value);
      }
      
      document.body.appendChild(wrapper);
      
      // Render export content with React.
      const renderStartedAt = nowMs();
      root = createRoot(wrapper);
      root.render(<ExportContent dialogTurn={dialogTurn} expandThinking={expandThinking} />);
      
      // Adaptive render wait: base time + per-round allowance, capped.
      const roundCount = dialogTurn.modelRounds?.length ?? 1;
      const renderWait = Math.min(
        MIN_RENDER_WAIT_MS + roundCount * PER_ROUND_WAIT_MS,
        MAX_RENDER_WAIT_MS,
      );
      await new Promise(resolve => setTimeout(resolve, renderWait));
      
      const container = wrapper.querySelector<HTMLElement>('.export-content');
      if (!container) {
        throw new Error(t('exportImage.containerNotFound'));
      }
      // Preserve the live pane's text wrapping, independently of output resolution.
      container.style.width = `${chatWidth}px`;
      container.style.maxWidth = 'none';
      await new Promise(resolve => setTimeout(resolve, 0));
      log.info('Image export content rendered', { durationMs: elapsedMs(renderStartedAt), roundCount });

      const blob = await captureExportImage(container, bgColor, logoImage,
        stage => progress?.updateMessage(stageMessages[stage]));
      cleanupDom();

      // Save image to downloads directory.
      const timestampStr = i18nService.formatDate(new Date(), {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(/[/:\s]/g, '-');
      // Sanitize session title for use as filename (replace unsafe chars).
      const safeTitle = sessionTitle
        .replace(/[/\\:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);
      const namePrefix = safeTitle || i18nService.t('flow-chat:exportImage.fileNamePrefix');
      const fileName = `${namePrefix}_${timestampStr}.png`;

      // Route through the shared platform-aware saver: on OpenHarmony the
      // Tauri path/fs plugins are not wired, so the blob must go through the
      // native `save_file_to_downloads_ohos` bridge (desktop uses plugin-fs,
      // plain browsers use the anchor-download fallback).
      progress.updateMessage(t('exportImage.saving'));
      const saveStartedAt = nowMs();
      const pngSaveResult = await savePngBlob(blob, fileName);
      log.info('Exported image saved', { durationMs: elapsedMs(saveStartedAt), bytes: blob.size });
      notifyPngExportSuccess(pngSaveResult);
    } catch (error) {
      // Ensure DOM is always cleaned up on error.
      cleanupDom();
      log.error('Export failed', { error });
      let reason = '';
      if (error instanceof ImageCaptureTimeoutError) {
        reason = t('exportImage.timedOut', { seconds: i18nService.formatNumber(error.timeoutMs / 1_000) });
      } else if (error instanceof ImageCaptureError) {
        const reasons: Record<ImageCaptureError['reason'], string> = {
          contentSizeUnavailable: t('exportImage.contentSizeUnavailable'),
          canvasUnavailable: t('exportImage.canvasUnavailable'),
          pngEncodingFailed: t('exportImage.pngEncodingFailed'),
        };
        reason = reasons[error.reason];
      } else if (error instanceof Error) {
        reason = error.message;
      } else if (typeof error === 'string') {
        reason = error;
      }
      notificationService.error(reason
        ? t('exportImage.exportFailedWithReason', { reason })
        : t('exportImage.exportFailed'));
    } finally {
      progress?.cancel();
      isExportingRef.current = false;
      setIsExporting(false);
    }
  }, [getDialogTurn, t]);

  return (
    <>
      <Tooltip content={isExporting ? i18nService.t('flow-chat:exportImage.exporting') : i18nService.t('flow-chat:exportImage.exportToImage')} placement="top">
        <IconButton
          ref={buttonRef}
          className={`model-round-item__action-btn model-round-item__export-btn ${className}`}
          data-bitfun-product-component="export-image"
          data-bitfun-product-part="trigger"
          data-bitfun-state={isExporting ? 'exporting' : undefined}
          onClick={() => setIsMenuOpen(current => !current)}
          disabled={isExporting}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={isExporting
            ? i18nService.t('flow-chat:exportImage.exporting')
            : i18nService.t('flow-chat:exportImage.exportToImage')}
          icon={isExporting
            ? <Icon name="progress-25" size="sm" className="spinning" />
            : <Icon name="image" size="sm" />}
        />
      </Tooltip>
      {isMenuOpen && createOverlayPortal(
        <Menu
          ref={menuRef}
          className="export-image-menu"
          data-bitfun-placement={menuLayout?.placement ?? 'top'}
          style={{
            top: `${menuLayout?.top ?? 0}px`,
            left: `${menuLayout?.left ?? 0}px`,
            visibility: menuLayout ? 'visible' : 'hidden',
          }}
        >
          <MenuItem type="button" onClick={() => void handleExport(false)}>
            {t('exportImage.collapsedThinking')}
          </MenuItem>
          <MenuItem type="button" onClick={() => void handleExport(true)}>
            {t('exportImage.expandedThinking')}
          </MenuItem>
        </Menu>,
        getAppearanceOverlayHost(),
      )}
    </>
  );
};

ExportImageButton.displayName = 'ExportImageButton';

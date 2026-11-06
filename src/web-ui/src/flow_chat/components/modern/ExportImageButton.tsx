/**
 * Export dialog turns as long images.
 * Uses React rendering to match FlowChat styles.
 * Uses modern-screenshot (fork of html-to-image with better CSS var / font / CORS handling).
 */

import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowChatStore } from '../../store/FlowChatStore';
import { notificationService, type LoadingController } from '@/shared/notification-system';
import { FlowTextBlock } from '../FlowTextBlock';
import { FlowToolCard } from '../FlowToolCard';
import { Button, Card, CardBody, CardHeader, Checkbox, Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, DialogHeading, DialogTitle, Icon, IconButton, Tooltip } from '@bitfun/ui';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import type { DialogTurn, FlowTextItem, FlowToolItem, FlowThinkingItem } from '../../types/flow-chat';
import { i18nService, useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { getBuiltinAppearanceThemeToken } from '@/infrastructure/appearance/builtins/catalog';
import { elapsedMs, nowMs, withTimeout } from '@/shared/utils/timing';
import { savePngBlob, notifyPngExportSuccess } from '@/flow_chat/utils/saveExportedPng';
import { ModelThinkingDisplay } from '../../tool-cards/ModelThinkingDisplay';
import { hasComposerPresentationReferences, parseComposerPresentation } from '../../utils/composerPresentation';
import { UserMessagePresentationContent, UserMessageTextContent } from './UserMessagePresentationContent';
import { readExportImageLayout } from './exportImageLayout';
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

interface ExportImageButtonProps {
  turnId: string;
  className?: string;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  renderTrigger?: (controls: {
    isExporting: boolean;
    onOpenDialog: () => void;
  }) => React.ReactNode;
}

// Exported content renderer.
interface ExportContentProps {
  dialogTurn: DialogTurn;
  expandThinking: boolean;
}

// The marker class comes from the capture module so both sides stay in step.
function ExportImagePreview({ expandThinking }: { expandThinking: boolean }) {
  const answerY = expandThinking ? 88 : 55;

  return (
    <svg
      className="export-image-preview"
      data-bitfun-product-component="export-image"
      data-bitfun-product-part="optionPreview"
      data-preview-thinking={expandThinking ? 'expanded' : 'collapsed'}
      viewBox="0 0 180 112"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="18" y="8" width="144" height="96" rx="8" fill="var(--bitfun-color-surface-scene)" stroke="var(--bitfun-color-border-default)" strokeWidth="var(--bitfun-border-width-default)" />
      <g fill="currentColor">
        <circle cx="34" cy="20" r="4" />
        <rect x="43" y="18" width="44" height="3" rx="1.5" fill="var(--bitfun-color-content-primary)" />
        <rect x="118" y="20" width="32" height="2" rx="1" fill="var(--bitfun-color-content-muted)" />
        <rect x="91" y="35" width="59" height="12" rx="4" fill="var(--bitfun-color-action-quiet-hover)" />
        <rect x="99" y="39" width="43" height="2" rx="1" />
        <rect x="99" y="43" width="30" height="2" rx="1" fill="var(--bitfun-color-content-muted)" />
        {expandThinking && (
          <g>
            <rect x="30" y="51" width="120" height="32" rx="4" fill="var(--bitfun-color-accent-surface)" stroke="var(--bitfun-color-accent-border)" strokeWidth="var(--bitfun-border-width-default)" />
            <rect x="30" y="56" width="2" height="22" rx="1" fill="var(--bitfun-color-accent-default)" />
            <g fill="var(--bitfun-color-accent-default)">
              <circle cx="38" cy="57" r="1.5" />
              <circle cx="43" cy="57" r="1.5" />
              <circle cx="48" cy="57" r="1.5" />
            </g>
            <rect x="56" y="56" width="38" height="2" rx="1" fill="var(--bitfun-color-accent-default)" />
            <g fill="var(--bitfun-color-content-secondary)">
              <rect x="38" y="63" width="104" height="2" rx="1" />
              <rect x="38" y="69" width="94" height="2" rx="1" />
              <rect x="38" y="75" width="73" height="2" rx="1" />
            </g>
          </g>
        )}
        <g transform={`translate(0 ${answerY})`}>
          <rect x="30" width="48" height="3" rx="1.5" fill="var(--bitfun-color-content-primary)" />
          <rect x="30" y="6" width="120" height="2" rx="1" />
          <rect x="30" y="11" width="96" height="2" rx="1" />
          {!expandThinking && <g>
            <rect x="30" y="22" width="112" height="2" rx="1" />
            <rect x="30" y="27" width="82" height="2" rx="1" />
          </g>}
        </g>
      </g>
    </svg>
  );
}

export const ExportContent: React.FC<ExportContentProps> = ({ dialogTurn, expandThinking }) => {
  const presentation = parseComposerPresentation(dialogTurn.userMessage?.metadata?.composerPresentation);

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
        <div className="export-content__title" data-bitfun-product-component="export-image" data-bitfun-product-part="title">BitFun</div>
        <div className="export-content__timestamp" data-bitfun-product-component="export-image" data-bitfun-product-part="timestamp">
          {i18nService.formatDate(new Date())}
        </div>
      </div>

      {dialogTurn.userMessage?.content && (
        <div className="export-content__user-section" data-bitfun-product-component="export-image" data-bitfun-product-part="user">
          <div className="export-content__user-bubble">
            {hasComposerPresentationReferences(presentation)
              ? <UserMessagePresentationContent presentation={presentation} />
              : <UserMessageTextContent text={dialogTurn.userMessage.content} />}
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
                  if (!expandThinking) return null;
                  const thinkingItem = item as FlowThinkingItem;
                  return (
                    <div data-bitfun-product-component="export-image" data-bitfun-product-part="thinking" key={item.id} className="export-content__thinking-item export-content__thinking-item--expanded">
                      <ModelThinkingDisplay
                        thinkingItem={{
                          ...thinkingItem,
                          isStreaming: false,
                          status: 'completed',
                        }}
                        isLastItem={false}
                        forceExpanded
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
        <span>{i18nService.t('flow-chat:exportImage.poweredBy')}</span>
        <span className="export-content__footer-brand">BitFun</span>
      </div>
    </div>
  );
};

export const ExportImageButton: React.FC<ExportImageButtonProps> = ({
  turnId,
  className = '',
  triggerRef,
  renderTrigger,
}) => {
  const { t } = useI18n('flow-chat');
  const [isExporting, setIsExporting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [expandThinking, setExpandThinking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const compactOptionRef = useRef<HTMLInputElement>(null);
  const thinkingOptionRef = useRef<HTMLInputElement>(null);
  // Ref guard to prevent double-invocation while state update is pending.
  const isExportingRef = useRef(false);

  const openExportDialog = useCallback(() => {
    if (isExportingRef.current) return;
    // Restore to the resident trigger rather than the menu item that is closing.
    (triggerRef ?? buttonRef).current?.focus({ preventScroll: true });
    setExpandThinking(false);
    setIsDialogOpen(true);
  }, [triggerRef]);

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
    setIsDialogOpen(false);
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
      const layout = readExportImageLayout(turnId, (triggerRef ?? buttonRef).current);
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
      // Keep the staging tree laid out without covering the conversation.
      wrapper = document.createElement('div');
      wrapper.id = 'export-image-wrapper';
      wrapper.className = 'export-image-wrapper';

      wrapper.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        pointer-events: none;
        background: ${bgColor};
        visibility: visible;
        opacity: 1;
        overflow: visible;
      `;
      if (layout.width) wrapper.style.width = `${layout.width}px`;
      
      // Preserve the column's appearance for layout. Capture serializes only
      // resolved properties, so inherited variables do not bloat the SVG.
      for (const [varName, value] of Object.entries(layout.variables)) {
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
      
      // Find rendered container.
      const container = wrapper.querySelector<HTMLElement>('.export-content');

      if (!container) {
        throw new Error(i18nService.t('flow-chat:exportImage.containerNotFound'));
      }

      // Yield to the main thread so the browser can finish layout/paint.
      await new Promise(resolve => setTimeout(resolve, 0));
      // The wrapper carries the live reading-column width, so the content keeps
      // the pane's text wrapping without overriding `.export-content` here.
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
  }, [getDialogTurn, t, triggerRef, turnId]);

  return (
    <>
      {renderTrigger ? renderTrigger({ isExporting, onOpenDialog: openExportDialog }) : (
        <Tooltip content={isExporting ? t('exportImage.exporting') : t('exportImage.exportToImage')} placement="top">
          <IconButton
            ref={buttonRef}
            className={`model-round-item__action-btn model-round-item__export-btn ${className}`}
            data-bitfun-product-component="export-image"
            data-bitfun-product-part="trigger"
            data-bitfun-state={isExporting ? 'exporting' : undefined}
            onClick={openExportDialog}
            loading={isExporting}
            aria-haspopup="dialog"
            aria-expanded={isDialogOpen}
            aria-label={isExporting ? t('exportImage.exporting') : t('exportImage.exportToImage')}
            icon={<Icon name="image" size="sm" />}
          />
        </Tooltip>
      )}
      <Dialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        size="md"
        initialFocusRef={compactOptionRef}
        portalTarget={getAppearanceOverlayHost()}
        data-testid="export-image-dialog"
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('exportImage.exportToImage')}</DialogTitle>
          </DialogHeading>
          <DialogClose aria-label={t('common:actions.close')} />
        </DialogHeader>
        <DialogBody>
          <div
            className="export-image-options"
            data-bitfun-product-component="export-image"
            data-bitfun-product-part="options"
            role="group"
            aria-label={t('exportImage.exportToImage')}
            onKeyDown={event => {
              let next: boolean;
              if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) next = !expandThinking;
              else if (event.key === 'Home') next = false;
              else if (event.key === 'End') next = true;
              else return;
              event.preventDefault();
              setExpandThinking(next);
              (next ? thinkingOptionRef : compactOptionRef).current?.focus({ preventScroll: true });
            }}
          >
            <Card
              className="export-image-option-card"
              appearance="neutral"
              padding="sm"
              data-bitfun-product-component="export-image"
              data-bitfun-product-part="optionCard"
              onClick={() => {
                setExpandThinking(false);
                compactOptionRef.current?.focus({ preventScroll: true });
              }}
            >
              <CardHeader actions={(
                <Checkbox
                  ref={compactOptionRef}
                  checked={!expandThinking}
                  aria-label={t('exportImage.collapsedThinking')}
                  onCheckedChange={() => setExpandThinking(false)}
                  data-testid="export-image-compact"
                />
              )} />
              <CardBody align="center" className="export-image-option-content" data-bitfun-product-component="export-image" data-bitfun-product-part="optionContent">
                <ExportImagePreview expandThinking={false} />
                <span className="export-image-option-label" data-bitfun-product-component="export-image" data-bitfun-product-part="optionLabel">{t('exportImage.collapsedThinking')}</span>
              </CardBody>
            </Card>
            <Card
              className="export-image-option-card"
              appearance="neutral"
              padding="sm"
              data-bitfun-product-component="export-image"
              data-bitfun-product-part="optionCard"
              onClick={() => {
                setExpandThinking(true);
                thinkingOptionRef.current?.focus({ preventScroll: true });
              }}
            >
              <CardHeader actions={(
                <Checkbox
                  ref={thinkingOptionRef}
                  checked={expandThinking}
                  aria-label={t('exportImage.expandedThinking')}
                  onCheckedChange={() => setExpandThinking(true)}
                  data-testid="export-image-thinking"
                />
              )} />
              <CardBody align="center" className="export-image-option-content" data-bitfun-product-component="export-image" data-bitfun-product-part="optionContent">
                <ExportImagePreview expandThinking />
                <span className="export-image-option-label" data-bitfun-product-component="export-image" data-bitfun-product-part="optionLabel">{t('exportImage.expandedThinking')}</span>
              </CardBody>
            </Card>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="fill" onClick={() => setIsDialogOpen(false)} data-testid="export-image-cancel">
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void handleExport(expandThinking)} disabled={isExporting} data-testid="export-image-confirm">
            {t('common:actions.export')}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
};

ExportImageButton.displayName = 'ExportImageButton';

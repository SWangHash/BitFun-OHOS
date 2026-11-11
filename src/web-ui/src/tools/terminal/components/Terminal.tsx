import { VisualSkinSurfacePaint } from '@/infrastructure/visual-skin/VisualSkinSurfacePaint';
/**
 * Terminal base component built on xterm.js.
 * Optimizations include debounced resize and visibility-aware refresh.
 */

import React, { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  TerminalResizeDebouncer,
  DEFAULT_XTERM_MINIMUM_CONTRAST_RATIO,
  decideFitResize,
  decideResizeUnderColumnGuard,
  resolveUnmappedKeydownSequence,
} from '../utils';
import type { ReplayColumnGuard, TerminalPasteDecision } from '../utils';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { xtermAppearanceAdapter } from '@/infrastructure/appearance/adapters/XtermAppearanceAdapter';
import { createLogger } from '@/shared/utils/logger';
import { sendDebugProbe } from '@/shared/utils/debugProbe';
import { nowMs } from '@/shared/utils/timing';
import {
  getTypographyTokenNumber,
  readActiveTypographyTokenValue,
  readActiveTypographyTokenPx,
} from '@/infrastructure/design-system/typographyRuntime';
import { fontPreferenceService } from '@/infrastructure/font-preference';
import { attachTerminalDiagnostics } from '../services/terminalDiagnostics';
import '@xterm/xterm/css/xterm.css';
import { readTextFromClipboard } from '@/shared/utils/textSelection';
import './Terminal.scss';

const log = createLogger('Terminal');
const MIN_STABLE_TERMINAL_ROWS = 3;
/** Narrowest column count the terminal lays out at; below it the columns are kept. */
const MIN_STABLE_TERMINAL_COLS = 40;
/**
 * Deferred fits that follow a layout event that is not trustworthy on its own.
 *
 * A host may deliver the final container size after the frame that observed the
 * change, and a replay column guard refuses a column shrink for a while. Neither
 * produces another ResizeObserver entry once the box stops moving, so a single fit
 * can settle on a geometry the panel no longer has - or be skipped entirely, which
 * also leaves a caller waiting for a measured size (and its shell) forever. These
 * retries are idempotent: a fit that measures the current size does nothing.
 */
const SETTLE_REFIT_DELAYS_MS = [120, 420, 1_200, 2_400];
const TERMINAL_FONT_WEIGHT = getTypographyTokenNumber('font.weight.regular');
const TERMINAL_FONT_WEIGHT_BOLD = getTypographyTokenNumber('font.weight.bold');

// Empty xterm buffers start with blank rows. Do not treat those as replayed
// content, otherwise a new terminal can inherit the replay column guard and skip
// its first real fit.
function terminalHasBufferedScreenText(terminal: XTerm): boolean {
  const buffer = terminal.buffer.active;
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)?.translateToString(true) ?? '';
    if (line.trim().length > 0) {
      return true;
    }
  }
  return false;
}

type TerminalCoreWithMeasurement = XTerm & {
  _core?: {
    _charSizeService?: {
      measure?: () => void;
    };
    _renderService?: {
      handleDevicePixelRatioChange?: () => void;
      handleResize?: (cols: number, rows: number) => void;
    };
  };
};

/**
 * Clear xterm texture atlas when supported.
 * Used to force redraws and avoid WebGL cache artifacts.
 */
function clearTextureAtlas(terminal: XTerm): void {
  // clearTextureAtlas is internal; access via a type cast.
  const rawTerminal = terminal as unknown as { _core?: { _renderService?: { _renderer?: { _charAtlasCache?: { clear?: () => void }; clearTextureAtlas?: () => void } } } };
  try {
    rawTerminal._core?._renderService?._renderer?.clearTextureAtlas?.();
  } catch {
    // Ignore if unsupported.
  }
}

function remeasureTerminal(terminal: XTerm): void {
  const rawTerminal = terminal as TerminalCoreWithMeasurement;
  rawTerminal._core?._charSizeService?.measure?.();
  rawTerminal._core?._renderService?.handleDevicePixelRatioChange?.();
}

/**
 * Whether xterm still paints the geometry of the previous row/column count.
 *
 * The screen box is sized from the dimensions the render service caches, and the host
 * applies that render one or more frames after `resize()` returned. A panel that was
 * just mounted or re-parented therefore paints the previous row count inside its new
 * box, and every later fit measures the same size and returns early, so nothing
 * corrects it until the user resizes the panel by hand.
 *
 * The DOM box is the primary evidence - it is what the user sees - with the render
 * service's own numbers as a fallback for hosts without a measurable screen element.
 */
function rendererGeometryIsStale(terminal: XTerm): boolean {
  const cell = terminal.dimensions?.css?.cell;
  if (!cell?.width || !cell?.height) {
    return false;
  }

  const expectedWidth = terminal.cols * cell.width;
  const expectedHeight = terminal.rows * cell.height;
  const screenElement = terminal.element?.querySelector<HTMLElement>('.xterm-screen');

  if (screenElement) {
    return (
      Math.abs(screenElement.offsetHeight - expectedHeight) > cell.height / 2
      || Math.abs(screenElement.offsetWidth - expectedWidth) > cell.width / 2
    );
  }

  const canvas = terminal.dimensions?.css?.canvas;
  if (!canvas) return false;

  return (
    Math.abs(canvas.height - expectedHeight) > cell.height / 2
    || Math.abs(canvas.width - expectedWidth) > cell.width / 2
  );
}

/** Re-apply the buffer's geometry to the renderer. Returns true when it had to act. */
function syncStaleRendererGeometry(terminal: XTerm): boolean {
  if (!rendererGeometryIsStale(terminal)) {
    return false;
  }

  const cell = terminal.dimensions?.css?.cell;
  log.debug('Renderer geometry was stale, re-applying the buffer size', {
    cols: terminal.cols,
    rows: terminal.rows,
    expectedHeight: cell ? Math.round(terminal.rows * cell.height) : null,
    paintedHeight: terminal.element?.querySelector<HTMLElement>('.xterm-screen')?.offsetHeight ?? null,
  });

  // Re-measuring drops the cached cell metrics and redraws with them, which is what
  // makes the screen box take the row count the buffer already has.
  remeasureTerminal(terminal);

  if (rendererGeometryIsStale(terminal)) {
    // The measured cell is fine but the render service still holds the previous
    // geometry; hand it the current size directly, the same call xterm itself makes
    // on a buffer resize.
    const rawTerminal = terminal as TerminalCoreWithMeasurement;
    try {
      rawTerminal._core?._renderService?.handleResize?.(terminal.cols, terminal.rows);
    } catch {
      // Internal API: a shape change only costs this extra attempt.
    }
  }

  return true;
}

export interface TerminalOptions {
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  minimumContrastRatio?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  scrollback?: number;
  /** Initial columns to avoid early wrapping. */
  cols?: number;
  rows?: number;
}

export interface TerminalProps {
  className?: string;
  /** For context menu identification. */
  terminalId?: string;
  /** For context menu identification. */
  sessionId?: string;
  options?: TerminalOptions;
  autoFocus?: boolean;
  /** Presentation visibility only; output, buffer and PTY ownership are unchanged. */
  renderingActive?: boolean;
  onData?: (data: string) => void;
  onBinary?: (data: string) => void;
  onTitleChange?: (title: string) => void;
  /** Notify backend PTY about size changes. */
  onResize?: (cols: number, rows: number) => void;
  onReady?: (terminal: XTerm) => void;
  /**
   * Link activation (Ctrl/Cmd+click). When omitted the link opens externally
   * as-is; remote terminals use this to forward loopback ports first.
   */
  onLinkActivate?: (uri: string) => void;
  /**
   * Keyboard paste shortcut interceptor. Return true when the shortcut was
   * handled without reading clipboard text, for example by sending Ctrl+V to a
   * shell that owns paste behavior.
   */
  onPasteShortcut?: (
    context: { terminal: XTerm; bracketedPasteMode: boolean },
  ) => Promise<boolean> | boolean;
  /**
   * Paste interceptor: return true to allow, false to block, or a decision with
   * modified text. When omitted, paste is allowed and xterm handles normalization.
   */
  onPaste?: (
    text: string,
    context: { terminal: XTerm; bracketedPasteMode: boolean },
  ) => Promise<boolean | TerminalPasteDecision> | boolean | TerminalPasteDecision;
  /**
   * When set, doXtermResize refuses to shrink the terminal below the column
   * count this guard protects. Used during history replay to prevent
   * CSS-animation intermediate sizes from permanently truncating buffered
   * content. The guard expires on its own.
   */
  replayColumnGuardRef?: React.MutableRefObject<ReplayColumnGuard>;
  /**
   * Suspend layout-driven resize while the containing panel is animating.
   * xterm.js reflows its buffer on resize, so intermediate transition sizes
   * should be ignored and replaced by one final fit when animation settles.
   */
  resizeSuspended?: boolean;
  /**
   * Called whenever a fit measured the container and the terminal settled on that size.
   * Callers that must not act on a guessed size — creating a PTY for a session whose
   * shell has not started yet — use this instead of xterm's default dimensions.
   */
  onSizeSettled?: (size: { cols: number; rows: number }) => void;
  /**
   * Called when a suspended layout finished and the panel's size became
   * authoritative. Whatever protected the previous geometry — a replay column
   * guard, for example — has to let go here, otherwise the terminal keeps a
   * column count that no longer belongs to its container.
   */
  onLayoutSettled?: () => void;
  supportsCopyPaste?: boolean;
}

export interface TerminalRef {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  reset: () => void;
  focus: () => void;
  paste: (data: string) => void;
  fit: () => void;
  /** Flush pending debounced resize operations. */
  flushResize: () => void;
  /** Force a redraw (clears texture cache). */
  forceRedraw: () => void;
  getTerminal: () => XTerm | null;
  getSize: () => { cols: number; rows: number } | null;
}

/**
 * Read the current xterm appearance synchronously.
 * Calling this at XTerm construction time prevents the initial black-background flash
 * that occurs when the theme is applied asynchronously via useEffect.
 */
function getInitialXtermColors() {
  return xtermAppearanceAdapter.getColors('terminal');
}

function normalizePasteDecision(
  decision: boolean | TerminalPasteDecision | undefined,
  originalText: string,
): TerminalPasteDecision {
  if (decision === false) {
    return { allow: false };
  }

  if (decision === true || decision === undefined) {
    return { allow: true, text: originalText };
  }

  return decision;
}

/**
 * The interactive terminal shares the `xs` code step with chat code blocks so a
 * shell panel never renders larger than the code beside it, and it follows the
 * global font size preference because xterm takes a pixel size instead of a CSS
 * custom property.
 */
const TERMINAL_FONT_SIZE_TOKEN = 'font.size.xs' as const;

function readTerminalFontSize(): number {
  return readActiveTypographyTokenPx(TERMINAL_FONT_SIZE_TOKEN);
}

const DEFAULT_OPTIONS: TerminalOptions = {
  lineHeight: getTypographyTokenNumber('lineHeight.tight'),
  minimumContrastRatio: DEFAULT_XTERM_MINIMUM_CONTRAST_RATIO,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
};

const Terminal = forwardRef<TerminalRef, TerminalProps>(({
  className = '',
  terminalId,
  sessionId,
  options = {},
  autoFocus = false,
  renderingActive = true,
  onData,
  onBinary,
  onTitleChange,
  onResize,
  onReady,
  onLinkActivate,
  onPasteShortcut,
  onPaste,
  replayColumnGuardRef,
  onSizeSettled,
  onLayoutSettled,
  supportsCopyPaste = true,
  resizeSuspended = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const resumeRendererRef = useRef<() => void>(() => {});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const resizeDebouncerRef = useRef<TerminalResizeDebouncer | null>(null);
  const isVisibleRef = useRef(true);
  const wasVisibleRef = useRef(false);
  const lastBackendSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const autoFocusRef = useRef(autoFocus);
  const terminalIdRef = useRef(terminalId);
  const sessionIdRef = useRef(sessionId);
  const onDataRef = useRef(onData);
  const onBinaryRef = useRef(onBinary);
  const onTitleChangeRef = useRef(onTitleChange);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);
  const onLinkActivateRef = useRef(onLinkActivate);
  const onPasteShortcutRef = useRef(onPasteShortcut);
  const onPasteRef = useRef(onPaste);
  const onSizeSettledRef = useRef(onSizeSettled);
  const onLayoutSettledRef = useRef(onLayoutSettled);
  const resizeSuspendedRef = useRef(resizeSuspended);
  const pendingFitAfterSuspendRef = useRef(false);
  // Assigned once the fit scheduler below is created; callbacks that can run before
  // that (a resize refused by the replay column guard) only schedule.
  const scheduleSettleRefitsRef = useRef<() => void>(() => {});
  const settleRefitTimersRef = useRef<number[]>([]);
  // Track key-pressed state to mirror xterm's internal _keyDownSeen flag.
  // Used by the input-event safety net (see below).
  const keyDownSeenRef = useRef(false);
  // Track whether keypress already handled the character, mirroring xterm's
  // _keyPressHandled, to avoid duplicates in the safety net.
  const keyPressHandledRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [fontSize, setFontSize] = useState(readTerminalFontSize);
  useEffect(() => {
    const syncFontSize = () => setFontSize(readTerminalFontSize());
    return fontPreferenceService.on('font:after-change', syncFontSize);
  }, []);
  // Merge options. Appearance is resolved at render time so that the
  // initial XTerm instance is created with the correct background color and avoids
  // the black-background flash that occurs when a light theme is active.
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    fontSize,
    ...options,
    fontFamily: options?.fontFamily?.trim() || readActiveTypographyTokenValue('font.family.mono'),
    theme: getInitialXtermColors(),
  };
  const mergedOptionsRef = useRef(mergedOptions);
  autoFocusRef.current = autoFocus;
  terminalIdRef.current = terminalId;
  sessionIdRef.current = sessionId;
  onDataRef.current = onData;
  onBinaryRef.current = onBinary;
  onTitleChangeRef.current = onTitleChange;
  onResizeRef.current = onResize;
  onReadyRef.current = onReady;
  onLinkActivateRef.current = onLinkActivate;
  onPasteShortcutRef.current = onPasteShortcut;
  onPasteRef.current = onPaste;
  onSizeSettledRef.current = onSizeSettled;
  onLayoutSettledRef.current = onLayoutSettled;
  resizeSuspendedRef.current = resizeSuspended;
  mergedOptionsRef.current = mergedOptions;

  // Force refresh for rendering consistency.
  const forceRefresh = useCallback((terminal: XTerm) => {
    const rows = terminal.rows;
    terminal.refresh(0, rows - 1);
    clearTextureAtlas(terminal);
  }, []);

  const doXtermResize = useCallback((cols: number, rows: number): boolean => {
    const terminal = terminalRef.current;
    if (!terminal) return false;

    try {
      if (resizeSuspendedRef.current) {
        pendingFitAfterSuspendRef.current = true;
        return false;
      }

      if (terminal.cols === cols && terminal.rows === rows) {
        // Already at the measured size: still report it, so a caller waiting for a
        // measured geometry is not left waiting for a resize that never happens.
        onSizeSettledRef.current?.({ cols, rows });
        // The buffer can already hold this size while the renderer still paints the
        // previous one. Returning here without checking froze that half-painted
        // screen: the settle refits all bailed out as "already correct".
        syncStaleRendererGeometry(terminal);
        return true;
      }

      // While the caller's replay column guard still protects a width from
      // history replay, skip any resize that would shrink below it. This
      // prevents CSS open-animation intermediate widths from permanently
      // truncating buffered content that was written at a wider column count.
      // The guard expires on its own, so a settled layout always wins.
      const minCols = replayColumnGuardRef?.current?.protectedCols() ?? 0;
      const hasBufferedScreenText = minCols > 0 ? terminalHasBufferedScreenText(terminal) : false;
      // The guard only protects actual screen text. Applying it to an empty new
      // terminal leaves xterm at 80x24 while the PTY moves to the panel size,
      // which creates blank scrollback during shell startup repaints.
      const decision = decideResizeUnderColumnGuard({
        targetCols: cols,
        targetRows: rows,
        currentCols: terminal.cols,
        currentRows: terminal.rows,
        protectedCols: minCols,
        hasBufferedScreenText,
      });

      if (decision.kind === 'skip') {
        // Nothing else retries a refused fit: the container may already have
        // stopped moving, so the guard's expiry would go unnoticed. Ask for a
        // settle refit that lands after it expires.
        scheduleSettleRefitsRef.current?.();
        return false;
      }

      if (decision.kind === 'rows-only') {
        // The protected width stands, but the panel's height still belongs to the
        // container. Freezing both axes left a tall panel showing a single row of
        // its scrollback behind a scrollbar.
        terminal.resize(decision.cols, decision.rows);
        scheduleSettleRefitsRef.current?.();
        return false;
      }

      terminal.resize(decision.cols, decision.rows);
      onSizeSettledRef.current?.({ cols: decision.cols, rows: decision.rows });

      return true;
    } catch (error) {
      log.warn('Xterm resize error', { cols, rows, error });
      return false;
    }
  }, [replayColumnGuardRef]);

  // Notify backend PTY with deduping.
  const doBackendResize = useCallback((cols: number, rows: number) => {
    if (resizeSuspendedRef.current) {
      pendingFitAfterSuspendRef.current = true;
      return;
    }

    const terminal = terminalRef.current;
    // Keep frontend and PTY dimensions in lockstep. If xterm skipped a resize
    // because of replay protection or panel suspension, sending it to the PTY
    // would make subsequent shell repaint output land in the wrong geometry.
    if (terminal && (terminal.cols !== cols || terminal.rows !== rows)) {
      return;
    }

    const lastSize = lastBackendSizeRef.current;
    if (lastSize && lastSize.cols === cols && lastSize.rows === rows) {
      return;
    }
    
    lastBackendSizeRef.current = { cols, rows };
    
    onResizeRef.current?.(cols, rows);
  }, []);

  // Post-resize fixups (refresh and cursor visibility).
  const handleResizeComplete = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    requestAnimationFrame(() => {
      if (terminalRef.current) {
        forceRefresh(terminalRef.current);
      }
    });
  }, [forceRefresh]);

  const fit = useCallback((immediate = false) => {
    if (!fitAddonRef.current || !terminalRef.current || !containerRef.current) {
      return;
    }

    try {
      if (resizeSuspendedRef.current) {
        pendingFitAfterSuspendRef.current = true;
        return;
      }

      const { clientWidth, clientHeight } = containerRef.current;
      if (clientWidth < 50 || clientHeight < 50) {
        log.debug('Fit skipped: container not laid out yet', { clientWidth, clientHeight });
        return;
      }

      const dims = fitAddonRef.current.proposeDimensions();
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return;
      }

      const terminal = terminalRef.current;
      if (!terminal) return;

      // Skip only unusably tiny dimensions. Panel animation and drag resizes are
      // suspended by the parent; the final compact bottom panel still needs to
      // resize to fewer than 10 rows so the prompt remains visible.
      //
      // The two axes are decided independently: a panel narrow enough to fall below
      // the minimum column count must not freeze the row count with it, otherwise a
      // split terminal keeps the rows of its previous box.
      const decision = decideFitResize({
        measuredCols: dims.cols,
        measuredRows: dims.rows,
        currentCols: terminal.cols,
        currentRows: terminal.rows,
        minCols: MIN_STABLE_TERMINAL_COLS,
        minRows: MIN_STABLE_TERMINAL_ROWS,
      });

      if (decision.kind === 'skip') {
        log.debug('Fit skipped: measured size unusable', {
          cols: dims.cols,
          rows: dims.rows,
          clientWidth,
          clientHeight,
        });
        return;
      }

      if (resizeDebouncerRef.current) {
        resizeDebouncerRef.current.resize(decision.cols, decision.rows, immediate);
      } else {
        if (doXtermResize(decision.cols, decision.rows)) {
          doBackendResize(decision.cols, decision.rows);
          handleResizeComplete();
        }
      }
    } catch (error) {
      log.warn('Fit error', error);
    }
  }, [doXtermResize, doBackendResize, handleResizeComplete]);

  const flushResize = useCallback(() => {
    if (resizeSuspendedRef.current) {
      pendingFitAfterSuspendRef.current = true;
      return;
    }
    resizeDebouncerRef.current?.flush();
  }, []);

  const forceRedraw = useCallback(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      forceRefresh(terminal);
    }
  }, [forceRefresh]);
  const doXtermResizeRef = useRef(doXtermResize);
  const doBackendResizeRef = useRef(doBackendResize);
  const handleResizeCompleteRef = useRef(handleResizeComplete);
  const fitRef = useRef(fit);
  const forceRefreshRef = useRef(forceRefresh);

  doXtermResizeRef.current = doXtermResize;
  doBackendResizeRef.current = doBackendResize;
  handleResizeCompleteRef.current = handleResizeComplete;
  fitRef.current = fit;
  forceRefreshRef.current = forceRefresh;

  const cancelSettleRefits = useCallback(() => {
    settleRefitTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    settleRefitTimersRef.current = [];
  }, []);

  /**
   * Re-fit after a layout event whose measurement cannot be trusted yet.
   * See SETTLE_REFIT_DELAYS_MS for why a single attempt is not enough. One of
   * these fits succeeding is also what reports a measured size to the caller,
   * and a caller that reserves a shell waits for exactly that report.
   */
  const scheduleSettleRefits = useCallback(() => {
    cancelSettleRefits();

    SETTLE_REFIT_DELAYS_MS.forEach((delayMs) => {
      const timerId = window.setTimeout(() => {
        settleRefitTimersRef.current = settleRefitTimersRef.current.filter(
          (pending) => pending !== timerId,
        );
        fitRef.current(false);
      }, delayMs);
      settleRefitTimersRef.current.push(timerId);
    });
  }, [cancelSettleRefits]);

  scheduleSettleRefitsRef.current = scheduleSettleRefits;

  useEffect(() => () => cancelSettleRefits(), [cancelSettleRefits]);

  useEffect(() => {
    if (resizeSuspended) {
      return;
    }

    if (!pendingFitAfterSuspendRef.current) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      // A second drag can begin before this resume frame. Keep the pending fit
      // until it can run; flushing while suspended discards the PTY resize.
      if (resizeSuspendedRef.current) return;
      pendingFitAfterSuspendRef.current = false;
      // The transition that suspended resizing is over, so this size is the panel's
      // real one. Anything still protecting the previous geometry — a replay column
      // guard armed before the panel moved — has to release it now, or the fit below
      // is refused and the terminal keeps a column count its container no longer has.
      onLayoutSettledRef.current?.();
      resizeDebouncerRef.current?.flush();
      fitRef.current(true);
      scheduleSettleRefitsRef.current();
      // The local resize can precede its deferred PTY update. If suspension
      // interrupted that update, an equal-size fit alone does not retry it.
      const terminal = terminalRef.current;
      if (terminal) doBackendResize(terminal.cols, terminal.rows);
    });
    return () => cancelAnimationFrame(frame);
  }, [resizeSuspended, doBackendResize]);

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      terminalRef.current?.write(data);
    },
    writeln: (data: string) => {
      terminalRef.current?.writeln(data);
    },
    clear: () => {
      terminalRef.current?.clear();
    },
    reset: () => {
      terminalRef.current?.reset();
    },
    focus: () => {
      terminalRef.current?.focus();
    },
    paste: (data: string) => {
      terminalRef.current?.paste(data);
    },
    fit: () => fit(false),
    flushResize,
    forceRedraw,
    getTerminal: () => terminalRef.current,
    getSize: () => {
      if (terminalRef.current) {
        return {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        };
      }
      return null;
    },
  }), [fit, flushResize, forceRedraw]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Let fit() determine size; backend starts at 80x24 and syncs via resize.
    const terminal = new XTerm({
      fontSize: mergedOptionsRef.current.fontSize,
      fontFamily: mergedOptionsRef.current.fontFamily,
      fontWeight: TERMINAL_FONT_WEIGHT,
      fontWeightBold: TERMINAL_FONT_WEIGHT_BOLD,
      lineHeight: mergedOptionsRef.current.lineHeight,
      minimumContrastRatio: mergedOptionsRef.current.minimumContrastRatio,
      cursorStyle: mergedOptionsRef.current.cursorStyle,
      cursorBlink: mergedOptionsRef.current.cursorBlink,
      scrollback: mergedOptionsRef.current.scrollback,
      theme: mergedOptionsRef.current.theme,
      // Keep the interactive terminal on the opaque WebGL path. Transparent
      // glyph atlases use a different blending/clearing strategy and are much
      // more prone to artifacts on colored cell backgrounds.
      allowTransparency: false,
      // TUI apps usually handle line wrapping.
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    // WebLinksAddon supports Ctrl+click to open URLs.
    let currentHoverTarget: HTMLElement | null = null;
    const webLinksAddon = new WebLinksAddon(
      (event, uri) => {
        if (event.ctrlKey || event.metaKey) {
          const activate = onLinkActivateRef.current;
          if (activate) {
            activate(uri);
            return;
          }
          systemAPI.openExternal(uri).catch((error) => {
            log.error('Failed to open external link', { uri, error });
          });
        }
      },
      {
        hover: (event, _uri, _range) => {
          const target = event.target as HTMLElement;
          if (target) {
            if (currentHoverTarget && currentHoverTarget !== target) {
              currentHoverTarget.removeAttribute('title');
            }
            currentHoverTarget = target;
            const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
            target.title = isMac ? '\u2318 + click to open link' : 'Ctrl + click to open link';
          }
        },
        leave: (event, _text) => {
          const target = event.target as HTMLElement;
          if (target) {
            target.removeAttribute('title');
          }
          if (currentHoverTarget) {
            currentHoverTarget.removeAttribute('title');
            currentHoverTarget = null;
          }
        },
      }
    );

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);
    const releaseDiagnostics = attachTerminalDiagnostics(container, terminal);

    const xtermViewport = container.querySelector<HTMLElement>('.xterm-viewport');
    if (xtermViewport) {
      xtermViewport.dataset.bitfunComponent = 'terminal-tool';
      xtermViewport.dataset.bitfunPart = 'output';
    }
    const xtermScreen = container.querySelector<HTMLElement>('.xterm-screen');
    if (xtermScreen) {
      xtermScreen.dataset.bitfunComponent = 'terminal-tool';
      xtermScreen.dataset.bitfunPart = 'screen';
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // WebGL renderer must be loaded after terminal.open(). A dormant terminal
    // keeps its parser and buffer, releasing only the renderer's GPU resources.
    const resumeRenderer = () => {
      if (webglAddonRef.current) return;
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          log.warn('WebGL context lost, falling back to canvas');
          webglAddon.dispose();
          webglAddonRef.current = null;
        });
        terminal.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch (error) {
        log.debug('WebGL not available, using canvas', error);
      }
    };
    resumeRendererRef.current = resumeRenderer;
    resumeRenderer();

    const resizeDebouncer = new TerminalResizeDebouncer({
      getTerminal: () => terminalRef.current,
      isVisible: () => isVisibleRef.current,
      onXtermResize: (cols, rows) => doXtermResizeRef.current(cols, rows),
      onBackendResize: (cols, rows) => doBackendResizeRef.current(cols, rows),
      onFlush: () => {
        if (terminalRef.current) {
          forceRefreshRef.current(terminalRef.current);
        }
      },
      onResizeComplete: () => handleResizeCompleteRef.current(),
    });
    resizeDebouncerRef.current = resizeDebouncer;

    requestAnimationFrame(() => {
      fitRef.current(true);
      // A freshly mounted terminal may be measured before the host finished laying
      // out the panel it was placed into. Retry so the container's settled geometry
      // wins, and so a caller waiting for a measured size is never left waiting.
      scheduleSettleRefitsRef.current();

      setIsReady(true);
      onReadyRef.current?.(terminal);

      if (autoFocusRef.current) {
        terminal.focus();
      }
    });

    let fontLoadCancelled = false;
    if (typeof document !== 'undefined' && 'fonts' in document) {
      const fontSet = document.fonts as FontFaceSet;
      if (fontSet.status !== 'loaded') {
        void fontSet.ready.then(() => {
          if (fontLoadCancelled || !terminalRef.current) {
            return;
          }

          requestAnimationFrame(() => {
            if (!terminalRef.current) return;

            remeasureTerminal(terminalRef.current);
            fitRef.current(true);
            scheduleSettleRefitsRef.current();

            requestAnimationFrame(() => {
              if (!terminalRef.current) return;
              forceRefreshRef.current(terminalRef.current);
            });
          });
        });
      }
    }

    const dataDisposable = terminal.onData((data) => {
      onDataRef.current?.(data);
    });

    const binaryDisposable = terminal.onBinary((data) => {
      onBinaryRef.current?.(data);
    });

    const titleDisposable = terminal.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    const pasteText = async (text: string): Promise<void> => {
      if (!text) return;

      const activeTerminal = terminalRef.current ?? terminal;
      let pasteDecision: TerminalPasteDecision = { allow: true, text };
      if (onPasteRef.current) {
        pasteDecision = normalizePasteDecision(
          await onPasteRef.current(text, {
            terminal: activeTerminal,
            bracketedPasteMode: activeTerminal.modes.bracketedPasteMode,
          }),
          text,
        );
      }

      if (!pasteDecision.allow) {
        return;
      }

      activeTerminal.paste(pasteDecision.text);
    };

    const handleNativePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      pasteText(text).catch((err) => {
        log.error('Paste failed', err);
      });
    };

    container.addEventListener('paste', handleNativePaste, true);

    // Intercept paste (Ctrl+V / Ctrl+Shift+V) so callers can apply the same
    // policy as context-menu paste before xterm normalizes/sends the data.
    // Also track key-pressed state and bypass keyCode 229 for the input-event
    // safety net below.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown') {
        keyDownSeenRef.current = true;
      } else if (event.type === 'keyup') {
        keyDownSeenRef.current = false;
        keyPressHandledRef.current = false;
      }

      if (event.type === 'keydown' && event.ctrlKey && (event.key === 'v' || event.key === 'V')) {
        event.preventDefault();
        
        (async () => {
          try {
            const activeTerminal = terminalRef.current ?? terminal;
            if (onPasteShortcutRef.current) {
              const handled = await onPasteShortcutRef.current({
                terminal: activeTerminal,
                bracketedPasteMode: activeTerminal.modes.bracketedPasteMode,
              });
              if (handled) {
                return;
              }
            }

            const text = await readTextFromClipboard();
            if (!text) return;

            await pasteText(text);
          } catch (err) {
            log.error('Paste failed', err);
          }
        })();
        
        return false;
      }

      // When an IME is active (even in ASCII mode), keydown events may carry
      // keyCode 229. xterm.js delegates these to _handleAnyTextareaChanges
      // (setTimeout(0) — racy during key rollover) and _inputEvent (skipped
      // when _keyDownSeen is true). Both paths can lose the character.
      //
      // Bypass xterm entirely for keyCode 229: return false without
      // preventDefault(), so the browser inserts the character into the
      // textarea and fires an input event. The safety-net listener below
      // catches that event synchronously — no setTimeout race, no duplicates.
      // During active IME composition, compositionstart/compositionend events
      // still fire and xterm handles them normally; this only affects the
      // non-composition passthrough path.
      //
      // That bypass only works for keys that insert text. xterm gives up on the
      // key code itself, so an arrow key reported this way would never become a
      // PTY byte and shell history navigation would silently skip a press. Rebuild
      // those keys from `event.key` instead of letting them fall through.
      if (event.type === 'keydown' && (event.keyCode === 229 || event.keyCode === 0)) {
        const sequence = resolveUnmappedKeydownSequence(event, {
          applicationCursorKeys: terminalRef.current?.modes.applicationCursorKeysMode ?? false,
        });
        if (sequence) {
          event.preventDefault();
          onDataRef.current?.(sequence);
          return false;
        }

        if (event.keyCode === 229) {
          return false;
        }
      }

      return true;
    });

    // Input-event safety net for key rollover with an active IME.
    //
    // Because we bypass keyCode 229 in the custom key handler above, xterm's
    // _handleAnyTextareaChanges (setTimeout(0)) is never called for those keys.
    // Instead, the browser inserts the character and fires an input event.
    //
    // xterm's own _inputEvent handler skips events where (composed && keyDownSeen)
    // — exactly the key-rollover case. This listener catches those skipped
    // insertText events and forwards them via onData, preventing character loss.
    // It only fires when xterm would skip (composed + keyDownSeen) and keypress
    // didn't already handle the character, so it never causes duplicates.
    const textareaEl = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    let textareaKeyPressHandler: (() => void) | null = null;
    let textareaInputHandler: ((ev: Event) => void) | null = null;
    if (textareaEl) {
      textareaKeyPressHandler = () => {
        keyPressHandledRef.current = true;
      };
      textareaInputHandler = (ev: Event) => {
        const inputEvent = ev as InputEvent;
        if (
          inputEvent.data &&
          inputEvent.inputType === 'insertText' &&
          inputEvent.composed === true &&
          keyDownSeenRef.current &&
          !keyPressHandledRef.current
        ) {
          // xterm's _inputEvent will skip this (composed + keyDownSeen).
          // Forward the character to prevent loss during key rollover.
          onDataRef.current?.(inputEvent.data);
        }
      };
      textareaEl.addEventListener('keypress', textareaKeyPressHandler);
      textareaEl.addEventListener('input', textareaInputHandler, true);
    }

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitRef.current(false);
      });
      // The observed box is not always the box the panel keeps: a re-parent or a
      // split change moves it again without another entry. Retry after it settles.
      scheduleSettleRefitsRef.current();
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    // On visibility change, flush pending resize and refresh.
    const intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];
      const isVisible = entry.isIntersecting;
      
      isVisibleRef.current = isVisible;

      if (isVisible && !wasVisibleRef.current) {
        const startedAt = nowMs();
        requestAnimationFrame(() => {
          resizeDebouncerRef.current?.flush();
          
          fitRef.current(true);
          scheduleSettleRefitsRef.current();
          
          requestAnimationFrame(() => {
            const term = terminalRef.current;
            if (term) {
              term.refresh(0, term.rows - 1);
              clearTextureAtlas(term);
              if (autoFocusRef.current) {
                term.focus();
              }
            }
            sendDebugProbe(
              'Terminal.tsx:intersectionObserver',
              'Terminal visibility restore completed',
              {
                terminalId: terminalIdRef.current,
                sessionId: sessionIdRef.current,
                autoFocus: autoFocusRef.current,
                cols: term?.cols ?? null,
                rows: term?.rows ?? null,
              },
              { startedAt }
            );
          });
        });
      }
      wasVisibleRef.current = isVisible;
    }, {
      threshold: 0.1
    });
    intersectionObserver.observe(container);
    intersectionObserverRef.current = intersectionObserver;

    return () => {
      releaseDiagnostics();
      dataDisposable.dispose();
      binaryDisposable.dispose();
      titleDisposable.dispose();
      container.removeEventListener('paste', handleNativePaste, true);
      if (textareaEl && textareaKeyPressHandler) {
        textareaEl.removeEventListener('keypress', textareaKeyPressHandler);
      }
      if (textareaEl && textareaInputHandler) {
        textareaEl.removeEventListener('input', textareaInputHandler, true);
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      fontLoadCancelled = true;
      settleRefitTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      settleRefitTimersRef.current = [];
      resizeDebouncer.dispose();
      webglAddonRef.current?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      webglAddonRef.current = null;
      resumeRendererRef.current = () => {};
      resizeObserverRef.current = null;
      intersectionObserverRef.current = null;
      resizeDebouncerRef.current = null;
      lastBackendSizeRef.current = null;
    };
  }, []);

  useEffect(() => {
    let idle: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (idle !== undefined) clearTimeout(idle);
      if (renderingActive && document.visibilityState !== 'hidden') {
        resumeRendererRef.current();
        const terminal = terminalRef.current;
        if (terminal) terminal.refresh(0, terminal.rows - 1);
      } else {
        idle = setTimeout(() => {
          webglAddonRef.current?.dispose();
          webglAddonRef.current = null;
        }, 30_000);
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      if (idle !== undefined) clearTimeout(idle);
      document.removeEventListener('visibilitychange', update);
    };
  }, [renderingActive]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isReady) return;

    terminal.options.fontSize = mergedOptions.fontSize;
    terminal.options.fontFamily = mergedOptions.fontFamily;
    terminal.options.lineHeight = mergedOptions.lineHeight;
    terminal.options.minimumContrastRatio = mergedOptions.minimumContrastRatio;
    terminal.options.cursorStyle = mergedOptions.cursorStyle;
    terminal.options.cursorBlink = mergedOptions.cursorBlink;
    terminal.options.scrollback = mergedOptions.scrollback;
    terminal.options.theme = mergedOptions.theme;

    fit(true);
  }, [
    mergedOptions.fontSize,
    mergedOptions.fontFamily,
    mergedOptions.lineHeight,
    mergedOptions.minimumContrastRatio,
    mergedOptions.cursorStyle,
    mergedOptions.cursorBlink,
    mergedOptions.scrollback,
    mergedOptions.theme,
    isReady,
    fit,
  ]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isReady) return;

    const updateXtermTheme = () => {
      (() => {
        terminal.options.theme = xtermAppearanceAdapter.getColors('terminal');

        forceRefresh(terminal);
      })();
    };

    updateXtermTheme();

    const unsubscribe = xtermAppearanceAdapter.subscribe(updateXtermTheme);
    return () => {
      unsubscribe?.();
    };
  }, [isReady, forceRefresh]);

  return (
    <div 
      className={`bitfun-terminal ${className}`}
      data-bitfun-component="terminal-tool"
      data-bitfun-part="root"
      data-bitfun-surface="terminal"
      data-bitfun-skin-slot="terminal-background"
      data-shortcut-scope="terminal"
      data-terminal-id={terminalId}
      data-session-id={sessionId}
      data-testid="shell-command-item"
      data-command-id={sessionId}
      data-supports-copy-paste={supportsCopyPaste?'true':'false'}
    >
      <VisualSkinSurfacePaint />
      <div 
        ref={containerRef} 
        className="bitfun-terminal__container"
        data-bitfun-component="terminal-tool"
        data-bitfun-part="terminal"
        data-testid="shell-command-output"
      />
    </div>
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;

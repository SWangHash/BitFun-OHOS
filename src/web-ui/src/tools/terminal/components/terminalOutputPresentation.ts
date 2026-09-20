export const TERMINAL_OUTPUT_FONT_SIZE = 12;
export const TERMINAL_OUTPUT_LINE_HEIGHT = 1.4;
export const TERMINAL_OUTPUT_FONT_FAMILY = "'Fira Code', 'Noto Sans SC', Consolas, 'Courier New', monospace";

const DEFAULT_OUTPUT_ROW_HEIGHT = Math.ceil(
  TERMINAL_OUTPUT_FONT_SIZE * TERMINAL_OUTPUT_LINE_HEIGHT,
);

let cachedDevicePixelRatio = 0;
let cachedRowHeight = 0;

export function getEstimatedTerminalOutputRowHeight(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_OUTPUT_ROW_HEIGHT;
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  if (cachedRowHeight > 0 && cachedDevicePixelRatio === devicePixelRatio) {
    return cachedRowHeight;
  }

  try {
    if (typeof OffscreenCanvas === 'undefined') {
      return DEFAULT_OUTPUT_ROW_HEIGHT;
    }

    const context = new OffscreenCanvas(100, 100).getContext('2d');
    if (!context) {
      return DEFAULT_OUTPUT_ROW_HEIGHT;
    }

    context.font = `${TERMINAL_OUTPUT_FONT_SIZE}px ${TERMINAL_OUTPUT_FONT_FAMILY}`;
    const metrics = context.measureText('W');
    const fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    if (!Number.isFinite(fontHeight) || fontHeight <= 0) {
      return DEFAULT_OUTPUT_ROW_HEIGHT;
    }

    const deviceCharHeight = Math.ceil(fontHeight * devicePixelRatio);
    const deviceCellHeight = Math.floor(deviceCharHeight * TERMINAL_OUTPUT_LINE_HEIGHT);
    cachedDevicePixelRatio = devicePixelRatio;
    cachedRowHeight = deviceCellHeight / devicePixelRatio;
    return cachedRowHeight;
  } catch {
    return DEFAULT_OUTPUT_ROW_HEIGHT;
  }
}

export function prepareReadOnlyTerminalOutput(content: string): string {
  return content
    // A fresh xterm has no prior rows for absolute cursor positions to target.
    // eslint-disable-next-line no-control-regex -- terminal control sequences are expected here.
    .replace(/\x1b\[\d*;?\d*[Hf]/g, '\r\n')
    // Avoid moving the cursor to an otherwise empty trailing row.
    // eslint-disable-next-line no-control-regex -- terminal control sequences are expected here.
    .replace(/(?:\r\n|\r|\n)+((?:\x1b\[[0-?]*[ -/]*[@-~])*)$/g, '$1');
}

/**
 * Character cap for tool-card output rendered into xterm. Outputs beyond this
 * are truncated with a marker before they reach the VT parser — a multi-
 * megabyte stream freezes the webview main thread on parsing alone.
 */
export const TERMINAL_OUTPUT_MAX_CHARS = 200_000;

/**
 * How much of the head of the output is sampled for binary detection.
 */
const TERMINAL_OUTPUT_BINARY_SAMPLE_CHARS = 8_192;

/**
 * Share of non-text control bytes (C0 except \t \n \r ESC, plus DEL) above
 * which output is treated as binary.
 */
const TERMINAL_OUTPUT_BINARY_CONTROL_RATIO = 0.1;

export interface TerminalOutputRenderGuard {
  /** Safe-to-render text; empty when the output was suppressed as binary. */
  content: string;
  /** The output carried binary bytes and must not enter the VT parser. */
  binary: boolean;
  /** The output exceeded the character cap and was truncated. */
  truncated: boolean;
  /** Original character count, for placeholders and markers. */
  totalChars: number;
}

/**
 * Detect binary output before it enters the xterm VT parser. Text output
 * never carries NUL bytes, and shell text keeps its C0 controls to \t \n \r
 * plus the ESC that starts legitimate ANSI sequences — a sample dominated by
 * anything else (ELF headers, images, compressed data) is binary.
 */
export function looksLikeBinaryOutput(content: string): boolean {
  const sampleLength = Math.min(content.length, TERMINAL_OUTPUT_BINARY_SAMPLE_CHARS);
  if (sampleLength === 0) {
    return false;
  }

  let controlCount = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 0) {
      return true;
    }
    if (code === 9 || code === 10 || code === 13 || code === 27) {
      continue;
    }
    if (code < 32 || code === 127) {
      controlCount += 1;
    }
  }

  return controlCount / sampleLength > TERMINAL_OUTPUT_BINARY_CONTROL_RATIO;
}

/**
 * Guard tool-card output before it is written into an xterm instance:
 * binary output is suppressed (the caller shows a placeholder), oversized
 * output is truncated to {@link TERMINAL_OUTPUT_MAX_CHARS} characters. The
 * 0904 freeze was a 7.4MB binary `cat` output parsed by xterm at ~600 parser
 * errors per second until the webview main thread stopped responding.
 */
export function guardTerminalOutput(content: string): TerminalOutputRenderGuard {
  const totalChars = content.length;

  if (looksLikeBinaryOutput(content)) {
    return { content: '', binary: true, truncated: false, totalChars };
  }

  if (totalChars > TERMINAL_OUTPUT_MAX_CHARS) {
    return {
      content: content.slice(0, TERMINAL_OUTPUT_MAX_CHARS),
      binary: false,
      truncated: true,
      totalChars,
    };
  }

  return { content, binary: false, truncated: false, totalChars };
}

const DEFAULT_BINARY_SUPPRESSED_TEXT = (totalChars: number) =>
  `[binary output suppressed: ${totalChars} characters]`;
const DEFAULT_TRUNCATED_MARKER = (shownChars: number) =>
  `[output truncated: first ${shownChars} characters shown]`;

/**
 * Compose the guarded text for the xterm renderer: binary output is replaced
 * by the caller's placeholder, oversized output gets the truncation marker
 * appended. The marker is appended on its own line and uses a fixed shown-
 * character count so the composed text stays stable while a command keeps
 * streaming (a changing string would reset the xterm buffer on every chunk).
 */
export function composeGuardedTerminalOutput(
  guard: TerminalOutputRenderGuard,
  binarySuppressedText?: (totalChars: number) => string,
  truncatedMarkerText?: (shownChars: number) => string,
): string {
  if (guard.binary) {
    const text = (binarySuppressedText ?? DEFAULT_BINARY_SUPPRESSED_TEXT)(guard.totalChars);
    return text.startsWith('\n') ? text : `\n${text}`;
  }
  if (guard.truncated) {
    const marker = (truncatedMarkerText ?? DEFAULT_TRUNCATED_MARKER)(TERMINAL_OUTPUT_MAX_CHARS);
    return `${guard.content}\n${marker}`;
  }
  return guard.content;
}

export function stripTerminalControlSequences(content: string): string {
  return content
    // eslint-disable-next-line no-control-regex -- terminal control sequences are expected here.
    .replace(/\x1b[\]PX_^][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex -- terminal control sequences are expected here.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex -- terminal control sequences are expected here.
    .replace(/\x1b[ -/]*[@-~]/g, '');
}

export function takeLastTerminalRows(content: string, maxRows?: number): string {
  if (!maxRows || maxRows <= 0) {
    return content;
  }

  let rowCount = 0;
  let cursor = content.length;
  while (cursor > 0 && rowCount < maxRows) {
    const previousBreak = content.lastIndexOf('\n', cursor - 1);
    if (previousBreak < 0) {
      return content;
    }
    rowCount += 1;
    cursor = previousBreak;
  }

  return content.slice(cursor + 1);
}

interface TerminalOutputHeightOptions {
  rowHeight: number;
  minHeight: number;
  maxHeight: number;
  maxRows?: number;
}

export function calculateTerminalOutputHeight(
  content: string,
  { rowHeight, minHeight, maxHeight, maxRows }: TerminalOutputHeightOptions,
): number {
  const heightForRows = (rows: number) => Math.ceil(Math.max(rowHeight, rows * rowHeight));
  const alignHeightToRows = (height: number, mode: 'floor' | 'ceil') => {
    const rows = mode === 'ceil'
      ? Math.ceil(height / rowHeight)
      : Math.floor(height / rowHeight);
    return heightForRows(Math.max(1, rows));
  };
  const effectiveMinHeight = alignHeightToRows(minHeight, 'ceil');
  const effectiveMaxHeight = maxRows != null && maxRows > 0
    ? heightForRows(maxRows)
    : alignHeightToRows(maxHeight, 'floor');
  const boundedMaxHeight = Math.max(effectiveMinHeight, effectiveMaxHeight);
  const lineCount = content ? content.split(/\r\n|\r|\n/).length : 1;
  const visibleRows = maxRows != null && maxRows > 0
    ? Math.min(lineCount, maxRows)
    : lineCount;
  const estimatedHeight = heightForRows(Math.max(1, visibleRows));

  return Math.min(Math.max(estimatedHeight, effectiveMinHeight), boundedMaxHeight);
}

export interface TerminalOutputFallbackModel {
  content: string;
  height: number;
}

export function buildTerminalOutputFallbackModel(
  content: string,
  options: { minHeight?: number; maxHeight?: number; maxRows?: number },
): TerminalOutputFallbackModel {
  const rowHeight = getEstimatedTerminalOutputRowHeight();
  const preparedContent = prepareReadOnlyTerminalOutput(content);
  const preview = stripTerminalControlSequences(
    takeLastTerminalRows(preparedContent, options.maxRows),
  );

  return {
    content: preview,
    height: calculateTerminalOutputHeight(preview, {
      rowHeight,
      minHeight: options.minHeight ?? rowHeight,
      maxHeight: options.maxHeight ?? 300,
      maxRows: options.maxRows,
    }),
  };
}

export * from '@bitfun/flow-chat-presentation/terminal/model';

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
 * freeze was a 7.4MB binary `cat` output parsed by xterm at hundreds of parser
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
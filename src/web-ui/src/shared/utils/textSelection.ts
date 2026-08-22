 

import type { MouseEvent as ReactMouseEvent } from 'react';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('TextSelection');

export interface TextSelection {
  text: string;
  element: HTMLElement;
  range?: Range;
}

 
export const getSelectedText = (): TextSelection | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString().trim();
  
  if (!text) {
    return null;
  }

  const commonAncestor = range.commonAncestorContainer;
  const element = commonAncestor.nodeType === Node.ELEMENT_NODE 
    ? commonAncestor as HTMLElement 
    : commonAncestor.parentElement;

  if (!element) {
    return null;
  }

  return {
    text,
    element,
    range
  };
};

export const shouldIgnoreCardToggleClick = (
  event: ReactMouseEvent<Element>,
  root: HTMLElement | null = typeof HTMLElement !== 'undefined' && event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null,
): boolean => {
  if (event.defaultPrevented || event.button !== 0) {
    return true;
  }

  const target = typeof Element !== 'undefined' && event.target instanceof Element ? event.target : null;
  if (target?.closest('button,a,input,textarea,select,[contenteditable="true"],[data-flow-card-ignore-toggle]')) {
    return true;
  }

  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    return false;
  }

  if (!root) {
    return true;
  }

  const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false;
  const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false;
  return anchorInside || focusInside;
};

 
export const clearSelection = (): void => {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
};

  
export interface ClipboardCopyResult {
  ok: boolean;
  error?: string;
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.name || 'unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) {
      return msg;
    }
  }
  return String(error);
};

export const copyTextToClipboard = async (text: string): Promise<ClipboardCopyResult> => {
  let primaryError: string | undefined;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      // WebView clipboard permission can be denied even when the API exists.
      // Fall through to the selection-based copy path before reporting failure.
      primaryError = toErrorMessage(error);
      log.warn('Clipboard API copy failed; trying fallback', error);
    }
  }

  const textArea = document.createElement('textarea');
  try {
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const fallbackOk = document.execCommand('copy');
    if (fallbackOk) {
      return { ok: true };
    }
    return {
      ok: false,
      error: primaryError ?? 'execCommand copy returned false',
    };
  } catch (error) {
    log.error('Failed to copy text to clipboard', error);
    const fallbackError = toErrorMessage(error);
    return { ok: false, error: primaryError ?? fallbackError };
  } finally {
    if (textArea.isConnected) {
      document.body.removeChild(textArea);
    }
  }
};

export const readTextFromClipboard = async (): Promise<string> => {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      try {
        const { systemAPI } = await import('@/infrastructure/api/service-api/SystemAPI');
        return await systemAPI.getClipboard();
      } catch (tauriErr) {
        log.warn('Tauri clipboard failed, falling back to navigator.clipboard', tauriErr);
      }
    }

    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
  } catch (error) {
    log.warn('Failed to read clipboard', error);
  }
  return ''
}

export const getElementText = (element: HTMLElement): string => {
  
  if (element.tagName === 'PRE' || element.tagName === 'CODE') {
    return element.textContent || '';
  }
  
  
  return element.innerText || element.textContent || '';
};

 
export const isInFlowChat = (element: HTMLElement): boolean => {
  return element.closest('.flow-chat-container') !== null;
};

 
export const getFlowChatContext = (element: HTMLElement) => {
  const flowChatContainer = element.closest('.flow-chat-container');
  if (!flowChatContainer) {
    return null;
  }

  const dialogTurn = element.closest('.flow-chat-dialog-turn');
  const modelRound = element.closest('.model-round');
  const textBlock = element.closest('.flow-text-block');
  const toolCard = element.closest('.flow-tool-card');
  const userMessage = element.closest('.user-message');

  return {
    container: flowChatContainer as HTMLElement,
    dialogTurn: dialogTurn as HTMLElement | null,
    modelRound: modelRound as HTMLElement | null,
    textBlock: textBlock as HTMLElement | null,
    toolCard: toolCard as HTMLElement | null,
    userMessage: userMessage as HTMLElement | null
  };
};

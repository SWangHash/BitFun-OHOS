import { useCallback, useRef } from 'react';

interface PendingCaretRestore {
  textarea: HTMLTextAreaElement;
  value: string;
  position: number;
}

/**
 * Restores only the selection after native maxLength rejects an insertion.
 * The text value and React state are never touched, preserving native undo.
 */
export function useRejectedInsertionCaret() {
  const pendingRef = useRef<PendingCaretRestore | null>(null);

  const restore = useCallback((textarea: HTMLTextAreaElement) => {
    const pending = pendingRef.current;
    if (
      !pending
      || pending.textarea !== textarea
      || textarea.value !== pending.value
      || document.activeElement !== textarea
    ) {
      return;
    }
    if (
      textarea.selectionStart !== pending.position
      || textarea.selectionEnd !== pending.position
    ) {
      textarea.setSelectionRange(pending.position, pending.position);
    }
  }, []);

  const arm = useCallback((textarea: HTMLTextAreaElement) => {
    const pending: PendingCaretRestore = {
      textarea,
      value: textarea.value,
      position: textarea.selectionStart,
    };
    pendingRef.current = pending;
    requestAnimationFrame(() => {
      restore(textarea);
      requestAnimationFrame(() => {
        restore(textarea);
        if (pendingRef.current === pending) pendingRef.current = null;
      });
    });
  }, [restore]);

  return {
    armRejectedInsertionCaret: arm,
    restoreRejectedInsertionCaret: restore,
  };
}

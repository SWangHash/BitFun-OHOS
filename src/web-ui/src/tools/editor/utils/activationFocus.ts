const CANVAS_SCOPE_SELECTOR = '[data-shortcut-scope="canvas"]';

/**
 * Decides whether an editor may take keyboard focus when its tab activates.
 *
 * A single click in the file tree must keep focus on the tree (the caret only
 * appears when the user asks for it — clicking the selected file again, or
 * clicking into the editor). Tab-bar clicks and keyboard tab switching land
 * inside the canvas shortcut scope, and an unfocused workbench (activeElement
 * on <body>) has nothing to preserve; both hand focus to the editor.
 */
export function shouldFocusEditorOnTabActivation(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  const active = document.activeElement;
  if (!active || active === document.body) {
    return true;
  }
  const canvasScope = document.querySelector(CANVAS_SCOPE_SELECTOR);
  return !!canvasScope && canvasScope.contains(active);
}

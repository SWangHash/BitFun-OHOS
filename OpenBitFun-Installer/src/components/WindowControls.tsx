import { Minus as LucideMinus, X as LucideX } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Window controls — matches the OpenBitFun main app style.
 * 32x32 transparent buttons with SVG icons, subtle hover bg.
 */
export function WindowControls() {
  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  return (
    <div className="window-controls">
      <button
        className="window-controls__btn"
        onClick={handleMinimize}
        aria-label="Minimize"
        title="Minimize"
      >
        <LucideMinus width="14" height="14" aria-hidden="true" />
      </button>
      <button
        className="window-controls__btn window-controls__btn--close"
        onClick={handleClose}
        aria-label="Close"
        title="Close"
      >
        <LucideX width="14" height="14" aria-hidden="true" />
      </button>
    </div>
  );
}

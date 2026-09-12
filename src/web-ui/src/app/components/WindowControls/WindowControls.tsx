import { Copy as LucideCopy, Minus as LucideMinus, Square as LucideSquare, X as LucideX } from 'lucide-react';
import React from 'react';
import { Tooltip } from '@openbitfun/ui';
import { useTranslation } from 'react-i18next';
import { isWindowsDesktopRuntime } from '@/infrastructure/runtime';

// Loaded from index.html so the pre-React splash and app chrome share one stylesheet instance.

export interface WindowControlsProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  maximized?: boolean;
  disabled?: boolean;
}

const MinimizeGlyph = () => (
  <LucideMinus width="10" height="10" aria-hidden="true" />
);

const MaximizeGlyph = () => (
  <LucideSquare width="10" height="10" aria-hidden="true" />
);

const RestoreGlyph = () => (
  <LucideCopy width="10" height="10" aria-hidden="true" />
);

const CloseGlyph = () => (
  <LucideX width="10" height="10" aria-hidden="true" />
);

/** Desktop-shell window commands. This is product chrome, not a public UI primitive. */
export const WindowControls: React.FC<WindowControlsProps> = ({
  onMinimize,
  onToggleMaximize,
  onClose,
  maximized = false,
  disabled = false,
  className,
  ...props
}) => {
  const { t } = useTranslation('common');
  const isWindows = isWindowsDesktopRuntime();
  const maximizeLabel = maximized ? t('window.restore') : t('window.maximize');

  const run = (event: React.MouseEvent<HTMLButtonElement>, command: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    command();
  };

  return (
    <div
      {...props}
      className={['window-controls', isWindows && 'window-controls--windows', className].filter(Boolean).join(' ')}
      data-openbitfun-component="window-controls"
      data-openbitfun-part="root"
      data-openbitfun-state={[disabled && 'disabled', maximized && 'maximized'].filter(Boolean).join(' ') || undefined}
    >
      <Tooltip content={t('window.minimize')} placement="bottom">
        <button
          type="button"
          className="window-controls__btn window-controls__btn--minimize"
          onClick={(event) => run(event, onMinimize)}
          disabled={disabled}
          aria-label={t('window.minimize')}
        >
          <MinimizeGlyph />
        </button>
      </Tooltip>

      <Tooltip content={maximizeLabel} placement="bottom">
        <button
          type="button"
          className="window-controls__btn window-controls__btn--maximize"
          onClick={(event) => run(event, onToggleMaximize)}
          disabled={disabled}
          aria-label={maximizeLabel}
        >
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </button>
      </Tooltip>

      <Tooltip content={t('window.close')} placement="bottom">
        <button
          type="button"
          className="window-controls__btn window-controls__btn--close"
          onClick={(event) => run(event, onClose)}
          disabled={disabled}
          aria-label={t('window.close')}
        >
          <CloseGlyph />
        </button>
      </Tooltip>
    </div>
  );
};

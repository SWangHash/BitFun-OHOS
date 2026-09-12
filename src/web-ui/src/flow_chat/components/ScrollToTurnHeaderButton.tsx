import { ArrowUp as LucideArrowUp } from 'lucide-react';
/**
 * Scroll-to-current-turn-header button.
 * Shows at the top of the message list when the current turn's user message
 * has scrolled out of view above the viewport.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@openbitfun/ui';
import './ScrollToTurnHeaderButton.scss';

interface ScrollToTurnHeaderButtonProps {
  visible: boolean;
  onClick: () => void;
  turnLabel?: string;
  className?: string;
}

export const ScrollToTurnHeaderButton: React.FC<ScrollToTurnHeaderButtonProps> = ({
  visible,
  onClick,
  turnLabel,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');

  return (
    <div data-openbitfun-component="scroll-to-turn-header-button" data-openbitfun-part="root" data-openbitfun-state={visible ? 'visible' : ''}
      className={`scroll-to-turn-header-trigger ${visible ? 'scroll-to-turn-header-trigger--visible' : ''} ${className}`}
      aria-hidden={!visible}
    >
      <div data-openbitfun-component="scroll-to-turn-header-button" data-openbitfun-part="gradient" className="scroll-to-turn-header-trigger__gradient" />
      <div data-openbitfun-component="scroll-to-turn-header-button" data-openbitfun-part="content" className="scroll-to-turn-header-trigger__content">
        <Tooltip content={turnLabel || t('scroll.toCurrentTurn')}>
          <button
            data-openbitfun-component="scroll-to-turn-header-button"
            data-openbitfun-part="button"
            className="scroll-to-turn-header-trigger__btn"
            onClick={onClick}
            aria-label={turnLabel || t('scroll.toCurrentTurn')}
            tabIndex={visible ? 0 : -1}
          >
            <LucideArrowUp width="16" height="16" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

ScrollToTurnHeaderButton.displayName = 'ScrollToTurnHeaderButton';

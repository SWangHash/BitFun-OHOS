import { OverflowText } from '@bitfun/ui';
/**
 * Generic panel header with centered title and optional action buttons.
 */

import React from 'react';
import './PanelHeader.scss';

export interface PanelHeaderProps {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  actions,
  className = '',
}) => {
  return (
    <div data-bitfun-component="panel-header" data-bitfun-part="root" className={`bitfun-panel-header ${className}`}>
      <h3 className="bitfun-panel-header__title" data-bitfun-component="panel-header" data-bitfun-part="title"><OverflowText>{title}</OverflowText></h3>
      {actions && (
        <div className="bitfun-panel-header__actions" data-bitfun-component="panel-header" data-bitfun-part="actions">
          {actions}
        </div>
      )}
    </div>
  );
};

PanelHeader.displayName = 'PanelHeader';

export default PanelHeader;

import React from 'react';

import { Icon as CatalogIcon, IconButton, Tooltip } from '@bitfun/ui';

export interface ConfigRefreshButtonProps {
  tooltip: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export const ConfigRefreshButton: React.FC<ConfigRefreshButtonProps> = ({
  tooltip,
  onClick,
  loading = false,
  disabled = false,
  className = '',
  testId,
}) => {
  return (
    <Tooltip content={tooltip} disabled={disabled}>
      <IconButton
        aria-label={tooltip}
        variant="quiet"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        className={className}
        data-testid={testId}
        icon={<CatalogIcon name="refresh" size="sm" />}
      />
    </Tooltip>
  );
};


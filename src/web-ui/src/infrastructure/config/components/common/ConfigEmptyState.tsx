import React from 'react';
import { Empty, type EmptyProps } from '@bitfun/ui';
import { formatStandaloneUiCopy } from './standaloneUiCopy';
import './ConfigPageState.scss';

export interface ConfigEmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon: React.ReactNode;
  title?: EmptyProps['title'];
  description: React.ReactNode;
  actions?: EmptyProps['actions'];
}

/** Shared empty-section presentation; callers retain their Appearance hooks. */
export const ConfigEmptyState: React.FC<ConfigEmptyStateProps> = ({
  icon,
  title,
  description,
  actions,
  className = '',
  ...props
}) => (
  <div
    data-bitfun-component="config"
    data-bitfun-part="emptyState"
    {...props}
    className={`bitfun-config-empty-state ${className}`.trim()}
  >
    <Empty icon={icon} title={formatStandaloneUiCopy(title)} description={formatStandaloneUiCopy(description)} actions={actions} />
  </div>
);

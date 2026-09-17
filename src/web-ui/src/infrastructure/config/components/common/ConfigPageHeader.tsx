import React from 'react';
import { PageHeader } from '@bitfun/ui';
import { formatStandaloneUiText } from './standaloneUiCopy';
import './ConfigPageHeader.scss';

export interface ConfigPageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}

export const ConfigPageHeader: React.FC<ConfigPageHeaderProps> = ({
  title,
  subtitle,
  icon: _icon,
  extra,
  className = '',
  ...props
}) => {
  return (
    <div className={`bitfun-config-page-header ${className}`} data-bitfun-component="config" data-bitfun-part="pageHeader" {...props}>
      <div className="bitfun-config-page-header__inner" data-bitfun-component="config" data-bitfun-part="pageHeaderInner">
        <div className="bitfun-config-page-header__left">
          <div className="bitfun-config-page-header__info" data-bitfun-component="config" data-bitfun-part="pageHeaderInfo">
            <PageHeader
              level={2}
              size="md"
              title={(
                <span
                  className="bitfun-config-page-header__title"
                  data-bitfun-component="config"
                  data-bitfun-part="pageHeaderTitle"
                >
                  {title}
                </span>
              )}
              description={subtitle ? (
                <span className="bitfun-config-page-header__subtitle" data-bitfun-component="config" data-bitfun-part="pageHeaderSubtitle">{formatStandaloneUiText(subtitle)}</span>
              ) : undefined}
            />
          </div>
        </div>
        {extra && (
          <div className="bitfun-config-page-header__extra" data-bitfun-component="config" data-bitfun-part="pageHeaderExtra">
            {extra}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPageHeader;

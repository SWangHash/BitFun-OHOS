import React from 'react';
import { ConfigPageSection } from './ConfigPageLayout';
import './ConfigCollectionSection.scss';

export interface ConfigCollectionSectionProps {
  title: string;
  description?: string;
  toolbar?: React.ReactNode;
  filters?: React.ReactNode;
  editor?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const ConfigCollectionSection: React.FC<ConfigCollectionSectionProps> = ({
  title,
  description,
  toolbar,
  filters,
  editor,
  className = '',
  children,
}) => {
  const hasEditor = Boolean(editor);

  return (
    <ConfigPageSection
      title={title}
      description={description}
      className={`bitfun-config-collection-section ${hasEditor ? 'bitfun-config-collection-section--with-editor' : ''} ${className}`}
    >
      <div className="bitfun-config-collection-section__content" data-bitfun-component="config" data-bitfun-part="collectionSection">
        {toolbar && (
          <div className="bitfun-config-collection-section__toolbar" data-bitfun-component="config" data-bitfun-part="collectionToolbar">
            {toolbar}
          </div>
        )}
        {editor && (
          <div className="bitfun-config-collection-section__editor" data-bitfun-component="config" data-bitfun-part="collectionEditor">
            {editor}
          </div>
        )}
        {filters && (
          <div className="bitfun-config-collection-section__filters" data-bitfun-component="config" data-bitfun-part="collectionFilters">
            {filters}
          </div>
        )}
        <div className="bitfun-config-collection-section__list" data-bitfun-component="config" data-bitfun-part="collectionList">
          {children}
        </div>
      </div>
    </ConfigPageSection>
  );
};

export default ConfigCollectionSection;

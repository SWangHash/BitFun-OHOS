/**
 * Grid layout
 */

import React from 'react';
import type { ComponentPreview } from '../../types';
import type { LayoutType } from '../../types';
import { useI18n } from '@/infrastructure/i18n';
import './GridLayout.css';

interface GridLayoutProps {
  components: ComponentPreview[];
  columns?: 2 | 3 | 4;
  layoutType?: LayoutType;
}

export const GridLayout: React.FC<GridLayoutProps> = ({ 
  components, 
  columns = 3,
  layoutType = 'default'
}) => {
  const { t } = useI18n('components');
  const gridClass = `grid-layout grid-cols-${columns}`;
  
  return (
    <div
      className={gridClass}
      data-openbitfun-component="component-preview"
      data-openbitfun-part="gridRoot"
      data-openbitfun-columns={String(columns)}
    >
      {components.map((component) => (
        <div key={component.id} className="grid-card" data-openbitfun-component="component-preview" data-openbitfun-part="gridCard">
          <div className="grid-card-header" data-openbitfun-component="component-preview" data-openbitfun-part="gridHeader">
            <h3 className="grid-card-title">{component.name}</h3>
            <p className="grid-card-description">{component.description}</p>
          </div>
          
          <div className="grid-card-preview" data-openbitfun-component="component-preview" data-openbitfun-part="gridPreview">
            <div className="preview-label">{t('componentLibrary.layouts.previewLabel')}</div>
            <div className="preview-canvas" data-openbitfun-component="component-preview" data-openbitfun-part="gridCanvas">
              <component.component />
            </div>
          </div>
          
          <div className="grid-card-info" data-openbitfun-component="component-preview" data-openbitfun-part="gridInfo">
            <dl className="info-list">
              <dt>{t('componentLibrary.layouts.idLabel')}</dt>
              <dd>{component.id}</dd>
            </dl>
          </div>
        </div>
      ))}
    </div>
  );
};

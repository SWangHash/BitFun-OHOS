/**
 * Full-page layout
 */

import React, { useState } from 'react';
import type { ComponentPreview } from '../../types';
import './FullPageLayout.css';

interface FullPageLayoutProps {
  components: ComponentPreview[];
}

export const FullPageLayout: React.FC<FullPageLayoutProps> = ({ components }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  if (components.length === 1) {
    const Component = components[0].component;
    return (
      <div className="full-page-layout" data-bitfun-component="component-preview" data-bitfun-part="fullPageRoot">
        <div className="full-page-item" data-bitfun-component="component-preview" data-bitfun-part="fullPageContent">
          <Component />
        </div>
      </div>
    );
  }

  const ActiveComponent = components[activeIndex].component;

  return (
    <div className="full-page-layout" data-bitfun-component="component-preview" data-bitfun-part="fullPageRoot">
      <div className="full-page-tabs" data-bitfun-component="component-preview" data-bitfun-part="fullPageTabs">
        {components.map((component, index) => (
          <button
            key={component.id}
            className={`full-page-tab ${index === activeIndex ? 'active' : ''}`}
            onClick={() => setActiveIndex(index)}
            data-bitfun-component="component-preview"
            data-bitfun-part="fullPageTab"
            data-bitfun-state={index === activeIndex ? 'active' : undefined}
          >
            <span className="tab-name">{component.name}</span>
            <span className="tab-description">{component.description}</span>
          </button>
        ))}
      </div>

      <div className="full-page-content" data-bitfun-component="component-preview" data-bitfun-part="fullPageContent">
        <ActiveComponent />
      </div>
    </div>
  );
};

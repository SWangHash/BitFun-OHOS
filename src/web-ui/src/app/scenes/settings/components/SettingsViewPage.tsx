import React, { Suspense, useMemo } from 'react';
import { TabGroup } from '@bitfun/ui';
import { useSettingsStore } from '../settingsStore';
import type { SettingsPageProps, SettingsViewId } from '../settingsTypes';
import './SettingsViewPage.scss';

export interface SettingsViewDefinition {
  id: SettingsViewId;
  label: React.ReactNode;
  content: React.ReactNode;
}

interface SettingsViewPageProps extends SettingsPageProps {
  defaultViewId: SettingsViewId;
  views: readonly SettingsViewDefinition[];
}

export const SettingsViewPage: React.FC<SettingsViewPageProps> = ({
  defaultViewId,
  views,
  viewId,
}) => {
  const setActiveView = useSettingsStore((state) => state.setActiveView);
  const allowedViewIds = useMemo(() => new Set(views.map((view) => view.id)), [views]);
  const activeViewId = viewId && allowedViewIds.has(viewId) ? viewId : defaultViewId;
  const activeView = views.find((view) => view.id === activeViewId) ?? views[0];
  const tabItems = views.map((view) => ({
    id: `settings-view-${view.id}-tab`,
    label: view.label,
    panelId: `settings-view-${view.id}-panel`,
    value: view.id,
  }));

  const handleChange = (nextViewId: string) => {
    if (!allowedViewIds.has(nextViewId as SettingsViewId)) return;
    const next = nextViewId as SettingsViewId;
    setActiveView(next);
  };

  return (
    <div
      className="bitfun-settings-view-page"
      data-bitfun-component="settings-view-page"
      data-bitfun-part="root"
      data-bitfun-view={activeViewId}
    >
      <div className="bitfun-settings-view-page__tabs">
        <TabGroup
          size="sm"
          className="bitfun-settings-view-page__tab-list"
          items={tabItems}
          onValueChange={handleChange}
          value={activeViewId}
        />
        {activeView && (
          <div
            aria-labelledby={`settings-view-${activeView.id}-tab`}
            className="bitfun-settings-view-page__tab-content"
            id={`settings-view-${activeView.id}-panel`}
            role="tabpanel"
          >
            <Suspense fallback={(
              <div
                className="bitfun-settings-view-page__loading"
                data-bitfun-component="settings-view-page"
                data-bitfun-part="loading"
                aria-busy="true"
                aria-hidden="true"
              >
                <span className="bitfun-settings-view-page__loading-line" data-bitfun-component="settings-view-page" data-bitfun-part="loadingLine" />
                <span className="bitfun-settings-view-page__loading-line" data-bitfun-component="settings-view-page" data-bitfun-part="loadingLine" />
                <span className="bitfun-settings-view-page__loading-block" data-bitfun-component="settings-view-page" data-bitfun-part="loadingBlock" />
              </div>
            )}>
              {activeView.content}
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
};

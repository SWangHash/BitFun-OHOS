import React, { useMemo } from 'react';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { useMiniAppStore } from '@/app/scenes/miniapps/miniAppStore';
import { useMiniAppActivity } from '@/app/scenes/miniapps/hooks/useMiniAppActivity';
import { renderMiniAppIcon, getMiniAppIconGradient } from '@/app/scenes/miniapps/utils/miniAppIcons';
import { Icon, IconButton, NavigationPanelItem, Tooltip } from '@bitfun/ui';

const MAX_VISIBLE_ACTIVE_APPS = 3;

interface MiniAppEntryProps {
  isActive: boolean;
  activeMiniAppId?: string | null;
  onOpenMiniApps: () => void;
  onOpenMiniApp: (appId: string) => void;
}

const MiniAppEntry: React.FC<MiniAppEntryProps> = ({
  isActive,
  activeMiniAppId = null,
  onOpenMiniApps,
  onOpenMiniApp,
}) => {
  const { t } = useI18n('common');
  const activities = useMiniAppActivity();
  const customizingAppIds = useMiniAppStore((state) => state.customizingAppIds);
  const customizingIdSet = useMemo(() => new Set(customizingAppIds), [customizingAppIds]);
  const hasCustomizingApps = customizingAppIds.length > 0;

  const activeApps = useMemo(() => {
    const list = activities.map((activity) => activity.app);

    if (!activeMiniAppId) {
      return list;
    }

    return [...list].sort((a, b) => {
      if (a.id === activeMiniAppId) return -1;
      if (b.id === activeMiniAppId) return 1;
      return 0;
    });
  }, [activeMiniAppId, activities]);

  const visibleApps = activeApps.slice(0, MAX_VISIBLE_ACTIVE_APPS);
  const overflowCount = Math.max(0, activeApps.length - visibleApps.length);

  return (
    <div className="bitfun-nav-panel__miniapp-entry-wrap">
      <NavigationPanelItem
        className="bitfun-nav-panel__miniapp-item"
        triggerClassName={[
          'bitfun-nav-panel__miniapp-entry',
          isActive && 'is-active',
          activeApps.length > 0 && 'has-running-apps',
          hasCustomizingApps && 'has-customizing-apps',
        ].filter(Boolean).join(' ')}
        onClick={onOpenMiniApps}
        aria-label={t('scenes.miniApps')}
        data-testid="nav-miniapps-entry"
        selected={isActive}
        leading={(
          <span className="bitfun-nav-panel__miniapp-entry-icon">
            <Icon name="mini-app" size="sm" />
          </span>
        )}
        actionContent={(
          <span className="bitfun-nav-panel__miniapp-entry-apps">
            {visibleApps.length > 0 ? (
              <>
                {visibleApps.map((app) => {
                  const isAppActive = app.id === activeMiniAppId;
                  return (
                    <Tooltip key={app.id} content={app.name} placement="right">
                      <IconButton
                        className={[
                          'bitfun-nav-panel__miniapp-bubble',
                          isAppActive && 'is-active',
                          customizingIdSet.has(app.id) && 'is-customizing',
                        ].filter(Boolean).join(' ')}
                        style={{ background: getMiniAppIconGradient(app.icon || 'box') }}
                        onClick={() => onOpenMiniApp(app.id)}
                        aria-label={app.name}
                        data-testid="nav-miniapp-activity-item"
                        data-miniapp-id={app.id}
                        icon={renderMiniAppIcon(app.icon || 'box', 'sm')}
                        shape="circle"
                        size="xs"
                        variant="quiet"
                      />
                    </Tooltip>
                  );
                })}
                {overflowCount > 0 ? (
                  <span className="bitfun-nav-panel__miniapp-bubble bitfun-nav-panel__miniapp-bubble--more">
                    +{overflowCount}
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
        )}
      >
        {t('scenes.miniApps')}
      </NavigationPanelItem>
    </div>
  );
};

export default MiniAppEntry;

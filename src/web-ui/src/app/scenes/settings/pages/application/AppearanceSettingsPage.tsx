import '@/app/scenes/settings/pages/application/AppearanceSettingsPage.scss';
import { AppearancePackageConfigSection } from '@/infrastructure/config/components/AppearancePackageConfigSection';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageSectionStack
} from '@/infrastructure/config/components/common';
import { FontPreferencePanel } from '@/infrastructure/font-preference';
import SessionPanelSettingsSection from './SessionPanelSettingsSection';
import React from 'react';
import { useTranslation } from 'react-i18next';

const AppearanceSettingsPage: React.FC = () => {
  const { t } = useTranslation('settings/appearance');

  return (
    <ConfigPageLayout
      className="bitfun-appearance-settings"
      data-bitfun-component="appearance-settings"
      data-bitfun-part="root"
    >
      <ConfigPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ConfigPageContent
        className="bitfun-appearance-settings__content"
        data-bitfun-component="appearance-settings"
        data-bitfun-part="content"
      >
        <ConfigPageSectionStack data-testid="appearance-settings">
          <AppearancePackageConfigSection />
          <FontPreferencePanel />
          <SessionPanelSettingsSection />
        </ConfigPageSectionStack>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AppearanceSettingsPage;

import React from 'react';
import {
  PermissionsSettingsPage as RuntimePermissionsSettingsPage,
} from '@/infrastructure/config/components/RuntimeSettingsPages';
import type { SettingsPageProps } from '../../settingsTypes';

const PermissionsSettingsPage: React.FC<SettingsPageProps> = () => (
  <RuntimePermissionsSettingsPage />
);

export default PermissionsSettingsPage;

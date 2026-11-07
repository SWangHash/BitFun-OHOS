import type { SettingsPageProps } from '../../settingsTypes';
import { SettingsPage } from '../shared/SettingsPage';
import DesktopCardsSettingsSection from './DesktopCardsSettingsSection';
import PetSettingsSection from './PetSettingsSection';

export default function PetAssistantSettingsPage({ isActive }: SettingsPageProps) {
  return (
    <SettingsPage pageId="application.pet">
      <PetSettingsSection isActive={isActive} />
      <DesktopCardsSettingsSection />
    </SettingsPage>
  );
}

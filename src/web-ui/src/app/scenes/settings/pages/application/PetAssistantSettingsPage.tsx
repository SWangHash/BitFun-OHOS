import RealtimeVoiceSettingsSection from '@/infrastructure/config/components/RealtimeVoiceSettingsSection';
import type { SettingsPageProps } from '../../settingsTypes';
import { SettingsPage } from '../shared/SettingsPage';
import PetSettingsSection from './PetSettingsSection';

export default function PetAssistantSettingsPage({ isActive }: SettingsPageProps) {
  return <SettingsPage pageId="application.pet"><PetSettingsSection isActive={isActive} /><RealtimeVoiceSettingsSection /></SettingsPage>;
}

import { ConfigPageSectionStack } from '@/infrastructure/config/components/common';
import VoiceInputConfig from '@/infrastructure/config/components/VoiceInputConfig';
import KeyboardShortcutsTab from '../../components/KeyboardShortcutsTab';
import { SettingsPage } from '../shared/SettingsPage';
import { useSettingsSectionAnchor } from '../shared/useSettingsSectionAnchor';

export default function InputSettingsPage() {
  const voiceAnchor = useSettingsSectionAnchor('voice');
  const shortcutsAnchor = useSettingsSectionAnchor('shortcuts');

  return (
    <SettingsPage pageId="application.input">
      <ConfigPageSectionStack id={voiceAnchor}>
        <VoiceInputConfig embedded />
      </ConfigPageSectionStack>
      <ConfigPageSectionStack id={shortcutsAnchor}>
        <KeyboardShortcutsTab embedded />
      </ConfigPageSectionStack>
    </SettingsPage>
  );
}

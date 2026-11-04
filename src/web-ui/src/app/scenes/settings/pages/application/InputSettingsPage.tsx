import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import VoiceInputConfig from '@/infrastructure/config/components/VoiceInputConfig';
import { SettingsPage } from '../shared/SettingsPage';
import KeyboardShortcutsSection from './KeyboardShortcutsSection';
import MessageSendingSettingsSection from './MessageSendingSettingsSection';
import TextSelectionSettingsSection from './TextSelectionSettingsSection';

export default function InputSettingsPage() {
  return <SettingsPage pageId="application.input">
    {!isOpenHarmonyRuntime() && <VoiceInputConfig embedded />}
    <MessageSendingSettingsSection />
    <TextSelectionSettingsSection />
    <KeyboardShortcutsSection />
  </SettingsPage>;
}
